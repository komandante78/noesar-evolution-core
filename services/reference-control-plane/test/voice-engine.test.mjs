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
  VoiceJob, VoiceState, VoiceEngineError, VOICES, VOICE_NAMES,
  voiceRoutingFrom, voiceReadiness, voiceRoster, resolveVoice, transcribe, speak,
  assessTranscription,
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

// ——— RUNE and ESTRELA, s336 ————————————————————————————————————————————————————————————
//
// Owner: «dai un nome alla voce, chiamalo RUNE in maschile e femminile metti ESTRELA».
//
// The product owns the two names; the operator binds each to whatever their synthesis model
// calls the voice they want behind it. What is defended here is the REFUSAL — a voice that has
// not been bound must fail loudly, naming the variable to set. Answering in the other voice
// would be a substitution nobody asked for and nobody would be told about, and the person would
// conclude the choice does nothing rather than that a setting is missing.

const withVoices = (base) => voiceRoutingFrom({
  NOESAR_VOICE_SPEAK_ENDPOINT: base,
  NOESAR_VOICE_SPEAK_MODEL: 'natural-voice',
  NOESAR_VOICE_RUNE: 'am_michael',
  NOESAR_VOICE_ESTRELA: 'af_bella',
});

test('the product has exactly two named voices, and they are Rune and Estrela', () => {
  assert.deepEqual(VOICE_NAMES, ['rune', 'estrela']);
  assert.equal(VOICES.RUNE.gender, 'masculine');
  assert.equal(VOICES.ESTRELA.gender, 'feminine');
});

test('the roster says which voices this installation can produce, and names what is missing', () => {
  const halfBound = voiceRoster(voiceRoutingFrom({ NOESAR_VOICE_ESTRELA: 'af_bella' }));
  const rune = halfBound.find((voice) => voice.id === 'rune');
  const estrela = halfBound.find((voice) => voice.id === 'estrela');
  assert.equal(estrela.available, true);
  assert.equal(estrela.reason, null);
  assert.equal(rune.available, false);
  // The reason names the VARIABLE. An operator told only "not available" has to go and find it.
  assert.match(rune.reason, /NOESAR_VOICE_RUNE/);
  // And it is still LISTED. An absent option reads as a product that does not have the feature;
  // a listed-but-unavailable one reads as a setting nobody filled in, and only the second is true.
  assert.equal(halfBound.length, 2);
});

test('a name resolves to what the MODEL calls that voice, never to the product name', () => {
  const routing = withVoices('http://voice:9000');
  assert.equal(resolveVoice('rune', routing), 'am_michael');
  assert.equal(resolveVoice('ESTRELA', routing), 'af_bella');
});

test('asking for an unbound voice FAILS — it is never answered in the other one', async () => {
  const onlyEstrela = voiceRoutingFrom({
    NOESAR_VOICE_SPEAK_ENDPOINT: 'http://voice:9000', NOESAR_VOICE_ESTRELA: 'af_bella',
  });
  assert.throws(() => resolveVoice('rune', onlyEstrela), (error) => {
    assert.equal(error.kind, 'VOICE_NOT_BOUND');
    assert.equal(error.status, 409);
    assert.match(error.reason, /Rune/);
    assert.match(error.reason, /NOESAR_VOICE_RUNE/);
    return true;
  });
  // And the refusal reaches `speak` rather than being lost on the way: that is the path which
  // actually runs, and a guard the caller never hits guards nothing.
  await assert.rejects(
    () => speak({ text: 'ciao', voice: 'rune', routing: onlyEstrela, fetchImpl: fetch }),
    (error) => error.kind === 'VOICE_NOT_BOUND',
  );
});

test('an installation that never adopted the names is not broken by their arrival', () => {
  // A raw model voice string still passes through untouched. Only a name that LOOKS like one of
  // ours and is not bound gets refused — two new names must not invalidate the single-voice
  // configuration `docs/VOICE.md` documented before they existed.
  const legacy = voiceRoutingFrom({ NOESAR_VOICE_SPEAK_VOICE: 'it-IT-DiegoNeural' });
  assert.equal(resolveVoice(null, legacy), 'it-IT-DiegoNeural');
  assert.equal(resolveVoice('af_sky', legacy), 'af_sky');
});

test('the model is sent the bound string, and the caller is told the name they asked for', async () => {
  await withServer((req, res) => {
    readBody(req).then(() => {
      res.writeHead(200, { 'content-type': 'audio/wav' });
      res.end(Buffer.from('audio'));
    });
  }, async (base) => {
    const said = await speak({ text: 'ciao', voice: 'estrela', routing: withVoices(base), fetchImpl: fetch });
    // What the model was sent…
    assert.equal(said.spokenBy, 'af_bella');
    // …and what the caller is told back. Returning `af_bella` here would leak an implementation
    // detail the person did not choose and cannot use.
    assert.equal(said.voice, 'estrela');
  });
});

test('readiness carries the roster, so an interface never has to ask twice', async () => {
  const report = await voiceReadiness({ routing: voiceRoutingFrom({ NOESAR_VOICE_RUNE: 'am_michael' }), fetchImpl: fetch });
  assert.equal(report.voices.length, 2);
  assert.equal(report.voices.find((voice) => voice.id === 'rune').available, true);
  assert.equal(report.voices.find((voice) => voice.id === 'estrela').available, false);
});

// ---------------------------------------------------------------------------------------------
// D-0372 — a transcription the engine itself judged degenerate must not be handed on as speech.
//
// The engine answers 200 and gives back what it decoded; deciding whether that is speech is the
// caller's job, and this product was not doing it. The Owner said «rune buongiorno» into a
// microphone that stayed open for 23 seconds and was shown "No, no, no…" a hundred times over.
//
// The bodies below are not invented. They are the SHAPE of what the configured engine really
// returned in s340, including the measured numbers: twenty seconds of pure silence produced
// invented Welsh at compression_ratio 7.9 and no_speech_prob 0.86.
// ---------------------------------------------------------------------------------------------

const GOOD_SEGMENT = {
  id: 0, text: ' Rune, buongiorno.', compression_ratio: 1.05,
  avg_logprob: -0.21, no_speech_prob: 0.02,
};
const LOOPING_SEGMENT = {
  id: 0, text: " Felly, mae'n gweithio'n gweithio'n gweithio'n gweithio'n gweithio",
  compression_ratio: 7.90625, avg_logprob: -0.2875, no_speech_prob: 0.859375,
};
const SILENT_SEGMENT = {
  id: 0, text: ' you', compression_ratio: 0.6, avg_logprob: -1.8, no_speech_prob: 0.94,
};

test('a looping segment is refused however confident the decoder sounds', () => {
  const assessed = assessTranscription({ text: LOOPING_SEGMENT.text, segments: [LOOPING_SEGMENT] });
  assert.equal(assessed.heardSomething, false);
  assert.equal(assessed.text, '');
  assert.equal(assessed.reason, 'repetition');
  // The point of the case: avg_logprob is -0.29, which reads as a CONFIDENT decode. Judging on
  // confidence alone would have let this through, and that is what reached the Owner.
  assert.ok(LOOPING_SEGMENT.avg_logprob > -1.0);
});

test('real speech survives, and is not judged into silence', () => {
  const assessed = assessTranscription({ text: GOOD_SEGMENT.text, segments: [GOOD_SEGMENT] });
  assert.equal(assessed.heardSomething, true);
  assert.equal(assessed.text, 'Rune, buongiorno.');
  assert.equal(assessed.dropped, 0);
  assert.equal(assessed.reason, null);
});

test('a hallucinated tail is dropped and the sentence in front of it is kept', () => {
  const assessed = assessTranscription({
    text: `${GOOD_SEGMENT.text}${LOOPING_SEGMENT.text}`,
    segments: [GOOD_SEGMENT, { ...LOOPING_SEGMENT, id: 1 }],
  });
  // Rejecting the whole answer would trade one wrong result for another: the sentence was real.
  assert.equal(assessed.text, 'Rune, buongiorno.');
  assert.equal(assessed.heardSomething, true);
  assert.equal(assessed.dropped, 1);
  assert.equal(assessed.reason, null);
});

test('low confidence ALONE does not reject, because quiet speech is still speech', () => {
  const quiet = { ...GOOD_SEGMENT, avg_logprob: -1.4, no_speech_prob: 0.05 };
  assert.equal(assessTranscription({ segments: [quiet] }).heardSomething, true);
  const noisy = { ...GOOD_SEGMENT, avg_logprob: -0.3, no_speech_prob: 0.95 };
  assert.equal(assessTranscription({ segments: [noisy] }).heardSomething, true);
  // Only both together mean nobody was speaking.
  assert.equal(assessTranscription({ segments: [SILENT_SEGMENT] }).heardSomething, false);
  assert.equal(assessTranscription({ segments: [SILENT_SEGMENT] }).reason, 'no-speech');
});

// The body below is not invented either. It is the segment THIS installation's engine returned on
// 2026-08-25 for five seconds of pure digital silence, copied verbatim from the response — the
// shape the pair above cannot catch: short, unrepetitive, adequately decoded, and straight out of
// the subtitle files Whisper was trained on. It reached the Owner as a caption in the voice panel
// while the product was speaking, reading "Sottotitoli a cura di Sottotitoli" on screen.
const SUBTITLE_CREDIT_SEGMENT = {
  id: 1, text: ' Sottotitoli e revisione a cura di QTSS',
  compression_ratio: 0.8260869565217391,
  avg_logprob: -0.8593750033113692,
  no_speech_prob: 0.8505859375,
};

test('the subtitle credit Whisper invents over silence is refused', () => {
  const assessed = assessTranscription({
    text: SUBTITLE_CREDIT_SEGMENT.text, segments: [SUBTITLE_CREDIT_SEGMENT],
  });
  assert.equal(assessed.heardSomething, false);
  assert.equal(assessed.text, '');
  assert.equal(assessed.reason, 'no-speech');
  // Kept so the thresholds cannot quietly drift back to letting it through: the reason the first
  // pair missed it is that it looks fine on both of that pair's axes.
  assert.ok(SUBTITLE_CREDIT_SEGMENT.compression_ratio < 2.4);
  assert.ok(SUBTITLE_CREDIT_SEGMENT.avg_logprob > -1.0);
});

test('an engine that reports no segments is taken at its word rather than silently unguarded', () => {
  const assessed = assessTranscription({ text: 'buongiorno' });
  assert.equal(assessed.heardSomething, true);
  assert.equal(assessed.judged, false);
  assert.equal(assessed.text, 'buongiorno');
});

test('transcribe asks for the verbose form, and refuses the loop over a real socket', async () => {
  let requestedFormat = null;
  await withServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks).toString('utf8');
    requestedFormat = /name="response_format"\r?\n\r?\n([a-z_]+)/.exec(body)?.[1] ?? null;
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ text: LOOPING_SEGMENT.text, segments: [LOOPING_SEGMENT] }));
  }, async (endpoint) => {
    const heard = await transcribe({
      audio: new Uint8Array([1, 2, 3]),
      routing: voiceRoutingFrom({ NOESAR_VOICE_TRANSCRIBE_ENDPOINT: endpoint, NOESAR_VOICE_TRANSCRIBE_MODEL: 'whisper' }),
      fetchImpl: fetch,
    });
    // Asking for `json` would make the check above unreachable, so the wire form is asserted
    // here and not only the decision it enables.
    assert.equal(requestedFormat, 'verbose_json');
    assert.equal(heard.heardSomething, false);
    assert.equal(heard.reason, 'repetition');
    assert.equal(heard.text, '');
  });
});
