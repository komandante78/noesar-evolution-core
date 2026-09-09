// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The first instrument in this repository that measures a provider against REALITY rather
// than against the other provider.
//
// # What is compared, and where the ground truth comes from
//
// `simulate` predicts what a plan would do to a shadow workspace, without executing it. This
// tool then **actually performs the writes** and reads the filesystem back. The truth is what
// the directory looks like afterwards — not what this tool expected, and not what any provider
// said. A path absent before and present after was CREATED; present before with different
// content is MODIFIED; present before with identical content is UNCHANGED.
//
// That last distinction is the point of the exercise. `simulate` decides between create and
// modify by whether the path exists, which is correct for existence and blind to content: a
// write that produces the bytes already there changes nothing, and a predictor that calls it
// "modify" has predicted an event that did not occur. The adversarial case is included
// deliberately rather than left out to keep the score clean.
//
// # Why the tool must not compute the expected answer itself
//
// Deciding in advance "this one should say create" and scoring against that would compare a
// provider's prediction to THIS FILE's prediction — a verdict supplied by the caller is not a
// verdict. So the expectation is never written down: the shadow is observed before, the writes
// are applied, the shadow is observed again, and the difference between the two observations
// IS the answer.
//
// # Exact equality, never similarity
//
// A prediction matches when the set of (action, path) pairs it names equals the set that
// actually happened. "Mostly right" is a judgement, and judgements are what recomputation
// exists to replace. False predictions (named, did not happen) and misses (happened, not
// named) are reported apart, because they fail in opposite directions.
//
// Usage (needs a reachable daemon and a shadow root BOTH can see):
//   NOESAR_RUST_REASONING_ENDPOINT=http://atomd:8410 NOESAR_RUST_REASONING_TOKEN=... \
//   NOESAR_SHADOWS_ROOT=/shadows node tools/measure-simulation-accuracy.mjs

import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, statSync, rmSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { ReasoningRouter } from '../services/reference-control-plane/src/reasoning-router.mjs';
import { ReasoningRefused } from '../services/reference-control-plane/src/reasoning.mjs';

const ENDPOINT = String(process.env.NOESAR_RUST_REASONING_ENDPOINT ?? '').replace(/\/+$/, '');
const TOKEN = String(process.env.NOESAR_RUST_REASONING_TOKEN ?? '');
const SHADOWS = String(process.env.NOESAR_SHADOWS_ROOT ?? '/shadows');

if (!ENDPOINT) {
  process.stdout.write('SIMULATION_ACCURACY=UNAVAILABLE reason=no external provider configured\n');
  process.exit(2);
}

/**
 * The cases. Each names the files that already exist in the shadow and the writes the plan
 * would perform. No case declares what the answer should be — that is measured, not asserted.
 */
const CASES = [
  { id: 'all-new', seed: {}, writes: { 'a.txt': 'one\n', 'b.txt': 'two\n' } },
  { id: 'all-existing', seed: { 'a.txt': 'old\n' }, writes: { 'a.txt': 'new\n' } },
  { id: 'mixed', seed: { 'keep.txt': 'here\n' }, writes: { 'keep.txt': 'changed\n', 'fresh.txt': 'added\n' } },
  { id: 'nested-new', seed: {}, writes: { 'deep/inner/x.txt': 'nested\n' } },
  { id: 'nested-existing', seed: { 'deep/inner/x.txt': 'before\n' }, writes: { 'deep/inner/x.txt': 'after\n' } },
  { id: 'many-paths', seed: { 'p1.txt': 'a\n', 'p2.txt': 'b\n' }, writes: { 'p1.txt': 'a2\n', 'p2.txt': 'b2\n', 'p3.txt': 'c\n' } },
  // Adversarial, and the reason this tool is worth running: the write produces exactly the
  // bytes already on disk. Nothing changes. A predictor keyed on existence must say "modify".
  { id: 'rewrite-identical-content', seed: { 'same.txt': 'identical\n' }, writes: { 'same.txt': 'identical\n' } },
];

const digestOf = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');

function observe(root) {
  const seen = new Map();
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else seen.set(relative(root, full), digestOf(full));
    }
  };
  if (existsSync(root)) walk(root);
  return seen;
}

/** The difference between two real observations. This is the ground truth. */
function actualEffect(before, after) {
  const effect = [];
  for (const [path, digest] of after) {
    if (!before.has(path)) effect.push({ action: 'create', path });
    else if (before.get(path) !== digest) effect.push({ action: 'modify', path });
    // present, unchanged bytes: nothing happened, so nothing is recorded
  }
  return effect;
}

/** `"modify existing.txt [step-1]"` -> `{ action:'modify', path:'existing.txt' }` */
function parsePrediction(entries) {
  const parsed = [];
  for (const line of entries ?? []) {
    const match = /^(\w+)\s+(.+?)(?:\s+\[[^\]]*\])?$/.exec(String(line).trim());
    if (match) parsed.push({ action: match[1].toLowerCase(), path: match[2] });
  }
  return parsed;
}

const key = (entry) => `${entry.action} ${entry.path}`;
const asSet = (entries) => new Set(entries.map(key));

function compareSets(predicted, actual) {
  const p = asSet(predicted);
  const a = asSet(actual);
  const falsePredictions = [...p].filter((k) => !a.has(k));
  const misses = [...a].filter((k) => !p.has(k));
  return { exact: falsePredictions.length === 0 && misses.length === 0, falsePredictions, misses };
}

async function runCase(testCase, index) {
  const root = join(SHADOWS, `simbench-${process.pid}-${index}`);
  rmSync(root, { recursive: true, force: true });
  mkdirSync(root, { recursive: true });
  for (const [path, body] of Object.entries(testCase.seed)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), body);
  }

  const router = new ReasoningRouter({
    workspaceRoot: root,
    env: {
      NOESAR_REASONING_MODE: 'rust-external',
      NOESAR_RUST_REASONING_ENDPOINT: ENDPOINT,
      NOESAR_RUST_REASONING_TOKEN: TOKEN,
      NOESAR_EXTERNAL_SURFACES: 'simulate',
    },
  });

  const paths = Object.keys(testCase.writes);
  const plan = router.buildPlan(
    paths.map((path, n) => ({
      id: `step-${n + 1}`, description: `write ${path}`, files: [path], commands: [], dependsOn: [],
      blastRadius: router.blastRadius([path], false),
    })),
    [], 'safe',
  );

  let predicted;
  try {
    const outcome = await router.simulate(plan, root);
    if (outcome.supported !== true) return { id: testCase.id, skipped: 'provider does not support simulation' };
    predicted = parsePrediction(outcome.predictedDiff);
  } catch (error) {
    if (error instanceof ReasoningRefused) return { id: testCase.id, refused: error.reason };
    throw error;
  }

  // Reality: observe, actually write, observe again.
  const before = observe(root);
  for (const [path, body] of Object.entries(testCase.writes)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), body);
  }
  const actual = actualEffect(before, observe(root));

  rmSync(root, { recursive: true, force: true });
  return { id: testCase.id, predicted, actual, ...compareSets(predicted, actual) };
}

// ---------------------------------------------------------------- the oracle, proven first
// A comparison that has never reported a mismatch has not been shown to be able to. The
// check corrupts a real prediction and requires the comparison to notice.
const oracleProbe = { predicted: [{ action: 'modify', path: 'x.txt' }], actual: [{ action: 'create', path: 'x.txt' }] };
const oracleResult = compareSets(oracleProbe.predicted, oracleProbe.actual);
const identityResult = compareSets(oracleProbe.actual, oracleProbe.actual);
const oracleOk = oracleResult.exact === false && identityResult.exact === true;
process.stdout.write(`ORACLE_PROVEN=${oracleOk ? 'YES' : 'NO'}  (a wrong action is a mismatch; an identical set is not)\n\n`);
if (!oracleOk) {
  process.stdout.write('VERDICT=INSTRUMENT_UNPROVEN\n');
  process.exit(2);
}

const results = [];
for (const [index, testCase] of CASES.entries()) {
  const result = await runCase(testCase, index);
  results.push(result);
  if (result.skipped || result.refused) {
    process.stdout.write(`SKIP     ${result.id.padEnd(28)} ${result.skipped ?? result.refused}\n`);
    continue;
  }
  const verdict = result.exact ? 'EXACT   ' : 'MISMATCH';
  const detail = result.exact
    ? `predicted ${result.predicted.length}, all of them happened`
    : `false=${JSON.stringify(result.falsePredictions)} missed=${JSON.stringify(result.misses)}`;
  process.stdout.write(`${verdict} ${result.id.padEnd(28)} ${detail}\n`);
}

const decided = results.filter((r) => !r.skipped && !r.refused);
const exact = decided.filter((r) => r.exact).length;
const falseTotal = decided.reduce((sum, r) => sum + r.falsePredictions.length, 0);
const missTotal = decided.reduce((sum, r) => sum + r.misses.length, 0);

process.stdout.write(`\nCASES=${CASES.length} DECIDED=${decided.length}\n`);
process.stdout.write(`EXACT_MATCH=${exact}/${decided.length}\n`);
process.stdout.write(`FALSE_PREDICTIONS=${falseTotal} MISSES=${missTotal}\n`);
// Reported apart on purpose: a predictor that names an event which never happened and one
// that misses an event that did are wrong in opposite directions, and only the second can
// let a change through unnoticed.

// Nothing decided is not a perfect score. `exact === decided.length` is 0 === 0 when every
// case skipped or was refused, so the run printed PREDICTION_EXACT_ON_EVERY_CASE and exited
// 0 — a green verdict, and a passing exit code, from a measurement that measured nothing.
// The same category is already guarded above for the oracle (VERDICT=INSTRUMENT_UNPROVEN,
// exit 2); this is its twin, and it exits the same way: the instrument ran, it just did not
// establish anything. Seen on 2026-09-09 with all 7 cases skipped.
if (decided.length === 0) {
  process.stdout.write('VERDICT=NO_CASES_DECIDED\n');
  process.exit(2);
}

process.stdout.write(`VERDICT=${exact === decided.length ? 'PREDICTION_EXACT_ON_EVERY_CASE' : 'PREDICTION_DIVERGES_FROM_REALITY'}\n`);
process.exit(exact === decided.length ? 0 : 1);
