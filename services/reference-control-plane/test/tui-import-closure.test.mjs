// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The terminal shell must still start after it is copied into the image.
//
// This is the third time the same shape of defect has been found in this programme, and
// each time it was found by running the product rather than by reading it:
//
//  1. Phase 5 — `tools/tui-client.mjs` was not in the image at all. `oci/Dockerfile`
//     copied only `tools/acceptance/` out of `tools/`, so the socket listened at
//     /run/codev-peer.sock with nothing shipped that could speak to it, while the WebUI's
//     TUI page told the reader to run exactly that program.
//  2. `coden-addressable-panels.test.mjs` then tied the page's printed command to a COPY
//     line — which fixed the claim about the *entry file* and nothing else.
//  3. s319 split the shell into `tui-fullscreen.mjs` (keys) and `tui-screen.mjs` (pure
//     rendering). The COPY line still named one file. A build from that tree would have
//     shipped a program whose first `import` throws — the same outage as shipping
//     nothing, reached by *adding* code rather than by forgetting it, which is why the
//     previous test stayed green through it.
//
// The lesson is the one phase 4 already learned about panel names: a list maintained by
// hand beside a structure that grows is a fact kept in two places, and only one of them
// gets maintained. So nothing here is a list. The closure is derived by following the
// shell's own `import` statements, the copy set is derived by parsing the recipe, and the
// two are compared — including *where* each file lands, because a file copied to the
// wrong directory resolves no better than a file never copied.
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, posix } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '../../..');

/** The shell's entry point — the one file the interface tells a human to run. */
const ENTRY = 'tools/tui-client.mjs';

/** Every relative `import`/`export ... from` in a module, as repo-relative paths.
 *
 *  Bare specifiers (`node:net`, and any package) are deliberately ignored: they are not
 *  files this recipe has to copy. Relative ones are, and they are the whole risk — they
 *  resolve against the *importer's own directory*, which is what makes "copied, but to
 *  the wrong place" a real failure mode rather than a theoretical one. */
function relativeImportsOf(repoPath) {
  const source = readFileSync(join(root, repoPath), 'utf8');
  const dir = posix.dirname(repoPath);
  const specifiers = [];
  // `from '…'` covers both `import … from` and `export … from`; the bare side-effect form
  // `import '…'` is matched by the second alternative. Dynamic `import()` is not matched,
  // and if the shell ever grows one this test will not see it — recorded rather than
  // guessed at, because the shell has none today and inventing a parser for a case that
  // does not exist is how a check starts describing something other than the code.
  const pattern = /(?:from|import)\s*['"](\.[^'"]*)['"]/g;
  for (const match of source.matchAll(pattern)) {
    specifiers.push(posix.normalize(posix.join(dir, match[1])));
  }
  return specifiers;
}

/** The transitive closure of files the entry point needs, entry included. */
function importClosure(entry) {
  const seen = new Set();
  const pending = [entry];
  while (pending.length > 0) {
    const current = pending.pop();
    if (seen.has(current)) continue;
    seen.add(current);
    for (const next of relativeImportsOf(current)) pending.push(next);
  }
  return seen;
}

/** The recipe's copy set: every `COPY` of repository content, as {source, destination}.
 *
 *  `--from=` stages are skipped — those copy build output, not repository files, and this
 *  test is about the second kind. */
function copyInstructions() {
  const dockerfile = readFileSync(join(root, 'oci/Dockerfile'), 'utf8');
  const instructions = [];
  for (const line of dockerfile.split('\n')) {
    if (!line.startsWith('COPY ')) continue;
    const words = line.trim().split(/\s+/).slice(1).filter((word) => !word.startsWith('--'));
    if (line.includes('--from=')) continue;
    const destination = words.pop();
    for (const source of words) instructions.push({ source, destination });
  }
  return instructions;
}

/** Where a repository file ends up in the image, or `null` if the recipe never copies it.
 *
 *  Docker's own rules, not an approximation of them: a source ending in `/` is a
 *  directory and its tree is reproduced under the destination; a file copied to a
 *  destination ending in `/` keeps its basename; a file copied to a plain path becomes
 *  exactly that path. */
function imagePathFor(repoPath, instructions) {
  for (const { source, destination } of instructions) {
    if (source.endsWith('/')) {
      if (!repoPath.startsWith(source)) continue;
      return posix.join(destination, repoPath.slice(source.length));
    }
    if (source !== repoPath) continue;
    return destination.endsWith('/') ? posix.join(destination, posix.basename(source)) : destination;
  }
  return null;
}

describe('the terminal shell survives being copied into the image', () => {
  const closure = importClosure(ENTRY);
  const instructions = copyInstructions();

  test('the entry point exists and reaches more than itself', () => {
    assert.ok(existsSync(join(root, ENTRY)), `${ENTRY} does not exist in the repository`);
    // Guard on the derivation itself. If a refactor ever leaves the walker matching
    // nothing, every assertion below would pass vacuously and this file would report that
    // a one-file program ships correctly — which is exactly the false green the previous
    // test gave for a year.
    assert.ok(closure.size > 1, 'the import walker found no dependencies; it has stopped reading the shell');
  });

  test('every file the shell imports is put in the image', () => {
    for (const file of closure) {
      assert.ok(
        imagePathFor(file, instructions),
        `${file} is reachable from ${ENTRY} but oci/Dockerfile never copies it — the shipped shell would throw on its first import`,
      );
    }
  });

  test('every import still resolves at the path the image puts the file on', () => {
    // Being in the image is not the same as being *findable*. A relative specifier is
    // resolved against the importer's directory at run time, so copying a dependency to
    // some other directory ships a file nobody can reach. This checks the geometry the
    // running program actually depends on.
    for (const importer of closure) {
      const importerImagePath = imagePathFor(importer, instructions);
      for (const dependency of relativeImportsOf(importer)) {
        const dependencyImagePath = imagePathFor(dependency, instructions);
        const resolved = posix.join(
          posix.dirname(importerImagePath),
          posix.relative(posix.dirname(importer), dependency),
        );
        assert.equal(
          resolved, dependencyImagePath,
          `in the image ${importer} would look for ${dependency} at ${resolved}, but the recipe puts it at ${dependencyImagePath}`,
        );
      }
    }
  });
});
