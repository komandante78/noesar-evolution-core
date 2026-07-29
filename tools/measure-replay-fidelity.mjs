// SPDX-License-Identifier: AGPL-3.0-or-later
//
// `SESS-002`: does replaying a recorded session reproduce the same DECISIONS?
//
// # Why this instrument could not exist until now
//
// Replay needs a recorded session, and `fixtures` is the surface that hands one back. Until
// `D-0226`/`A-0020` the daemon built a non-recording provider for every request, so `fixtures`
// could only ever refuse and there was nothing to replay. This is the first measurement of the
// property the whole Session Proof rests on.
//
// # What is being measured, stated precisely
//
// **Not** that a model reproduces its output — it does not, and `11 · P1` explains why
// promising that would break on first inspection. What is replayed is the layer the product is
// responsible for: given what was recorded, does recomputing reach the same answer?
//
// `replay` on the daemon re-runs each recorded call against a FRESH provider and compares. A
// pack is `faithful` only when every recordable entry reproduced. Divergence is reported with
// its count rather than averaged away, and a rejected entry — one the contract would never have
// produced — is counted apart from one that reproduced differently, because they mean different
// things about whether the recording can be trusted at all.
//
// # Why the pack is posted back rather than diffed here
//
// The comparison belongs to the implementation that produced it: recomputing in this file would
// be a second implementation of the provider's own semantics, and two implementations of one
// rule stop agreeing. This tool drives the loop and reports; it never judges a decision itself.
//
// `/v1/replay` is deliberately reached by a direct fetch rather than through `AtomClient`: it is
// NOT one of the twelve frozen surfaces, it is an ATOM extension, and routing it through the
// contract client would dress it as part of a contract that does not have it.
//
// Usage (needs a reachable daemon):
//   NOESAR_RUST_REASONING_ENDPOINT=http://atomd:8410 \
//   NOESAR_RUST_REASONING_TOKEN=... \
//   node tools/measure-replay-fidelity.mjs [sessions]

import { ReasoningRouter } from '../services/reference-control-plane/src/reasoning-router.mjs';
import { ReasoningRefused } from '../services/reference-control-plane/src/reasoning.mjs';
import { ReasoningUnavailable } from '../services/reference-control-plane/src/atom-client.mjs';

const SESSIONS = Number(process.argv[2] ?? 8);
const ENDPOINT = String(process.env.NOESAR_RUST_REASONING_ENDPOINT ?? '').replace(/\/+$/, '');
const TOKEN = String(process.env.NOESAR_RUST_REASONING_TOKEN ?? '');
const ALL = 'interpret,hypothesize,plan,decompose,expect,constrain,classify,confidence,evidence,cancel,fixtures,simulate';

if (!ENDPOINT) {
  process.stdout.write('REPLAY_FIDELITY=UNAVAILABLE reason=no external provider configured\n');
  process.exit(2);
}

/** Distinct work per session, so a pass is not one lucky request repeated. */
function requestFor(n) {
  const subjects = [
    'Repair the failing parser test', 'Add a missing index to the sessions query',
    'Remove the dead branch in the auth gate', 'Rename the misleading flag in the scheduler',
    'Fix the off-by-one in the pagination helper', 'Tighten the timeout on the health probe',
    'Correct the timezone handling in the digest', 'Split the oversized migration runner',
  ];
  return subjects[n % subjects.length];
}

async function recordOne(sessionId, n) {
  const env = {
    NOESAR_REASONING_MODE: 'rust-external',
    NOESAR_RUST_REASONING_ENDPOINT: ENDPOINT,
    NOESAR_RUST_REASONING_TOKEN: TOKEN,
    NOESAR_EXTERNAL_SURFACES: ALL,
  };
  const router = new ReasoningRouter({ workspaceRoot: process.env.NOESAR_WORKSPACE ?? '/workspace', env, sessionId });
  const intent = await router.interpret(requestFor(n), ['use tabs']);
  const hypotheses = await router.hypothesize(intent, []);
  const plan = await router.plan(hypotheses, [], 'safe');
  // Surfaces that refuse for a reason about THIS plan are still recorded as failures and
  // replay must reproduce the refusal too — so they are attempted, not skipped.
  for (const call of [
    () => router.expect(plan), () => router.classify(plan),
    () => router.confidence(plan, []), () => router.constrain(plan, 'restrictive'),
    () => router.evidence(`session ${n} touched the parser`),
  ]) {
    try { await call(); } catch (error) { if (!(error instanceof ReasoningRefused)) throw error; }
  }
  return router.fixtures(sessionId);
}

async function replay(pack) {
  const response = await fetch(`${ENDPOINT}/v1/replay`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-atom-token': TOKEN },
    body: JSON.stringify({ pack }),
  });
  const envelope = await response.json();
  if (envelope?.ok !== true) {
    throw new ReasoningUnavailable(`replay refused: ${envelope?.error?.reason ?? 'no reason given'}`);
  }
  return envelope.value;
}

/**
 * Proves the instrument can FAIL, before it is allowed to report a pass.
 *
 * A replay report of 8/8 faithful is worth nothing from an instrument that has never been
 * shown to say anything else — and this project has already found a measurement that was
 * wrong three times. So a pack is tampered with on purpose and the replay must reject it or
 * report divergence. If it does not, no number from this run is reported at all.
 *
 * The RECORDED ANSWER is corrupted while the input is left alone: recomputing from the same
 * input must then disagree with what the pack claims. That is exactly the failure replay
 * exists to catch — a session whose record does not match its own decisions.
 */
async function proveOracleCatchesTampering() {
  const pack = await recordOne(`oracle-check-${Date.now()}`, 0);
  const clean = await replay(pack);
  if (!clean.faithful) {
    return { ok: false, why: 'a clean pack did not reproduce, so the instrument is untrustworthy in both directions' };
  }
  const mutated = JSON.parse(JSON.stringify(pack));
  const before = mutated.entries[0];
  mutated.entries[0] = before
    .replace(/"goal":"[^"]*"/, '"goal":"TAMPERED"')
    .replace(/"rationale":"[^"]*"/, '"rationale":"TAMPERED"')
    .replace(/"statement":"[^"]*"/, '"statement":"TAMPERED"');
  if (mutated.entries[0] === before) {
    return { ok: false, why: 'no mutation could be applied, so nothing was actually attacked' };
  }
  let dirty;
  try {
    dirty = await replay(mutated);
  } catch {
    return { ok: true, why: 'a tampered pack was refused outright' };
  }
  return dirty.faithful === false
    ? { ok: true, why: `tampering caught, ${dirty.diverged} entry/entries diverged` }
    : { ok: false, why: 'a tampered pack still reported faithful' };
}

const oracle = await proveOracleCatchesTampering();
process.stdout.write(`ORACLE_PROVEN=${oracle.ok ? 'YES' : 'NO'}  (${oracle.why})\n\n`);
if (!oracle.ok) {
  process.stdout.write('VERDICT=INSTRUMENT_UNPROVEN\n');
  process.exit(2);
}

const rows = [];
let faithful = 0;
let totalEntries = 0;
let totalReproduced = 0;
let totalDiverged = 0;
let totalRejected = 0;

for (let n = 0; n < SESSIONS; n += 1) {
  const sessionId = `replay-bench-${Date.now()}-${n}`;
  try {
    const pack = await recordOne(sessionId, n);
    const report = await replay(pack);
    if (report.faithful) faithful += 1;
    totalEntries += report.total;
    totalReproduced += report.reproduced;
    totalDiverged += report.diverged;
    totalRejected += report.rejected.length;
    rows.push({ n, ...report });
    process.stdout.write(
      `${report.faithful ? 'FAITHFUL' : 'DIVERGED'}  session ${String(n).padStart(2)}  `
      + `entries=${String(report.total).padStart(2)} reproduced=${String(report.reproduced).padStart(2)} `
      + `diverged=${report.diverged} rejected=${report.rejected.length}`
      + (report.rejected.length ? `  <-- ${report.rejected[0].slice(0, 60)}` : '') + '\n',
    );
  } catch (error) {
    rows.push({ n, error: String(error.reason ?? error.message) });
    process.stdout.write(`ERROR     session ${String(n).padStart(2)}  ${String(error.reason ?? error.message).slice(0, 80)}\n`);
  }
}

// Sessions, not entries, is the headline: a pack with one diverged entry out of twenty is not
// four-fifths reproducible, it is a session whose decisions cannot be trusted to recompute.
// The entry counts are printed beside it for reading, never as the verdict.
process.stdout.write(`\nSESSIONS=${SESSIONS}\n`);
process.stdout.write(`FAITHFUL_SESSIONS=${faithful}/${rows.length}\n`);
process.stdout.write(`ENTRIES_TOTAL=${totalEntries} REPRODUCED=${totalReproduced} DIVERGED=${totalDiverged} REJECTED=${totalRejected}\n`);
const verdict = rows.length === 0 ? 'NO_DATA'
  : faithful === rows.length ? 'REPLAY_DETERMINISTIC_ON_DECISIONS'
    : 'REPLAY_NOT_FAITHFUL';
process.stdout.write(`VERDICT=${verdict}\n`);
process.exit(verdict === 'REPLAY_DETERMINISTIC_ON_DECISIONS' ? 0 : 1);
