#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Component inventory and build provenance for the running image.
//
// This is NOT an SBOM and does not pretend to be one. No syft, cyclonedx-cli or
// spdx-tools exists on this host and installing tooling is forbidden by CLAUDE10 rule 45,
// so emitting a document with an SPDX or CycloneDX header would be a conformance claim
// nobody had verified. What this produces is an honest, machine-readable inventory of
// what is actually in the image, marked PARTIAL, with the gaps named.
//
//   node tools/generate-inventory.mjs <output.json> [image-tag]
//
// OS packages are read from the image's own dpkg status database via a container the
// caller has already authorised; if that is unavailable the section says so rather than
// being omitted.
import { readFileSync, writeFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const output = process.argv[2] ?? 'inventory.json';
const image = process.argv[3] ?? 'noesar-evolution:phase4';
const root = process.cwd();

function tryRun(command, args) {
  try { return execFileSync(command, args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, timeout: 120_000 }); }
  catch (error) { return { error: (error.stderr || error.message || 'failed').toString().trim().slice(0, 400) }; }
}

function sha256File(path) { return createHash('sha256').update(readFileSync(path)).digest('hex'); }

function walk(dir, filter, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const info = statSync(full);
    if (info.isDirectory()) { if (!['node_modules', '.git', 'target'].includes(entry)) walk(full, filter, out); }
    else if (filter(full)) out.push(full);
  }
  return out;
}

// ---------------------------------------------------------------- Node packages
const nodePackages = [];
for (const manifest of walk(root, (p) => p.endsWith('package.json') && !p.includes('/vendor/'))) {
  try {
    const value = JSON.parse(readFileSync(manifest, 'utf8'));
    nodePackages.push({
      path: relative(root, manifest),
      name: value.name ?? null,
      version: value.version ?? null,
      license: value.license ?? null,
      dependencies: Object.keys(value.dependencies ?? {}),
      devDependencies: Object.keys(value.devDependencies ?? {}),
    });
  } catch { /* not a manifest we can read */ }
}
// Distinguish what the container ships from what the repository merely carries. The
// Dockerfile copies package.json, services/reference-control-plane/ and apps/webui-static/
// and nothing else, so any other manifest the repository happens to carry (whatever a
// future directory adds) is in the repository but not in the image. Collapsing the two
// would turn a true statement ("the runtime has no third-party npm dependency") into a
// false one, in either direction.
const SHIPPED_MANIFESTS = new Set(['package.json', 'services/reference-control-plane/package.json']);
const shippedManifests = nodePackages.filter((p) => SHIPPED_MANIFESTS.has(p.path));
const repositoryOnly = nodePackages.filter((p) => !SHIPPED_MANIFESTS.has(p.path));
const thirdPartyNode = shippedManifests.flatMap((p) => [...p.dependencies, ...p.devDependencies]);
const thirdPartyRepositoryOnly = repositoryOnly.flatMap((p) => [...p.dependencies, ...p.devDependencies]);

// ---------------------------------------------------------------- Rust workspace and vendor
// Fixed patterns, not built from a variable: a regex assembled at run time is the shape
// static analysis flags for ReDoS, and there is no reason to construct these dynamically.
const CARGO_FIELD = Object.freeze({
  name: /^\s*name\s*=\s*"([^"]*)"/m,
  version: /^\s*version\s*=\s*"([^"]*)"/m,
  license: /^\s*license\s*=\s*"([^"]*)"/m,
});
const rustCrates = [];
for (const manifest of walk(join(root, 'rust'), (p) => p.endsWith('Cargo.toml'))) {
  const text = readFileSync(manifest, 'utf8');
  const field = (name) => (text.match(CARGO_FIELD[name]) ?? [])[1] ?? null;
  rustCrates.push({
    path: relative(root, manifest),
    name: field('name'),
    version: field('version'),
    license: field('license'),
    vendored: manifest.includes(`${'/'}vendor${'/'}`),
  });
}
const vendored = rustCrates.filter((c) => c.vendored);
const firstParty = rustCrates.filter((c) => !c.vendored);

// ---------------------------------------------------------------- OS packages, from the image
let osPackages = { source: 'unavailable', count: 0, packages: [], note: '' };
const dpkg = tryRun('docker', ['run', '--rm', '--network', 'none', '--entrypoint', 'sh', image, '-c', "dpkg-query -W -f='${Package}\\t${Version}\\t${Architecture}\\n' 2>/dev/null"]);
if (typeof dpkg === 'string' && dpkg.trim()) {
  const packages = dpkg.trim().split('\n').map((line) => {
    const [name, version, arch] = line.split('\t');
    return { name, version, arch };
  });
  osPackages = { source: `dpkg-query inside ${image}`, count: packages.length, packages, note: 'Debian package set inherited from the base image plus the five packages oci/Dockerfile installs.' };
} else {
  osPackages.note = `dpkg-query could not be run: ${JSON.stringify(dpkg).slice(0, 200)}`;
}

// ---------------------------------------------------------------- image and provenance
const inspect = tryRun('docker', ['image', 'inspect', image, '--format', '{{.Id}}|{{.Created}}|{{.Architecture}}|{{.Os}}|{{.Size}}|{{json .Config.Labels}}']);
let imageInfo = { tag: image, error: inspect.error ?? null };
if (typeof inspect === 'string') {
  const [id, created, architecture, os, size, labels] = inspect.trim().split('|');
  imageInfo = { tag: image, id, created, architecture, os, sizeBytes: Number(size), labels: JSON.parse(labels || '{}') };
}
const baseInspect = tryRun('docker', ['image', 'inspect', 'node:22-bookworm-slim', '--format', '{{.Id}}|{{json .RepoDigests}}']);
let baseImage = { reference: 'node:22-bookworm-slim', error: baseInspect.error ?? null };
if (typeof baseInspect === 'string') {
  const [id, digests] = baseInspect.trim().split('|');
  baseImage = { reference: 'node:22-bookworm-slim', id, repoDigests: JSON.parse(digests || '[]') };
}

// ---------------------------------------------------------------- first-party source
const shippedRoots = ['services/reference-control-plane/src', 'apps/webui-static'];
const shipped = shippedRoots.flatMap((d) => walk(join(root, d), () => true)).map((p) => ({ path: relative(root, p), sha256: sha256File(p), bytes: statSync(p).size }));

// ---------------------------------------------------------------- licences
const licenceInventory = existsSync(join(root, 'docs/LICENSE_INVENTORY.tsv'))
  ? readFileSync(join(root, 'docs/LICENSE_INVENTORY.tsv'), 'utf8').trim().split('\n').length - 1
  : 0;
const declaredLicences = new Map();
for (const crate of vendored) declaredLicences.set(crate.license ?? 'UNDECLARED', (declaredLicences.get(crate.license ?? 'UNDECLARED') ?? 0) + 1);

const inventory = {
  documentType: 'component-inventory',
  conformance: 'PARTIAL',
  conformanceNote:
    'Not an SBOM. No syft, cyclonedx-cli or spdx-tools is present on this host and CLAUDE10 rule 45 forbids installing tooling, '
    + 'so no SPDX or CycloneDX conformance is claimed. Gaps: no dependency graph or relationship model, no package URLs (purl), '
    + 'no supplier fields, no file-level licence concluded/declared distinction, and no signature over this document.',
  generatedBy: 'tools/generate-inventory.mjs',
  image: imageInfo,
  baseImage,
  buildProvenance: {
    dockerfile: 'oci/Dockerfile.phase4',
    baseImageReference: imageInfo.labels?.['org.noesar.base-image'] ?? null,
    lineage: 'node:22-bookworm-slim -> noesar-evolution:phase3 -> noesar-evolution:phase4',
    network: 'none (the phase-4 build ran with --network=none and --pull=false)',
    reproducible: false,
    reproducibleNote: 'Layer timestamps and the inherited apt layer make this build non-reproducible bit for bit. Not claimed.',
  },
  node: {
    runtimeVersion: process.version,
    shippedManifests: shippedManifests.map((p) => p.path),
    shippedThirdPartyDependencyCount: thirdPartyNode.length,
    shippedThirdPartyDependencies: [...new Set(thirdPartyNode)],
    repositoryOnlyManifests: repositoryOnly.map((p) => ({ path: p.path, name: p.name, dependencies: [...p.dependencies, ...p.devDependencies] })),
    repositoryOnlyThirdPartyDependencies: [...new Set(thirdPartyRepositoryOnly)],
    packages: nodePackages,
    note: thirdPartyNode.length === 0
      ? (repositoryOnly.length === 0
        ? 'The image ships zero third-party npm dependencies: the runtime uses only the Node standard library. The repository carries no other manifest.'
        : `The image ships zero third-party npm dependencies: the runtime uses only the Node standard library. The repository additionally carries ${repositoryOnly.length} manifest(s) that the Dockerfile does not copy — ${repositoryOnly.map((p) => p.path).join(', ')} — declaring ${new Set(thirdPartyRepositoryOnly).size} third-party package(s) not installed or served.`)
      : 'The image ships third-party npm dependencies.',
  },
  rust: {
    firstPartyCrateCount: firstParty.length,
    vendoredCrateCount: vendored.length,
    firstPartyCrates: firstParty,
    vendoredLicenceHistogram: Object.fromEntries([...declaredLicences.entries()].sort((a, b) => b[1] - a[1])),
    note: 'The Rust authority daemon is not built into, or started by, the running container. It is inventoried because it ships in the repository.',
  },
  osPackages,
  shippedFirstPartyFiles: { count: shipped.length, files: shipped },
  licences: {
    inventoryRows: licenceInventory,
    firstPartyDeclared: firstParty.filter((c) => c.license).length,
    firstPartyUndeclared: firstParty.filter((c) => !c.license).length,
    note: 'The root LICENSE and NOTICE exist since D-0453 (2026-08-14) and every package in packages/ carries its own licence text; this note claimed otherwise until 2026-09-03. What is still open is per-crate declaration: firstPartyUndeclared above counts the Rust crates that declare none. docs/LICENSE_STRATEGY.md section 5 tracks the rest.',
  },
};

writeFileSync(output, `${JSON.stringify(inventory, null, 2)}\n`);
process.stdout.write(`wrote ${output}\n`);
process.stdout.write(`  image            ${imageInfo.id ?? imageInfo.error}\n`);
process.stdout.write(`  base image       ${baseImage.repoDigests?.[0] ?? baseImage.error ?? 'unknown'}\n`);
process.stdout.write(`  node packages    ${nodePackages.length} manifests, ${thirdPartyNode.length} third-party dependencies\n`);
process.stdout.write(`  rust crates      ${firstParty.length} first-party, ${vendored.length} vendored\n`);
process.stdout.write(`  os packages      ${osPackages.count} (${osPackages.source})\n`);
process.stdout.write(`  shipped files    ${shipped.length} hashed\n`);
process.stdout.write(`  conformance      PARTIAL (declared, not an SBOM)\n`);
