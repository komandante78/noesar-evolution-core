// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The model transport — `D-0517`, built.
//
// `planAcquisition` (`model-catalog.mjs`) already decides whether an artefact MAY be fetched:
// egress consent, a registered and unrevoked publisher, a declared digest, a runtime able to
// start it. What did not exist was the thing that fetches the bytes, so the route answered
// `501 NO_TRANSPORT` — honestly, but for thirteen sessions.
//
// # Why this is a component and not a download button
//
// A button that shells out to a vendor's CLI would make this product depend on one provider's
// tooling to own its own models. This file depends on nothing but an injected `fetch`: it is a
// verified-artefact transport that happens to be used for models, and any other artefact with a
// publisher-declared digest can travel through it unchanged.
//
// # What it guarantees, and how each guarantee is enforced rather than intended
//
//   ORIGIN     `https` only, with ONE exception: `http` to a loopback host, because a mirror on
//              the same machine is not egress at all. Every redirect hop is re-checked against
//              the same rule — a policy applied only to the first URL is a policy a `302`
//              walks around.
//   SIZE       The cap is counted WHILE STREAMING. `Content-Length` is a claim by the server
//              being defended against; it is used only to refuse early, never to trust late.
//   INTEGRITY  sha256 is computed over the bytes as they arrive, and compared with what the
//              PUBLISHER declared. A mismatch is a refusal with both digests, never a warning.
//   LIVENESS   A stalled connection is a failure with a name. A download that hangs for ever
//              holds a slot for ever, and "still downloading" after two days is a lie the UI
//              would faithfully render.
//   CONTROL    An `AbortSignal` stops it, and stopping is reported as `CANCELLED` rather than
//              as an error — a person changing their mind is not a fault.
//
// # What this file deliberately does NOT do
//
// **No filesystem.** Where the bytes land, what is overwritten and what is quarantined are
// decisions with their own rules (`CLAUDE10.md` §4), and they live in `model-acquisition.mjs`.
// This module writes to an injected sink, which is what lets its tests run without a disk and
// what keeps `MC-005`-style claims about it checkable by reading its import list.
//
// **No retry.** A retry loop hides the difference between "the network blinked" and "the
// publisher is gone", and this product does not report a guess as a result.
//
// **No resume.** Range requests are the obvious next step and are deliberately absent: partial
// state that survives a crash needs its own integrity story, and inventing one here would put
// an unverified prefix on disk under a verified name.

import { createHash } from 'node:crypto';

/** Every refusal this transport can produce. A refusal is a RESULT, never an exception. */
export const TransportRefusal = Object.freeze({
  NO_SOURCE: 'NO_SOURCE',
  SCHEME_NOT_ALLOWED: 'SCHEME_NOT_ALLOWED',
  REDIRECT_LIMIT: 'REDIRECT_LIMIT',
  REDIRECT_WITHOUT_LOCATION: 'REDIRECT_WITHOUT_LOCATION',
  HTTP_STATUS: 'HTTP_STATUS',
  NO_BODY: 'NO_BODY',
  SIZE_CAP_EXCEEDED: 'SIZE_CAP_EXCEEDED',
  DIGEST_MISMATCH: 'DIGEST_MISMATCH',
  STALLED: 'STALLED',
  CANCELLED: 'CANCELLED',
  TRANSPORT_ERROR: 'TRANSPORT_ERROR',
});

export class ModelTransportError extends Error {
  constructor(kind, reason) {
    super(reason);
    this.name = 'ModelTransportError';
    this.kind = kind;
    this.reason = reason;
  }
}

const HEX64 = /^[0-9a-f]{64}$/i;

/**
 * Is this host the machine we are already on?
 *
 * A download from `127.0.0.1` leaves no packet on any wire, so requiring TLS for it would be
 * ceremony rather than security — and it would make an air-gapped mirror, which is exactly the
 * deployment this product is built for, impossible to serve without a certificate authority.
 */
function isLoopback(hostname) {
  const host = String(hostname ?? '').toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host === '::1' || host === '0:0:0:0:0:0:0:1') return true;
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host);
}

/**
 * The origin policy, pure and exported so the UI and the tests can ask it the same question
 * the transport will ask, instead of predicting the answer.
 */
export function checkSource(source) {
  if (!source || typeof source !== 'string') {
    return { allowed: false, kind: TransportRefusal.NO_SOURCE, reason: 'the descriptor declares no source to fetch the artefact from' };
  }
  let url;
  try { url = new URL(source); } catch {
    return { allowed: false, kind: TransportRefusal.NO_SOURCE, reason: `"${source}" is not a URL this installation can fetch` };
  }
  if (url.protocol === 'https:') return { allowed: true, url };
  if (url.protocol === 'http:' && isLoopback(url.hostname)) return { allowed: true, url, loopback: true };
  return {
    allowed: false,
    kind: TransportRefusal.SCHEME_NOT_ALLOWED,
    reason: url.protocol === 'http:'
      ? 'plain http is accepted only towards a mirror on this machine; anything else must be https'
      : `"${url.protocol}" is not a transport this installation will fetch a model over`,
  };
}

/** One `read()` with a deadline. A connection that stops speaking is a failure with a name. */
async function readWithDeadline(reader, stallTimeoutMs) {
  if (!Number.isFinite(stallTimeoutMs) || stallTimeoutMs <= 0) return reader.read();
  let timer = null;
  try {
    return await Promise.race([
      reader.read(),
      new Promise((_resolve, reject) => {
        timer = setTimeout(() => reject(new ModelTransportError(TransportRefusal.STALLED, `no byte arrived for ${stallTimeoutMs} ms`)), stallTimeoutMs);
        // Deliberately NOT unref'd. One timer lives for the gap between two chunks and is
        // cleared by the `finally` below, so the longest it can hold the loop is exactly the
        // stall deadline — which is the interval during which this process genuinely does have
        // work outstanding. Unref'ing it made a stalled read silently outlive the event loop
        // instead of failing, which is the shape of the hang this deadline exists to prevent.
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

const refusal = (kind, reason, extra = {}) => ({ ok: false, kind, reason, ...extra });

/**
 * Fetch an artefact, under a cap, verifying the digest the publisher declared.
 *
 * @param {object}   options
 * @param {string}   options.source          the URL from the descriptor
 * @param {string}   options.expectedSha256  what the PUBLISHER committed to — never our own hash
 * @param {number}   options.maxBytes        the ceiling from the acquisition grant
 * @param {Function} options.fetchImpl       injected, so the tests need no network
 * @param {object}   options.sink            `{ write(chunk), close(), abort(reason) }`
 * @param {Function} [options.onProgress]    `({ receivedBytes, totalBytes })`, best effort
 * @param {AbortSignal} [options.signal]     cancellation
 * @param {number}   [options.maxRedirects]  hops allowed, each re-checked against `checkSource`
 * @param {number}   [options.stallTimeoutMs]
 * @returns {Promise<{ok:true,digest:string,bytes:number,source:string}|{ok:false,kind:string,reason:string}>}
 */
export async function fetchArtefact({
  source,
  expectedSha256,
  maxBytes,
  fetchImpl,
  sink,
  onProgress = null,
  signal = null,
  maxRedirects = 4,
  stallTimeoutMs = 30_000,
} = {}) {
  if (typeof fetchImpl !== 'function') throw new ModelTransportError('NO_FETCH', 'a fetch implementation must be injected');
  if (!sink || typeof sink.write !== 'function') throw new ModelTransportError('NO_SINK', 'a sink with write/close/abort must be provided');
  // Refused rather than defaulted: a transport that will accept any digest is a transport with
  // no integrity story, and a default here would make that state reachable by omission.
  if (!HEX64.test(String(expectedSha256 ?? ''))) {
    throw new ModelTransportError('NO_EXPECTED_DIGEST', 'a 64-character sha256 the publisher declared is required');
  }
  const cap = Number.isFinite(maxBytes) && maxBytes > 0 ? maxBytes : null;

  const first = checkSource(source);
  if (!first.allowed) return refusal(first.kind, first.reason);

  let current = first.url;
  let response = null;
  try {
    for (let hop = 0; ; hop += 1) {
      if (signal?.aborted) return refusal(TransportRefusal.CANCELLED, 'the acquisition was cancelled before the first byte');
      // `redirect: 'manual'` and not `'follow'`: following is what re-checks nothing.
      response = await fetchImpl(current.toString(), { redirect: 'manual', signal: signal ?? undefined });
      if (response.status < 300 || response.status >= 400) break;
      if (hop >= maxRedirects) {
        return refusal(TransportRefusal.REDIRECT_LIMIT, `the source redirected more than ${maxRedirects} times`);
      }
      const location = response.headers?.get?.('location');
      if (!location) return refusal(TransportRefusal.REDIRECT_WITHOUT_LOCATION, `the source answered ${response.status} without a location to follow`);
      const next = checkSource(new URL(location, current).toString());
      if (!next.allowed) return refusal(next.kind, `a redirect led somewhere this installation will not fetch from: ${next.reason}`);
      current = next.url;
    }
  } catch (error) {
    if (signal?.aborted) return refusal(TransportRefusal.CANCELLED, 'the acquisition was cancelled');
    return refusal(TransportRefusal.TRANSPORT_ERROR, `the source could not be reached: ${error?.message ?? error}`);
  }

  if (!response.ok) {
    return refusal(TransportRefusal.HTTP_STATUS, `the source answered ${response.status}`, { status: response.status });
  }
  if (!response.body || typeof response.body.getReader !== 'function') {
    return refusal(TransportRefusal.NO_BODY, 'the source answered without a body to read');
  }

  // A declared length over the cap is refused before a single byte is written. It is a courtesy,
  // not the enforcement: the count below is what actually holds.
  const declaredLength = Number(response.headers?.get?.('content-length') ?? NaN);
  const totalBytes = Number.isFinite(declaredLength) && declaredLength >= 0 ? declaredLength : null;
  if (cap && totalBytes !== null && totalBytes > cap) {
    return refusal(TransportRefusal.SIZE_CAP_EXCEEDED, `the artefact declares ${totalBytes} bytes, over the ${cap}-byte ceiling of this grant`, { totalBytes });
  }

  const hash = createHash('sha256');
  const reader = response.body.getReader();
  let received = 0;

  try {
    for (;;) {
      if (signal?.aborted) {
        await reader.cancel().catch(() => {});
        await sink.abort?.('cancelled');
        return refusal(TransportRefusal.CANCELLED, 'the acquisition was cancelled');
      }
      const { done, value } = await readWithDeadline(reader, stallTimeoutMs);
      if (done) break;
      if (!value?.length) continue;
      received += value.length;
      if (cap && received > cap) {
        await reader.cancel().catch(() => {});
        await sink.abort?.('size cap exceeded');
        return refusal(TransportRefusal.SIZE_CAP_EXCEEDED, `the artefact exceeded the ${cap}-byte ceiling of this grant`, { receivedBytes: received });
      }
      hash.update(value);
      await sink.write(value);
      onProgress?.({ receivedBytes: received, totalBytes });
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    await sink.abort?.(error?.message ?? 'transport error');
    if (signal?.aborted) return refusal(TransportRefusal.CANCELLED, 'the acquisition was cancelled');
    if (error instanceof ModelTransportError) return refusal(error.kind, error.reason, { receivedBytes: received });
    return refusal(TransportRefusal.TRANSPORT_ERROR, `the download failed: ${error?.message ?? error}`, { receivedBytes: received });
  }

  const digest = hash.digest('hex');
  if (digest !== String(expectedSha256).toLowerCase()) {
    // The sink is closed rather than abandoned: the caller quarantines what arrived, because
    // "what did I actually receive" is the first question asked when a digest does not match.
    await sink.close?.();
    return refusal(
      TransportRefusal.DIGEST_MISMATCH,
      'the artefact does not match the digest the publisher declared, so it will not be made startable',
      { digest, expected: String(expectedSha256).toLowerCase(), receivedBytes: received },
    );
  }
  await sink.close?.();
  return { ok: true, digest, bytes: received, source: current.toString() };
}
