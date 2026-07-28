// SPDX-License-Identifier: AGPL-3.0-or-later
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveTls } from '../src/tls.mjs';

const readFileStub = (files) => (path) => {
  if (!(path in files)) throw Object.assign(new Error(`ENOENT: no such file, open '${path}'`), { code: 'ENOENT' });
  return files[path];
};

test('neither variable set: TLS is inactive, nothing is read', () => {
  const result = resolveTls({ env: {}, readFile: () => { throw new Error('must not be called'); } });
  assert.deepEqual(result, { active: false, certFile: null, keyFile: null, cert: null, key: null });
});

test('both variables set to readable PEM files: TLS is active', () => {
  const files = {
    '/cert.pem': '-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----\n',
    '/key.pem': '-----BEGIN PRIVATE KEY-----\nMIIE\n-----END PRIVATE KEY-----\n',
  };
  const result = resolveTls({
    env: { NOESAR_TLS_CERT_FILE: '/cert.pem', NOESAR_TLS_KEY_FILE: '/key.pem' },
    readFile: readFileStub(files),
  });
  assert.equal(result.active, true);
  assert.equal(result.cert, files['/cert.pem']);
  assert.equal(result.key, files['/key.pem']);
  assert.equal(result.certFile, '/cert.pem');
  assert.equal(result.keyFile, '/key.pem');
});

test('only the cert variable set: refused, not silently served over plaintext', () => {
  assert.throws(
    () => resolveTls({ env: { NOESAR_TLS_CERT_FILE: '/cert.pem' }, readFile: () => 'irrelevant' }),
    /NOESAR_TLS_KEY_FILE/,
  );
});

test('only the key variable set: refused, same reason in the other direction', () => {
  assert.throws(
    () => resolveTls({ env: { NOESAR_TLS_KEY_FILE: '/key.pem' }, readFile: () => 'irrelevant' }),
    /NOESAR_TLS_CERT_FILE/,
  );
});

test('cert file missing: fails loudly rather than falling back to plaintext', () => {
  assert.throws(
    () => resolveTls({
      env: { NOESAR_TLS_CERT_FILE: '/missing-cert.pem', NOESAR_TLS_KEY_FILE: '/key.pem' },
      readFile: readFileStub({ '/key.pem': '-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n' }),
    }),
    /NOESAR_TLS_CERT_FILE.*could not be read/,
  );
});

test('key file missing: fails loudly rather than falling back to plaintext', () => {
  assert.throws(
    () => resolveTls({
      env: { NOESAR_TLS_CERT_FILE: '/cert.pem', NOESAR_TLS_KEY_FILE: '/missing-key.pem' },
      readFile: readFileStub({ '/cert.pem': '-----BEGIN CERTIFICATE-----\n...\n-----END CERTIFICATE-----\n' }),
    }),
    /NOESAR_TLS_KEY_FILE.*could not be read/,
  );
});

test('a cert file that is not PEM is rejected rather than handed to the TLS layer', () => {
  assert.throws(
    () => resolveTls({
      env: { NOESAR_TLS_CERT_FILE: '/cert.pem', NOESAR_TLS_KEY_FILE: '/key.pem' },
      readFile: readFileStub({
        '/cert.pem': 'this is not a certificate',
        '/key.pem': '-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n',
      }),
    }),
    /does not look like a PEM certificate/,
  );
});

test('a key file that is not PEM is rejected rather than handed to the TLS layer', () => {
  assert.throws(
    () => resolveTls({
      env: { NOESAR_TLS_CERT_FILE: '/cert.pem', NOESAR_TLS_KEY_FILE: '/key.pem' },
      readFile: readFileStub({
        '/cert.pem': '-----BEGIN CERTIFICATE-----\n...\n-----END CERTIFICATE-----\n',
        '/key.pem': 'this is not a key',
      }),
    }),
    /does not look like a PEM private key/,
  );
});

test('empty-string environment variables are treated as unset, not as empty paths', () => {
  const result = resolveTls({ env: { NOESAR_TLS_CERT_FILE: '', NOESAR_TLS_KEY_FILE: '' }, readFile: () => { throw new Error('must not be called'); } });
  assert.equal(result.active, false);
});
