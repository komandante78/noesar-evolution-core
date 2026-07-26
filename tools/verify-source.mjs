// SPDX-License-Identifier: AGPL-3.0-or-later
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const required = [
  'apps/webui-static/index.html',
  'services/reference-control-plane/src/server.mjs',
  'services/reference-control-plane/src/auth.mjs',
  'services/reference-control-plane/src/auth-crypto.mjs',
  'services/reference-control-plane/src/canonical-json.mjs',
  'services/reference-control-plane/src/authority.mjs',
  'services/reference-control-plane/src/authority-protocol.mjs',
  'services/reference-control-plane/src/authority-ipc-frame.mjs',
  'services/reference-control-plane/src/authority-external-client.mjs',
  'services/reference-control-plane/src/production-readiness.mjs',
  'services/reference-control-plane/src/data-plane.mjs',
  'services/reference-control-plane/src/postgres-repository.mjs',
  'database/postgres/MIGRATIONS.json',
  'database/postgres/0011_production_attestation_ledger.sql',
  'database/postgres/0012_audit_chain_and_release_gate.sql',
  'database/postgres-baseline-v0.5.0/BASELINE_STATUS.md',
  'conformance/authority-vectors.json',
  'schemas/authority-ipc-envelope.schema.json',
  'schemas/authority-ipc-frame.schema.json',
  'schemas/rust-build-provenance-v1.schema.json',
  'rust/crates/noesar-authority-daemon/src/lib.rs',
  'rust/crates/noesar-authority-daemon/src/main.rs',
  'rust/build-authority-release.sh',
  'tools/create-rust-build-provenance.py',
  'tools/verify-rust-build-provenance.py',
  'schemas/owner-entitlement.schema.json',
  'private-boundary/atom-provider.schema.json',
];
for (const rel of required) {
  if (!existsSync(resolve(root, rel))) {
    throw new Error(`Missing required source: ${rel}`);
  }
}

const server = readFileSync(
  resolve(root, 'services/reference-control-plane/src/server.mjs'),
  'utf8'
);
const authority = readFileSync(
  resolve(root, 'services/reference-control-plane/src/authority.mjs'),
  'utf8'
);
const protocol = readFileSync(
  resolve(root, 'services/reference-control-plane/src/authority-protocol.mjs'),
  'utf8'
);
const frame = readFileSync(
  resolve(root, 'services/reference-control-plane/src/authority-ipc-frame.mjs'),
  'utf8'
);
const external = readFileSync(
  resolve(root, 'services/reference-control-plane/src/authority-external-client.mjs'),
  'utf8'
);
const dataPlane = readFileSync(
  resolve(root, 'services/reference-control-plane/src/data-plane.mjs'),
  'utf8'
);
const repository = readFileSync(
  resolve(root, 'services/reference-control-plane/src/postgres-repository.mjs'),
  'utf8'
);
const migrations = readFileSync(
  resolve(root, 'database/postgres/MIGRATIONS.json'),
  'utf8'
);

for (const token of [
  'requireSession',
  'requireCsrf',
  'coden.owner-bypass',
  'NOESAR_SETUP_TOKEN',
  'assertReferenceRuntimeAllowed',
  'assertDevelopmentDataPlane',
]) {
  if (!server.includes(token)) {
    throw new Error(`Server missing control: ${token}`);
  }
}
for (const token of [
  "protocolVersion:'1.1'",
  'canonicalJsonImplemented:true',
  'externalClientImplemented:true',
  'rustDaemonSourceImplemented:true',
  'unixSoPeerCredSourceImplemented:true',
  'authenticatedTransportActive:false',
  'serverPeerCredentialsVerified:false',
]) {
  if (!authority.includes(token)) {
    throw new Error(`Authority status missing control: ${token}`);
  }
}
for (const token of [
  "schemaVersion:'1.1'",
  'canonicalJsonBytes',
  'timingSafeEqual',
  'replay detected',
  'expectedActorId',
  'expectedSessionId',
  'expectedAction',
]) {
  if (!protocol.includes(token)) {
    throw new Error(`Authority protocol missing control: ${token}`);
  }
}
for (const token of [
  'AUTHORITY_MAX_FRAME_BYTES',
  'authenticated peer identity is required',
  'writeUInt32BE',
  'partial frame',
]) {
  if (!frame.includes(token)) {
    throw new Error(`IPC frame missing control: ${token}`);
  }
}
for (const token of [
  'authority socket path must be absolute',
  'must not be world-writable',
  'must not be a symlink',
  'authority response ${field} binding mismatch',
  'serverPeerCredentialsVerified:false',
  'productionEligible:false',
  'authority response contains trailing bytes',
]) {
  if (!external.includes(token)) {
    throw new Error(`External authority client missing control: ${token}`);
  }
}
for (const token of [
  "migrationBaseline:'0.6.0'",
  'migrationCount:12',
  'productionAttestationLedgerImplemented:true',
  'auditHashChainGuardImplemented:true',
  'repositoryAdapterActive:false',
  'productionReady:false',
]) {
  if (!dataPlane.includes(token)) {
    throw new Error(`Data-plane status missing control: ${token}`);
  }
}
for (const token of [
  "client.query('BEGIN')",
  "client.query('COMMIT')",
  "client.query('ROLLBACK')",
  "set_config('noesar.workspace_id'",
  'SELECT noesar_runtime.assert_context()',
  'FROM noesar_runtime.production_gate($1, $2)',
  'audit_hash_chain_guard',
  'production_attestation_ledger_immutable',
  'Object.values(checks).every(Boolean)',
  '$1',
]) {
  if (!repository.includes(token)) {
    throw new Error(`PostgreSQL repository missing control: ${token}`);
  }
}

const manifest = JSON.parse(migrations);
if (
  manifest.schemaVersion !== '4.0'
  || manifest.release !== '0.6.0'
  || manifest.baselineV050Preserved !== true
) {
  throw new Error('PostgreSQL V0.6.0 migration manifest is invalid');
}

// The V0.6.0 release shipped these twelve migrations. This asserts they are still present,
// unaltered and still first — it deliberately does NOT assert the total count.
//
// It used to read `manifest.migrations.length !== 12`, which froze the check at the release
// count. When 0013-0016 landed, this file began throwing on every run; and because
// scripts/test.sh runs under `set -eu` with this as its second of seven steps, the five steps
// after it stopped running at all. A check that always fails is a check that gets skipped, so
// the intent — the baseline set is intact, nothing reordered or dropped — is expressed here in
// a form that adding a migration cannot break.
const V060_BASELINE = [
  '0001_schemas_and_extensions.sql',
  '0002_identity_and_sessions.sql',
  '0003_workspaces_projects_members.sql',
  '0004_audit_ledger.sql',
  '0005_publishers_capabilities.sql',
  '0006_documents_memory_models.sql',
  '0007_row_level_security.sql',
  '0008_migration_ledger.sql',
  '0009_roles_and_privileges.sql',
  '0010_runtime_security_acceptance.sql',
  '0011_production_attestation_ledger.sql',
  '0012_audit_chain_and_release_gate.sql',
];

if (manifest.migrations.length < V060_BASELINE.length) {
  throw new Error(
    `PostgreSQL migration manifest lost migrations: ${manifest.migrations.length} < ${V060_BASELINE.length}`,
  );
}

for (const [index, filename] of V060_BASELINE.entries()) {
  const actual = manifest.migrations[index]?.filename;
  if (actual !== filename) {
    throw new Error(
      `PostgreSQL V0.6.0 baseline altered at position ${index + 1}: expected ${filename}, found ${actual}`,
    );
  }
}

console.log(`SOURCE_VERIFY=PASS migrations=${manifest.migrations.length} baseline=${V060_BASELINE.length}/12 intact`);
