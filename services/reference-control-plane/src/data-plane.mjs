// SPDX-License-Identifier: AGPL-3.0-or-later

export const DataPlaneMode = Object.freeze({
  REFERENCE_JSON: 'reference-json',
  POSTGRESQL: 'postgresql',
});

export function dataPlaneStatus(env = process.env) {
  const mode = String(env.NOESAR_DATA_PLANE ?? DataPlaneMode.REFERENCE_JSON).toLowerCase();
  const recognized = Object.values(DataPlaneMode).includes(mode);
  const databaseUrlConfigured = Boolean(env.NOESAR_DATABASE_URL);
  const migrationAttestationConfigured = Boolean(env.NOESAR_DATABASE_MIGRATION_ATTESTATION);

  return {
    mode,
    recognized,
    databaseUrlConfigured,
    migrationAttestationConfigured,
    connected:false,
    migrated:false,
    productionReady:false,
    repositoryAdapterImplemented:true,
    repositoryAdapterActive:false,
    migrationCount:12,
    productionAttestationLedgerImplemented:true,
    auditHashChainGuardImplemented:true,
    migrationBaseline:'0.6.0',
    reason:mode === DataPlaneMode.REFERENCE_JSON
      ? 'JSON stores are retained only for reference and tests.'
      : 'PostgreSQL schemas and migration tooling are supplied but were not executed in this environment.',
  };
}

export function assertDevelopmentDataPlane(status) {
  if (!status.recognized) {
    throw new Error(`Unknown NOESAR_DATA_PLANE: ${status.mode}`);
  }
  if (status.mode === DataPlaneMode.POSTGRESQL) {
    throw new Error(
      'Fail-closed: the Node reference process does not claim an active PostgreSQL repository without the production adapter.'
    );
  }
  return status;
}
