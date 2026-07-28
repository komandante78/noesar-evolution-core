#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Cryptographic Bill of Materials · phase 7 step 31 ("Il mondo esterno", 09_PIANO.md §2),
// one fifth of "SBOM, ML-BOM, CBOM, build riproducibili, firme".
//
// Same honesty discipline as tools/generate-inventory.mjs (the existing PARTIAL SBOM
// stand-in) and repo-map.mjs's symbol index: this is regex over source text, not a
// parser and not a real CycloneDX CBOM. It cannot see a crypto call built dynamically,
// re-exported through an alias, or invoked from a vendored dependency. It says so in
// conformance/conformanceNote below rather than implying broader coverage.
//
// Every pattern here was chosen by first finding what this codebase actually calls
// (`grep -rlE "createHash|createSign|..." services/reference-control-plane/src`, this
// session), not written from a generic checklist — the six algorithms below are exactly
// the ones in use: SHA-256 (integrity), scrypt (password KDF), HMAC-SHA256 (MAC),
// Ed25519 (signing — compliance packs D-0205, radar entries D-0206, the update
// manifest), RSA-SHA256/RS256 (OIDC ID token verification, D-0207 — the only asymmetric
// verification algorithm accepted, deliberately), and CSPRNG token/salt/nonce generation.
//
//   node tools/cbom.mjs <output.json>
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, extname, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const output = process.argv[2] ?? 'cbom.json';
const SCAN_ROOT = join(root, 'services/reference-control-plane/src');

const PATTERNS = Object.freeze([
  { algorithm:'SHA-256', family:'hash', purpose:'integrity hashing (audit ledger, event chain, capability token id, shadow/file digests, update manifest digest)', re:/createHash\(\s*['"]sha256['"]/g },
  { algorithm:'scrypt', family:'password-kdf', purpose:'password verifier derivation (auth-crypto.mjs)', re:/\bscryptSync\(/g },
  { algorithm:'HMAC-SHA256', family:'mac', purpose:'message authentication (authority protocol envelopes, capability MAC)', re:/createHmac\(\s*['"]sha256['"]/g },
  { algorithm:'Ed25519', family:'signature', purpose:'digital signature — sign/verify with a null digest algorithm is node:crypto\'s EdDSA convention (compliance packs D-0205, radar entries D-0206, software update manifests)', re:/[A-Za-z]*(?:[Ss]ign|[Vv]erify)[A-Za-z]*\(\s*null\s*,/g },
  { algorithm:'RSA-SHA256 (RS256)', family:'signature', purpose:'OIDC ID token signature verification (D-0207) — the only algorithm accepted; alg:"none" and HS256 are refused before any key lookup', re:/RSA-SHA256/g },
  { algorithm:'CSPRNG', family:'random', purpose:'token/salt/nonce generation (node:crypto.randomBytes)', re:/\brandomBytes\(/g },
]);

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const info = statSync(full);
    if (info.isDirectory()) { if (entry !== 'node_modules') walk(full, out); }
    else if (extname(full) === '.mjs') out.push(full);
  }
  return out;
}

const files = walk(SCAN_ROOT);
const components = [];
for (const file of files) {
  const text = readFileSync(file, 'utf8');
  const lines = text.split('\n');
  for (const { algorithm, family, purpose, re } of PATTERNS) {
    re.lastIndex = 0;
    let match;
    const locations = [];
    while ((match = re.exec(text))) {
      const line = text.slice(0, match.index).split('\n').length;
      locations.push({ line, snippet: lines[line - 1]?.trim().slice(0, 120) });
    }
    if (locations.length > 0) {
      components.push({ file: relative(root, file), algorithm, family, purpose, occurrences: locations.length, locations });
    }
  }
}

const byAlgorithm = {};
for (const c of components) {
  byAlgorithm[c.algorithm] = (byAlgorithm[c.algorithm] ?? 0) + c.occurrences;
}

const cbom = {
  documentType: 'cryptographic-bill-of-materials',
  conformance: 'PARTIAL',
  conformanceNote:
    'Not a CycloneDX CBOM. Regex over source text (the same method repo-map.mjs\'s symbol '
    + 'index already declares, D-0188) — it cannot see a crypto call built dynamically, an '
    + 'alias, or anything inside a vendored dependency (rust/vendor/ is not scanned; it is a '
    + 'separate, unbuilt authority daemon, D-0173). No key inventory, no certificate '
    + 'expiry tracking, no FIPS/algorithm-approval status.',
  generatedBy: 'tools/cbom.mjs',
  generatedAt: new Date().toISOString(),
  scanRoot: relative(root, SCAN_ROOT),
  filesScanned: files.length,
  algorithmSummary: byAlgorithm,
  components,
  postQuantum: {
    used: false,
    note: 'No post-quantum algorithm is used anywhere in this codebase. Ed25519 and RSA are both broken by a sufficiently large quantum computer (Shor\'s algorithm); named here because a CBOM that omits this is a CBOM that lets a reader assume it was considered.',
  },
};

writeFileSync(output, `${JSON.stringify(cbom, null, 2)}\n`);
process.stdout.write(`wrote ${output}\n`);
process.stdout.write(`  files scanned    ${files.length}\n`);
for (const [algorithm, count] of Object.entries(byAlgorithm)) {
  process.stdout.write(`  ${algorithm.padEnd(20)} ${count} occurrence(s)\n`);
}
process.stdout.write('  conformance      PARTIAL (declared, not a CycloneDX CBOM)\n');
