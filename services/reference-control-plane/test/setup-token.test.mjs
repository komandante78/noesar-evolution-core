// SPDX-License-Identifier: AGPL-3.0-or-later
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync, chmodSync, utimesSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { resolveSetupToken, fingerprint, DEFAULT_TTL_HOURS } from '../src/setup-token.mjs';
import { freshTempDir } from './support/workspace.mjs';

function tokenPath() { return join(freshTempDir('noesar-setup-'), 'config', 'first-owner-setup.token'); }

test('a token is generated on first run and written to the runtime file', () => {
  const path = tokenPath();
  const result = resolveSetupToken({ env: { NOESAR_SETUP_TOKEN_FILE: path } });
  assert.equal(result.source, 'file');
  assert.equal(result.generated, true);
  assert.ok(result.token.length >= 40, 'the token must carry real entropy');
  assert.equal(readFileSync(path, 'utf8').trim(), result.token);
});

test('the token file is owner-readable only', () => {
  const path = tokenPath();
  resolveSetupToken({ env: { NOESAR_SETUP_TOKEN_FILE: path } });
  assert.equal(statSync(path).mode & 0o777, 0o600);
});

test('a token file that became readable is repaired on the next start', () => {
  const path = tokenPath();
  resolveSetupToken({ env: { NOESAR_SETUP_TOKEN_FILE: path } });
  // writeFileSync does not change the mode of an existing file; chmod does.
  chmodSync(path, 0o644);
  assert.equal(statSync(path).mode & 0o777, 0o644);
  resolveSetupToken({ env: { NOESAR_SETUP_TOKEN_FILE: path } });
  assert.equal(statSync(path).mode & 0o777, 0o600);
});

test('the same token is reused across restarts rather than rotated on every boot', () => {
  const path = tokenPath();
  const first = resolveSetupToken({ env: { NOESAR_SETUP_TOKEN_FILE: path } });
  const second = resolveSetupToken({ env: { NOESAR_SETUP_TOKEN_FILE: path } });
  assert.equal(second.token, first.token);
  assert.equal(second.generated, false);
});

test('two installations never share a token', () => {
  const a = resolveSetupToken({ env: { NOESAR_SETUP_TOKEN_FILE: tokenPath() } });
  const b = resolveSetupToken({ env: { NOESAR_SETUP_TOKEN_FILE: tokenPath() } });
  assert.notEqual(a.token, b.token);
});

test('an expired token is rotated rather than left valid forever', () => {
  const path = tokenPath();
  const first = resolveSetupToken({ env: { NOESAR_SETUP_TOKEN_FILE: path } });
  const old = (Date.now() - (DEFAULT_TTL_HOURS + 1) * 3_600_000) / 1000;
  utimesSync(path, old, old);
  const second = resolveSetupToken({ env: { NOESAR_SETUP_TOKEN_FILE: path } });
  assert.notEqual(second.token, first.token, 'an expired token must not stay usable');
  assert.equal(second.generated, true);
  assert.equal(statSync(path).mode & 0o777, 0o600);
});

test('no token is generated once the installation is initialized', () => {
  const path = tokenPath();
  const result = resolveSetupToken({ env: { NOESAR_SETUP_TOKEN_FILE: path }, alreadyInitialized: true });
  assert.equal(result.token, null);
  assert.equal(result.source, 'not-required');
  assert.equal(existsSync(path), false, 'a configured installation needs no first-run token');
});

test('an explicit environment token still wins, for smoke tooling', () => {
  const path = tokenPath();
  const result = resolveSetupToken({ env: { NOESAR_SETUP_TOKEN: 'explicit-test-value', NOESAR_SETUP_TOKEN_FILE: path } });
  assert.equal(result.token, 'explicit-test-value');
  assert.equal(result.source, 'environment');
  assert.equal(existsSync(path), false);
});

test('with neither source configured, first-run setup is unavailable rather than open', () => {
  const result = resolveSetupToken({ env: {} });
  assert.equal(result.token, null);
  assert.equal(result.source, 'none');
});

test('the fingerprint identifies the token without revealing it', () => {
  const path = tokenPath();
  const result = resolveSetupToken({ env: { NOESAR_SETUP_TOKEN_FILE: path } });
  assert.equal(result.fingerprint.length, 12);
  assert.ok(!result.token.includes(result.fingerprint));
  assert.equal(fingerprint(result.token), result.fingerprint);
  assert.notEqual(fingerprint('other'), result.fingerprint);
});

test('generation is logged by fingerprint and path, never by value', () => {
  const path = tokenPath();
  const records = [];
  const logger = { warn: (event, fields) => records.push({ event, fields }) };
  const result = resolveSetupToken({ env: { NOESAR_SETUP_TOKEN_FILE: path }, logger });
  const generated = records.find((record) => record.event === 'setup-token.generated');
  assert.ok(generated);
  assert.equal(generated.fields.setup_fingerprint, result.fingerprint);
  assert.ok(!JSON.stringify(generated).includes(result.token), 'the token value must never be logged');
});
