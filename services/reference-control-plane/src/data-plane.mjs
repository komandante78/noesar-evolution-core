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

/**
 * Describe the data plane that is actually running.
 *
 * The distinction this preserves is the reason assertDevelopmentDataPlane above is left
 * exactly as it was: setting NOESAR_DATA_PLANE=postgresql still does not entitle the
 * process to claim a PostgreSQL data plane. Only a supervisor that has reached `ready` —
 * cluster started, migrations applied, health answered — does. Anything short of that
 * falls back to the same fail-closed path as before, so a misconfigured or broken
 * database makes the runtime refuse to start rather than quietly report PostgreSQL while
 * writing JSON.
 *
 * @param {object} options
 * @param {object} [options.env]              process environment
 * @param {object|null} [options.supervisor]  a live PostgresSupervisor, or null
 * @param {object|null} [options.health]      the supervisor's last health report
 */
export function describeDataPlane({ env = process.env, supervisor = null, health = null } = {}) {
  const status = dataPlaneStatus(env);
  if (!status.recognized) {
    throw new Error(`Unknown NOESAR_DATA_PLANE: ${status.mode}`);
  }
  if (status.mode !== DataPlaneMode.POSTGRESQL) return status;

  const ready = supervisor?.state === 'ready' && Boolean(supervisor?.pool);
  if (!ready) return assertDevelopmentDataPlane(status);

  return {
    ...status,
    connected: true,
    migrated: Number(health?.migrationCount ?? 0) > 0,
    repositoryAdapterActive: true,
    migrationCount: Number(health?.migrationCount ?? status.migrationCount),
    serverVersion: health?.serverVersion ?? null,
    serverVersionNumber: Number(health?.serverVersionNumber ?? 0),
    pgvectorVersion: health?.pgvectorVersion ?? null,
    rowLevelSecurityTables: Number(health?.rlsTables ?? 0),
    checks: health?.checks ?? {},
    // productionReady is the conjunction the health query computed, not an opinion held
    // here: PostgreSQL 18 or newer, pgvector present, migrations applied, RLS enforced,
    // and an application role that cannot bypass it.
    productionReady: Boolean(health?.productionReady),
    reason: health?.productionReady
      ? 'PostgreSQL 18 with pgvector; migrations applied; row level security enforced.'
      : 'PostgreSQL is connected; one or more production checks are not yet satisfied.',
  };
}
