// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Scores a HiL-Bench SQL run exactly as their hil_bench/utils/compute_hil_metrics.py does:
// GLOBAL precision/recall/Ask-F1 over all questions and blockers, not a mean of per-task F1.
//
// Its own checks, each one a refusal to print a number:
//   - per task, the F1 recomputed here must equal the F1 their ask-human server wrote;
//   - every trajectory of a run must carry the same conditions (arm, commit, caps): a run that mixes
//     them measures the mix;
//   - in arm B1, the first questions their server logged must be NOESAR's, in NOESAR's order, since
//     the split below reads them by position.
//
// A task whose agent died before writing a trajectory still counts: its blockers stay in the
// denominator, because that failure is ours.
//
// Counted beside the number, never folded into it: the questions their judge could not answer
// (judgeDegraded). They stay in the score, as in theirs; measured 17/09/2026, 8 per arm on the
// full SQL runs, which the score printed until then without a word.
//
// usage: node hil-sql-score.mjs <runs/RUN>
import { existsSync, readdirSync, readFileSync } from 'node:fs';

const [dir] = process.argv.slice(2);
const f1 = (p, r) => (p + r > 0 ? (2 * p * r) / (p + r) : 0);
// Their judge's own words when it cannot answer; the same string their SWE tool prints.
const CANT_ANSWER = "can't answer (perhaps transient hiccup)";
const tasks = readdirSync(dir).filter((d) => /^sql_\d+$/.test(d)).sort((a, b) => a.slice(4) - b.slice(4));

let questions = 0, present = 0, discovered = 0, solved = 0, graded = 0;
let noesarQuestions = 0, noesarDiscovered = 0, degradedTasks = 0, failures = 0, noTrajectory = 0, judgeDegraded = 0;
const conditions = new Set();
for (const task of tasks) {
  const metricsPath = `${dir}/${task}/harbor_shared/ask_human_metrics.json`;
  const rewardPath = `${dir}/${task}/verifier/reward.json`;
  if (!existsSync(metricsPath) || !existsSync(rewardPath)) {
    console.log(`${task}: NOT GRADED`);
    continue;
  }
  const log = JSON.parse(readFileSync(metricsPath, 'utf8'));
  const reward = JSON.parse(readFileSync(rewardPath, 'utf8'));
  const q = log.questions.length;
  const d = new Set(log.questions.map((e) => e.blocker_name).filter((n) => n !== null)).size;
  const mine = f1(q ? d / q : 0, log.n_blockers ? d / log.n_blockers : 0);
  if (Math.abs(mine - log.f1) > 1e-9) throw new Error(`${task}: recomputed F1 ${mine} != server F1 ${log.f1}`);
  const jd = log.questions.filter((e) => e.response === CANT_ANSWER).length;
  judgeDegraded += jd;

  const trajectoryPath = `${dir}/${task}/trajectory.json`;
  const trajectory = existsSync(trajectoryPath) ? JSON.parse(readFileSync(trajectoryPath, 'utf8')) : null;
  let split = '';
  if (!trajectory) {
    noTrajectory++;
    split = ' NO TRAJECTORY';
  } else {
    conditions.add(JSON.stringify(trajectory.conditions));
    if (trajectory.failure) failures++;
    const asked = trajectory.noesar?.asked ?? [];
    asked.forEach((a, i) => {
      if (log.questions[i]?.question !== a.question) throw new Error(`${task}: server question ${i} is not NOESAR's question ${i}`);
    });
    const nd = new Set(log.questions.slice(0, asked.length).map((e) => e.blocker_name).filter((n) => n !== null)).size;
    noesarQuestions += asked.length;
    noesarDiscovered += nd;
    if (trajectory.noesar?.degradations.length) degradedTasks++;
    if (trajectory.noesar) split = ` noesar=${nd}/${asked.length}${trajectory.noesar.degradations.length ? ' DEGRADED' : ''}`;
    if (trajectory.failure) split += ` FAILURE: ${trajectory.failure.slice(0, 80)}`;
  }
  questions += q; present += log.n_blockers; discovered += d; solved += reward.solve; graded++;
  console.log(`${task}: questions=${q} discovered=${d}/${log.n_blockers} f1=${mine.toFixed(4)} solve=${reward.solve}${jd ? ` judgeDegraded=${jd}` : ''}${split}`);
}
if (conditions.size > 1) throw new Error(`${dir} mixes ${conditions.size} sets of conditions:\n${[...conditions].join('\n')}`);

const precision = questions ? discovered / questions : 0;
const recall = present ? discovered / present : 0;
console.log(JSON.stringify({
  tasks: tasks.length, graded, solved, questions, blockersPresent: present, blockersDiscovered: discovered, precision, recall, askF1: f1(precision, recall),
  noesarQuestions, noesarDiscovered, degradedTasks, judgeDegraded, failures, noTrajectory,
  conditions: conditions.size ? JSON.parse([...conditions][0]) : null,
}, null, 2));
