// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The second instrument that measures a provider against a truth this project did not write,
// and the first whose truth comes from OUTSIDE the repository entirely.
//
// # What is measured
//
// The reasoning contract obliges every provider to return `ambiguities` from `interpret()`:
// the readings of a request it will not guess between. HiL-Bench (arXiv:2604.09408) publishes
// 200 coding tasks into which humans injected and validated 751 blockers — the pieces of
// information an agent CANNOT derive and must ask about. Those two lists are the same kind of
// thing, produced by people who have never heard of this project.
//
// So: feed each task's problem statement to `interpret()` and compare what it names against
// what the humans planted.
//
// # Why this tool refuses to compute an Ask-F1
//
// Deciding whether "`appropriate` does not name what is included" ADDRESSES the blocker
// "neither the problem statement nor the requirements specify the exact timeout value" is a
// judgement about meaning. A tool that made that call with a similarity score would be
// grading the provider against ITS OWN reading, which is the failure
// measure-simulation-accuracy.mjs was written to avoid: a verdict supplied by the caller is
// not a verdict.
//
// What CAN be computed with no judgement at all is the CEILING. A provider cannot have
// addressed more blockers than the number of things it named, so
//
//     hits <= min(named, blockers)
//
// holds for every task whatever the meanings turn out to be. The precision, recall and F1
// derived from that bound are therefore an upper limit the provider cannot exceed — and a
// ceiling that sits near zero is a finding no amount of matching can rescue. Where the
// ceiling is high, this tool says so and stops, because there the answer needs a reader.
//
// # Silence is the phenomenon, and it is counted apart
//
// HiL-Bench's result is that agents do not ask: they guess quietly. A task where the provider
// named NOTHING while humans found blockers is that failure exactly, needs no interpretation,
// and is reported on its own line.
//
// Usage:
//   NOESAR_HILBENCH_DATA=/mnt/cachec/BENCH_SWE/hilbench-data/hil-bench.json \
//   node tools/measure-ask-judgment.mjs [--json] [--type swe|sql]
//   node tools/measure-ask-judgment.mjs --selfcheck

import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { ReferenceReasoningProvider } from '../services/reference-control-plane/src/reasoning.mjs';

const DATA = process.env.NOESAR_HILBENCH_DATA
  ?? '/mnt/cachec/BENCH_SWE/hilbench-data/hil-bench.json';

// A task the harness cannot read is not a task that scored zero. The two are opposite kinds
// of fact and collapsing them would inflate the denominator with our own failures.
function scoreOne(provider, task) {
  const problem = String(task.problem ?? '').trim();
  const blockers = Array.isArray(task.blocker_registry) ? task.blocker_registry.length : 0;
  if (!problem) return { id: task.task_id, unreadable: 'the task carries no problem statement' };
  let named;
  try {
    named = provider.interpret(problem, []).ambiguities.length;
  } catch (error) {
    return { id: task.task_id, unreadable: `interpret refused: ${error.message}` };
  }
  return {
    id: task.task_id,
    type: task.task_type,
    blockers,
    named,
    // Exact, not estimated: whatever the meanings are, no more than this many can line up.
    hitsCeiling: Math.min(named, blockers),
    silent: named === 0 && blockers > 0,
  };
}

function aggregate(rows) {
  const scored = rows.filter((row) => !row.unreadable);
  const sum = (pick) => scored.reduce((total, row) => total + pick(row), 0);
  const blockers = sum((row) => row.blockers);
  const named = sum((row) => row.named);
  const hits = sum((row) => row.hitsCeiling);
  const precision = named > 0 ? hits / named : 0;
  const recall = blockers > 0 ? hits / blockers : 0;
  const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
  return {
    tasks: scored.length,
    unreadable: rows.length - scored.length,
    blockers,
    named,
    hitsCeiling: hits,
    silentTasks: scored.filter((row) => row.silent).length,
    precisionCeiling: precision,
    recallCeiling: recall,
    askF1Ceiling: f1,
  };
}

function selfcheck() {
  const provider = new ReferenceReasoningProvider('/workspace');
  // The oracle: a request carrying a term the provider is known to flag must not score the
  // same as one carrying none. A tool whose two ends agree on everything measures nothing.
  const flagged = provider.interpret('handle the appropriate cases', []).ambiguities.length;
  const plain = provider.interpret('rename the field to id', []).ambiguities.length;
  assert.ok(flagged > 0, 'a request containing a known vague term must name an ambiguity');
  assert.equal(plain, 0, 'a plain request must name none');

  // Silence with blockers present is the failure the aggregate has to surface, and the
  // ceiling has to be zero when nothing was named however many blockers exist.
  const rows = [
    scoreOne(provider, { task_id: 'a', task_type: 'swe', problem: 'rename the field to id', blocker_registry: [{}, {}] }),
    scoreOne(provider, { task_id: 'b', task_type: 'swe', problem: 'handle the appropriate cases', blocker_registry: [{}] }),
    scoreOne(provider, { task_id: 'c', task_type: 'swe', problem: '', blocker_registry: [{}] }),
  ];
  assert.equal(rows[0].silent, true, 'naming nothing where blockers exist is silence');
  assert.equal(rows[0].hitsCeiling, 0, 'nothing named can address nothing');
  assert.ok(rows[2].unreadable, 'an empty problem statement is unreadable, not a zero');

  const totals = aggregate(rows);
  assert.equal(totals.tasks, 2, 'an unreadable task is not counted among the scored');
  assert.equal(totals.unreadable, 1);
  assert.equal(totals.blockers, 3);
  assert.equal(totals.silentTasks, 1);
  // b named >=1 of 1 blocker, a named 0 of 2 -> ceiling recall is 1/3 exactly.
  assert.equal(totals.hitsCeiling, 1);
  assert.ok(Math.abs(totals.recallCeiling - 1 / 3) < 1e-12, 'the recall ceiling is exact, not rounded');

  // The bound itself: no task may ever report more hits than it named or than exist.
  for (const row of rows.filter((r) => !r.unreadable)) {
    assert.ok(row.hitsCeiling <= row.named && row.hitsCeiling <= row.blockers, 'the ceiling must bound');
  }
  console.log('selfcheck: ok');
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes('--selfcheck')) return selfcheck();

  const raw = readFileSync(DATA);
  const digest = createHash('sha256').update(raw).digest('hex').slice(0, 16);
  let tasks = JSON.parse(raw.toString('utf8'));
  const typeAt = args.indexOf('--type');
  const only = typeAt === -1 ? null : args[typeAt + 1];
  if (only) tasks = tasks.filter((task) => task.task_type === only);
  if (tasks.length === 0) throw new Error(`no task to measure in ${DATA}${only ? ` of type ${only}` : ''}`);

  const provider = new ReferenceReasoningProvider('/workspace');
  const rows = tasks.map((task) => scoreOne(provider, task));
  const totals = aggregate(rows);
  // The conditions travel with the number, or two runs of this tool are not comparable.
  const report = {
    at: new Date().toISOString(),
    dataset: { path: DATA, sha256Prefix: digest, tasks: tasks.length, type: only ?? 'all' },
    provider: 'ReferenceReasoningProvider (no model)',
    ...totals,
  };

  if (args.includes('--json')) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  console.log(`dataset            ${DATA}`);
  console.log(`                   sha256:${digest}  ${report.dataset.tasks} task (${report.dataset.type})`);
  console.log(`provider           ${report.provider}`);
  console.log('');
  console.log(`task misurati      ${totals.tasks}   (illeggibili: ${totals.unreadable})`);
  console.log(`blocchi umani      ${totals.blockers}`);
  console.log(`ambiguita nominate ${totals.named}`);
  console.log(`task muti          ${totals.silentTasks} su ${totals.tasks}  <- blocchi presenti, nulla nominato`);
  console.log('');
  console.log('SOFFITTO (limite superiore esatto, nessun accoppiamento di significato):');
  console.log(`  precision <=     ${totals.precisionCeiling.toFixed(4)}`);
  console.log(`  recall    <=     ${totals.recallCeiling.toFixed(4)}`);
  console.log(`  Ask-F1    <=     ${totals.askF1Ceiling.toFixed(4)}`);
  console.log('');
  console.log('NON coperto: se un\'ambiguita nominata corrisponda davvero a un blocco e un');
  console.log('giudizio sul significato, e questo strumento non lo fornisce. I numeri sopra');
  console.log('sono un tetto che il provider non puo superare, non il suo punteggio.');
}

main();
