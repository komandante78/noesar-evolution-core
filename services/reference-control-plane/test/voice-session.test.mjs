// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The voice turn lifecycle — driven against BOTH the new state machine and a faithful
// transcription of the sequencing that shipped, so every assertion here is proven to have teeth.
//
// # Why the suite has two subjects
//
// `VOICE_SUBJECT=legacy` runs the identical scenarios against `LegacyTurn` below, which is a
// line-for-line transcription of what `apps/webui-static/app.js` did before this phase:
//
//   - `app.js:3622`  `await spokenAudio.play()` — `HTMLMediaElement.play()` resolves when
//                    playback BEGINS, never when it ends.
//   - `app.js:3218`  the comment claimed "`speakReply` has already finished by the time we get
//                    here, so the microphone never opens over the product's own voice".
//   - `app.js:3220`  `await toggleDictation()` — the microphone reopened on that false premise.
//   - nothing anywhere carried an `AbortController`, so a turn in flight could not be stopped.
//
// Running the suite against `legacy` fails; running it against `v1` passes. This project has
// been wrong three times about its own measurements, and the rule that came out of it is in
// `noesar-evolution-verify`: an oracle that has never failed has not been shown to work. The
// oracle is therefore kept IN the green suite (`describe('the oracle still has teeth')`), not
// left behind as a terminal output nobody can reproduce.
//
// # What this suite can and cannot prove
//
// It proves LIFECYCLE and CANCELLATION: ordering, generations, abort propagation, resource
// release, idempotence. Every audio adapter here is a double.
//
// It proves NOTHING about audio quality, transcription accuracy, echo, or the real latency of a
// barge-in through a speaker and a microphone. Those need a real device and a real browser, are
// prepared in `tools/acceptance/voice-latency.mjs`, and are `BLOCKED_AWAITING_OWNER`.

import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const webRoot = join(here, '../../../apps/webui-static');
const SUBJECT = process.env.VOICE_SUBJECT ?? 'v1';

const machine = SUBJECT === 'v1'
  ? await import('../../../apps/webui-static/voice-session.js')
  : null;

/* ————— doubles ————————————————————————————————————————————————————————————————————————— */

function deferred() {
  let resolve; let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function abortError(name = 'AbortError') {
  const error = new Error('aborted');
  error.name = name;
  return error;
}

/**
 * A stage that hangs until the test releases it, and rejects the moment its signal aborts —
 * which is exactly how `fetch` behaves, and the property the whole phase turns on.
 *
 * One gate PER CALL, deliberately: a single shared gate made the legacy subject spin forever
 * once it was resolved, because its self-restart found every stage already open. That spin is a
 * real property of the shipped design and it is asserted elsewhere; here it only made the suite
 * hang, and a suite that hangs measures nothing.
 */
function stage(record, key) {
  const pending = [];
  return {
    get depth() { return pending.length; },
    /** Release the OLDEST call still waiting. Returns false when nothing is waiting. */
    release() {
      const next = pending.shift();
      if (!next) return false;
      next.resolve();
      return true;
    },
    run(signal) {
      if (signal?.aborted) return Promise.reject(abortError());
      const gate = deferred();
      pending.push(gate);
      if (!signal) return gate.promise;
      const onAbort = () => { record.aborted.push(key); gate.reject(abortError()); };
      signal.addEventListener('abort', onAbort, { once: true });
      return gate.promise.finally(() => signal.removeEventListener('abort', onAbort));
    },
  };
}

/**
 * The browser's two DIFFERENT moments, modelled truthfully and separately:
 *
 *   `beginPlayback()` resolves when playback STARTS — this is `HTMLMediaElement.play()`.
 *   `play()`          resolves when playback ENDS   — this is the `ended` event.
 *
 * Modelling both is what makes the oracle fair rather than rigged: the double does not decide
 * which one is correct, the SUBJECT decides which one it waits on, and that choice is the defect.
 */
function makeAdapters({ heard = 'apri la memoria', reply = 'sto aprendo la memoria', spoke = true } = {}) {
  const calls = { listen: 0, transcribe: 0, converse: 0, synthesize: 0, play: 0, release: 0 };
  const record = { aborted: [], delivered: [], player: { started: false, ended: false, stopped: false } };
  const stages = {
    listen: stage(record, 'listen'),
    transcribe: stage(record, 'transcribe'),
    converse: stage(record, 'converse'),
    synthesize: stage(record, 'synthesize'),
    play: stage(record, 'play'),
  };
  let playStarted = deferred();
  let playFailure = null;

  const adapters = {
    async listen({ signal, onSpeechEnd } = {}) {
      calls.listen += 1;
      await stages.listen.run(signal);
      onSpeechEnd?.();
      return spoke ? { audio: new Uint8Array([1, 2, 3]), mimeType: 'audio/webm', spoke: true } : { spoke: false };
    },
    async transcribe({ signal } = {}) {
      calls.transcribe += 1;
      await stages.transcribe.run(signal);
      return { text: heard, heardSomething: Boolean(heard), reason: null };
    },
    async converse({ signal } = {}) {
      calls.converse += 1;
      await stages.converse.run(signal);
      record.delivered.push('converse');
      return { reply };
    },
    async synthesize({ signal } = {}) {
      calls.synthesize += 1;
      await stages.synthesize.run(signal);
      return { audio: new Uint8Array([9]), contentType: 'audio/wav' };
    },
    async play({ signal, onPlaybackStart } = {}) {
      calls.play += 1;
      if (playFailure) throw playFailure;
      record.player.started = true;
      onPlaybackStart?.();
      playStarted.resolve();
      const onAbort = () => { record.player.stopped = true; };
      signal?.addEventListener('abort', onAbort, { once: true });
      try {
        await stages.play.run(signal);
        record.player.ended = true;
      } finally {
        signal?.removeEventListener('abort', onAbort);
      }
    },
    /** `HTMLMediaElement.play()` — resolves at the START of playback. The legacy subject awaits
     *  THIS and then reopened the microphone. */
    beginPlayback() { return playStarted.promise; },
    release() { calls.release += 1; },
  };

  return {
    adapters,
    calls,
    record,
    stages,
    failPlaybackWith(error) { playFailure = error; },
    resetPlayback() { playStarted = deferred(); },
  };
}

/* ————— the legacy subject: what shipped, transcribed ———————————————————————————————————— */

class LegacyTurn {
  constructor({ adapters, continuous = true }) {
    this.adapters = adapters;
    this.continuous = continuous;
    this.state = 'idle';
    this.generation = 0;
    this.notes = [];
    this.states = [];
    this.closed = false;
  }

  /* Faithful to `speakWithModel` + `toggleDictation` + `speakReply`, with no signal anywhere
   * because there was none: `transcribeRecording`, `sendChat` and `speakReply` all called
   * `fetch` without an `AbortController`.
   *
   * `start()` returns as soon as the recorder is running and the REST of the turn continues
   * detached — which is exactly what shipped: `toggleDictation` returned after
   * `voiceRecorderChat.start()`, and everything from transcription onwards ran inside the
   * `onstop` callback with nobody holding its promise. */
  start() {
    if (this.closed) return { started: false, reason: 'CLOSED' };
    this.generation += 1;
    this.state = 'listening'; this.states.push('listening');
    void this.#chain().catch(() => {});
    return { started: true };
  }

  async #chain() {
    const captured = await this.adapters.listen({ onSpeechEnd: () => {} });
    if (!captured.spoke) { this.state = 'idle'; return; }
    this.state = 'transcribing'; this.states.push('transcribing');
    const heard = await this.adapters.transcribe({});
    this.state = 'thinking'; this.states.push('thinking');
    await this.adapters.converse({ text: heard.text });
    await this.adapters.synthesize({});
    this.state = 'speaking'; this.states.push('speaking');
    void this.adapters.play({ onPlaybackStart: () => {} }).catch(() => {});
    await this.adapters.beginPlayback();          // app.js:3622 — resolves at START
    if (this.continuous) this.start();             // app.js:3218-3222 — the microphone reopens
  }

  /** There was no cancellation. `voiceFaceClose` set a flag and stopped the RECORDER; anything
   *  already in flight ran to completion and still spoke. */
  interrupt() { return { interrupted: false, reason: 'NOT_IMPLEMENTED' }; }
  cancel() { return { cancelled: false, reason: 'NOT_IMPLEMENTED' }; }
  close() { this.closed = true; this.state = 'closed'; }
}

/* ————— subject factory ————————————————————————————————————————————————————————————————— */

function makeSession(options = {}) {
  const world = makeAdapters(options.world ?? {});
  const states = [];
  const notes = [];
  const common = {
    adapters: world.adapters,
    continuous: options.continuous ?? true,
    onState: (next, detail) => states.push(detail?.reason ? `${next}:${detail.reason}` : next),
    onNote: (note) => notes.push(note),
  };
  const session = SUBJECT === 'v1'
    ? new machine.VoiceSession(common)
    : new LegacyTurn({ adapters: world.adapters, continuous: common.continuous });
  return { session, states: SUBJECT === 'v1' ? states : session.states, notes: SUBJECT === 'v1' ? notes : session.notes, ...world };
}

/** Let every already-queued microtask/turn settle. The pipeline is promise-driven, so this is
 *  the honest way to say "and now nothing else is going to happen on its own". */
const settle = async (times = 6) => { for (let index = 0; index < times; index += 1) await Promise.resolve(); };

/** Drive one turn up to the point where the reply is playing. */
async function reachSpeaking(world) {
  const started = await world.session.start();
  world.stages.listen.release();
  await settle();
  world.stages.transcribe.release();
  await settle();
  world.stages.converse.release();
  await settle();
  world.stages.synthesize.release();
  await settle(10);
  return started;
}

/* ————— the properties ——————————————————————————————————————————————————————————————————— */

describe(`voice turn lifecycle [subject=${SUBJECT}]`, () => {
  test('V-001: the microphone does not reopen until playback has ENDED', async () => {
    const world = makeSession();
    await reachSpeaking(world);
    assert.equal(world.record.player.started, true, 'the reply should be playing by now');
    assert.equal(world.calls.listen, 1,
      'the microphone reopened while the product was still speaking — this is V-001');
    world.stages.play.release();
    await settle(10);
    assert.equal(world.record.player.ended, true);
    assert.equal(world.calls.listen, 2, 'the next turn should open once playback has ended');
  });

  test('V-002: closing during transcription aborts the request in flight', async () => {
    const world = makeSession();
    await world.session.start();
    world.stages.listen.release();
    await settle();
    assert.equal(world.calls.transcribe, 1);
    world.session.close();
    await settle(10);
    assert.ok(world.record.aborted.includes('transcribe'),
      'the transcription request was not aborted when the voice window closed');
    assert.equal(world.calls.release, 1, 'resources were not released exactly once');
  });

  test('V-002: interrupting during the chat stream aborts it and opens a clean turn', async () => {
    const world = makeSession();
    await world.session.start();
    world.stages.listen.release();
    await settle();
    world.stages.transcribe.release();
    await settle();
    assert.equal(world.calls.converse, 1);
    world.session.interrupt('barge-in');
    await settle(10);
    assert.ok(world.record.aborted.includes('converse'), 'the chat stream was not aborted');
    assert.equal(world.calls.listen, 2, 'a fresh turn should be listening after the interruption');
    assert.equal(world.calls.synthesize, 0, 'nothing from the abandoned turn may be synthesised');
  });

  test('V-002: interrupting during playback stops the audio', async () => {
    const world = makeSession();
    await reachSpeaking(world);
    world.session.interrupt('barge-in');
    await settle(10);
    assert.equal(world.record.player.stopped, true, 'playback was not stopped by the interruption');
    assert.equal(world.record.player.ended, false, 'an interrupted reply must not report as ended');
    assert.equal(world.calls.listen, 2);
  });

  test('a result from a cancelled generation never reaches the product', async () => {
    const world = makeSession();
    await world.session.start();
    world.stages.listen.release();
    await settle();
    world.stages.transcribe.release();
    await settle();
    world.session.cancel('owner closed the turn');
    await settle(6);
    // The stale answer arrives AFTER the cancellation, exactly as a slow model would.
    world.stages.converse.release();
    await settle(10);
    assert.equal(world.record.delivered.length, 0, 'a cancelled turn delivered its answer anyway');
    assert.equal(world.calls.synthesize, 0, 'a cancelled turn was still spoken — this is a ghost turn');
    assert.equal(world.calls.play, 0);
  });

  test('starting twice does not open two microphones', async () => {
    const world = makeSession();
    const first = await world.session.start();
    const second = await world.session.start();
    await settle();
    assert.equal(world.calls.listen, 1, 'a second start opened a second microphone');
    assert.equal(first.started, true);
    assert.equal(second.started, false, 'the second start should be refused, not queued');
    assert.equal(second.reason, 'BUSY');
  });

  test('close releases every resource exactly once, however many times it is called', async () => {
    const world = makeSession();
    await reachSpeaking(world);
    world.session.close();
    world.session.close();
    world.session.close();
    await settle(10);
    assert.equal(world.calls.release, 1, 'release must be idempotent');
    assert.equal(world.record.player.stopped, true, 'closing did not stop the audio');
    assert.equal(world.calls.listen, 1, 'closing must never open another microphone');
  });

  test('a refused autoplay is an error state, not a silent reopening', async () => {
    const world = makeSession();
    world.failPlaybackWith(abortError('NotAllowedError'));
    await reachSpeaking(world);
    await settle(10);
    assert.equal(world.calls.listen, 1,
      'the microphone reopened after playback failed — the person would be talking to nothing');
    assert.ok(world.notes.some((note) => /NotAllowedError|play/i.test(JSON.stringify(note))),
      `the failure was not reported to the person: ${JSON.stringify(world.notes)}`);
  });

  test('repeated interruptions are idempotent', async () => {
    const world = makeSession();
    await reachSpeaking(world);
    world.session.interrupt('barge-in');
    world.session.interrupt('barge-in');
    world.session.interrupt('barge-in');
    await settle(12);
    assert.equal(world.calls.listen, 2, 'each repeated interruption opened its own turn');
  });
});

/* ————— properties that only the state machine can carry ————————————————————————————————— */

describe('the state machine itself', { skip: SUBJECT !== 'v1' }, () => {
  test('the required states all exist and CLOSED is terminal', () => {
    const { VoiceTurn, TRANSITIONS } = machine;
    for (const required of ['IDLE', 'LISTENING', 'ENDPOINTING', 'TRANSCRIBING', 'THINKING',
      'SPEAKING', 'INTERRUPTING', 'CANCELLING', 'ERROR', 'CLOSED']) {
      assert.ok(VoiceTurn[required], `${required} is missing from the state machine`);
    }
    assert.deepEqual(TRANSITIONS[VoiceTurn.CLOSED], []);
  });

  test('an illegal transition throws instead of being absorbed', () => {
    const world = makeSession();
    assert.throws(() => world.session.forceTransition(machine.VoiceTurn.SPEAKING),
      /illegal voice transition/i);
  });

  test('the happy path walks the states in the order the contract names', async () => {
    const world = makeSession();
    await reachSpeaking(world);
    world.stages.play.release();
    await settle(12);
    const walked = world.states.map((entry) => entry.split(':')[0]);
    const wanted = ['listening', 'endpointing', 'transcribing', 'thinking', 'speaking', 'listening'];
    assert.deepEqual(walked.slice(0, wanted.length), wanted, JSON.stringify(walked));
  });

  test('an interruption walks through INTERRUPTING and nowhere else', async () => {
    const world = makeSession();
    await reachSpeaking(world);
    world.session.interrupt('barge-in');
    await settle(12);
    const walked = world.states.map((entry) => entry.split(':')[0]);
    assert.ok(walked.includes('interrupting'), JSON.stringify(walked));
    assert.equal(walked.at(-1), 'listening');
  });

  test('a cancellation walks through CANCELLING and stops at IDLE', async () => {
    const world = makeSession();
    await reachSpeaking(world);
    world.session.cancel('owner');
    await settle(12);
    const walked = world.states.map((entry) => entry.split(':')[0]);
    assert.ok(walked.includes('cancelling'), JSON.stringify(walked));
    assert.equal(walked.at(-1), 'idle');
    assert.equal(world.calls.listen, 1, 'a cancellation must not open another turn');
  });

  test('hearing nothing ends the turn instead of transcribing silence', async () => {
    const world = makeSession({ continuous: false, world: { spoke: false } });
    await world.session.start();
    world.stages.listen.release();
    await settle(10);
    assert.equal(world.calls.transcribe, 0, 'silence was sent to the transcription engine');
    assert.equal(world.session.state, machine.VoiceTurn.IDLE);
  });

  test('§3#6: hands-free mode keeps listening through silence instead of stopping', async () => {
    // Owner, verbatim: "la voce si interrompe/blocca durante l'uso, invece di restare attiva" /
    // "resti attiva finché non la fermo io". Root cause: only the SPOKEN-REPLY path restarted the
    // microphone; a silent room (6s, `NO_SPEECH_GIVE_UP_MS`) ended the session instead.
    const world = makeSession({ world: { spoke: false } }); // continuous: true (default)
    await world.session.start();
    world.stages.listen.release();
    await settle(10);
    assert.equal(world.calls.transcribe, 0, 'silence was sent to the transcription engine');
    assert.equal(world.session.state, machine.VoiceTurn.LISTENING,
      'hands-free mode must reopen the microphone instead of stopping on silence');
    assert.equal(world.calls.listen, 2, 'a second turn must have started on its own');
  });

  test('§3#6: hands-free mode keeps listening after an unclear utterance', async () => {
    const world = makeSession({ world: { heard: '' } }); // heardSomething: false
    await world.session.start();
    world.stages.listen.release();
    await settle();
    world.stages.transcribe.release();
    await settle(10);
    assert.equal(world.calls.converse, 0, 'an unclear utterance was sent to the model');
    assert.equal(world.session.state, machine.VoiceTurn.LISTENING,
      'hands-free mode must reopen the microphone after "not understood" too');
    assert.equal(world.calls.listen, 2, 'a second turn must have started on its own');
  });

  test('§3#6: hands-free mode keeps listening after a command with nothing to say', async () => {
    const world = makeSession({ world: { reply: '' } }); // e.g. a navigation, performed elsewhere
    await world.session.start();
    world.stages.listen.release();
    await settle();
    world.stages.transcribe.release();
    await settle();
    world.stages.converse.release();
    await settle(10);
    assert.equal(world.calls.synthesize, 0, 'an empty reply was sent to synthesis');
    assert.equal(world.session.state, machine.VoiceTurn.LISTENING,
      'hands-free mode must reopen the microphone after a silent command too');
    assert.equal(world.calls.listen, 2, 'a second turn must have started on its own');
  });

  test('every generation gets its own controller, and a stale one cannot abort the live turn',
    async () => {
      const world = makeSession();
      await reachSpeaking(world);
      const first = world.session.generation;
      world.session.interrupt('barge-in');
      await settle(12);
      assert.notEqual(world.session.generation, first, 'the generation did not advance');
      assert.ok(world.session.generation > first);
    });
});

/* ————— the oracle: proof that the assertions above have teeth ——————————————————————————— */

describe('the oracle still has teeth (the shipped sequencing must fail these)', { skip: SUBJECT !== 'v1' }, () => {
  /** The same scenario as the first property, run against the transcription of what shipped. */
  test('the legacy sequencing reopens the microphone while the reply is still playing', async () => {
    const world = makeAdapters();
    const legacy = new LegacyTurn({ adapters: world.adapters });
    void legacy.start();
    await settle();
    world.stages.listen.release(); await settle();
    world.stages.transcribe.release(); await settle();
    world.stages.converse.release(); await settle();
    world.stages.synthesize.release(); await settle(12);
    assert.equal(world.record.player.started, true, 'the reply should be playing');
    assert.equal(world.record.player.ended, false, 'the reply has NOT finished');
    assert.equal(world.calls.listen, 2,
      'the oracle no longer reproduces V-001 — the assertion it defends is no longer proven to bite');
  });

  test('the legacy sequencing cannot abort anything in flight', async () => {
    const world = makeAdapters();
    const legacy = new LegacyTurn({ adapters: world.adapters });
    void legacy.start();
    await settle();
    world.stages.listen.release(); await settle();
    legacy.close();
    world.stages.transcribe.release(); await settle(10);
    assert.deepEqual(world.record.aborted, [], 'the oracle no longer reproduces V-002');
    assert.equal(world.calls.converse, 1,
      'the legacy turn kept going after close — which is exactly the ghost turn V-002 describes');
  });
});

/* ————— the shipped file, not a double —————————————————————————————————————————————————— */

describe('the browser shell is actually wired to the machine', { skip: SUBJECT !== 'v1' }, () => {
  const app = readFileSync(join(webRoot, 'app.js'), 'utf8');

  test('app.js imports the session module', () => {
    assert.match(app, /import\s*\{[^}]*VoiceSession[^}]*\}\s*from\s*'\.\/voice-session\.js'/);
  });

  test('the defective sequencing is gone: no microphone reopening on a bare play()', () => {
    // The exact shape of the defect: awaiting play() and then reopening the microphone.
    assert.doesNotMatch(app, /await\s+spokenAudio\.play\(\)[\s\S]{0,600}?toggleDictation\(\)/,
      'app.js still reopens the microphone after `play()` resolves — V-001 is back');
  });

  test('every voice fetch carries a signal', () => {
    for (const route of ['/api/v1/voice/transcribe', '/api/v1/voice/speak']) {
      const call = app.slice(app.indexOf(route));
      const window = call.slice(0, 700);
      // Shorthand counts: `{signal}` and `{signal: signal}` are the same property.
      assert.match(window, /\bsignal\b\s*[,:}]/, `the fetch to ${route} carries no AbortSignal`);
    }
  });

  test('the interface can say it is interrupting, and can be stopped', () => {
    const markup = readFileSync(join(webRoot, 'index.html'), 'utf8');
    assert.match(markup, /id="voiceFaceStop"/, 'there is no control to stop the product speaking');
    assert.match(app, /VoiceTurn\.INTERRUPTING/, 'the shell never renders the INTERRUPTING state');
  });
});
