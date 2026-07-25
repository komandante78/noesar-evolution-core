import test from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateProductionReadiness,
} from '../src/production-readiness.mjs';

function complete() {
  return {
    authority:{
      compiled:true,
      testsPassed:true,
      conformancePassed:true,
      authenticatedIpc:true,
      provenanceVerified:true,
    },
    dataPlane:{
      connected:true,
      postgresMajor:18,
      pgvectorVersion:'0.8.0',
      migrationsVerified:true,
      rowLevelSecurityVerified:true,
      immutableLedgersVerified:true,
      repositoryAdapterActive:true,
      backupRestoreVerified:true,
    },
    sandbox:{
      adapterIntegrated:true,
      attestationVerified:true,
      escapeTestsPassed:true,
    },
    platformMatrix:{ allSupportedTargetsPassed:true },
    updateTrust:{ tuf:true, sigstore:true, slsa:true },
    penetrationTest:{ independent:true, passed:true },
  };
}

test('complete evidence is production ready', () => {
  const value = evaluateProductionReadiness(complete());
  assert.equal(value.productionReady, true);
  assert.deepEqual(value.blockers, []);
});

test('missing Rust compilation blocks promotion', () => {
  const input = complete();
  input.authority.compiled = false;
  const value = evaluateProductionReadiness(input);
  assert.equal(value.productionReady, false);
  assert.ok(value.blockers.includes('rustAuthority'));
});

test('PostgreSQL 17 blocks promotion', () => {
  const input = complete();
  input.dataPlane.postgresMajor = 17;
  assert.ok(
    evaluateProductionReadiness(input).blockers.includes('postgresDataPlane')
  );
});

test('missing backup restore evidence blocks promotion', () => {
  const input = complete();
  input.dataPlane.backupRestoreVerified = false;
  assert.ok(
    evaluateProductionReadiness(input).blockers.includes('postgresDataPlane')
  );
});

test('missing sandbox adapter blocks promotion', () => {
  const input = complete();
  input.sandbox.adapterIntegrated = false;
  assert.ok(
    evaluateProductionReadiness(input).blockers.includes('productionSandbox')
  );
});

test('incomplete platform matrix blocks promotion', () => {
  const input = complete();
  input.platformMatrix.allSupportedTargetsPassed = false;
  assert.ok(
    evaluateProductionReadiness(input).blockers.includes('platformMatrix')
  );
});

test('incomplete update trust blocks promotion', () => {
  const input = complete();
  input.updateTrust.sigstore = false;
  assert.ok(evaluateProductionReadiness(input).blockers.includes('updateTrust'));
});

test('non-independent penetration test blocks promotion', () => {
  const input = complete();
  input.penetrationTest.independent = false;
  assert.ok(
    evaluateProductionReadiness(input).blockers.includes('penetrationTest')
  );
});
