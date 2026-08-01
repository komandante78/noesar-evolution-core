// SPDX-License-Identifier: AGPL-3.0-or-later
//
// D-0286: Debug Evolution's Phase 3 (Owner s302's own plan) — "bersagli remoti via SSH,
// credenziali dal vault NOESAR, mai su disco nel modulo". Pure state management, the same
// idiom `provider-gateway.mjs` already uses for a named entity backed by `CredentialVault`
// (`encryptedCredential` on the record, decrypted only through the vault, never read back
// in `publicTarget()`). SSH subprocess handling lives in `remote-target-fetch.mjs`, kept
// apart the same way `debug-evolution-triage.mjs`'s pure conversion is kept apart from
// `debug-evolution-bridge.mjs`'s I/O — this file has no opinion about SSH, only about
// records.
//
// Two states, not three: a target is created with its host key already captured
// (`awaiting-key` — the registration route does the `ssh-keyscan` synchronously, because a
// target with no verified host identity is not a target yet, just an intention), then
// `active` once the Owner has looked at the fingerprint and supplied the private key.
// `pinnedHostKey` is the host's OWN public key line (`known_hosts` format) — not a secret,
// never vaulted, and the only thing `remote-target-fetch.mjs` trusts to verify every later
// connection. Capturing the fingerprint ALONE and not the full key would be security theatre:
// `ssh`/`scp` verify against the actual public key, not a hash of it.

import { randomUUID } from 'node:crypto';

function now() { return new Date().toISOString(); }
function statusError(message, status = 400) { return Object.assign(new Error(message), { status }); }

const NAME_MAX = 120;
const PATH_MAX = 4096;

function publicTarget(target) {
  const { encryptedCredential, ...safe } = target;
  return { ...safe, credentialConfigured: Boolean(encryptedCredential) };
}

function validatePort(value) {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw statusError('Remote target port must be an integer 1-65535.');
  return port;
}

export class RemoteTargetRegistry {
  constructor({ store, vault, ledger }) { this.store = store; this.vault = vault; this.ledger = ledger; }

  list() { return this.store.read().remoteTargets.map(publicTarget); }

  get(targetId) {
    const target = this.store.read().remoteTargets.find((item) => item.id === targetId);
    if (!target) throw statusError('Remote target not found.', 404);
    return target;
  }

  /**
   * Step 1. `pinnedHostKey`/`fingerprint` are supplied by the caller (the route, which owns
   * the `ssh-keyscan` subprocess call — this module does no I/O) rather than computed here,
   * so this function stays pure and testable without a network.
   */
  createAwaitingKey({ name, host, port, username, remotePath, pinnedHostKey, fingerprint }, actorId) {
    if (!String(host ?? '').trim()) throw statusError('Remote target host is required.');
    if (!String(username ?? '').trim()) throw statusError('Remote target username is required.');
    if (!String(remotePath ?? '').trim()) throw statusError('Remote target path is required.');
    if (!String(pinnedHostKey ?? '').trim()) throw statusError('A host key must be captured before a target can be registered.');
    return this.store.transact((state) => {
      const target = {
        id: randomUUID(),
        name: String(name ?? host).slice(0, NAME_MAX),
        host: String(host).slice(0, 253),
        port: validatePort(port ?? 22),
        username: String(username).slice(0, 120),
        remotePath: String(remotePath).slice(0, PATH_MAX),
        pinnedHostKey: String(pinnedHostKey),
        fingerprint: String(fingerprint ?? ''),
        status: 'awaiting-key',
        encryptedCredential: null,
        lastFetch: null,
        createdAt: now(), updatedAt: now(),
      };
      state.remoteTargets.push(target);
      this.ledger?.append({ actor: actorId, action: 'remote_target.registered', result: 'success', details: { id: target.id, host: target.host, fingerprint: target.fingerprint } });
      return publicTarget(target);
    });
  }

  /**
   * Step 2. The private key is encrypted through the SAME vault every other credential in
   * this product uses — no new crypto, no new key material to manage. Refuses on a target
   * that is already active: a key rotation is an explicit new action (`rotateKey`), not a
   * silent overwrite of a credential something may already be mid-use with.
   */
  activate(targetId, privateKeyPem, actorId) {
    if (!String(privateKeyPem ?? '').trim()) throw statusError('A private key is required to activate a remote target.');
    return this.store.transact((state) => {
      const target = state.remoteTargets.find((item) => item.id === targetId);
      if (!target) throw statusError('Remote target not found.', 404);
      if (target.status === 'active') throw statusError('This remote target is already active; use rotateKey to replace its credential.', 409);
      target.encryptedCredential = this.vault.encrypt(privateKeyPem);
      target.status = 'active';
      target.updatedAt = now();
      this.ledger?.append({ actor: actorId, action: 'remote_target.activated', result: 'success', details: { id: target.id } });
      return publicTarget(target);
    });
  }

  rotateKey(targetId, privateKeyPem, actorId) {
    if (!String(privateKeyPem ?? '').trim()) throw statusError('A private key is required to rotate a remote target\'s credential.');
    return this.store.transact((state) => {
      const target = state.remoteTargets.find((item) => item.id === targetId);
      if (!target) throw statusError('Remote target not found.', 404);
      target.encryptedCredential = this.vault.encrypt(privateKeyPem);
      target.status = 'active';
      target.updatedAt = now();
      this.ledger?.append({ actor: actorId, action: 'remote_target.key_rotated', result: 'success', details: { id: target.id } });
      return publicTarget(target);
    });
  }

  /** Read-only: the decrypted key never appears in a state read or a ledger entry, only
   * here, and only for `remote-target-fetch.mjs` to hand straight to a tmpfs file. */
  resolveCredential(targetId) {
    const target = this.get(targetId);
    if (target.status !== 'active' || !target.encryptedCredential) throw statusError('This remote target has no active credential.', 409);
    return this.vault.decrypt(target.encryptedCredential);
  }

  recordFetch(targetId, { ok, error = null, projectId = null }, actorId) {
    return this.store.transact((state) => {
      const target = state.remoteTargets.find((item) => item.id === targetId);
      if (!target) throw statusError('Remote target not found.', 404);
      target.lastFetch = { ok: Boolean(ok), error, projectId, at: now() };
      target.updatedAt = now();
      this.ledger?.append({ actor: actorId, action: 'remote_target.fetched', result: ok ? 'success' : 'failed', details: { id: target.id, error } });
      return publicTarget(target);
    });
  }

  remove(targetId, actorId) {
    return this.store.transact((state) => {
      const index = state.remoteTargets.findIndex((item) => item.id === targetId);
      if (index === -1) throw statusError('Remote target not found.', 404);
      const [removed] = state.remoteTargets.splice(index, 1);
      this.ledger?.append({ actor: actorId, action: 'remote_target.removed', result: 'success', details: { id: removed.id, host: removed.host } });
      return { id: removed.id };
    });
  }
}
