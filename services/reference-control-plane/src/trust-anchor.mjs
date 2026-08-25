// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The other bootstrap route: how a device that has only this installation comes to trust it.
//
// WHY IT EXISTS. `NOESAR_TLS_PORT` (D-0358) gave this installation a TLS listener, and the
// reason it was added was not hardening — it was that `navigator.mediaDevices` does not exist
// outside a secure context, so without it the camera cannot start at all. But a TLS
// listener whose certificate no device trusts buys nothing: every browser refuses the page,
// and a person clicking through the warning gets a connection the browser still classes as
// insecure, which does NOT restore the secure context. The missing step was never code — it
// was a file, `ca.crt`, arriving on a phone.
//
// Before this route the only way was to be logged into the host with the right to talk to the
// container engine, and run `docker cp`. That is the same shape of problem `/cli` was written
// to abolish (cli-downloads.mjs), and the same answer applies: the port is already open and
// already serving the page, so the bytes are served from it.
//
// WHAT IS DELIBERATELY UNAUTHENTICATED, AND WHY THAT IS NOT A CONCESSION. A certificate
// authority certificate is a public key and a name. It carries no secret — the thing that
// must never leave this host is `ca.key`, which this module never reads, never names, and
// cannot be asked for: there is no code path here that takes a filename from a request.
// Requiring a session would be the same loop `/cli` describes, one floor down: the session is
// carried by a cookie the browser will only send over a connection it trusts, and this file
// is what makes it trust the connection.
//
// THE PART THAT IS NOT SOLVED BY SERVING IT, AND IS NOT PRETENDED TO BE. This file is fetched
// over plaintext, by a device that by definition cannot yet verify who answered. Anyone on the
// same network can answer instead, with their own CA, and a device that installs it will trust
// their certificates for every host it names — this is strictly worse than no TLS, because it
// looks like TLS. There is no cryptographic fix available at this layer: the anchor is the
// thing being fetched, so nothing on the wire can authenticate it. The only real defence is
// an out-of-band comparison, so the SHA-256 fingerprint is put in front of the operator in
// three places that do not share a failure — the boot log, this page, and the dialog the
// device's own OS shows at install time. `renderTrustAnchorIndex` therefore states the
// comparison as a required step, not as advice.
//
// WHAT IS SERVED IS THE ANCHOR, NOT "THE CA". The certificate a device must be told to trust
// is whichever one terminates the chain. For a certificate issued by a local CA that is the
// CA; for a self-signed certificate the leaf IS the anchor and there is no CA file to point
// at. Both are real configurations of this product, so both are resolved — and anything else
// (a certificate from a CA the product was not given) is reported as such rather than guessed
// at, which is the rule tls.mjs already states for the cert/key pair itself.

import { createHash, X509Certificate } from 'node:crypto';
import { readFileSync } from 'node:fs';

// A CA certificate is one to four kilobytes. The cap is here for the same reason
// cli-downloads.mjs has one: a misconfigured path must not turn this route into a way to
// read a large file out of the host.
export const MAX_TRUST_ANCHOR_BYTES = 64 * 1024;

/** The filename a browser is told to save, and the type that makes an OS offer to install it. */
export const TRUST_ANCHOR_BASENAME = 'ca.crt';
export const TRUST_ANCHOR_CONTENT_TYPE = 'application/x-x509-ca-cert';

/** Every route this module answers. Derived from one literal, never hand-listed twice. */
export const TRUST_ANCHOR_ROUTES = Object.freeze([
  '/ca', '/ca/', `/${TRUST_ANCHOR_BASENAME}`, `/${TRUST_ANCHOR_BASENAME}.sha256`,
]);

function unavailable(reason) {
  return { available: false, reason, pem: null, fingerprintSha256: null, fileSha256: null, subject: null, notAfter: null, source: null };
}

/**
 * Resolve the certificate a device must be told to trust for this installation, or state
 * precisely why there is none to serve.
 *
 * Never throws. A misconfigured `NOESAR_TLS_CA_FILE` makes this route unavailable with a
 * reason the caller can log and display; it does not stop a process whose TLS is otherwise
 * working. That is the proportionate choice and the reason is deliberately recorded: refusing
 * to boot would take down a healthy listener over a convenience route, while serving the file
 * anyway would hand devices an anchor that did not sign anything they will ever see.
 *
 * @param {object} options
 * @param {{ active: boolean, cert: string|null }} options.tls  the pair resolveTls() returned
 * @param {NodeJS.ProcessEnv} options.env
 * @param {(path: string) => Buffer} options.readFile  injected for tests
 */
export function resolveTrustAnchor({ tls, env = process.env, readFile = readFileSync } = {}) {
  if (!tls?.active || !tls.cert) {
    return unavailable('This installation serves plaintext; there is no certificate to trust.');
  }

  let leaf;
  try {
    leaf = new X509Certificate(tls.cert);
  } catch (error) {
    // resolveTls() already checked for a BEGIN CERTIFICATE marker, so reaching here means the
    // bytes carry the marker and are still not a certificate. Reported, not assumed away.
    return unavailable(`The configured certificate could not be parsed: ${error.message}`);
  }

  const caFile = (env.NOESAR_TLS_CA_FILE ?? '').trim();

  if (!caFile) {
    // Self-signed is the one case that needs no second file: the leaf terminates its own chain.
    //
    // `verify` here is belt-and-braces, and is labelled as such rather than credited with a
    // test it does not have. Deleting it survives mutation testing, because no certificate
    // could be constructed that satisfies `checkIssued(itself)` without also being signed by
    // its own key: OpenSSL's issued-by check rejected every self-issued-but-foreign-signed
    // form that could be built (CA:FALSE, CA:TRUE, and with the key identifiers forced to
    // match). That premise is pinned by a test, so if it ever stops holding the suite says so
    // rather than leaving this line quietly load-bearing and unexercised.
    if (leaf.checkIssued(leaf) && leaf.verify(leaf.publicKey)) {
      return describe(Buffer.from(tls.cert, 'utf8'), leaf, 'the self-signed certificate this installation serves');
    }
    return unavailable(
      'This installation\'s certificate was issued by a certificate authority, and the authority\'s '
      + 'own certificate was not given to the product. Set NOESAR_TLS_CA_FILE to it to serve it here. '
      + '(If the issuer is a public authority, nothing needs installing on any device.)',
    );
  }

  let bytes;
  try {
    bytes = readFile(caFile);
  } catch (error) {
    return unavailable(`NOESAR_TLS_CA_FILE (${caFile}) could not be read: ${error.message}`);
  }
  if (bytes.length === 0 || bytes.length > MAX_TRUST_ANCHOR_BYTES) {
    return unavailable(`NOESAR_TLS_CA_FILE (${caFile}) is ${bytes.length} bytes, which is outside the 1..${MAX_TRUST_ANCHOR_BYTES} accepted.`);
  }

  let ca;
  try {
    ca = new X509Certificate(bytes);
  } catch (error) {
    return unavailable(`NOESAR_TLS_CA_FILE (${caFile}) is not a PEM certificate: ${error.message}`);
  }

  // The check that makes this route safe to point a device at. An operator who names the
  // wrong file — an old CA, another installation's, the leaf of some unrelated service —
  // would otherwise have every device trust an authority that signs nothing they will meet,
  // which is a durable, silent, device-side change that is tedious to undo. Names first,
  // then the signature: `checkIssued` alone is satisfied by a forgery that copies the name.
  if (!leaf.checkIssued(ca) || !leaf.verify(ca.publicKey)) {
    return unavailable(
      `NOESAR_TLS_CA_FILE (${caFile}) did not issue the certificate this installation serves `
      + `(certificate issuer is "${leaf.issuer.replace(/\n/g, ', ')}"). Refusing to publish it: a device that `
      + 'installed it would trust an authority unrelated to this installation.',
    );
  }

  return describe(bytes, ca, `NOESAR_TLS_CA_FILE (${caFile})`);
}

function describe(bytes, certificate, source) {
  return {
    available: true,
    reason: null,
    pem: bytes.toString('utf8'),
    // The fingerprint an operating system shows in its "install this certificate?" dialog:
    // SHA-256 over the DER. Deliberately kept distinct from fileSha256 below, because they
    // are different numbers over the same certificate and comparing one against the other
    // looks exactly like being attacked.
    fingerprintSha256: certificate.fingerprint256,
    fileSha256: createHash('sha256').update(bytes).digest('hex'),
    subject: certificate.subject.replace(/\n/g, ', '),
    notAfter: certificate.validTo,
    source,
  };
}

/**
 * The human page at /ca.
 *
 * Plain text, like /cli, and for a stronger reason: this page is read on a phone that does
 * not trust this server yet, so it arrives over plaintext HTTP where a stylesheet would not.
 */
export function renderTrustAnchorIndex(anchor, baseUrl) {
  const base = String(baseUrl ?? '').replace(/\/+$/, '');
  const lines = ['NOESAR EVOLUTION — trust this installation on this device', ''];

  if (!anchor?.available) {
    lines.push(
      'There is nothing to install from here.',
      '',
      anchor?.reason ?? 'No certificate is configured.',
      '',
    );
    return `${lines.join('\n')}\n`;
  }

  lines.push(
    'A browser only exposes the camera in a secure context. Until this',
    'device trusts the certificate below, this installation has no secure context on it —',
    'clicking through the browser warning does NOT create one.',
    '',
    `  Certificate:  ${anchor.subject}`,
    `  Valid until:  ${anchor.notAfter}`,
    `  SHA-256:      ${anchor.fingerprintSha256}`,
    '',
    'STEP 1 — download it:',
    '',
    `    ${base}/${TRUST_ANCHOR_BASENAME}`,
    '',
    'STEP 2 — compare the fingerprint. This is not optional. This page reached you over a',
    'connection nothing has authenticated, so anyone on this network could have answered it',
    'with their own certificate. Your device shows a SHA-256 when it asks whether to install,',
    'and it must match the line above character for character.',
    '',
    'Get the number you compare against from the SERVER, not from the file you just',
    'downloaded — reading the downloaded file back would confirm whatever you were sent. On',
    'the machine running the engine, either read the start-up line `trust-anchor.published`',
    'from its log, or run:',
    '',
    '    docker exec noesar-evolution \\',
    '        openssl x509 -in /workspace/tls/ca.crt -noout -fingerprint -sha256',
    '',
    'If they differ, stop: do not install it.',
    '',
    'STEP 3 — install it:',
    '',
    '  Android    Settings > Security > More settings > Encryption & credentials >',
    '             Install a certificate > CA certificate. Android warns loudly here; that',
    '             warning is about exactly the substitution STEP 2 rules out.',
    '  iOS/iPadOS Open the link in Safari > Allow > Settings > Profile Downloaded > Install.',
    '             THEN, separately: Settings > General > About > Certificate Trust Settings,',
    '             and switch this certificate on. iOS installs and trusts in two steps and',
    '             the second one is easy to miss — without it nothing changes.',
    '  macOS      Open the file > Keychain Access > System > double-click it > Trust >',
    '             "When using this certificate: Always Trust".',
    '  Windows    Double-click > Install Certificate > Local Machine > "Place all certificates',
    '             in the following store" > Trusted Root Certification Authorities.',
    '  Linux      Copy to /usr/local/share/ca-certificates/ and run update-ca-certificates.',
    '             Firefox and Chrome keep their own stores; Firefox: Settings > Privacy &',
    '             Security > View Certificates > Authorities > Import.',
    '',
    'STEP 4 — reach this installation by a name or address the certificate covers, over',
    'https://. A certificate is trusted for the names inside it and nothing else, so',
    'https://localhost and https://<the LAN address> are not interchangeable.',
    '',
    'Also served here:',
    '',
    `    /${TRUST_ANCHOR_BASENAME}.sha256   the digest of the FILE (for sha256sum), which is a`,
    '                    different number from the fingerprint above — that one is taken over',
    '                    the certificate itself and is what your device will show you.',
    '',
  );
  return `${lines.join('\n')}\n`;
}
