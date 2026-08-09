// SPDX-License-Identifier: AGPL-3.0-or-later
//
// phi-4 against three public benchmarks, plus a contamination probe.
//
//   node run-bench.mjs [mmlu|mmlu-permuted|gsm8k|truthfulqa|all] [limit]
//
// # Why a permutation run exists beside the MMLU run
//
// phi-4 is trained heavily on synthetic textbook-like material, and MMLU ships its own
// `possibly_contaminated_urls.txt`. A score on a public benchmark, alone, cannot tell a model
// that reasons from a model that has seen the answer key — and reporting one without saying so
// is the thing this project's own vocabulary calls benchmark contamination.
//
// So MMLU is run twice over the SAME questions: once as published, and once with the four options
// deterministically permuted and the gold letter moved with them. A model that computes the
// answer is indifferent to which letter it sits behind. A model that remembers "the answer to
// this question is B" is not. The gap between the two runs is the measurement; either number on
// its own is not.
//
// Everything is greedy (temperature 0) and single-flight: the server has one slot, so concurrency
// would queue rather than parallelise and would only make the latency figures a lie.

import { readFileSync, writeFileSync, readdirSync, appendFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const DATA = join(here, 'data');
const OUT = join(here, 'results');
const ENDPOINT = process.env.BENCH_ENDPOINT ?? 'http://127.0.0.1:8420';
const SEED = 20260809;

// A small deterministic PRNG so the sample and the permutation are the same on every run — a
// benchmark whose sample moves between runs cannot be compared with itself.
function rng(seed) {
  let state = seed >>> 0;
  return () => { state = (state * 1664525 + 1013904223) >>> 0; return state / 4294967296; };
}
function shuffled(items, random) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

async function ask(messages, { maxTokens = 8 } = {}) {
  const started = Date.now();
  const response = await fetch(`${ENDPOINT}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'phi-4', messages, temperature: 0, max_tokens: maxTokens, stream: false }),
  });
  if (!response.ok) throw new Error(`model answered ${response.status}`);
  const body = await response.json();
  return {
    text: body?.choices?.[0]?.message?.content ?? '',
    ms: Date.now() - started,
    completionTokens: body?.usage?.completion_tokens ?? 0,
    promptTokens: body?.usage?.prompt_tokens ?? 0,
  };
}

// ——— MMLU ———————————————————————————————————————————————————————————————————————————
//
// The CSV is `question,A,B,C,D,gold`. Fields can contain commas and quotes, so it is parsed
// properly rather than split on commas — a naive split silently corrupts roughly one row in ten
// and would show up as the model being wrong.
/**
 * ONE CSV reader, over the whole file, honouring quotes across line breaks.
 *
 * The first version of this harness split on `\n` and parsed each line. Measured before trusting
 * a single number from it: 18 of the 57 MMLU subject files carry newlines inside quoted
 * questions, so the file has 18 500 "lines" and 14 042 real records. Splitting on `\n` feeds the
 * model truncated questions and drops the rest — and produces a plausible accuracy that is
 * simply not a measurement of anything. A benchmark harness gets the same scepticism as the
 * product it measures.
 */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') { cell += '"'; i += 1; }
      else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') { row.push(cell); cell = ''; }
    else if (char === '\n') { row.push(cell); if (row.some((value) => value.trim())) rows.push(row); row = []; cell = ''; }
    else if (char !== '\r') cell += char;
  }
  if (cell || row.length) { row.push(cell); if (row.some((value) => value.trim())) rows.push(row); }
  return rows;
}

function loadMmlu(perSubject) {
  const dir = join(DATA, 'data', 'test');
  const random = rng(SEED);
  const items = [];
  let skipped = 0;
  for (const file of readdirSync(dir).sort()) {
    if (!file.endsWith('_test.csv')) continue;
    const subject = file.replace(/_test\.csv$/, '');
    const rows = parseCsv(readFileSync(join(dir, file), 'utf8'));
    for (const cells of shuffled(rows, random).slice(0, perSubject)) {
      if (cells.length < 6 || !'ABCD'.includes(String(cells[5]).trim())) { skipped += 1; continue; }
      const [question, a, b, c, d, gold] = cells;
      items.push({ subject, question, options: [a, b, c, d], gold: gold.trim() });
    }
  }
  // Reported rather than swallowed: a sample quietly smaller than asked for is a measurement
  // quietly narrower than reported.
  if (skipped) process.stderr.write(`  mmlu: ${skipped} malformed rows skipped\n`);
  return items;
}

const LETTERS = ['A', 'B', 'C', 'D'];

function mmluPrompt(item, permute, random) {
  let options = item.options.map((text, index) => ({ text, gold: LETTERS[index] === item.gold }));
  if (permute) options = shuffled(options, random);
  const gold = LETTERS[options.findIndex((option) => option.gold)];
  const rendered = options.map((option, index) => `${LETTERS[index]}. ${option.text}`).join('\n');
  return {
    gold,
    messages: [
      { role: 'system', content: 'You answer multiple-choice questions. Reply with one letter: A, B, C or D. Nothing else.' },
      { role: 'user', content: `${item.question}\n${rendered}\nAnswer:` },
    ],
  };
}

/** The first standalone A-D in the reply. A model that says "The answer is C." is not wrong, and
 *  scoring it as wrong would measure instruction-following rather than knowledge. */
function readLetter(text) {
  const match = String(text).toUpperCase().match(/\b([ABCD])\b/);
  return match ? match[1] : null;
}

// ——— GSM8K ——————————————————————————————————————————————————————————————————————————
//
// Free-form arithmetic. The gold sits after `####`; the model is asked to end with `#### <number>`
// and the LAST number in the reply is taken if it does not. Commas and currency symbols are
// stripped from both sides, because `1,000` and `1000` are the same answer and a scorer that
// disagreed would be measuring formatting.
function loadGsm8k(limit) {
  const rows = readFileSync(join(DATA, 'gsm8k_test.jsonl'), 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line));
  return shuffled(rows, rng(SEED)).slice(0, limit);
}
function normaliseNumber(value) {
  const cleaned = String(value ?? '').replace(/[$,\s]/g, '').replace(/\.0+$/, '');
  return cleaned;
}
function goldOf(row) { return normaliseNumber(row.answer.split('####').pop()); }
function readNumber(text) {
  const marked = String(text).match(/####\s*(-?[\d,]+(?:\.\d+)?)/);
  if (marked) return normaliseNumber(marked[1]);
  const all = String(text).match(/-?[\d,]+(?:\.\d+)?/g);
  return all ? normaliseNumber(all[all.length - 1]) : null;
}

// ——— TruthfulQA (MC1-style) ——————————————————————————————————————————————————————————
//
// Built from the published CSV: the Best Answer against up to three Incorrect Answers, shuffled
// deterministically. Not the official MC1 target set, and labelled as such in the report — it is
// the same questions and the same distractors, scored the same way, but it is a construction and
// calling it "TruthfulQA MC1" without that note would be borrowing a number that is not this one.
function loadTruthfulQa(limit) {
  const text = readFileSync(join(DATA, 'truthfulqa.csv'), 'utf8');
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') { cell += '"'; i += 1; }
      else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') { row.push(cell); cell = ''; }
    else if (char === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else if (char !== '\r') cell += char;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const header = rows.shift().map((name) => name.trim());
  const at = (name) => header.indexOf(name);
  const random = rng(SEED);
  const items = [];
  for (const record of rows) {
    if (record.length < header.length) continue;
    const question = record[at('Question')];
    const best = record[at('Best Answer')];
    const wrong = String(record[at('Incorrect Answers')] ?? '').split(';').map((value) => value.trim()).filter(Boolean).slice(0, 3);
    if (!question || !best || wrong.length < 3) continue;
    const options = shuffled([{ text: best, gold: true }, ...wrong.map((text) => ({ text, gold: false }))], random);
    items.push({ question, options, gold: LETTERS[options.findIndex((option) => option.gold)] });
  }
  return items.slice(0, limit);
}

// ——— the runner ——————————————————————————————————————————————————————————————————————
function report(name, correct, total, latencies, extra = {}) {
  const sorted = [...latencies].sort((a, b) => a - b);
  const line = {
    benchmark: name,
    n: total,
    correct,
    accuracy: total ? Number((correct / total).toFixed(4)) : null,
    latencyMsMedian: sorted.length ? sorted[Math.floor(sorted.length / 2)] : null,
    latencyMsP95: sorted.length ? sorted[Math.floor(sorted.length * 0.95)] : null,
    ...extra,
  };
  console.log(JSON.stringify(line));
  appendFileSync(join(OUT, 'summary.jsonl'), `${JSON.stringify(line)}\n`);
  return line;
}

async function runMmlu({ perSubject, permute }) {
  const items = loadMmlu(perSubject);
  const random = rng(SEED + (permute ? 7 : 0));
  const latencies = [];
  const perSubjectScore = {};
  let correct = 0;
  const details = [];
  for (const [index, item] of items.entries()) {
    const { gold, messages } = mmluPrompt(item, permute, random);
    let answer = null;
    try {
      const reply = await ask(messages, { maxTokens: 6 });
      latencies.push(reply.ms);
      answer = readLetter(reply.text);
    } catch (error) { answer = null; }
    const ok = answer === gold;
    if (ok) correct += 1;
    perSubjectScore[item.subject] ??= { correct: 0, total: 0 };
    perSubjectScore[item.subject].total += 1;
    if (ok) perSubjectScore[item.subject].correct += 1;
    details.push({ subject: item.subject, gold, answer, ok });
    if ((index + 1) % 50 === 0) process.stderr.write(`  mmlu${permute ? '-permuted' : ''} ${index + 1}/${items.length}\n`);
  }
  writeFileSync(join(OUT, `mmlu${permute ? '-permuted' : ''}-details.json`), JSON.stringify({ perSubjectScore, details }, null, 1));
  return report(`mmlu${permute ? '-permuted' : ''}`, correct, items.length, latencies, { perSubject });
}

async function runGsm8k(limit) {
  const items = loadGsm8k(limit);
  const latencies = [];
  let correct = 0;
  const details = [];
  for (const [index, row] of items.entries()) {
    const gold = goldOf(row);
    let answer = null;
    try {
      const reply = await ask([
        { role: 'system', content: 'Solve the problem. Think briefly, then end your reply with the final number on its own line prefixed by ####.' },
        { role: 'user', content: row.question },
      ], { maxTokens: 512 });
      latencies.push(reply.ms);
      answer = readNumber(reply.text);
    } catch { answer = null; }
    const ok = answer !== null && answer === gold;
    if (ok) correct += 1;
    details.push({ gold, answer, ok });
    if ((index + 1) % 25 === 0) process.stderr.write(`  gsm8k ${index + 1}/${items.length}\n`);
  }
  writeFileSync(join(OUT, 'gsm8k-details.json'), JSON.stringify(details, null, 1));
  return report('gsm8k', correct, items.length, latencies);
}

async function runTruthfulQa(limit) {
  const items = loadTruthfulQa(limit);
  const latencies = [];
  let correct = 0;
  for (const [index, item] of items.entries()) {
    const rendered = item.options.map((option, i) => `${LETTERS[i]}. ${option.text}`).join('\n');
    let answer = null;
    try {
      const reply = await ask([
        { role: 'system', content: 'You answer multiple-choice questions. Reply with one letter: A, B, C or D. Nothing else.' },
        { role: 'user', content: `${item.question}\n${rendered}\nAnswer:` },
      ], { maxTokens: 6 });
      latencies.push(reply.ms);
      answer = readLetter(reply.text);
    } catch { answer = null; }
    if (answer === item.gold) correct += 1;
    if ((index + 1) % 100 === 0) process.stderr.write(`  truthfulqa ${index + 1}/${items.length}\n`);
  }
  return report('truthfulqa-mc1-constructed', correct, items.length, latencies);
}

const which = process.argv[2] ?? 'all';
const limit = Number(process.argv[3] ?? 0) || null;
writeFileSync(join(OUT, 'summary.jsonl'), '', { flag: 'a' });
if (which === 'mmlu' || which === 'all') await runMmlu({ perSubject: limit ?? 10, permute: false });
if (which === 'mmlu-permuted' || which === 'all') await runMmlu({ perSubject: limit ?? 10, permute: true });
if (which === 'gsm8k' || which === 'all') await runGsm8k(limit ?? 150);
if (which === 'truthfulqa' || which === 'all') await runTruthfulQa(limit ?? 817);
