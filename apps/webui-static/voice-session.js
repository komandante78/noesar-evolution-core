// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The voice turn, as a state machine that can be stopped.
//
// Owner, V1: *«rendere il lifecycle vocale interrompibile, cancellabile e deterministicamente
// corretto, chiudendo V-001 e V-002 senza dichiarare falsamente full-duplex ciò che non lo è»*.
//
// # The two defects this file exists to remove
//
// **V-001 (CRITICAL).** `HTMLMediaElement.play()` resolves when playback BEGINS. The shipped
// code did `await spokenAudio.play()` and then reopened the microphone, under a comment claiming
// the opposite — so the product listened to itself. The measured consequence was not merely
// cosmetic: the recorder calibrates its noise floor on the first 400 ms it hears, so the floor
// was taken from the product's own voice, the speech threshold (`floor × 3`) was inflated, and
// the person's reply could land underneath it and be reported as "I did not hear anything".
// Here, a turn advances on the `ended` event and on nothing else — `play()` is an adapter whose
// contract is *resolve when playback is over*.
//
// **V-002 (HIGH).** Nothing carried an `AbortController`. A transcription, a chat stream or a
// synthesis already in flight could not be stopped, so closing the window left a turn running
// that still spoke, and a slow answer from an abandoned turn could still arrive and act.
// Here every stage of a turn shares ONE controller, owned by that turn's generation.
//
// # What this is NOT
//
// It is **not full-duplex**. The transport is still request/response, the microphone is still
// closed while the product speaks, and barge-in is detected LOCALLY (the shell watches the
// microphone's level during playback and calls `bargeIn()`). Real full-duplex — streaming
// transcription over a persistent transport — is V3, and calling this that would be a false PASS.
//
// # The generation is the whole safety argument
//
// Every turn has a monotonically increasing generation. Every awaited result is checked against
// it before it may touch anything. A result belonging to a superseded generation is dropped in
// silence: it does not render, does not speak, does not advance the machine. That is what makes
// "ghost turns" and double answers structurally impossible rather than unlikely.
//
// # Why the machine is here and not in `app.js`
//
// A lifecycle that only exists inside a 3 600-line browser file can only be tested by a browser,
// and the browser cannot be driven without a microphone and a person. Everything below is pure:
// the adapters are injected, so the whole lifecycle — ordering, cancellation, abort propagation,
// idempotence, resource release — is provable headless, with no audio device anywhere.

/** The states a spoken turn can be in. `CLOSED` is terminal. */
export const VoiceTurn = Object.freeze({
  /** Nothing is running. The only resting state. */
  IDLE: 'idle',
  /** The microphone is open and the person may speak. */
  LISTENING: 'listening',
  /** Speech has stopped; the recorder is closing the utterance. */
  ENDPOINTING: 'endpointing',
  /** The audio is with the transcription engine. */
  TRANSCRIBING: 'transcribing',
  /** The words are with the model, and the answer is being synthesised. */
  THINKING: 'thinking',
  /** The product is speaking. Playback is live. */
  SPEAKING: 'speaking',
  /** Somebody cut in. Everything of this generation is being torn down, and a new turn follows. */
  INTERRUPTING: 'interrupting',
  /** Everything of this generation is being torn down, and NO new turn follows. */
  CANCELLING: 'cancelling',
  /** Something failed in a way the person must be told about. */
  ERROR: 'error',
  /** The session is over. Resources are released and nothing restarts. */
  CLOSED: 'closed',
});

/**
 * Which transitions exist. Anything absent throws rather than being absorbed.
 *
 * A machine that silently ignores an impossible transition is a machine that hides the bug that
 * attempted it — and the bug this whole phase is about (`SPEAKING` while the microphone is open)
 * is exactly of that shape.
 */
export const TRANSITIONS = Object.freeze({
  [VoiceTurn.IDLE]: Object.freeze([VoiceTurn.LISTENING, VoiceTurn.CANCELLING, VoiceTurn.ERROR, VoiceTurn.CLOSED]),
  [VoiceTurn.LISTENING]: Object.freeze([VoiceTurn.ENDPOINTING, VoiceTurn.INTERRUPTING, VoiceTurn.CANCELLING, VoiceTurn.ERROR, VoiceTurn.CLOSED]),
  [VoiceTurn.ENDPOINTING]: Object.freeze([VoiceTurn.TRANSCRIBING, VoiceTurn.IDLE, VoiceTurn.INTERRUPTING, VoiceTurn.CANCELLING, VoiceTurn.ERROR, VoiceTurn.CLOSED]),
  [VoiceTurn.TRANSCRIBING]: Object.freeze([VoiceTurn.THINKING, VoiceTurn.IDLE, VoiceTurn.INTERRUPTING, VoiceTurn.CANCELLING, VoiceTurn.ERROR, VoiceTurn.CLOSED]),
  [VoiceTurn.THINKING]: Object.freeze([VoiceTurn.SPEAKING, VoiceTurn.IDLE, VoiceTurn.INTERRUPTING, VoiceTurn.CANCELLING, VoiceTurn.ERROR, VoiceTurn.CLOSED]),
  [VoiceTurn.SPEAKING]: Object.freeze([VoiceTurn.LISTENING, VoiceTurn.IDLE, VoiceTurn.INTERRUPTING, VoiceTurn.CANCELLING, VoiceTurn.ERROR, VoiceTurn.CLOSED]),
  [VoiceTurn.INTERRUPTING]: Object.freeze([VoiceTurn.LISTENING, VoiceTurn.IDLE, VoiceTurn.CANCELLING, VoiceTurn.CLOSED]),
  [VoiceTurn.CANCELLING]: Object.freeze([VoiceTurn.IDLE, VoiceTurn.CLOSED]),
  [VoiceTurn.ERROR]: Object.freeze([VoiceTurn.IDLE, VoiceTurn.LISTENING, VoiceTurn.CANCELLING, VoiceTurn.CLOSED]),
  [VoiceTurn.CLOSED]: Object.freeze([]),
});

/** The states in which a turn is actually doing something. */
export const ACTIVE_STATES = Object.freeze([
  VoiceTurn.LISTENING, VoiceTurn.ENDPOINTING, VoiceTurn.TRANSCRIBING,
  VoiceTurn.THINKING, VoiceTurn.SPEAKING,
]);

/** Thrown internally when a result outlives its generation. Never surfaces to the caller. */
class StaleGeneration extends Error {
  constructor(generation) {
    super(`voice turn ${generation} was superseded`);
    this.name = 'StaleGeneration';
    this.generation = generation;
  }
}

const isAbort = (error) => error?.name === 'AbortError' || error?.name === 'StaleGeneration';

/**
 * One spoken conversation.
 *
 * The adapters are the only things that know about a browser. Each receives the turn's `signal`
 * and must abandon its work when it fires:
 *
 *   `listen({signal, onSpeechEnd})`        -> `{audio, mimeType, spoke}`; `onSpeechEnd()` when
 *                                             the endpointer decides the person has finished.
 *   `transcribe({audio, mimeType, signal})`-> `{text, heardSomething, reason}`
 *   `converse({text, signal})`             -> `{reply}` — the chat turn, history and tools included
 *   `synthesize({text, signal})`           -> `{audio, contentType}`
 *   `play({audio, contentType, signal, onPlaybackStart})`
 *                                          -> resolves **when playback has ENDED**. This contract
 *                                             is the whole of the V-001 fix; an adapter that
 *                                             resolves at the start reintroduces the defect.
 *   `release()`                            -> free everything the session owns. Called ONCE.
 */
export class VoiceSession {
  #adapters;
  #onState;
  #onNote;
  #continuous;
  #state = VoiceTurn.IDLE;
  #generation = 0;
  #controller = null;
  #released = false;
  #interruptions = 0;

  constructor({ adapters, onState = () => {}, onNote = () => {}, continuous = true } = {}) {
    if (!adapters) throw new TypeError('a voice session needs its adapters');
    this.#adapters = adapters;
    this.#onState = onState;
    this.#onNote = onNote;
    this.#continuous = continuous;
  }

  get state() { return this.#state; }

  get generation() { return this.#generation; }

  /** True while a turn is doing something — what a caller checks before offering to start one. */
  get busy() { return ACTIVE_STATES.includes(this.#state); }

  /** How many times somebody cut in. Exposed because idempotence is a property worth asserting. */
  get interruptions() { return this.#interruptions; }

  /**
   * Open a turn. Refused — never queued — while one is running.
   *
   * Queuing would be the friendly-looking choice and the wrong one: two microphones, two
   * generations, and an answer arriving for a turn the person had already replaced.
   */
  start(reason = 'owner') {
    if (this.#state === VoiceTurn.CLOSED) return { started: false, reason: 'CLOSED' };
    if (this.busy || this.#state === VoiceTurn.INTERRUPTING || this.#state === VoiceTurn.CANCELLING) {
      return { started: false, reason: 'BUSY' };
    }
    return this.#begin(reason);
  }

  #begin(reason) {
    const generation = this.#generation + 1;
    this.#generation = generation;
    this.#controller = new AbortController();
    this.#to(VoiceTurn.LISTENING, { reason, generation });
    void this.#run(generation, this.#controller).catch(() => {});
    return { started: true, generation };
  }

  /**
   * Somebody cut in: tear this generation down and open a fresh one.
   *
   * Idempotent by construction — the second call finds the machine already in `INTERRUPTING` and
   * does nothing. Three taps on the stop control must not produce three turns, and the person
   * tapping it three times is the ordinary case, not the exotic one.
   */
  interrupt(reason = 'barge-in') {
    if (this.#state === VoiceTurn.CLOSED) return { interrupted: false, reason: 'CLOSED' };
    if (!this.busy) return { interrupted: false, reason: 'IDLE' };
    const from = this.#state;
    this.#interruptions += 1;
    this.#to(VoiceTurn.INTERRUPTING, { reason, from });
    this.#abort();
    // Cutting in while the product had the turn means "answer this instead", so a new turn opens.
    // Cutting in while the MICROPHONE was already open means "stop listening", and opening a
    // second microphone would be a loop with extra steps.
    if (this.#continuous && from !== VoiceTurn.LISTENING) {
      const started = this.#begin('after-interruption');
      return { interrupted: true, ...started };
    }
    this.#to(VoiceTurn.IDLE, { reason });
    return { interrupted: true, started: false };
  }

  /** Stop everything and stay stopped. No new turn, whatever `continuous` says. */
  cancel(reason = 'cancelled') {
    if (this.#state === VoiceTurn.CLOSED) return { cancelled: false, reason: 'CLOSED' };
    if (this.#state === VoiceTurn.IDLE) return { cancelled: false, reason: 'IDLE' };
    this.#to(VoiceTurn.CANCELLING, { reason });
    this.#abort();
    this.#to(VoiceTurn.IDLE, { reason });
    return { cancelled: true };
  }

  /**
   * The session is over. Aborts whatever is in flight and releases the adapters exactly once,
   * however many times this is called — closing a window twice is a click, not a program error.
   */
  close(reason = 'closed') {
    if (this.#state === VoiceTurn.CLOSED) return { closed: true, already: true };
    this.#abort();
    this.#to(VoiceTurn.CLOSED, { reason });
    if (!this.#released) {
      this.#released = true;
      try { this.#adapters.release?.(); } catch { /* releasing must never throw upwards */ }
    }
    return { closed: true, already: false };
  }

  /** Only for tests: proves an illegal transition is refused rather than absorbed. */
  forceTransition(next) { return this.#to(next, { reason: 'forced' }); }

  /* ————— internals ————————————————————————————————————————————————————————————————————— */

  #abort() {
    const controller = this.#controller;
    this.#controller = null;
    // Advancing the generation BEFORE aborting is what makes a late result harmless: by the time
    // any rejection or resolution is delivered, its generation is already stale.
    this.#generation += 1;
    try { controller?.abort(); } catch { /* an already-aborted controller is not an error */ }
  }

  #to(next, detail = {}) {
    const allowed = TRANSITIONS[this.#state] ?? [];
    if (!allowed.includes(next)) {
      throw new Error(`illegal voice transition: ${this.#state} -> ${next}`);
    }
    this.#state = next;
    this.#onState(next, { ...detail, state: next, generation: this.#generation });
    return next;
  }

  #current(generation) { return generation === this.#generation && this.#state !== VoiceTurn.CLOSED; }

  #assert(generation) {
    if (!this.#current(generation)) throw new StaleGeneration(generation);
  }

  #note(note) { this.#onNote(note); }

  async #run(generation, controller) {
    const { signal } = controller;
    try {
      const captured = await this.#adapters.listen({
        signal,
        // The endpointer speaking for itself: the recorder knows the person stopped before the
        // audio has finished being assembled, and the interface should say so at that moment.
        onSpeechEnd: () => { if (this.#current(generation) && this.#state === VoiceTurn.LISTENING) this.#to(VoiceTurn.ENDPOINTING, { generation }); },
      });
      this.#assert(generation);
      if (this.#state === VoiceTurn.LISTENING) this.#to(VoiceTurn.ENDPOINTING, { generation });

      if (!captured?.spoke) {
        this.#note({ kind: 'nothing-heard' });
        this.#to(VoiceTurn.IDLE, { reason: 'nothing-heard' });
        return;
      }

      this.#to(VoiceTurn.TRANSCRIBING, { generation });
      const heard = await this.#adapters.transcribe({
        audio: captured.audio, mimeType: captured.mimeType, signal,
      });
      this.#assert(generation);
      if (!heard?.heardSomething) {
        this.#note({ kind: 'not-understood', reason: heard?.reason ?? null });
        this.#to(VoiceTurn.IDLE, { reason: 'not-understood' });
        return;
      }
      this.#note({ kind: 'heard', text: heard.text });

      this.#to(VoiceTurn.THINKING, { generation });
      const answered = await this.#adapters.converse({ text: heard.text, signal });
      this.#assert(generation);
      const reply = String(answered?.reply ?? '').trim();
      if (!reply) {
        // A turn that produced no words is finished, not broken: the utterance may have been a
        // navigation, which the shell performs itself and reports.
        this.#to(VoiceTurn.IDLE, { reason: answered?.reason ?? 'nothing-to-say' });
        return;
      }

      const spoken = await this.#adapters.synthesize({ text: reply, signal });
      this.#assert(generation);

      await this.#adapters.play({
        audio: spoken.audio,
        contentType: spoken.contentType,
        signal,
        onPlaybackStart: () => { if (this.#current(generation) && this.#state === VoiceTurn.THINKING) this.#to(VoiceTurn.SPEAKING, { generation }); },
      });
      // THE line this phase is about: everything below runs only once playback has ENDED.
      this.#assert(generation);

      if (this.#continuous) this.#begin('after-reply');
      else this.#to(VoiceTurn.IDLE, { reason: 'reply-finished' });
    } catch (error) {
      // An abort or a superseded generation is not a failure: the state it produced was already
      // set by whoever aborted, and reporting it would tell the person their own action broke
      // something.
      if (isAbort(error) || signal.aborted || !this.#current(generation)) return;
      this.#note({ kind: 'error', error: error?.name ?? 'Error', message: error?.message ?? String(error) });
      this.#to(VoiceTurn.ERROR, { reason: error?.name ?? 'error' });
    }
  }
}
