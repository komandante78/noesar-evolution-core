// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The voice bench — what can be measured without a device, and what honestly cannot.
//
//   node tools/acceptance/voice-latency.mjs            human-readable
//   node tools/acceptance/voice-latency.mjs --json     machine-readable, to stdout
//
// # Why this exists
//
// The audit of this feature had to report seven latencies as `BLOCKED`, and a `BLOCKED` that
// carries no procedure is a number nobody will ever produce. This file is the procedure: it
// measures every latency that the lifecycle alone decides, and for each one it cannot reach it
// prints the exact steps, the exact instrument, and what would make the answer trustworthy.
//
// # The rule this file obeys, and the reason it is written down
//
// **A measurement that cannot be taken is reported as `BLOCKED`. It is never simulated, never
// estimated, and never inherited from documentation.** `docs/VOICE.md` has carried "1.8 s for a
// short utterance" since s337 with no measurement behind it anywhere in the repository; that
// number is exactly what this file exists to stop being repeated.
//
// # What it will not do
//
// It opens no microphone, plays no audio, starts no container, writes no file and reaches no
// network. It cannot: it is a Node process, and the microphone lives in a browser. The real
// acceptance is therefore a separate, human-driven procedure that needs the Owner's
// authorisation — `REAL_MICROPHONE_ACCEPTANCE=BLOCKED_AWAITING_OWNER` — and it is printed below
// rather than approximated here.

import { VoiceSession, VoiceTurn } from '../../apps/webui-static/voice-session.js';

const asJson = process.argv.includes('--json');
const now = () => Number(process.hrtime.bigint() / 1000n) / 1000; // ms, monotonic

const settle = async (times = 8) => { for (let index = 0; index < times; index += 1) await Promise.resolve(); };

/** Adapters that do nothing but let us hold each stage open and watch what abort does to it. */
function bench() {
  const marks = {};
  const stages = {};
  const open = (key) => {
    let release;
    const promise = new Promise((resolve, reject) => { release = { resolve, reject }; });
    stages[key] = release;
    return promise;
  };
  const guard = (key, signal) => new Promise((resolve, reject) => {
    const promise = open(key);
    signal?.addEventListener('abort', () => {
      marks[`${key}.abortObserved`] = now();
      reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
    }, { once: true });
    promise.then(resolve, reject);
  });

  const adapters = {
    async listen({ signal, onSpeechEnd }) {
      await guard('listen', signal);
      onSpeechEnd?.();
      return { audio: new Uint8Array([1]), mimeType: 'audio/webm', spoke: true };
    },
    async transcribe({ signal }) { await guard('transcribe', signal); return { text: 'ciao', heardSomething: true }; },
    async converse({ signal }) { await guard('converse', signal); return { reply: 'ecco' }; },
    async synthesize({ signal }) { await guard('synthesize', signal); return { audio: new Uint8Array([2]), contentType: 'audio/wav' }; },
    async play({ signal, onPlaybackStart }) {
      marks.playbackStart = now();
      onPlaybackStart?.();
      await guard('play', signal);
      marks.playbackEnd = now();
    },
    release() { marks.released = now(); },
  };
  return { adapters, marks, stages };
}

async function measureSynthetic() {
  const results = {};

  // 1. How long from "cut in" to "the playback adapter has been told to stop".
  {
    const world = bench();
    const session = new VoiceSession({ adapters: world.adapters });
    session.start();
    await settle(); world.stages.listen.resolve(); await settle();
    world.stages.transcribe.resolve(); await settle();
    world.stages.converse.resolve(); await settle();
    world.stages.synthesize.resolve(); await settle(10);
    const asked = now();
    session.interrupt('bench');
    await settle(10);
    results.bargeInToPlaybackStopMs = {
      value: Number((world.marks['play.abortObserved'] - asked).toFixed(3)),
      kind: 'SYNTHETIC',
      means: 'from interrupt() to the playback adapter observing its abort — the lifecycle only. '
        + 'It does NOT include the browser stopping a real audio element, which is BLOCKED below.',
    };
    session.close();
  }

  // 2. That a cancellation reaches every stage, and how far it propagates.
  {
    const reached = [];
    for (const at of ['transcribe', 'converse', 'synthesize']) {
      const world = bench();
      const session = new VoiceSession({ adapters: world.adapters });
      session.start();
      await settle(); world.stages.listen.resolve(); await settle();
      if (at !== 'transcribe') { world.stages.transcribe.resolve(); await settle(); }
      if (at === 'synthesize') { world.stages.converse.resolve(); await settle(); }
      session.cancel('bench');
      await settle(10);
      if (world.marks[`${at}.abortObserved`]) reached.push(at);
      session.close();
    }
    results.cancellationReaches = {
      value: reached,
      kind: 'SYNTHETIC',
      means: 'every stage that observed its abort when the turn was cancelled while it was in flight',
    };
  }

  // 3. That a superseded generation cannot come back.
  {
    const world = bench();
    const session = new VoiceSession({ adapters: world.adapters });
    session.start();
    await settle(); world.stages.listen.resolve(); await settle();
    world.stages.transcribe.resolve(); await settle();
    const before = session.generation;
    session.interrupt('bench');
    await settle(10);
    world.stages.converse.resolve?.();     // the abandoned answer arrives now
    await settle(10);
    results.staleGenerationBlocked = {
      value: session.generation > before && session.state === VoiceTurn.LISTENING,
      kind: 'SYNTHETIC',
      means: 'the generation advanced and the abandoned answer changed nothing',
    };
    session.close();
  }

  return results;
}

/**
 * The seven measurements that need a real device. Each carries the instrument and the procedure,
 * so the answer can be produced the moment the Owner authorises it — and so nobody is tempted to
 * fill the gap with a plausible number.
 */
const BLOCKED = {
  audioToPartialTranscriptMs: {
    status: 'BLOCKED', reason: 'ABSENT_BY_DESIGN',
    detail: 'there are no partial transcripts: the transport is request/response and the whole '
      + 'utterance is sent once. This becomes measurable in V3, not before.',
  },
  endOfSpeechToFinalTranscriptMs: {
    status: 'BLOCKED', reason: 'NEEDS_REAL_MICROPHONE',
    procedure: 'in the browser, with the voice window open: performance.mark at the ENDPOINTING '
      + 'state change and at the TRANSCRIBING->THINKING change. Both are emitted by onState.',
  },
  endOfSpeechToFirstTokenMs: {
    status: 'BLOCKED', reason: 'NEEDS_REAL_MICROPHONE',
    procedure: 'same marks, plus the first `delta` frame of /api/v1/chat/stream.',
  },
  endOfSpeechToFirstAudioMs: {
    status: 'BLOCKED', reason: 'NEEDS_REAL_MICROPHONE',
    procedure: 'ENDPOINTING mark to the SPEAKING state change (onPlaybackStart). Expect it to be '
      + 'dominated by the WHOLE reply plus the WHOLE synthesis while the transport is batch — '
      + 'that is V-003, and V2 is the phase that changes it.',
  },
  bargeInToSilenceMs: {
    status: 'BLOCKED', reason: 'NEEDS_REAL_SPEAKER_AND_MICROPHONE',
    procedure: 'speak over the reply; mark at the INTERRUPTING state change and at the audio '
      + 'element reporting paused. The synthetic half of this IS measured above; what is blocked '
      + 'is the browser and device part.',
    warning: 'no sub-200ms claim may be made from the synthetic number alone.',
  },
  reconnectionMs: {
    status: 'BLOCKED', reason: 'NOT_IMPLEMENTED',
    detail: 'there is no reconnection for the chat stream in a spoken turn (V-008). V4.',
  },
  turnLossOrDuplication: {
    status: 'BLOCKED', reason: 'NEEDS_REAL_SESSION',
    procedure: 'drop the network mid-stream and compare the conversation history before and '
      + 'after. The lifecycle guarantee (one generation, one answer) is proven synthetically by '
      + 'voice-session.test.mjs; what is blocked is the end-to-end behaviour under a real drop.',
  },
};

const REAL_ACCEPTANCE = {
  status: 'BLOCKED_AWAITING_OWNER',
  why: 'a microphone, a speaker and a browser with permission are all Owner-authorised resources '
    + '(CLAUDE10.md section 18: work stops for containers, runtime and anything outside scope).',
  procedure: [
    '1. Open the WebUI over an address the browser accepts as secure (see docs/VOICE.md).',
    '2. Sign in, open a chat, press the microphone, say one sentence.',
    '3. While the reply is being spoken, speak again: the reply must stop and a new turn open.',
    '4. Press Escape during a reply: the same, without relying on the microphone hearing you.',
    '5. Close the voice window while it is thinking: nothing must speak afterwards.',
    '6. Read the marks off the Performance panel and put them in docs/VOICE.md.',
  ],
  refusesToRunHere: 'this process has no browser and no audio device; producing any of these '
    + 'numbers from Node would be fabricating them.',
};

const synthetic = await measureSynthetic();
const report = {
  tool: 'voice-latency',
  subject: 'apps/webui-static/voice-session.js',
  synthetic,
  blocked: BLOCKED,
  realMicrophoneAcceptance: REAL_ACCEPTANCE,
  note: 'SYNTHETIC numbers describe the lifecycle only. They are not audio latency and must never '
    + 'be reported as such.',
};

if (asJson) {
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} else {
  process.stdout.write('VOICE BENCH — lifecycle measurements (synthetic) and what is blocked\n\n');
  for (const [name, entry] of Object.entries(synthetic)) {
    process.stdout.write(`  SYNTHETIC  ${name} = ${JSON.stringify(entry.value)}\n             ${entry.means}\n`);
  }
  process.stdout.write('\n');
  for (const [name, entry] of Object.entries(BLOCKED)) {
    process.stdout.write(`  BLOCKED    ${name} — ${entry.reason}\n             ${entry.procedure ?? entry.detail}\n`);
  }
  process.stdout.write(`\n  REAL_MICROPHONE_ACCEPTANCE = ${REAL_ACCEPTANCE.status}\n`);
  for (const step of REAL_ACCEPTANCE.procedure) process.stdout.write(`             ${step}\n`);
  process.stdout.write('\n  Nothing was written, no device was opened, no container was touched.\n');
}
