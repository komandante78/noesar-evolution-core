// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The vendored bytes are the bytes that were checked — proved by hash, not by intention.
//
// `D-0413` put the first third-party runtime dependency in this product's history under
// `apps/webui-static/vendor/`. Two things follow from that, and this file is both of them.
//
// **One.** `eslint.config.mjs` now ignores that tree, because linting 345 KB of minified code
// nobody here may edit produced 444 findings that could not be acted on, and a gate reporting
// what cannot be acted on is a gate people learn to skip. But an ignored tree with nothing
// checking it is exactly the hole the ignore list exists to prevent, so the linting is
// *replaced* rather than dropped: what applies to bytes we did not write is not "are they
// styled correctly" but "are they the bytes whose licence and provenance were verified".
//
// **Two.** `PROVENANCE.md` records the version, the registry integrity value and a SHA-256 for
// each file. A document recording hashes that nothing compares is a claim, not a check. This
// makes it a check.
//
// What this deliberately does NOT do: reach the network. It cannot re-download the package to
// confirm the registry still serves these bytes, and it must not — §31 makes offline operation
// the baseline and §8 forbids a network call as a side effect of a test. Re-verifying against
// the registry is a human act, recorded in `PROVENANCE.md` with the command that does it.

import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const vendorRoot = join(repoRoot, 'apps/webui-static/vendor/xterm');
const provenance = readFileSync(join(vendorRoot, 'PROVENANCE.md'), 'utf8');

/** The hashes the document itself declares, read out of its table — so the expected values are
 *  never typed twice. A test carrying its own copy of the numbers would agree with itself
 *  forever while the document drifted, which is the failure this project keeps rediscovering. */
function declaredHashes() {
  const declared = new Map();
  for (const match of provenance.matchAll(/^\| `([^`]+)` \| ([\d,]+) \| `([0-9a-f]{64})` \|/gm)) {
    declared.set(match[1], { bytes: Number(match[2].replace(/,/g, '')), sha256: match[3] });
  }
  return declared;
}

describe('the vendored library is the one that was verified', () => {
  test('every file the provenance declares exists and hashes to the declared value', () => {
    const declared = declaredHashes();
    assert.ok(declared.size >= 3, `the provenance table listed ${declared.size} files; it must list at least 3`);
    for (const [name, expected] of declared) {
      const full = join(vendorRoot, name);
      assert.ok(existsSync(full), `${name} is declared in PROVENANCE.md and is not on disk`);
      const bytes = readFileSync(full);
      assert.equal(bytes.length, expected.bytes, `${name} is ${bytes.length} bytes, declared ${expected.bytes}`);
      assert.equal(createHash('sha256').update(bytes).digest('hex'), expected.sha256,
        `${name} does not match the hash recorded when its licence and provenance were checked`);
    }
  });

  test('nothing is in the vendor directory that the provenance does not account for', () => {
    // The other direction, and the one that actually catches a supply-chain surprise: a file
    // ADDED here would pass every hash check above by simply not being mentioned.
    const declared = new Set([...declaredHashes().keys(), 'PROVENANCE.md']);
    for (const entry of readdirSync(vendorRoot)) {
      assert.ok(declared.has(entry), `${entry} is in the vendor directory and PROVENANCE.md does not account for it`);
    }
  });

  test('the licence is present, is the MIT grant in full, and names its copyright holders', () => {
    // Checked by SUBSTANCE, not by title. The first version of this test looked for the string
    // "MIT License" and failed: upstream ships the MIT text with no title line, three copyright
    // notices and nothing else. That failure was the test being wrong, not the licence — and it
    // is the right lesson to keep, because the clauses below are what actually grant anything.
    // A header is a label; these four sentences are the licence.
    const licence = readFileSync(join(vendorRoot, 'LICENSE'), 'utf8');
    assert.match(licence, /Permission is hereby granted, free of charge/,
      'the grant clause is missing: without it nothing here is licensed at all');
    assert.match(licence, /without restriction, including without limitation the rights/,
      'the permissive scope of the MIT grant is missing');
    assert.match(licence, /The above copyright notice and this permission notice shall be included/,
      'the attribution condition is missing — it is the one obligation MIT imposes on us');
    assert.match(licence, /THE SOFTWARE IS PROVIDED "AS IS"/, 'the warranty disclaimer is missing');
    assert.match(licence, /xterm\.js authors/, 'the LICENSE does not name the upstream copyright holders');
    // The attribution condition above is the reason this file is vendored ALONGSIDE the code
    // rather than merely noted: MIT requires the notice to travel with the copies, and the
    // image ships `apps/webui-static/` wholesale, so it travels.
  });

  test('the provenance records the version and the registry integrity it was checked against', () => {
    assert.match(provenance, /version\s+6\.0\.0/, 'no version is recorded');
    assert.match(provenance, /sha512-[A-Za-z0-9+/]{60,}={0,2}/, 'no registry integrity value is recorded');
    assert.match(provenance, /licence\s+MIT/, 'no licence determination is recorded');
  });

  test('no source map or TypeScript source was vendored', () => {
    // Maps would ship the whole upstream source by another route, and §33 keeps build inputs
    // out of the repository. Asserted rather than trusted to the extraction command.
    for (const entry of readdirSync(vendorRoot)) {
      assert.doesNotMatch(entry, /\.map$/, `${entry} is a source map`);
      assert.doesNotMatch(entry, /\.ts$/, `${entry} is TypeScript source`);
    }
  });
});

describe('the ignore that replaced linting is paired with this check', () => {
  test('the vendor tree is ignored by ESLint — and this file is why that is allowed', () => {
    const config = readFileSync(join(repoRoot, 'eslint.config.mjs'), 'utf8');
    assert.match(config, /'apps\/webui-static\/vendor\/\*\*'/,
      'the vendored tree is being linted again: either remove this test or re-add the ignore deliberately');
  });

  test('no first-party file was moved under vendor/ to escape the linter', () => {
    // The abuse this pairing invites: a tree that is ignored becomes somewhere to put code that
    // will not pass. Every file here must be accounted for by the provenance of a third-party
    // package, which the first test already enforces — this states the rule in words so the
    // next reader knows the directory is not a general escape hatch.
    const declared = declaredHashes();
    for (const name of declared.keys()) {
      assert.doesNotMatch(name, /^coden-/, `${name} looks like first-party code inside vendor/`);
    }
  });
});
