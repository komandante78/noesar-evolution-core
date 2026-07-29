// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The client for an external reasoning provider.
//
// This file knows nothing about ATOM beyond the boundary the core itself defines: an
// endpoint, a token, a JSON envelope, and the surface names of the frozen contract. Any
// implementation that satisfies `conformance/reasoning-wire-vectors.json` can sit behind it.
//
// # Three outcomes, kept apart
//
// A provider can answer, it can refuse, and it can be unavailable. Collapsing the third into
// either of the first two is the failure this module exists to prevent:
//
//   * an answer          -> the value
//   * a refusal          -> `ReasoningRefused`, which the product already knows how to report
//   * unreachable/broken -> `ReasoningUnavailable`, which is NOT a refusal and NOT a reason to
//                           quietly use a different provider
//
// Falling back to the reference provider when the selected one is unreachable would produce a
// plausible answer attributed to nobody. The caller asked for a specific provider; if it
// cannot be had, saying so is the only honest answer.

import { ReasoningRefused } from './reasoning.mjs';

export const DEFAULT_TIMEOUT_MS = 10_000;

/** The selected provider could not be reached, or did not speak the protocol. */
export class ReasoningUnavailable extends Error {
  constructor(reason, { surface, endpoint } = {}) {
    super(reason);
    this.name = 'ReasoningUnavailable';
    this.reason = reason;
    this.surface = surface ?? null;
    this.endpoint = endpoint ?? null;
  }
}

/** The surfaces this client will ask an external provider for. */
export const EXTERNAL_SURFACES = Object.freeze([
  'interpret', 'hypothesize', 'plan', 'decompose', 'expect', 'constrain',
  'classify', 'confidence', 'evidence', 'cancel', 'fixtures', 'simulate',
]);

export class AtomClient {
  #endpoint;
  #token;
  #sessionId;
  #timeoutMs;
  #fetch;

  constructor({ endpoint, token, sessionId, timeoutMs = DEFAULT_TIMEOUT_MS, fetchImpl = fetch } = {}) {
    if (!String(endpoint ?? '').trim()) {
      throw new ReasoningUnavailable('an external provider was selected with no endpoint');
    }
    this.#endpoint = String(endpoint).replace(/\/+$/, '');
    this.#token = String(token ?? '');
    // Optional, and absent by default. A provider that records nothing answers every surface
    // identically — recording changes what is written down, never what comes back — so a
    // caller with no session to name loses nothing by not naming one. What it does lose is
    // `fixtures`, which has no session to hand back and says so.
    this.#sessionId = String(sessionId ?? '').trim();
    this.#timeoutMs = timeoutMs;
    this.#fetch = fetchImpl;
  }

  get endpoint() { return this.#endpoint; }

  get sessionId() { return this.#sessionId || null; }

  async identity() {
    return this.#request('GET', '/v1/identity', null, 'identity');
  }

  async call(surface, payload) {
    if (!EXTERNAL_SURFACES.includes(surface)) {
      throw new ReasoningUnavailable(`\`${surface}\` is not a surface this client asks for`, {
        surface, endpoint: this.#endpoint,
      });
    }
    return this.#request('POST', `/v1/${surface}`, payload, surface);
  }

  async #request(method, path, payload, surface) {
    const url = `${this.#endpoint}${path}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.#timeoutMs);
    let response;
    try {
      response = await this.#fetch(url, {
        method,
        headers: {
          'content-type': 'application/json',
          'x-atom-token': this.#token,
          // The session travels as transport metadata, never in the body: the request
          // bodies are the frozen contract's shapes, checked by the wire vectors both
          // sides run, and session affinity is not part of the reasoning contract.
          ...(this.#sessionId ? { 'x-atom-session': this.#sessionId } : {}),
        },
        body: payload === null ? undefined : JSON.stringify(payload),
        signal: controller.signal,
      });
    } catch (error) {
      // A timeout, a refused connection and a DNS failure are the same fact to the caller:
      // the provider it chose is not there.
      throw new ReasoningUnavailable(
        `the external provider at ${this.#endpoint} could not be reached: ${error?.message ?? error}`,
        { surface, endpoint: this.#endpoint },
      );
    } finally {
      clearTimeout(timer);
    }

    let text;
    try {
      text = await response.text();
    } catch (error) {
      throw new ReasoningUnavailable(
        `the external provider gave a body that could not be read: ${error?.message ?? error}`,
        { surface, endpoint: this.#endpoint },
      );
    }

    let envelope;
    try {
      envelope = JSON.parse(text);
    } catch {
      throw new ReasoningUnavailable(
        `the external provider answered ${response.status} with something that is not JSON`,
        { surface, endpoint: this.#endpoint },
      );
    }

    // The status describes the transport. A non-200 means the request never reached the
    // contract — a wrong token, a surface that does not exist, a body it would not read —
    // and none of those is the provider refusing the work.
    if (response.status !== 200) {
      const reason = envelope?.error?.reason ?? 'no reason given';
      throw new ReasoningUnavailable(
        `the external provider rejected the request (${response.status}): ${reason}`,
        { surface, endpoint: this.#endpoint },
      );
    }

    if (envelope?.ok === true) {
      if (!('value' in envelope)) {
        throw new ReasoningUnavailable(
          'the external provider reported success with no value, which is not an answer',
          { surface, endpoint: this.#endpoint },
        );
      }
      return envelope.value;
    }

    if (envelope?.ok === false) {
      const kind = envelope?.error?.kind ?? 'UNKNOWN';
      const reason = envelope?.error?.reason ?? 'no reason given';
      // REFUSED and INVALID are the contract answering. Anything else is the provider
      // failing, and must not be dressed as a decision it made.
      if (kind === 'REFUSED' || kind === 'INVALID') {
        throw new ReasoningRefused(reason);
      }
      throw new ReasoningUnavailable(
        `the external provider failed (${kind}): ${reason}`,
        { surface, endpoint: this.#endpoint },
      );
    }

    throw new ReasoningUnavailable(
      'the external provider answered without `ok`, so the envelope cannot be read',
      { surface, endpoint: this.#endpoint },
    );
  }
}
