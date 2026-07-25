// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Every key in this file is generated at run time and never written to the
// repository. No real signing key exists in this project.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign as signBytes, createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { UpdateManager, CHANNELS, APPLY_CONFIRMATION, compareVersions } from '../src/update-manager.mjs';
import { canonicalJsonBytes } from '../src/canonical-json.mjs';
import { AuditLedger } from '../src/audit.mjs';

function keypair() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  return {
    privateKey,
    publicPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
  };
}

function sha256(buffer) { return createHash('sha256').update(buffer).digest('hex'); }

/** Build a signed offline bundle in the inbox. */
function buildBundle(root, name, { channel = 'offline', version = '0.7.0', privateKey,
  files = { 'app/marker.txt': 'payload contents' }, minUpgradeFrom = null,
  requiresMigration = false, security = false, expiresUtc = '2099-01-01T00:00:00Z',
  tamperPayload = false, extraUndeclaredFile = false, unsafePath = false } = {}) {
  const dir = join(root, 'inbox', name);
  const payload = join(dir, 'payload');
  mkdirSync(payload, { recursive: true });
  const entries = [];
  for (const [path, content] of Object.entries(files)) {
    const target = join(payload, path);
    mkdirSync(join(target, '..'), { recursive: true });
    writeFileSync(target, content);
    entries.push({ path, sha256: sha256(Buffer.from(content)), bytes: Buffer.byteLength(content) });
  }
  if (unsafePath) entries.push({ path: '../escape.txt', sha256: sha256(Buffer.from('x')), bytes: 1 });
  const manifest = {
    channel, version, generated_utc: '2026-07-25T06:00:00Z', expires_utc: expiresUtc,
    min_upgrade_from: minUpgradeFrom, requires_migration: requiresMigration, security,
    files: entries,
  };
  const manifestBytes = Buffer.from(JSON.stringify(manifest, null, 2));
  writeFileSync(join(dir, 'manifest.json'), manifestBytes);
  writeFileSync(join(dir, 'manifest.sig'), signBytes(null, manifestBytes, privateKey).toString('base64'));
  if (tamperPayload) writeFileSync(join(payload, Object.keys(files)[0]), 'tampered after signing');
  if (extraUndeclaredFile) writeFileSync(join(payload, 'stowaway.sh'), '#!/bin/sh\necho hi\n');
  return dir;
}

function manager(options = {}) {
  const workspace = mkdtempSync(join(tmpdir(), 'noesar-upd-'));
  const root = join(workspace, 'updates');
  const ledger = new AuditLedger(join(workspace, 'audit/events.jsonl'));
  const calls = { backups: 0, migrations: [], healthChecks: [], restores: 0 };
  const updates = new UpdateManager({
    root,
    currentVersion: options.currentVersion ?? '0.6.0',
    ledger,
    clock: () => Date.parse('2026-07-25T06:00:00Z'),
    backup: options.backup ?? (async () => {
      calls.backups += 1;
      return { id: 'bk-1', verified: true, restore: async () => { calls.restores += 1; } };
    }),
    migrate: options.migrate ?? (async (context) => { calls.migrations.push(context); }),
    healthCheck: options.healthCheck ?? (async (context) => { calls.healthChecks.push(context); return true; }),
    ...options.managerOptions,
  });
  return { workspace, root, ledger, updates, calls };
}

function withKey(channel = 'offline', options = {}) {
  const context = manager(options);
  const keys = keypair();
  context.updates.installChannelKey(channel, keys.publicPem);
  context.updates.setChannel(channel);
  return { ...context, keys };
}

// ---------------------------------------------------------------------- posture

test('the default posture is notify-only with no automatic installation', () => {
  const { updates } = manager();
  const status = updates.status();
  assert.equal(status.mode, 'NOTIFY_ONLY');
  assert.equal(status.automaticInstall, false);
  assert.equal(status.ownerApprovalRequired, true);
  assert.equal(status.offlineUpdate, true);
  assert.equal(status.rollbackRequired, true);
  assert.equal(status.portalConfigured, false, 'no portal is contacted in this build');
});

test('all five channels exist and unknown channels are refused', () => {
  const { updates } = manager();
  assert.deepEqual(CHANNELS, ['stable', 'security', 'beta', 'owner', 'offline']);
  assert.throws(() => updates.setChannel('pirate'), /Unknown update channel/);
});

test('the update manager makes no network call', () => {
  // Comments are stripped first: the module *documents* that it does not contact
  // noesar.com, and a documentation mention is not a capability.
  const source = readFileSync(new URL('../src/update-manager.mjs', import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').map((line) => line.replace(/(^|\s)\/\/.*$/, '$1')).join('\n');
  for (const forbidden of ['fetch(', 'node:http', 'node:https', 'node:net', 'node:dns', 'noesar.com', 'http://', 'https://']) {
    assert.ok(!source.includes(forbidden), `the update manager must not reference ${forbidden}`);
  }
});

test('a private key is refused where a public key is expected', () => {
  const { updates } = manager();
  const { privateKey } = generateKeyPairSync('ed25519');
  const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  assert.throws(() => updates.installChannelKey('stable', pem), /private key must never be installed/i);
});

// ----------------------------------------------------------- signed metadata

test('signed channel metadata is accepted and its signature is actually checked', () => {
  const { updates, keys } = withKey('stable');
  const body = { channel: 'stable', generated_utc: '2026-07-25T00:00:00Z', expires_utc: '2026-08-01T00:00:00Z', releases: [] };
  const signature = signBytes(null, canonicalJsonBytes(body), keys.privateKey).toString('base64');
  assert.equal(updates.verifyMetadata({ ...body, signature }, { channel: 'stable' }).verified, true);
  const tampered = { ...body, releases: [{ version: '9.9.9' }] };
  assert.throws(() => updates.verifyMetadata({ ...tampered, signature }, { channel: 'stable' }), /signature is invalid/);
});

test('unsigned channel metadata is refused', () => {
  const { updates } = withKey('stable');
  assert.throws(
    () => updates.verifyMetadata({ channel: 'stable', expires_utc: '2099-01-01T00:00:00Z' }, { channel: 'stable' }),
    /not signed/,
  );
});

test('expired metadata is refused, so a stale-metadata attack cannot suppress a fix', () => {
  const { updates, keys } = withKey('stable');
  const body = { channel: 'stable', generated_utc: '2026-01-01T00:00:00Z', expires_utc: '2026-01-08T00:00:00Z', releases: [] };
  const signature = signBytes(null, canonicalJsonBytes(body), keys.privateKey).toString('base64');
  assert.throws(() => updates.verifyMetadata({ ...body, signature }, { channel: 'stable' }), /expired/);
});

test('metadata for another channel is refused', () => {
  const { updates, keys } = withKey('stable');
  const body = { channel: 'beta', generated_utc: '2026-07-25T00:00:00Z', expires_utc: '2099-01-01T00:00:00Z', releases: [] };
  const signature = signBytes(null, canonicalJsonBytes(body), keys.privateKey).toString('base64');
  assert.throws(() => updates.verifyMetadata({ ...body, signature }, { channel: 'stable' }), /not "stable"/);
});

// ------------------------------------------------------------ signed packages

test('a correctly signed package verifies', () => {
  const { updates, root, keys } = withKey('offline');
  buildBundle(root, 'v070', { privateKey: keys.privateKey });
  const result = updates.verifyBundle(join(root, 'inbox', 'v070'));
  assert.equal(result.verified, true);
  assert.equal(result.version, '0.7.0');
  assert.equal(result.fileCount, 1);
});

test('a wrong signature is refused', () => {
  const { updates, root } = withKey('offline');
  const attacker = keypair();
  buildBundle(root, 'forged', { privateKey: attacker.privateKey });
  assert.throws(() => updates.verifyBundle(join(root, 'inbox', 'forged')), /signature is invalid/);
});

test('an unsigned package is refused', () => {
  const { updates, root, keys } = withKey('offline');
  const dir = buildBundle(root, 'nosig', { privateKey: keys.privateKey });
  rmSync(join(dir, 'manifest.sig'));
  assert.throws(() => updates.verifyBundle(dir), /not signed/);
});

test('a payload tampered with after signing is refused', () => {
  const { updates, root, keys } = withKey('offline');
  buildBundle(root, 'tampered', { privateKey: keys.privateKey, tamperPayload: true });
  assert.throws(() => updates.verifyBundle(join(root, 'inbox', 'tampered')), /hash mismatch/);
});

test('an undeclared file cannot ride along inside the payload', () => {
  const { updates, root, keys } = withKey('offline');
  buildBundle(root, 'stowaway', { privateKey: keys.privateKey, extraUndeclaredFile: true });
  assert.throws(() => updates.verifyBundle(join(root, 'inbox', 'stowaway')), /undeclared file/);
});

test('a traversal path in the manifest is refused', () => {
  const { updates, root, keys } = withKey('offline');
  buildBundle(root, 'traversal', { privateKey: keys.privateKey, unsafePath: true });
  assert.throws(() => updates.verifyBundle(join(root, 'inbox', 'traversal')), /Unsafe path/);
});

test('a beta key cannot sign a stable artefact: channels have separate pinned keys', () => {
  const context = manager();
  const stable = keypair();
  const beta = keypair();
  context.updates.installChannelKey('stable', stable.publicPem);
  context.updates.installChannelKey('beta', beta.publicPem);
  context.updates.setChannel('stable');
  buildBundle(context.root, 'betabuild', { channel: 'stable', privateKey: beta.privateKey });
  assert.throws(() => context.updates.verifyBundle(join(context.root, 'inbox', 'betabuild')), /signature is invalid/);
});

test('a beta artefact is refused on the stable channel even when correctly signed', () => {
  const { updates, root, keys } = withKey('stable');
  buildBundle(root, 'betapkg', { channel: 'beta', privateKey: keys.privateKey });
  assert.throws(() => updates.verifyBundle(join(root, 'inbox', 'betapkg')), /not "stable"/);
});

test('a channel with no pinned key cannot verify anything', () => {
  const { updates, root } = manager();
  const keys = keypair();
  updates.setChannel('offline');
  buildBundle(root, 'nokey', { privateKey: keys.privateKey });
  assert.throws(() => updates.verifyBundle(join(root, 'inbox', 'nokey')), /No pinned public key/);
});

// -------------------------------------------------------------- anti-rollback

test('version comparison orders releases and pre-releases correctly', () => {
  assert.equal(compareVersions('0.7.0', '0.6.0'), 1);
  assert.equal(compareVersions('0.6.0', '0.7.0'), -1);
  assert.equal(compareVersions('1.0.0', '1.0.0'), 0);
  assert.equal(compareVersions('1.2.10', '1.2.9'), 1);
  assert.equal(compareVersions('1.0.0', '1.0.0-rc1'), 1);
  assert.throws(() => compareVersions('not-a-version', '1.0.0'), /Malformed version/);
});

test('a downgrade is refused', () => {
  const { updates, root, keys } = withKey('offline', { currentVersion: '0.8.0' });
  buildBundle(root, 'older', { privateKey: keys.privateKey, version: '0.7.0' });
  assert.throws(() => updates.verifyBundle(join(root, 'inbox', 'older')), /downgrades are not an update path/);
});

test('reinstalling the same version is refused', () => {
  const { updates, root, keys } = withKey('offline', { currentVersion: '0.7.0' });
  buildBundle(root, 'same', { privateKey: keys.privateKey, version: '0.7.0' });
  assert.throws(() => updates.verifyBundle(join(root, 'inbox', 'same')), /downgrades are not an update path/);
});

test('anti-rollback survives a rollback: a version already installed once cannot return', async () => {
  const { updates, root, keys } = withKey('offline', { currentVersion: '0.6.0' });
  buildBundle(root, 'v070', { privateKey: keys.privateKey, version: '0.7.0' });
  updates.stage('v070');
  updates.approve({ confirmation: APPLY_CONFIRMATION });
  await updates.apply({});
  assert.equal(updates.status().installedVersion, '0.7.0');
  await updates.rollback({ reason: 'operator choice' });
  assert.equal(updates.status().installedVersion, '0.6.0');
  assert.equal(updates.status().highestEverInstalled, '0.7.0');
  buildBundle(root, 'v070again', { privateKey: keys.privateKey, version: '0.7.0' });
  assert.throws(() => updates.verifyBundle(join(root, 'inbox', 'v070again')), /has already been installed/);
});

test('a required intermediate version cannot be skipped', () => {
  const { updates, root, keys } = withKey('offline', { currentVersion: '0.6.0' });
  buildBundle(root, 'v090', { privateKey: keys.privateKey, version: '0.9.0', minUpgradeFrom: '0.8.0' });
  assert.throws(() => updates.verifyBundle(join(root, 'inbox', 'v090')), /requires at least 0\.8\.0/);
});

// ---------------------------------------------------------------------- slots

test('check reports available and rejected bundles without applying anything', () => {
  const { updates, root, keys } = withKey('offline');
  buildBundle(root, 'good', { privateKey: keys.privateKey, version: '0.7.0' });
  buildBundle(root, 'bad', { privateKey: keypair().privateKey, version: '0.8.0' });
  const result = updates.check({});
  assert.equal(result.notifyOnly, true);
  assert.equal(result.automaticInstall, false);
  assert.equal(result.available.length, 1);
  assert.equal(result.available[0].version, '0.7.0');
  assert.equal(result.rejected.length, 1);
  assert.equal(result.rejected[0].code, 'PACKAGE_SIGNATURE_INVALID');
  assert.equal(updates.status().installedVersion, '0.6.0', 'checking must not install');
});

test('staging copies into staging/ and never over current/', () => {
  const { updates, root, keys } = withKey('offline');
  buildBundle(root, 'v070', { privateKey: keys.privateKey });
  const staged = updates.stage('v070');
  assert.equal(staged.staged, true);
  assert.equal(staged.approved, false);
  assert.ok(existsSync(join(root, 'staging', 'manifest.json')));
  assert.equal(updates.status().slots.current, 0, 'current must be untouched by staging');
});

test('applying without owner approval is refused', async () => {
  const { updates, root, keys } = withKey('offline');
  buildBundle(root, 'v070', { privateKey: keys.privateKey });
  updates.stage('v070');
  await assert.rejects(() => updates.apply({}), /has not been approved/);
});

test('approval requires a typed confirmation', () => {
  const { updates, root, keys } = withKey('offline');
  buildBundle(root, 'v070', { privateKey: keys.privateKey });
  updates.stage('v070');
  assert.throws(() => updates.approve({ confirmation: 'yes' }), /typed confirmation/);
  assert.doesNotThrow(() => updates.approve({ confirmation: APPLY_CONFIRMATION }));
});

test('a full apply backs up, health-checks, promotes and keeps the previous slot', async () => {
  const { updates, root, keys, calls } = withKey('offline');
  buildBundle(root, 'v070', { privateKey: keys.privateKey, version: '0.7.0' });
  updates.stage('v070');
  updates.approve({ confirmation: APPLY_CONFIRMATION });
  const result = await updates.apply({ actorId: 'owner-1' });
  assert.equal(result.applied, true);
  assert.equal(result.version, '0.7.0');
  assert.equal(calls.backups, 1, 'the backup step is not skippable');
  assert.deepEqual(calls.healthChecks.map((c) => c.phase), ['candidate', 'promoted']);
  assert.ok(existsSync(join(root, 'current', 'manifest.json')));
  assert.equal(updates.status().slots.staging, 0, 'staging is cleared after promotion');
});

test('an unverified backup aborts the apply before anything changes', async () => {
  const { updates, root, keys } = withKey('offline', { backup: async () => ({ id: 'bk', verified: false }) });
  buildBundle(root, 'v070', { privateKey: keys.privateKey });
  updates.stage('v070');
  updates.approve({ confirmation: APPLY_CONFIRMATION });
  await assert.rejects(() => updates.apply({}), /backup could not be verified/);
  assert.equal(updates.status().installedVersion, '0.6.0');
  assert.equal(updates.status().slots.current, 0, 'nothing may be promoted without a verified backup');
});

test('a failing backup aborts the apply', async () => {
  const { updates, root, keys } = withKey('offline', { backup: async () => { throw new Error('disk full'); } });
  buildBundle(root, 'v070', { privateKey: keys.privateKey });
  updates.stage('v070');
  updates.approve({ confirmation: APPLY_CONFIRMATION });
  await assert.rejects(() => updates.apply({}), /Pre-update backup failed/);
  assert.equal(updates.status().installedVersion, '0.6.0');
});

test('a candidate that fails its health check is rolled back automatically', async () => {
  const { updates, root, keys } = withKey('offline', {
    healthCheck: async (context) => context.phase !== 'candidate',
  });
  buildBundle(root, 'v070', { privateKey: keys.privateKey });
  updates.stage('v070');
  updates.approve({ confirmation: APPLY_CONFIRMATION });
  await assert.rejects(() => updates.apply({}), /rolled back/);
  assert.equal(updates.status().installedVersion, '0.6.0');
});

test('a failed migration rolls back and restores the workspace from the backup', async () => {
  const { updates, root, keys, calls } = withKey('offline', {
    migrate: async (context) => { if (!context.dryRun) throw new Error('migration 0007 failed'); },
  });
  buildBundle(root, 'v070', { privateKey: keys.privateKey, requiresMigration: true });
  updates.stage('v070');
  updates.approve({ confirmation: APPLY_CONFIRMATION });
  await assert.rejects(() => updates.apply({}), /migration 0007 failed/);
  assert.equal(updates.status().installedVersion, '0.6.0');
  assert.equal(calls.restores, 0, 'a migration that failed before completing needs no workspace restore');
});

test('a post-promotion failure after a migration restores the workspace', async () => {
  const { updates, root, keys, calls } = withKey('offline', {
    healthCheck: async (context) => context.phase !== 'promoted',
  });
  buildBundle(root, 'v070', { privateKey: keys.privateKey, requiresMigration: true });
  updates.stage('v070');
  updates.approve({ confirmation: APPLY_CONFIRMATION });
  await assert.rejects(() => updates.apply({}), /rolled back/);
  assert.equal(calls.restores, 1, 'forward migrations are not reversible, so the workspace comes back from backup');
  assert.equal(updates.status().installedVersion, '0.6.0');
});

test('a migration dry run always precedes the real one', async () => {
  const { updates, root, keys, calls } = withKey('offline');
  buildBundle(root, 'v070', { privateKey: keys.privateKey, requiresMigration: true });
  updates.stage('v070');
  updates.approve({ confirmation: APPLY_CONFIRMATION });
  await updates.apply({});
  assert.deepEqual(calls.migrations.map((c) => c.dryRun), [true, false]);
});

test('rollback restores the previous slot and reports health', async () => {
  const { updates, root, keys } = withKey('offline');
  buildBundle(root, 'v070', { privateKey: keys.privateKey, version: '0.7.0' });
  updates.stage('v070');
  updates.approve({ confirmation: APPLY_CONFIRMATION });
  await updates.apply({});
  const result = await updates.rollback({ actorId: 'owner-1', reason: 'manual test' });
  assert.equal(result.rolledBack, true);
  assert.equal(result.version, '0.6.0');
  assert.equal(result.healthy, true);
});

test('safe mode blocks apply but leaves rollback available', async () => {
  const workspace = mkdtempSync(join(tmpdir(), 'noesar-upd-sm-'));
  const keys = keypair();
  const watchdog = {
    assertOperationAllowed: (operation) => {
      if (operation === 'update.apply') throw Object.assign(new Error('safe mode'), { status: 503 });
      return true;
    },
  };
  const updates = new UpdateManager({
    root: join(workspace, 'updates'), currentVersion: '0.6.0', watchdog,
    clock: () => Date.parse('2026-07-25T06:00:00Z'),
    backup: async () => ({ id: 'bk', verified: true }),
    healthCheck: async () => true,
  });
  updates.installChannelKey('offline', keys.publicPem);
  updates.setChannel('offline');
  buildBundle(join(workspace, 'updates'), 'v070', { privateKey: keys.privateKey });
  updates.stage('v070');
  updates.approve({ confirmation: APPLY_CONFIRMATION });
  await assert.rejects(() => updates.apply({}), /safe mode/);
  await assert.doesNotReject(() => updates.rollback({ reason: 'recovery' }));
});

test('every step is written to the audit ledger and the history', async () => {
  const { updates, root, keys, ledger } = withKey('offline');
  buildBundle(root, 'v070', { privateKey: keys.privateKey });
  updates.check({ actorId: 'owner-1' });
  updates.stage('v070', { actorId: 'owner-1' });
  updates.approve({ actorId: 'owner-1', confirmation: APPLY_CONFIRMATION });
  await updates.apply({ actorId: 'owner-1' });
  const actions = ledger.readAll().map((event) => event.action);
  for (const expected of ['update.check', 'update.staged', 'update.approved', 'update.backup', 'update.health', 'update.apply']) {
    assert.ok(actions.includes(expected), `${expected} must be audited`);
  }
  assert.equal(ledger.verify(), true);
  assert.ok(updates.history().some((entry) => entry.step === 'apply' && entry.result === 'success'));
});

test('no update state file ever contains a private key', async () => {
  const { updates, root, keys } = withKey('offline');
  buildBundle(root, 'v070', { privateKey: keys.privateKey });
  updates.stage('v070');
  updates.approve({ confirmation: APPLY_CONFIRMATION });
  await updates.apply({});
  const state = readFileSync(join(root, 'state.json'), 'utf8');
  assert.ok(!state.includes('PRIVATE KEY'));
  assert.ok(!state.includes('BEGIN'));
});
