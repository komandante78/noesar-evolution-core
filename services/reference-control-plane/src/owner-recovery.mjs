// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The second way back in: proving you control the installation.
//
// WHY IT EXISTS ALONGSIDE RECOVERY CODES. Codes only help somebody who kept them, and the
// situation this was written for is the one where nobody did — the Owner, 2026-08-09, with a
// forgotten passphrase, no recovery codes, no passkey, and a setup token long since spent. A
// recovery feature that fails exactly that case is theatre.
//
// WHY IT IS NOT A BACK DOOR. The authority it uses is the one the FIRST owner was created with:
// `first-owner-setup.token` is written to the runtime config, readable only by the account the
// product runs as, and whoever can read it is by construction the person who installed this.
// Nothing new is trusted here — the same root, named a second time, for the same reason.
//
// WHY MINTING IS UNAUTHENTICATED, AND WHAT THAT DOES NOT GIVE AWAY. The request that asks for a
// token receives **nothing but a fingerprint**: the token itself only ever reaches the
// filesystem. So an anonymous caller can cause one file of a fixed name and fixed size to be
// written, and learns nothing. That is bounded on purpose — the alternative, requiring a session
// to ask for the thing that exists because you have no session, is the loop `/cli` and `/ca`
// already describe.
//
// The fingerprint IS returned, and that is deliberate rather than careless: it is what lets the
// person confirm that the file they are reading on the host is the one this request just made,
// rather than a stale one from an attempt three days ago.

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** Long enough that guessing is not a strategy; short enough to retype from a terminal. */
const TOKEN_BYTES = 32;
/** A proof that outlives the sitting it was minted for is a credential nobody is watching. */
export const PROOF_TTL_MS = 30 * 60_000;

export function proofPath(workspace) {
  return join(workspace, 'config/owner-recovery.token');
}

function fingerprint(token) {
  return createHash('sha256').update(String(token)).digest('hex').slice(0, 12);
}

/**
 * Write a fresh proof and return only what is safe to hand back over the network.
 *
 * Each call REPLACES the previous file. Two people recovering at once is not a case worth
 * supporting on a single-owner installation, and leaving several live proofs on disk to support
 * it would be strictly worse than refusing.
 */
export function mintProof({ workspace, now = Date.now, writeFile = writeFileSync } = {}) {
  const path = proofPath(workspace);
  mkdirSync(dirname(path), { recursive: true });
  const token = randomBytes(TOKEN_BYTES).toString('base64url');
  writeFile(path, `${token}\n`, { mode: 0o600 });
  // Written AND enforced: an umask or a pre-existing file could leave the mode wider than the
  // flag asked for, and this file is only a proof of anything while nobody else can read it.
  chmodSync(path, 0o600);
  return { path, fingerprint: fingerprint(token), expiresAt: new Date(now() + PROOF_TTL_MS).toISOString() };
}

/**
 * Check a presented proof against the file, in constant time, and refuse a stale one.
 *
 * Consumed on success: a proof is single-use, so a token read from a terminal history a week
 * later opens nothing.
 */
export function verifyProof({ workspace, presented, now = Date.now, readFile = readFileSync, remove = rmSync } = {}) {
  const path = proofPath(workspace);
  if (!existsSync(path)) return { accepted: false, reason: 'no-proof-minted' };

  let age;
  try { age = now() - statSync(path).mtimeMs; } catch { return { accepted: false, reason: 'unreadable' }; }
  if (age > PROOF_TTL_MS) return { accepted: false, reason: 'expired' };

  let stored;
  try { stored = String(readFile(path, 'utf8')).trim(); } catch { return { accepted: false, reason: 'unreadable' }; }

  const a = Buffer.from(stored, 'utf8');
  const b = Buffer.from(String(presented ?? '').trim(), 'utf8');
  // Length is compared first because timingSafeEqual throws on a mismatch. That leaks the
  // length of a random token, which is a constant of this file and not a secret.
  const accepted = a.length === b.length && a.length > 0 && timingSafeEqual(a, b);
  if (accepted) remove(path, { force: true });
  return { accepted, reason: accepted ? null : 'mismatch' };
}
