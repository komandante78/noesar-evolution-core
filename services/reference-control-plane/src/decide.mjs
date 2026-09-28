// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Typed decisions: the model CHOOSES among options this engine wrote, and never writes the answer.
//
// # Why this exists (28/09/2026)
//
// Everything the product asked a model so far was a generation: prose or code, parsed afterwards.
// Most of what the engine actually needs is not a text but a CHOICE — which of these functions holds
// the bug, is this page about this error, does this source support this claim, should we ask. A
// choice read off the probability of ONE token is cheaper than any generation, cannot invent an
// option that was not offered, and comes with a number an operator can check.
//
// Measured before this file existed, on this installation's own Qwen3.6-35B-A3B through the plain
// OpenAI-shaped endpoint (`chat-logprobs-probe.mjs`): «does this code contain the bug?» → A 0,869 on
// the buggy function, B 0,751 on an unrelated one, ~0,5-0,6 s each. Over 14 SWE-bench Verified
// instances, asked of every function in the five files the search chose, the function the real fix
// changes came first in 5 of the 9 instances where it was among the candidates, and in the first
// five in 8 of 9 (`BENCH_SWE/out/decide-localize-0928.json`).
//
// # Rules, each inherited from a guarantee this product already makes
//
//   1. The model never writes the answer: it is shown lettered options and one letter is read.
//      Untrusted text in `context` can move a probability; it cannot add an option or an action.
//   2. It abstains rather than guesses: when the letters it was offered carry less than `minMass`
//      of the next-token probability, it wanted to say something else, and the answer is `null`.
//   3. Portable: `/v1/chat/completions` with `logprobs` is what OpenAI, vLLM and llama.cpp all
//      speak, so this works with whatever model the person installing chose. Nothing about the
//      model's window is assumed here; a context that does not fit is the runtime's refusal.
//   4. Every decision is a record: digests of what was asked and the probabilities that came back,
//      never the bytes — the same projection `author.mjs` keeps between `fixtures` and `calls`.
//
// Off by default (`NOESAR_DECIDE=on`), like every surface in this product that changes behaviour
// before it has been measured where it is used.

import { createHash } from 'node:crypto';

const digest = (text) => createHash('sha256').update(String(text)).digest('hex');
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

export class DecisionUnavailable extends Error {
  constructor(reason) {
    super(reason);
    this.name = 'DecisionUnavailable';
    this.reason = reason;
  }
}

export const decideSwitchFromEnv = (env = process.env) => String(env?.NOESAR_DECIDE ?? '').toLowerCase() === 'on';

/** The prompt, context FIRST: several questions about one context then share a cacheable prefix. */
export function decisionPrompt({ context = '', question, options }) {
  return [
    ...(String(context).trim() ? [String(context).trim(), ''] : []),
    question,
    ...options.map((option, index) => `${LETTERS[index]}) ${option}`),
    'Answer with one letter.',
  ].join('\n');
}

/**
 * The next-token distribution restricted to the offered letters.
 * `top` is `[{ token, logprob }]`; ` A`, `A` and `A)` all count for A — tokenizers differ.
 */
export function letterDistribution(top, count) {
  const mass = new Array(count).fill(0);
  for (const entry of top ?? []) {
    const letter = String(entry?.token ?? '').trim().replace(/[).:]$/, '');
    const index = LETTERS.indexOf(letter);
    if (letter.length === 1 && index >= 0 && index < count) mass[index] += Math.exp(Number(entry.logprob));
  }
  const total = mass.reduce((sum, value) => sum + value, 0);
  return { total, probabilities: total > 0 ? mass.map((value) => value / total) : mass };
}

/**
 * The decision port for an OpenAI-shaped chat endpoint — the runtime `openAiChatGenerator` already
 * talks to. Returns `choose({ context, question, options })`.
 */
export function openAiDecider({
  endpoint, model = null, apiKey = null, fetchImpl = fetch, timeoutMs = 120_000, minMass = 0.5,
}) {
  const base = String(endpoint ?? '').replace(/\/+$/, '');
  if (!base) throw new DecisionUnavailable('no model is configured for decisions');
  return async function choose({ context = '', question, options }) {
    if (!Array.isArray(options) || options.length < 2 || options.length > LETTERS.length) {
      throw new DecisionUnavailable(`a decision needs 2 to ${LETTERS.length} options, received ${options?.length ?? 0}`);
    }
    const prompt = decisionPrompt({ context, question, options });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let body;
    try {
      const response = await fetchImpl(`${base}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}) },
        body: JSON.stringify({
          ...(model ? { model } : {}),
          messages: [{ role: 'user', content: prompt }],
          max_tokens: 1, temperature: 0, logprobs: true, top_logprobs: 20,
          // Same local-runtime switch the Author sends: a thinking block would be the first token.
          chat_template_kwargs: { enable_thinking: false },
        }),
        signal: controller.signal,
      });
      if (!response.ok) {
        const detail = await response.text().then((text) => text.trim().slice(0, 300), () => '');
        throw new DecisionUnavailable(`the model at ${base} answered ${response.status} to a decision${detail ? `: ${detail}` : ''}`);
      }
      body = await response.json();
    } catch (error) {
      if (error instanceof DecisionUnavailable) throw error;
      throw new DecisionUnavailable(`the model at ${base} could not be reached for a decision: ${error?.message ?? error}`);
    } finally {
      clearTimeout(timer);
    }
    const top = body?.choices?.[0]?.logprobs?.content?.[0]?.top_logprobs;
    if (!Array.isArray(top)) {
      throw new DecisionUnavailable(`the model at ${base} returned no token probabilities: this runtime cannot take decisions`);
    }
    const { total, probabilities } = letterDistribution(top, options.length);
    const abstained = total < minMass;
    const best = probabilities.indexOf(Math.max(...probabilities));
    return {
      answer: abstained ? null : best,
      probabilities,
      confidence: abstained ? 0 : probabilities[best],
      mass: total,
      abstained,
      record: { promptDigest: digest(prompt), options: options.length, model: model ?? base, probabilities, mass: total, answer: abstained ? null : best },
    };
  };
}

/** Yes/no: the probability of «yes», or `null` when the model abstained. */
export async function probabilityYes(choose, { context, question }) {
  const decision = await choose({ context, question, options: ['yes', 'no'] });
  return { probability: decision.abstained ? null : decision.probabilities[0], decision };
}
