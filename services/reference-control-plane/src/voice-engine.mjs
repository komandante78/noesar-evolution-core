// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The voice engine — the product hears and speaks for itself.
//
// Owner, s336: *«il voice deve fare tutto non deve essere statico … voglio voce reale non
// robotica quindi fai un motore reale interno con voce naturale»*.
//
// # What this replaces
//
// Until now "voice" in this product was `apps/webui-static/voice-control.js`: the browser's
// `SpeechRecognition` matching five fixed words to approve a plan. Two things were wrong with it
// as an answer to the requirement above, and they are different things:
//
//   1. It was STATIC — five words, written by hand, that could not reach anything else the
//      product can do. Fixed in the layer above this one, which resolves what was heard against
//      the product's OWN address book rather than a second list.
//   2. It was NOT THE PRODUCT'S. The browser did the hearing, which means the audio left the
//      installation for whoever built the browser, and an installation's ability to hear
//      depended on which browser was pointed at it. That is what this file fixes.
//
// # Why an OpenAI-shaped audio API and not a bespoke one
//
// `POST /v1/audio/transcriptions` and `POST /v1/audio/speech` are what whisper.cpp's server,
// faster-whisper servers, and the common self-hosted synthesis servers already expose. Speaking
// the shape they already speak is what keeps the Owner's s318 requirement true — the catalogue
// must accept ANY model — without this file carrying a table of vendors. It is the same reason
// `local-model-runtime.mjs` probes `/v1/models`.
//
// # What this file never does
//
// **It never falls back to the browser.** An installation with no transcription model configured
// is reported as exactly that, in a shape the surface above can show. Quietly handing the job
// back to `SpeechRecognition` would send the audio out of the installation to satisfy a request
// the operator made in order to keep it in — a silent reversal of the whole point.
//
// **It never guesses which model can do the job.** The catalogue declares `transcription` and
// `speech` separately (`model-catalog.mjs`); a model that declared neither is not offered.

import { probeModelEndpoint, ActiveModelState } from './active-model.mjs';

/** What the engine can be asked to do. Two directions, never merged. */
export const VoiceJob = Object.freeze({
  /** audio -> text. The microphone. */
  TRANSCRIBE: 'transcribe',
  /** text -> audio. The answer read aloud. */
  SPEAK: 'speak',
});

/**
 * Why a job cannot be served right now. `unconfigured` and `unreachable` are kept apart for the
 * same reason `active-model.mjs` keeps them apart: telling an operator to install something they
 * already installed is worse than saying nothing.
 */
export const VoiceState = Object.freeze({
  READY: 'ready',
  NOT_CONFIGURED: 'not-configured',
  UNREACHABLE: 'unreachable',
});

export class VoiceEngineError extends Error {
  constructor(kind, reason, { status = 400 } = {}) {
    super(reason);
    this.name = 'VoiceEngineError';
    this.kind = kind;
    this.reason = reason;
    this.status = status;
  }
}

const trimmed = (value) => String(value ?? '').trim();
const stripSlash = (value) => trimmed(value).replace(/\/+$/, '');

/**
 * Where each direction is served from, read from the environment ONCE, here.
 *
 * Two endpoints and not one, because hearing and speaking are ordinarily two different servers —
 * and an installation that happens to serve both from one address simply writes the same value
 * twice, which is a fact about that installation rather than something this file should assume.
 *
 * `voice` is the named voice of the synthesis model. It is passed through, never validated
 * against a list: the list of voices belongs to whatever model the operator installed, and a
 * table of voice names here would be out of date the first time they change models.
 */
export function voiceRoutingFrom(env = process.env) {
  return Object.freeze({
    [VoiceJob.TRANSCRIBE]: Object.freeze({
      endpoint: stripSlash(env.NOESAR_VOICE_TRANSCRIBE_ENDPOINT) || null,
      model: trimmed(env.NOESAR_VOICE_TRANSCRIBE_MODEL) || null,
      language: trimmed(env.NOESAR_VOICE_LANGUAGE) || null,
    }),
    [VoiceJob.SPEAK]: Object.freeze({
      endpoint: stripSlash(env.NOESAR_VOICE_SPEAK_ENDPOINT) || null,
      model: trimmed(env.NOESAR_VOICE_SPEAK_MODEL) || null,
      voice: trimmed(env.NOESAR_VOICE_SPEAK_VOICE) || null,
    }),
  });
}

/**
 * What each direction can do right now — the snapshot a surface renders and a module reads.
 *
 * Deliberately shaped like `activeModelReport`: an operator looking at the voice panel and one
 * looking at the models page must not be told two different stories about the same installation.
 */
export async function voiceReadiness({ routing, fetchImpl, timeoutMs = 2000, now } = {}) {
  const table = routing ?? voiceRoutingFrom();
  const report = {};
  for (const job of [VoiceJob.TRANSCRIBE, VoiceJob.SPEAK]) {
    const configured = table[job] ?? {};
    if (!configured.endpoint) {
      report[job] = {
        state: VoiceState.NOT_CONFIGURED,
        endpoint: null,
        model: configured.model ?? null,
        reason: job === VoiceJob.TRANSCRIBE
          ? 'no transcription model is configured, so this installation cannot hear'
          : 'no speech model is configured, so this installation cannot speak',
      };
      continue;
    }
    // Reuse the ONE probe rather than writing a second one. A voice endpoint that answers
    // `/v1/models` is reachable; what it is willing to do with audio is answered by asking it.
    const probed = await probeModelEndpoint(configured.endpoint, { fetchImpl, timeoutMs, now });
    report[job] = {
      state: probed.state === ActiveModelState.UNREACHABLE ? VoiceState.UNREACHABLE : VoiceState.READY,
      endpoint: configured.endpoint,
      // The configured name wins over the served one: an operator who named a model meant it,
      // and a server that serves several would otherwise silently rename their choice.
      model: configured.model ?? probed.id ?? null,
      reason: probed.state === ActiveModelState.UNREACHABLE ? probed.reason : null,
    };
  }
  // One boolean per direction, so a status line does not have to derive it.
  report.canHear = report[VoiceJob.TRANSCRIBE].state === VoiceState.READY;
  report.canSpeak = report[VoiceJob.SPEAK].state === VoiceState.READY;
  return report;
}

function requireFetch(fetchImpl) {
  const impl = fetchImpl ?? (typeof fetch === 'function' ? fetch : null);
  if (typeof impl !== 'function') {
    throw new VoiceEngineError('UNAVAILABLE', 'no way to reach the voice endpoint was supplied', { status: 503 });
  }
  return impl;
}

/**
 * Hear: audio in, text out.
 *
 * `audio` is bytes the caller already holds — this file does not read the filesystem and does not
 * accept a path. A voice engine that could be handed a path is a voice engine that can be asked
 * to read a file the caller was never allowed to read.
 */
export async function transcribe({
  audio,
  filename = 'voice.webm',
  mimeType = 'audio/webm',
  routing,
  fetchImpl,
  timeoutMs = 60_000,
} = {}) {
  const table = routing ?? voiceRoutingFrom();
  const configured = table[VoiceJob.TRANSCRIBE] ?? {};
  if (!configured.endpoint) {
    throw new VoiceEngineError(
      'NOT_CONFIGURED',
      'this installation has no transcription model configured, so it cannot hear',
      { status: 503 },
    );
  }
  if (!(audio instanceof Uint8Array) || audio.byteLength === 0) {
    throw new VoiceEngineError('INVALID_REQUEST', 'audio must be a non-empty byte array');
  }
  const impl = requireFetch(fetchImpl);

  const form = new FormData();
  form.append('file', new Blob([audio], { type: mimeType }), filename);
  if (configured.model) form.append('model', configured.model);
  if (configured.language) form.append('language', configured.language);
  // Asked for explicitly rather than left to the server's default: a server that answers SRT
  // when we expected JSON is a parse failure at the surface, blamed on the microphone.
  form.append('response_format', 'json');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await impl(`${configured.endpoint}/v1/audio/transcriptions`, {
      method: 'POST', body: form, signal: controller.signal,
    });
    if (!response?.ok) {
      throw new VoiceEngineError(
        'UPSTREAM_REFUSED',
        `the transcription model answered ${response?.status ?? 'nothing'}`,
        { status: 502 },
      );
    }
    const body = await response.json();
    const text = trimmed(body?.text);
    // An empty transcript is a RESULT, not a failure: silence, or speech the model could not
    // make out. Reported as itself so the surface can say "I did not catch that" instead of
    // showing an error that suggests the engine is broken.
    return { text, heardSomething: text.length > 0, model: configured.model ?? null };
  } catch (error) {
    if (error instanceof VoiceEngineError) throw error;
    throw new VoiceEngineError(
      'UNREACHABLE',
      error?.name === 'AbortError'
        ? `the transcription model did not answer within ${timeoutMs}ms`
        : `the transcription model could not be reached: ${error?.message ?? 'unknown error'}`,
      { status: 504 },
    );
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Speak: text in, audio out.
 *
 * Returns bytes and the content type they are, never a URL: audio the product generated about a
 * conversation the product holds must not become a second address that outlives the request and
 * can be fetched by whoever guesses it.
 */
export async function speak({
  text,
  voice = null,
  format = 'wav',
  routing,
  fetchImpl,
  timeoutMs = 60_000,
} = {}) {
  const table = routing ?? voiceRoutingFrom();
  const configured = table[VoiceJob.SPEAK] ?? {};
  if (!configured.endpoint) {
    throw new VoiceEngineError(
      'NOT_CONFIGURED',
      'this installation has no speech model configured, so it cannot speak',
      { status: 503 },
    );
  }
  const said = trimmed(text);
  if (!said) throw new VoiceEngineError('INVALID_REQUEST', 'there is nothing to say');
  const impl = requireFetch(fetchImpl);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await impl(`${configured.endpoint}/v1/audio/speech`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: configured.model ?? undefined,
        // The caller's voice wins over the configured default, so one installation can read a
        // notification and a conversation in different voices without being reconfigured.
        voice: trimmed(voice) || configured.voice || undefined,
        input: said,
        response_format: format,
      }),
      signal: controller.signal,
    });
    if (!response?.ok) {
      throw new VoiceEngineError(
        'UPSTREAM_REFUSED',
        `the speech model answered ${response?.status ?? 'nothing'}`,
        { status: 502 },
      );
    }
    const buffer = new Uint8Array(await response.arrayBuffer());
    if (buffer.byteLength === 0) {
      throw new VoiceEngineError('UPSTREAM_REFUSED', 'the speech model returned no audio', { status: 502 });
    }
    return {
      audio: buffer,
      contentType: trimmed(response.headers?.get?.('content-type')) || `audio/${format}`,
      voice: trimmed(voice) || configured.voice || null,
    };
  } catch (error) {
    if (error instanceof VoiceEngineError) throw error;
    throw new VoiceEngineError(
      'UNREACHABLE',
      error?.name === 'AbortError'
        ? `the speech model did not answer within ${timeoutMs}ms`
        : `the speech model could not be reached: ${error?.message ?? 'unknown error'}`,
      { status: 504 },
    );
  } finally {
    clearTimeout(timer);
  }
}
