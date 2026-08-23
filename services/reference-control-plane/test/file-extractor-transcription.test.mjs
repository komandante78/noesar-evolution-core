// SPDX-License-Identifier: AGPL-3.0-or-later
//
// `D-0645`/`D-0649` item 1 — uploaded audio/video no longer dead-ends at
// `transcription_required`: when a transcription endpoint is configured, the extractor calls
// the SAME `voice-engine.mjs` `transcribe()` the live microphone route already uses
// (`server.mjs` `/api/v1/voice/transcribe`), so there is exactly one quality judgment
// (`assessTranscription`'s repetition/no-speech thresholds) for audio in this product, not two.
//
// `ffprobe` is not installed on this host or in CI (measured — `command -v ffprobe` finds
// nothing), so the media branch normally never gets past `extractor_unavailable`. `runImpl` is
// injected here to simulate a successful probe without depending on a package this suite cannot
// assume; `transcribeImpl`/`routingImpl` are injected so this proves the WIRING — endpoint
// configured or not, transcription succeeds/fails/comes back empty — without a real speech
// server. `voice-engine.mjs`'s own contract (`assessTranscription`, the HTTP shape) is proven by
// `voice-engine.test.mjs`; this file does not re-test it.

import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileExtractor } from '../src/ai-workspace/file-extractors.mjs';
import { VoiceEngineError } from '../src/voice-engine.mjs';

const ffprobeOk = { available: true, ok: true, stdout: JSON.stringify({ format: { duration: '3.2' }, streams: [{ codec_type: 'audio' }] }) };
const runStub = () => ffprobeOk;
const configuredRouting = () => ({ transcribe: { endpoint: 'http://voice-hear.local', model: 'whisper' } });
const unconfiguredRouting = () => ({ transcribe: { endpoint: null } });

function withExtractor({ transcribeImpl, routingImpl, runImpl = runStub }, run) {
  const dir = mkdtempSync(join(tmpdir(), 'extractor-transcribe-'));
  return (async () => {
    try {
      const extractor = new FileExtractor({ blobRoot: dir, transcribeImpl, routingImpl, runImpl });
      return await run(extractor);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  })();
}

const uploadVoice = (extractor) => extractor.extract({ name: 'note.wav', mimeType: 'audio/wav', bytesBase64: Buffer.from('RIFF____WAVEfmt ', 'latin1').toString('base64') });

describe('audio/video transcription wiring', () => {
  test('a configured endpoint transcribes the upload — the extraction completes with real text', async () => {
    await withExtractor({
      transcribeImpl: async ({ audio, filename, mimeType, routing }) => {
        assert.ok(audio instanceof Uint8Array && audio.length > 0, 'the extractor bytes were passed through');
        assert.equal(filename, 'note.wav');
        assert.equal(mimeType, 'audio/wav');
        assert.equal(routing.transcribe.endpoint, 'http://voice-hear.local');
        return { text: 'this is what was said', heardSomething: true, reason: null, model: 'whisper' };
      },
      routingImpl: configuredRouting,
    }, async (extractor) => {
      const result = await uploadVoice(extractor);
      assert.equal(result.status, 'complete');
      assert.equal(result.text, 'this is what was said');
      assert.equal(result.extractor, 'ffprobe+voice-engine');
      assert.equal(result.warning, null);
      assert.ok(result.metadata.media, 'ffprobe metadata is still recorded');
      assert.equal(result.metadata.transcription.model, 'whisper');
    });
  });

  test('no transcription endpoint configured — unchanged from before this phase', async () => {
    await withExtractor({
      transcribeImpl: async () => { throw new Error('must not be called when unconfigured'); },
      routingImpl: unconfiguredRouting,
    }, async (extractor) => {
      const result = await uploadVoice(extractor);
      assert.equal(result.status, 'transcription_required');
      assert.match(result.warning, /Configure a local speech tool/);
      assert.equal(result.text, '');
    });
  });

  test('the transcription model is unreachable — metadata is kept, the upload still succeeds', async () => {
    await withExtractor({
      transcribeImpl: async () => { throw new VoiceEngineError('UNREACHABLE', 'the transcription model could not be reached: connect ECONNREFUSED', { status: 504 }); },
      routingImpl: configuredRouting,
    }, async (extractor) => {
      const result = await uploadVoice(extractor);
      assert.equal(result.status, 'transcription_failed');
      assert.match(result.warning, /Transcription failed/);
      assert.ok(result.metadata.media, 'the media metadata this step already had is not discarded by a downstream failure');
    });
  });

  test('the model heard nothing worth keeping — reported as an empty result, not an error', async () => {
    await withExtractor({
      transcribeImpl: async () => ({ text: '', heardSomething: false, reason: 'no-speech', model: 'whisper' }),
      routingImpl: configuredRouting,
    }, async (extractor) => {
      const result = await uploadVoice(extractor);
      assert.equal(result.status, 'transcription_empty');
      assert.equal(result.text, '');
      assert.match(result.warning, /No speech was detected/);
    });
  });

  test('a non-VoiceEngineError from transcribeImpl is not swallowed', async () => {
    await withExtractor({
      transcribeImpl: async () => { throw new Error('programmer error, not a voice-engine outcome'); },
      routingImpl: configuredRouting,
    }, async (extractor) => {
      await assert.rejects(() => uploadVoice(extractor), /programmer error/);
    });
  });
});
