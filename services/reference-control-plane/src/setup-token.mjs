// SPDX-License-Identifier: AGPL-3.0-or-later
//
// First-owner bootstrap token.
//
// The token must not travel as an environment variable: `docker inspect` and
// /proc/<pid>/environ both expose it, and it ends up in shell history and in
// container inspection output. It therefore lives in a single runtime file with
// mode 0600 that only the container user can read, and the operator reads it from
// the bind mount on the host.
//
// It is never logged in full. Only a short fingerprint is emitted, which is enough
// to confirm that the operator is looking at the current token and useless to
// anyone who intercepts the log.
import { chmodSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { dirname } from 'node:path';

export const DEFAULT_TTL_HOURS = 72;

export function fingerprint(token) {
  return createHash('sha256').update(String(token)).digest('hex').slice(0, 12);
}

/**
 * Resolve the setup token for this installation.
 *
 * Precedence:
 *   1. `NOESAR_SETUP_TOKEN` — explicit override, used by the smoke tools and tests.
 *   2. `NOESAR_SETUP_TOKEN_FILE` — the deployed path. Generated on first run.
 *   3. none — first-run setup is unavailable and says so.
 *
 * @param {object} options
 * @param {boolean} options.alreadyInitialized  when true, no token is generated:
 *        a configured installation has no first-run flow left to protect.
 */
export function resolveSetupToken({
  env = process.env,
  alreadyInitialized = false,
  ttlHours = Number(env.NOESAR_SETUP_TOKEN_TTL_HOURS ?? DEFAULT_TTL_HOURS),
  clock = Date.now,
  logger = null,
} = {}) {
  if (env.NOESAR_SETUP_TOKEN) {
    return { token: env.NOESAR_SETUP_TOKEN, source: 'environment', path: null, generated: false, fingerprint: fingerprint(env.NOESAR_SETUP_TOKEN) };
  }
  const path = env.NOESAR_SETUP_TOKEN_FILE;
  if (!path) return { token: null, source: 'none', path: null, generated: false, fingerprint: null };
  if (alreadyInitialized) {
    return { token: null, source: 'not-required', path, generated: false, fingerprint: null };
  }

  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });

  if (existsSync(path)) {
    const token = readFileSync(path, 'utf8').trim();
    const ageMs = clock() - statSync(path).mtimeMs;
    const expired = ageMs > ttlHours * 3_600_000;
    if (token && !expired) {
      // Re-assert the mode: a token file that became readable is a finding, not a
      // detail, and repairing it is cheaper than discovering it later.
      chmodSync(path, 0o600);
      return { token, source: 'file', path, generated: false, rotated: false, fingerprint: fingerprint(token) };
    }
    if (expired) {
      logger?.warn('setup-token.expired', { component: 'auth', path, age_hours: Math.round(ageMs / 3_600_000), ttl_hours: ttlHours });
    }
  }

  const token = randomBytes(32).toString('base64url');
  writeFileSync(path, `${token}\n`, { encoding: 'utf8', mode: 0o600 });
  chmodSync(path, 0o600);
  logger?.warn('setup-token.generated', {
    component: 'auth', path, ttl_hours: ttlHours,
    // A fingerprint, never the token.
    setup_fingerprint: fingerprint(token),
    note: 'read the token from this file on the host; it is never printed in full',
  });
  return { token, source: 'file', path, generated: true, rotated: existsSync(path), fingerprint: fingerprint(token) };
}
