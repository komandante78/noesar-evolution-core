// SPDX-License-Identifier: AGPL-3.0-or-later
//
// `CE-015` — *«Un risultato dal web non è applicabile finché non è stato eseguito e verificato in
// sandbox»* (`MASTER_PROJECT/15_CODEN_EVOLUTION_DA_ZERO.md` §11, severity **C**), verification
// method *«test che tenta di promuovere una fonte non eseguita»*.
//
// # "Applicable" has two meanings in this product, and the criterion covers both
//
//   applied to the CODE       a snippet, a fix or a body found on the web becomes bytes in the
//                             workspace — the sandbox is the SHADOW, and the attempt the method
//                             names is `approve()` without `measure()`
//   applied to the RUNTIME    an artifact acquired over the network — a model descriptor — becomes
//                             something this installation runs; the verification is attestation
//                             against a registered publisher key
//
// Testing only the first would leave the second, which is the one where "from the web" is
// literal: bytes fetched from a remote host.
//
// # The first thing measured is that the shorter answer is true, and why it is not enough
//
// A research report cannot reach the workspace at all: measured below, the report store is only
// ever `put`, `get` and `revoke`, and no module turns a report into a file. That is a real and
// strong property — but on its own it is the "nothing can be applied because nothing applies
// anything" answer, which would stop being true the day someone wires the two together. So the
// general rule is exercised too, on a body that IS a web result, through the real promote path.
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateKeyPairSync } from 'node:crypto';
import { randomBytes } from 'node:crypto';
import { WorkspaceActionOrchestrator, WorkspaceActionError } from '../src/workspace-actions.mjs';
import { TokenMinter } from '../src/capability.mjs';
import { EventLedger } from '../src/events.mjs';
import {
  verifyModelDescriptor, signModelDescriptor, publicKeyFingerprint, authenticitySummary,
  DescriptorAuthenticity,
} from '../../../packages/verified-acquisition/src/authenticity.mjs';
import { freshTempDir } from './support/workspace.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(HERE, '../src');
const NOW = 1_800_000_000;

/** A line of text that came off a web page, of the shape a research candidate carries. */
const FROM_THE_WEB = 'export const fix = "pasted from a search result";\n';

const code = (line) => {
  const comment = line.indexOf('//');
  return comment === -1 ? line : line.slice(0, comment);
};

function fixture({ author = null } = {}) {
  const ws = freshTempDir('noesar-ce015-ws-');
  const shadows = freshTempDir('noesar-ce015-sh-');
  writeFileSync(join(ws, '.seed'), 'seed');
  writeFileSync(join(ws, 'target.mjs'), 'export const fix = "the original";\n');
  const events = new EventLedger();
  const orch = new WorkspaceActionOrchestrator({
    workspaceRoot: ws, shadowsRoot: shadows,
    minter: new TokenMinter(randomBytes(32)), events, env: {}, author,
  });
  return { ws, orch, events };
}

describe('CE-015 — a result from the web is not applicable until executed and verified in a sandbox', () => {

  // ── 1 · the shorter answer, measured rather than assumed ──────────────────────────────────
  test('a research report has no path to the workspace: the store is only put, get and revoke', () => {
    const uses = [];
    const walk = (dir) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) { walk(path); continue; }
        if (!entry.name.endsWith('.mjs')) continue;
        readFileSync(path, 'utf8').split('\n').forEach((line, index) => {
          const match = /(?:researchReportStore|reportStore)\.([A-Za-z_$][\w$]*)\(/.exec(code(line));
          if (match) uses.push({ file: relative(SRC, path), line: index + 1, method: match[1] });
        });
      }
    };
    walk(SRC);
    assert.ok(uses.length > 0, 'the report store is not used at all — this scan is not reaching the code');
    const methods = [...new Set(uses.map((use) => use.method))].sort();
    // 2026-08-27, Owner: `list` is the fourth, and it is admitted rather than tolerated. CE-015
    // is about a WEB RESULT reaching the workspace unexecuted; `list` returns ids, the objective
    // and criteria the person typed, and two dates — never a candidate, never a statement, never
    // a URL. `research.test.mjs` holds that claim as its own assertion, so this list staying at
    // four is not the only thing standing between a search result and an apply.
    assert.deepEqual(methods, ['get', 'list', 'put', 'revoke'],
      `the report store gained a method: ${uses.map((use) => `${use.file}:${use.line} ${use.method}`).join(', ')}`);
  });

  // ── 2 · the attempt the method names, on a body that IS a web result ──────────────────────
  test('promoting a web-sourced body that was never executed in the shadow is refused by name', () => {
    const fx = fixture();
    return fx.orch.plan({
      request: 'apply the fix found online',
      files: [{ path: 'target.mjs', contents: FROM_THE_WEB }],
      actor: 'owner-001', nowUnix: NOW,
    }).then((planned) => {
      // The attempt: apply it without the sandbox ever having run it.
      assert.throws(
        () => fx.orch.approve({ runId: planned.runId, approverId: 'owner-001', nowUnix: NOW }),
        (error) => error instanceof WorkspaceActionError && error.kind === 'NOT_MEASURED',
      );
      // And the refusal is about the bytes, not only the reply.
      assert.equal(readFileSync(join(fx.ws, 'target.mjs'), 'utf8'), 'export const fix = "the original";\n');
    });
  });

  test('a measured run that was rejected cannot be promoted afterwards — ALREADY_DECIDED, by name', async () => {
    // Written first as "a shadow that is gone", and it PASSED — for the wrong reason. `reject()`
    // drops the shadow *and* moves the status, so `approve()` refuses at the status check and
    // never reaches the shadow check. Asserting only `instanceof WorkspaceActionError` hid that.
    // The kind is now asserted, and the test is named after what it actually measures.
    //
    // The genuine lost-shadow case (`MEASUREMENT_LOST`, what a restart produces) has **no public
    // door** to drive it from a test — `#shadows` and `#dropShadow` are private and every public
    // path that empties them also decides the run. Declared here rather than claimed: this file
    // does not prove that branch.
    const fx = fixture();
    const planned = await fx.orch.plan({
      request: 'apply the fix found online',
      files: [{ path: 'target.mjs', contents: FROM_THE_WEB }],
      actor: 'owner-001', nowUnix: NOW,
    });
    fx.orch.measure({ runId: planned.runId, actor: 'owner-001', nowUnix: NOW });
    fx.orch.reject({ runId: planned.runId, approverId: 'owner-001', reason: 'the source was not trusted', nowUnix: NOW });
    assert.throws(
      () => fx.orch.approve({ runId: planned.runId, approverId: 'owner-001', nowUnix: NOW + 1 }),
      (error) => error instanceof WorkspaceActionError && error.kind === 'ALREADY_DECIDED',
    );
    assert.equal(readFileSync(join(fx.ws, 'target.mjs'), 'utf8'), 'export const fix = "the original";\n');
  });

  test('the order is readable in the ledger: the sandbox ran and was compared BEFORE anything applied', async () => {
    const fx = fixture();
    const planned = await fx.orch.plan({
      request: 'apply the fix found online',
      files: [{ path: 'target.mjs', contents: FROM_THE_WEB }],
      actor: 'owner-001', nowUnix: NOW,
    });
    fx.orch.measure({ runId: planned.runId, actor: 'owner-001', nowUnix: NOW });
    const approved = fx.orch.approve({ runId: planned.runId, approverId: 'owner-001', nowUnix: NOW + 1 });
    assert.equal(approved.promoted, true);

    const actions = fx.events.correlation(planned.runId).map((event) => event.action);
    const at = (name) => actions.indexOf(name);
    for (const name of ['executor.ran', 'shadow.compared', 'workspace_action.promoted']) {
      assert.ok(at(name) >= 0, `${name} was not recorded: ${actions.join(', ')}`);
    }
    assert.ok(at('executor.ran') < at('workspace_action.promoted'), 'the web result was applied before it was executed');
    assert.ok(at('shadow.compared') < at('workspace_action.promoted'), 'the web result was applied before it was compared');
    // What landed is what the SHADOW produced, byte for byte — not the string the caller pasted
    // into the request and not something re-derived at promotion time.
    assert.equal(readFileSync(join(fx.ws, 'target.mjs'), 'utf8'), FROM_THE_WEB);
  });

  // ── 3 · the other meaning: an artifact acquired over the network ──────────────────────────
  describe('an artifact fetched from a remote host is not runnable until it is attested', () => {
    const descriptorOf = (extra = {}) => ({
      id: 'model-from-the-web', name: 'A model', publisher: 'pub-1',
      artifacts: [{ url: 'https://example.invalid/model.gguf', sha256: 'a'.repeat(64) }],
      ...extra,
    });
    const registryFor = (publicKeyPem, fingerprint) => ({
      findActiveKey: ({ publisherId, fingerprint: asked }) =>
        (publisherId === 'pub-1' && asked === fingerprint ? { publicKeyPem, trustLevel: 'community' } : null),
    });

    test('an unsigned descriptor is refused, and the refusal SAYS so rather than being absent', () => {
      const result = verifyModelDescriptor({ descriptor: descriptorOf(), registry: null });
      assert.equal(result.verified, false);
      assert.equal(result.kind, DescriptorAuthenticity.NO_SIGNATURE);
      // A summary that is never null and never absent: a missing field must not read as "fine".
      const summary = authenticitySummary(result);
      assert.equal(summary.verified, false);
      assert.ok(summary.reason && summary.reason.length > 20, 'the refusal carries no reason');
    });

    test('a descriptor altered after signing is refused — the bytes that arrived are not the bytes signed', () => {
      const { privateKey, publicKey } = generateKeyPairSync('ed25519');
      const fingerprint = publicKeyFingerprint(publicKey);
      const signed = signModelDescriptor(descriptorOf(), privateKey.export({ type: 'pkcs8', format: 'pem' }));
      const registry = registryFor(publicKey.export({ type: 'spki', format: 'pem' }), fingerprint);
      // Attested as it stands.
      assert.equal(verifyModelDescriptor({ descriptor: signed, registry }).verified, true);
      // One byte of the artifact list changed in transit — the classic "from the web" failure.
      const tampered = { ...signed, artifacts: [{ url: 'https://evil.invalid/model.gguf', sha256: 'b'.repeat(64) }] };
      const result = verifyModelDescriptor({ descriptor: tampered, registry });
      assert.equal(result.verified, false);
      assert.equal(result.kind, DescriptorAuthenticity.SIGNATURE_INVALID);
    });

    test('a signature from a key this installation does not trust is refused, not merely noted', () => {
      const { privateKey } = generateKeyPairSync('ed25519');
      const signed = signModelDescriptor(descriptorOf(), privateKey.export({ type: 'pkcs8', format: 'pem' }));
      const result = verifyModelDescriptor({ descriptor: signed, registry: { findActiveKey: () => null } });
      assert.equal(result.verified, false);
      assert.equal(result.kind, DescriptorAuthenticity.KEY_NOT_TRUSTED);
    });

    test('with no registry at all, nothing verifies — absence of a check is never a pass', () => {
      const { privateKey } = generateKeyPairSync('ed25519');
      const signed = signModelDescriptor(descriptorOf(), privateKey.export({ type: 'pkcs8', format: 'pem' }));
      const result = verifyModelDescriptor({ descriptor: signed, registry: null });
      assert.equal(result.verified, false);
      assert.equal(result.kind, DescriptorAuthenticity.NO_REGISTRY);
    });
  });

  // Negative control: the path really does work when the sandbox has run, or every refusal
  // above is satisfied by a product that promotes nothing at all.
  test('negative control · executed in the shadow and compared, the same web result IS applied', async () => {
    const fx = fixture();
    const planned = await fx.orch.plan({
      request: 'apply the fix found online',
      files: [{ path: 'target.mjs', contents: FROM_THE_WEB }],
      actor: 'owner-001', nowUnix: NOW,
    });
    const measured = fx.orch.measure({ runId: planned.runId, actor: 'owner-001', nowUnix: NOW });
    assert.equal(measured.clean, true);
    // Measuring changed nothing: the sandbox is a sandbox.
    assert.equal(readFileSync(join(fx.ws, 'target.mjs'), 'utf8'), 'export const fix = "the original";\n');
    fx.orch.approve({ runId: planned.runId, approverId: 'owner-001', nowUnix: NOW + 1 });
    assert.equal(readFileSync(join(fx.ws, 'target.mjs'), 'utf8'), FROM_THE_WEB);
  });
});
