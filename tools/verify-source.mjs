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
  || manifest.migrations.length !== 12
) {
  throw new Error('PostgreSQL V0.6.0 migration manifest is invalid');
}

console.log('SOURCE_VERIFY=PASS');
