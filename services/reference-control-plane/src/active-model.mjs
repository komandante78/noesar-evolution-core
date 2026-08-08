// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Which model is actually loaded — one answer, for everyone who asks.
//
// Owner, s335: «1 modello che viene caricato lo vedano tutti, anche i moduli devono vedere il
// modello caricato».
//
// # The defect this closes
//
// Three parts of this product each answered "which model is there?" from a different place, and
// none of them knew about the others:
//
//   the Author        `NOESAR_AUTHORING_ENDPOINT` — an endpoint, never an identity
//   ATOM              `atom-evolution-model:8420`, compiled into the Rust client
//   `#/models`        `localModels.config().model` — the LOCAL runtime, `disabled` by default
//
// So on an installation where a sidecar serves a model and both the Author and ATOM use it, the
// catalogue reported `activeModelId: null` and the `in-use` lane was empty. Everything around
// that lane was already built — `laneOf`, the MC-002 synthesis of an undescribed running model,
// the filters that must never hide it — and all of it was dead, because the only source of
// truth was switched off. Measured in s335 with phi-4 resident and answering both callers.
//
// # The rule this file is written under
//
// **An endpoint is not an identity.** `atom-provider`'s own client says so in a comment it has
// carried for weeks: nobody asked the server which model it was running, so a swap behind the
// same address was indistinguishable from the address. This file is the place that finally
// asks — `GET /v1/models` on an OpenAI-compatible server — and when it cannot ask, it reports
// that it could not, instead of turning the address into a name.
//
// **Never guess, and never flatten.** Four outcomes, each distinct, none collapsed into the
// others: no endpoint configured; an endpoint that did not answer; an endpoint that answered
// with nothing; an endpoint that named a model. `unreachable` is not `absent` — reporting an
// unreachable model server as "no model" would tell an operator to install one they already
// have.

/** What the resolver can conclude. Distinct on purpose — see the header. */
export const ActiveModelState = Object.freeze({
  /** Nothing is configured to serve a model. Not a fault: it is the default installation. */
  NOT_CONFIGURED: 'not-configured',
  /** An endpoint is configured and did not answer. The model may exist; we could not ask. */
  UNREACHABLE: 'unreachable',
  /** The endpoint answered and declared no model at all. */
  NONE_SERVED: 'none-served',
  /** The endpoint answered and named what it is serving. */
  LOADED: 'loaded',
});

/**
 * Turn a served identifier into the id the catalogue keys on.
 *
 * llama.cpp reports the PATH it was started with (`/models/phi-4-q4_k_m.gguf`); a publisher's
 * descriptor is keyed by a plain id. Taking the basename and dropping a known weights suffix is
 * a normalisation, not an inference: it does not decide what the model IS, only what to call
 * the thing the server already named. `served` is kept alongside so nothing downstream has to
 * trust this transformation — the raw string travels with the answer.
 */
export function modelIdFromServed(served) {
  const raw = String(served ?? '').trim();
  if (!raw) return null;
  const base = raw.split('/').pop().split('\\').pop();
  return base.replace(/\.(gguf|safetensors|bin)$/i, '') || null;
}

/**
 * Ask an OpenAI-compatible server what it is serving.
 *
 * `fetchImpl` is injected so this is testable without a network and so the caller — never this
 * module — decides what a request is allowed to be. `timeoutMs` is a ceiling, not a retry
 * budget: a model server that has not answered in a couple of seconds is reported unreachable,
 * because the catalogue must render either way and a slow answer must not hold a page.
 */
export async function probeModelEndpoint(endpoint, { fetchImpl, timeoutMs = 2000, now = () => new Date().toISOString() } = {}) {
  const at = now();
  const base = String(endpoint ?? '').trim().replace(/\/+$/, '');
  if (!base) return { state: ActiveModelState.NOT_CONFIGURED, endpoint: null, id: null, served: null, at, reason: 'no model endpoint is configured' };
  if (typeof fetchImpl !== 'function') {
    return { state: ActiveModelState.UNREACHABLE, endpoint: base, id: null, served: null, at, reason: 'no way to reach the endpoint was supplied' };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(`${base}/v1/models`, { signal: controller.signal });
    if (!response?.ok) {
      return { state: ActiveModelState.UNREACHABLE, endpoint: base, id: null, served: null, at, reason: `the model endpoint answered ${response?.status ?? 'nothing'}` };
    }
    const body = await response.json();
    const served = Array.isArray(body?.data) && body.data.length ? String(body.data[0]?.id ?? '') : '';
    const id = modelIdFromServed(served);
    if (!id) return { state: ActiveModelState.NONE_SERVED, endpoint: base, id: null, served: served || null, at, reason: 'the endpoint answered but named no model' };
    return { state: ActiveModelState.LOADED, endpoint: base, id, served, at, reason: null };
  } catch (error) {
    // An abort and a refused connection are the same fact to whoever is asking: we could not
    // ask. The distinction is kept in `reason`, which is read by a person, not branched on.
    const reason = error?.name === 'AbortError'
      ? `the model endpoint did not answer within ${timeoutMs}ms`
      : `the model endpoint could not be reached: ${error?.message ?? 'unknown error'}`;
    return { state: ActiveModelState.UNREACHABLE, endpoint: base, id: null, served: null, at, reason };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The one answer, from the places a model can actually come from, in a declared order.
 *
 * The LOCAL runtime wins when it has a model, because that is a model this product started
 * itself and therefore knows the identity of without asking anyone. The configured endpoint is
 * second: it is a model somebody else started, which this product uses but did not install.
 *
 * The order is a declaration, not a preference: `source` travels in the answer so a reader can
 * see WHICH of the two spoke, and the two are never merged into an unattributed id.
 */
export async function resolveActiveModel({ localRuntimeModel = null, endpoint = null, fetchImpl, timeoutMs, now } = {}) {
  const local = String(localRuntimeModel ?? '').trim();
  if (local) {
    return {
      state: ActiveModelState.LOADED,
      source: 'local-runtime',
      id: local,
      served: local,
      endpoint: String(endpoint ?? '').trim() || null,
      at: (now ?? (() => new Date().toISOString()))(),
      reason: null,
    };
  }
  const probed = await probeModelEndpoint(endpoint, { fetchImpl, timeoutMs, now });
  return { ...probed, source: probed.state === ActiveModelState.NOT_CONFIGURED ? null : 'endpoint' };
}

/**
 * What every consumer of this fact receives — the product's own surface, the modules, and the
 * catalogue — so that a module and the page an operator is looking at cannot disagree.
 *
 * `usedBy` is supplied by the caller rather than derived here: who consumes the model is a fact
 * about how the installation is wired, and a module reading this must be told the truth about
 * that wiring rather than a list this file could only have guessed at.
 */
export function activeModelReport(resolved, { usedBy = [] } = {}) {
  return Object.freeze({
    loaded: resolved.state === ActiveModelState.LOADED,
    state: resolved.state,
    source: resolved.source ?? null,
    id: resolved.id ?? null,
    served: resolved.served ?? null,
    endpoint: resolved.endpoint ?? null,
    usedBy: Object.freeze([...usedBy]),
    reason: resolved.reason ?? null,
    at: resolved.at,
  });
}
