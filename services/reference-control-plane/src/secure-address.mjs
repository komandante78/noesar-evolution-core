// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Saying out loud that this address cannot sign a browser in.
//
// WHY THIS EXISTS, AND WHY IT IS NOT A COSMETIC FIX. Once TLS is configured the session
// cookie carries `Secure` (server.mjs, `secureCookies`) — it must, because serving a
// non-Secure cookie over a connection this process just encrypted is the misconfiguration
// that default exists to prevent. The consequence is on the OTHER side of the wire and is
// easy to miss: a browser refuses to STORE a `Secure` cookie that arrived over `http://`.
//
// So on the plain listener a browser sign-in fails in the worst possible shape, measured on a
// real browser against a throwaway installation in `D-0364`:
//
//   POST /api/v1/auth/login/mfa  ->  200, a user object, "signed in"
//   cookies the browser kept     ->  none
//   GET  /api/v1/auth/me         ->  401
//
// Nothing is logged, nothing is shown, and the person lands back on the sign-in screen having
// done everything right. `curl` is more forgiving — it keeps the cookie and sends it back over
// plaintext — so the same flow tested from a terminal passes, which is precisely how this
// survived: every automated check of it ran in something that is not a browser.
//
// WHY IT ANSWERS WITH A FACT AND NOT A REDIRECT. Redirecting the plain listener to the
// encrypted one was the obvious fix and was rejected: this process knows the port it LISTENS
// on, not the port the operator PUBLISHED it as, and those differ on any installation whose
// run command maps them differently. A redirect built from a guessed port strands the browser
// somewhere that does not answer, on the address that was working a moment ago, with no way
// back. So the encrypted address is a declaration — `NOESAR_PUBLIC_TLS_URL` — and when it is
// absent the product states the problem without inventing the destination, which is the rule
// `D-0055` already applies to the bind address and tls.mjs to the certificate pair.

/**
 * Whether a browser arriving on THIS connection could complete a sign-in, and where it should
 * go if not.
 *
 * @param {object} options
 * @param {boolean} options.encrypted        did this request arrive over TLS
 * @param {boolean} options.secureCookies    is the session cookie issued with `Secure`
 * @param {boolean} options.tlsListenerExists is there a separate encrypted listener at all
 * @param {string|null} options.publicTlsUrl `NOESAR_PUBLIC_TLS_URL`, or null
 */
export function browserSignIn({ encrypted, secureCookies, tlsListenerExists, publicTlsUrl }) {
  // Encrypted already, or cookies that a browser will keep over plaintext: nothing to say.
  // The second case is a real configuration — an installation with no TLS at all — and it is
  // not a degraded one, so it must not be reported as a problem.
  if (encrypted || !secureCookies) {
    return { browserSignInPossible: true, secureAddress: null, reason: null };
  }

  const address = normaliseHttpsUrl(publicTlsUrl);
  return {
    browserSignInPossible: false,
    secureAddress: address,
    reason: tlsListenerExists
      ? 'This installation issues its session cookie with the Secure attribute, and a browser '
        + 'will not keep such a cookie from an unencrypted page. Signing in here appears to '
        + 'succeed and then leaves you signed out. Use the encrypted address instead.'
      // No second listener means the MAIN one is the encrypted one, so an unencrypted request
      // reaching this code arrived through something in front of the product. Naming the
      // wrong cause would send an operator looking in the wrong place.
      : 'This request reached the product unencrypted while its own listener is encrypted, so '
        + 'something in front of it terminated TLS without telling the product '
        + '(NOESAR_SECURE_COOKIES). A browser will not keep the session cookie it issues.',
  };
}

/**
 * Whether this request is a browser opening a PAGE on the plain listener that should be sent to
 * the encrypted one instead.
 *
 * A warning on the sign-in screen was the first answer (D-0365) and it was not enough: it only
 * reaches somebody who reloads. The Owner's browser held a tab opened before that shipped, so
 * every attempt went on failing against a page that predated the explanation — measured in the
 * request log, where the whole sequence carries no `GET /` and no `/api/v1/auth/status`, which
 * a page load would both produce. A bookmark is not refreshed by a deploy.
 *
 * Narrow on purpose, and each condition is load-bearing:
 *   - only when the destination is DECLARED, never guessed. The reason a redirect was rejected
 *     in D-0365 still holds — this process knows the port it listens on, not the one it was
 *     published as — and `NOESAR_PUBLIC_TLS_URL` is what removes the guess.
 *   - only page loads. An API client is not confused about where it is, and Debug Evolution
 *     calls this control plane over plaintext with a service token BY DESIGN: redirecting it
 *     would detach the module, which is the exact breakage NOESAR_TLS_PORT exists to avoid.
 *   - never the certificate routes. They are how a device comes to trust the destination, so
 *     redirecting them into that destination is the loop this whole page exists to break.
 */
export function shouldRedirectToSecure({ encrypted, method, accept, pathname, publicTlsUrl, secureCookies }) {
  if (encrypted || !secureCookies) return null;
  if (method !== 'GET' && method !== 'HEAD') return null;
  if (!String(accept ?? '').includes('text/html')) return null;
  if (pathname === '/ca' || pathname === '/ca/' || pathname.startsWith('/ca.crt')) return null;
  if (pathname.startsWith('/api/')) return null;
  return normaliseHttpsUrl(publicTlsUrl);
}

/**
 * Accept only an absolute https URL, and hand back its origin.
 *
 * A malformed or plain-http declaration becomes `null` rather than being passed through: this
 * string is put in front of a person as the address that WILL work, and one that does not is
 * worse than saying nothing — it moves the failure somewhere they cannot diagnose.
 */
export function normaliseHttpsUrl(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:') return null;
  return parsed.origin;
}
