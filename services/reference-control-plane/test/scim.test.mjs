// SPDX-License-Identifier: AGPL-3.0-or-later
// Phase 7 step 30 (SCIM third): provisioning tokens and resource mapping. No Rust twin
// (see the module comment in src/scim.mjs).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ScimError, ScimTokenStore, mintScimToken, listScimTokens, revokeScimToken,
  authenticateScimToken, toScimUser, scimListResponse, scimServiceProviderConfig,
  scimError, applyScimPatch, scimStatus,
} from '../src/scim.mjs';

function tmpStore() {
  const dir = mkdtempSync(join(tmpdir(), 'noesar-scim-'));
  return { dir, store: new ScimTokenStore(join(dir, 'scim-tokens.json')) };
}

test('mintScimToken then authenticateScimToken resolves the sponsor', () => {
  const { dir, store } = tmpStore();
  try {
    const minted = mintScimToken(store, { sponsorActorId:'owner-1', name:'okta' });
    assert.equal(typeof minted.token, 'string');
    const resolved = authenticateScimToken(store, minted.token);
    assert.equal(resolved.sponsorActorId, 'owner-1');
    assert.equal(resolved.tokenId, minted.tokenId);
  } finally { rmSync(dir, { recursive:true, force:true }); }
});

test('authenticateScimToken returns null (never a reason) for an unknown token', () => {
  const { dir, store } = tmpStore();
  try {
    assert.equal(authenticateScimToken(store, 'not-a-real-token'), null);
    assert.equal(authenticateScimToken(store, ''), null);
  } finally { rmSync(dir, { recursive:true, force:true }); }
});

test('a revoked token no longer authenticates', () => {
  const { dir, store } = tmpStore();
  try {
    const minted = mintScimToken(store, { sponsorActorId:'owner-1', name:'okta' });
    revokeScimToken(store, { actorId:'owner-1', tokenId:minted.tokenId });
    assert.equal(authenticateScimToken(store, minted.token), null);
  } finally { rmSync(dir, { recursive:true, force:true }); }
});

test('an expired token no longer authenticates', () => {
  const { dir, store } = tmpStore();
  try {
    const minted = mintScimToken(store, { sponsorActorId:'owner-1', name:'okta', ttlDays:-1 });
    assert.equal(authenticateScimToken(store, minted.token), null);
  } finally { rmSync(dir, { recursive:true, force:true }); }
});

test('only the sponsor may revoke their token', () => {
  const { dir, store } = tmpStore();
  try {
    const minted = mintScimToken(store, { sponsorActorId:'owner-1', name:'okta' });
    assert.throws(
      () => revokeScimToken(store, { actorId:'owner-2', tokenId:minted.tokenId }),
      (error) => error instanceof ScimError && error.kind === 'FORBIDDEN',
    );
    // still valid: the forbidden attempt did not revoke it
    assert.notEqual(authenticateScimToken(store, minted.token), null);
  } finally { rmSync(dir, { recursive:true, force:true }); }
});

test('revoking an unknown token id is refused, named', () => {
  const { dir, store } = tmpStore();
  try {
    assert.throws(
      () => revokeScimToken(store, { actorId:'owner-1', tokenId:'no-such-id' }),
      (error) => error instanceof ScimError && error.kind === 'NOT_FOUND',
    );
  } finally { rmSync(dir, { recursive:true, force:true }); }
});

test('listScimTokens never exposes the token digest, only metadata, scoped to the sponsor', () => {
  const { dir, store } = tmpStore();
  try {
    mintScimToken(store, { sponsorActorId:'owner-1', name:'okta' });
    mintScimToken(store, { sponsorActorId:'owner-2', name:'azure-ad' });
    const listed = listScimTokens(store, { sponsorActorId:'owner-1' });
    assert.equal(listed.length, 1);
    assert.equal(listed[0].name, 'okta');
    assert.ok(!('tokenDigest' in listed[0]));
  } finally { rmSync(dir, { recursive:true, force:true }); }
});

test('toScimUser maps a publicAccount shape to a SCIM User resource', () => {
  const account = { id:'u1', username:'jdoe', displayName:'Jane Doe', status:'active', createdAt:'2026-01-01T00:00:00Z' };
  const resource = toScimUser(account, 'https://noesar.example');
  assert.equal(resource.userName, 'jdoe');
  assert.equal(resource.active, true);
  assert.equal(resource.meta.location, 'https://noesar.example/scim/v2/Users/u1');
});

test('toScimUser: a disabled account maps to active:false', () => {
  const account = { id:'u2', username:'disabled-user', displayName:'X', status:'disabled', createdAt:'2026-01-01T00:00:00Z' };
  assert.equal(toScimUser(account, 'https://noesar.example').active, false);
});

test('scimListResponse paginates and reports totalResults independent of the page', () => {
  const accounts = Array.from({ length:5 }, (_, i) => ({ id:`u${i}`, username:`u${i}`, displayName:`U${i}`, status:'active', createdAt:'2026-01-01T00:00:00Z' }));
  const page = scimListResponse(accounts, { startIndex:2, count:2 }, 'https://noesar.example');
  assert.equal(page.totalResults, 5);
  assert.equal(page.itemsPerPage, 2);
  assert.deepEqual(page.Resources.map((r) => r.userName), ['u1', 'u2']);
});

test('scimServiceProviderConfig declares patch supported, bulk/filter not', () => {
  const config = scimServiceProviderConfig('https://noesar.example');
  assert.equal(config.patch.supported, true);
  assert.equal(config.bulk.supported, false);
  assert.equal(config.filter.supported, false);
});

test('scimError produces the RFC 7644 error shape', () => {
  const error = scimError(404, 'no such user');
  assert.equal(error.status, '404');
  assert.equal(error.detail, 'no such user');
  assert.ok(error.schemas.includes('urn:ietf:params:scim:api:messages:2.0:Error'));
});

test('applyScimPatch: replace active:false is accepted', () => {
  const result = applyScimPatch({ Operations:[{ op:'replace', path:'active', value:false }] });
  assert.deepEqual(result, { active:false });
});

test('applyScimPatch: replace active:true is accepted', () => {
  const result = applyScimPatch({ Operations:[{ op:'replace', path:'active', value:true }] });
  assert.deepEqual(result, { active:true });
});

test('applyScimPatch: an unsupported operation is refused, named, not silently ignored', () => {
  assert.throws(
    () => applyScimPatch({ Operations:[{ op:'replace', path:'displayName', value:'New Name' }] }),
    (error) => error instanceof ScimError && error.kind === 'UNSUPPORTED_OPERATION',
  );
});

test('applyScimPatch: active with a non-boolean value is refused', () => {
  assert.throws(
    () => applyScimPatch({ Operations:[{ op:'replace', path:'active', value:'false' }] }),
    (error) => error instanceof ScimError && error.kind === 'INVALID_PATCH',
  );
});

test('applyScimPatch: an empty or missing Operations array is refused', () => {
  assert.throws(() => applyScimPatch({}), ScimError);
  assert.throws(() => applyScimPatch({ Operations:[] }), ScimError);
});

test('scimStatus declares this step as actually enforced, unlike steps 27-29', () => {
  const status = scimStatus();
  assert.equal(status.enforced, true);
  assert.equal(status.rustTwin, false);
  assert.match(status.saml, /NOT BUILT/);
});
