// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Declared-effect receipts (`effect-receipt.mjs`): the typed verdict, the in-toto/DSSE envelope,
// and a verifier that believes neither a forged signature nor a signed verdict its own evidence
// contradicts.

import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import {
  judge, verdictOf, receiptStatement, signReceipt, verifyReceipt, pae, Verdict, PREDICATE_TYPE, STATEMENT_TYPE,
} from '../src/effect-receipt.mjs';

const ran = (passed = true) => [{ name: 'npm install ./pkg.tgz', passed }];
const declared = ['node_modules/', 'package.json', 'package-lock.json', '~/.npm/'];
const installOnly = { 'node_modules/pkg/index.js': 'CREATED', 'package.json': 'MODIFIED', 'package-lock.json': 'CREATED', '~/.npm/_cacache/x': 'CREATED' };

test('a change that stays inside what it declared is CLEAN', () => {
  assert.equal(judge({ declared, observation: { changed: installOnly, tests: ran() } }).verdict, Verdict.CLEAN);
});

test('a write nobody declared is UNDECLARED_EFFECT, and names the path', () => {
  const { verdict, surprise } = judge({ declared, observation: { changed: { ...installOnly, '~/.ssh/authorized_keys': 'CREATED' }, tests: ran() } });
  assert.equal(verdict, Verdict.UNDECLARED_EFFECT);
  assert.deepEqual(surprise.unexpected, ['~/.ssh/authorized_keys']);
});

test('a declaration is a scope: a prefix ends in "/", anything else is one exact path', () => {
  const { verdict, surprise } = judge({ declared: ['package.json'], observation: { changed: { 'package.json.bak': 'CREATED' }, tests: ran() } });
  assert.equal(verdict, Verdict.UNDECLARED_EFFECT);
  assert.deepEqual(surprise.unexpected, ['package.json.bak']);
});

test('a declared command that failed is DECLARED_FAILED', () => {
  assert.equal(judge({ declared, observation: { changed: installOnly, tests: ran(false) } }).verdict, Verdict.DECLARED_FAILED);
});

test('escaping the scope outranks failing: a change that did both is reported as UNDECLARED_EFFECT', () => {
  const observation = { changed: { '~/.bashrc': 'MODIFIED' }, tests: ran(false) };
  assert.equal(judge({ declared, observation }).verdict, Verdict.UNDECLARED_EFFECT);
});

test('nothing observed is NOT_MEASURED, never CLEAN', () => {
  assert.equal(judge({ declared, observation: null }).verdict, Verdict.NOT_MEASURED);
  assert.equal(judge({ declared, observation: { changed: {}, tests: [] } }).verdict, Verdict.NOT_MEASURED);
  assert.equal(verdictOf(null), Verdict.NOT_MEASURED);
});

test('the DSSE pre-authentication encoding matches the specification\'s own example', () => {
  assert.equal(pae('http://example.com/HelloWorld', Buffer.from('hello world')).toString(),
    'DSSEv1 29 http://example.com/HelloWorld 11 hello world');
});

const statementWith = (changed, passed = true) => receiptStatement({
  command: ['npm', 'install', './pkg.tgz'], declared, observation: { changed, tests: ran(passed) },
  runner: { kind: 'test' }, coverage: ['files'], notMeasured: ['network'], startedAt: 't0', finishedAt: 't1',
});

test('a signed receipt verifies with the public key alone, and carries what was not measured', () => {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const envelope = signReceipt(statementWith(installOnly), privateKey);
  const statement = JSON.parse(Buffer.from(envelope.payload, 'base64').toString());
  assert.equal(statement._type, STATEMENT_TYPE);
  assert.equal(statement.predicateType, PREDICATE_TYPE);
  const result = verifyReceipt(envelope, publicKey);
  assert.equal(result.valid, true, result.reason);
  assert.equal(result.verdict, Verdict.CLEAN);
  assert.deepEqual(result.notMeasured, ['network']);
});

test('a receipt edited after signing is refused', () => {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const envelope = signReceipt(statementWith({ ...installOnly, '~/.ssh/id_ed25519': 'CREATED' }), privateKey);
  const statement = JSON.parse(Buffer.from(envelope.payload, 'base64').toString());
  statement.predicate.verdict = Verdict.CLEAN;
  const forged = { ...envelope, payload: Buffer.from(JSON.stringify(statement)).toString('base64') };
  assert.equal(verifyReceipt(forged, publicKey).valid, false);
});

// The two cases only the SIGNATURE can stop: every other check in `verifyReceipt` passes them.
test('evidence and verdict rewritten together, consistently, are refused by the signature', () => {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const envelope = signReceipt(statementWith({ ...installOnly, '~/.ssh/authorized_keys': 'CREATED' }), privateKey);
  const statement = JSON.parse(Buffer.from(envelope.payload, 'base64').toString());
  delete statement.predicate.observed['~/.ssh/authorized_keys'];
  statement.predicate.surprise.unexpected = [];
  statement.predicate.surprise.clean = true;
  statement.predicate.verdict = Verdict.CLEAN;
  const forged = { ...envelope, payload: Buffer.from(JSON.stringify(statement)).toString('base64') };
  const result = verifyReceipt(forged, publicKey);
  assert.equal(result.valid, false);
  assert.match(result.reason, /signature does not match/);
});

test('a signature made with another key but labelled with the right key id is refused', () => {
  const signer = generateKeyPairSync('ed25519');
  const impostor = generateKeyPairSync('ed25519');
  const genuine = signReceipt(statementWith(installOnly), signer.privateKey);
  const forged = signReceipt(statementWith(installOnly), impostor.privateKey);
  forged.signatures[0].keyid = genuine.signatures[0].keyid;
  const result = verifyReceipt(forged, signer.publicKey);
  assert.equal(result.valid, false);
  assert.match(result.reason, /signature does not match/);
});

test('a receipt signed by another key is refused', () => {
  const signer = generateKeyPairSync('ed25519');
  const someoneElse = generateKeyPairSync('ed25519');
  const result = verifyReceipt(signReceipt(statementWith(installOnly), signer.privateKey), someoneElse.publicKey);
  assert.equal(result.valid, false);
  assert.match(result.reason, /no signature by this key/);
});

test('a SIGNED verdict that its own evidence contradicts is refused: the signer is not believed either', () => {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const statement = statementWith({ ...installOnly, '~/.ssh/authorized_keys': 'CREATED' });
  statement.predicate.verdict = Verdict.CLEAN; // a dishonest runner, signing correctly
  const result = verifyReceipt(signReceipt(statement, privateKey), publicKey);
  assert.equal(result.valid, false);
  assert.match(result.reason, /does not follow from the evidence, which gives UNDECLARED_EFFECT/);
});
