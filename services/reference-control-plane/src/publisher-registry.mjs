// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Trusted publisher registry — D-0275, the improvement proposal named at the close of
// D-0274: "the activation gate today verifies only the signature of ONE manifest against
// a single operator-configured key — a real publisher-key registry (rotation, revocation)
// is needed before a real noesar-official/certified-partner publisher can sign anything."
//
// docs/capabilities/PUBLISHER_REVOCATION.md is the spec, verbatim: "The trusted publisher
// registry stores: publisher ID; trust level; public-key path; SHA-256 fingerprint; active
// or revoked state; registering Owner; registration timestamp. Publisher and package
// revocation require an Owner session with recent strong reauthentication. Verification
// and invocation check revocation state." Every field and both revocation grains
// (a single key, or every key a publisher holds) are implemented here, none implied.
//
// A publisher is registered at ONE trust level, not merely capable of signing at one:
// sector-modules.mjs's activateSectorModule() now checks that a manifest's OWN declared
// `trust_level` matches what this registry says that publisher was registered as, not
// merely that some key that verifies exists. Without that check a manifest could
// self-declare "noesar-official" and pass as long as any registered key signed it,
// whatever trust level that key was actually registered at — the same class of gap
// feedback_a_verdict_supplied_by_the_caller_is_not_a_verdict names.
//
// Rotation is additive, not implicit: registering a new key for an existing publisher ID
// adds it alongside any still-active older ones. A key already embedded in a signed,
// staged manifest is not silently invalidated by rotating in a replacement — an explicit
// revoke() is required, so the caller decides when the old key stops being trusted, the
// same posture update-manager.mjs takes toward its own channel keys.

import { createHash, createPublicKey, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { toUtcIso } from './timezone.mjs';

export class PublisherRegistryError extends Error {
  constructor(kind, reason) {
    super(reason);
    this.name = 'PublisherRegistryError';
    this.kind = kind;
  }
}
const refuse = (kind, reason) => { throw new PublisherRegistryError(kind, reason); };

const PUBLISHER_ID_PATTERN = /^[a-z][a-z0-9._-]{2,63}$/;

function fingerprintOf(publicKeyPem) {
  let publicKey;
  try { publicKey = createPublicKey(publicKeyPem); }
  catch { refuse('BAD_PUBLIC_KEY', 'not a valid public key'); }
  if (/PRIVATE KEY/.test(String(publicKeyPem))) refuse('PRIVATE_KEY_REFUSED', 'a private key must never be registered here');
  return createHash('sha256').update(publicKey.export({ type: 'spki', format: 'der' })).digest('hex');
}

export class PublisherRegistry {
  #root;
  #statePath;
  #ledger;
  #state;

  constructor({ root, ledger = null } = {}) {
    this.#root = root;
    mkdirSync(join(root, 'keys'), { recursive: true, mode: 0o700 });
    this.#statePath = join(root, 'registry.json');
    this.#ledger = ledger;
    this.#state = this.#load();
  }

  #load() {
    if (!existsSync(this.#statePath)) return { schemaVersion: 1, publishers: {} };
    try { return JSON.parse(readFileSync(this.#statePath, 'utf8')); }
    catch { return { schemaVersion: 1, publishers: {} }; }
  }

  #save() {
    const tmp = `${this.#statePath}.tmp-${randomUUID()}`;
    writeFileSync(tmp, JSON.stringify(this.#state, null, 2), { encoding: 'utf8', mode: 0o600 });
    renameSync(tmp, this.#statePath);
  }

  #record(action, details, actorId) {
    this.#ledger?.append({ actor: actorId ?? 'owner', action: `publisher_registry.${action}`, result: 'success', details });
  }

  /**
   * Registers a new key for `publisherId` at `trustLevel`. The first call for an id
   * creates the publisher record; a later call is a rotation — the new key is appended,
   * existing keys are untouched (still active until an explicit revoke()). Refuses if the
   * SAME fingerprint is already registered for this publisher (a rotation must produce a
   * genuinely different key, not re-declare the one already on file).
   */
  registerKey({ publisherId, trustLevel, publicKeyPem, actorId, nowUnix }) {
    if (typeof publisherId !== 'string' || !PUBLISHER_ID_PATTERN.test(publisherId)) {
      refuse('INVALID_PUBLISHER_ID', `publisher id "${publisherId}" must match ${PUBLISHER_ID_PATTERN}`);
    }
    if (typeof trustLevel !== 'string' || !trustLevel) refuse('INVALID_TRUST_LEVEL', 'a trust level is required');
    const fingerprint = fingerprintOf(publicKeyPem);
    const publisher = this.#state.publishers[publisherId] ?? {
      publisherId, trustLevel, keys: [], registeredBy: actorId ?? 'owner', registeredAtUnix: nowUnix,
    };
    if (publisher.keys.some((key) => key.fingerprint === fingerprint)) {
      refuse('KEY_ALREADY_REGISTERED', `fingerprint ${fingerprint} is already registered for "${publisherId}"`);
    }
    // Rotation may not silently change what trust level a publisher operates at: that is
    // as sensitive a change as the key itself, and gets its own explicit call
    // (setTrustLevel(), below) so it is never a side effect of adding a key.
    if (publisher.keys.length > 0 && publisher.trustLevel !== trustLevel) {
      refuse('TRUST_LEVEL_MISMATCH', `"${publisherId}" is registered at trust level "${publisher.trustLevel}"; rotate a key at that level, or call setTrustLevel() explicitly first`);
    }
    const keyPath = join(this.#root, 'keys', `${publisherId}--${fingerprint.slice(0, 16)}.pub.pem`);
    writeFileSync(keyPath, publicKeyPem, { mode: 0o600 });
    publisher.keys.push({
      fingerprint, publicKeyPath: keyPath, state: 'active',
      addedBy: actorId ?? 'owner', addedAtUnix: nowUnix, revokedBy: null, revokedAtUnix: null, revokedReason: null,
    });
    this.#state.publishers[publisherId] = publisher;
    this.#save();
    this.#record('key-registered', { publisherId, trustLevel, fingerprint }, actorId);
    return { publisherId, trustLevel, fingerprint, keyPath, registeredAtUnix: toUtcIso(nowUnix * 1000) };
  }

  /**
   * Revokes one key (`fingerprint` given) or every currently-active key this publisher
   * holds (`fingerprint` omitted — "publisher revocation", the coarser of the two grains
   * PUBLISHER_REVOCATION.md names). Idempotent on an already-revoked key: revoking twice
   * is a no-op, not an error, since the caller's intent ("this must not be trusted") is
   * already satisfied.
   */
  revoke({ publisherId, fingerprint = null, actorId, nowUnix, reason = null }) {
    const publisher = this.#state.publishers[publisherId];
    if (!publisher) refuse('UNKNOWN_PUBLISHER', `no publisher registered as "${publisherId}"`);
    const targets = fingerprint
      ? publisher.keys.filter((key) => key.fingerprint === fingerprint)
      : publisher.keys.filter((key) => key.state === 'active');
    if (fingerprint && targets.length === 0) refuse('UNKNOWN_KEY', `"${publisherId}" has no key with fingerprint ${fingerprint}`);
    let revokedCount = 0;
    for (const key of targets) {
      if (key.state === 'active') {
        key.state = 'revoked'; key.revokedBy = actorId ?? 'owner'; key.revokedAtUnix = nowUnix; key.revokedReason = reason;
        revokedCount += 1;
      }
    }
    this.#save();
    this.#record('revoked', { publisherId, fingerprint, revokedCount, reason }, actorId);
    return { publisherId, fingerprint, revokedCount };
  }

  /** Changes the trust level a publisher is registered at — a distinct, explicit action
   * (never a side effect of registerKey()), because it changes what every one of that
   * publisher's keys is allowed to sign, past and future alike. */
  setTrustLevel({ publisherId, trustLevel, actorId, nowUnix }) {
    const publisher = this.#state.publishers[publisherId];
    if (!publisher) refuse('UNKNOWN_PUBLISHER', `no publisher registered as "${publisherId}"`);
    const previous = publisher.trustLevel;
    publisher.trustLevel = trustLevel;
    this.#save();
    this.#record('trust-level-changed', { publisherId, from: previous, to: trustLevel }, actorId);
    return { publisherId, trustLevel };
  }

  /**
   * The one check activateSectorModule() spends: is `fingerprint` an ACTIVE key of
   * `publisherId`, and does `declaredTrustLevel` (the manifest's own `trust_level`) match
   * what this publisher is actually registered at? Returns null rather than throwing —
   * "not found" and "not eligible" are both simply "cannot verify", not exceptional.
   */
  findActiveKey({ publisherId, fingerprint, declaredTrustLevel }) {
    const publisher = this.#state.publishers[publisherId];
    if (!publisher) return null;
    if (declaredTrustLevel !== undefined && publisher.trustLevel !== declaredTrustLevel) return null;
    const key = publisher.keys.find((candidate) => candidate.fingerprint === fingerprint && candidate.state === 'active');
    if (!key) return null;
    try { return { publicKeyPem: readFileSync(key.publicKeyPath, 'utf8'), trustLevel: publisher.trustLevel }; }
    catch { return null; }
  }

  status() {
    const publishers = Object.values(this.#state.publishers).map((publisher) => ({
      publisherId: publisher.publisherId,
      trustLevel: publisher.trustLevel,
      registeredBy: publisher.registeredBy,
      registeredAtUnix: publisher.registeredAtUnix,
      keys: publisher.keys.map(({ fingerprint, state, addedAtUnix, revokedAtUnix }) => ({ fingerprint, state, addedAtUnix, revokedAtUnix })),
    }));
    const allKeys = publishers.flatMap((publisher) => publisher.keys);
    return {
      publisherCount: publishers.length,
      activeKeyCount: allKeys.filter((key) => key.state === 'active').length,
      revokedKeyCount: allKeys.filter((key) => key.state === 'revoked').length,
      publishers,
    };
  }
}
