// SPDX-License-Identifier: AGPL-3.0-or-later
//
// `CE-006` — *"Ogni chiamata al modello è rieseguibile isolata dal suo stato registrato"*,
// verified the way the row itself names: *"replay di una decisione scelta a caso da una
// sessione conclusa"*.
//
// WHAT WAS TRUE BEFORE `D-0597`, measured. `author.mjs` recorded one fixture per call and
// `workspace-actions.mjs` wrote those fixtures into the event ledger with the comment
// *"`CE-006` asks for the session to be re-runnable, and a ledger line saying 'there were
// three' replays nothing"*. What a fixture held was `{path, model, promptDigest, answerDigest,
// at, provenance, outcome, contentsDigest}` — five digests and no bytes. A digest CHECKS a call
// somebody re-executed by other means; it cannot re-execute one, and the means were recorded
// nowhere. `author.mjs`'s rule 5 said "EVERY CALL IS A FIXTURE (`CE-006`). Each authoring
// returns a replayable record", and that was a claim the code did not have.
//
// The tests below are written so that reverting the repair turns them red — the record's
// sufficiency is asserted by REBUILDING the decision from it, never by looking at its shape.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes, createHash, randomInt } from 'node:crypto';

import { Author, replayAuthoringCall } from '../src/author.mjs';
import { AuthoringReplayStore, replayFromStore, referencedDigests } from '../src/authoring-replay-store.mjs';
import { WorkspaceActionOrchestrator } from '../src/workspace-actions.mjs';
import { TokenMinter } from '../src/capability.mjs';
import { EventLedger } from '../src/events.mjs';

const digest = (text) => createHash('sha256').update(String(text)).digest('hex');
const fenced = (body) => `Here you go:\n\n\`\`\`js\n${body}\n\`\`\`\n`;
/** A fence whose contents are EXACTLY `body` — `fenced` adds a newline before the closing
 *  fence, which is right for prose and wrong for the one case that must come back
 *  byte-identical to what was on disk. */
const fencedExact = (body) => `Here you go:\n\n\`\`\`js\n${body}\`\`\`\n`;

/** A concluded session: a real orchestrator, a real workspace, a real Author over a stub model
 *  that answers differently per file — including one answer the rules must refuse, because a
 *  session in which every call succeeded would only ever prove the happy road replays. */
function concludedSession() {
  const workspace = mkdtempSync(join(tmpdir(), 'noesar-ce006-ws-'));
  const shadows = mkdtempSync(join(tmpdir(), 'noesar-ce006-sh-'));
  const runs = mkdtempSync(join(tmpdir(), 'noesar-ce006-runs-'));
  mkdirSync(join(workspace, 'src'), { recursive: true });
  writeFileSync(join(workspace, 'src/login.js'), 'export function loginRoute() {}\n');
  writeFileSync(join(workspace, 'src/rate-limit.js'), 'export const limit = 1;\n');
  writeFileSync(join(workspace, 'README.md'), '# demo\n\nA login route with no rate limiting.\n');

  const author = new Author({
    generate: async ({ path }) => {
      // Three shapes on purpose, so the fixtures of one session are not all alike:
      if (path === 'README.md') return 'no fenced block here at all, just prose';        // refused
      if (path === 'src/rate-limit.js') return fencedExact('export const limit = 1;\n');   // unchanged
      return fenced('export function loginRoute() { /* rate limited */ }\n');             // written
    },
  });

  const events = new EventLedger();
  const orchestrator = new WorkspaceActionOrchestrator({
    workspaceRoot: workspace, shadowsRoot: shadows, minter: new TokenMinter(randomBytes(32)),
    events, author, runStoreDirectory: runs,
  });
  const cleanup = () => {
    for (const directory of [workspace, shadows, runs]) rmSync(directory, { recursive: true, force: true });
  };
  return { orchestrator, events, workspace, runs, cleanup };
}

// The three files are NAMED rather than left to grounding, so the session that gets replayed is
// the same three calls on every run. Grounding is exercised elsewhere; a replay test whose input
// set could shift would fail for a reason that has nothing to do with replay.
async function planned(session) {
  return session.orchestrator.plan({
    request: 'rate limit the login route',
    files: [
      { path: 'src/login.js', contents: 'export function loginRoute() {}\n' },
      { path: 'src/rate-limit.js', contents: 'export const limit = 1;\n' },
      { path: 'README.md', contents: '# demo\n\nA login route with no rate limiting.\n' },
    ],
    actor: 'owner', nowUnix: Math.floor(Date.now() / 1000),
  });
}

// --- the criterion's own method ---------------------------------------------------------

test('a decision chosen AT RANDOM from a concluded session replays to the same decision', async (t) => {
  const session = concludedSession();
  t.after(session.cleanup);
  const { runId } = await planned(session);

  const first = session.orchestrator.replayAuthoredCall({ runId, index: 0 });
  assert.equal(first.calls, 3, 'the session concluded with three model calls');

  // Random, as the row asks — and every index is asserted afterwards, so a green run is never
  // an accident of which one came up. The random draw is what the criterion names; the sweep
  // is what makes a failure reproducible instead of intermittent.
  const chosen = randomInt(first.calls);
  const drawn = session.orchestrator.replayAuthoredCall({ runId, index: chosen });
  assert.equal(drawn.replayable, true, `call ${chosen} (${drawn.path}) was not replayable: ${drawn.reason}`);
  assert.equal(drawn.faithful, true, `call ${chosen} (${drawn.path}) replayed to a different decision: ${JSON.stringify(drawn.diffs)}`);

  for (let index = 0; index < first.calls; index += 1) {
    const outcome = session.orchestrator.replayAuthoredCall({ runId, index });
    assert.equal(outcome.faithful, true, `call ${index} (${outcome.path}): ${JSON.stringify(outcome.diffs)}`);
    assert.deepEqual(outcome.diffs, []);
  }
});

test('the three outcomes of one session each replay as themselves, not as each other', async (t) => {
  const session = concludedSession();
  t.after(session.cleanup);
  const { runId } = await planned(session);

  const byPath = new Map();
  for (let index = 0; index < 3; index += 1) {
    const outcome = session.orchestrator.replayAuthoredCall({ runId, index });
    byPath.set(outcome.path, outcome);
  }
  assert.equal(byPath.get('src/login.js').decision.outcome, 'written');
  assert.equal(byPath.get('src/rate-limit.js').decision.outcome, 'unchanged',
    'a model that returns the file unchanged is a real answer, and the replay must reproduce THAT verdict');
  assert.equal(byPath.get('README.md').decision.outcome, 'refused');
  assert.equal(byPath.get('README.md').decision.refusal.code, 'NO_FENCE');
  // `unchanged` vs `written` is a comparison against what the file held before the call. Until
  // `beforeDigest` was recorded, this verdict was the one a replay could not rebuild at all.
  assert.notEqual(byPath.get('src/login.js').decision.contentsDigest,
    byPath.get('src/rate-limit.js').decision.contentsDigest);
});

// --- "isolated" is meant literally -------------------------------------------------------

test('a call replays from its record alone, with no run, no session and no workspace', async (t) => {
  const session = concludedSession();
  t.after(session.cleanup);
  const { runId } = await planned(session);

  const fixtures = session.events.correlation(runId)
    .filter((event) => event.action === 'workspace_action.authored')
    .flatMap((event) => JSON.parse(event.payload || '{}').fixtures ?? []);
  assert.equal(fixtures.length, 3);

  // A store opened fresh on the same directory — nothing of the orchestrator, the workspace or
  // the ledger is in scope here beyond the fixture itself. If this passes, the recorded state
  // really is sufficient; the orchestrator method above is then a convenience, not the proof.
  const store = new AuthoringReplayStore(join(session.runs, 'authoring-replay'));
  for (const fixture of fixtures) {
    const outcome = replayFromStore({ fixture, store });
    assert.equal(outcome.faithful, true, `${fixture.path}: ${outcome.reason ?? JSON.stringify(outcome.diffs)}`);
  }

  // And the prompt really is re-issuable: it is the bytes a model was asked, not a hash of them.
  const prompt = store.get(fixtures[0].promptDigest);
  assert.equal(typeof prompt, 'string');
  assert.match(prompt, /Goal: rate limit the login route/);
  assert.match(prompt, /File: /);
});

// --- the ledger did not grow --------------------------------------------------------------

test('no prompt and no answer ever reaches the event ledger', async (t) => {
  const session = concludedSession();
  t.after(session.cleanup);
  const { runId } = await planned(session);

  const authored = session.events.correlation(runId)
    .filter((event) => event.action === 'workspace_action.authored');
  const serialised = JSON.stringify(authored);
  // The repair had to make the record resolvable WITHOUT pushing the user's repository into an
  // append-only audit surface. Asserted on the bytes of the ledger line, not on the field list:
  // a future field carrying content would slip past a field-name check and not past this.
  assert.ok(!serialised.includes('rate limited'), 'an authored body reached the ledger');
  assert.ok(!serialised.includes('Goal: rate limit'), 'a prompt reached the ledger');
  assert.ok(!serialised.includes('```'), 'a raw model answer reached the ledger');
  for (const fixture of authored.flatMap((event) => JSON.parse(event.payload || '{}').fixtures ?? [])) {
    assert.equal(Object.hasOwn(fixture, 'prompt'), false);
    assert.equal(Object.hasOwn(fixture, 'answer'), false);
  }
});

// --- the oracle: it must be able to report an UNfaithful replay ---------------------------

test('a corrupted stored answer is reported, not replayed as faithful', async (t) => {
  const session = concludedSession();
  t.after(session.cleanup);
  const { runId } = await planned(session);

  const directory = join(session.runs, 'authoring-replay');
  const fixture = session.events.correlation(runId)
    .filter((event) => event.action === 'workspace_action.authored')
    .flatMap((event) => JSON.parse(event.payload || '{}').fixtures ?? [])
    .find((entry) => entry.path === 'src/login.js');

  // Overwrite the stored answer with different bytes under the SAME name. This is the case a
  // content-addressed store exists to catch, and the check has to be the hash — trusting the
  // filename would make the integrity claim rest on the filesystem never lying.
  writeFileSync(join(directory, fixture.answerRecordDigest), fenced('something else entirely\n'));
  const store = new AuthoringReplayStore(directory);
  const outcome = replayFromStore({ fixture, store });
  assert.equal(outcome.faithful, false);
  assert.equal(outcome.kind, 'UNRESOLVABLE');
  // CORRUPT, not ABSENT. Those are opposite problems — nobody kept it, versus what was kept has
  // been altered — and the first version of this store answered `null` to both, which sent this
  // very oracle looking for the wrong failure.
  assert.match(outcome.reason, /answer is corrupt/);
  assert.equal(store.read(fixture.answerRecordDigest).status, 'corrupt');
  assert.equal(store.read(digest('never stored')).status, 'absent');
});

test('a missing record is UNRESOLVABLE and never a faithful replay of nothing', () => {
  const empty = new AuthoringReplayStore(mkdtempSync(join(tmpdir(), 'noesar-ce006-empty-')));
  const outcome = replayFromStore({
    fixture: { path: 'a.js', promptDigest: digest('p'), answerRecordDigest: digest('a'), answerKind: 'text', outcome: 'written' },
    store: empty,
  });
  assert.equal(outcome.faithful, false);
  assert.equal(outcome.kind, 'UNRESOLVABLE');
  assert.match(outcome.reason, /prompt is not in the store/);
});

test('a recorded decision that the rules no longer reach is reported as a difference', () => {
  // The product's code moving is the thing this replay is FOR — it re-applies today's rules to
  // yesterday's answer. A fixture claiming an outcome those rules do not produce must come back
  // as a diff, never as a pass; asserted by handing it a record that disagrees with itself.
  const answer = fenced('a body\n');
  const outcome = replayAuthoringCall({
    fixture: {
      path: 'a.js', promptDigest: digest('p'), answerKind: 'text', answerRecordDigest: digest(answer),
      beforeDigest: digest('something else\n'), outcome: 'unchanged', contentsDigest: digest('a body\n'),
    },
    prompt: 'p',
    answer,
  });
  assert.equal(outcome.kind, 'RE_APPLIED');
  assert.equal(outcome.faithful, false);
  // Both halves of the disagreement are reported, not the first one found: a replay that
  // stopped at `outcome` would hide a content digest that had also moved.
  assert.deepEqual(outcome.diffs.map((diff) => diff.field), ['outcome', 'contentsDigest']);
  assert.deepEqual(outcome.diffs[0], { field: 'outcome', was: 'unchanged', now: 'written' });
});

// --- the store itself ----------------------------------------------------------------------

test('the store is content-addressed: the same bytes twice are one object', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'noesar-ce006-store-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const store = new AuthoringReplayStore(directory);

  const first = store.put('the same prompt');
  const second = store.put('the same prompt');
  assert.equal(first, second);
  assert.equal(readdirSync(directory).length, 1, 'an identical prompt asked twice costs one file, not two');
  assert.equal(store.get(first), 'the same prompt');
  assert.equal(store.get(digest('never stored')), null);
  assert.equal(store.get('not-a-digest'), null);
  assert.equal(store.get('../../etc/passwd'), null, 'a name that is not a digest never becomes a path');
  assert.equal(readFileSync(join(directory, first), 'utf8'), 'the same prompt');
});

test('a store with no directory is honestly not durable rather than silently empty', () => {
  const store = new AuthoringReplayStore(null);
  assert.equal(store.durable, false);
  // `put` still answers with the digest, so a caller's bookkeeping is identical either way and
  // the difference shows up where it matters: nothing can be read back.
  assert.equal(store.put('x'), digest('x'));
  assert.equal(store.get(digest('x')), null);
});

test('sweep removes only what nothing references, and never a name it did not write', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'noesar-ce006-sweep-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const store = new AuthoringReplayStore(directory);
  const kept = store.put('still referenced');
  store.put('orphaned');
  writeFileSync(join(directory, 'NOT-A-DIGEST.txt'), 'somebody else put this here');

  // `{ apply: true }` since `D-0606`: the default became the DRY RUN, because this call
  // destroys recorded state and a signature whose default deletes is one typo from an
  // accident. The dry run's own behaviour is asserted in `authoring-replay-retention.test.mjs`;
  // what this test is about is unchanged — what a sweep removes and what it must never touch.
  const result = store.sweep(new Set([kept]), { apply: true });
  assert.equal(result.removed, 1);
  assert.equal(result.kept, 1);
  assert.equal(store.get(kept), 'still referenced');
  assert.equal(readdirSync(directory).includes('NOT-A-DIGEST.txt'), true,
    'a sweep that removed a file this store did not name would be deleting somebody else\'s data');
});

test('the live reference set is built from named fields, not by walking the object', async (t) => {
  const session = concludedSession();
  t.after(session.cleanup);
  const { runId } = await planned(session);

  const live = session.orchestrator.authoringReplayReferences();
  const fixtures = session.events.correlation(runId)
    .filter((event) => event.action === 'workspace_action.authored')
    .flatMap((event) => JSON.parse(event.payload || '{}').fixtures ?? []);
  for (const digestValue of referencedDigests(fixtures)) {
    assert.equal(live.has(digestValue), true, 'a digest a live run still references was not in the live set');
  }
  // Everything on disk is referenced: sweeping this session would remove nothing, which is the
  // correct answer and the one that proves the reference set is not accidentally empty.
  const store = new AuthoringReplayStore(join(session.runs, 'authoring-replay'));
  const swept = store.sweep(live);
  assert.equal(swept.removed, 0);
  assert.ok(swept.kept > 0);
});
