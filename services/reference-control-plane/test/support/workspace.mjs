// SPDX-License-Identifier: AGPL-3.0-or-later
//
// `D-0460` found 3,553 leaked `mkdtempSync` directories, 8.3 GB, across two files that never
// removed what they created — the same pattern existed, unfixed, in 55 more (`F-TMP-001`).
// This is the shared fix `D-0463`'s improvement proposal named: one place that creates a
// workspace also owns cleaning it up, instead of every test file re-deriving the same
// `try/finally` (or forgetting it).
//
// `after()` runs once per file, because `node --test` gives each matched file its own
// process — a module-scope `after()` here binds to whichever file imported it, never to a
// different file's run. Every directory this module creates for that file is swept then,
// pass or fail.
import { after } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const created = [];
let swept = false;

after(() => {
  swept = true;
  for (const dir of created) rmSync(dir, { recursive: true, force: true });
});

/** A fresh `mkdtempSync` directory under `os.tmpdir()`, removed automatically when this
 *  file's tests finish. `prefix` keeps the same naming a reader would already recognise from
 *  the file it came from (e.g. `noesar-audit-`) — this changes WHO cleans it up, not what it
 *  is called or where it lives.
 *
 *  Named `freshTempDir`, not `workspace`: 47 of the 52 files this replaces `mkdtempSync` in
 *  already use `workspace` themselves, as a local function or variable — importing under that
 *  name would have shadowed or self-referentially redeclared every one of them. Found by
 *  actually running the migration once, not by guessing ahead of it. */
export function freshTempDir(prefix) {
  if (swept) throw new Error('freshTempDir() called after this file\'s after() hook already ran');
  const dir = mkdtempSync(join(tmpdir(), prefix));
  created.push(dir);
  return dir;
}
