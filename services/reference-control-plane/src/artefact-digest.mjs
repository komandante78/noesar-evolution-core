// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The sha256 of a model artefact, read once per version of the file.
//
// Measured 2026-09-21 on the live installation: `GET /api/v1/models/catalog` took 45-93 s, and for
// that whole time the process served nothing else — a sign-in timed out into a 500, the CodeN
// frame into a 503, and the page showed "Failed to fetch" — because `readPresentModels` hashed
// every present artefact (about 47 GB there) synchronously, on every request, for every caller.
//
// A file's digest cannot change while the file does not, so it is kept, keyed by what any
// rewrite of the file changes: device, inode, size, mtime and ctime. ctime cannot be set from
// user space, so a file replaced in place — even one whose mtime is put back with `utimes` — is
// hashed again. `warmDigests` fills the same memory asynchronously at boot.
//
// The trap in that key is git's "racily clean" problem, and this module's own test hit it before
// anything shipped: file timestamps advance in coarse kernel ticks, so a same-size file rewritten
// within one tick keeps every field of its identity — and a remembered digest would vouch for
// bytes it never read. So a digest is remembered only when the file was not touched during the
// read and its ctime is older than `settleMs` before the read began; anything fresher is hashed
// again next time, which is exactly the old behaviour and never a wrong verdict.
//
// ponytail: the one case left is a catalogue requested before warming has reached a file; that
// request still hashes it synchronously, once. Moving the synchronous path off the event loop
// means an async catalogue through every caller of `readPresentModels` — build it if a restart
// followed by an immediate visit to the Models page is ever measured as a problem.
import { closeSync, createReadStream, openSync, readdirSync, readSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

const known = new Map();

/** How many times a file was actually read end to end. For tests: a digest served from memory does not count. */
export const digestCounters = { hashed: 0 };

/** How old a file's last change must be before its digest is trusted from memory. Lowered only by tests. */
export const digestTiming = { settleMs: 2000 };

const identity = (stat) => `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`;

function remembered(file, stat) {
  const entry = known.get(file);
  return entry && entry.key === identity(stat) ? entry.digest : null;
}

function remember(file, before, startedAt, digest) {
  digestCounters.hashed += 1;
  let after;
  try { after = statSync(file); } catch { return digest; }
  const settled = after.ctimeMs < startedAt - digestTiming.settleMs;
  if (settled && identity(after) === identity(before)) known.set(file, { key: identity(after), digest });
  return digest;
}

/**
 * The sha256 of a file, read in chunks — measured, not preferred.
 *
 * This was `createHash().update(readFileSync(file))`, and `readFileSync` throws
 * `ERR_FS_FILE_TOO_LARGE` above 2 GiB. The throw landed in the caller's `catch`, which records
 * `verified: false` — the unverified lane, from which nothing starts (MC-004). So every model
 * artefact larger than 2 GiB was permanently unstartable, and said so in the vocabulary of a
 * failed integrity check rather than of a reader that could not read it. 1 MiB chunks make the
 * syscall count irrelevant beside the disk read.
 */
export function artefactDigest(file) {
  const startedAt = Date.now();
  const stat = statSync(file);
  const cached = remembered(file, stat);
  if (cached) return cached;
  const hash = createHash('sha256');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  const handle = openSync(file, 'r');
  try {
    for (;;) {
      const read = readSync(handle, buffer, 0, buffer.length, null);
      if (read <= 0) break;
      hash.update(read === buffer.length ? buffer : buffer.subarray(0, read));
    }
  } finally { closeSync(handle); }
  return remember(file, stat, startedAt, hash.digest('hex'));
}

/** Hashes every `*.bin` artefact in `dir` without blocking the event loop. Never throws. */
export async function warmDigests(dir) {
  let names;
  try { names = readdirSync(dir); } catch { return; }
  for (const name of names) {
    if (!name.endsWith('.bin')) continue;
    const file = join(dir, name);
    const startedAt = Date.now();
    let stat;
    try { stat = statSync(file); } catch { continue; }
    if (!stat.isFile() || remembered(file, stat)) continue;
    const hash = createHash('sha256');
    try {
      for await (const chunk of createReadStream(file, { highWaterMark: 1024 * 1024 })) hash.update(chunk);
    } catch { continue; }
    remember(file, stat, startedAt, hash.digest('hex'));
  }
}
