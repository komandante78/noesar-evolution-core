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

/**
 * The two voices this product has, by name. Owner, s336: *«dai un nome alla voce, chiamalo RUNE
 * in maschile e femminile metti ESTRELA»*.
 *
 * # Why the product names its own voices
 *
 * A synthesis model calls its voices whatever its author called them — `am_michael`, `voice_3`,
 * `it-IT-DiegoNeural` — and those names stop existing the moment the operator changes models. An
 * interface that offered them would be offering a choice that quietly evaporates on the next
 * model swap, with everything that referenced it falling back to a default nobody picked. So the
 * product has two names of its OWN, which are stable, and the operator binds each to whatever
 * their model calls the voice they want behind it. It is the only way the promise in
 * `docs/VOICE.md` — any model — survives a feature that lets somebody choose a voice.
 *
 * # What is deliberately absent
 *
 * No default mapping, and no guess at which of a model's voices is masculine. A voice that has
 * not been bound is reported as unbound, and asking for it fails saying so. Falling back to the
 * other one would answer in a woman's voice to somebody who asked for a man's and say nothing
 * about it — the same silent substitution this file already refuses when it will not hand
 * transcription back to the browser.
 */
export const VOICES = Object.freeze({
  RUNE: Object.freeze({ id: 'rune', label: 'Rune', gender: 'masculine', variable: 'NOESAR_VOICE_RUNE' }),
  ESTRELA: Object.freeze({ id: 'estrela', label: 'Estrela', gender: 'feminine', variable: 'NOESAR_VOICE_ESTRELA' }),
});

/** The names in the order they are offered. Frozen so nothing can reorder the interface by
 *  mutating a shared array — the same reason every other registry here is frozen. */
export const VOICE_NAMES = Object.freeze(Object.values(VOICES).map((voice) => voice.id));

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
 * `voice` is the fallback voice: whatever the operator wrote, passed straight through and never
 * validated against a list, because the list belongs to the model they installed.
 *
 * `voices` is the product's own two names bound to that model's. `NOESAR_VOICE_SPEAK_VOICE` still
 * works for an installation that wants one voice and no choosing — it becomes the default when
 * neither name is asked for.
 */
export function voiceRoutingFrom(env = process.env) {
  const bound = {};
  for (const voice of Object.values(VOICES)) {
    bound[voice.id] = trimmed(env[voice.variable]) || null;
  }
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
      voices: Object.freeze(bound),
    }),
  });
}

/**
 * The product's voices, each with whether this installation can actually produce it.
 *
 * Rendered by the interface, so a voice nobody bound appears as a name that is not available yet
 * rather than not appearing at all — an absent option looks like a product that does not have the
 * feature, while an unavailable one looks like a setting somebody has not filled in, and only the
 * second is true.
 */
export function voiceRoster(routing = voiceRoutingFrom()) {
  const bound = routing?.[VoiceJob.SPEAK]?.voices ?? {};
  return Object.values(VOICES).map((voice) => ({
    id: voice.id,
    label: voice.label,
    gender: voice.gender,
    available: Boolean(bound[voice.id]),
    reason: bound[voice.id] ? null : `${voice.label} is not bound to a voice of the speech model — set ${voice.variable}`,
  }));
}

/**
 * Which string to send the synthesis model for a requested voice.
 *
 * Throws rather than substituting. Asking for Rune on an installation where only Estrela is bound
 * has to be an error the person sees: answering in the other voice, silently, is a worse outcome
 * than not answering — they would conclude the choice does nothing.
 */
export function resolveVoice(requested, routing = voiceRoutingFrom()) {
  const configured = routing?.[VoiceJob.SPEAK] ?? {};
  const asked = trimmed(requested).toLowerCase();
  if (!asked) return configured.voice ?? null;
  const known = Object.values(VOICES).find((voice) => voice.id === asked);
  if (!known) {
    // A raw model voice name still works — an installation that never adopted the two names is
    // not broken by their arrival. Only a name that LOOKS like one of ours and is not gets refused.
    return trimmed(requested);
  }
  const bound = configured.voices?.[known.id] ?? null;
  if (!bound) {
    throw new VoiceEngineError(
      'VOICE_NOT_BOUND',
      `${known.label} is not bound to a voice of the speech model on this installation — set ${known.variable}`,
      { status: 409 },
    );
  }
  return bound;
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
  // The product's own two voices and whether each is bound on this installation. Carried in the
  // same snapshot as everything else about voice, so an interface never has to ask twice and
  // cannot show a roster that disagrees with the readiness beside it.
  report.voices = voiceRoster(table);
  return report;
}

function requireFetch(fetchImpl) {
  const impl = fetchImpl ?? (typeof fetch === 'function' ? fetch : null);
  if (typeof impl !== 'function') {
    throw new VoiceEngineError('UNAVAILABLE', 'no way to reach the voice endpoint was supplied', { status: 503 });
  }
  return impl;
}

/* Whisper's OWN thresholds, not invented here. The decoder computes these three numbers for every
 * segment and uses exactly these values to decide a decode has gone wrong; `faster-whisper` even
 * logs `Compression ratio threshold is not met with temperature 0.0 (26.235294 > 2.400000)` and
 * then returns the text anyway, because the API contract is "give the caller what was decoded".
 * Reusing the engine's numbers means this product is not second-guessing the engine — it is
 * refusing to hide a verdict the engine already reached. */
const DEGENERATE_COMPRESSION_RATIO = 2.4;  // above: the text is a repetition loop
const LOW_CONFIDENCE_AVG_LOGPROB = -1.0;   // below: the decoder had no idea
const NO_SPEECH_PROBABILITY = 0.6;         // above: there was nothing being said
// A second, stricter pair, added after the one above proved to have a corner it does not cover.
// Measured 2026-08-25 against this installation: five seconds of pure digital silence came back
// as "Sottotitoli e revisione a cura di QTSS" — the subtitle credit Whisper learned from its
// training data — at compression_ratio 0.83, avg_logprob -0.86, no_speech_prob 0.85. It is not a
// repetition loop, and it is not an unconfident decode, so it walked through BOTH checks above
// and was shown in the voice panel as words the Owner had spoken. The pair below is the corner
// those two numbers sit in: the engine near-certain that nobody spoke, AND a decode that is
// merely adequate rather than confident. Real speech in a noisy room also scores high on
// no_speech — but it decodes CONFIDENTLY (-0.3 or better, which is the `noisy` case the tests
// pin down). That is why this is a pair too, and not a single higher line on no_speech alone.
const NEAR_CERTAIN_SILENCE = 0.8;          // above: the engine is not hedging about it
const MERELY_ADEQUATE_LOGPROB = -0.75;     // below: decoded, but not decoded with confidence

/**
 * Decide what a transcription response actually heard.
 *
 * Exported and pure so it can be tested against recorded engine answers rather than against a
 * live model — the numbers below are the whole of the decision, and a test that cannot vary them
 * would be testing nothing.
 *
 * Measured in s340 (`D-0372`), which is why this exists: twenty seconds of **pure silence** sent
 * to the configured engine came back as `"Felly, mae'n gweithio'n gweithio'n gweithio…"` — Welsh,
 * invented, repeated — with `compression_ratio 7.9` and `no_speech_prob 0.86`. With
 * `response_format: 'json'` the product received only `{text}`: every signal that said "this is
 * not speech" was discarded before it could be read, and the invention was shown to the Owner as
 * if he had said it.
 *
 * Segments are judged one at a time and the bad ones dropped, rather than the whole answer
 * rejected: a real sentence followed by a hallucinated tail is the common shape, and throwing the
 * sentence away with the tail would trade one wrong answer for another.
 */
export function assessTranscription(body) {
  const whole = trimmed(body?.text);
  const segments = Array.isArray(body?.segments) ? body.segments : null;
  // An engine that does not report segments cannot be second-guessed, and pretending otherwise
  // would silently disable this check on such an engine. Take it at its word and say so.
  if (!segments) {
    return { text: whole, heardSomething: whole.length > 0, judged: false, dropped: 0, reason: null };
  }
  const kept = [];
  const reasons = [];
  for (const segment of segments) {
    const text = trimmed(segment?.text);
    if (!text) continue;
    const ratio = Number(segment?.compression_ratio);
    const logprob = Number(segment?.avg_logprob);
    const noSpeech = Number(segment?.no_speech_prob);
    if (Number.isFinite(ratio) && ratio > DEGENERATE_COMPRESSION_RATIO) {
      reasons.push('repetition'); continue;
    }
    // Low confidence AND probably-not-speech together. Either alone is ordinary: a quiet but
    // clear word scores badly on one of them, and rejecting on one signal would throw away real
    // speech — which is a worse failure than showing one bad line, because it is invisible.
    if (Number.isFinite(logprob) && logprob < LOW_CONFIDENCE_AVG_LOGPROB
        && Number.isFinite(noSpeech) && noSpeech > NO_SPEECH_PROBABILITY) {
      reasons.push('no-speech'); continue;
    }
    // The subtitle-credit corner: the engine says almost certainly nothing was said, and the
    // decode backs it up by being unremarkable. Neither number alone would justify dropping.
    if (Number.isFinite(noSpeech) && noSpeech > NEAR_CERTAIN_SILENCE
        && Number.isFinite(logprob) && logprob < MERELY_ADEQUATE_LOGPROB) {
      reasons.push('no-speech'); continue;
    }
    kept.push(text);
  }
  const text = kept.join(' ').replace(/\s+/g, ' ').trim();
  const dropped = reasons.length;
  return {
    text,
    heardSomething: text.length > 0,
    judged: true,
    dropped,
    // Only when everything was thrown away: that is the case a person must be told about, because
    // the microphone worked, the engine answered, and there is still nothing to show.
    reason: text.length === 0 && dropped > 0
      ? (reasons.includes('repetition') ? 'repetition' : 'no-speech')
      : null,
  };
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
  //
  // `verbose_json` and not `json`: the plain form returns `{text}` alone, which throws away the
  // three numbers the decoder computed to judge its own output. `assessTranscription` above needs
  // them, and an engine that does not send them is handled there rather than here.
  form.append('response_format', 'verbose_json');

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
    const assessed = assessTranscription(body);
    // An empty transcript is a RESULT, not a failure: silence, or speech the model could not
    // make out. Reported as itself so the surface can say "I did not catch that" instead of
    // showing an error that suggests the engine is broken. `reason` distinguishes the two ways
    // of hearing nothing, because "you were not speaking" and "the engine looped on noise" send
    // a person to two different places.
    return {
      text: assessed.text,
      heardSomething: assessed.heardSomething,
      reason: assessed.reason,
      model: configured.model ?? null,
    };
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
  // Resolved BEFORE the request, so asking for a voice this installation has not bound fails
  // here — with the name of the variable to set — instead of being answered in the other voice.
  const speaking = resolveVoice(voice, table);

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
        voice: speaking || undefined,
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
      // What was ASKED for, not what was sent to the model: the caller chose "estrela", and
      // telling them back the model's own `af_bella` would leak an implementation detail they
      // did not choose and cannot use.
      voice: trimmed(voice) || configured.voice || null,
      spokenBy: speaking || null,
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
