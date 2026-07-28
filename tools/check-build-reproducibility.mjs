#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Empirical build reproducibility check · phase 7 step 31, one fifth of "SBOM, ML-BOM,
// CBOM, build riproducibili, firme".
//
// tools/generate-inventory.mjs has stated `reproducible: false` since it was written,
// with the note "layer timestamps and the inherited apt layer make this build
// non-reproducible bit for bit" — about `oci/Dockerfile.phase4`, the base image build
// that runs `apt-get install` against the network. That claim was never re-tested here
// because doing so needs the network this tool cannot use.
//
// What CAN be tested offline, and had never been: every phase Dockerfile since D-0143
// (`oci/Dockerfile.phase4-*`) is `FROM` an already-built local tag plus a handful of
// `COPY` instructions, built with `--network=none`. This tool builds one such Dockerfile
// TWICE from the same tree, under throwaway tags, and compares the resulting image IDs
// and RootFS layer digests byte for byte — then removes both throwaway tags (§5a: this
// project's own litter, in the same phase that created it).
//
//   node tools/check-build-reproducibility.mjs <Dockerfile-path> <base-image-tag>
import { execFileSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dockerfile = process.argv[2] ?? 'oci/Dockerfile.phase4-oidc-saml-scim';
const stamp = Date.now();
const tagA = `noesar-evolution:repro-check-a-${stamp}`;
const tagB = `noesar-evolution:repro-check-b-${stamp}`;

function build(tag) {
  execFileSync('docker', ['build', '--network=none', '--pull=false', '-t', tag, '-f', dockerfile, '.'], { cwd:root, stdio:'pipe' });
  return execFileSync('docker', ['image', 'inspect', tag, '--format', '{{.Id}}|{{json .RootFS.Layers}}'], { encoding:'utf8' }).trim();
}

function cleanup(tag) {
  try { execFileSync('docker', ['rmi', tag], { stdio:'pipe' }); } catch { /* best effort */ }
}

let resultA;
let resultB;
try {
  resultA = build(tagA);
  resultB = build(tagB);
} finally {
  cleanup(tagA);
  cleanup(tagB);
}

const [idA, layersA] = resultA.split('|');
const [idB, layersB] = resultB.split('|');
const reproducible = idA === idB && layersA === layersB;

const report = {
  documentType: 'build-reproducibility-check',
  dockerfile,
  checkedAt: new Date().toISOString(),
  method: 'two independent --network=none builds of the same Dockerfile from the same tree, compared by image ID and RootFS layer digest list',
  scope: 'This checks the incremental phase-image layer only (FROM a fixed local tag + COPY), not oci/Dockerfile.phase4 (the apt-based base image build), which needs network access this tool does not use and remains DECLARED non-reproducible per tools/generate-inventory.mjs, not re-tested here.',
  imageIdA: idA,
  imageIdB: idB,
  reproducible,
};

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(reproducible
  ? `REPRODUCIBLE — both builds of ${dockerfile} produced image ID ${idA}\n`
  : `NOT REPRODUCIBLE — ${idA} vs ${idB}\n`);
process.exit(reproducible ? 0 : 1);
