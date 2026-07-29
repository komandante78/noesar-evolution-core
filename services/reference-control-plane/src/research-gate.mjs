// SPDX-License-Identifier: AGPL-3.0-or-later
//
// UI-090's client half. The gate itself lives in atomd (`research_gate.rs`, ATOM_EVOLUTION,
// `/v1/research-gate`) — this module is only the HTTP call, kept to the same three-outcomes-
// kept-apart posture `atom-client.mjs` already established for the ReasoningProvider
// surfaces: an answer, or `ReasoningUnavailable`. There is no third path that guesses.
//
// NO REFERENCE FALLBACK, BY DESIGN AND PERMANENTLY. Classifying a query's intent needs a
// model, and the reference reasoning provider has none — the same boundary
// `workspace-actions.mjs` already draws for the plan surfaces ("the reference reasoning
// provider has no model"). If the model behind this gate cannot be reached, the honest answer
// is "cannot be asked", never a default direction — silently defaulting to PROCEED would fail
// open exactly where UI-090 exists to prevent that, and silently defaulting to REFUSE would
// block every query the moment the sidecar is restarted.
//
// NOT A ROUTABLE `ReasoningProvider` SURFACE. `reasoning-router.mjs`'s `ROUTABLE` list and
// `NOESAR_REASONING_MODE`/`NOESAR_EXTERNAL_SURFACES` govern the twelve-surface contract only.
// This reads the same endpoint/token because it is the same atomd daemon, but independently
// of that routing — there is no "reference" leg to route away from.

import { ReasoningUnavailable } from './atom-client.mjs';

export const RESEARCH_GATE_SURFACE = 'research-gate';
const OUTCOMES = Object.freeze(['PROCEED', 'ASK', 'REFUSE']);
export const DEFAULT_TIMEOUT_MS = 10_000;

export class ResearchGateClient {
  #endpoint;
  #token;
  #timeoutMs;
  #fetch;

  constructor({ endpoint, token, timeoutMs = DEFAULT_TIMEOUT_MS, fetchImpl = fetch } = {}) {
    if (!String(endpoint ?? '').trim()) {
      throw new ReasoningUnavailable('no external provider is configured for the research gate', {
        surface: RESEARCH_GATE_SURFACE,
      });
    }
    this.#endpoint = String(endpoint).replace(/\/+$/, '');
    this.#token = String(token ?? '');
    this.#timeoutMs = timeoutMs;
    this.#fetch = fetchImpl;
  }

  get endpoint() { return this.#endpoint; }

  /**
   * Classifies `query`. Resolves to `{ outcome, category }` — `category` is `null` unless
   * `outcome === 'REFUSE'`. Never throws for an ASK or a REFUSE: those are the contract
   * answering, the same posture a `ReasoningRefused` already has on the other surfaces. Only
   * unreachability or an answer this client cannot trust throws `ReasoningUnavailable`.
   */
  async classify(query) {
    const url = `${this.#endpoint}/v1/research-gate`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.#timeoutMs);
    let response;
    try {
      response = await this.#fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-atom-token': this.#token },
        body: JSON.stringify({ query }),
        signal: controller.signal,
      });
    } catch (error) {
      throw new ReasoningUnavailable(
        `the research gate at ${this.#endpoint} could not be reached: ${error?.message ?? error}`,
        { surface: RESEARCH_GATE_SURFACE, endpoint: this.#endpoint },
      );
    } finally {
      clearTimeout(timer);
    }

    let text;
    try {
      text = await response.text();
    } catch (error) {
      throw new ReasoningUnavailable(
        `the research gate gave a body that could not be read: ${error?.message ?? error}`,
        { surface: RESEARCH_GATE_SURFACE, endpoint: this.#endpoint },
      );
    }

    let envelope;
    try {
      envelope = JSON.parse(text);
    } catch {
      throw new ReasoningUnavailable(
        `the research gate answered ${response.status} with something that is not JSON`,
        { surface: RESEARCH_GATE_SURFACE, endpoint: this.#endpoint },
      );
    }

    // The status describes the transport, exactly as `atom-client.mjs` treats it: a wrong
    // token or an unreachable route never reaches the contract, so none of those is the gate
    // making a decision.
    if (response.status !== 200) {
      const reason = envelope?.error?.reason ?? 'no reason given';
      throw new ReasoningUnavailable(
        `the research gate rejected the request (${response.status}): ${reason}`,
        { surface: RESEARCH_GATE_SURFACE, endpoint: this.#endpoint },
      );
    }

    if (envelope?.ok === true) {
      const value = envelope.value;
      if (!value || !OUTCOMES.includes(value.outcome)) {
        throw new ReasoningUnavailable(
          'the research gate reported success with an answer that is not one of the three outcomes',
          { surface: RESEARCH_GATE_SURFACE, endpoint: this.#endpoint },
        );
      }
      // UI-093: an unnamed refusal is not a decision this client passes along as one.
      if (value.outcome === 'REFUSE' && !value.category) {
        throw new ReasoningUnavailable(
          'the research gate refused without naming a category',
          { surface: RESEARCH_GATE_SURFACE, endpoint: this.#endpoint },
        );
      }
      return { outcome: value.outcome, category: value.outcome === 'REFUSE' ? value.category : null };
    }

    if (envelope?.ok === false) {
      const kind = envelope?.error?.kind ?? 'UNKNOWN';
      const reason = envelope?.error?.reason ?? 'no reason given';
      // Every failure kind atomd's research-gate route answers with — INVALID (an empty
      // query, which the product endpoint below never forwards), UNAVAILABLE (the model),
      // INTERNAL (an unparseable model answer) — is the gate failing to decide, never a
      // decision this client passes through as ASK or REFUSE.
      throw new ReasoningUnavailable(
        `the research gate could not decide (${kind}): ${reason}`,
        { surface: RESEARCH_GATE_SURFACE, endpoint: this.#endpoint },
      );
    }

    throw new ReasoningUnavailable(
      'the research gate answered without `ok`, so the envelope cannot be read',
      { surface: RESEARCH_GATE_SURFACE, endpoint: this.#endpoint },
    );
  }
}

/**
 * Reads the same endpoint/token `routingFrom()` (`reasoning-router.mjs`) reads — it is the
 * same atomd daemon — but ignores `NOESAR_REASONING_MODE`/`NOESAR_EXTERNAL_SURFACES`
 * entirely: this surface has no reference leg to be routed away from, so there is no mode in
 * which reading them would change anything.
 */
export function researchGateFrom(env = process.env, { fetchImpl } = {}) {
  const endpoint = String(env.NOESAR_RUST_REASONING_ENDPOINT ?? '').trim();
  return new ResearchGateClient({
    endpoint,
    token: env.NOESAR_RUST_REASONING_TOKEN,
    ...(fetchImpl ? { fetchImpl } : {}),
  });
}

export { ReasoningUnavailable };
