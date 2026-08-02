// SPDX-License-Identifier: AGPL-3.0-or-later
//
// D-0292, the registry half — pure state, real AtomicJsonStore and real CredentialVault,
// same `fixture()` idiom as remote-target-registry.test.mjs. The half that talks to Debug
// Evolution is proven separately in api-target-probe.test.mjs.

import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AtomicJsonStore } from '../src/ai-workspace/atomic-store.mjs';
import { CredentialVault } from '../src/ai-workspace/credential-vault.mjs';
import { ApiTargetRegistry } from '../src/api-target-registry.mjs';

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'noesar-api-target-registry-'));
  const statePath = join(dir, 'state.json');
  const store = new AtomicJsonStore(statePath);
  const vault = new CredentialVault({ keyPath: join(dir, 'api-target.key') });
  return { dir, statePath, registry: new ApiTargetRegistry({ store, vault, ledger: null }) };
}

const TARGET = { name: 'billing', baseUrl: 'https://api.example.test/v1', protectedPath: '/account' };
const SECRET = 'sk-live-0123456789abcdef';

describe('D-0292 — ApiTargetRegistry: what a target may be registered as', () => {
  test('a non-absolute or non-HTTP URL is refused before anything is stored', () => {
    const { registry, dir } = fixture();
    for (const baseUrl of ['', 'not a url', '/relative/only', 'ftp://files.example.test/pub', 'file:///etc/passwd']) {
      assert.throws(() => registry.create({ ...TARGET, baseUrl }, 'owner-1'), (error) => error.status === 400, `expected ${baseUrl} to be refused`);
    }
    assert.equal(registry.list().length, 0);
    rmSync(dir, { recursive: true, force: true });
  });

  test('a URL carrying its own credentials is refused — that is the one path around the vault', () => {
    const { registry, dir } = fixture();
    assert.throws(() => registry.create({ ...TARGET, baseUrl: 'https://user:pass@api.example.test/v1' }, 'owner-1'), (error) => error.status === 400);
    rmSync(dir, { recursive: true, force: true });
  });

  test('a protected path that is really a second absolute URL is refused', () => {
    const { registry, dir } = fixture();
    assert.throws(() => registry.create({ ...TARGET, protectedPath: 'https://elsewhere.test/steal' }, 'owner-1'), (error) => error.status === 400);
    rmSync(dir, { recursive: true, force: true });
  });

  test('every toolpack authorization defaults to false when the field is simply absent', () => {
    const { registry, dir } = fixture();
    const target = registry.create({ name: 'plain', baseUrl: 'https://api.example.test/' }, 'owner-1');
    assert.equal(target.allowPrivateTargets, false);
    assert.equal(target.allowMutation, false);
    assert.equal(target.allowIntrusive, false);
    assert.equal(target.allowBillable, false);
    rmSync(dir, { recursive: true, force: true });
  });

  test('a target with no credential is a complete target, not a half-registered one', () => {
    const { registry, dir } = fixture();
    const target = registry.create(TARGET, 'owner-1');
    assert.equal(target.credentialConfigured, false);
    assert.equal('encryptedCredential' in target, false);
    assert.equal(registry.resolveCredentialHeaders(target.id).Authorization, undefined,
      'no credential must mean no headers, not an exception — a passive probe is a legitimate use');
    assert.deepEqual(registry.resolveCredentialHeaders(target.id), {});
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('D-0292 — ApiTargetRegistry: editing in place instead of delete-and-recreate', () => {
  test('a partial patch touches only the keys it carries', () => {
    const { registry, dir } = fixture();
    const created = registry.create({ ...TARGET, allowMutation: true }, 'owner-1');
    const updated = registry.update(created.id, { name: 'billing (prod)' }, 'owner-1');
    assert.equal(updated.name, 'billing (prod)');
    assert.equal(updated.baseUrl, TARGET.baseUrl, 'an absent key must not be reset to its default');
    assert.equal(updated.protectedPath, TARGET.protectedPath);
    assert.equal(updated.allowMutation, true, 'nor may an absent grant be silently switched off');
    rmSync(dir, { recursive: true, force: true });
  });

  test('a grant can be raised and lowered, and the record answers accordingly', () => {
    const { registry, dir } = fixture();
    const created = registry.create(TARGET, 'owner-1');
    assert.equal(created.allowPrivateTargets, false);
    assert.equal(registry.update(created.id, { allowPrivateTargets: true }, 'owner-1').allowPrivateTargets, true);
    assert.equal(registry.update(created.id, { allowPrivateTargets: false }, 'owner-1').allowPrivateTargets, false);
    rmSync(dir, { recursive: true, force: true });
  });

  // The reason editing exists at all: delete-and-recreate left the ledger with two unrelated
  // events, and a grant's history is precisely the part worth keeping.
  test('the ledger entry names each field that moved, with before and after', () => {
    const entries = [];
    const dir = mkdtempSync(join(tmpdir(), 'noesar-api-target-ledger-'));
    const store = new AtomicJsonStore(join(dir, 'state.json'));
    const vault = new CredentialVault({ keyPath: join(dir, 'k.key') });
    const registry = new ApiTargetRegistry({ store, vault, ledger: { append: (e) => entries.push(e) } });
    const created = registry.create(TARGET, 'owner-1');
    registry.update(created.id, { allowMutation: true, name: TARGET.name }, 'owner-1');
    const entry = entries.at(-1);
    assert.equal(entry.action, 'api_target.updated');
    assert.deepEqual(entry.details.changes.allowMutation, { from: false, to: true });
    assert.equal('name' in entry.details.changes, false, 'a field set to the value it already had is not a change');
    rmSync(dir, { recursive: true, force: true });
  });

  test('an update that changes nothing writes no ledger entry at all', () => {
    const entries = [];
    const dir = mkdtempSync(join(tmpdir(), 'noesar-api-target-noop-'));
    const store = new AtomicJsonStore(join(dir, 'state.json'));
    const vault = new CredentialVault({ keyPath: join(dir, 'k.key') });
    const registry = new ApiTargetRegistry({ store, vault, ledger: { append: (e) => entries.push(e) } });
    const created = registry.create(TARGET, 'owner-1');
    const before = entries.length;
    registry.update(created.id, { name: TARGET.name, baseUrl: TARGET.baseUrl }, 'owner-1');
    assert.equal(entries.length, before);
    rmSync(dir, { recursive: true, force: true });
  });

  // A probe result describes the service that answered at the OLD address. Carrying it over
  // would attribute one service's findings to another.
  test('changing the base URL clears the last probe', () => {
    const { registry, dir } = fixture();
    const created = registry.create(TARGET, 'owner-1');
    registry.recordProbe(created.id, { ok: true, projectId: 'p-1', findingCount: 3 }, 'owner-1');
    const updated = registry.update(created.id, { baseUrl: 'https://api.other.test/v2' }, 'owner-1');
    assert.equal(updated.lastProbe, null);
    rmSync(dir, { recursive: true, force: true });
  });

  test('editing never disturbs the credential — that has its own route', () => {
    const { registry, dir } = fixture();
    const created = registry.create(TARGET, 'owner-1');
    registry.setCredential(created.id, { scheme: 'bearer', secret: SECRET }, 'owner-1');
    registry.update(created.id, { baseUrl: 'https://api.other.test/v2', allowIntrusive: true }, 'owner-1');
    assert.deepEqual(registry.resolveCredentialHeaders(created.id), { Authorization: `Bearer ${SECRET}` });
    rmSync(dir, { recursive: true, force: true });
  });

  test('an invalid URL or protected path is refused and leaves the record as it was', () => {
    const { registry, dir } = fixture();
    const created = registry.create(TARGET, 'owner-1');
    assert.throws(() => registry.update(created.id, { baseUrl: 'ftp://nope.test/' }, 'owner-1'), (error) => error.status === 400);
    assert.throws(() => registry.update(created.id, { baseUrl: 'https://u:p@api.test/' }, 'owner-1'), (error) => error.status === 400);
    assert.throws(() => registry.update(created.id, { protectedPath: 'https://elsewhere.test/' }, 'owner-1'), (error) => error.status === 400);
    assert.equal(registry.get(created.id).baseUrl, TARGET.baseUrl);
    rmSync(dir, { recursive: true, force: true });
  });

  test('updating an unknown id refuses 404', () => {
    const { registry, dir } = fixture();
    assert.throws(() => registry.update('nope', { name: 'x' }, 'owner-1'), (error) => error.status === 404);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('D-0292 — ApiTargetRegistry: the credential round-trip', () => {
  test('a bearer credential comes back as a complete Authorization header, byte-identical to what went in', () => {
    const { registry, dir } = fixture();
    const created = registry.create(TARGET, 'owner-1');
    const stored = registry.setCredential(created.id, { scheme: 'bearer', secret: SECRET }, 'owner-1');
    assert.equal(stored.credentialConfigured, true);
    assert.equal('encryptedCredential' in stored, false);
    assert.deepEqual(registry.resolveCredentialHeaders(created.id), { Authorization: `Bearer ${SECRET}` });
    rmSync(dir, { recursive: true, force: true });
  });

  test('a custom-header credential is sent raw under its own name, without a Bearer prefix', () => {
    const { registry, dir } = fixture();
    const created = registry.create(TARGET, 'owner-1');
    registry.setCredential(created.id, { scheme: 'header', headerName: 'X-API-Key', secret: SECRET }, 'owner-1');
    assert.deepEqual(registry.resolveCredentialHeaders(created.id), { 'X-API-Key': SECRET });
    rmSync(dir, { recursive: true, force: true });
  });

  test('a header name that is not an HTTP field name is refused — that is header injection, not a typo', () => {
    const { registry, dir } = fixture();
    const created = registry.create(TARGET, 'owner-1');
    for (const headerName of ['', 'X-Key: injected', 'X-Key\r\nX-Other', 'has space', 'X-Key\nX-Other', '   ']) {
      assert.throws(() => registry.setCredential(created.id, { scheme: 'header', headerName, secret: SECRET }, 'owner-1'),
        (error) => error.status === 400, `expected ${JSON.stringify(headerName)} to be refused`);
    }
    assert.equal(registry.get(created.id).encryptedCredential, null, 'no refused attempt may have stored anything');
    rmSync(dir, { recursive: true, force: true });
  });

  // Surrounding whitespace is a paste artifact, not an attack: it is trimmed and the name
  // accepted. What is refused above is a break BETWEEN characters, which is the only form
  // that could actually inject a second header — the distinction is the point.
  test('a header name pasted with surrounding whitespace is trimmed and accepted', () => {
    const { registry, dir } = fixture();
    const created = registry.create(TARGET, 'owner-1');
    registry.setCredential(created.id, { scheme: 'header', headerName: '  X-API-Key\n', secret: SECRET }, 'owner-1');
    assert.deepEqual(registry.resolveCredentialHeaders(created.id), { 'X-API-Key': SECRET });
    rmSync(dir, { recursive: true, force: true });
  });

  test('a secret containing a line break or a null byte is refused, exactly as the toolpack itself would', () => {
    const { registry, dir } = fixture();
    const created = registry.create(TARGET, 'owner-1');
    for (const secret of ['tok\nen', 'tok\ren', 'tok\0en', '   ']) {
      assert.throws(() => registry.setCredential(created.id, { scheme: 'bearer', secret }, 'owner-1'), (error) => error.status === 400);
    }
    rmSync(dir, { recursive: true, force: true });
  });

  test('setCredential replaces an existing credential rather than refusing — there is no separate rotate call and none is needed', () => {
    const { registry, dir } = fixture();
    const created = registry.create(TARGET, 'owner-1');
    registry.setCredential(created.id, { scheme: 'bearer', secret: 'first' }, 'owner-1');
    registry.setCredential(created.id, { scheme: 'bearer', secret: 'second' }, 'owner-1');
    assert.deepEqual(registry.resolveCredentialHeaders(created.id), { Authorization: 'Bearer second' });
    rmSync(dir, { recursive: true, force: true });
  });

  test('clearCredential leaves a usable, credential-less target behind', () => {
    const { registry, dir } = fixture();
    const created = registry.create(TARGET, 'owner-1');
    registry.setCredential(created.id, { scheme: 'bearer', secret: SECRET }, 'owner-1');
    const cleared = registry.clearCredential(created.id, 'owner-1');
    assert.equal(cleared.credentialConfigured, false);
    assert.deepEqual(registry.resolveCredentialHeaders(created.id), {});
    rmSync(dir, { recursive: true, force: true });
  });

  // The assertion this whole file exists for: not "the API does not return it" but "the
  // bytes are not there". Searching the state file for the secret catches a leak through
  // any field, including one added later by someone who did not read publicTarget().
  test('the secret never appears in plaintext anywhere in the state file on disk', () => {
    const { registry, dir, statePath } = fixture();
    const created = registry.create(TARGET, 'owner-1');
    registry.setCredential(created.id, { scheme: 'bearer', secret: SECRET }, 'owner-1');
    registry.recordProbe(created.id, { ok: true, projectId: 'p-1', findingCount: 3 }, 'owner-1');
    const onDisk = readFileSync(statePath, 'utf8');
    assert.equal(onDisk.includes(SECRET), false, 'the raw secret must never reach the state file');
    assert.equal(JSON.stringify(registry.list()).includes(SECRET), false, 'nor any response body built from it');
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('D-0292 — ApiTargetRegistry: probe history and removal', () => {
  test('recordProbe stores success with its finding count and failure with its reason', () => {
    const { registry, dir } = fixture();
    const created = registry.create(TARGET, 'owner-1');
    registry.recordProbe(created.id, { ok: true, projectId: 'p-1', findingCount: 4 }, 'owner-1');
    assert.equal(registry.get(created.id).lastProbe.findingCount, 4);
    registry.recordProbe(created.id, { ok: false, error: 'target host is not allowlisted' }, 'owner-1');
    assert.equal(registry.get(created.id).lastProbe.ok, false);
    assert.equal(registry.get(created.id).lastProbe.error, 'target host is not allowlisted');
    rmSync(dir, { recursive: true, force: true });
  });

  test('unknown ids refuse 404 on every operation rather than failing on something unrelated', () => {
    const { registry, dir } = fixture();
    assert.throws(() => registry.get('nope'), (error) => error.status === 404);
    assert.throws(() => registry.setCredential('nope', { scheme: 'bearer', secret: SECRET }, 'owner-1'), (error) => error.status === 404);
    assert.throws(() => registry.resolveCredentialHeaders('nope'), (error) => error.status === 404);
    assert.throws(() => registry.recordProbe('nope', { ok: true }, 'owner-1'), (error) => error.status === 404);
    assert.throws(() => registry.remove('nope', 'owner-1'), (error) => error.status === 404);
    rmSync(dir, { recursive: true, force: true });
  });

  test('remove() takes the encrypted credential with the record', () => {
    const { registry, dir } = fixture();
    const created = registry.create(TARGET, 'owner-1');
    registry.setCredential(created.id, { scheme: 'bearer', secret: SECRET }, 'owner-1');
    registry.remove(created.id, 'owner-1');
    assert.equal(registry.list().length, 0);
    assert.throws(() => registry.resolveCredentialHeaders(created.id), (error) => error.status === 404);
    rmSync(dir, { recursive: true, force: true });
  });
});
