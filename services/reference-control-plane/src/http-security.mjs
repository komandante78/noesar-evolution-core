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
