// SPDX-License-Identifier: AGPL-3.0-or-later
// The Session Proof, signed: what the 64-bit digest could not promise, and what the page shows.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes, generateKeyPairSync, createHash } from 'node:crypto';
import { WorkspaceActionOrchestrator } from '../src/workspace-actions.mjs';
import { digest } from '../src/session-proof.mjs';
import { TokenMinter } from '../src/capability.mjs';
import { EventLedger } from '../src/events.mjs';
import { derivePrivacy } from '../src/privacy.mjs';
import { signReceipt } from '../src/effect-receipt.mjs';
import {
  canonicalJson, sha256Hex, sessionProofStatement, signSessionProof, verifySessionProof, keyIdOf,
} from '../src/session-proof-signature.mjs';
import { renderSessionProofHtml, VERIFY_JS } from '../src/session-proof-html.mjs';

const NOW = Math.floor(Date.now() / 1000);
const keys = () => generateKeyPairSync('ed25519');

/** A proof from a run that really went through plan() -> measure() -> approve(), as session-proof.test.mjs does. */
async function realProof(request = 'add a greeting file') {
  const ws = mkdtempSync(join(tmpdir(), 'noesar-sps-ws-'));
  writeFileSync(join(ws, '.seed'), 'seed');
  const shadows = mkdtempSync(join(tmpdir(), 'noesar-sps-sh-'));
  try {
    const events = new EventLedger();
    const orch = new WorkspaceActionOrchestrator({
      workspaceRoot: ws, shadowsRoot: shadows, minter: new TokenMinter(randomBytes(32)), events,
      privacyStateFor: () => derivePrivacy({ observed: true, providers: [], tools: [] }),
    });
    const planned = await orch.plan({ request, files: [{ path: 'hello.txt', contents: 'hello\n' }], actor: 'owner-1', nowUnix: NOW });
    orch.measure({ runId: planned.runId, actor: 'owner-1', nowUnix: NOW + 1 });
    orch.approve({ runId: planned.runId, approverId: 'owner-1', nowUnix: NOW + 1 });
    return orch.sessionProof(planned.runId);
  } finally {
    rmSync(ws, { recursive: true, force: true });
    rmSync(shadows, { recursive: true, force: true });
  }
}

test('the legacy digest cannot tell two different proofs apart (the weakness this module exists for)', () => {
  // "Aa" and "BB" have the same polynomial hash, so a 64-bit rolling digest over the text cannot separate them.
  assert.equal(digest({ intento: { value: 'Aa' } }), digest({ intento: { value: 'BB' } }));
  assert.notEqual(sha256Hex(canonicalJson({ intento: { value: 'Aa' } })), sha256Hex(canonicalJson({ intento: { value: 'BB' } })));
});

test('canonicalJson is deterministic whatever the key order, and drops undefined like JSON does', () => {
  assert.equal(canonicalJson({ b: 1, a: [2, { d: 4, c: 3 }], u: undefined }), '{"a":[2,{"c":3,"d":4}],"b":1}');
  assert.equal(canonicalJson({ x: 'è€' }), '{"x":"è€"}');
});

test('a signed proof of a real promoted run verifies, and says whose key signed it', async () => {
  const { privateKey, publicKey } = keys();
  const proof = await realProof();
  const result = verifySessionProof(signSessionProof(proof, privateKey), publicKey);
  assert.equal(result.valid, true, result.reason);
  assert.equal(result.keyid, keyIdOf(publicKey));
  assert.equal(result.statement.predicate.runId, proof.runId);
  assert.equal(result.statement.predicate.legacyDigest, proof.digest, 'the legacy digest travels inside, unchanged');
  assert.equal(Object.keys(result.statement.predicate.fields).length, 10);
});

test('a changed field is refused, whether or not the digest was recomputed to match', async () => {
  const { privateKey, publicKey } = keys();
  const envelope = signSessionProof(await realProof(), privateKey);
  const statement = JSON.parse(Buffer.from(envelope.payload, 'base64').toString());
  // 1. edit a field only
  statement.predicate.fields.intento.value = 'something else entirely';
  const edited = { ...envelope, payload: Buffer.from(JSON.stringify(statement)).toString('base64') };
  assert.equal(verifySessionProof(edited, publicKey).valid, false);
  // 2. edit the field AND recompute the subject digest like an attacker would: the signature still fails
  statement.subject[0].digest.sha256 = sha256Hex(canonicalJson(statement.predicate.fields));
  const forged = { ...envelope, payload: Buffer.from(JSON.stringify(statement)).toString('base64') };
  const refused = verifySessionProof(forged, publicKey);
  assert.equal(refused.valid, false);
  assert.match(refused.reason, /signature does not match/);
});

test('a signer cannot sign a digest its own fields contradict', async () => {
  const { privateKey, publicKey } = keys();
  const statement = sessionProofStatement(await realProof());
  statement.subject[0].digest.sha256 = '0'.repeat(64);
  const refused = verifySessionProof(signReceipt(statement, privateKey), publicKey);
  assert.equal(refused.valid, false);
  assert.match(refused.reason, /does not match its ten fields/);
});

test('another key, a missing signature and a foreign statement are refused', async () => {
  const mine = keys(); const other = keys();
  const envelope = signSessionProof(await realProof(), mine.privateKey);
  assert.match(verifySessionProof(envelope, other.publicKey).reason, /no signature by this key/);
  assert.equal(verifySessionProof({ ...envelope, signatures: [] }, mine.publicKey).valid, false);
  const effectLike = signReceipt({ _type: 'https://in-toto.io/Statement/v1', subject: [], predicateType: 'https://example.com/x', predicate: {} }, mine.privateKey);
  assert.match(verifySessionProof(effectLike, mine.publicKey).reason, /not a NOESAR session proof/);
});

test('the page carries hostile text as text: no run string can become markup or end the data block', async () => {
  const { privateKey, publicKey } = keys();
  const proof = await realProof();
  const hostile = '</script><img src=x onerror=alert(1)><script>alert(2)</script>';
  proof.fields.intento.value = hostile;
  const html = renderSessionProofHtml({ envelope: signSessionProof(proof, privateKey), publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }) });
  assert.equal(html.includes(hostile), false, 'the raw string must not appear anywhere in the page');
  assert.equal(/<img/i.test(html), false);
  assert.equal((html.match(/<script/gi) ?? []).length, 2, 'exactly the data block and the verification code');
  assert.equal((html.match(/<\/script>/gi) ?? []).length, 2, 'no closing tag besides the two real ones');
  const dataBlock = html.slice(html.indexOf('type="application/json">') + 24, html.indexOf('</script>'));
  assert.equal(dataBlock.includes('<'), false, 'the data block holds no "<" at all');
  assert.equal(/https?:\/\//.test(html.replace(/https:\/\/(in-toto\.io|noesar\.com)[^"'\s\\]*/g, '')), false, 'no URL besides the two statement type identifiers');
});

test('the page carries a policy that allows exactly its own script and style, and nothing else', async () => {
  const { privateKey, publicKey } = keys();
  const html = renderSessionProofHtml({ envelope: signSessionProof(await realProof(), privateKey), publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }) });
  const policy = /http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(html)?.[1] ?? '';
  const sha = (text) => `'sha256-${createHash('sha256').update(text).digest('base64')}'`;
  const script = /<script>([\s\S]*?)<\/script>/.exec(html)[1];
  const style = /<style>([\s\S]*?)<\/style>/.exec(html)[1];
  assert.match(policy, /default-src 'none'/);
  assert.ok(policy.includes(`script-src ${sha(script)}`), 'the script is allowed by its hash');
  assert.ok(policy.includes(`style-src ${sha(style)}`), 'the style is allowed by its hash');
  assert.equal(/unsafe-inline|unsafe-eval|connect-src|\*/.test(policy), false);
});

test('the in-page verifier accepts the signed proof and refuses a tampered one (same text as the page runs)', async () => {
  const { privateKey, publicKey } = keys();
  const envelope = signSessionProof(await realProof(), privateKey);
  const spki = publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
  const page = new Function(`${VERIFY_JS}; return { verifyProof, canonicalJson };`)();
  const good = await page.verifyProof(envelope, spki);
  assert.equal(good.valid, true, good.reason);
  assert.equal(good.keyid, keyIdOf(publicKey));
  const statement = JSON.parse(Buffer.from(envelope.payload, 'base64').toString());
  statement.predicate.fields.esito.value = 'tampered';
  const bad = await page.verifyProof({ ...envelope, payload: Buffer.from(JSON.stringify(statement)).toString('base64') }, spki);
  assert.equal(bad.valid, false);
  // the page's canonicalJson must equal the server's on awkward values, or the two would disagree on every digest
  for (const sample of [{ b: [1, 'x'], a: { z: null, y: 'è€ ' }, u: undefined }, [], 'text', 3.5, null, { '': 1 }]) {
    assert.equal(page.canonicalJson(sample), canonicalJson(sample));
  }
});
