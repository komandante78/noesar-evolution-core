// SPDX-License-Identifier: AGPL-3.0-or-later
//
// `CE-023`, second instrument: the SHAPE of the decomposition, not its coverage.
//
// # Why a second instrument exists
//
// `tools/measure-projection-coverage.mjs` reported `NO_DIFFERENCE` (`D-0215`), and the reason
// was the metric rather than the providers: coverage asks whether an expectation names a
// step's files, and every provider puts a step's files among the paths the diff must touch.
// It measured something both satisfied by construction. `D-0215` named the two ways forward —
// a metric on the shape, or tasks from a real repository. This does both.
//
// # How a verdict is reached, and who is allowed to reach it
//
// Both providers decompose the SAME original step. This file then recomputes, for every part
// that came back, whether that part can be checked on its own — using the criteria in
// `services/reference-control-plane/src/verifiability.mjs`, which live in the open core and
// belong to no provider. **No provider scores itself**, and neither provider's own splitter
// is consulted to judge the other's output.
//
// A provider that answers `split: false` is claiming the original step was already verifiable.
// That claim is judged, not accepted: the original step becomes the single part, and the same
// criteria apply. Otherwise "I did nothing" would be free of consequence.
//
// # The verdict is a boolean per task, on purpose
//
// `settled` — every part verifiable, so decomposing the output again yields nothing new — is
// what is compared. Ratios move when a provider returns more parts, which is a property of the
// denominator and not of the work; that is precisely how `+1.8%` appeared in `D-0215` and
// meant nothing. Counts are printed beside the verdict for reading, never as the verdict.
//
// Usage:
//   node tools/derive-tasks-from-history.mjs 60 > tasks.json
//   node tools/measure-decomposition-shape.mjs tasks.json

import { readFileSync } from 'node:fs';
import { ReasoningRouter, routingFrom } from '../services/reference-control-plane/src/reasoning-router.mjs';
import { ReasoningRefused } from '../services/reference-control-plane/src/reasoning.mjs';
import { ReasoningUnavailable } from '../services/reference-control-plane/src/atom-client.mjs';
import { judgeDecomposition, firstViolation } from '../services/reference-control-plane/src/verifiability.mjs';

const WORKSPACE = process.env.NOESAR_WORKSPACE ?? '/workspace';

const routing = routingFrom(process.env);
if (!routing.externalSurfaces.includes('decompose')) {
  // Refusing rather than reporting a null delta: "both sides were the same provider" and
  // "the two providers agreed" are different facts, and a run that cannot tell them apart
  // must not print a number that looks like the second.
  process.stderr.write('MEASURE=REFUSED reason=no external provider is routed for `decompose`; there would be one provider measured twice\n');
  process.exit(2);
}

const source = process.argv[2];
if (!source) {
  process.stderr.write('usage: measure-decomposition-shape.mjs tasks.json\n');
  process.exit(2);
}
const { tasks } = JSON.parse(readFileSync(source, 'utf8'));

function originalStep(task) {
  const files = task.files ?? [];
  return {
    id: 'step-1',
    description: task.request,
    files,
    commands: task.commands ?? [],
    dependsOn: [],
    blastRadius: {
      paths: files,
      reachesOutsideWorkspace: false,
      destructive: task.destructive === true,
    },
  };
}

async function decomposeWith(surfaces, step) {
  const env = surfaces === 'reference'
    ? {}
    : { ...process.env, NOESAR_EXTERNAL_SURFACES: 'decompose' };
  const router = new ReasoningRouter({ workspaceRoot: WORKSPACE, env });
  try {
    const answer = await router.decompose(step);
    // `split: false` is a claim that the input was already verifiable. Judged, not believed.
    const parts = answer?.split ? (answer.steps ?? []) : [step];
    return { ok: true, parts, split: answer?.split === true, provider: router.provenance().at(-1)?.provider };
  } catch (error) {
    if (error instanceof ReasoningRefused) return { ok: false, refused: error.reason, parts: [] };
    if (error instanceof ReasoningUnavailable) return { ok: false, unavailable: error.reason, parts: [] };
    throw error;
  }
}

const rows = [];
for (const task of tasks) {
  const step = originalStep(task);
  const inputViolation = firstViolation(step);
  const [reference, external] = await Promise.all([
    decomposeWith('reference', step),
    decomposeWith('external', step),
  ]);
  // A refusal scores as not settled — it is a real answer about this task, and hiding it
  // would flatter whichever provider refuses more often.
  const referenceVerdict = judgeDecomposition(reference.parts);
  const externalVerdict = judgeDecomposition(external.parts);
  rows.push({
    id: task.id,
    files: step.files.length,
    inputAlreadyVerifiable: inputViolation === null,
    inputViolation,
    reference: { ...referenceVerdict, split: reference.split, failure: reference.refused ?? reference.unavailable ?? null },
    external: { ...externalVerdict, split: external.split, failure: external.refused ?? external.unavailable ?? null, provider: external.provider },
  });
}

// Tasks whose input was already verifiable cannot distinguish anything: both providers
// correctly do nothing. Counted and reported, excluded from the comparison, and the exclusion
// is stated — an unstated exclusion is how a comparison flatters itself.
const decisive = rows.filter((row) => !row.inputAlreadyVerifiable);
const better = decisive.filter((row) => row.external.settled && !row.reference.settled).length;
const worse = decisive.filter((row) => !row.external.settled && row.reference.settled).length;
const equal = decisive.length - better - worse;

const line = (row) => [
  row.id.padEnd(10),
  String(row.files).padStart(3),
  (row.inputViolation ?? 'none').padEnd(30),
  `ref:${row.reference.settled ? 'SETTLED' : 'unsettled'}(${row.reference.parts}p,${row.reference.unverifiableParts}bad)`.padEnd(34),
  `ext:${row.external.settled ? 'SETTLED' : 'unsettled'}(${row.external.parts}p,${row.external.unverifiableParts}bad)`,
].join(' ');

process.stdout.write('TASK       FIL INPUT_VIOLATION                REFERENCE                          EXTERNAL\n');
for (const row of rows) process.stdout.write(`${line(row)}\n`);

const failures = rows.filter((row) => row.reference.failure || row.external.failure);
if (failures.length) {
  process.stdout.write(`\nFAILURES=${failures.length}\n`);
  for (const row of failures) {
    process.stdout.write(`  ${row.id} reference=${row.reference.failure ?? '-'} external=${row.external.failure ?? '-'}\n`);
  }
}

process.stdout.write(`\nTASKS_TOTAL=${rows.length}\n`);
process.stdout.write(`ALREADY_VERIFIABLE_EXCLUDED=${rows.length - decisive.length}\n`);
process.stdout.write(`DECISIVE=${decisive.length}\n`);
process.stdout.write(`REFERENCE_SETTLED=${decisive.filter((r) => r.reference.settled).length}/${decisive.length}\n`);
process.stdout.write(`EXTERNAL_SETTLED=${decisive.filter((r) => r.external.settled).length}/${decisive.length}\n`);
process.stdout.write(`PER_TASK better=${better} worse=${worse} equal=${equal} of ${decisive.length}\n`);
const verdict = better > 0 && worse === 0 ? 'EXTERNAL_STRICTLY_BETTER'
  : worse > 0 && better === 0 ? 'EXTERNAL_STRICTLY_WORSE'
    : better === 0 && worse === 0 ? 'NO_DIFFERENCE' : 'MIXED';
process.stdout.write(`VERDICT=${verdict}\n`);
