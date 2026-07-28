// SPDX-License-Identifier: AGPL-3.0-or-later
//
// CE-023: "Con ATOM la copertura di proiezione è **misurata**, non asserita."
//
// Runs the same tasks twice — once with every surface on the reference provider, once with
// the configured external provider — and reports the coverage of each, per task and in total.
//
// # What coverage means here, stated so the number cannot be read as something it is not
//
// A plan step is **covered** when the expectation names one of its files among the paths the
// diff must touch, or one of its commands among the tests. Coverage is `covered / total`.
// It is computed by *this* file from the plan and the expectation, identically for both
// providers — neither provider reports its own score. A provider that refuses to produce an
// expectation scores **0 of n**, not "no data": refusing to project a plan is a real answer
// about that plan, and hiding it would flatter whichever provider refuses more often.
//
// # What it does not measure
//
// Whether the expectation is *right*. Coverage says how much of the plan could be contradicted
// by the outcome, not whether the prediction is a good one. A provider that named every path
// and every command indiscriminately would score 1.0 and be useless. Read it next to the
// `decompose` shape, never alone.
//
// Usage:
//   node tools/measure-projection-coverage.mjs            # the built-in task set
//   node tools/measure-projection-coverage.mjs tasks.json # {"tasks":[{id,request,files,commands,destructive}]}

import { readFileSync } from 'node:fs';
import { ReasoningRouter } from '../services/reference-control-plane/src/reasoning-router.mjs';
import { ReasoningRefused } from '../services/reference-control-plane/src/reasoning.mjs';
import { ReasoningUnavailable } from '../services/reference-control-plane/src/atom-client.mjs';

/** Deliberately mixed: one clean case, and several the providers are known to treat differently. */
const BUILT_IN = [
  { id: 'T1', request: 'Repair src/parser.rs', files: ['src/parser.rs'], commands: ['cargo test'] },
  { id: 'T2', request: 'Repair src/parser.rs and docs/readme.md', files: ['src/parser.rs', 'docs/readme.md'], commands: ['cargo test'] },
  { id: 'T3', request: 'Tidy the handlers etc, as needed', files: ['src/a.rs', 'src/b.rs', 'src/c.rs', 'src/d.rs', 'src/e.rs'], commands: ['cargo test', 'cargo build'] },
  { id: 'T4', request: 'Build the release', files: ['src/a.rs'], commands: ['cargo build'] },
  { id: 'T5', request: 'Remove the stale cache file', files: ['cache/stale.bin'], commands: [], destructive: true },
  { id: 'T6', request: 'Update the docs', files: ['docs/a.md', 'docs/b.md'], commands: [] },
  // The cases the first run could not see. Every task above names a file on every step, and
  // both providers put step files in the paths the diff must touch, so coverage was 1.00 for
  // both by construction. A step with no file is where the providers can disagree.
  { id: 'T7', request: 'Build it', files: [], commands: ['cargo build'] },
  { id: 'T8', request: 'Run the tests', files: [], commands: ['cargo test'] },
  { id: 'T9', request: 'Do the thing', files: [], commands: [] },
];

function coverageOf(plan, expectation) {
  const steps = plan.steps ?? [];
  const covered = steps.filter((step) => (
    (step.files ?? []).some((path) => expectation.pathsTheDiffMustTouch.includes(path))
    || (step.commands ?? []).some((command) => expectation.testsExpectedToPass.includes(command)
      || expectation.testsExpectedToFail.includes(command))
  )).length;
  return { covered, total: steps.length };
}

async function runTask(router, task) {
  const files = task.files ?? [];
  const commands = task.commands ?? [];
  const plan = router.buildPlan([{
    id: 'step-1',
    description: task.request,
    files,
    commands,
    dependsOn: [],
    blastRadius: router.blastRadius(files, Boolean(task.destructive)),
  }], [], 'safe');

  // Decomposition is where the two providers differ most, and the plan that gets projected is
  // the decomposed one: measuring the undecomposed plan would hide the difference being
  // measured.
  let projected = plan;
  let parts = 1;
  try {
    const decomposition = await router.decompose(plan.steps[0]);
    if (decomposition.split && decomposition.steps.length >= 2) {
      projected = router.buildPlan(decomposition.steps, [], 'safe');
      parts = decomposition.steps.length;
    }
  } catch (error) {
    if (error instanceof ReasoningUnavailable) throw error;
    if (!(error instanceof ReasoningRefused)) throw error;
  }

  try {
    const expectation = await router.expect(projected);
    const { covered, total } = coverageOf(projected, expectation);
    return { parts, covered, total, refused: null };
  } catch (error) {
    if (error instanceof ReasoningUnavailable) throw error;
    if (error instanceof ReasoningRefused) {
      // Zero of n, not "no data".
      return { parts, covered: 0, total: (projected.steps ?? []).length, refused: error.reason };
    }
    throw error;
  }
}

async function measure(env, tasks, label) {
  const rows = [];
  for (const task of tasks) {
    const router = new ReasoningRouter({ env });
    const result = await runTask(router, task);
    rows.push({ id: task.id, label, ...result, providers: router.provenance() });
  }
  return rows;
}

const argument = process.argv[2];
const tasks = argument ? JSON.parse(readFileSync(argument, 'utf8')).tasks : BUILT_IN;

const withoutEnv = { ...process.env, NOESAR_REASONING_MODE: 'reference-node' };
const withEnv = process.env;

const routing = new ReasoningRouter({ env: withEnv }).routing;
if (routing.externalSurfaces.length === 0) {
  console.error('no external provider is selected in this environment; the delta would be zero by construction');
  console.error(`mode=${routing.mode} endpoint=${routing.endpoint ?? 'none'}`);
  process.exit(2);
}

const without = await measure(withoutEnv, tasks, 'reference');
const withAtom = await measure(withEnv, tasks, 'external');

console.log(`routed surfaces: ${JSON.stringify(routing.externalSurfaces)}  endpoint: ${routing.endpoint}`);
console.log('');
console.log('task  reference(parts cov/total)   external(parts cov/total)   delta');
let refCovered = 0; let refTotal = 0; let extCovered = 0; let extTotal = 0;
for (let index = 0; index < tasks.length; index += 1) {
  const a = without[index];
  const b = withAtom[index];
  refCovered += a.covered; refTotal += a.total;
  extCovered += b.covered; extTotal += b.total;
  const ratio = (row) => (row.total === 0 ? '—' : (row.covered / row.total).toFixed(2));
  const delta = (a.total === 0 || b.total === 0) ? '—'
    : ((b.covered / b.total) - (a.covered / a.total)).toFixed(2);
  console.log(
    `${a.id.padEnd(5)} ${String(a.parts).padStart(3)}  ${a.covered}/${a.total} = ${ratio(a)}`.padEnd(34)
    + `${String(b.parts).padStart(3)}  ${b.covered}/${b.total} = ${ratio(b)}`.padEnd(28)
    + `${delta}`,
  );
}
console.log('');
console.log(`totals  reference ${refCovered}/${refTotal}   external ${extCovered}/${extTotal}`);
console.log(`COVERAGE_REFERENCE=${(refCovered / refTotal).toFixed(4)}`);
console.log(`COVERAGE_EXTERNAL=${(extCovered / extTotal).toFixed(4)}`);
console.log(`COVERAGE_DELTA=${((extCovered / extTotal) - (refCovered / refTotal)).toFixed(4)}`);
// The aggregate divides by the number of steps, and the providers do not produce the same
// number of steps. A total that moves only because one provider split a task further is a
// denominator artefact, not better coverage, and it is the reading this block exists to stop.
const perTask = tasks.map((_, index) => {
  const a = without[index]; const b = withAtom[index];
  if (a.total === 0 || b.total === 0) return null;
  return (b.covered / b.total) - (a.covered / a.total);
}).filter((value) => value !== null);
const better = perTask.filter((value) => value > 1e-9).length;
const worse = perTask.filter((value) => value < -1e-9).length;
const same = perTask.length - better - worse;
const partsDiffer = tasks.some((_, index) => without[index].parts !== withAtom[index].parts);

console.log('');
console.log(`PER_TASK better=${better} worse=${worse} equal=${same} of ${perTask.length}`);
if (better === 0 && worse === 0) {
  console.log('VERDICT=NO_DIFFERENCE  coverage does not distinguish these providers on this task set.');
  if (partsDiffer && Math.abs((extCovered / extTotal) - (refCovered / refTotal)) > 1e-9) {
    console.log('WARNING the totals differ anyway, because the two providers produce a different');
    console.log('        number of steps: that moves the denominator, and is NOT better coverage.');
    console.log('        Read PER_TASK. The aggregate is unsafe when the part counts disagree.');
  }
} else {
  console.log(`VERDICT=DIFFERS  ${better} task(s) better, ${worse} worse under the external provider.`);
}
console.log('');
console.log('Coverage is how much of the plan the expectation could be contradicted by, not');
console.log('whether the prediction is a good one. A provider naming everything scores 1.00');
console.log('and is useless: read this next to the part counts, never alone.');
