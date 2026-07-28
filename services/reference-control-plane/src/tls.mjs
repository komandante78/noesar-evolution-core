// SPDX-License-Identifier: AGPL-3.0-or-later
//
// TLS termination, in-process.
//
// This product ships no reverse proxy and installs no new host tooling (CLAUDE10 rule 45),
// so a certificate is never generated here. Which name the certificate is for, whether it
// is self-signed or CA-issued, and how it is rotated are host and operator decisions — the
// same reasoning D-0055 already applies to bind address: the product refuses to guess
// rather than making one silently. What this module owns is narrower: read a cert/key pair
// the operator supplies, and refuse a half-configured pair instead of falling back to
// plaintext without saying so.
//
// The two files are read once, at startup, exactly like the setup token file (setup-token.mjs)
// and for the same reason: `docker inspect` and /proc/<pid>/environ both expose environment
// variables, so certificate and key material never travels as one.
import { readFileSync } from 'node:fs';

/**
 * Resolve the TLS certificate/key pair for this installation, or declare that none is
 * configured.
 *
 * @param {object} options
 * @param {NodeJS.ProcessEnv} options.env
 * @param {(path: string, encoding: 'utf8') => string} options.readFile  injected for tests
 * @returns {{ active: boolean, certFile: string|null, keyFile: string|null, cert: string|null, key: string|null }}
 */
export function resolveTls({ env = process.env, readFile = readFileSync } = {}) {
  const certFile = env.NOESAR_TLS_CERT_FILE || null;
  const keyFile = env.NOESAR_TLS_KEY_FILE || null;

  if (!certFile && !keyFile) {
    return { active: false, certFile: null, keyFile: null, cert: null, key: null };
  }
  if (!certFile || !keyFile) {
    // A pair half-supplied is refused, not filled in with a guess: the missing half
    // is exactly the failure mode that would otherwise serve plaintext silently while
    // an operator believes TLS is configured.
    throw Object.assign(
      new Error(
        'NOESAR_TLS_CERT_FILE and NOESAR_TLS_KEY_FILE must both be set, or neither. '
        + `Only ${certFile ? 'NOESAR_TLS_CERT_FILE' : 'NOESAR_TLS_KEY_FILE'} is set.`,
      ),
      { code: 'TLS_PARTIAL_CONFIG' },
    );
  }

  let cert;
  let key;
  try {
    cert = readFile(certFile, 'utf8');
  } catch (error) {
    throw Object.assign(new Error(`NOESAR_TLS_CERT_FILE (${certFile}) could not be read: ${error.message}`), { code: 'TLS_CERT_UNREADABLE', cause: error });
  }
  try {
    key = readFile(keyFile, 'utf8');
  } catch (error) {
    throw Object.assign(new Error(`NOESAR_TLS_KEY_FILE (${keyFile}) could not be read: ${error.message}`), { code: 'TLS_KEY_UNREADABLE', cause: error });
  }
  if (!cert.includes('BEGIN CERTIFICATE')) {
    throw Object.assign(new Error(`NOESAR_TLS_CERT_FILE (${certFile}) does not look like a PEM certificate (no "BEGIN CERTIFICATE" marker).`), { code: 'TLS_CERT_MALFORMED' });
  }
  if (!key.includes('PRIVATE KEY')) {
    throw Object.assign(new Error(`NOESAR_TLS_KEY_FILE (${keyFile}) does not look like a PEM private key (no "PRIVATE KEY" marker).`), { code: 'TLS_KEY_MALFORMED' });
  }

  return { active: true, certFile, keyFile, cert, key };
}
