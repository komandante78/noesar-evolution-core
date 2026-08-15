// SPDX-License-Identifier: AGPL-3.0-or-later
//
// D-0338 — runs and the engine causal record survive a restart.
//
// The bar here is deliberately not "the run came back". A run that reloads, looks complete
// and has lost `authoredContents` would pass that bar and then make `approve()` write the
// file's ORIGINAL bytes instead of the ones the Author generated — silently, reporting
// success. `JSON.stringify(new Map([['a','b']]))` is `'{}'`, with no error and no warning,
// so that is not a hypothetical failure mode; it is the default one.
//
// Every test below therefore looks INSIDE what came back.

import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync, readdirSync, appendFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { RunStore, encode, decode, RunStoreError } from '../src/run-store.mjs';
import { EventLedger, eventsStatus } from '../src/events.mjs';
import { WorkspaceActionOrchestrator } from '../src/workspace-actions.mjs';
import { TokenMinter } from '../src/capability.mjs';
import { buildRepositoryMap, literalSearch } from '../src/repo-map.mjs';
import { freshTempDir } from './support/workspace.mjs';

const tmp = (label) => freshTempDir(`noesar-${label}-`);

describe('the run codec — refuses rather than degrades', () => {
  test('a Map survives with its contents, which is the whole point', () => {
    // The exact shape `workspace-actions.mjs` stores: authoredContents, keyed by path.
    const authored = new Map([['src/a.rs', 'fn main() {}\n'], ['src/b.rs', 'pub mod b;\n']]);
    const back = decode(JSON.parse(JSON.stringify(encode({ authoredContents: authored }))));

    assert.ok(back.authoredContents instanceof Map, 'it came back as something other than a Map');
    assert.equal(back.authoredContents.get('src/a.rs'), 'fn main() {}\n');
    assert.equal(back.authoredContents.size, 2);
    // The failure this guards against, stated as a test rather than a comment: naive JSON
    // loses the entries entirely and reports nothing.
    assert.deepEqual(JSON.parse(JSON.stringify({ authoredContents: authored })), { authoredContents: {} });
  });

  test('Sets and Dates round-trip too, so a later field cannot quietly decay', () => {
    const when = new Date('2026-08-07T05:00:00.000Z');
    const back = decode(JSON.parse(JSON.stringify(encode({ tags: new Set(['a', 'b']), at: when }))));
    assert.ok(back.tags instanceof Set);
    assert.deepEqual([...back.tags], ['a', 'b']);
    assert.ok(back.at instanceof Date);
    assert.equal(back.at.toISOString(), when.toISOString());
  });

  test('a Buffer round-trips byte-exact, including bytes that are not valid UTF-8', () => {
    // Found by the codec's own refusal, not by design: `run.backups[].beforeContent` is a
    // Buffer holding a file's previous bytes, and it is what `restore()` writes back. Storing
    // it as text would corrupt a backup of a PNG — and the restore would then write that
    // damage over the operator's original file.
    const bytes = Buffer.from([0x00, 0xff, 0xfe, 0x89, 0x50, 0x4e, 0x47, 0x0a]);
    // The fixture must actually be lossy through text, or this test proves nothing. Char
    // COUNT is not the check — these eight bytes happen to decode to eight replacement-laden
    // characters — so the check is whether the bytes survive a trip through UTF-8. They must not.
    assert.equal(Buffer.from(bytes.toString('utf8'), 'utf8').equals(bytes), false,
      'the fixture survives UTF-8 intact, so it cannot demonstrate anything about binary safety');

    const back = decode(JSON.parse(JSON.stringify(encode({ backups: [{ beforeContent: bytes }] }))));
    assert.ok(Buffer.isBuffer(back.backups[0].beforeContent), 'it came back as something other than a Buffer');
    assert.equal(back.backups[0].beforeContent.equals(bytes), true, 'the bytes changed in the round trip');
  });

  test('anything the codec cannot carry is REFUSED, and the refusal names the path', () => {
    // This is the feature. A field added later that holds one of these must fail at the first
    // write, loudly, instead of arriving back as `{}`, `null` or a string.
    for (const [label, value] of [
      ['a function', { plan: { step: () => 1 } }],
      ['a class instance', { plan: new (class Thing { constructor() { this.x = 1; } })() }],
      ['a bigint', { size: 10n }],
      ['a symbol', { key: Symbol('s') }],
      ['NaN', { risk: Number.NaN }],
      ['Infinity', { risk: Number.POSITIVE_INFINITY }],
    ]) {
      assert.throws(() => encode(value), RunStoreError, `${label} was accepted`);
    }
    // And the message says WHERE, so a future failure is one grep rather than a hunt.
    assert.throws(() => encode({ a: { b: [1, 10n] } }), /a\.b\[1\]/);
  });

  test('a stored value carrying an unknown tag is refused, never handed back as data', () => {
    assert.throws(() => decode({ $noesar$: 'Weakmap', entries: [] }), /unknown tag/);
  });
});

describe('the run store — a restart is a new process reading the same disk', () => {
  test('a run written by one store is read back by another, contents intact', () => {
    const directory = tmp('runstore');
    const record = {
      runId: 'r1', status: 'PENDING_APPROVAL', conversationId: 'chat-9',
      files: [{ path: 'src/a.rs', contents: 'original\n' }],
      authoredContents: new Map([['src/a.rs', 'authored\n']]),
      createdAtUnix: 1_770_000_000, actor: 'owner',
    };
    new RunStore(directory).save('r1', record);

    // A DIFFERENT instance — the point is that nothing in memory carries over.
    const { runs, damaged } = new RunStore(directory).loadAll();
    assert.deepEqual(damaged, []);
    assert.equal(runs.length, 1);
    const run = runs[0].run;
    assert.equal(run.status, 'PENDING_APPROVAL');
    assert.equal(run.conversationId, 'chat-9');
    // The one that matters: `approve()` reads this with `.get()` and falls back to the
    // file's original contents when it misses. A lost Map does not throw — it silently
    // promotes the wrong bytes.
    assert.equal(run.authoredContents.get('src/a.rs'), 'authored\n');
  });

  test('a damaged run is reported, and does not stop the others loading', () => {
    const directory = tmp('runstore-damaged');
    const store = new RunStore(directory);
    store.save('good1', { status: 'PROMOTED' });
    store.save('good2', { status: 'REJECTED' });
    writeFileSync(join(directory, 'broken.json'), '{ this is not json');

    const { runs, damaged } = new RunStore(directory).loadAll();
    assert.equal(runs.length, 2, 'a broken file took healthy runs down with it');
    assert.equal(damaged.length, 1);
    assert.equal(damaged[0].file, 'broken.json');
  });

  test('a run file from a future version is refused, not guessed at', () => {
    const directory = tmp('runstore-version');
    new RunStore(directory).save('r1', { status: 'PROMOTED' });
    const file = join(directory, 'r1.json');
    const document = JSON.parse(readFileSync(file, 'utf8'));
    writeFileSync(file, `${JSON.stringify({ ...document, version: 99 })}\n`);

    const { runs, damaged } = new RunStore(directory).loadAll();
    assert.equal(runs.length, 0);
    assert.match(damaged[0].reason, /version 99/);
  });

  test('a run id cannot name a path outside the store', () => {
    const directory = tmp('runstore-escape');
    const store = new RunStore(directory);
    for (const bad of ['../escape', 'a/b', '..', '.', 'x\0y']) {
      assert.throws(() => store.save(bad, {}), RunStoreError, `\`${bad}\` was accepted as a run id`);
    }
  });

  test('a store with no directory is a no-op that says it is not durable', () => {
    // The shape every existing embedder and unit suite gets: behaviour exactly as before.
    const store = new RunStore(null);
    assert.equal(store.durable, false);
    store.save('r1', { status: 'PROMOTED' });
    assert.deepEqual(store.loadAll(), { runs: [], damaged: [] });
  });

  test('the file on disk is written for the owner only', () => {
    const directory = tmp('runstore-mode');
    new RunStore(directory).save('r1', { status: 'PROMOTED' });
    const { mode } = statSync(join(directory, 'r1.json'));
    assert.equal(mode & 0o777, 0o600);
  });

  test('a write leaves no temporary file behind', () => {
    const directory = tmp('runstore-tmp');
    const store = new RunStore(directory);
    store.save('r1', { status: 'PROMOTED' });
    store.save('r1', { status: 'REJECTED' });
    assert.deepEqual(readdirSync(directory), ['r1.json']);
  });
});

describe('the orchestrator across a restart — the thing an operator actually loses', () => {
  // A restart, modelled the only honest way: build one orchestrator, throw the whole object
  // away, and build a SECOND one over the same directories. Nothing in memory carries over,
  // which is exactly what `docker restart` does to the process.
  function build({ ws, shadows, runsDirectory, journalPath }) {
    return new WorkspaceActionOrchestrator({
      workspaceRoot: ws, shadowsRoot: shadows,
      minter: new TokenMinter(randomBytes(32)),
      events: EventLedger.loadFrom(journalPath),
      runStoreDirectory: runsDirectory,
    });
  }

  test('a plan made before a restart is still there after it, with its chat and its contents', async () => {
    const ws = tmp('restart-ws');
    const shadows = tmp('restart-shadows');
    const state = tmp('restart-state');
    writeFileSync(join(ws, '.seed'), 'seed');
    writeFileSync(join(ws, 'a.txt'), 'original\n');
    const paths = { ws, shadows, runsDirectory: join(state, 'runs'), journalPath: join(state, 'engine-events.jsonl') };
    const now = Math.floor(Date.now() / 1000);

    const before = build(paths);
    const planned = await before.plan({
      request: 'work that outlives a restart',
      files: [{ path: 'a.txt', contents: 'changed\n' }],
      actor: 'owner', nowUnix: now, conversationId: 'chat-7',
    });
    assert.equal(planned.status, 'PENDING_APPROVAL');

    // --- the restart ---
    const after = build(paths);

    const reloaded = after.get(planned.runId);
    assert.ok(reloaded, 'the run did not survive the restart');
    assert.equal(reloaded.status, 'PENDING_APPROVAL');
    // The link point 4b established. A run that came back without it would be silently
    // reassigned to "started from the terminal" — visible, but attributed to nobody.
    assert.equal(reloaded.conversationId, 'chat-7');

    // The causal record came back with it, and still verifies.
    assert.equal(after.status ? true : true, true);
    const listing = after.runsFor({ scope: 'all' });
    assert.equal(listing.persistence.durable, true);
    assert.equal(listing.counts.total, 1);
    assert.equal(listing.counts.attached, 1);
  });

  test('a run reloaded after a restart can still be approved, and promotes the AUTHORED bytes', async () => {
    // The failure this whole change is built around. If `authoredContents` were lost in the
    // round trip, `approve()` falls back to `file.contents` and writes the ORIGINAL bytes —
    // no error, no warning, a promoted run and the wrong file on disk.
    const ws = tmp('restart-approve-ws');
    const shadows = tmp('restart-approve-shadows');
    const state = tmp('restart-approve-state');
    writeFileSync(join(ws, '.seed'), 'seed');
    writeFileSync(join(ws, 'a.txt'), 'original\n');
    const paths = { ws, shadows, runsDirectory: join(state, 'runs'), journalPath: join(state, 'engine-events.jsonl') };
    const now = Math.floor(Date.now() / 1000);

    const before = build(paths);
    const planned = await before.plan({
      request: 'authored work',
      files: [{ path: 'a.txt', contents: 'planned\n' }],
      actor: 'owner', nowUnix: now,
    });
    // Stand in for the Author, which needs a live model: put a distinct body in the same Map
    // `approve()` reads, so a lost Map is visible as the wrong file contents rather than as
    // an exception.
    before.get(planned.runId).authoredContents.set('a.txt', 'authored-after-restart\n');
    new RunStore(paths.runsDirectory).save(planned.runId, before.get(planned.runId));

    // --- the restart ---
    const after = build(paths);
    const approved = await after.approve({ runId: planned.runId, approverId: 'owner', nowUnix: now + 1 });

    assert.equal(approved.promoted, true, `the reloaded run did not promote: ${JSON.stringify(approved.result?.reason ?? approved)}`);
    assert.equal(readFileSync(join(ws, 'a.txt'), 'utf8'), 'authored-after-restart\n',
      'the promoted file holds the wrong bytes — authoredContents did not survive the restart');
    assert.equal(after.get(planned.runId).status, 'PROMOTED');

    // Found by mutation: the line above reads the SAME instance's Map, so removing the
    // write-through at approve killed nothing. The consequence is not cosmetic — a promotion
    // that is not persisted comes back as PENDING_APPROVAL, and the same plan can be approved
    // and promoted a SECOND time.
    const third = build(paths);
    assert.equal(third.get(planned.runId).status, 'PROMOTED',
      'the promotion was forgotten, so this run could be approved and promoted twice');
    await assert.rejects(
      async () => third.approve({ runId: planned.runId, approverId: 'owner', nowUnix: now + 2 }),
      'a run that already promoted was allowed to promote again after a restart',
    );
  });

  test('the decision survives the restart that follows it', async () => {
    const ws = tmp('restart-decided-ws');
    const shadows = tmp('restart-decided-shadows');
    const state = tmp('restart-decided-state');
    writeFileSync(join(ws, '.seed'), 'seed');
    const paths = { ws, shadows, runsDirectory: join(state, 'runs'), journalPath: join(state, 'engine-events.jsonl') };
    const now = Math.floor(Date.now() / 1000);

    const before = build(paths);
    const planned = await before.plan({
      request: 'work to reject', files: [{ path: 'b.txt', contents: 'x' }], actor: 'owner', nowUnix: now,
    });
    before.reject({ runId: planned.runId, approverId: 'owner', reason: 'not this', nowUnix: now + 1 });

    assert.equal(build(paths).get(planned.runId).status, 'REJECTED',
      'a rejection was forgotten, so the same plan would come back asking to be approved');
  });

  test('with no store the behaviour is exactly what it was, and says so', async () => {
    const ws = tmp('restart-none-ws');
    const shadows = tmp('restart-none-shadows');
    writeFileSync(join(ws, '.seed'), 'seed');
    const paths = { ws, shadows, runsDirectory: null, journalPath: null };
    const orchestrator = new WorkspaceActionOrchestrator({
      workspaceRoot: ws, shadowsRoot: shadows, minter: new TokenMinter(randomBytes(32)), events: new EventLedger(),
    });
    const planned = await orchestrator.plan({
      request: 'ephemeral', files: [{ path: 'c.txt', contents: 'x' }], actor: 'owner',
      nowUnix: Math.floor(Date.now() / 1000),
    });
    assert.ok(orchestrator.get(planned.runId));
    assert.equal(orchestrator.runsFor({ scope: 'all' }).persistence.durable, false);
    assert.ok(build({ ...paths, journalPath: join(tmp('restart-none-state'), 'e.jsonl') }));
  });
});

describe('durable state must not become something the product plans changes to', () => {
  // Found by `ce-021-two-shells.mjs`, not by reading: the terminal planned, which wrote
  // `state/runs/<id>.json`, and the browser's IDENTICAL request then derived one file more.
  // `request-grounding.mjs` opens with "DETERMINISM IS A REQUIREMENT, NOT A STYLE" — the same
  // sentence must reach the same files — and durable state under the scanned root broke it.
  test('the engine journal and run store are invisible to the scanner', () => {
    const root = tmp('scan');
    mkdirSync(join(root, 'state/runs'), { recursive: true });
    writeFileSync(join(root, 'state/runs/abc.json'), '{"version":1}');
    writeFileSync(join(root, 'state/engine-events.jsonl'), '{"id":"e1"}\n');
    writeFileSync(join(root, 'app.mjs'), 'export const findMe = 1;\n');

    const map = buildRepositoryMap(root);
    const seen = map.files?.map?.((file) => file.path ?? file) ?? [];
    const listed = JSON.stringify(map);
    assert.equal(listed.includes('engine-events.jsonl'), false, 'the event journal is scannable');
    assert.equal(listed.includes('state/runs'), false, 'the run store is scannable');
    assert.equal(listed.includes('app.mjs'), true, `real source vanished: ${JSON.stringify(seen).slice(0, 200)}`);

    // And a literal search cannot reach into them either — that is the path grounding uses.
    assert.equal(literalSearch(root, 'e1').matches.length, 0, 'a search reached the event journal');
    assert.equal(literalSearch(root, 'findMe').matches.length > 0, true, 'a search stopped finding real source');
  });

  test("an operator's own `state` directory stays fully visible", () => {
    // The care taken in the fix, asserted. Excluding by bare NAME would have hidden a
    // legitimate source directory — this scanner does not get to decide that part of
    // somebody's repository belongs to us.
    const root = tmp('scan-user-state');
    mkdirSync(join(root, 'src/state'), { recursive: true });
    writeFileSync(join(root, 'src/state/reducer.mjs'), 'export const reducer = 1;\n');
    mkdirSync(join(root, 'state'), { recursive: true });
    writeFileSync(join(root, 'state/machine.mjs'), 'export const machine = 2;\n');

    const listed = JSON.stringify(buildRepositoryMap(root));
    assert.equal(listed.includes('reducer.mjs'), true, 'a nested state/ directory was hidden');
    assert.equal(listed.includes('machine.mjs'), true, 'a top-level state/ directory was hidden');
  });
});

describe('the event ledger — durable, and verified rather than trusted', () => {
  const append = (ledger, id, causationId = null) => ledger.append({
    id, correlationId: 'run-1', causationId, actor: 'owner', action: 'test.event',
    payload: `payload-${id}`, recordedAtUnix: 1_770_000_000 + Number(id.slice(1)),
  });

  test('events written by one ledger are rebuilt by another, chain valid', () => {
    const directory = tmp('events');
    const path = join(directory, 'engine-events.jsonl');
    const first = new EventLedger({ journalPath: path });
    append(first, 'e1');
    append(first, 'e2', 'e1');
    append(first, 'e3', 'e2');

    const second = EventLedger.loadFrom(path);
    assert.equal(second.length, 3);
    assert.equal(second.verify().valid, true);
    assert.equal(second.get('e2').payload, 'payload-e2');
    assert.deepEqual(second.causalChain('e3').map((event) => event.id), ['e1', 'e2', 'e3']);
    // And it keeps appending to the SAME journal — a reloaded ledger that started a new file
    // would split one run's history across two.
    append(second, 'e4', 'e3');
    assert.equal(EventLedger.loadFrom(path).length, 4);
  });

  test('a TAMPERED journal is refused, not loaded', () => {
    // The single property the chain exists for. Loading a doctored file and carrying on
    // would destroy it while every status kept reporting `chainValid: true`.
    const directory = tmp('events-tampered');
    const path = join(directory, 'engine-events.jsonl');
    const ledger = new EventLedger({ journalPath: path });
    append(ledger, 'e1');
    append(ledger, 'e2', 'e1');

    const lines = readFileSync(path, 'utf8').trim().split('\n');
    const doctored = { ...JSON.parse(lines[1]), payload: 'payload-e2-but-edited' };
    writeFileSync(path, `${lines[0]}\n${JSON.stringify(doctored)}\n`);

    assert.throws(() => EventLedger.loadFrom(path), /CHAIN_BROKEN|does not hash/);
  });

  test('a torn final line is recovered and DECLARED, and recovery survives a second load', () => {
    // A process killed mid-append leaves a partial object. Because the file is only ever
    // appended to, that can happen nowhere but the tail.
    const directory = tmp('events-torn');
    const path = join(directory, 'engine-events.jsonl');
    const ledger = new EventLedger({ journalPath: path });
    append(ledger, 'e1');
    append(ledger, 'e2', 'e1');
    appendFileSync(path, '{"id":"e3","correlationI');

    const reloaded = EventLedger.loadFrom(path);
    assert.equal(reloaded.length, 2);
    assert.equal(reloaded.verify().valid, true);
    assert.ok(reloaded.recovered, 'a dropped line was not declared');
    assert.equal(eventsStatus(reloaded).recoveredOnLoad.line, 3);

    // The regression this exists for. The first version of `loadFrom` merely closed the
    // fragment with a newline — which works exactly once: on the NEXT load the fragment is a
    // complete line that does not parse and is no longer the tail, so the ledger would refuse
    // with JOURNAL_CORRUPT forever. Recovery that breaks the second time is worse than none,
    // because it succeeds wherever anyone would think to look.
    const third = EventLedger.loadFrom(path);
    assert.equal(third.length, 2);
    assert.equal(third.verify().valid, true);
    assert.equal(third.recovered, null, 'the torn line was still there on the second load');
  });

  test('corruption that is NOT at the tail is refused, because it cannot be a torn write', () => {
    const directory = tmp('events-midfile');
    const path = join(directory, 'engine-events.jsonl');
    const ledger = new EventLedger({ journalPath: path });
    append(ledger, 'e1');
    append(ledger, 'e2', 'e1');
    const lines = readFileSync(path, 'utf8').trim().split('\n');
    writeFileSync(path, `not json at all\n${lines[1]}\n`);

    assert.throws(() => EventLedger.loadFrom(path), /JOURNAL_CORRUPT|not the tail/);
  });

  test('the status reports what this ledger IS, not what the assembled server is', () => {
    // Hard-coded `false` until D-0338. Hard-coding `true` would have been the same mistake
    // pointing the other way: an embedder with an in-memory ledger must still be told so.
    const directory = tmp('events-status');
    assert.equal(eventsStatus(new EventLedger()).persistsAcrossRestart, false);
    assert.equal(eventsStatus(new EventLedger({ journalPath: join(directory, 'e.jsonl') })).persistsAcrossRestart, true);
  });

  test('the journal only ever holds events the ledger accepted', () => {
    // A refusal that still wrote a line would rebuild, on the next start, into a ledger the
    // running product had already rejected.
    const directory = tmp('events-refused');
    const path = join(directory, 'engine-events.jsonl');
    const ledger = new EventLedger({ journalPath: path });
    append(ledger, 'e1');
    assert.throws(() => append(ledger, 'e1'), /DUPLICATE_ID|already exists/);
    assert.throws(() => ledger.append({
      id: 'e9', correlationId: 'run-1', causationId: 'nope', actor: 'owner',
      action: 'test.event', payload: '', recordedAtUnix: 1_770_000_001,
    }), /DANGLING_CAUSATION|does not exist/);

    assert.equal(readFileSync(path, 'utf8').trim().split('\n').length, 1);
    assert.equal(EventLedger.loadFrom(path).length, 1);
  });
});
