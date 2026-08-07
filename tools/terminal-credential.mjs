// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Where a remembered terminal keeps its token, and how (D-0348).
//
// This is a separate module from `tui-client.mjs` for one reason that has already cost this
// project a session: `main()` cannot be unit-tested — it opens a socket and blocks on stdin —
// so anything that lives inside it is exercised by nothing. `login()` had zero coverage behind
// 1885 green tests for exactly that reason (s330). The file handling for a ninety-day bearer
// token is not going in there.
//
// WHERE THE FILE GOES, and why the order is what it is:
//
//   1. $NOESAR_TERMINAL_CREDENTIAL   an explicit path always wins, so an operator or a test
//                                    can say exactly where, with no inference at all.
//   2. $XDG_CONFIG_HOME/...          the platform's own answer where the platform gives one.
//   3. $HOME/.config/...             the same answer spelled out, and ONLY when $HOME is a
//                                    real directory that exists.
//   4. $NOESAR_WORKSPACE/...         the container case, and it is not a fallback of
//                                    convenience: measured on the live installation, the
//                                    product's own container runs with `HOME=/nonexistent`
//                                    and a read-only rootfs. Candidates 2 and 3 are not
//                                    merely unusual there — they cannot be written at all,
//                                    and a terminal that "remembers" onto a tmpfs would
//                                    forget at every restart while claiming otherwise.
//
// If none of them resolves, this returns null and the caller says so. A credential path that
// cannot be determined is reported, never guessed at: writing a bearer token to a path chosen
// by a fallback nobody declared is how a secret ends up somewhere unexpected.
//
// FILE PERMISSION IS PART OF THE DESIGN, not hygiene applied afterwards. The token IS the
// authentication — the whole point is that no one types anything — so the only perimeter left
// is that the file is readable by its owner and nobody else. `writeCredential` creates the
// directory 0700 and the file 0600, and `readCredential` REFUSES a file that is group- or
// world-readable rather than using it: a token that everyone on the machine can read is not a
// possession factor, and silently accepting one would make the permission decorative.

import { chmodSync, mkdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import os from 'node:os';

export const CREDENTIAL_FILE_NAME = 'terminals.json';

/**
 * Decide where this machine's terminal credentials live.
 *
 * @param   {object} env  the environment to read (injected, never `process.env` by default,
 *                        so a test states the world it is testing instead of inheriting it)
 * @returns {{path:string, source:string}|null}
 */
export function credentialPath(env = {}) {
  const explicit = (env.NOESAR_TERMINAL_CREDENTIAL ?? '').trim();
  if (explicit) return { path: explicit, source: 'NOESAR_TERMINAL_CREDENTIAL' };

  const xdg = (env.XDG_CONFIG_HOME ?? '').trim();
  if (xdg) return { path: join(xdg, 'coden-evolution', CREDENTIAL_FILE_NAME), source: 'XDG_CONFIG_HOME' };

  const home = (env.HOME ?? '').trim();
  // `HOME=/nonexistent` is a real value on the product's own container, not a hypothetical:
  // it is set, it is absolute, and it is not a directory. Testing for existence rather than
  // for emptiness is the difference between this working there and appearing to.
  if (home && directoryExists(home)) {
    return { path: join(home, '.config', 'coden-evolution', CREDENTIAL_FILE_NAME), source: 'HOME' };
  }

  const workspace = (env.NOESAR_WORKSPACE ?? '').trim();
  if (workspace && directoryExists(workspace)) {
    return { path: join(workspace, 'config', 'coden-evolution', CREDENTIAL_FILE_NAME), source: 'NOESAR_WORKSPACE' };
  }
  return null;
}

function directoryExists(path) {
  try { return statSync(path).isDirectory(); } catch { return false; }
}

/** A label for the browser's list of remembered terminals. Never authority — just a name. */
export function terminalLabel() {
  let user = 'unknown';
  try { user = os.userInfo().username; } catch { /* no passwd entry for this uid — the container case */ }
  return `${user}@${os.hostname()}`;
}

/**
 * Read the token remembered for one endpoint, or null.
 *
 * Every failure returns null rather than throwing: a corrupt, missing, or too-permissive file
 * must degrade to "you are not remembered here, sign in once", which is a working product. A
 * throw here would make an unreadable file a terminal that cannot open AT ALL — turning a
 * cosmetic problem into the outage the requirement was written to prevent.
 */
export function readCredential(path, endpoint) {
  let raw;
  try { raw = readFileSync(path, 'utf8'); } catch { return null; }
  try {
    const mode = statSync(path).mode & 0o077;
    if (mode !== 0) return null;
  } catch { return null; }
  let parsed;
  try { parsed = JSON.parse(raw); } catch { return null; }
  const entry = parsed?.terminals?.[endpoint];
  if (!entry || typeof entry.token !== 'string' || !entry.token) return null;
  return { token: entry.token, rememberedAt: entry.rememberedAt ?? null };
}

/**
 * Remember a token for one endpoint, leaving any other endpoint's entry untouched.
 *
 * Keyed by endpoint because one home directory can reach two installations — a from-source
 * checkout and a container — and a single-valued file would have each quietly evict the other,
 * which reads to the operator as "it forgot me again" with nothing to see.
 */
export function writeCredential(path, endpoint, token) {
  let existing = {};
  try { existing = JSON.parse(readFileSync(path, 'utf8')) ?? {}; } catch { existing = {}; }
  const next = {
    version: 1,
    terminals: { ...(existing.terminals ?? {}), [endpoint]: { token, rememberedAt: new Date().toISOString() } },
  };
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  // Written 0600 by `writeFileSync`'s mode AND chmod'd after: the mode argument is a request
  // filtered through the process umask, so on a umask that strips nothing it is right and on
  // an unusual one it is not. The explicit chmod is what makes the guarantee a guarantee.
  writeFileSync(path, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
  chmodSync(path, 0o600);
  try { chmodSync(dirname(path), 0o700); } catch { /* a pre-existing directory we do not own */ }
  return path;
}

/** Forget one endpoint. The file survives if another endpoint still has an entry. */
export function clearCredential(path, endpoint) {
  let existing;
  try { existing = JSON.parse(readFileSync(path, 'utf8')); } catch { return false; }
  if (!existing?.terminals?.[endpoint]) return false;
  delete existing.terminals[endpoint];
  if (Object.keys(existing.terminals).length === 0) {
    try { unlinkSync(path); } catch { /* already gone */ }
    return true;
  }
  writeFileSync(path, `${JSON.stringify(existing, null, 2)}\n`, { mode: 0o600 });
  chmodSync(path, 0o600);
  return true;
}
