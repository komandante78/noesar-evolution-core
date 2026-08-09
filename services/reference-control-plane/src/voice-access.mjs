// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Whether the person asking can actually use a microphone, and — if not — the shortest way
// for THEM to get one.
//
// WHY THIS IS SEPARATE FROM voiceReadiness(). That function answers "are the speech servers
// reachable", which is about this host. It can answer READY, truthfully, while the microphone
// does not exist in the browser asking — because a microphone is gated by the browser's own
// rule about secure contexts, not by anything on this side of the wire. The interface could
// therefore report voice as available and offer a button that cannot work, which is the shape
// of confusion the Owner met and named: *«ma un cliente deve fare tutti questi passaggi?»*
//
// THE THREE WAYS TO HAVE VOICE, AND WHY THE ORDER MATTERS. Two of them cost nothing, and until
// this module existed the product mentioned neither, so every person met the third one first:
//
//   1. an encrypted connection — works everywhere, needs the certificate installed once;
//   2. **the machine running the engine** — `http://localhost` and `http://127.0.0.1` are
//      "potentially trustworthy origins" by browser rule, so the microphone is there with no
//      TLS, no certificate and no configuration at all. Measured, not assumed: a plain HTTP
//      server answered `isSecureContext: true` and exposed `getUserMedia` on both names, and
//      `false`/absent on its LAN address, same server, same browser, same moment;
//   3. an installation with no TLS at all, reached from another device — voice is genuinely
//      unavailable there, and saying so is the honest answer rather than a defect.
//
// So the certificate is not the price of admission to the product. It is the price of using a
// microphone FROM ANOTHER DEVICE, and it is offered as such — last, and only when the two free
// answers do not apply.
//
// WHY THE FINGERPRINT IS CARRIED HERE. `/ca` publishes it too, but that page is fetched over a
// connection nothing has authenticated, so it can only ask the reader to compare it against the
// server's own log (D-0364). This module answers on an AUTHENTICATED session: the person is
// already signed in, over a channel that is either encrypted or loopback. That makes this the
// one place the product can hand over the fingerprint and have it mean something — the phone
// dialog is compared against a screen the person is already trusted on, and the log-reading
// ceremony disappears.

/** Loopback names a browser treats as a secure context without any certificate. */
const TRUSTWORTHY_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

/**
 * @param {object} options
 * @param {boolean} options.encrypted   did this request arrive over TLS
 * @param {string} options.host         the Host header, exactly as the client reached us
 * @param {{available:boolean, fingerprintSha256:string|null, subject:string|null}} options.trustAnchor
 * @param {string|null} options.secureAddress  the declared https origin, if any
 */
export function voiceAccess({ encrypted, host, trustAnchor, secureAddress }) {
  const { hostname, port } = splitHost(host);
  const onLoopback = TRUSTWORTHY_HOSTS.has(hostname);
  const usable = Boolean(encrypted) || onLoopback;

  if (usable) {
    return {
      microphoneUsableHere: true,
      // Named even when everything works, because it is the answer to "why does it work on my
      // laptop and not on my phone" — a question that otherwise looks like a fault.
      reason: encrypted ? 'encrypted-connection' : 'loopback-address',
      alternatives: [],
    };
  }

  const alternatives = [];
  // The free one first. Only offered with the port the client actually reached us on, so it
  // cannot name a port this installation was never published as.
  if (port) {
    alternatives.push({
      kind: 'SAME_MACHINE',
      url: `http://localhost:${port}`,
      appliesWhen: 'you are using the machine that runs NOESAR',
      cost: 'nothing to install',
    });
  }
  if (trustAnchor?.available && secureAddress) {
    alternatives.push({
      kind: 'INSTALL_CERTIFICATE',
      certificateUrl: `http://${host}/ca`,
      secureUrl: secureAddress,
      fingerprintSha256: trustAnchor.fingerprintSha256,
      certificateSubject: trustAnchor.subject,
      appliesWhen: 'you are using another device, such as a phone',
      cost: 'install one certificate, once per device',
    });
  }
  return {
    microphoneUsableHere: false,
    // The browser's rule, stated as the browser's rule. An interface that says "voice is
    // unavailable" invites a support request; one that says why invites an action.
    reason: 'insecure-context',
    alternatives,
  };
}

function splitHost(host) {
  const raw = String(host ?? '').trim();
  if (!raw) return { hostname: '', port: '' };
  // IPv6 literals arrive bracketed; the last colon is only a port separator outside them.
  if (raw.startsWith('[')) {
    const close = raw.indexOf(']');
    if (close < 0) return { hostname: raw.toLowerCase(), port: '' };
    return { hostname: raw.slice(0, close + 1).toLowerCase(), port: raw.slice(close + 2) };
  }
  const colon = raw.lastIndexOf(':');
  if (colon < 0) return { hostname: raw.toLowerCase(), port: '' };
  return { hostname: raw.slice(0, colon).toLowerCase(), port: raw.slice(colon + 1) };
}
