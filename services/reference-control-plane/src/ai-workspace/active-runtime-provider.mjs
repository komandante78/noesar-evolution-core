// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The last link of the `/model` chain: the model an operator chose is the model that answers.
//
// # The gap this closes
//
// Two halves of this product each knew half of the answer and nothing joined them:
//
//   `/model <id>`  ->  `activateModel()`  ->  `LocalModelRuntime` launches a local
//                      OpenAI-compatible server and holds `{ endpoint, model }`
//   a chat message ->  `ChatOrchestrator` -> `ProviderGateway.route()` -> the *stored*
//                      provider profiles, which know nothing about any of that
//
// So an operator could choose a model, watch it start, and still be answered by something
// else entirely — or by nothing at all, with `All streaming providers failed` — and the
// product never said which of the two had happened. `activeModelConsumers()` in `server.mjs`
// was honest about it: it listed the Author and ATOM and *not* chat, because chat genuinely
// did not use the chosen model.
//
// # Why a DERIVED profile and not a stored one
//
// The obvious repair is to write a provider profile when a model is activated and delete it
// on release. That creates a second copy of a fact the runtime already owns, and every copy
// can go stale: a runtime that died leaves a profile claiming it is enabled, and chat routes
// to a dead address on every message. So nothing is written. This module DERIVES the profile
// from `LocalModelRuntime.status()` at the moment of each read; when the runtime stops
// serving, the profile stops existing in the same instant, with no reconciliation step that
// could be skipped.
//
// It also means the operator's own configuration is never mutated behind their back: this
// product does not enable, disable or re-point a profile a person created.
//
// # What it refuses to do
//
// **It never routes chat at an address that is not answering.** A profile is produced only
// when the runtime declares a mode, an endpoint and a model AND has evidence the server is
// actually there — a live launched process, or a probe that succeeded. Routing at a dead
// endpoint would turn every message into a 502 and would be strictly worse than not routing:
// the operator would have to guess whether the model or the wiring was broken.
//
// **It never guesses instead of saying why.** Every negative answer carries the reason, in
// the words the shells show, so `/model` can state "chat will not answer from this model,
// because ..." rather than leaving an operator to infer it from silence.
//
// **It is local, and stays local.** `external: false`, no credential, no consent gate: this
// profile can only ever point at the loopback endpoint the runtime itself configured, so it
// introduces no outbound call and `CLAUDE10.md` section 8 (offline by default) is untouched.
// A runtime endpoint that is not a plain http(s) URL is refused rather than dialled.

import { isIP } from 'node:net';
import { isInternalAddress, METADATA_ADDRESSES } from './address-guard.mjs';

/** The one id this profile is ever known by. Stable, so a UI can recognise it. */
export const LOCAL_RUNTIME_PROFILE_ID = 'local-runtime';

/** Sorted ahead of the stored profiles: choosing a model is the most recent statement of intent. */
const RUNTIME_PRIORITY = -1;

/** The two names a local runtime is reached by that are not literal addresses. */
const LOCAL_HOST_NAMES = new Set(['localhost', 'host.docker.internal']);

/**
 * The endpoint, as a provider base URL — or `null`, which the caller turns into a reason.
 *
 * The address rule is not a copy: `isInternalAddress` is the audited predicate `address-guard`
 * already owns, used here in the opposite direction. This profile is marked `external: false`,
 * which is what lets it answer with no consent gate and no credential — so it must be
 * IMPOSSIBLE to point it outward. A runtime endpoint of `https://api.example.com` would
 * otherwise become an unconsented outbound call wearing the word "local", and section 8
 * (external APIs disabled by default) would have a hole in it shaped like a configuration
 * field. A bare hostname is refused for the same reason the stored local profiles refuse one:
 * deciding it would take a DNS answer that can change between the check and the call.
 */
function baseUrlFor(endpoint) {
  let url;
  try {
    url = new URL('/v1', String(endpoint));
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (url.username || url.password || url.search || url.hash) return null;
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  const literal = Boolean(isIP(host));
  const local = LOCAL_HOST_NAMES.has(host)
    || (literal && isInternalAddress(host) && !METADATA_ADDRESSES.includes(host));
  if (!local) return null;
  return url.toString().replace(/\/+$/, '');
}

/**
 * Is the runtime actually serving right now?
 *
 * Two independent kinds of evidence, because the product supports two ways of getting a
 * server: `launch()` starts one (and only returns after `/v1/models` answered, so a live
 * child is evidence), and `attach()` binds to one an operator started themselves (where the
 * successful probe is the only evidence there is).
 */
function servingEvidence(status) {
  if (status.launched && !status.launched.exited) return 'a launched runtime process is running';
  // `D-0541`. "Was the endpoint ever seen answering" is a MONOTONE fact and is read from
  // liveness; whether that fact has gone stale is the failure counter's decision, checked by the
  // caller before this runs. Reading `lastProbe.ok` here instead — which is what this did — made
  // a SINGLE failed probe wipe the evidence, so the hysteresis built to stop the route flapping
  // was defeated by the rule beside it. Found by the e2e, not by reading: one failed attach
  // already moved chat off the chosen model.
  const liveness = status.liveness ?? null;
  if (liveness?.lastSeenAt) return `the endpoint answered at ${liveness.lastSeenAt}`;
  // A runtime whose status predates the health lane still reports the way it always did.
  if (!liveness && status.lastProbe?.ok) return `the endpoint answered at ${status.lastProbe.at}`;
  return null;
}

/**
 * Derive the routable provider profile for whatever the local runtime is serving.
 *
 * Returns `{ profile, reason }`: exactly one of the two is ever non-null, so a caller can
 * always say why there is nothing rather than only that there is nothing.
 *
 * The shape returned is a full provider profile, deliberately: the gateway's request builder,
 * header builder and permission gate all read profiles, and a special-cased half-profile
 * would be a second code path through the part of this product that talks to a model.
 */
export function localRuntimeProfileFrom(status, { now = () => new Date().toISOString() } = {}) {
  if (!status || typeof status !== 'object') {
    return { profile: null, reason: 'this deployment did not wire a local model runtime' };
  }
  if (status.mode === 'disabled') {
    return {
      profile: null,
      reason: status.overriddenByEnvironment
        ? 'the local model runtime is disabled by NOESAR_LOCAL_MODEL_RUNTIME on this installation'
        : 'the local model runtime is disabled',
    };
  }
  if (!status.model) return { profile: null, reason: 'no model is active — choose one with /model' };
  if (!status.endpoint) return { profile: null, reason: `\`${status.model}\` has no endpoint configured, so nothing can be asked of it` };

  const baseUrl = baseUrlFor(status.endpoint);
  if (!baseUrl) {
    return {
      profile: null,
      reason: `\`${status.endpoint}\` is not a local http(s) endpoint — a local runtime is reached on loopback or a private address, and this one is not dialled`,
    };
  }
  // `D-0541`. Liveness OVERRULES both kinds of evidence, and it has to: a launched child can be
  // alive while the server inside it has stopped answering, and an attached endpoint's last
  // successful probe can be minutes old. `ok` is already the hysteresis — the runtime reports
  // false only after two consecutive failed probes — so acting on it here cannot flap on one
  // missed reading against a server that is busy generating.
  const liveness = status.liveness ?? null;
  if (liveness && liveness.ok === false) {
    const since = liveness.lastSeenAt ? ` — last seen ${liveness.lastSeenAt}` : ' — it has never been seen answering';
    return {
      profile: null,
      reason: `\`${status.model}\` has stopped answering: ${liveness.consecutiveFailures} consecutive probes failed${since}`,
    };
  }

  const evidence = servingEvidence(status);
  if (!evidence) {
    return {
      profile: null,
      reason: status.lastError
        ? `\`${status.model}\` is not answering: ${status.lastError}`
        : `\`${status.model}\` has not been observed answering yet — start it with /model, or attach to it`,
    };
  }

  const at = now();
  return {
    profile: Object.freeze({
      id: LOCAL_RUNTIME_PROFILE_ID,
      name: `Local runtime — ${status.model}`,
      type: 'local-openai-compatible',
      apiStyle: 'openai-chat',
      baseUrl,
      external: false,
      enabled: true,
      credentialRequired: false,
      defaultModel: String(status.model),
      models: [String(status.model)],
      contextWindow: null,
      // Present so every reader of a profile finds the field where it expects it. It can
      // never be consulted: `external` is false, and the consent gate only guards egress.
      consent: Object.freeze({ granted: false, grantedAt: null, projectIds: [], dataClasses: [], allowTools: false, anonymize: true }),
      timeoutMs: 120_000,
      priority: RUNTIME_PRIORITY,
      modes: Object.freeze(['ASK', 'CREATE', 'ACT']),
      fallbackProviderIds: Object.freeze([]),
      headers: Object.freeze({}),
      encryptedCredential: null,
      credentialEphemeral: false,
      createdAt: status.launched?.startedAt ?? at,
      updatedAt: at,
      // The three fields that mark this profile as not-a-stored-one. A UI that lets a person
      // edit a provider must not offer to edit this: it is a reading of the runtime, and the
      // way to change it is to choose a different model.
      virtual: true,
      source: 'local-model-runtime',
      servingEvidence: evidence,
      // `D-0541`: how fresh that evidence is, carried on the profile itself so a surface that
      // says "chat answers from X" can also say when X was last seen, without asking a second
      // source that could disagree. `null` on a deployment whose runtime predates the field.
      liveness: liveness ? Object.freeze({ ...liveness }) : null,
    }),
    reason: null,
  };
}
