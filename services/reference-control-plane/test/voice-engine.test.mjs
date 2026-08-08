// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The voice engine — s336. Owner: «fai un motore reale interno con voce naturale».
//
// These drive a real listener over real sockets rather than a stubbed `fetch`, for the reason
// service-token-http-auth.test.mjs states: the parts that break here are the wire ones —
// multipart assembly, a body that is bytes and not JSON, a server that answers the wrong status.
// A stubbed fetch would agree with whatever this file believes it sends.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import {
  VoiceJob, VoiceState, VoiceEngineError,
  voiceRoutingFrom, voiceReadiness, transcribe, speak,
} from '../src/voice-engine.mjs';

async function withServer(handler, run) {
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try { return await run(base); } finally { await new Promise((resolve) => server.close(resolve)); }
}

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
  });
}

const routingFor = (base, extra = {}) => voiceRoutingFrom({
  NOESAR_VOICE_TRANSCRIBE_ENDPOINT: base,
  NOESAR_VOICE_SPEAK_ENDPOINT: base,
  NOESAR_VOICE_TRANSCRIBE_MODEL: 'whisper-large-v3',
  NOESAR_VOICE_SPEAK_MODEL: 'natural-voice',
  NOESAR_VOICE_SPEAK_VOICE: 'chiara',
  ...extra,
});

test('the two directions are read separately and a trailing slash never doubles', () => {
  const routing = voiceRoutingFrom({
    NOESAR_VOICE_TRANSCRIBE_ENDPOINT: 'http://hears:9000/',
    NOESAR_VOICE_SPEAK_ENDPOINT: 'http://speaks:9001',
  });
  assert.equal(routing[VoiceJob.TRANSCRIBE].endpoint, 'http://hears:9000');
  assert.equal(routing[VoiceJob.SPEAK].endpoint, 'http://speaks:9001');
  // Hearing and speaking are separate installations' choices; configuring one must not imply
  // the other, or an operator who set up dictation would be told the product can talk.
  const onlyHears = voiceRoutingFrom({ NOESAR_VOICE_TRANSCRIBE_ENDPOINT: 'http://hears:9000' });
  assert.equal(onlyHears[VoiceJob.SPEAK].endpoint, null);
});

test('an installation with nothing configured says it cannot hear or speak — and never guesses', async () => {
  const report = await voiceReadiness({ routing: voiceRoutingFrom({}), fetchImpl: fetch });
  assert.equal(report[VoiceJob.TRANSCRIBE].state, VoiceState.NOT_CONFIGURED);
  assert.equal(report[VoiceJob.SPEAK].state, VoiceState.NOT_CONFIGURED);
  assert.equal(report.canHear, false);
  assert.equal(report.canSpeak, false);
  // The reason must name the missing thing. "unavailable" alone sends an operator looking at
  // their microphone permissions for a model they never installed.
  assert.match(report[VoiceJob.TRANSCRIBE].reason, /transcription model/);
  assert.match(report[VoiceJob.SPEAK].reason, /speech model/);
});

test('a configured endpoint that is not answering is UNREACHABLE, which is not the same as absent', async () => {
  // Port 1 on loopback: configured, and certainly refusing.
  const routing = voiceRoutingFrom({
    NOESAR_VOICE_TRANSCRIBE_ENDPOINT: 'http://127.0.0.1:1',
    NOESAR_VOICE_SPEAK_ENDPOINT: 'http://127.0.0.1:1',
  });
  const report = await voiceReadiness({ routing, fetchImpl: fetch, timeoutMs: 1500 });
  assert.equal(report[VoiceJob.TRANSCRIBE].state, VoiceState.UNREACHABLE);
  assert.equal(report.canHear, false);
  // The distinction is the point: reporting this as "not configured" would tell the operator to
  // install a model they already installed.
  assert.notEqual(report[VoiceJob.TRANSCRIBE].state, VoiceState.NOT_CONFIGURED);
  assert.equal(report[VoiceJob.TRANSCRIBE].endpoint, 'http://127.0.0.1:1');
});

test('hearing sends the audio as multipart and returns what was said', async () => {
  let seenPath = null; let seenBody = null; let seenType = null;
  await withServer(async (req, res) => {
    seenPath = req.url; seenType = req.headers['content-type'];
    seenBody = await readBody(req);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ text: '  aggiungi un test alla funzione di somma  ' }));
  }, async (base) => {
    const heard = await transcribe({
      audio: new Uint8Array([1, 2, 3, 4, 5]),
      mimeType: 'audio/webm',
      routing: routingFor(base),
      fetchImpl: fetch,
    });
    assert.equal(heard.text, 'aggiungi un test alla funzione di somma');
    assert.equal(heard.heardSomething, true);
  });
  assert.equal(seenPath, '/v1/audio/transcriptions');
  assert.match(seenType, /^multipart\/form-data/);
  // The model name and the audio really travelled — asserted against the bytes the server
  // received, not against what this test believes the client built.
  assert.ok(seenBody.includes('whisper-large-v3'), 'the configured model must reach the server');
  assert.ok(seenBody.includes('response_format'), 'the response format must be asked for, not defaulted');
});

test('silence is a result, not a failure', async () => {
  await withServer((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ text: '   ' }));
  }, async (base) => {
    const heard = await transcribe({
      audio: new Uint8Array([9]), routing: routingFor(base), fetchImpl: fetch,
    });
    assert.equal(heard.text, '');
    // The surface must be able to say "I did not catch that" rather than show an error that
    // reads as a broken engine.
    assert.equal(heard.heardSomething, false);
  });
});

test('speaking returns AUDIO BYTES and its content type, never a URL', async () => {
  let seenPath = null; let seenBody = null;
  await withServer(async (req, res) => {
    seenPath = req.url;
    seenBody = JSON.parse((await readBody(req)).toString('utf8'));
    res.writeHead(200, { 'content-type': 'audio/wav' });
    res.end(Buffer.from([0x52, 0x49, 0x46, 0x46, 0x00]));
  }, async (base) => {
    const said = await speak({ text: 'Ho finito.', routing: routingFor(base), fetchImpl: fetch });
    assert.ok(said.audio instanceof Uint8Array);
    assert.equal(said.audio.byteLength, 5);
    assert.equal(said.contentType, 'audio/wav');
    // Audio about a conversation this product holds must not become a second fetchable address.
    assert.equal(Object.hasOwn(said, 'url'), false);
  });
  assert.equal(seenPath, '/v1/audio/speech');
  assert.equal(seenBody.input, 'Ho finito.');
  assert.equal(seenBody.voice, 'chiara', 'the configured voice is used when the caller names none');
});

test('the caller’s voice wins over the configured one', async () => {
  let seenBody = null;
  await withServer(async (req, res) => {
    seenBody = JSON.parse((await readBody(req)).toString('utf8'));
    res.writeHead(200, { 'content-type': 'audio/wav' }); res.end(Buffer.from([1]));
  }, async (base) => {
    const said = await speak({ text: 'ciao', voice: 'marco', routing: routingFor(base), fetchImpl: fetch });
    assert.equal(said.voice, 'marco');
  });
  assert.equal(seenBody.voice, 'marco');
});

test('an upstream that refuses is reported as the upstream refusing, with its status', async () => {
  await withServer((req, res) => { res.writeHead(503).end('busy'); }, async (base) => {
    await assert.rejects(
      () => transcribe({ audio: new Uint8Array([1]), routing: routingFor(base), fetchImpl: fetch }),
      (error) => {
        assert.ok(error instanceof VoiceEngineError);
        assert.equal(error.kind, 'UPSTREAM_REFUSED');
        assert.match(error.reason, /503/);
        // 502 and not 503: the failure is a peer's, and a surface that reported OUR status here
        // would tell an operator this product is down when it is answering fine.
        assert.equal(error.status, 502);
        return true;
      },
    );
  });
});

test('nothing is sent when there is nothing to send', async () => {
  const routing = routingFor('http://127.0.0.1:1');
  await assert.rejects(
    () => transcribe({ audio: new Uint8Array([]), routing, fetchImpl: fetch }),
    (error) => { assert.equal(error.kind, 'INVALID_REQUEST'); return true; },
  );
  await assert.rejects(
    () => speak({ text: '   ', routing, fetchImpl: fetch }),
    (error) => { assert.equal(error.kind, 'INVALID_REQUEST'); return true; },
  );
});

test('an unconfigured installation REFUSES rather than falling back to anything', async () => {
  const routing = voiceRoutingFrom({});
  // The reason is asserted, not just the kind. `kind` tells the surface which branch to take;
  // the reason is the sentence a person reads, and it has to name the missing part — otherwise
  // an operator with no transcription model goes looking at microphone permissions. A mutation
  // that emptied this string survived the first version of this test (s336).
  const cases = [
    [() => transcribe({ audio: new Uint8Array([1]), routing, fetchImpl: fetch }), /transcription model/, /cannot hear/],
    [() => speak({ text: 'ciao', routing, fetchImpl: fetch }), /speech model/, /cannot speak/],
  ];
  for (const [call, namesTheModel, namesTheConsequence] of cases) {
    await assert.rejects(call, (error) => {
      assert.equal(error.kind, 'NOT_CONFIGURED');
      // 503 — the installation is missing a part, which is a different thing from the caller
      // having asked wrongly. The surface shows two different messages from these two.
      assert.equal(error.status, 503);
      assert.match(error.reason, namesTheModel);
      assert.match(error.reason, namesTheConsequence);
      return true;
    });
  }
});
