// SPDX-License-Identifier: AGPL-3.0-or-later

export function evaluateProductionReadiness({
  authority,
  dataPlane,
  sandbox,
  platformMatrix,
  updateTrust,
  penetrationTest,
}) {
  const checks = Object.freeze({
    rustAuthority:Boolean(
      authority?.compiled
      && authority?.testsPassed
      && authority?.conformancePassed
      && authority?.authenticatedIpc
      && authority?.provenanceVerified
    ),
    postgresDataPlane:Boolean(
      dataPlane?.connected
      && dataPlane?.postgresMajor === 18
      && dataPlane?.pgvectorVersion
      && dataPlane?.migrationsVerified
      && dataPlane?.rowLevelSecurityVerified
      && dataPlane?.immutableLedgersVerified
      && dataPlane?.repositoryAdapterActive
      && dataPlane?.backupRestoreVerified
    ),
    productionSandbox:Boolean(
      sandbox?.adapterIntegrated
      && sandbox?.attestationVerified
      && sandbox?.escapeTestsPassed
    ),
    platformMatrix:Boolean(platformMatrix?.allSupportedTargetsPassed),
    updateTrust:Boolean(updateTrust?.tuf && updateTrust?.sigstore && updateTrust?.slsa),
    penetrationTest:Boolean(penetrationTest?.independent && penetrationTest?.passed),
  });
  const blockers = Object.entries(checks)
    .filter(([, passed]) => !passed)
    .map(([name]) => name);
  return {
    productionReady:blockers.length === 0,
    checks,
    blockers,
  };
}
