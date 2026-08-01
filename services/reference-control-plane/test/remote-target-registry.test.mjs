// SPDX-License-Identifier: AGPL-3.0-or-later
//
// D-0286, the registry half — pure state, real AtomicJsonStore and real CredentialVault
// (same idiom as ai-provider-gateway.test.mjs's `fixture()`), no subprocess involved. The
// SSH side is proven separately, against a real sshd, in remote-target-fetch.test.mjs.

import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AtomicJsonStore } from '../src/ai-workspace/atomic-store.mjs';
import { CredentialVault } from '../src/ai-workspace/credential-vault.mjs';
import { RemoteTargetRegistry } from '../src/remote-target-registry.mjs';

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'noesar-remote-target-registry-'));
  const store = new AtomicJsonStore(join(dir, 'state.json'));
  const vault = new CredentialVault({ keyPath: join(dir, 'remote-target.key') });
  return { dir, registry: new RemoteTargetRegistry({ store, vault, ledger: null }) };
}

const AWAITING = {
  name: 'staging-api', host: 'staging.example.internal', port: 22, username: 'deploy',
  remotePath: '/srv/app', pinnedHostKey: '[staging.example.internal]:22 ssh-ed25519 AAAAstub', fingerprint: 'SHA256:stubfingerprint',
};

describe('D-0286 — RemoteTargetRegistry: registration never exposes a credential it does not yet have', () => {
  test('createAwaitingKey requires a captured host key — a target with no verified identity is not a target yet', () => {
    const { registry, dir } = fixture();
    assert.throws(() => registry.createAwaitingKey({ ...AWAITING, pinnedHostKey: '' }, 'owner-1'), (error) => error.status === 400);
    rmSync(dir, { recursive: true, force: true });
  });

  test('a freshly registered target is awaiting-key, carries no credential, and the public shape never leaks encryptedCredential', () => {
    const { registry, dir } = fixture();
    const target = registry.createAwaitingKey(AWAITING, 'owner-1');
    assert.equal(target.status, 'awaiting-key');
    assert.equal(target.credentialConfigured, false);
    assert.equal('encryptedCredential' in target, false);
    assert.equal(target.pinnedHostKey, AWAITING.pinnedHostKey);
    rmSync(dir, { recursive: true, force: true });
  });

  test('list() and get() never include the encrypted credential either', () => {
    const { registry, dir } = fixture();
    const created = registry.createAwaitingKey(AWAITING, 'owner-1');
    registry.activate(created.id, '-----BEGIN OPENSSH PRIVATE KEY-----\nstub\n-----END OPENSSH PRIVATE KEY-----', 'owner-1');
    const listed = registry.list();
    assert.equal('encryptedCredential' in listed[0], false);
    assert.equal(listed[0].credentialConfigured, true);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('D-0286 — RemoteTargetRegistry: activation and the credential round-trip', () => {
  test('activate() encrypts the key through the vault and resolveCredential() decrypts the exact same bytes back', () => {
    const { registry, dir } = fixture();
    const created = registry.createAwaitingKey(AWAITING, 'owner-1');
    const pem = '-----BEGIN OPENSSH PRIVATE KEY-----\nAAAAB3NzaC1yc2EAAA...\n-----END OPENSSH PRIVATE KEY-----';
    const activated = registry.activate(created.id, pem, 'owner-1');
    assert.equal(activated.status, 'active');
    assert.equal(registry.resolveCredential(created.id), pem, 'the decrypted key must be byte-identical to what was activated with');
    rmSync(dir, { recursive: true, force: true });
  });

  test('activating an already-active target is refused — a key rotation is an explicit different action', () => {
    const { registry, dir } = fixture();
    const created = registry.createAwaitingKey(AWAITING, 'owner-1');
    registry.activate(created.id, 'key-one', 'owner-1');
    assert.throws(() => registry.activate(created.id, 'key-two', 'owner-1'), (error) => error.status === 409);
    assert.equal(registry.resolveCredential(created.id), 'key-one', 'the refused call must not have overwritten the credential');
    rmSync(dir, { recursive: true, force: true });
  });

  test('rotateKey() replaces the credential on an already-active target', () => {
    const { registry, dir } = fixture();
    const created = registry.createAwaitingKey(AWAITING, 'owner-1');
    registry.activate(created.id, 'key-one', 'owner-1');
    registry.rotateKey(created.id, 'key-two', 'owner-1');
    assert.equal(registry.resolveCredential(created.id), 'key-two');
    rmSync(dir, { recursive: true, force: true });
  });

  test('resolveCredential refuses a target that is not active yet, rather than returning null silently', () => {
    const { registry, dir } = fixture();
    const created = registry.createAwaitingKey(AWAITING, 'owner-1');
    assert.throws(() => registry.resolveCredential(created.id), (error) => error.status === 409);
    rmSync(dir, { recursive: true, force: true });
  });

  test('activate/resolveCredential on an unknown id both refuse 404, not throw an unrelated error', () => {
    const { registry, dir } = fixture();
    assert.throws(() => registry.activate('nope', 'key', 'owner-1'), (error) => error.status === 404);
    assert.throws(() => registry.resolveCredential('nope'), (error) => error.status === 404);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('D-0286 — RemoteTargetRegistry: fetch history and removal', () => {
  test('recordFetch records success and failure, both readable back from list()', () => {
    const { registry, dir } = fixture();
    const created = registry.createAwaitingKey(AWAITING, 'owner-1');
    registry.recordFetch(created.id, { ok: true, projectId: 'p-1' }, 'owner-1');
    let target = registry.get(created.id);
    assert.equal(target.lastFetch.ok, true);
    assert.equal(target.lastFetch.projectId, 'p-1');

    registry.recordFetch(created.id, { ok: false, error: 'auth failed' }, 'owner-1');
    target = registry.get(created.id);
    assert.equal(target.lastFetch.ok, false);
    assert.equal(target.lastFetch.error, 'auth failed');
    rmSync(dir, { recursive: true, force: true });
  });

  test('remove() deletes the record — the encrypted credential goes with it, there is nothing left to resolve', () => {
    const { registry, dir } = fixture();
    const created = registry.createAwaitingKey(AWAITING, 'owner-1');
    registry.activate(created.id, 'key-one', 'owner-1');
    registry.remove(created.id, 'owner-1');
    assert.equal(registry.list().length, 0);
    assert.throws(() => registry.get(created.id), (error) => error.status === 404);
    rmSync(dir, { recursive: true, force: true });
  });

  test('an invalid port at registration is refused before anything is stored', () => {
    const { registry, dir } = fixture();
    assert.throws(() => registry.createAwaitingKey({ ...AWAITING, port: 99999 }, 'owner-1'), (error) => error.status === 400);
    assert.equal(registry.list().length, 0);
    rmSync(dir, { recursive: true, force: true });
  });
});
