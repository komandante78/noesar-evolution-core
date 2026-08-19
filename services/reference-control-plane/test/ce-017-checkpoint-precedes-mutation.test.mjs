// SPDX-License-Identifier: AGPL-3.0-or-later
//
// `CE-017` — *«Ogni passo mutativo è preceduto da un checkpoint, e il ripristino è
// byte-identico»* (`MASTER_PROJECT/15_CODEN_EVOLUTION_DA_ZERO.md` §11, severity **C**),
// verification method *«ripristino verificato con checksum su ogni classe di passo»*.
//
// # How the ordering is measured, since nothing can watch it happen
//
// "The checkpoint precedes the mutation" is a claim about an order of operations inside
// `#promote`, and a test cannot stand between two statements. What it can do is check the only
// observable that the order produces: **a restored file can only carry its original bytes if
// those bytes were read before they were overwritten**, and a created file can only be removed
// on restore if its absence was recorded before it existed. So the checksum comparison below is
// not a nice-to-have beside the ordering claim — it *is* the ordering claim, in the only form
// that can be executed.
//
// # "Ogni classe di passo", stated at its real width rather than rounded up
//
// The wired path supports **WRITE only** — `workspaceActionsStatus()` says so, and the suite
// asserts that rather than trusting this comment, so the day `DELETE` or `EXECUTE` is wired
// this file fails and the CE-017 verdict has to be re-earned on the new class. Within WRITE
// there are two classes and both are exercised here: **modify** an existing file (restore must
// write the original bytes back) and **create** a new one (restore must remove it).

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { randomBytes } from 'node:crypto';
import { WorkspaceActionOrchestrator, workspaceActionsStatus } from '../src/workspace-actions.mjs';
import { TokenMinter } from '../src/capability.mjs';
import { EventLedger } from '../src/events.mjs';

const NOW = 1_800_000_000;

/** Every file in the tree, by path, with its sha256. The checksum the criterion asks for. */
function checksums(root, base = root) {
  const map = {};
  for (const entry of readdirSync(root, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const full = join(root, entry.name);
    if (entry.isDirectory()) Object.assign(map, checksums(full, base));
    else map[relative(base, full)] = createHash('sha256').update(readFileSync(full)).digest('hex');
  }
  return map;
}

function fixture() {
  const ws = mkdtempSync(join(tmpdir(), 'noesar-ce017-ws-'));
  const shadows = mkdtempSync(join(tmpdir(), 'noesar-ce017-sh-'));
  writeFileSync(join(ws, '.seed'), 'seed');
  const orch = new WorkspaceActionOrchestrator({
    workspaceRoot: ws, shadowsRoot: shadows,
    minter: new TokenMinter(randomBytes(32)), events: new EventLedger(),
  });
  return { ws, shadows, orch, cleanup() {
    rmSync(ws, { recursive: true, force: true });
    rmSync(shadows, { recursive: true, force: true });
  } };
}

describe('CE-017 — a checkpoint precedes every mutative step, and restore is byte-identical', () => {

  test('CE-017 scope: the wired path is WRITE only, and this test is what makes that a checked claim', () => {
    const status = workspaceActionsStatus();
    assert.deepEqual(status.operationsSupported, ['WRITE']);
    assert.deepEqual([...status.operationsNotSupported].sort(), ['DELETE', 'EXECUTE']);
    assert.equal(status.restoreSupported, true);
    // If DELETE or EXECUTE is ever wired, this fails: a class of mutative step would exist
    // that CE-017's verdict was never earned against.
  });

  test('CE-017: both WRITE classes at once — restore returns the tree to a checksum-identical state', async () => {
    const fx = fixture();
    try {
      mkdirSync(join(fx.ws, 'src/deep'), { recursive: true });
      writeFileSync(join(fx.ws, 'src/modified.txt'), 'original bytes\n');
      writeFileSync(join(fx.ws, 'src/deep/untouched.bin'), Buffer.from([0, 1, 2, 255, 0]));

      const before = checksums(fx.ws);
      assert.equal(Object.keys(before).length, 3);

      const planned = await fx.orch.plan({
        request: 'modify one file and create another',
        files: [
          { path: 'src/modified.txt', contents: 'rewritten bytes\n' },   // class 1: modify
          { path: 'src/deep/created.txt', contents: 'brand new\n' },     // class 2: create
        ],
        actor: 'owner-001', nowUnix: NOW,
      });
      fx.orch.measure({ runId: planned.runId, actor: 'owner-001', nowUnix: NOW });
      fx.orch.approve({ runId: planned.runId, approverId: 'owner-001', nowUnix: NOW });

      // The mutation really happened — otherwise the restore below would prove nothing.
      const after = checksums(fx.ws);
      assert.equal(Object.keys(after).length, 4);
      assert.notEqual(after['src/modified.txt'], before['src/modified.txt']);

      fx.orch.restore({ runId: planned.runId, actor: 'owner-001', nowUnix: NOW + 1 });

      // Byte-identical: same set of paths, same digest for each. Not "looks right" — the map.
      assert.deepEqual(checksums(fx.ws), before);
    } finally { fx.cleanup(); }
  });

  test('CE-017: a file untouched by the plan is untouched by the restore', async () => {
    // The other direction of "byte-identical": a restore that rewrote the whole tree from a
    // snapshot would pass the test above and quietly revert somebody else's work.
    const fx = fixture();
    try {
      writeFileSync(join(fx.ws, 'planned.txt'), 'a\n');
      writeFileSync(join(fx.ws, 'unrelated.txt'), 'untouched\n');
      const planned = await fx.orch.plan({
        request: 'change one file', files: [{ path: 'planned.txt', contents: 'b\n' }],
        actor: 'owner-001', nowUnix: NOW,
      });
      fx.orch.measure({ runId: planned.runId, actor: 'owner-001', nowUnix: NOW });
      fx.orch.approve({ runId: planned.runId, approverId: 'owner-001', nowUnix: NOW });

      // Someone edits an unrelated file between the promotion and the restore.
      writeFileSync(join(fx.ws, 'unrelated.txt'), 'edited by someone else\n');
      fx.orch.restore({ runId: planned.runId, actor: 'owner-001', nowUnix: NOW + 1 });

      assert.equal(readFileSync(join(fx.ws, 'planned.txt'), 'utf8'), 'a\n');
      assert.equal(readFileSync(join(fx.ws, 'unrelated.txt'), 'utf8'), 'edited by someone else\n',
        'restore reverted a file the plan never named');
    } finally { fx.cleanup(); }
  });

  test('CE-017: the checkpoint is per run — restoring the second returns to the first, not to the origin', async () => {
    const fx = fixture();
    try {
      writeFileSync(join(fx.ws, 'a.txt'), 'v1\n');
      const first = await fx.orch.plan({
        request: 'v2', files: [{ path: 'a.txt', contents: 'v2\n' }], actor: 'owner-001', nowUnix: NOW,
      });
      fx.orch.measure({ runId: first.runId, actor: 'owner-001', nowUnix: NOW });
      fx.orch.approve({ runId: first.runId, approverId: 'owner-001', nowUnix: NOW });
      const afterFirst = checksums(fx.ws);

      const second = await fx.orch.plan({
        request: 'v3', files: [{ path: 'a.txt', contents: 'v3\n' }], actor: 'owner-001', nowUnix: NOW + 1,
      });
      fx.orch.measure({ runId: second.runId, actor: 'owner-001', nowUnix: NOW + 1 });
      fx.orch.approve({ runId: second.runId, approverId: 'owner-001', nowUnix: NOW + 1 });
      assert.equal(readFileSync(join(fx.ws, 'a.txt'), 'utf8'), 'v3\n');

      fx.orch.restore({ runId: second.runId, actor: 'owner-001', nowUnix: NOW + 2 });
      // A checkpoint taken against the origin rather than against "the state this step is
      // about to change" would silently discard the first run's accepted work.
      assert.deepEqual(checksums(fx.ws), afterFirst);
      assert.equal(readFileSync(join(fx.ws, 'a.txt'), 'utf8'), 'v2\n');
    } finally { fx.cleanup(); }
  });

  test('CE-017: binary bytes survive the round trip exactly — no encoding is assumed anywhere', async () => {
    // `#promote` captures a Buffer and writes a Buffer. Reading through a string at either end
    // would round-trip most files and corrupt exactly the ones nobody notices until later.
    const fx = fixture();
    try {
      const original = Buffer.from([0x00, 0xff, 0xfe, 0x80, 0x0a, 0x00, 0xc3]);
      writeFileSync(join(fx.ws, 'blob.bin'), original);
      const before = checksums(fx.ws);
      const planned = await fx.orch.plan({
        request: 'overwrite the blob', files: [{ path: 'blob.bin', contents: 'text now\n' }],
        actor: 'owner-001', nowUnix: NOW,
      });
      fx.orch.measure({ runId: planned.runId, actor: 'owner-001', nowUnix: NOW });
      fx.orch.approve({ runId: planned.runId, approverId: 'owner-001', nowUnix: NOW });
      fx.orch.restore({ runId: planned.runId, actor: 'owner-001', nowUnix: NOW + 1 });

      assert.deepEqual(checksums(fx.ws), before);
      assert.deepEqual(readFileSync(join(fx.ws, 'blob.bin')), original);
    } finally { fx.cleanup(); }
  });
});
