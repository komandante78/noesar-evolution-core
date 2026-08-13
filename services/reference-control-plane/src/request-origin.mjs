// SPDX-License-Identifier: AGPL-3.0-or-later
//
// What origin a request came from — `D-0426`.
//
// One line of `server.mjs` used to answer this:
//
//     `${req.headers['x-forwarded-proto'] ?? 'http'}://${req.headers.host}`
//
// which is right behind a reverse proxy and **wrong on this product's own TLS listener**, where
// no proxy sets that header and the connection is nonetheless encrypted. The origin came out as
// `http://host:8443` while the browser sent `https://host:8443`, so every comparison against it
// failed over HTTPS and succeeded over plain HTTP.
//
// Two features compare against it, and both broke on the TLS listener in exactly the same way:
//
//   * the CodeN bridge's handshake, which refuses a foreign Origin **before** it looks at the
//     session — so the socket was refused 403, closed without a close frame, and the browser
//     reported `1006` and reconnected forever. Measured on the live installation, not inferred:
//     twelve `coden bridge refused a foreign origin` lines with `origin: https://<host>:8443`;
//   * WebAuthn registration and authentication, which sign over the origin — so a passkey
//     enrolled over HTTPS could not verify.
//
// The comment above the bridge's two listeners says it is attached to both so that the browser
// cannot "work over http and silently fail over https". That is the exact failure this helper
// reintroduced one function away, which is why the answer now lives in a file of its own with
// its own tests instead of inline in a 4,600-line module.
//
// It is deliberately NOT more permissive than what it replaces: `x-forwarded-proto` is still
// trusted where it is present, because a reverse proxy is the only thing that can know the
// scheme the client used. What changes is the fallback — the socket itself, which knows whether
// TLS terminated here, instead of the assumption that it did not.

/** The first value of a possibly-comma-joined forwarded header, normalised. Proxies chain, and
 *  `x-forwarded-proto: https, http` means the CLIENT spoke https to the first hop. */
function forwardedScheme(header) {
  const first = String(header ?? '').split(',')[0].trim().toLowerCase();
  return first === 'https' || first === 'http' ? first : null;
}

/**
 * `http` or `https`, from the proxy header when there is one and from the connection itself
 * when there is not. `req.socket.encrypted` is set by Node on a TLS socket and is absent on a
 * plain one — the only fact available that cannot be spoofed by a header.
 */
export function requestScheme(req) {
  return forwardedScheme(req?.headers?.['x-forwarded-proto'])
    ?? (req?.socket?.encrypted ? 'https' : 'http');
}

/**
 * The origin this request claims to come from, in the exact form a browser puts in `Origin`:
 * scheme, host and — because `req.headers.host` carries it — the port when it is not the
 * default for that scheme.
 */
export function requestOrigin(req) {
  return `${requestScheme(req)}://${req?.headers?.host ?? ''}`;
}
