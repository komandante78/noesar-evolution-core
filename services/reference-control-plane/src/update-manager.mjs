// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Local update manager — client side only.
//
// Posture, in order of importance:
//   - The system never installs anything by itself. NOTIFY_ONLY is the default and
//     automatic installation does not exist as a code path, not merely as a setting.
//   - Verification is identical for online and offline packages. An offline route
//     that verifies less would be the obvious way in.
//   - Downgrades are refused. The last installed version is recorded in the audit
//     ledger, so deleting local state does not enable a silent rollback.
//   - An update that cannot be rolled back is not applied: the backup step is not
//     skippable.
//
// This build talks to no portal. `noesar.com` is not contacted, and there is no
// downloader — the offline channel is fully functional on its own, deliberately.
import { createHash, createPublicKey, verify as verifySignature } from 'node:crypto';
import {
  cpSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync,
  statSync, writeFileSync,
} from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { canonicalJsonBytes } from './canonical-json.mjs';
import { toUtcIso } from './timezone.mjs';

export const CHANNELS = Object.freeze(['stable', 'security', 'beta', 'owner', 'offline']);
export const DEFAULT_MODE = 'NOTIFY_ONLY';
export const APPLY_CONFIRMATION = 'APPLY UPDATE';

/**
 * The complete set of fields an update check may carry off this host — `01_PRODUCT/12`:
 * "User content is never included in license/update metadata."
 *
 * This is an allowlist, and it is built by construction rather than by filtering: the
 * returned object is assembled field by field from three named values, so nothing a caller
 * passes can be carried along by accident. Rejecting a denylist here is deliberate — a
 * denylist would have to anticipate every field name user content might arrive under, and
 * this project has already established that guessing the shape of what you mean to exclude
 * is not a control (`D-0071`, `D-0073`).
 *
 * `privacy.mjs` derives its disclosed data categories from the keys of this function, so
 * the indicator cannot describe a payload different from the one that would be sent.
 *
 * This build contacts no portal, so nothing calls this in anger today. It exists so the
 * disclosure has a real producer to derive from, and so that on the day a check is wired
 * up the payload is already bounded and already tested.
 */
export function updateCheckMetadata({ installedVersion, channel } = {}) {
  return {
    productVersion: String(installedVersion ?? '0.0.0'),
    platform: `${process.platform}-${process.arch}`,
    channel: String(channel ?? 'offline'),
  };
}

const SLOTS = Object.freeze(['current', 'previous', 'staging', 'inbox', 'keys']);

function fail(message, code, status = 400) {
  return Object.assign(new Error(message), { status, code });
}

/** Numeric-dotted comparison with an optional pre-release suffix. */
export function compareVersions(left, right) {
  const parse = (value) => {
    const [core, pre = ''] = String(value ?? '').trim().split('-', 2);
    const parts = core.split('.').map((piece) => Number.parseInt(piece, 10));
    if (parts.some((piece) => !Number.isInteger(piece))) throw fail(`Malformed version: ${value}`, 'MALFORMED_VERSION');
    while (parts.length < 3) parts.push(0);
    return { parts, pre };
  };
  const a = parse(left);
  const b = parse(right);
  for (let index = 0; index < 3; index += 1) {
    if (a.parts[index] !== b.parts[index]) return a.parts[index] < b.parts[index] ? -1 : 1;
  }
  if (a.pre === b.pre) return 0;
  if (!a.pre) return 1;   // a release outranks its own pre-release
  if (!b.pre) return -1;
  return a.pre < b.pre ? -1 : 1;
}

function sha256File(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function listFiles(root) {
  const out = [];
  const walk = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const full = join(directory, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) out.push(full);
    }
  };
  if (existsSync(root)) walk(root);
  return out.sort();
}

/** Reject any manifest path that could escape the payload directory. */
function safeRelativePath(value) {
  const raw = String(value ?? '');
  if (!raw || raw.startsWith('/') || raw.includes('\0') || raw.includes('\\')) return false;
  return !raw.split('/').includes('..');
}

export class UpdateManager {
  /**
   * @param {object} options
   * @param {string} options.root            `<workspace>/updates`
   * @param {string} options.currentVersion
   * @param {(context:object) => object} options.backup     must return {verified:true} or the apply aborts
   * @param {(context:object) => Promise<boolean>} options.healthCheck
   * @param {(context:object) => Promise<object>} options.migrate
   */
  constructor({
    root, currentVersion = '0.0.0', ledger = null, logger = null, metrics = null,
    watchdog = null, clock = Date.now, backup = null, healthCheck = null, migrate = null,
    mode = DEFAULT_MODE,
  } = {}) {
    this.root = resolve(root);
    this.currentVersion = currentVersion;
    this.ledger = ledger;
    this.logger = logger;
    this.metrics = metrics;
    this.watchdog = watchdog;
    this.clock = clock;
    this.backup = backup;
    this.healthCheck = healthCheck;
    this.migrate = migrate;
    this.mode = mode;
    // AUTOMATIC_INSTALL is not a setting that could be flipped: nothing in this
    // class calls apply() on its own.
    this.automaticInstall = false;
    for (const slot of SLOTS) mkdirSync(join(this.root, slot), { recursive: true, mode: 0o700 });
    this.statePath = join(this.root, 'state.json');
    this.state = this.#loadState();
  }

  #loadState() {
    const empty = {
      schemaVersion: 1, channel: 'offline', mode: this.mode,
      installedVersion: this.currentVersion, highestEverInstalled: this.currentVersion,
      lastCheckUtc: null, staged: null, previous: null, history: [],
    };
    if (!existsSync(this.statePath)) return empty;
    try { return { ...empty, ...JSON.parse(readFileSync(this.statePath, 'utf8')) }; }
    catch { return empty; }
  }

  #saveState() {
    const temporary = `${this.statePath}.tmp`;
    writeFileSync(temporary, JSON.stringify(this.state, null, 2), { encoding: 'utf8', mode: 0o600 });
    renameSync(temporary, this.statePath);
  }

  #record(entry) {
    this.state.history = [...(this.state.history ?? []), { at: toUtcIso(this.clock()), ...entry }].slice(-100);
    this.#saveState();
    this.ledger?.append({
      actor: entry.actorId ?? 'system',
      action: `update.${entry.step}`,
      result: entry.result,
      details: { ...entry, actorId: undefined },
    });
    return entry;
  }

  // ------------------------------------------------------------------- channels

  setChannel(channel, { actorId = 'owner' } = {}) {
    const name = String(channel ?? '').toLowerCase();
    if (!CHANNELS.includes(name)) throw fail(`Unknown update channel: ${channel}`, 'UNKNOWN_CHANNEL');
    const previous = this.state.channel;
    this.state.channel = name;
    this.#record({ step: 'channel-changed', result: 'success', actorId, from: previous, to: name });
    return this.status();
  }

  /** Public keys are pinned per channel, so a beta key can never sign a stable artefact. */
  #channelKey(channel) {
    const path = join(this.root, 'keys', `${channel}.pub.pem`);
    if (!existsSync(path)) throw fail(`No pinned public key for channel "${channel}".`, 'NO_CHANNEL_KEY', 412);
    try { return createPublicKey(readFileSync(path, 'utf8')); }
    catch { throw fail(`The pinned public key for channel "${channel}" is unreadable.`, 'BAD_CHANNEL_KEY', 412); }
  }

  installChannelKey(channel, publicKeyPem, { actorId = 'owner' } = {}) {
    const name = String(channel ?? '').toLowerCase();
    if (!CHANNELS.includes(name)) throw fail(`Unknown update channel: ${channel}`, 'UNKNOWN_CHANNEL');
    try { createPublicKey(publicKeyPem); }
    catch { throw fail('Not a valid public key.', 'BAD_PUBLIC_KEY'); }
    if (/PRIVATE KEY/.test(String(publicKeyPem))) throw fail('A private key must never be installed here.', 'PRIVATE_KEY_REFUSED');
    writeFileSync(join(this.root, 'keys', `${name}.pub.pem`), publicKeyPem, { mode: 0o600 });
    this.#record({ step: 'channel-key-installed', result: 'success', actorId, channel: name });
    return { channel: name, installed: true };
  }

  // --------------------------------------------------------------- verification

  /**
   * Verify signed channel metadata. Freshness is checked because serving stale but
   * validly-signed JSON is how a security update gets suppressed.
   */
  verifyMetadata(metadata, { channel = this.state.channel, now = this.clock() } = {}) {
    if (!metadata || typeof metadata !== 'object') throw fail('Channel metadata is missing.', 'NO_METADATA');
    const { signature, ...signed } = metadata;
    if (!signature) throw fail('Channel metadata is not signed.', 'METADATA_UNSIGNED', 422);
    const key = this.#channelKey(channel);
    const raw = String(signature).replace(/^ed25519:/, '');
    const ok = verifySignature(null, canonicalJsonBytes(signed), key, Buffer.from(raw, 'base64'));
    if (!ok) throw fail('Channel metadata signature is invalid.', 'METADATA_SIGNATURE_INVALID', 422);
    if (String(signed.channel) !== String(channel)) {
      throw fail(`Metadata is for channel "${signed.channel}", not "${channel}".`, 'METADATA_CHANNEL_MISMATCH', 422);
    }
    if (!signed.expires_utc) throw fail('Channel metadata carries no expiry.', 'METADATA_NO_EXPIRY', 422);
    if (Date.parse(signed.expires_utc) <= now) {
      throw fail('Channel metadata has expired; refusing to trust it.', 'METADATA_EXPIRED', 422);
    }
    return { verified: true, metadata: signed };
  }

  /**
   * Verify a package directory. Every step is mandatory and ordered: a later check
   * never runs on material an earlier one rejected.
   */
  verifyBundle(bundleDir, { channel = this.state.channel, now = this.clock(), fromVersion = this.state.installedVersion } = {}) {
    const dir = resolve(bundleDir);
    const manifestPath = join(dir, 'manifest.json');
    const signaturePath = join(dir, 'manifest.sig');
    if (!existsSync(manifestPath)) throw fail('Update package has no manifest.json.', 'NO_MANIFEST', 422);
    if (!existsSync(signaturePath)) throw fail('Update package is not signed.', 'PACKAGE_UNSIGNED', 422);

    let manifest;
    try { manifest = JSON.parse(readFileSync(manifestPath, 'utf8')); }
    catch { throw fail('Update manifest is not valid JSON.', 'MANIFEST_MALFORMED', 422); }

    // 1. package signature, over the exact manifest bytes
    const key = this.#channelKey(channel);
    const signature = Buffer.from(String(readFileSync(signaturePath, 'utf8')).trim().replace(/^ed25519:/, ''), 'base64');
    if (!verifySignature(null, readFileSync(manifestPath), key, signature)) {
      throw fail('Update package signature is invalid.', 'PACKAGE_SIGNATURE_INVALID', 422);
    }

    // 2. channel match — a beta artefact is refused on stable
    if (String(manifest.channel) !== String(channel)) {
      throw fail(`Package is for channel "${manifest.channel}", not "${channel}".`, 'PACKAGE_CHANNEL_MISMATCH', 422);
    }

    // 3. freshness, when the manifest declares an expiry
    if (manifest.expires_utc && Date.parse(manifest.expires_utc) <= now) {
      throw fail('Update package metadata has expired.', 'PACKAGE_EXPIRED', 422);
    }

    // 4. version monotonicity (anti-rollback), against the highest ever installed
    const highest = this.state.highestEverInstalled ?? fromVersion;
    if (compareVersions(manifest.version, fromVersion) <= 0) {
      throw fail(`Refusing to install ${manifest.version} over ${fromVersion}: downgrades are not an update path.`, 'DOWNGRADE_REFUSED', 409);
    }
    if (compareVersions(manifest.version, highest) <= 0) {
      throw fail(`Refusing ${manifest.version}: version ${highest} has already been installed.`, 'ANTI_ROLLBACK', 409);
    }

    // 5. required intermediate version
    if (manifest.min_upgrade_from && compareVersions(fromVersion, manifest.min_upgrade_from) < 0) {
      throw fail(`Update requires at least ${manifest.min_upgrade_from}; this installation is ${fromVersion}.`, 'MIN_UPGRADE_FROM', 409);
    }

    // 6. payload hashes
    const payloadRoot = join(dir, 'payload');
    if (!Array.isArray(manifest.files) || manifest.files.length === 0) {
      throw fail('Update manifest lists no files.', 'MANIFEST_NO_FILES', 422);
    }
    const declared = new Map();
    for (const entry of manifest.files) {
      if (!safeRelativePath(entry.path)) throw fail(`Unsafe path in manifest: ${entry.path}`, 'UNSAFE_PATH', 422);
      declared.set(entry.path, entry.sha256);
    }
    for (const [path, expected] of declared) {
      const target = join(payloadRoot, path);
      const rel = relative(payloadRoot, target);
      if (rel.startsWith('..') || rel.startsWith(`..${sep}`)) throw fail(`Path escapes the payload: ${path}`, 'UNSAFE_PATH', 422);
      if (!existsSync(target)) throw fail(`Manifest lists a missing file: ${path}`, 'MISSING_PAYLOAD_FILE', 422);
      const actual = sha256File(target);
      if (actual !== expected) throw fail(`Payload hash mismatch for ${path}.`, 'PAYLOAD_HASH_MISMATCH', 422);
    }
    // 7. no undeclared extra file may ride along
    for (const absolute of listFiles(payloadRoot)) {
      const rel = relative(payloadRoot, absolute).split(sep).join('/');
      if (!declared.has(rel)) throw fail(`Payload contains an undeclared file: ${rel}`, 'UNDECLARED_PAYLOAD_FILE', 422);
    }

    return {
      verified: true,
      manifest,
      version: manifest.version,
      security: Boolean(manifest.security),
      requiresMigration: Boolean(manifest.requires_migration),
      fileCount: declared.size,
    };
  }

  // -------------------------------------------------------------------- staging

  /** Read the offline inbox. This is a read; it applies nothing. */
  check({ actorId = 'owner' } = {}) {
    const inbox = join(this.root, 'inbox');
    const candidates = readdirSync(inbox, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
    const available = [];
    const rejected = [];
    for (const name of candidates) {
      try {
        const result = this.verifyBundle(join(inbox, name), { channel: this.state.channel });
        available.push({ bundle: name, version: result.version, security: result.security, requiresMigration: result.requiresMigration });
      } catch (error) {
        rejected.push({ bundle: name, code: error.code ?? 'VERIFY_FAILED', reason: error.message });
      }
    }
    this.state.lastCheckUtc = toUtcIso(this.clock());
    this.#record({ step: 'check', result: 'success', actorId, channel: this.state.channel, available: available.length, rejected: rejected.length });
    return { mode: this.mode, automaticInstall: false, channel: this.state.channel, available, rejected, notifyOnly: this.mode === DEFAULT_MODE };
  }

  /** Verify a bundle and copy it into staging. Nothing is ever executed from staging. */
  stage(bundleName, { actorId = 'owner' } = {}) {
    const source = join(this.root, 'inbox', String(bundleName));
    if (!existsSync(source) || !statSync(source).isDirectory()) throw fail('Unknown update bundle.', 'UNKNOWN_BUNDLE', 404);
    // Verified for its throw, not its value: the authoritative check is the
    // re-verification of what actually landed in staging, below.
    this.verifyBundle(source, { channel: this.state.channel });
    const staging = join(this.root, 'staging');
    rmSync(staging, { recursive: true, force: true });
    mkdirSync(staging, { recursive: true, mode: 0o700 });
    cpSync(source, staging, { recursive: true });
    // Re-verify what actually landed in staging, not what was inspected in the inbox.
    const restaged = this.verifyBundle(staging, { channel: this.state.channel });
    this.state.staged = {
      bundle: String(bundleName), version: restaged.version, channel: this.state.channel,
      stagedAt: toUtcIso(this.clock()), security: restaged.security, requiresMigration: restaged.requiresMigration,
      approved: false,
    };
    this.#record({ step: 'staged', result: 'success', actorId, version: restaged.version, bundle: String(bundleName) });
    return { staged: true, ...this.state.staged };
  }

  /** Explicit owner approval. Staging without approval never becomes an install. */
  approve({ actorId = 'owner', confirmation } = {}) {
    if (!this.state.staged) throw fail('No update is staged.', 'NOTHING_STAGED', 409);
    if (confirmation !== APPLY_CONFIRMATION) {
      throw fail(`Applying an update requires the typed confirmation "${APPLY_CONFIRMATION}".`, 'CONFIRMATION_REQUIRED', 428);
    }
    this.state.staged.approved = true;
    this.state.staged.approvedBy = actorId;
    this.#record({ step: 'approved', result: 'success', actorId, version: this.state.staged.version });
    return { ...this.state.staged };
  }

  // ---------------------------------------------------------------------- apply

  /**
   * Steps 5–9 of the pipeline: backup, migrate, health, promote, verify-post,
   * with automatic rollback on failure at any of them.
   */
  async apply({ actorId = 'owner' } = {}) {
    if (this.automaticInstall) throw fail('Automatic installation is not implemented and must not be.', 'AUTOMATIC_INSTALL_FORBIDDEN', 500);
    if (!this.state.staged) throw fail('No update is staged.', 'NOTHING_STAGED', 409);
    if (!this.state.staged.approved) throw fail('The staged update has not been approved by the owner.', 'NOT_APPROVED', 403);
    this.watchdog?.assertOperationAllowed('update.apply');

    const staging = join(this.root, 'staging');
    const verified = this.verifyBundle(staging, { channel: this.state.staged.channel });
    const fromVersion = this.state.installedVersion;
    const toVersion = verified.version;

    // 5. BACKUP — not skippable. An update that cannot be rolled back is not applied.
    let backup = null;
    try {
      backup = await this.backup?.({ fromVersion, toVersion });
    } catch (error) {
      this.#record({ step: 'backup', result: 'error', actorId, fromVersion, toVersion, reason: error.message });
      throw fail(`Pre-update backup failed: ${error.message}`, 'BACKUP_FAILED', 500);
    }
    if (!backup || backup.verified !== true) {
      this.#record({ step: 'backup', result: 'error', actorId, fromVersion, toVersion, reason: 'backup not verified' });
      throw fail('Pre-update backup could not be verified; refusing to apply.', 'BACKUP_UNVERIFIED', 500);
    }
    this.#record({ step: 'backup', result: 'success', actorId, fromVersion, toVersion, backupId: backup.id ?? null });

    let migrated = false;
    try {
      // 6. MIGRATE
      if (verified.requiresMigration && this.migrate) {
        await this.migrate({ fromVersion, toVersion, dryRun: true });
        await this.migrate({ fromVersion, toVersion, dryRun: false });
        migrated = true;
        this.#record({ step: 'migrate', result: 'success', actorId, fromVersion, toVersion });
      }

      // 7. HEALTH of the candidate
      const candidateHealthy = this.healthCheck ? await this.healthCheck({ phase: 'candidate', version: toVersion }) : true;
      if (!candidateHealthy) throw fail('Candidate failed its health check.', 'CANDIDATE_UNHEALTHY', 500);
      this.#record({ step: 'health', result: 'success', actorId, phase: 'candidate', version: toVersion });

      // 8. PROMOTE — atomic slot switch
      this.#promote(toVersion);

      // 9. VERIFY-POST
      const promotedHealthy = this.healthCheck ? await this.healthCheck({ phase: 'promoted', version: toVersion }) : true;
      if (!promotedHealthy) throw fail('Post-promotion verification failed.', 'POST_PROMOTION_UNHEALTHY', 500);
      this.#record({ step: 'verify-post', result: 'success', actorId, version: toVersion });
    } catch (error) {
      const rollback = await this.rollback({ actorId, reason: error.message, restoreWorkspace: migrated, backup });
      this.#record({ step: 'apply', result: 'rolled-back', actorId, fromVersion, toVersion, reason: error.message });
      throw Object.assign(
        fail(`Update failed and was rolled back: ${error.message}`, error.code ?? 'UPDATE_FAILED', error.status ?? 500),
        { rollback },
      );
    }

    this.state.installedVersion = toVersion;
    if (compareVersions(toVersion, this.state.highestEverInstalled ?? '0.0.0') > 0) {
      this.state.highestEverInstalled = toVersion;
    }
    this.state.staged = null;
    this.currentVersion = toVersion;
    this.metrics?.setGauge('noesar_update_state', 1);
    this.#record({ step: 'apply', result: 'success', actorId, fromVersion, toVersion });
    return { applied: true, fromVersion, version: toVersion, rolledBack: false };
  }

  #promote(version) {
    const current = join(this.root, 'current');
    const previous = join(this.root, 'previous');
    const staging = join(this.root, 'staging');
    // `previous/` is never removed until a new promotion has passed its health check,
    // which is why it is replaced here and not earlier.
    rmSync(previous, { recursive: true, force: true });
    if (existsSync(current) && listFiles(current).length) cpSync(current, previous, { recursive: true });
    else mkdirSync(previous, { recursive: true, mode: 0o700 });
    rmSync(current, { recursive: true, force: true });
    cpSync(staging, current, { recursive: true });
    rmSync(staging, { recursive: true, force: true });
    mkdirSync(staging, { recursive: true, mode: 0o700 });
    this.state.previous = { version: this.state.installedVersion, keptAt: toUtcIso(this.clock()) };
    this.#saveState();
    return version;
  }

  async rollback({ actorId = 'owner', reason = 'manual', restoreWorkspace = false, backup = null } = {}) {
    const previous = join(this.root, 'previous');
    const current = join(this.root, 'current');
    const restored = this.state.previous?.version ?? this.state.installedVersion;
    if (existsSync(previous) && listFiles(previous).length) {
      rmSync(current, { recursive: true, force: true });
      cpSync(previous, current, { recursive: true });
    }
    let workspaceRestored = false;
    if (restoreWorkspace && backup?.restore) {
      // Forward migrations are not assumed reversible, so once they have run the
      // workspace must come back from the pre-update backup, not from the image swap.
      await backup.restore();
      workspaceRestored = true;
    }
    this.state.installedVersion = restored;
    this.currentVersion = restored;
    this.state.staged = null;
    const healthy = this.healthCheck ? await this.healthCheck({ phase: 'rolled-back', version: restored }) : true;
    this.metrics?.setGauge('noesar_update_state', healthy ? 0 : -1);
    this.#record({
      step: 'rollback', result: healthy ? 'success' : 'error', actorId,
      restoredVersion: restored, reason, workspaceRestored, migrationsHadRun: restoreWorkspace,
    });
    return { rolledBack: true, version: restored, workspaceRestored, healthy };
  }

  status() {
    return {
      mode: this.mode,
      automaticInstall: false,
      ownerApprovalRequired: true,
      offlineUpdate: true,
      rollbackRequired: true,
      portalConfigured: false,
      channel: this.state.channel,
      channels: [...CHANNELS],
      installedVersion: this.state.installedVersion,
      highestEverInstalled: this.state.highestEverInstalled,
      previousVersion: this.state.previous?.version ?? null,
      lastCheckUtc: this.state.lastCheckUtc,
      staged: this.state.staged,
      slots: Object.fromEntries(SLOTS.filter((slot) => slot !== 'keys').map((slot) => [slot, listFiles(join(this.root, slot)).length])),
      pinnedChannelKeys: readdirSync(join(this.root, 'keys')).filter((name) => name.endsWith('.pub.pem')).map((name) => name.replace('.pub.pem', '')),
    };
  }

  history() { return [...(this.state.history ?? [])].reverse(); }
}
