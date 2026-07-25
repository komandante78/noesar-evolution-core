import test from 'node:test';
import assert from 'node:assert/strict';
import { dataPlaneStatus, assertDevelopmentDataPlane, describeDataPlane } from '../src/data-plane.mjs';

test('reference JSON data plane is explicitly non-production', () => {
  const status = dataPlaneStatus({});
  assert.equal(status.mode, 'reference-json');
  assert.equal(status.productionReady, false);
  assert.equal(status.connected, false);
});

test('unknown data plane is rejected', () => {
  assert.throws(
    () => assertDevelopmentDataPlane(dataPlaneStatus({ NOESAR_DATA_PLANE:'unknown' })),
    /Unknown/
  );
});

test('postgres configuration does not imply connection', () => {
  const status = dataPlaneStatus({
    NOESAR_DATA_PLANE:'postgresql',
    NOESAR_DATABASE_URL:'postgresql://example.invalid/noesar',
  });
  assert.equal(status.databaseUrlConfigured, true);
  assert.equal(status.connected, false);
  assert.equal(status.productionReady, false);
});

test('reference process refuses to claim PostgreSQL authority', () => {
  const status = dataPlaneStatus({ NOESAR_DATA_PLANE:'postgresql' });
  assert.throws(() => assertDevelopmentDataPlane(status), /does not claim an active PostgreSQL repository/);
});

// --- describeDataPlane: what the runtime reports once a database is actually up ------

test('describeDataPlane still fails closed when postgresql is declared but not running', () => {
  const status = dataPlaneStatus({ NOESAR_DATA_PLANE:'postgresql' });
  assert.throws(
    () => describeDataPlane({ env:{ NOESAR_DATA_PLANE:'postgresql' }, supervisor:null }),
    /does not claim an active PostgreSQL repository/,
  );
  assert.equal(status.connected, false);
});

test('a supervisor that is not yet ready does not entitle the runtime to claim PostgreSQL', () => {
  for (const supervisor of [
    { state:'starting', pool:{} },
    { state:'ready', pool:null },
    { state:'degraded', pool:{} },
    { state:'failed', pool:{} },
  ]) {
    assert.throws(
      () => describeDataPlane({ env:{ NOESAR_DATA_PLANE:'postgresql' }, supervisor }),
      /does not claim an active PostgreSQL repository/,
      `state=${supervisor.state} pool=${Boolean(supervisor.pool)}`,
    );
  }
});

test('a ready supervisor reports connected, and productionReady mirrors the health checks', () => {
  const supervisor = { state:'ready', pool:{} };
  const health = {
    serverVersion:'18.4', serverVersionNumber:180004, pgvectorVersion:'0.8.5',
    migrationCount:16, rlsTables:15, productionReady:true,
    checks:{ postgres18:true, pgvector:true, migrations:true, rowLevelSecurity:true, appRoleNoBypassRls:true },
  };
  const described = describeDataPlane({ env:{ NOESAR_DATA_PLANE:'postgresql' }, supervisor, health });
  assert.equal(described.mode, 'postgresql');
  assert.equal(described.connected, true);
  assert.equal(described.migrated, true);
  assert.equal(described.repositoryAdapterActive, true);
  assert.equal(described.pgvectorVersion, '0.8.5');
  assert.equal(described.productionReady, true);
});

test('a connected database with a failed check is connected but NOT production ready', () => {
  const described = describeDataPlane({
    env:{ NOESAR_DATA_PLANE:'postgresql' },
    supervisor:{ state:'ready', pool:{} },
    health:{
      serverVersionNumber:180004, migrationCount:16, rlsTables:0, productionReady:false,
      checks:{ postgres18:true, pgvector:true, migrations:true, rowLevelSecurity:false, appRoleNoBypassRls:true },
    },
  });
  assert.equal(described.connected, true);
  assert.equal(described.productionReady, false);
  assert.match(described.reason, /not yet satisfied/);
});

test('reference-json is unaffected by describeDataPlane', () => {
  const described = describeDataPlane({ env:{} });
  assert.equal(described.mode, 'reference-json');
  assert.equal(described.connected, false);
  assert.equal(described.productionReady, false);
});

test('an unknown mode is rejected by describeDataPlane too', () => {
  assert.throws(() => describeDataPlane({ env:{ NOESAR_DATA_PLANE:'mysql' } }), /Unknown/);
});
