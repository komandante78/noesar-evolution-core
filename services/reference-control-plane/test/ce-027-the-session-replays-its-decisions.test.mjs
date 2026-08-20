// SPDX-License-Identifier: AGPL-3.0-or-later
//
// `CE-027` — *"Ogni autoratura è registrata come fixture e la sessione si riesegue producendo le
// stesse **decisioni**"*, verified as the row asks: *"replay di una sessione conclusa, contenuti
// dalle fixture, decisioni ricalcolate"*.
//
// THE METHOD NAMES TWO DIFFERENT VERBS AND THEY ARE NOT INTERCHANGEABLE.
//
//   decisioni RICALCOLATE   `#runDecisionLayer` runs AGAIN — today's code over yesterday's
//                           request — so a session stops replaying the day the product's own
//                           decision code changes its mind. That is the point of recomputing.
//   contenuti DALLE FIXTURE the authored bytes are NOT regenerated. A model writing fresh bytes
//                           on every replay would be reported as drift originating in the
//                           product, when non-determinism there is the one thing
//                           `01_VISIONE_E_POSIZIONE.md` already declares.
//
// WHAT WAS TRUE BEFORE `D-0600`, measured: `replay()` recomputed the decisions and left the
// authoring out of the verdict entirely — it deliberately never reaches the Author, and nothing
// replayed the recorded calls either. So `faithful: true` meant "the plan matched" while saying
// nothing at all about the bytes the session actually produced, on a method whose whole name is
// replay. `D-0597` built the record those bytes needed; this joins the two halves into one
// verdict.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

import { Author } from '../src/author.mjs';
import { WorkspaceActionOrchestrator } from '../src/workspace-actions.mjs';
import { TokenMinter } from '../src/capability.mjs';
import { EventLedger } from '../src/events.mjs';

const NOW = Math.floor(Date.now() / 1000);
const fenced = (body) => `Here you go:\n\n\`\`\`js\n${body}\n\`\`\`\n`;

/** A session that authors more than one file, so "the session replays" is a claim about a
 *  session and not about a single call that happened to survive. */
function session() {
  const workspace = mkdtempSync(join(tmpdir(), 'noesar-ce027-ws-'));
  const shadows = mkdtempSync(join(tmpdir(), 'noesar-ce027-sh-'));
  const runs = mkdtempSync(join(tmpdir(), 'noesar-ce027-runs-'));
  mkdirSync(join(workspace, 'src'), { recursive: true });
  writeFileSync(join(workspace, 'src/login.js'), 'export function loginRoute() {}\n');
  writeFileSync(join(workspace, 'src/limit.js'), 'export const limit = 1;\n');

  // Deliberately non-deterministic: every call answers differently. If replay regenerated the
  // contents instead of reading the record, this alone would turn every replay red — which is
  // exactly the confusion the criterion's wording exists to prevent, made impossible to pass by
  // accident here.
  let call = 0;
  const author = new Author({
    generate: async () => { call += 1; return fenced(`export const answer = ${call}; // ${Math.random()}\n`); },
  });
  const events = new EventLedger();
  const orchestrator = new WorkspaceActionOrchestrator({
    workspaceRoot: workspace, shadowsRoot: shadows, minter: new TokenMinter(randomBytes(32)),
    events, author, runStoreDirectory: runs,
  });
  return {
    orchestrator, events, runs,
    plan: () => orchestrator.plan({
      request: 'rate limit the login route',
      files: [
        { path: 'src/login.js', contents: 'export function loginRoute() {}\n' },
        { path: 'src/limit.js', contents: 'export const limit = 1;\n' },
      ],
      actor: 'owner', nowUnix: NOW,
    }),
    cleanup: () => { for (const d of [workspace, shadows, runs]) rmSync(d, { recursive: true, force: true }); },
  };
}

test('a concluded session replays: decisions recomputed, contents from the fixtures', async (t) => {
  const s = session();
  t.after(s.cleanup);
  const planned = await s.plan();
  assert.equal(planned.authoring.authored, 2, 'the session must author more than one file');

  const replayed = await s.orchestrator.replay({ runId: planned.runId, actor: 'owner', nowUnix: NOW + 1 });

  assert.equal(replayed.method, 'LOCAL_RECOMPUTE');
  // Both halves reported separately, and the verdict is their AND.
  assert.equal(replayed.decisions.faithful, true, JSON.stringify(replayed.decisions.diffs));
  assert.equal(replayed.authoring.calls, 2);
  assert.equal(replayed.authoring.faithful, true, JSON.stringify(replayed.authoring.results));
  assert.equal(replayed.authoring.unresolvable, 0);
  assert.equal(replayed.authoring.diverged, 0);
  assert.equal(replayed.faithful, true);

  // Every call is accounted for BY NAME. A count alone would pass if two calls to the same file
  // were replayed and a third were quietly dropped.
  assert.deepEqual(replayed.authoring.results.map((r) => r.path).sort(), ['src/limit.js', 'src/login.js']);
  for (const result of replayed.authoring.results) assert.equal(result.kind, 'RE_APPLIED');
});

test('the whole-session verdict is an AND: recorded authoring that no longer reproduces fails it', async (t) => {
  const s = session();
  t.after(s.cleanup);
  const planned = await s.plan();

  // Corrupt one stored answer. The decisions are untouched and will still recompute perfectly —
  // which is the case that matters: before this change the session would have reported
  // `faithful: true` while the bytes it produced could no longer be reproduced at all.
  const store = join(s.runs, 'authoring-replay');
  const [victim] = readdirSync(store).filter((name) => /^[0-9a-f]{64}$/.test(name));
  writeFileSync(join(store, victim), 'tampered');

  const replayed = await s.orchestrator.replay({ runId: planned.runId, actor: 'owner', nowUnix: NOW + 1 });
  assert.equal(replayed.decisions.faithful, true, 'the decisions were not touched and must still recompute');
  assert.equal(replayed.faithful, false, 'the session verdict must not be true when its authoring cannot be reproduced');
  assert.equal(replayed.authoring.faithful, false);
  assert.equal(replayed.authoring.unresolvable, 1);
  assert.match(replayed.authoring.results.find((r) => !r.faithful).reason, /corrupt/);
});

test('the replay is on the ledger with both halves, not only the plan', async (t) => {
  const s = session();
  t.after(s.cleanup);
  const planned = await s.plan();
  await s.orchestrator.replay({ runId: planned.runId, actor: 'owner', nowUnix: NOW + 1 });

  const replayEvent = s.events.correlation(planned.runId).find((e) => e.action === 'workspace_action.replayed');
  const payload = JSON.parse(replayEvent.payload);
  assert.equal(payload.method, 'LOCAL_RECOMPUTE');
  assert.equal(payload.faithful, true);
  // An auditor reading only the ledger must be able to see that the authoring was checked at
  // all — a `faithful: true` whose scope is invisible is the kind an audit is built on.
  assert.equal(payload.authoringCalls, 2);
  assert.equal(payload.authoringFaithful, true);
});

test('a session that authored nothing replays faithfully, and says it checked nothing', async (t) => {
  const workspace = mkdtempSync(join(tmpdir(), 'noesar-ce027-nomodel-ws-'));
  const shadows = mkdtempSync(join(tmpdir(), 'noesar-ce027-nomodel-sh-'));
  const runs = mkdtempSync(join(tmpdir(), 'noesar-ce027-nomodel-runs-'));
  mkdirSync(join(workspace, 'src'), { recursive: true });
  writeFileSync(join(workspace, 'src/login.js'), 'export function loginRoute() {}\n');
  t.after(() => { for (const d of [workspace, shadows, runs]) rmSync(d, { recursive: true, force: true }); });

  // No author at all — the installation with no model configured, which `CE-022` requires to
  // keep working. It authors nothing, so there is nothing to fail to reproduce; reporting that
  // as unfaithful would make every plan on such an installation look like a regression.
  const orchestrator = new WorkspaceActionOrchestrator({
    workspaceRoot: workspace, shadowsRoot: shadows, minter: new TokenMinter(randomBytes(32)),
    events: new EventLedger(), runStoreDirectory: runs,
  });
  const planned = await orchestrator.plan({
    request: 'rate limit the login route',
    files: [{ path: 'src/login.js', contents: 'export function loginRoute() {}\n' }],
    actor: 'owner', nowUnix: NOW,
  });
  const replayed = await orchestrator.replay({ runId: planned.runId, actor: 'owner', nowUnix: NOW + 1 });
  assert.equal(replayed.faithful, true);
  assert.equal(replayed.authoring.calls, 0);
  assert.deepEqual(replayed.authoring.results, []);
});
