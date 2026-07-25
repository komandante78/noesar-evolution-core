import test from 'node:test';
import assert from 'node:assert/strict';
import { authorityStatus, assertReferenceRuntimeAllowed } from '../src/authority.mjs';

test('reference authority is explicitly non-production', () => {
  const status = authorityStatus({});
  assert.equal(status.mode, 'reference-node');
  assert.equal(status.productionReady, false);
  assert.equal(status.canonical, false);
});

test('production channel fails closed', () => {
  const status = authorityStatus({ NOESAR_RELEASE_CHANNEL:'production' });
  assert.throws(
    () => assertReferenceRuntimeAllowed(status),
    /cannot run as a production authority/
  );
});

test('unknown authority mode is rejected', () => {
  const status = authorityStatus({ NOESAR_AUTHORITY_MODE:'unknown' });
  assert.throws(() => assertReferenceRuntimeAllowed(status), /Unknown/);
});

test('rust-external cannot be served by Node reference process', () => {
  const status = authorityStatus({
    NOESAR_AUTHORITY_MODE:'rust-external',
    NOESAR_RUST_AUTHORITY_SOCKET:'/run/noesar/authority.sock',
    NOESAR_RUST_AUTHORITY_ATTESTATION:'/run/noesar/authority.attestation.json',
  });
  assert.throws(() => assertReferenceRuntimeAllowed(status), /compiled Rust authority/);
});


test('authority status reports V1.1 source without active peer credentials', () => {
  const status = authorityStatus({});
  assert.equal(status.protocolVersion, '1.1');
  assert.equal(status.canonicalJsonImplemented, true);
  assert.equal(status.externalClientImplemented, true);
  assert.equal(status.rustDaemonSourceImplemented, true);
  assert.equal(status.unixSoPeerCredSourceImplemented, true);
  assert.equal(status.authenticatedTransportActive, false);
  assert.equal(status.serverPeerCredentialsVerified, false);
});
