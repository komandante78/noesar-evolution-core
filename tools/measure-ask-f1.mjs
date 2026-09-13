// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The judge that turns the ceiling into a score, and the oracle that decides whether the
// judge is allowed to.
//
// # The conflict, stated first
//
// `measure-ask-judgment.mjs` reports a CEILING because deciding whether a named ambiguity
// ADDRESSES a blocker is a judgement about meaning, and a tool supplying that judgement would
// be grading the provider against its own reading. This file supplies exactly that judgement,
// so it inherits the conflict in its sharpest form: the model doing the judging belongs to the
// same installation as the provider being judged. A number produced this way is worth nothing
// unless the judge's own error rate is measured and published beside it. So it is.
//
// # The oracle, which cost nothing because it was already in the dataset
//
// Every HiL-Bench blocker carries its own `example_questions` — the questions its human
// authors wrote as correct ways to ask about it. That is a labelled set this project did not
// make and cannot tilt:
//
//   POSITIVE  a blocker's OWN example question, against its own task's blocker list. The
//             judge must return that blocker's number.
//   NEGATIVE  the same question against a DIFFERENT task's blocker list, where by
//             construction nothing matches. The judge must return NONE.
//
// Calibration runs FIRST and gates the measurement: a judge that cannot recognise a blocker
// from the blocker's own question has no business ruling on ours. JUDGE_FLOOR is declared
// here and is not a knob to turn when the number disappoints.
//
// # What the judge is asked, and why it is asked that way
//
// It is never told the flagged text came from this project, so it cannot be lenient towards
// it: it sees a review note and a numbered list. It must answer with a number AND a quote from
// that item, because a judge that can assert without quoting will. And it is told outright
// that being about the same file or feature is not enough — that lenient reading is the one
// that would inflate every score here.
//
// Usage — one command, from a container that shares the runtime's network:
//   docker run --rm --network container:noesar-evolution \
//     -v /mnt/cachec/NOESAR_EVOLUTION:/repo -v /mnt/cachec/BENCH_SWE:/bench \
//     -e NOESAR_HILBENCH_DATA=/bench/hilbench-data/hil-bench.json \
//     node:22-bookworm-slim node /repo/tools/measure-ask-f1.mjs
//
//   --selfcheck   the parser's own oracle, no model needed
//   --calibrate   calibration only, and its verdict
//   --pairs N     calibration size (default 15)
//   --type swe|sql, --json

import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { ReferenceReasoningProvider } from '../services/reference-control-plane/src/reasoning.mjs';
import { openAiChatGenerator } from '../services/reference-control-plane/src/author.mjs';

const DATA = process.env.NOESAR_HILBENCH_DATA
  ?? '/mnt/cachec/BENCH_SWE/hilbench-data/hil-bench.json';
const JUDGE_ENDPOINT = process.env.NOESAR_JUDGE_ENDPOINT ?? 'http://127.0.0.1:8420';

// Declared, not tuned. A judge below either of these is not a measuring instrument.
const JUDGE_FLOOR = Object.freeze({ positive: 0.7, negative: 0.9 });

function judgePrompt(flagged, blockers) {
  const numbered = blockers
    .map((blocker, index) => `  ${index + 1}. ${String(blocker.description ?? '').trim()}`)
    .join('\n\n');
  return [
    'A task description was reviewed. The review flagged this as unclear:',
    '',
    `  "${flagged}"`,
    '',
    'Below are the pieces of information the task genuinely fails to specify, numbered.',
    '',
    numbered,
    '',
    'Which numbered item, if any, is the flagged text pointing at?',
    'Answer on ONE line, in exactly one of these two forms:',
    '  MATCH <number> | <a short quote from that item>',
    '  NONE',
    '',
    'Answer NONE unless the flagged text points at that specific missing piece of',
    'information. Being about the same file, the same function or the same feature is NOT',
    'enough. If you cannot quote the part of the item it points at, the answer is NONE.',
  ].join('\n');
}

// A verdict the parser cannot read is NONE, never a silent match: an unreadable answer is the
// judge failing to answer, and a failure must not score.
//
// The `|` the prompt asks for is OPTIONAL here, and that is not laxity — it is a bug this
// parser had. Measured on the first calibration against the live runtime: the judge scored
// 0/5 on positives while having answered every one of them CORRECTLY, as `MATCH 1 <quote>`
// with the separator dropped. A parser that rejects right answers manufactures a zero, which
// is the most expensive kind of wrong number because it looks like a finding. What is still
// enforced is the part that carries meaning: a bare `MATCH 2` with nothing after it is NOT a
// match, because a judge that may assert without quoting will assert.
function parseVerdict(text, blockerCount) {
  const line = String(text ?? '').trim().split('\n').map((part) => part.trim()).find(Boolean) ?? '';
  const hit = /^MATCH\s+(\d+)\s*\|?\s*(.*)$/i.exec(line);
  if (!hit || !hit[2].trim()) return { matched: null, raw: line.slice(0, 160) };
  const index = Number(hit[1]);
  if (!Number.isInteger(index) || index < 1 || index > blockerCount) {
    return { matched: null, raw: line.slice(0, 160) };
  }
  return { matched: index - 1, raw: line.slice(0, 160) };
}

function makeJudge() {
  const generate = openAiChatGenerator({
    endpoint: JUDGE_ENDPOINT,
    model: process.env.NOESAR_JUDGE_MODEL || null,
    // A judge that answers differently to the same pair twice cannot be calibrated. Zero, and
    // not a setting.
    temperature: 0,
    maxTokens: 120,
  });
  return async (flagged, blockers) => parseVerdict(
    await generate({ prompt: judgePrompt(flagged, blockers) }),
    blockers.length,
  );
}

const cleanQuestion = (raw) => String(raw ?? '').replace(/^[-*\s]+/, '').trim();
const withBlockers = (tasks) => tasks.filter(
  (task) => Array.isArray(task.blocker_registry) && task.blocker_registry.length > 0,
);

async function calibrate(tasks, pairs) {
  const judge = makeJudge();
  const usable = withBlockers(tasks);
  let posDone = 0; let posOk = 0; let negDone = 0; let negOk = 0;
  const failures = [];

  for (let i = 0; i < usable.length && posDone < pairs; i += 1) {
    const task = usable[i];
    const blockers = task.blocker_registry;
    const target = blockers.findIndex((blocker) => (blocker.example_questions ?? []).length > 0);
    if (target === -1) continue;
    const question = cleanQuestion(blockers[target].example_questions[0]);

    const positive = await judge(question, blockers);
    posDone += 1;
    if (positive.matched === target) posOk += 1;
    else failures.push(`POSITIVO ${task.task_id}: atteso ${target + 1}, avuto ${positive.raw || 'NONE'}`);

    // A DIFFERENT task's list, so by construction nothing in it is the right answer.
    const other = usable[(i + Math.floor(usable.length / 2)) % usable.length];
    if (other.task_id === task.task_id) continue;
    const negative = await judge(question, other.blocker_registry);
    negDone += 1;
    if (negative.matched === null) negOk += 1;
    else failures.push(`NEGATIVO ${task.task_id} vs ${other.task_id}: atteso NONE, avuto ${negative.raw}`);
  }

  const positiveRate = posDone > 0 ? posOk / posDone : 0;
  const negativeRate = negDone > 0 ? negOk / negDone : 0;
  return {
    positives: posDone, positiveHits: posOk, positiveRate,
    negatives: negDone, negativeHits: negOk, negativeRate,
    passes: positiveRate >= JUDGE_FLOOR.positive && negativeRate >= JUDGE_FLOOR.negative,
    failures: failures.slice(0, 8),
  };
}

async function judgeRun(tasks) {
  const provider = new ReferenceReasoningProvider('/workspace');
  const judge = makeJudge();
  const rows = [];
  for (const task of withBlockers(tasks)) {
    const problem = String(task.problem ?? '').trim();
    if (!problem) continue;
    let named;
    try {
      named = provider.interpret(problem, []).ambiguities;
    } catch { continue; }
    // A blocker counts once however many notes point at it: recall asks how many blockers were
    // found, not how many times each was named.
    const found = new Set();
    const verdicts = [];
    for (const ambiguity of named) {
      const verdict = await judge(ambiguity, task.blocker_registry);
      verdicts.push({ ambiguity, verdict: verdict.raw });
      if (verdict.matched !== null) found.add(verdict.matched);
    }
    rows.push({
      id: task.task_id, type: task.task_type,
      blockers: task.blocker_registry.length, named: named.length, hits: found.size, verdicts,
    });
  }
  const sum = (pick) => rows.reduce((total, row) => total + pick(row), 0);
  const named = sum((row) => row.named);
  const blockers = sum((row) => row.blockers);
  const hits = sum((row) => row.hits);
  const precision = named > 0 ? hits / named : 0;
  const recall = blockers > 0 ? hits / blockers : 0;
  return {
    tasks: rows.length, blockers, named, hits, precision, recall,
    askF1: precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0,
    silentTasks: rows.filter((row) => row.named === 0).length,
    rows,
  };
}

function selfcheck() {
  // The parser is the part that can silently inflate a score, so it carries its own oracle.
  assert.equal(parseVerdict('MATCH 2 | the exact timeout value', 4).matched, 1);
  assert.equal(parseVerdict('NONE', 4).matched, null);
  assert.equal(parseVerdict('match 3 | lowercase still counts', 4).matched, 2);
  // The live runtime drops the separator and quotes anyway. Rejecting that answer scored a
  // correct judge 0/5 on the first calibration; the case is kept so it cannot come back.
  assert.equal(parseVerdict('MATCH 1 The implementation constructs a minimal env', 4).matched, 0);
  assert.equal(parseVerdict('MATCH 9 | out of range', 4).matched, null, 'out of range is not a match');
  assert.equal(parseVerdict('MATCH 0 | zero is not an index', 4).matched, null);
  assert.equal(parseVerdict('MATCH 2', 4).matched, null, 'a match with no quote is not a match');
  assert.equal(parseVerdict('', 4).matched, null, 'an empty answer is not a match');
  assert.equal(parseVerdict('I think it is probably item 2', 4).matched, null, 'prose is not a verdict');
  // The judge must never be told whose note it is holding.
  const prompt = judgePrompt('x', [{ description: 'y' }]);
  assert.ok(!/NOESAR|provider|interpret|ambiguit/i.test(prompt), 'the judge must not be told whose note it is');
  // The floor is a constant of this file, not something a run can move.
  assert.ok(Object.isFrozen(JUDGE_FLOOR));
  console.log('selfcheck: ok');
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--selfcheck')) return selfcheck();

  const raw = readFileSync(DATA);
  const digest = createHash('sha256').update(raw).digest('hex').slice(0, 16);
  let tasks = JSON.parse(raw.toString('utf8'));
  const typeAt = args.indexOf('--type');
  const only = typeAt === -1 ? null : args[typeAt + 1];
  if (only) tasks = tasks.filter((task) => task.task_type === only);
  const pairsAt = args.indexOf('--pairs');
  const pairs = pairsAt === -1 ? 15 : Number(args[pairsAt + 1]);

  console.log(`dataset     ${DATA}`);
  console.log(`            sha256:${digest}  ${tasks.length} task (${only ?? 'all'})`);
  console.log(`giudice     ${JUDGE_ENDPOINT}  temperature=0`);
  console.log('');
  console.log(`== CALIBRAZIONE (${pairs} coppie) — il giudice si prova prima di giudicare ==`);
  const cal = await calibrate(tasks, pairs);
  console.log(`  positivi  ${cal.positiveHits}/${cal.positives}  = ${cal.positiveRate.toFixed(3)}  (soglia ${JUDGE_FLOOR.positive})`);
  console.log(`  negativi  ${cal.negativeHits}/${cal.negatives}  = ${cal.negativeRate.toFixed(3)}  (soglia ${JUDGE_FLOOR.negative})`);
  for (const failure of cal.failures) console.log(`    ! ${failure}`);
  console.log(`  esito     ${cal.passes ? 'PASSA' : 'NON PASSA'}`);
  console.log('');

  if (!cal.passes) {
    console.log('Il giudice non ha superato il proprio oracolo, quindi NON misura.');
    console.log('Un punteggio prodotto da un giudice non calibrato non e un punteggio.');
    process.exitCode = 3;
    return;
  }
  if (args.includes('--calibrate')) return;

  const result = await judgeRun(tasks);
  const report = {
    at: new Date().toISOString(),
    dataset: { path: DATA, sha256Prefix: digest, tasks: result.tasks, type: only ?? 'all' },
    provider: 'ReferenceReasoningProvider (no model)',
    judge: { endpoint: JUDGE_ENDPOINT, ...cal, rows: undefined },
    askF1: result.askF1, precision: result.precision, recall: result.recall,
    blockers: result.blockers, named: result.named, hits: result.hits,
  };
  if (args.includes('--json')) {
    console.log(JSON.stringify({ ...report, rows: result.rows }, null, 2));
    return;
  }
  console.log('== MISURA ==');
  console.log(`  task            ${result.tasks}`);
  console.log(`  blocchi umani   ${result.blockers}`);
  console.log(`  nominate        ${result.named}`);
  console.log(`  riconosciute    ${result.hits}   (dal giudice, non da noi)`);
  console.log('');
  console.log(`  precision       ${result.precision.toFixed(4)}`);
  console.log(`  recall          ${result.recall.toFixed(4)}`);
  console.log(`  ASK-F1          ${result.askF1.toFixed(4)}`);
  console.log('');
  console.log(`Il giudice sbaglia ${((1 - cal.positiveRate) * 100).toFixed(0)}% dei positivi e`);
  console.log(`${((1 - cal.negativeRate) * 100).toFixed(0)}% dei negativi sul proprio oracolo: il numero sopra porta quell'errore dentro.`);
}

await main();
