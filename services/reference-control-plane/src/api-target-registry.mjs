// SPDX-License-Identifier: AGPL-3.0-or-later
//
// D-0292: API targets — the third way to attach a target (Owner s305, point C). Pure state
// management, the same idiom `remote-target-registry.mjs` uses for a named entity backed by
// `CredentialVault`: `encryptedCredential` on the record, decrypted only through the vault,
// never returned by `publicTarget()`. The probe itself lives in `api-target-probe.mjs` and
// `debug-evolution-bridge.mjs`, kept apart the same way the SSH registry is kept apart from
// `remote-target-fetch.mjs` — this file has no opinion about HTTP, only about records.
//
// TWO STRUCTURAL DIFFERENCES from the SSH registry, both deliberate:
//
// 1. There is no `awaiting-key` state. An SSH target with no private key cannot be used at
//    all, so it was an incomplete registration; an API target with no credential is a
//    complete, useful target — TLS, security headers and advertised methods are all
//    observable without one. A credential is an upgrade here, not a precondition, which is
//    why `setCredential()` is one call rather than `activate`+`rotateKey`.
// 2. The toolpack's authorizations (`allow_private_targets`, `allow_mutation`,
//    `allow_intrusive`, `allow_billable_request`) are FIELDS OF THE TARGET, not parameters
//    of a probe. `remote-api.pyz` refuses anything that is not explicitly permitted, and
//    that model is respected rather than routed around: an Owner decides once, per target,
//    at registration, and every later probe is bound by that decision instead of by
//    whatever the caller of the moment passes in.

import { randomUUID } from 'node:crypto';

function now() { return new Date().toISOString(); }
function statusError(message, status = 400) { return Object.assign(new Error(message), { status }); }

const NAME_MAX = 120;
const PATH_MAX = 2048;
const URL_MAX = 2048;
// RFC 9110 field-name: a token. Enforced here and not left to the far end because a name
// carrying a colon, a space or a line break is header injection, and the first place able
// to refuse it is the place that accepts it from a human.
const HEADER_NAME_RE = /^[A-Za-z0-9!#$%&'*+.^_`|~-]{1,64}$/;
const CREDENTIAL_SCHEMES = new Set(['bearer', 'header']);

function publicTarget(target) {
  const { encryptedCredential, ...safe } = target;
  return { ...safe, credentialConfigured: Boolean(encryptedCredential) };
}

/**
 * Validates and normalises a base URL. Rejects credentials embedded in the URL for the same
 * reason `remote-api.pyz`'s own `TargetPolicy` does: a secret in a URL ends up in logs,
 * referrers and audit records that were never designed to hold one — and here it would also
 * bypass the vault entirely, which is the whole point of this registry.
 */
function validateBaseUrl(value) {
  const raw = String(value ?? '').trim();
  if (!raw) throw statusError('An API target needs a base URL.');
  if (raw.length > URL_MAX) throw statusError(`An API target URL may not exceed ${URL_MAX} characters.`);
  let url;
  try { url = new URL(raw); } catch { throw statusError('The API target URL is not a valid absolute URL.'); }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw statusError('An API target URL must be http:// or https://.');
  if (url.username || url.password) throw statusError('Credentials in the URL are forbidden — register them as the target credential instead, so the vault holds them.');
  if (url.hash) throw statusError('An API target URL may not carry a fragment.');
  return url.toString();
}

function validateProtectedPath(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  if (raw.length > PATH_MAX) throw statusError(`A protected path may not exceed ${PATH_MAX} characters.`);
  if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) throw statusError('The protected path must be a path relative to the base URL, not a second absolute URL.');
  if (/[\r\n]/.test(raw)) throw statusError('The protected path may not contain a line break.');
  return raw;
}

export class ApiTargetRegistry {
  constructor({ store, vault, ledger }) { this.store = store; this.vault = vault; this.ledger = ledger; }

  list() { return this.store.read().apiTargets.map(publicTarget); }

  get(targetId) {
    const target = this.store.read().apiTargets.find((item) => item.id === targetId);
    if (!target) throw statusError('API target not found.', 404);
    return target;
  }

  create({ name, baseUrl, protectedPath, allowPrivateTargets, allowMutation, allowIntrusive, allowBillable }, actorId) {
    const normalisedUrl = validateBaseUrl(baseUrl);
    const normalisedPath = validateProtectedPath(protectedPath);
    return this.store.transact((state) => {
      const target = {
        id: randomUUID(),
        name: String(name ?? normalisedUrl).slice(0, NAME_MAX),
        baseUrl: normalisedUrl,
        protectedPath: normalisedPath,
        // Every one of these defaults to false on an absent field rather than to the
        // caller's value: a probe that reaches a private address or sends a method that
        // writes must be something an Owner ticked, never something a missing field
        // implied.
        allowPrivateTargets: Boolean(allowPrivateTargets),
        allowMutation: Boolean(allowMutation),
        allowIntrusive: Boolean(allowIntrusive),
        allowBillable: Boolean(allowBillable),
        credentialScheme: null,
        credentialHeaderName: null,
        encryptedCredential: null,
        lastProbe: null,
        createdAt: now(), updatedAt: now(),
      };
      state.apiTargets.push(target);
      this.ledger?.append({
        actor: actorId, action: 'api_target.registered', result: 'success',
        details: {
          id: target.id, baseUrl: target.baseUrl,
          grants: { allowPrivateTargets: target.allowPrivateTargets, allowMutation: target.allowMutation,
                    allowIntrusive: target.allowIntrusive, allowBillable: target.allowBillable },
        },
      });
      return publicTarget(target);
    });
  }

  /**
   * Edits a target in place. Everything except the credential, which has its own route.
   *
   * Delete-and-recreate was the first answer and it was the wrong one — not because editing
   * is risky but because deleting is: the ledger ends up with `removed` and `registered`,
   * two unrelated events, instead of "this grant went from off to on, on this date, by this
   * actor". A grant is exactly the kind of thing whose HISTORY matters, so the entry below
   * records before and after for each one that actually moved, rather than a flat "updated".
   *
   * Only keys actually present in `patch` are touched, so a caller may send one field
   * without silently resetting the rest to their defaults.
   */
  update(targetId, patch, actorId) {
    const changes = {};
    const next = {};
    if (Object.hasOwn(patch, 'name')) next.name = String(patch.name ?? '').slice(0, NAME_MAX);
    if (Object.hasOwn(patch, 'baseUrl')) next.baseUrl = validateBaseUrl(patch.baseUrl);
    if (Object.hasOwn(patch, 'protectedPath')) next.protectedPath = validateProtectedPath(patch.protectedPath);
    for (const key of ['allowPrivateTargets', 'allowMutation', 'allowIntrusive', 'allowBillable']) {
      if (Object.hasOwn(patch, key)) next[key] = Boolean(patch[key]);
    }
    return this.store.transact((state) => {
      const target = state.apiTargets.find((item) => item.id === targetId);
      if (!target) throw statusError('API target not found.', 404);
      for (const [key, value] of Object.entries(next)) {
        if (target[key] === value) continue;
        changes[key] = { from: target[key], to: value };
        target[key] = value;
      }
      // A probe result describes the service that was at the OLD address. Keeping it beside
      // a new one would attribute someone else's findings to this target — the same mistake
      // the console made by leaving a previous probe's steps on screen.
      if (changes.baseUrl && target.lastProbe) {
        changes.lastProbeCleared = { from: target.lastProbe.at, to: null };
        target.lastProbe = null;
      }
      if (!Object.keys(changes).length) return publicTarget(target);
      target.updatedAt = now();
      this.ledger?.append({ actor: actorId, action: 'api_target.updated', result: 'success', details: { id: target.id, changes } });
      return publicTarget(target);
    });
  }

  /**
   * Stores (or replaces) the target's credential in the same vault every other secret in
   * this product uses. `scheme` decides only which header carries it: `bearer` is
   * `Authorization: Bearer <secret>`, `header` is `<name>: <secret>` for APIs that use
   * their own (`X-API-Key` and friends). The secret itself never appears in the ledger
   * entry — only the fact that one was set, and under which header.
   */
  setCredential(targetId, { scheme, headerName, secret }, actorId) {
    const kind = String(scheme ?? 'bearer').trim().toLowerCase();
    if (!CREDENTIAL_SCHEMES.has(kind)) throw statusError('An API credential scheme must be "bearer" or "header".');
    const name = kind === 'bearer' ? 'Authorization' : String(headerName ?? '').trim();
    if (!HEADER_NAME_RE.test(name)) throw statusError('That header name is not a valid HTTP field name.');
    const value = String(secret ?? '');
    if (!value.trim()) throw statusError('An API credential cannot be empty.');
    // The same three characters `remote-api.pyz`'s own credential broker refuses. A value
    // carrying one of them is either a paste accident or a header-injection attempt, and
    // both are better refused here than turned into a malformed request at the far end.
    if (/[\r\n\0]/.test(value)) throw statusError('An API credential may not contain a line break or a null byte.');
    return this.store.transact((state) => {
      const target = state.apiTargets.find((item) => item.id === targetId);
      if (!target) throw statusError('API target not found.', 404);
      target.credentialScheme = kind;
      target.credentialHeaderName = name;
      target.encryptedCredential = this.vault.encrypt(value);
      target.updatedAt = now();
      this.ledger?.append({ actor: actorId, action: 'api_target.credential_set', result: 'success', details: { id: target.id, scheme: kind, header: name } });
      return publicTarget(target);
    });
  }

  /**
   * The headers a probe should send, or `{}` when the target has no credential.
   *
   * Returns an empty object rather than throwing on a credential-less target, unlike the
   * SSH registry's `resolveCredential()`: there, no key meant no operation was possible;
   * here, a passive probe is a legitimate and complete use of the feature. Never called
   * anywhere a value could be logged — `api-target-probe.mjs` puts the result straight into
   * the request body and keeps no other reference to it.
   */
  resolveCredentialHeaders(targetId) {
    const target = this.get(targetId);
    if (!target.encryptedCredential) return {};
    const secret = this.vault.decrypt(target.encryptedCredential);
    const value = target.credentialScheme === 'bearer' ? `Bearer ${secret}` : secret;
    return { [target.credentialHeaderName]: value };
  }

  clearCredential(targetId, actorId) {
    return this.store.transact((state) => {
      const target = state.apiTargets.find((item) => item.id === targetId);
      if (!target) throw statusError('API target not found.', 404);
      target.credentialScheme = null;
      target.credentialHeaderName = null;
      target.encryptedCredential = null;
      target.updatedAt = now();
      this.ledger?.append({ actor: actorId, action: 'api_target.credential_cleared', result: 'success', details: { id: target.id } });
      return publicTarget(target);
    });
  }

  recordProbe(targetId, { ok, error = null, projectId = null, findingCount = null }, actorId) {
    return this.store.transact((state) => {
      const target = state.apiTargets.find((item) => item.id === targetId);
      if (!target) throw statusError('API target not found.', 404);
      target.lastProbe = { ok: Boolean(ok), error, projectId, findingCount, at: now() };
      target.updatedAt = now();
      this.ledger?.append({ actor: actorId, action: 'api_target.probed', result: ok ? 'success' : 'failed', details: { id: target.id, findingCount, error } });
      return publicTarget(target);
    });
  }

  remove(targetId, actorId) {
    return this.store.transact((state) => {
      const index = state.apiTargets.findIndex((item) => item.id === targetId);
      if (index === -1) throw statusError('API target not found.', 404);
      const [removed] = state.apiTargets.splice(index, 1);
      this.ledger?.append({ actor: actorId, action: 'api_target.removed', result: 'success', details: { id: removed.id, baseUrl: removed.baseUrl } });
      return { id: removed.id };
    });
  }
}
