# phi-4 on public benchmarks — measured s336 (2026-08-09)

Owner: *«inizia a fare benchmark con il modello phi-4 su benchmark esterni così da misurare se
funziona tutto»*.

The model under test is the one this installation actually serves: `phi-4-q4_k_m.gguf` on
`atom-evolution-model`, one slot, 16 384 context, reached at `127.0.0.1:8420`. Greedy decoding
(`temperature: 0`), single-flight, no few-shot examples unless stated.

Harness: `tools/benchmarks/run-bench.mjs` (kept with this document, see below).

---

## Results

| Benchmark | Score | n | Median latency | p95 |
|---|---|---|---|---|
| MMLU, 0-shot, 10 per subject × 57 | **81.6 %** (465) | 570 | 209 ms | 251 ms |
| MMLU, same questions, options permuted | **80.3 %** (458) | 570 | 217 ms | 265 ms |
| GSM8K, chain-of-thought, exact numeric match | **94.0 %** (141) | 150 | 6 255 ms | 11 388 ms |
| TruthfulQA MC1 *(constructed — see note)* | **77.7 %** (515) | 663 | 238 ms | 257 ms |

Sample sizes are what was run, not extrapolated. At n = 570 the binomial standard error is about
1.6 points, so MMLU is 81.6 % ± ~3 at 95 % confidence; at n = 150 GSM8K is ± ~4. **No number here
should be quoted to a tenth of a point.**

---

## The contamination probe, and what it does and does not show

A score on a public benchmark cannot, alone, tell a model that reasons from one that has seen the
answer key. phi-4 is trained heavily on synthetic textbook-like material, and MMLU ships its own
`possibly_contaminated_urls.txt`. So MMLU was run **twice over the same 570 questions**: as
published, and with the four options deterministically permuted and the gold letter moved with
them. A model that computes the answer is indifferent to which letter it sits behind.

| | count |
|---|---|
| correct in **both** arrangements | 438 |
| correct only as published | 27 |
| correct only when permuted | 20 |
| wrong in both | 85 |
| **changed outcome** | **47 (8.2 %)** |

The aggregate gap is **1.3 points** and the flips are nearly symmetric (27 against 20). That is
noise, not collapse — a model keyed to option position would drop hard and asymmetrically.

Chosen-letter distribution is close to uniform and tracks the gold distribution in both runs
(published A/B/C/D = 117/141/147/151 against gold 116/149/149/156), so there is no strong
position bias either.

**What this probe does NOT show.** It tests memorisation of the *option arrangement*. If the model
memorised the question text → answer text mapping, permutation would not detect it, because the
right answer moves with its own letter. So the honest statement is: **no evidence of
option-position memorisation on MMLU**, which is weaker than "no contamination" and is all this
measurement supports.

---

## Where it is weak, per subject

Strongest at 100 %: marketing, miscellaneous, us_foreign_policy, world_religions.

Weakest: **high_school_mathematics 20 %**, college_mathematics 30 %, abstract_algebra 50 %,
college_chemistry 50 %, global_facts 50 %, anatomy 60 %.

Worth reading beside GSM8K's 94 %: the model is strong at *multi-step arithmetic word problems*
where it may write out its reasoning, and weak at *symbolic and abstract* mathematics answered in
one letter with no room to work. Those are different capabilities and the two results are not in
tension.

**14 of 570 replies (2.5 %) carried no parseable letter** and were scored wrong. That is a real
cost of a one-token answer format, and it is counted against the model rather than discarded.

---

## Two defects found in the HARNESS before any number was trusted

Recorded because both would have produced a plausible figure that measured nothing:

1. **The CSV was split on newlines.** 18 of the 57 MMLU subject files carry newlines inside quoted
   questions, so the files hold 18 500 "lines" against **14 042 real records**. Splitting on `\n`
   feeds the model truncated questions and silently drops the rest. Fixed with a proper reader
   before the first full run.
2. **Two harness processes ran concurrently.** A `nohup`'d run survived a shell exit and raced a
   second one against a **single-slot** server, inflating median latency from 209 ms to 407 ms.
   The accuracies were unaffected — the sample is seeded and deterministic — but every latency
   figure from that run was a measurement of queueing. Killed and re-run as one process.

---

## What this does and does not say about the product

It says the served model works, answers deterministically, and performs in the range expected of
phi-4 at Q4_K_M quantisation. It says nothing about NOESAR EVOLUTION itself: no product surface is
exercised here, the requests go straight to the model server. Product behaviour is measured by the
unit suite, the browser e2e run and the acceptance harnesses, which are separate and stay separate
— a benchmark of the model read as a benchmark of the product is exactly the confusion this
paragraph exists to prevent.
