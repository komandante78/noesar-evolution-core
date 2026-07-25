// SPDX-License-Identifier: AGPL-3.0-or-later
export function securityHeaders({ contentSecurityPolicy = false, secureTransport = false } = {}) {
  const headers = {
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    'referrer-policy': 'no-referrer',
    'cross-origin-opener-policy': 'same-origin',
    'cross-origin-resource-policy': 'same-origin',
    'permissions-policy': 'camera=(self), microphone=(self), display-capture=(self), geolocation=(), payment=(), usb=()',
    'cache-control': 'no-store',
  };
  if (contentSecurityPolicy) headers['content-security-policy'] = "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";
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
 * May /metrics be served without a session?
 *
 * Only when the port is published on loopback AND the peer is a private address. On
 * a loopback publish, "private peer" really does mean "a process on this host",
 * because nothing else can reach the port at all. As soon as the port is published
 * on a LAN address or a wildcard, that equivalence is false and the exporter — which
 * carries request paths, status codes, safe-mode state and log volume — must be
 * behind authentication like every other non-health endpoint.
 */
export function allowsUnauthenticatedMetrics(bindScope, peerAddress) {
  return bindScope === BindScope.LOOPBACK && isInternalAddress(peerAddress);
}
