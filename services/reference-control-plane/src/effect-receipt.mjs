// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Declared-effect receipts: an automated change says what it will touch, runs in a disposable
// copy, and leaves a signed receipt with a TYPED verdict a machine can act on without trusting
// whoever made the change.
//
// Nothing here is new machinery. The copy and the observation are `ShadowWorkspace` and the
// comparison is `compare()` from `shadow.mjs` — the same code, and the same conformance vectors,
// the product already uses to refuse a plan whose effects were not the ones it declared. What
// this module adds is the portable half: a verdict with four values, an in-toto Statement to
// carry it, a DSSE signature over it, and a verifier that needs nothing else from this product.
//
// The verdict never claims more than was looked at. `coverage` names what was observed and
// `notMeasured` names what was not — a receipt that says CLEAN about files is not a statement
// about the network, and says so in the receipt itself rather than in a README nobody reads.
//
// ponytail: a prototype, deliberately. Declarations are path PREFIXES (`node_modules/`, `~/.npm/`)
// and the verdict is about files and declared commands only; network and syscall observation,
// a published predicate specification and verifiers in other languages are the work that
// remains, and they are listed in `notMeasured` rather than implied.
import { createHash, createPublicKey, sign, verify } from 'node:crypto';
import { compare } from './shadow.mjs';

export const PREDICATE_TYPE = 'https://github.com/komandante78/noesar-evolution-core/effect-receipt/v0.1';
export const STATEMENT_TYPE = 'https://in-toto.io/Statement/v1';
export const PAYLOAD_TYPE = 'application/vnd.in-toto+json';

export const Verdict = Object.freeze({
  CLEAN: 'CLEAN',
  UNDECLARED_EFFECT: 'UNDECLARED_EFFECT',
  DECLARED_FAILED: 'DECLARED_FAILED',
  NOT_MEASURED: 'NOT_MEASURED',
});

const inScope = (path, scopes) => scopes.some((scope) => (scope.endsWith('/') ? path.startsWith(scope) : path === scope));

/**
 * The surprise and the verdict, from what was declared and what was observed.
 * `observation` is `ShadowWorkspace.observe()`'s shape, or null when nothing could be observed.
 */
export function judge({ declared, observation }) {
  if (!observation) return { verdict: Verdict.NOT_MEASURED, surprise: null };
  const touched = Object.keys(observation.changed);
  // `compare` asks which paths the diff must touch. For a receipt the declaration is a SCOPE,
  // an upper bound: every touched path inside it is accounted for, and nothing in it is required.
  let surprise;
  try {
    surprise = compare({ pathsTheDiffMustTouch: touched.filter((path) => inScope(path, declared)) }, observation);
  } catch {
    // `compare` refuses an observation of nothing, because it cannot be told from a clean run.
    return { verdict: Verdict.NOT_MEASURED, surprise: null };
  }
  return { verdict: verdictOf(surprise), surprise };
}

/** Undeclared effects outrank a failed command: a change that both failed and escaped its scope escaped it. */
export function verdictOf(surprise) {
  if (!surprise) return Verdict.NOT_MEASURED;
  if (surprise.unexpected.length > 0) return Verdict.UNDECLARED_EFFECT;
  if (surprise.declaredCommandsThatFailed.length > 0 || surprise.testsExpectedToPassThatFailed.length > 0) return Verdict.DECLARED_FAILED;
  return surprise.clean ? Verdict.CLEAN : Verdict.UNDECLARED_EFFECT;
}

/** An in-toto Statement whose subject is the command that was run, by the digest of its argv. */
export function receiptStatement({ command, declared, observation, runner, coverage, notMeasured, startedAt, finishedAt }) {
  const { verdict, surprise } = judge({ declared, observation });
  const argv = JSON.stringify(command);
  return {
    _type: STATEMENT_TYPE,
    subject: [{ name: command.join(' '), digest: { sha256: createHash('sha256').update(argv).digest('hex') } }],
    predicateType: PREDICATE_TYPE,
    predicate: {
      verdict,
      command,
      declared,
      observed: observation?.changed ?? null,
      commands: observation?.tests ?? [],
      surprise,
      coverage,
      notMeasured,
      runner,
      startedAt,
      finishedAt,
    },
  };
}

/** DSSE pre-authentication encoding, exactly as the DSSE v1 protocol defines it. */
export const pae = (type, body) => Buffer.concat([
  Buffer.from(`DSSEv1 ${Buffer.byteLength(type)} ${type} ${body.length} `), body,
]);

// Accepts a public KeyObject, a private one, or PEM: `createPublicKey` refuses a key that is already public.
const asPublic = (key) => (key?.type === 'public' ? key : createPublicKey(key));
const keyIdOf = (key) => createHash('sha256')
  .update(asPublic(key).export({ type: 'spki', format: 'der' })).digest('hex');

/** A DSSE envelope over the statement, signed with an Ed25519 private key (KeyObject or PEM). */
export function signReceipt(statement, privateKey) {
  const body = Buffer.from(JSON.stringify(statement));
  return {
    payloadType: PAYLOAD_TYPE,
    payload: body.toString('base64'),
    signatures: [{ keyid: keyIdOf(privateKey), sig: sign(null, pae(PAYLOAD_TYPE, body), privateKey).toString('base64') }],
  };
}

/**
 * Checks a receipt with nothing but the signer's public key. The verdict is RECOMPUTED from the
 * recorded observation and must equal the one written: a signed receipt whose verdict does not
 * follow from its own evidence is refused, not believed.
 */
export function verifyReceipt(envelope, publicKey) {
  const refuse = (reason) => ({ valid: false, reason, verdict: null });
  if (envelope?.payloadType !== PAYLOAD_TYPE) return refuse('not an in-toto DSSE envelope');
  const body = Buffer.from(String(envelope.payload ?? ''), 'base64');
  const wanted = keyIdOf(publicKey);
  const signature = (envelope.signatures ?? []).find((s) => s.keyid === wanted);
  if (!signature) return refuse('no signature by this key');
  if (!verify(null, pae(PAYLOAD_TYPE, body), publicKey, Buffer.from(signature.sig, 'base64'))) return refuse('signature does not match the payload');
  let statement;
  try { statement = JSON.parse(body.toString('utf8')); } catch { return refuse('payload is not JSON'); }
  if (statement._type !== STATEMENT_TYPE || statement.predicateType !== PREDICATE_TYPE) return refuse('not an effect receipt');
  const p = statement.predicate;
  const observation = p.observed ? { changed: p.observed, tests: p.commands ?? [] } : null;
  const recomputed = judge({ declared: p.declared ?? [], observation }).verdict;
  if (recomputed !== p.verdict) return refuse(`the written verdict ${p.verdict} does not follow from the evidence, which gives ${recomputed}`);
  return { valid: true, reason: null, verdict: p.verdict, notMeasured: p.notMeasured ?? [], statement };
}
