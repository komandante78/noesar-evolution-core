// SPDX-License-Identifier: AGPL-3.0-or-later
//
// P5 — the product speaks the first sentence while the rest of the answer is still being written.
//
// The claim being defended is a LATENCY claim, and a latency claim proved with a stopwatch on one
// machine proves nothing anyone can re-run. So it is proved as an ORDERING claim instead, which
// is the same property and is deterministic: **synthesis of sentence 1 happens before the answer
// has finished streaming**. If that ordering holds, the wait is gone; if it does not, no timing
// number can rescue it.
//
// The second claim is the dangerous one. `D-0373` was two voices talking over each other, and
// speaking in pieces is exactly the change that could bring it back. Three tests exist only for
// that: playback never overlaps, a barge-in mid-answer speaks nothing that was queued behind it,
// and the sentence in flight is dropped in silence rather than finished.
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { VoiceSession, VoiceTurn } from '../../../apps/webui-static/voice-session.js';

function deferred() {
  let resolve; let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

const abortError = () => Object.assign(new Error('aborted'), { name: 'AbortError' });

/**
 * Adapters whose CHAT is driven by the test, token by token.
 *
 * `emit(chunk)` pushes a fragment of the answer; `finish()` ends the stream. Everything the
 * session does in response is recorded in `log`, in order, which is what the assertions read.
 */
function makeStreamingAdapters({ playAutomatically = true } = {}) {
  const log = [];
  const chat = deferred();
  let deliver = null;
  const playGates = [];
  let streamFinished = false;

  const adapters = {
    async listen({ onSpeechEnd } = {}) { onSpeechEnd?.(); return { audio: new Uint8Array([1]), mimeType: 'audio/webm', spoke: true }; },
    async transcribe() { return { text: 'chi sei', heardSomething: true }; },
    async converseStream({ signal, onDelta }) {
      deliver = onDelta;
      signal?.addEventListener('abort', () => chat.reject(abortError()), { once: true });
      return chat.promise;
    },
    async synthesize({ text, signal }) {
      log.push(`synthesize:${text}`);
      if (signal?.aborted) throw abortError();
      return { audio: new Uint8Array([2]), contentType: 'audio/wav', text };
    },
    async play({ audio, contentType, signal, onPlaybackStart }) {
      void audio; void contentType;
      const index = playGates.length;
      log.push(`play:start:${index}`);
      onPlaybackStart?.();
      if (playAutomatically) { log.push(`play:end:${index}`); return; }
      const gate = deferred();
      playGates.push(gate);
      signal?.addEventListener('abort', () => gate.reject(abortError()), { once: true });
      await gate.promise;
      log.push(`play:end:${index}`);
    },
    release() { log.push('release'); },
  };

  return {
    adapters, log,
    emit(chunk) { log.push(`delta:${chunk}`); deliver?.(chunk); },
    finishStream(reply = '') { streamFinished = true; log.push('stream:end'); chat.resolve({ reply }); },
    get streamFinished() { return streamFinished; },
    endPlayback(index = 0) { playGates[index]?.resolve(); },
    get playsInFlight() { return playGates.length; },
  };
}

/** Let queued microtasks run — the session's own awaits, nothing more. */
const settle = async (turns = 12) => { for (let i = 0; i < turns; i += 1) await Promise.resolve(); };

describe('a spoken answer starts before it is finished', () => {
  test('sentence one is synthesised and played while the answer is still streaming', async () => {
    const harness = makeStreamingAdapters();
    const session = new VoiceSession({ adapters: harness.adapters, continuous: false });
    session.start();
    await settle();

    harness.emit('Sono NOESAR EVOLUTION.');
    harness.emit(' Posso');
    await settle();

    // THE assertion of this phase: spoken before the stream ended.
    assert.equal(harness.streamFinished, false);
    assert.ok(harness.log.includes('synthesize:Sono NOESAR EVOLUTION.'),
      `nothing was spoken before the answer finished: ${harness.log.join(' | ')}`);
    assert.ok(harness.log.indexOf('play:start:0') < harness.log.indexOf('stream:end') || !harness.log.includes('stream:end'));

    harness.emit(' aprire la memoria.');
    harness.finishStream('Sono NOESAR EVOLUTION. Posso aprire la memoria.');
    await settle(40);

    const spoken = harness.log.filter((line) => line.startsWith('synthesize:'));
    assert.deepEqual(spoken, ['synthesize:Sono NOESAR EVOLUTION.', 'synthesize:Posso aprire la memoria.']);
  });

  test('playback never overlaps, and the sentences keep their order', async () => {
    const harness = makeStreamingAdapters({ playAutomatically: false });
    const session = new VoiceSession({ adapters: harness.adapters, continuous: false });
    session.start();
    await settle();

    harness.emit('Prima frase. Seconda frase. Terza frase.');
    harness.finishStream('Prima frase. Seconda frase. Terza frase.');
    await settle(30);

    // One playback is open and the other two are waiting behind it — not started.
    assert.equal(harness.playsInFlight, 1, harness.log.join(' | '));
    harness.endPlayback(0);
    await settle(30);
    assert.equal(harness.playsInFlight, 2);
    harness.endPlayback(1);
    await settle(30);
    assert.equal(harness.playsInFlight, 3);
    harness.endPlayback(2);
    await settle(30);

    // Every start is followed by its own end before the next start begins.
    const playback = harness.log.filter((line) => line.startsWith('play:'));
    assert.deepEqual(playback, [
      'play:start:0', 'play:end:0', 'play:start:1', 'play:end:1', 'play:start:2', 'play:end:2',
    ]);
  });

  test('the NEXT sentence is synthesised while the current one is being heard', async () => {
    const harness = makeStreamingAdapters({ playAutomatically: false });
    const session = new VoiceSession({ adapters: harness.adapters, continuous: false });
    session.start();
    await settle();

    harness.emit('Prima frase. Seconda frase. ');
    await settle(30);

    // Playback of #1 is still open, and #2 has already been sent to the speech engine. That
    // overlap is where the remaining wait goes; without it every sentence pays full synthesis.
    assert.equal(harness.playsInFlight, 1);
    // The property is "sentence 2 reached the speech engine before sentence 1 stopped being
    // heard" — NOT "after playback started". The prefetch is issued just before `play()` is
    // awaited, so with an instant double it lands first; asserting the tighter ordering would
    // pin an accident of the double as if it were the requirement (the s330 rule).
    assert.ok(harness.log.includes('synthesize:Seconda frase.'), harness.log.join(' | '));
    assert.ok(!harness.log.includes('play:end:0'), `sentence 1 already finished: ${harness.log.join(' | ')}`);
  });
});

describe('speaking in pieces does not bring back two voices (D-0373)', () => {
  test('a barge-in mid-answer speaks nothing that was queued behind it', async () => {
    const harness = makeStreamingAdapters({ playAutomatically: false });
    const session = new VoiceSession({ adapters: harness.adapters, continuous: false });
    session.start();
    await settle();

    harness.emit('Prima frase. Seconda frase. Terza frase.');
    await settle(30);
    assert.equal(harness.playsInFlight, 1);

    const before = harness.log.filter((line) => line.startsWith('play:start:')).length;
    session.interrupt('barge-in');
    await settle(40);

    const after = harness.log.filter((line) => line.startsWith('play:start:')).length;
    assert.equal(after, before, `a sentence was spoken after the barge-in: ${harness.log.join(' | ')}`);
    // And the turn was torn down rather than left half-speaking.
    assert.notEqual(session.state, VoiceTurn.SPEAKING);
    assert.equal(session.interruptions, 1);
  });

  test('sentences that arrive AFTER the barge-in are never spoken', async () => {
    const harness = makeStreamingAdapters({ playAutomatically: false });
    const session = new VoiceSession({ adapters: harness.adapters, continuous: false });
    session.start();
    await settle();

    harness.emit('Prima frase. ');
    await settle(20);
    session.interrupt('barge-in');
    await settle(20);

    const before = harness.log.length;
    harness.emit('Frase arrivata troppo tardi. ');
    harness.finishStream('tutto');
    await settle(40);

    const spokenAfter = harness.log.slice(before).filter((line) => line.startsWith('synthesize:'));
    assert.deepEqual(spokenAfter, [], `late sentences were spoken: ${harness.log.slice(before).join(' | ')}`);
  });
});

describe('an installation without a streaming chat still speaks', () => {
  test('with no converseStream adapter the whole answer is spoken exactly as before', async () => {
    const log = [];
    const session = new VoiceSession({
      continuous: false,
      adapters: {
        async listen({ onSpeechEnd } = {}) { onSpeechEnd?.(); return { audio: new Uint8Array([1]), mimeType: 'audio/webm', spoke: true }; },
        async transcribe() { return { text: 'ciao', heardSomething: true }; },
        async converse() { log.push('converse'); return { reply: 'Prima frase. Seconda frase.' }; },
        async synthesize({ text }) { log.push(`synthesize:${text}`); return { audio: new Uint8Array([2]), contentType: 'audio/wav' }; },
        async play({ onPlaybackStart }) { onPlaybackStart?.(); log.push('play'); },
        release() {},
      },
    });
    session.start();
    await settle(40);

    // One synthesis, of the whole answer: the degraded path, unchanged and still working.
    assert.deepEqual(log, ['converse', 'synthesize:Prima frase. Seconda frase.', 'play']);
  });

  test('a turn that performs an action and says one line still speaks it', async () => {
    const log = [];
    const session = new VoiceSession({
      continuous: false,
      adapters: {
        async listen({ onSpeechEnd } = {}) { onSpeechEnd?.(); return { audio: new Uint8Array([1]), mimeType: 'audio/webm', spoke: true }; },
        async transcribe() { return { text: 'apri la memoria', heardSomething: true }; },
        // The navigation path: it performs, streams nothing, and returns what it wants said.
        async converseStream() { return { reply: 'Ho aperto la memoria.', reason: 'performed' }; },
        async converse() { return { reply: 'Ho aperto la memoria.', reason: 'performed' }; },
        async synthesize({ text }) { log.push(`synthesize:${text}`); return { audio: new Uint8Array([2]), contentType: 'audio/wav' }; },
        async play({ onPlaybackStart }) { onPlaybackStart?.(); log.push('play'); },
        release() {},
      },
    });
    session.start();
    await settle(40);

    assert.deepEqual(log, ['synthesize:Ho aperto la memoria.', 'play']);
  });
});
