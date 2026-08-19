// SPDX-License-Identifier: AGPL-3.0-or-later
//
// `CE-014` — *«La query di ricerca è costruita dal motore; il codice dell'utente non compare mai
// nell'uscita»* (`MASTER_PROJECT/15_CODEN_EVOLUTION_DA_ZERO.md` §11, severity **C**),
// verification method *«canary nel workspace, ispezione di ogni richiesta uscente»*.
//
// # A canary is only evidence if it could plausibly have leaked
//
// So the workspace built below is not a token in an empty directory. It is a real tree —
// source, config, a lock file, a dotfile, a nested module — every file carrying a distinct
// canary, sitting under the same root the rest of the product reads from. If any egress path in
// the research pipeline consulted the workspace at all, one of them would show up.
//
// # "Every outgoing request" means every one, and there are THREE, not one
//
// The obvious one is the provider call. The two that get forgotten are the gate calls:
// `research.mjs` asks `gate.classify()` **before** anything leaves (intent) and **again** on what
// came back (content). A classifier is an outgoing request like any other — an installation can
// point it at a model — so all three are recorded and all three are inspected. Testing only the
// provider would have proven the smaller half and called it the criterion.
//
// # And the structural half, which is stronger than any canary
//
// `research.mjs` cannot read the workspace: it imports `randomUUID` and nothing else, and the
// scan below asserts that no filesystem module is imported and no file is read. A canary proves
// a leak did not happen on this run; the absence of a filesystem import proves there is no
// channel through which it could happen on any run.
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildQueryEcho, runResearchReport, ResearchReportStore, RefusalRegistry,
} from '../src/research.mjs';
import { freshTempDir } from './support/workspace.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const RESEARCH_SRC = resolve(HERE, '../src/research.mjs');

/** One canary per file, all sharing a prefix nothing else in this repository uses. */
const CANARIES = Object.freeze({
  'index.mjs': 'CE014CANARY-source-a1b2c3',
  'config/settings.json': 'CE014CANARY-config-d4e5f6',
  'package-lock.json': 'CE014CANARY-lockfile-708192',
  '.hidden-notes': 'CE014CANARY-dotfile-a3b4c5',
  'deep/nested/module.mjs': 'CE014CANARY-nested-d6e7f8',
});

function workspaceWithCanaries() {
  const root = freshTempDir('noesar-ce014-ws-');
  for (const [path, canary] of Object.entries(CANARIES)) {
    const absolute = join(root, path);
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, `// ${canary}\nexport const secret = '${canary}';\n`);
  }
  return root;
}

/** A provider answer that is valid enough to pass `validateReportPayload`. */
const PROVIDER_ANSWER = Object.freeze({
  candidates: [{
    name: 'A candidate',
    evidence: [{ kind: 'SOURCE_FACT', statement: 'it exists' }],
    evidenceQuality: { reviewCount: 3, timeSpanDays: 30 },
  }],
});

/**
 * Records **every** outgoing call the pipeline makes, in order, with what was sent. One
 * recorder for the gate and the executor, so "every outgoing request" is one list to inspect
 * rather than two lists somebody could forget to join.
 */
function recorder({ gateOutcome = 'PROCEED', providerAnswer = PROVIDER_ANSWER } = {}) {
  const sent = [];
  return {
    sent,
    gate: {
      classify: async (text) => {
        sent.push({ via: 'gate.classify', payload: text });
        return { outcome: gateOutcome, category: null };
      },
    },
    executor: {
      execute: async (tool, payload, options) => {
        sent.push({ via: 'executor.execute', payload, options, toolId: tool?.id ?? null });
        return { result: providerAnswer };
      },
    },
    /** Everything that left, as one string — what a network capture would have seen. */
    wire() { return JSON.stringify(sent); },
  };
}

const TOOL = Object.freeze({ id: 'research-tool', consent: Object.freeze({ granted: true }), disabled: false });
const ledger = () => ({ appended: [], append(entry) { this.appended.push(entry); } });

async function runWith(rec, overrides = {}) {
  return runResearchReport({
    objective: 'find a self-hosted vector database',
    criteria: ['open source', 'runs offline'],
    actorId: 'owner-001',
    gate: rec.gate, tools: [TOOL], executor: rec.executor, toolId: TOOL.id,
    ledger: ledger(), reportStore: new ResearchReportStore(), refusalRegistry: new RefusalRegistry(),
    nowMs: 1_800_000_000_000,
    ...overrides,
  });
}

describe('CE-014 — the engine builds the query, and the user\'s code never leaves', () => {

  // ── 1 · the structural half: there is no channel to leak through ──────────────────────────
  test('research.mjs imports no filesystem module and reads no file — the leak has no path', () => {
    const source = readFileSync(RESEARCH_SRC, 'utf8');
    const imports = [...source.matchAll(/^import\s+[^;]*?from\s+'([^']+)';/gm)].map((match) => match[1]);
    assert.deepEqual(imports, ['node:crypto'],
      `research.mjs now imports ${imports.join(', ')} — if one of those can reach the workspace, this criterion needs a new proof`);
    for (const forbidden of ['readFileSync', 'readFile(', 'createReadStream', 'readdirSync', 'process.cwd']) {
      assert.ok(!source.includes(forbidden), `research.mjs now calls ${forbidden}`);
    }
  });

  test('buildQueryEcho is a pure function of objective and criteria — the workspace cannot change it', () => {
    const root = workspaceWithCanaries();
    const before = buildQueryEcho('an objective', ['b', 'a']);
    // The same call, with a whole workspace of canaries sitting on disk under a real root.
    const after = buildQueryEcho('an objective', ['b', 'a']);
    assert.equal(before, after);
    assert.equal(before, JSON.stringify({ objective: 'an objective', criteria: ['a', 'b'] }));
    for (const canary of Object.values(CANARIES)) assert.ok(!before.includes(canary));
    // The root is real and readable, so "nothing leaked" is not "nothing was there".
    assert.ok(readFileSync(join(root, 'index.mjs'), 'utf8').includes(CANARIES['index.mjs']));
  });

  // ── 2 · the canary half: inspect every outgoing request of a real run ─────────────────────
  test('a full PROCEED run makes exactly three outgoing requests, and none carries a canary', async () => {
    const root = workspaceWithCanaries();
    const rec = recorder();
    const outcome = await runWith(rec);
    assert.equal(outcome.outcome, 'PROCEED');

    // Three, named: intent gate, provider, content gate — in that order.
    assert.deepEqual(rec.sent.map((entry) => entry.via),
      ['gate.classify', 'executor.execute', 'gate.classify']);

    const wire = rec.wire();
    for (const [path, canary] of Object.entries(CANARIES)) {
      assert.ok(!wire.includes(canary), `\`${canary}\` (from ${path}) appeared in an outgoing request`);
    }
    // And the canary really was reachable from disk during the run.
    assert.ok(readFileSync(join(root, 'config/settings.json'), 'utf8').includes(CANARIES['config/settings.json']));
  });

  test('the provider payload is EXACTLY objective + criteria — key for key, nothing else', async () => {
    const rec = recorder();
    await runWith(rec);
    const call = rec.sent.find((entry) => entry.via === 'executor.execute');
    assert.deepEqual(Object.keys(call.payload).sort(), ['criteria', 'objective']);
    assert.equal(call.payload.objective, 'find a self-hosted vector database');
    assert.deepEqual(call.payload.criteria, ['open source', 'runs offline']);
  });

  test('the intent gate is asked the echo and nothing but the echo', async () => {
    const rec = recorder();
    await runWith(rec);
    const intent = rec.sent[0];
    assert.equal(intent.via, 'gate.classify');
    assert.equal(intent.payload, buildQueryEcho('find a self-hosted vector database', ['open source', 'runs offline']));
  });

  test('the content gate is asked only what the PROVIDER returned — not the workspace, not the query', async () => {
    const rec = recorder();
    await runWith(rec);
    const content = rec.sent[2];
    assert.equal(content.via, 'gate.classify');
    assert.equal(content.payload, 'A candidate: it exists');
    for (const canary of Object.values(CANARIES)) assert.ok(!content.payload.includes(canary));
  });

  // ── 3 · the caller cannot smuggle anything in ─────────────────────────────────────────────
  test('extra fields a caller adds never reach the wire: the engine builds the request, not the caller', async () => {
    const rec = recorder();
    await runResearchReport({
      objective: 'legitimate objective',
      criteria: ['one'],
      actorId: 'owner-001',
      gate: rec.gate, tools: [TOOL], executor: rec.executor, toolId: TOOL.id,
      ledger: ledger(), reportStore: new ResearchReportStore(), refusalRegistry: new RefusalRegistry(),
      nowMs: 1_800_000_000_000,
      // Everything an attacking caller would try to attach to the request.
      workspaceContents: CANARIES['index.mjs'],
      context: [CANARIES['config/settings.json']],
      files: [{ path: 'index.mjs', contents: CANARIES['index.mjs'] }],
      attachments: CANARIES['deep/nested/module.mjs'],
    });

    const wire = rec.wire();
    for (const canary of Object.values(CANARIES)) {
      assert.ok(!wire.includes(canary), `a caller-supplied field carried \`${canary}\` onto the wire`);
    }
    const call = rec.sent.find((entry) => entry.via === 'executor.execute');
    assert.deepEqual(Object.keys(call.payload).sort(), ['criteria', 'objective']);
  });

  test('criteria are normalised by the engine — deduplicated, trimmed, capped — not passed through', async () => {
    const rec = recorder();
    await runWith(rec, { criteria: ['  a  ', 'a', '', 'b', ...Array.from({ length: 20 }, (_, n) => `c${n}`)] });
    const call = rec.sent.find((entry) => entry.via === 'executor.execute');
    assert.equal(call.payload.criteria.length, 12, 'MAX_CRITERIA must be enforced by the engine');
    assert.equal(call.payload.criteria[0], 'a');
    assert.equal(new Set(call.payload.criteria).size, call.payload.criteria.length, 'duplicates reached the wire');
    assert.ok(!call.payload.criteria.includes(''), 'an empty criterion reached the wire');
  });

  // ── 4 · a refusal emits nothing at all ────────────────────────────────────────────────────
  test('a REFUSE at the intent gate emits NO provider request — nothing leaves, not even the echo', async () => {
    const rec = recorder({ gateOutcome: 'REFUSE' });
    const outcome = await runWith(rec);
    assert.equal(outcome.outcome, 'REFUSE');
    assert.equal(outcome.stage, 'intent');
    assert.deepEqual(rec.sent.map((entry) => entry.via), ['gate.classify'],
      'a refused intent still reached the provider');
  });

  // Negative control: the pipeline really does emit something when it is supposed to, or the
  // canary tests above pass because nothing was ever sent.
  test('negative control · the objective the user typed DOES reach the provider, verbatim', async () => {
    const rec = recorder();
    await runWith(rec, { objective: 'a very specific objective string' });
    assert.ok(rec.wire().includes('a very specific objective string'),
      'nothing left at all, so "the canary did not leak" proves nothing');
  });
});
