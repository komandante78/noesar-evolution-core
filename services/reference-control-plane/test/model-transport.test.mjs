// SPDX-License-Identifier: AGPL-3.0-or-later
//
// `D-0517` — the transport's guarantees, as tests.
//
// Each guarantee is asserted through the OUTCOME, not through the code path: a cap that is
// counted but never enforced, or a digest that is computed and then not compared, would pass a
// structural test and fail a person. Nothing here touches a network — `fetchImpl` is injected,
// which is the property that makes these assertions runnable on any host (platform law).

import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { checkSource, fetchArtefact, ModelTransportError, TransportRefusal } from '../src/model-transport.mjs';

const bytes = (text) => new TextEncoder().encode(text);
const sha256 = (text) => createHash('sha256').update(bytes(text)).digest('hex');

/** A sink that records instead of writing, so the transport can be measured without a disk. */
function recordingSink() {
  const chunks = [];
  return {
    chunks, closed: false, aborted: null,
    async write(chunk) { chunks.push(Buffer.from(chunk)); },
    async close() { this.closed = true; },
    async abort(reason) { this.aborted = reason ?? 'aborted'; },
    get text() { return Buffer.concat(chunks).toString('utf8'); },
  };
}

/** A `Response` whose body arrives in the given pieces. */
function bodyOf(pieces) {
  return new ReadableStream({
    start(controller) {
      for (const piece of pieces) controller.enqueue(bytes(piece));
      controller.close();
    },
  });
}

const respond = (pieces, { status = 200, headers = {} } = {}) =>
  new Response(bodyOf(pieces), { status, headers });

/** One-shot fetch stub. Records every URL it was asked for, in order. */
function fetchStub(responses) {
  const calls = [];
  const queue = [...responses];
  const impl = async (url) => {
    calls.push(String(url));
    const next = queue.shift();
    if (!next) throw new Error(`no stubbed response for ${url}`);
    return typeof next === 'function' ? next(url) : next;
  };
  impl.calls = calls;
  return impl;
}

describe('the origin policy', () => {
  test('https is the transport, and a loopback mirror is the one exception', () => {
    assert.equal(checkSource('https://models.example/a.gguf').allowed, true);
    assert.equal(checkSource('http://127.0.0.1:8080/a.gguf').allowed, true);
    assert.equal(checkSource('http://localhost:8080/a.gguf').allowed, true);
    assert.equal(checkSource('http://[::1]:8080/a.gguf').allowed, true);
  });

  test('plain http to anywhere else, and every other scheme, is refused by name', () => {
    for (const source of ['http://models.example/a.gguf', 'http://10.0.0.5/a.gguf']) {
      assert.equal(checkSource(source).kind, TransportRefusal.SCHEME_NOT_ALLOWED, source);
    }
    assert.equal(checkSource('ftp://models.example/a.gguf').kind, TransportRefusal.SCHEME_NOT_ALLOWED);
    assert.equal(checkSource('file:///etc/passwd').kind, TransportRefusal.SCHEME_NOT_ALLOWED);
    assert.equal(checkSource('not a url').kind, TransportRefusal.NO_SOURCE);
    assert.equal(checkSource(null).kind, TransportRefusal.NO_SOURCE);
  });
});

describe('a download that is what the publisher declared', () => {
  test('lands every byte and reports the digest it computed', async () => {
    const sink = recordingSink();
    const result = await fetchArtefact({
      source: 'https://models.example/a.gguf',
      expectedSha256: sha256('weights'),
      maxBytes: 1024,
      fetchImpl: fetchStub([respond(['weig', 'hts'])]),
      sink,
    });
    assert.equal(result.ok, true);
    assert.equal(result.digest, sha256('weights'));
    assert.equal(result.bytes, 7);
    assert.equal(sink.text, 'weights');
    assert.equal(sink.closed, true);
  });

  test('progress is reported as it arrives, not once at the end', async () => {
    const seen = [];
    await fetchArtefact({
      source: 'https://models.example/a.gguf',
      expectedSha256: sha256('abcdef'),
      maxBytes: 1024,
      fetchImpl: fetchStub([respond(['abc', 'def'], { headers: { 'content-length': '6' } })]),
      sink: recordingSink(),
      onProgress: (progress) => seen.push(progress),
    });
    assert.deepEqual(seen.map((entry) => entry.receivedBytes), [3, 6]);
    assert.equal(seen[0].totalBytes, 6);
  });
});

describe('MC-004 — what does not match the declared digest is never made startable', () => {
  test('a mismatch is a refusal carrying BOTH digests, not a warning', async () => {
    const sink = recordingSink();
    const result = await fetchArtefact({
      source: 'https://models.example/a.gguf',
      expectedSha256: sha256('weights'),
      maxBytes: 1024,
      fetchImpl: fetchStub([respond(['tampered'])]),
      sink,
    });
    assert.equal(result.ok, false);
    assert.equal(result.kind, TransportRefusal.DIGEST_MISMATCH);
    assert.equal(result.digest, sha256('tampered'));
    assert.equal(result.expected, sha256('weights'));
    // Closed rather than abandoned: the caller quarantines what arrived.
    assert.equal(sink.closed, true);
  });

  test('a transport with no declared digest cannot be constructed at all', async () => {
    await assert.rejects(
      () => fetchArtefact({
        source: 'https://models.example/a.gguf',
        expectedSha256: null,
        fetchImpl: fetchStub([respond(['x'])]),
        sink: recordingSink(),
      }),
      (error) => error instanceof ModelTransportError && error.kind === 'NO_EXPECTED_DIGEST',
    );
  });
});

describe('the size ceiling is enforced while streaming, never trusted from a header', () => {
  test('a body that exceeds the cap is cut off mid-stream and the sink is aborted', async () => {
    const sink = recordingSink();
    const result = await fetchArtefact({
      source: 'https://models.example/a.gguf',
      expectedSha256: sha256('irrelevant'),
      maxBytes: 4,
      // The header LIES — it declares 2 bytes and sends 9. The cap must still hold.
      fetchImpl: fetchStub([respond(['aaa', 'bbb', 'ccc'], { headers: { 'content-length': '2' } })]),
      sink,
    });
    assert.equal(result.ok, false);
    assert.equal(result.kind, TransportRefusal.SIZE_CAP_EXCEEDED);
    assert.equal(sink.aborted, 'size cap exceeded');
    assert.equal(sink.closed, false);
  });

  test('a declared length over the cap is refused before a byte is written', async () => {
    const sink = recordingSink();
    const result = await fetchArtefact({
      source: 'https://models.example/a.gguf',
      expectedSha256: sha256('x'),
      maxBytes: 4,
      fetchImpl: fetchStub([respond(['aaaaaaaa'], { headers: { 'content-length': '8' } })]),
      sink,
    });
    assert.equal(result.kind, TransportRefusal.SIZE_CAP_EXCEEDED);
    assert.equal(result.totalBytes, 8);
    assert.equal(sink.chunks.length, 0);
  });
});

describe('redirects are followed, and re-checked at every hop', () => {
  test('a redirect to another https origin is followed', async () => {
    const fetchImpl = fetchStub([
      new Response(null, { status: 302, headers: { location: 'https://cdn.example/a.gguf' } }),
      respond(['weights']),
    ]);
    const result = await fetchArtefact({
      source: 'https://models.example/a.gguf',
      expectedSha256: sha256('weights'),
      maxBytes: 1024,
      fetchImpl,
      sink: recordingSink(),
    });
    assert.equal(result.ok, true);
    assert.equal(result.source, 'https://cdn.example/a.gguf');
    assert.equal(fetchImpl.calls.length, 2);
  });

  test('a redirect that downgrades to plain http is refused, not followed', async () => {
    const result = await fetchArtefact({
      source: 'https://models.example/a.gguf',
      expectedSha256: sha256('weights'),
      maxBytes: 1024,
      fetchImpl: fetchStub([new Response(null, { status: 302, headers: { location: 'http://cdn.example/a.gguf' } })]),
      sink: recordingSink(),
    });
    assert.equal(result.kind, TransportRefusal.SCHEME_NOT_ALLOWED);
  });

  test('a redirect loop ends with a name rather than a hang', async () => {
    const hop = () => new Response(null, { status: 302, headers: { location: 'https://models.example/a.gguf' } });
    const result = await fetchArtefact({
      source: 'https://models.example/a.gguf',
      expectedSha256: sha256('weights'),
      maxBytes: 1024,
      maxRedirects: 2,
      fetchImpl: fetchStub([hop, hop, hop, hop]),
      sink: recordingSink(),
    });
    assert.equal(result.kind, TransportRefusal.REDIRECT_LIMIT);
  });

  test('a 3xx with no location is refused rather than retried', async () => {
    const result = await fetchArtefact({
      source: 'https://models.example/a.gguf',
      expectedSha256: sha256('weights'),
      maxBytes: 1024,
      fetchImpl: fetchStub([new Response(null, { status: 303 })]),
      sink: recordingSink(),
    });
    assert.equal(result.kind, TransportRefusal.REDIRECT_WITHOUT_LOCATION);
  });
});

describe('failure has a name in every direction', () => {
  test('an error status is reported with the status', async () => {
    const result = await fetchArtefact({
      source: 'https://models.example/a.gguf',
      expectedSha256: sha256('weights'),
      maxBytes: 1024,
      fetchImpl: fetchStub([new Response('nope', { status: 404 })]),
      sink: recordingSink(),
    });
    assert.equal(result.kind, TransportRefusal.HTTP_STATUS);
    assert.equal(result.status, 404);
  });

  test('an unreachable source is a refusal, not a thrown exception', async () => {
    const result = await fetchArtefact({
      source: 'https://models.example/a.gguf',
      expectedSha256: sha256('weights'),
      maxBytes: 1024,
      fetchImpl: async () => { throw new Error('ECONNREFUSED'); },
      sink: recordingSink(),
    });
    assert.equal(result.kind, TransportRefusal.TRANSPORT_ERROR);
    assert.match(result.reason, /ECONNREFUSED/);
  });

  test('a connection that stops speaking fails as STALLED instead of hanging for ever', async () => {
    // A body that never yields and never closes — the shape of a half-open connection.
    const silent = new Response(new ReadableStream({ start() {} }), { status: 200 });
    const result = await fetchArtefact({
      source: 'https://models.example/a.gguf',
      expectedSha256: sha256('weights'),
      maxBytes: 1024,
      stallTimeoutMs: 25,
      fetchImpl: fetchStub([silent]),
      sink: recordingSink(),
    });
    assert.equal(result.kind, TransportRefusal.STALLED);
  });

  test('cancelling mid-stream stops the download and is not reported as an error', async () => {
    const controller = new AbortController();
    const sink = recordingSink();
    const result = await fetchArtefact({
      source: 'https://models.example/a.gguf',
      expectedSha256: sha256('abcdef'),
      maxBytes: 1024,
      signal: controller.signal,
      fetchImpl: fetchStub([respond(['abc', 'def'])]),
      sink,
      onProgress: () => controller.abort(),
    });
    assert.equal(result.kind, TransportRefusal.CANCELLED);
    assert.equal(sink.aborted, 'cancelled');
  });
});
