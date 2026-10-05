// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The Session Proof (SESS-001, `session-proof.mjs`) with a real integrity guarantee.
//
// `session-proof.mjs` ends its package with a `digest` and says so honestly: "no cryptographic
// signature yet". That digest is a 64-bit polynomial rolling hash. It is not collision resistant
// — `Aa` and `BB` hash alike, so two different proofs can carry the same digest — and it is not
// signed, so anyone can edit a proof and recompute it. This module is the signature that comment
// asks for, and it is built from parts the repository already has: the in-toto Statement and DSSE
// envelope of `effect-receipt.mjs`, Ed25519, and the same refusal rule — the verifier RECOMPUTES
// the digest of the ten fields from the fields themselves, so a signer cannot sign a digest its
// own content contradicts.
//
// What a valid result means: the ten fields are exactly what the holder of this key signed.
// What it does not mean: that the key belongs to who the reader thinks (compare the fingerprint
// with the one NOESAR shows for this installation), or that anything the model said is true. A
// field the run had no source for is still reported ABSENT inside the proof, never filled.
import { createHash, createPublicKey, verify } from 'node:crypto';
import { pae, signReceipt, STATEMENT_TYPE, PAYLOAD_TYPE } from './effect-receipt.mjs';

export const SESSION_PROOF_PREDICATE_TYPE = 'https://noesar.com/attestation/session-proof/v1';

/** Deterministic JSON: keys sorted at every level, no whitespace. The page in `session-proof-html.mjs` carries the same function. */
export function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  return `{${Object.keys(value).sort().filter((key) => value[key] !== undefined)
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
}

export const sha256Hex = (text) => createHash('sha256').update(text).digest('hex');

/** The in-toto Statement for one Session Proof. Its subject is the SHA-256 of the ten fields. */
export function sessionProofStatement(proof) {
  return {
    _type: STATEMENT_TYPE,
    subject: [{ name: `session-proof:${proof.runId}`, digest: { sha256: sha256Hex(canonicalJson(proof.fields)) } }],
    predicateType: SESSION_PROOF_PREDICATE_TYPE,
    predicate: {
      version: proof.version,
      runId: proof.runId,
      status: proof.status,
      degradation: proof.degradation,
      generatedAtUnix: proof.generatedAtUnix,
      legacyDigest: proof.digest,
      fields: proof.fields,
    },
  };
}

/** A DSSE envelope over the Statement, signed with an Ed25519 private key (KeyObject or PEM). */
export const signSessionProof = (proof, privateKey) => signReceipt(sessionProofStatement(proof), privateKey);

const asPublic = (key) => (key?.type === 'public' ? key : createPublicKey(key));
export const keyIdOf = (key) => sha256Hex(asPublic(key).export({ type: 'spki', format: 'der' }));

/**
 * Checks a signed Session Proof with nothing but the signer's public key. Refuses, with the
 * reason, anything that is not exactly what was signed or whose digest does not follow from
 * its own fields.
 */
export function verifySessionProof(envelope, publicKey) {
  const refuse = (reason) => ({ valid: false, reason });
  if (envelope?.payloadType !== PAYLOAD_TYPE) return refuse('not an in-toto DSSE envelope');
  const body = Buffer.from(String(envelope.payload ?? ''), 'base64');
  const pub = asPublic(publicKey);
  const signature = (envelope.signatures ?? []).find((entry) => entry.keyid === keyIdOf(pub));
  if (!signature) return refuse('no signature by this key');
  if (!verify(null, pae(PAYLOAD_TYPE, body), pub, Buffer.from(String(signature.sig ?? ''), 'base64'))) return refuse('signature does not match the payload');
  let statement;
  try { statement = JSON.parse(body.toString('utf8')); } catch { return refuse('payload is not JSON'); }
  if (statement._type !== STATEMENT_TYPE || statement.predicateType !== SESSION_PROOF_PREDICATE_TYPE) return refuse('not a NOESAR session proof');
  const recomputed = sha256Hex(canonicalJson(statement.predicate?.fields ?? null));
  if (recomputed !== statement.subject?.[0]?.digest?.sha256) return refuse('the digest written in the proof does not match its ten fields');
  return { valid: true, reason: null, keyid: keyIdOf(pub), statement };
}
