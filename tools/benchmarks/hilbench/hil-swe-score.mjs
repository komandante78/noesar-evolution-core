// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Scores a HiL-Bench SWE run the way hil-sql-score.mjs scores the SQL half, which is the way their
// hil_bench/utils/compute_hil_metrics.py does: GLOBAL precision/recall/Ask-F1 over all questions and
// blockers, not a mean of per-task F1. What differs from the SQL half is where things are, not how
// they count (see run-swe-task.sh):
//   - their judge writes ask_human_metrics.json straight into the task directory;
//   - their verifier writes verifier/reward.json only when there is a patch to grade; the runner writes
//     verifier/stdout.txt either way, and no patch is resolved 0, with its reason;
//   - the conditions are deployment.yaml (context window, history, docker args) and, in arm B1, the
//     commit in noesar.json.
//
// Its own checks, each one a refusal to print a number:
//   - per task, the F1 recomputed here must equal the F1 their ask-human server wrote;
//   - every task of a run must carry the same conditions: a run that mixes them measures the mix;
//   - in arm B1, the first questions their server logged must be NOESAR's, in NOESAR's order, since
//     the split below reads them by position.
//
// Counted beside the number, never folded into it: a patch the verifier did not grade, the agent's
// exit status (exit_context is the window running out), and every answer their judge could not give
// ("can't answer", degraded in ask.jsonl). The SQL scorer does not count the last one; measured
// 17/09/2026, it happened 8 times per arm there.
//
// usage: node hil-swe-score.mjs <runs/RUN>
import { existsSync, readdirSync, readFileSync } from 'node:fs';

const [dir] = process.argv.slice(2);
const f1 = (p, r) => (p + r > 0 ? (2 * p * r) / (p + r) : 0);
const read = (p) => readFileSync(p, 'utf8');
const tasks = readdirSync(dir).filter((d) => /^swe_\d+$/.test(d)).sort((a, b) => a.slice(4) - b.slice(4));

let questions = 0, present = 0, discovered = 0, resolved = 0, graded = 0, noPatch = 0, verifierFailures = 0;
let noesarQuestions = 0, noesarDiscovered = 0, degradedTasks = 0, judgeDegraded = 0;
const exits = {};
const conditions = new Set();
for (const task of tasks) {
  const t = `${dir}/${task}`;
  if (!existsSync(`${t}/verifier/stdout.txt`) || !existsSync(`${t}/ask_human_metrics.json`)) {
    console.log(`${task}: NOT GRADED`);
    continue;
  }
  const log = JSON.parse(read(`${t}/ask_human_metrics.json`));
  const q = log.questions.length;
  const d = new Set(log.questions.map((e) => e.blocker_name).filter((n) => n !== null)).size;
  const mine = f1(q ? d / q : 0, log.n_blockers ? d / log.n_blockers : 0);
  if (Math.abs(mine - log.f1) > 1e-9) throw new Error(`${task}: recomputed F1 ${mine} != server F1 ${log.f1}`);

  const noesar = existsSync(`${t}/noesar.json`) ? JSON.parse(read(`${t}/noesar.json`)) : null;
  conditions.add(JSON.stringify({ arm: noesar ? 'B1' : 'B0', commit: noesar?.commit ?? null, deployment: read(`${t}/deployment.yaml`) }));
  let split = '';
  if (noesar) {
    noesar.asked.forEach((a, i) => {
      if (log.questions[i]?.question !== a.question) throw new Error(`${task}: server question ${i} is not NOESAR's question ${i}`);
    });
    const nd = new Set(log.questions.slice(0, noesar.asked.length).map((e) => e.blocker_name).filter((n) => n !== null)).size;
    noesarQuestions += noesar.asked.length;
    noesarDiscovered += nd;
    if (noesar.degradations.length) degradedTasks++;
    split = ` noesar=${nd}/${noesar.asked.length}${noesar.degradations.length ? ' DEGRADED' : ''}`;
  }

  const patch = existsSync(`${t}/agent.patch`);
  const reward = existsSync(`${t}/verifier/reward.json`) ? JSON.parse(read(`${t}/verifier/reward.json`)) : null;
  if (!patch) noPatch++;
  else if (!reward) verifierFailures++;
  const statuses = `${t}/agent/run_batch_exit_statuses.yaml`;
  const exit = existsSync(statuses) ? (read(statuses).match(/^ {4}(\S.*):$/m)?.[1] ?? 'unknown') : 'none';
  exits[exit] = (exits[exit] ?? 0) + 1;
  const jd = existsSync(`${t}/ask.jsonl`) ? read(`${t}/ask.jsonl`).split('\n').filter(Boolean).filter((l) => JSON.parse(l).degraded).length : 0;
  judgeDegraded += jd;

  const r = reward?.resolved ?? 0;
  questions += q; present += log.n_blockers; discovered += d; resolved += r; graded++;
  const tests = reward ? ` f2p=${reward.fail_to_pass_passed}/${reward.fail_to_pass_total}` : patch ? ' VERIFIER FAILED' : ' no patch';
  console.log(`${task}: questions=${q} discovered=${d}/${log.n_blockers} f1=${mine.toFixed(4)} resolved=${r}${tests} exit=${exit}${jd ? ` judgeDegraded=${jd}` : ''}${split}`);
}
if (conditions.size > 1) throw new Error(`${dir} mixes ${conditions.size} sets of conditions:\n${[...conditions].join('\n')}`);

const precision = questions ? discovered / questions : 0;
const recall = present ? discovered / present : 0;
console.log(JSON.stringify({
  tasks: tasks.length, graded, resolved, questions, blockersPresent: present, blockersDiscovered: discovered, precision, recall, askF1: f1(precision, recall),
  noesarQuestions, noesarDiscovered, degradedTasks, judgeDegraded, noPatch, verifierFailures, exits,
  conditions: conditions.size ? JSON.parse([...conditions][0]) : null,
}, null, 2));
