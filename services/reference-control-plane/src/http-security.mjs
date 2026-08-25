// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The policy for the ONE document that hosts the terminal emulator — `D-0418`.
 *
 * xterm.js cannot render under `style-src 'self'`. Measured in a real browser: 72 refusals, from
 * three injected `<style>` elements (viewport, dimensions, theme) and from `_addStyle`, which
 * writes a `style` ATTRIBUTE per painted cell. A nonce cannot cover style attributes, the values
 * are per-cell and unbounded so hashes cannot either, and the vendored bundle has no nonce
 * support at all (0 occurrences of the word). The relaxation is unavoidable; what is avoidable
 * is granting it to the document where the operator's data, forms and session live.
 *
 * So it is granted HERE and only here: a document that contains one element, loads one module,
 * and has no form, no navigation and no operator data of its own. Everything else stays exactly
 * as strict as it was — `script-src 'self'`, no `unsafe-eval`, no external origin — and two
 * things are TIGHTER than the main policy: `form-action 'none'` (this document submits nothing)
 * and no `media-src` (it plays nothing).
 *
 * `frame-ancestors 'self'` and `x-frame-options: SAMEORIGIN` replace `'none'`/`DENY`, because a
 * document nothing may frame cannot be embedded by the page that needs it. Same-origin only:
 * another site still cannot frame it.
 */
const EMBEDDED_TERMINAL_CSP = "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'";

const MAIN_CSP = "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";

export function securityHeaders({ contentSecurityPolicy = false, secureTransport = false, embeddedTerminal = false } = {}) {
  const headers = {
    'x-content-type-options': 'nosniff',
    'x-frame-options': embeddedTerminal ? 'SAMEORIGIN' : 'DENY',
    'referrer-policy': 'no-referrer',
    // `cross-origin-opener-policy` governs a TOP-LEVEL browsing context's relationship with the
    // window that opened it. A document that exists only inside a frame has no such window, so
    // the header does nothing there but produce a console error on every plain-HTTP install
    // ("the URL's origin was untrustworthy") — noise in exactly the place a real console error
    // must stand out. Dropped for the embedded document only; every other response keeps it.
    ...(embeddedTerminal ? {} : { 'cross-origin-opener-policy': 'same-origin' }),
    'cross-origin-resource-policy': 'same-origin',
    'permissions-policy': 'camera=(self), microphone=(), display-capture=(self), geolocation=(), payment=(), usb=()',
    'cache-control': 'no-store',
  };
  if (contentSecurityPolicy) headers['content-security-policy'] = embeddedTerminal ? EMBEDDED_TERMINAL_CSP : MAIN_CSP;
  if (secureTransport) headers['strict-transport-security'] = 'max-age=31536000; includeSubDomains';
  return headers;
}

export function validHostHeader(header, allowedHosts) {
  const raw = String(header ?? '').trim();
  if (!raw) return false;
  let hostname = raw;
  if (raw.startsWith('[')) hostname = raw.slice(1, raw.indexOf(']'));
  else hostname = raw.split(':')[0];
  return allowedHosts.has(hostname.toLowerCase());
}

// --- exposure scope ---------------------------------------------------------
//
// The process cannot observe the address the container is *published* on: it sees
// 0.0.0.0 inside its own namespace whether Docker forwards from 127.0.0.1 or from a
// LAN address. That distinction matters, because behind a published port every
// external caller arrives from the bridge gateway — an RFC1918 address — so
// "the peer is a private address" says nothing about who the peer actually is.
//
// The exposure scope is therefore *declared* by whoever published the port, and it
// defaults to the safe answer.

export const BindScope = Object.freeze({
  LOOPBACK: 'loopback',
  LAN: 'lan',
  CUSTOM: 'custom',
});

const WILDCARD_ADDRESSES = new Set(['0.0.0.0', '::', '[::]', '*']);

export function isLoopbackAddress(address) {
  const value = String(address ?? '').trim().replace(/^::ffff:/i, '').replace(/^\[|\]$/g, '');
  if (value === '::1' || value === 'localhost') return true;
  const parts = value.split('.');
  if (parts.length !== 4) return false;
  const octets = parts.map(Number);
  if (octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) return false;
  return octets[0] === 127;
}

export function isWildcardAddress(address) {
  return WILDCARD_ADDRESSES.has(String(address ?? '').trim());
}

/**
 * Every RFC1918 / loopback address. Kept as a predicate of its own because it is a
 * genuine network fact — it is the *conclusion* drawn from it that has to be scoped.
 */
export function isInternalAddress(address) {
  const value = String(address ?? '').replace(/^::ffff:/i, '');
  if (value === '127.0.0.1' || value === '::1') return true;
  const parts = value.split('.').map(Number);
  if (parts.length !== 4 || parts.some(Number.isNaN)) return false;
  return parts[0] === 10 || parts[0] === 127
    || (parts[0] === 192 && parts[1] === 168)
    || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31);
}

/**
 * Resolve the exposure scope from the declared publish address, allowing an explicit
 * override. Unset means loopback: a new installation is only ever reachable locally
 * until somebody says otherwise.
 */
export function resolveBindScope({ bindAddress = null, bindScope = null } = {}) {
  const declared = String(bindScope ?? '').trim().toLowerCase();
  if (declared === BindScope.LOOPBACK || declared === BindScope.LAN || declared === BindScope.CUSTOM) {
    return declared;
  }
  const address = String(bindAddress ?? '').trim();
  if (!address) return BindScope.LOOPBACK;
  if (isLoopbackAddress(address)) return BindScope.LOOPBACK;
  if (isWildcardAddress(address)) return BindScope.CUSTOM;
  return BindScope.LAN;
}

/**
 * The one rule behind every unauthenticated disclosure of operational internals.
 *
 * Only when the port is published on loopback AND the peer is a private address. On
 * a loopback publish, "private peer" really does mean "a process on this host",
 * because nothing else can reach the port at all. As soon as the port is published
 * on a LAN address or a wildcard, that equivalence is false.
 *
 * Kept as a single predicate with named views over it rather than copied per
 * endpoint: the second endpoint to need this rule got it wrong for four phases by
 * not having it at all, and a third one deciding for itself is how they drift.
 */
function allowsUnauthenticatedInternals(bindScope, peerAddress) {
  return bindScope === BindScope.LOOPBACK && isInternalAddress(peerAddress);
}

/**
 * May /metrics be served without a session?
 *
 * The exporter carries request paths, status codes, safe-mode state and log volume,
 * so off a loopback publish it must sit behind authentication like every other
 * non-health endpoint.
 */
export function allowsUnauthenticatedMetrics(bindScope, peerAddress) {
  return allowsUnauthenticatedInternals(bindScope, peerAddress);
}

/**
 * May /healthz disclose its *detail* without a session?
 *
 * The aggregate — status, locality, timestamp, and the HTTP status code — is never
 * withheld from anyone: the container healthcheck, the three platform installers,
 * the update manager's post-start poll and the documented verification procedures
 * all depend on it, and it discloses nothing the status code does not already give.
 *
 * The detail is a different thing entirely. It names the exact build (so an attacker
 * can look up what that build is vulnerable to), the authority posture, the data
 * plane's server and extension versions, the full component inventory, the update
 * channel and the enabled debug scopes. On a LAN publish that is a free
 * reconnaissance report for every host on the subnet, which is what it was.
 */
export function allowsUnauthenticatedHealthDetail(bindScope, peerAddress) {
  return allowsUnauthenticatedInternals(bindScope, peerAddress);
}
