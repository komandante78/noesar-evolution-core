// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The shadow copy leaves the product's own state behind, and a shadow that cannot be built is a
// refusal the caller can read. Measured 2026-09-21 on the live installation: a 9 GB model
// downloaded into `models/artefacts` put the workspace over the shadow's byte limit, every
// measure() answered "Internal request failure", and CodeN could no longer try anything.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { ShadowWorkspace } from '../src/shadow.mjs';
import { WorkspaceActionOrchestrator, WorkspaceActionError } from '../src/workspace-actions.mjs';
import { TokenMinter } from '../src/capability.mjs';
import { EventLedger } from '../src/events.mjs';

const created = [];
after(() => { for (const dir of created) rmSync(dir, { recursive: true, force: true }); });
const scratch = (label) => { const dir = mkdtempSync(join(tmpdir(), `noesar-${label}-`)); created.push(dir); return dir; };

/** A workspace laid out like the live one: the operator's files beside the engine's. */
function liveLikeWorkspace() {
  const ws = scratch('engine-state-ws');
  writeFileSync(join(ws, 'README.md'), '# project\n');
  mkdirSync(join(ws, 'src', 'state'), { recursive: true });
  writeFileSync(join(ws, 'src', 'state', 'machine.mjs'), 'export const S = 1;\n'); // the operator's own `state`
  mkdirSync(join(ws, 'models', 'artefacts'), { recursive: true });
  writeFileSync(join(ws, 'models', 'artefacts', 'big.bin'), Buffer.alloc(64 * 1024, 1));
  mkdirSync(join(ws, 'state'), { recursive: true });
  writeFileSync(join(ws, 'state', 'auth.json'), '{"secret":true}');
  writeFileSync(join(ws, 'state', 'auth.json.bak_pre_mfa_off'), '{"secret":true}');
  mkdirSync(join(ws, 'config'), { recursive: true });
  writeFileSync(join(ws, 'config', 'provider-credentials.key'), 'k');
  return ws;
}

test('a large model in the engine\'s store no longer makes the whole workspace unshadowable', () => {
  const ws = liveLikeWorkspace();
  // 64 KiB of model against a 16 KiB budget: before this change, LIMIT; after, the model is not copied.
  const shadow = ShadowWorkspace.ofWorkspace(ws, join(scratch('engine-state-sh'), 's'), { maxBytes: 16 * 1024 });
  assert.equal(existsSync(join(shadow.root, 'models')), false);
  assert.ok(shadow.excluded.some((entry) => entry.path === 'models'), 'the exclusion is reported, not silent');
});

test('credentials and their copies stay out of the shadow; the operator\'s own `state/` stays in', () => {
  const ws = liveLikeWorkspace();
  const shadow = ShadowWorkspace.ofWorkspace(ws, join(scratch('engine-state-sh'), 's'));
  assert.equal(existsSync(join(shadow.root, 'state', 'auth.json')), false);
  assert.equal(existsSync(join(shadow.root, 'state', 'auth.json.bak_pre_mfa_off')), false, 'a copy of a credential file is the same material');
  assert.equal(existsSync(join(shadow.root, 'config')), false);
  assert.equal(existsSync(join(shadow.root, 'src', 'state', 'machine.mjs')), true);
  assert.equal(existsSync(join(shadow.root, 'README.md')), true);
});

test('a run that writes into engine state is still observed — as a file nobody declared', () => {
  const ws = liveLikeWorkspace();
  const shadow = ShadowWorkspace.ofWorkspace(ws, join(scratch('engine-state-sh'), 's'));
  mkdirSync(join(shadow.root, 'models'), { recursive: true });
  writeFileSync(join(shadow.root, 'models', 'planted.bin'), 'x');
  assert.equal(shadow.observe([]).changed['models/planted.bin'], 'CREATED');
});

// The first version of this change missed it, and eight tests of the real server caught it: a
// fresh installation's workspace holds ONLY engine state, and a plan's first file goes into it.
test('a workspace holding only engine state still shadows, so a first file can be created and observed', () => {
  const ws = scratch('engine-state-only');
  mkdirSync(join(ws, 'state'), { recursive: true });
  writeFileSync(join(ws, 'state', 'auth.json'), '{}');
  mkdirSync(join(ws, 'audit'), { recursive: true });
  writeFileSync(join(ws, 'audit', 'events.jsonl'), '');
  const shadow = ShadowWorkspace.ofWorkspace(ws, join(scratch('engine-state-sh'), 's'));
  writeFileSync(join(shadow.root, 'first.md'), '# first\n');
  assert.equal(shadow.observe([]).changed['first.md'], 'CREATED');
});

test('a directory with nothing in it at all is still refused as the shadow of nothing', () => {
  assert.throws(() => ShadowWorkspace.ofWorkspace(scratch('engine-state-empty'), join(scratch('engine-state-sh'), 's')),
    /a shadow of nothing/);
});

test('a shadow the engine refuses to build reaches the caller as a typed refusal, not an internal error', async () => {
  const ws = scratch('engine-state-refuse');
  writeFileSync(join(ws, 'target.mjs'), 'export const A = 1;\n');
  const orch = new WorkspaceActionOrchestrator({
    workspaceRoot: ws, shadowsRoot: scratch('engine-state-refuse-sh'),
    minter: new TokenMinter(randomBytes(32)), events: new EventLedger(),
  });
  const planned = await orch.plan({
    request: 'raise A to two', files: [{ path: 'target.mjs', contents: 'export const A = 2;\n' }],
    actor: 'tester', nowUnix: Math.floor(Date.now() / 1000),
  });
  const runId = planned.runId ?? planned.run?.runId;
  assert.ok(runId, 'the plan must exist for the measure to be refused');
  // The workspace goes away between plan and measure, so the shadow cannot be built.
  rmSync(ws, { recursive: true, force: true });
  await assert.rejects(
    async () => orch.measure({ runId, actor: 'tester', nowUnix: Math.floor(Date.now() / 1000) }),
    (error) => error instanceof WorkspaceActionError && error.kind.startsWith('SHADOW_') && error.reason.length > 0,
  );
});
