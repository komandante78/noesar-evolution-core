// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The conformance suite — what any implementation of this contract must do.
//
// This is the part of the package that is worth more than the code. The code is one
// implementation; this is the **specification made executable**, so a second implementation — in
// another language, in another product, behind another transport — can be held to the same
// guarantees rather than to a prose description of them.
//
// # How it is written, and why
//
// **It imports no test runner.** `runConformance()` returns a plain result object, so it can be
// driven by `node:test`, by a consumer's own harness, or by a script that prints a table. A
// conformance suite that only runs under one runner is a conformance suite for one project.
//
// **It injects everything.** No network, no filesystem, no container, no clock. Every case
// builds its own stub `fetch`, its own sink, its own key pair and its own registry. That is what
// makes it runnable on any host — which is the point of a portability guarantee nobody can
// verify on their own machine being no guarantee at all.
//
// **Every case asserts a REFUSAL or the exact bytes.** "It downloaded something" is the
// assertion that a broken implementation also passes.

import { createHash, generateKeyPairSync, sign as cryptoSign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Case family → the `SPEC.md` requirement it measures. `D-0532`.
 *
 * This is the traceability spine: the suite may grow cases freely, but never a case that measures
 * nothing stated, and `test/conformance.test.mjs` fails if a requirement in `SPEC.md` has no case
 * or a case names a requirement that does not exist. A specification and a suite that can drift
 * apart are a specification nobody can trust and a suite nobody can read.
 */
export const REQUIREMENTS = Object.freeze({
  surface: 'VA-001',
  origin: 'VA-002',
  artefact: 'VA-003',
  cap: 'VA-004',
  redirect: 'VA-005',
  liveness: 'VA-006',
  control: 'VA-007',
  failure: 'VA-008',
  document: 'VA-009',
  authenticity: 'VA-010',
  refusals: 'VA-011',
});

const VECTORS = JSON.parse(readFileSync(new URL('./vectors.json', import.meta.url), 'utf8'));
export const vectors = VECTORS;
export const vectorsPath = fileURLToPath(new URL('./vectors.json', import.meta.url));

const bytes = (text) => new TextEncoder().encode(text);
const sha256 = (text) => createHash('sha256').update(bytes(text)).digest('hex');

/** A sink that records instead of writing — the contract never requires a disk. */
function recordingSink() {
  const chunks = [];
  return {
    chunks,
    closed: false,
    aborted: null,
    async write(chunk) { chunks.push(Buffer.from(chunk)); },
    async close() { this.closed = true; },
    async abort(reason) { this.aborted = reason ?? 'aborted'; },
    get text() { return Buffer.concat(chunks).toString('utf8'); },
  };
}

const bodyOf = (pieces) => new ReadableStream({
  start(controller) {
    for (const piece of pieces) controller.enqueue(bytes(piece));
    controller.close();
  },
});

const respond = (pieces, { status = 200, headers = {} } = {}) => new Response(bodyOf(pieces), { status, headers });

function fetchStub(responses) {
  const queue = [...responses];
  const calls = [];
  const impl = async (url) => {
    calls.push(String(url));
    const next = queue.shift();
    if (!next) throw new Error(`no stubbed response for ${url}`);
    return typeof next === 'function' ? next(url) : next;
  };
  impl.calls = calls;
  return impl;
}

/**
 * The minimum a publisher registry must expose. A consumer with a real registry passes theirs;
 * this one exists so the suite can run against an implementation that has none of its own.
 */
function registryStub({ publisherId, fingerprint, publicKeyPem, trustLevel = 'community', revoked = false }) {
  return {
    findActiveKey(query) {
      if (revoked) return null;
      if (query?.publisherId !== publisherId) return null;
      if (query?.fingerprint !== fingerprint) return null;
      return { publicKeyPem, trustLevel };
    },
  };
}

/**
 * Run the suite against an implementation.
 *
 * @param {object} implementation  the module's public surface: `fetchArtefact`, `fetchDocument`,
 *                                 `checkSource`, `verifyModelDescriptor`, `signModelDescriptor`,
 *                                 `publicKeyFingerprint`, `REFUSALS`
 * @returns {Promise<{total:number,passed:number,failed:number,results:Array}>}
 */
export async function runConformance(implementation) {
  const results = [];
  const check = (id, condition, detail = '') => {
    // Every case declares which SPEC.md requirement it measures, derived from its own id prefix
    // rather than repeated by hand — a mapping maintained in two places is maintained in one.
    // An unknown prefix is a failure, not a default: a case that measures no stated requirement
    // is a case nobody can act on, and a requirement no case measures is not closed.
    const family = String(id).split(':')[0];
    const requirement = REQUIREMENTS[family] ?? null;
    if (!requirement) {
      results.push({ id, requirement: null, ok: false, detail: `case family "${family}" maps to no requirement in SPEC.md` });
      return;
    }
    results.push({ id, requirement, ok: Boolean(condition), detail: condition ? '' : detail });
  };
  const {
    fetchArtefact, fetchDocument, checkSource,
    verifyModelDescriptor, signModelDescriptor, publicKeyFingerprint, REFUSALS,
  } = implementation ?? {};

  for (const name of ['fetchArtefact', 'fetchDocument', 'checkSource', 'verifyModelDescriptor', 'signModelDescriptor']) {
    check(`surface:${name}`, typeof implementation?.[name] === 'function', `${name} is not a function`);
  }
  if (results.some((entry) => !entry.ok)) {
    return { total: results.length, passed: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length, results };
  }

  // ── 1 · the origin policy, from the declarative vectors ─────────────────────────────────────
  for (const vector of VECTORS.origin) {
    const verdict = checkSource(vector.source);
    check(`origin:${vector.id}`,
      Boolean(verdict.allowed) === vector.allowed && (vector.allowed || verdict.kind === vector.kind),
      `expected ${vector.allowed ? 'allowed' : vector.kind}, got ${verdict.allowed ? 'allowed' : verdict.kind}`);
  }

  // ── 2 · an artefact is trusted only against a digest its publisher declared ──────────────────
  {
    const sink = recordingSink();
    const result = await fetchArtefact({
      source: 'https://p.example/a.bin', expectedSha256: sha256('payload'), maxBytes: 1024,
      fetchImpl: fetchStub([respond(['pay', 'load'])]), sink,
    });
    check('artefact:honest-download-lands-every-byte', result.ok === true && sink.text === 'payload', JSON.stringify(result));
    check('artefact:digest-is-reported', result.digest === sha256('payload'), String(result.digest));
  }
  {
    const sink = recordingSink();
    const result = await fetchArtefact({
      source: 'https://p.example/a.bin', expectedSha256: sha256('payload'), maxBytes: 1024,
      fetchImpl: fetchStub([respond(['tampered'])]), sink,
    });
    check('artefact:mismatch-is-refused', result.ok === false && result.kind === 'DIGEST_MISMATCH', JSON.stringify(result));
    check('artefact:mismatch-reports-both-digests',
      result.digest === sha256('tampered') && result.expected === sha256('payload'), JSON.stringify(result));
  }
  {
    let threw = null;
    try {
      await fetchArtefact({
        source: 'https://p.example/a.bin', expectedSha256: null, maxBytes: 1024,
        fetchImpl: fetchStub([respond(['x'])]), sink: recordingSink(),
      });
    } catch (error) { threw = error; }
    check('artefact:no-declared-digest-cannot-be-attempted', threw !== null, 'a fetch with no expected digest must not be constructible');
  }

  // ── 3 · the ceiling is enforced while streaming, never taken from a header ───────────────────
  {
    const sink = recordingSink();
    const result = await fetchArtefact({
      source: 'https://p.example/a.bin', expectedSha256: sha256('irrelevant'), maxBytes: 4,
      // The header LIES: it declares 2 bytes and sends 9.
      fetchImpl: fetchStub([respond(['aaa', 'bbb', 'ccc'], { headers: { 'content-length': '2' } })]), sink,
    });
    check('cap:enforced-mid-stream-against-a-lying-header',
      result.ok === false && result.kind === 'SIZE_CAP_EXCEEDED', JSON.stringify(result));
    check('cap:sink-is-aborted-not-closed', sink.aborted !== null && sink.closed === false, JSON.stringify({ aborted: sink.aborted, closed: sink.closed }));
  }
  {
    const sink = recordingSink();
    const result = await fetchArtefact({
      source: 'https://p.example/a.bin', expectedSha256: sha256('x'), maxBytes: 4,
      fetchImpl: fetchStub([respond(['aaaaaaaa'], { headers: { 'content-length': '8' } })]), sink,
    });
    check('cap:declared-length-over-cap-refuses-before-a-byte-is-written',
      result.kind === 'SIZE_CAP_EXCEEDED' && sink.chunks.length === 0, JSON.stringify(result));
  }

  // ── 4 · every redirect hop is re-checked against the same policy ────────────────────────────
  {
    const result = await fetchArtefact({
      source: 'https://p.example/a.bin', expectedSha256: sha256('payload'), maxBytes: 1024,
      fetchImpl: fetchStub([
        new Response(null, { status: 302, headers: { location: 'https://cdn.example/a.bin' } }),
        respond(['payload']),
      ]),
      sink: recordingSink(),
    });
    check('redirect:https-to-https-is-followed', result.ok === true && result.source === 'https://cdn.example/a.bin', JSON.stringify(result));
  }
  {
    const result = await fetchArtefact({
      source: 'https://p.example/a.bin', expectedSha256: sha256('payload'), maxBytes: 1024,
      fetchImpl: fetchStub([new Response(null, { status: 302, headers: { location: 'http://cdn.example/a.bin' } })]),
      sink: recordingSink(),
    });
    check('redirect:downgrade-to-plain-http-is-refused', result.kind === 'SCHEME_NOT_ALLOWED', JSON.stringify(result));
  }
  {
    const hop = () => new Response(null, { status: 302, headers: { location: 'https://p.example/a.bin' } });
    const result = await fetchArtefact({
      source: 'https://p.example/a.bin', expectedSha256: sha256('payload'), maxBytes: 1024, maxRedirects: 2,
      fetchImpl: fetchStub([hop, hop, hop, hop]), sink: recordingSink(),
    });
    check('redirect:a-loop-ends-with-a-name-not-a-hang', result.kind === 'REDIRECT_LIMIT', JSON.stringify(result));
  }

  // ── 5 · liveness and control ────────────────────────────────────────────────────────────────
  {
    const silent = new Response(new ReadableStream({ start() {} }), { status: 200 });
    const result = await fetchArtefact({
      source: 'https://p.example/a.bin', expectedSha256: sha256('payload'), maxBytes: 1024,
      stallTimeoutMs: 25, fetchImpl: fetchStub([silent]), sink: recordingSink(),
    });
    check('liveness:a-silent-connection-fails-as-STALLED', result.kind === 'STALLED', JSON.stringify(result));
  }
  {
    const controller = new AbortController();
    const sink = recordingSink();
    const result = await fetchArtefact({
      source: 'https://p.example/a.bin', expectedSha256: sha256('abcdef'), maxBytes: 1024,
      signal: controller.signal, fetchImpl: fetchStub([respond(['abc', 'def'])]), sink,
      onProgress: () => controller.abort(),
    });
    check('control:cancelling-is-CANCELLED-not-an-error', result.kind === 'CANCELLED', JSON.stringify(result));
  }
  {
    const result = await fetchArtefact({
      source: 'https://p.example/a.bin', expectedSha256: sha256('payload'), maxBytes: 1024,
      fetchImpl: async () => { throw new Error('ECONNREFUSED'); }, sink: recordingSink(),
    });
    check('failure:an-unreachable-source-is-a-refusal-not-a-throw', result.kind === 'TRANSPORT_ERROR', JSON.stringify(result));
  }

  // ── 6 · a document takes its integrity from a signature, not from a digest it carries ───────
  {
    const document = { id: 'p/model', publisher: 'p', source: 'https://p.example/a.bin' };
    const payload = JSON.stringify(document);
    const result = await fetchDocument({
      source: 'https://p.example/d.json', fetchImpl: fetchStub([respond([payload])]),
    });
    check('document:is-fetchable-without-a-pre-declared-digest', result.ok === true && result.text === payload, JSON.stringify(result));
  }
  {
    const result = await fetchDocument({
      source: 'https://p.example/d.json', maxBytes: 4, fetchImpl: fetchStub([respond(['aaaaaaaa'])]),
    });
    check('document:is-capped-like-everything-else', result.ok === false && result.kind === 'SIZE_CAP_EXCEEDED', JSON.stringify(result));
  }
  {
    const result = await fetchDocument({ source: 'http://p.example/d.json', fetchImpl: fetchStub([respond(['{}'])]) });
    check('document:obeys-the-same-origin-policy', result.kind === 'SCHEME_NOT_ALLOWED', JSON.stringify(result));
  }

  // ── 7a · authenticity, from FIXED vectors — the half another language can run ────────────────
  //
  // Fixed ed25519 material, public only, so an implementation in Rust or Python is measured
  // against the same bytes rather than against its own key generation agreeing with itself.
  {
    const fixed = VECTORS.authenticity;
    for (const vector of fixed.cases) {
      const registry = registryStub({
        // The INSTALLATION's trust store, never the document's claim about itself. Deriving this
        // from `descriptor.publisher` — which this runner did until the suite caught it — makes
        // the registry recognise every forgery that renames itself, and turns the
        // publisher-reattribution case into a signature failure instead of an untrusted key.
        publisherId: fixed.registeredPublisherId,
        fingerprint: vector.registeredFingerprint ?? fixed.registeredFingerprint,
        publicKeyPem: fixed.publicKeyPem,
        revoked: vector.keyState === 'revoked',
      });
      const verdict = verifyModelDescriptor({ descriptor: vector.descriptor, registry });
      const ok = vector.expect.verified
        ? verdict.verified === true
        : verdict.verified === false && verdict.kind === vector.expect.kind;
      check(`authenticity:vector:${vector.id}`, ok,
        `expected ${vector.expect.verified ? 'verified' : vector.expect.kind}, got ${verdict.verified ? 'verified' : verdict.kind}`);
    }
  }

  // ── 7b · authenticity, the cases data cannot express ────────────────────────────────────────
  {
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
    const fingerprint = publicKeyFingerprint(publicKey);
    const registry = registryStub({ publisherId: 'p', fingerprint, publicKeyPem });
    const document = { id: 'p/model', publisher: 'p', source: 'https://p.example/a.bin', hashes: { sha256: sha256('payload') } };
    const signedDocument = signModelDescriptor(document, privateKeyPem);

    check('authenticity:a-genuine-signature-verifies',
      verifyModelDescriptor({ descriptor: signedDocument, registry }).verified === true, 'a genuine signature must verify');
    check('authenticity:the-signature-is-not-inside-its-own-input',
      !JSON.stringify(signedDocument.signature ?? {}).includes(String(signedDocument.signature?.value ?? '').slice(0, 8) + 'signature'),
      'sanity: the signature object exists');
    for (const [id, altered] of [
      ['source-altered', { ...signedDocument, source: 'https://attacker.example/a.bin' }],
      ['digest-altered', { ...signedDocument, hashes: { sha256: sha256('something else') } }],
      ['id-altered', { ...signedDocument, id: 'p/other' }],
    ]) {
      check(`authenticity:${id}-breaks-the-signature`,
        verifyModelDescriptor({ descriptor: altered, registry }).kind === 'SIGNATURE_INVALID',
        `${id} did not invalidate the signature`);
    }
    check('authenticity:an-unsigned-document-is-refused-as-unsigned',
      verifyModelDescriptor({ descriptor: document, registry }).kind === 'NO_SIGNATURE', 'unsigned must be NO_SIGNATURE');
    check('authenticity:a-key-this-installation-never-registered-is-not-trusted',
      verifyModelDescriptor({ descriptor: signedDocument, registry: registryStub({ publisherId: 'p', fingerprint: 'other', publicKeyPem }) }).kind === 'KEY_NOT_TRUSTED',
      'an unknown fingerprint must be KEY_NOT_TRUSTED');
    check('authenticity:a-revoked-key-stops-verifying-what-it-already-signed',
      verifyModelDescriptor({ descriptor: signedDocument, registry: registryStub({ publisherId: 'p', fingerprint, publicKeyPem, revoked: true }) }).kind === 'KEY_NOT_TRUSTED',
      'revocation must apply retroactively');
    check('authenticity:no-registry-is-refused-never-treated-as-nothing-to-check',
      verifyModelDescriptor({ descriptor: signedDocument, registry: null }).kind === 'NO_REGISTRY', 'a missing registry must refuse');
    check('authenticity:a-document-naming-no-publisher-is-refused',
      verifyModelDescriptor({ descriptor: { ...signedDocument, publisher: undefined }, registry }).kind === 'NO_PUBLISHER',
      'no publisher must be NO_PUBLISHER');

    // A signature made over a DIFFERENT document, pasted onto this one: the classic swap.
    const other = signModelDescriptor({ id: 'p/other', publisher: 'p' }, privateKeyPem);
    check('authenticity:a-signature-lifted-from-another-document-does-not-transfer',
      verifyModelDescriptor({ descriptor: { ...signedDocument, signature: other.signature }, registry }).kind === 'SIGNATURE_INVALID',
      'a transplanted signature must not verify');

    // A signature that is well-formed base64 but simply wrong.
    const forged = { ...signedDocument, signature: { ...signedDocument.signature, value: cryptoSign(null, bytes('nothing to do with it'), privateKey).toString('base64') } };
    check('authenticity:a-well-formed-but-wrong-signature-is-refused',
      verifyModelDescriptor({ descriptor: forged, registry }).kind === 'SIGNATURE_INVALID', 'a wrong signature must be refused');
  }

  // ── 8 · every refusal an implementation can produce must be one a consumer can enumerate ────
  {
    const declared = new Set([...(REFUSALS?.transport ?? []), ...(REFUSALS?.authenticity ?? [])]);
    const produced = results
      .map((entry) => entry.detail)
      .flatMap((detail) => {
        try { return [JSON.parse(detail || '{}').kind].filter(Boolean); } catch { return []; }
      });
    check('refusals:none-produced-outside-the-declared-list',
      produced.every((kind) => declared.has(kind)),
      `undeclared refusals: ${[...new Set(produced.filter((kind) => !declared.has(kind)))].join(', ')}`);
    check('refusals:the-declared-list-is-frozen', Object.isFrozen(REFUSALS?.transport ?? []), 'REFUSALS.transport must be frozen');
  }

  const passed = results.filter((entry) => entry.ok).length;
  return { total: results.length, passed, failed: results.length - passed, results };
}
