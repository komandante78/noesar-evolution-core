import test from 'node:test';
import assert from 'node:assert/strict';
import { dataPlaneStatus, assertDevelopmentDataPlane } from '../src/data-plane.mjs';

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
