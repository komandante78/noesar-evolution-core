// SPDX-License-Identifier: AGPL-3.0-or-later
//
// ⚠️ SUPERSEDED, s336 voice stage 3. Nothing imports this module any more.
//
// The Owner's requirement retired it in two independent ways at once, and it is worth recording
// both because only one of them is about this file being small:
//
//   «non deve essere statico» — five hand-written words could never reach the product. That is
//   fixable by growing the vocabulary, and growing it is exactly the trap: every row would be a
//   second name for something the product already names, drifting from the day it was written.
//   `voice-intent.js` resolves against the product's own entries instead, so there is no list.
//
//   «fai un motore reale interno» — the hearing happened in the BROWSER. An installation's
//   ability to hear depended on which browser was pointed at it, and the audio left the machine
//   for whoever built that browser. No amount of vocabulary would have fixed that; it is why the
//   engine moved server-side in stage 1 (`voice-engine.mjs`) rather than being extended here.
//
// Kept rather than deleted: deleting a file is not this session's decision to take alone, and
// the rule at the centre of this one is the rule the replacement inherited — on anything it did
// not clearly hear, ask again rather than guess which of two outcomes to run. Its tests still
// run, so it cannot rot silently while it sits here.
//
// D-0123: voice as a control tower, not an assistant. Two things only — say the status
// without looking, and approve/reject an ALREADY-COMPUTED plan hands-free — never a
// conversation, and never a way to widen what the product will do. The 2026 voice market
// is speech -> model -> speech call centres; copying that shape would add a second way to
// ask the product to do something new, which is exactly what this must not be (see
// docs/WEBUI_DESIGN_V3.md §6, row IV). The constraint is the point: voice cannot mint
// authority a plan did not already compute (the same "promote a result, not an intention"
// rule as D-0109, applied to a microphone), revocation is always accepted immediately,
// and on anything it did not clearly hear it repeats the question rather than guessing
// which of two outcomes to run.
//
// Kept in its own zero-dependency module, same reason colour.js/qr.js/schedule.js are:
// testable without a browser. Every test in this file's own test file injects fakes for
// SpeechRecognition/speechSynthesis — no real speech engine is available in this
// project's own headless E2E environment either, so `initVoiceControl`'s feature
// detection is the actually-exercised path there, same as any operator's browser that
// lacks one.

export const VOICE_VOCABULARY = Object.freeze(['approve', 'reject', 'cancel', 'repeat', 'status']);

/** A short, fixed phrase only — this is not a transcription of free speech. Anything that
 *  is not, once lowercased and trimmed, exactly one of `VOICE_VOCABULARY`, or whose
 *  reported confidence is below `threshold`, is unrecognised: never a fuzzy/partial
 *  match, because a fuzzy match is exactly the kind of guess D-0123 forbids. */
export function matchVoiceCommand(transcript, confidence, threshold = 0.6) {
  if (typeof transcript !== 'string') return null;
  if (typeof confidence === 'number' && confidence < threshold) return null;
  const word = transcript.trim().toLowerCase();
  return VOICE_VOCABULARY.includes(word) ? word : null;
}

/** The same fixed-format status line the TUI's `status` command and the workbench's own
 *  panels already show, reduced to one spoken sentence — never inventing a figure the
 *  browser itself does not have. `snapshot.status` is `currentWorkspaceRun?.status`
 *  verbatim (`undefined`/`null` when there is no run at all). */
export function buildStatusUtterance(snapshot = {}) {
  const { status, risk, confidence, fileCount } = snapshot;
  switch (status) {
    case undefined:
    case null:
      return 'No plan pending.';
    case 'PENDING_APPROVAL':
      return `Plan pending approval. Risk ${risk ?? 'unknown'}. Confidence ${
        typeof confidence === 'number' ? Math.round(confidence * 100) : 'unknown'
      } percent. ${fileCount ?? 0} file${fileCount === 1 ? '' : 's'}.`;
    case 'PROMOTED': return 'Approved and promoted.';
    case 'REFUSED': return 'Approved, but not promoted. Check the Shadow panel.';
    case 'REJECTED': return 'Rejected.';
    case 'RESTORED': return 'Restored — the promoted files were reverted.';
    default: return `Plan status: ${status}.`;
  }
}

/** The state machine, pure: no I/O, one transition per call. `command` is already the
 *  output of `matchVoiceCommand` (a vocabulary word or `null`).
 *
 *  IDLE is the resting state. `approve`/`reject` from IDLE never execute immediately —
 *  they move to an AWAITING_CONFIRM_* state and ask for the SAME word again, which is the
 *  "conferma ripetuta" (repeated confirmation) D-0123 requires. From an
 *  AWAITING_CONFIRM_* state: the matching word a second time executes the action and
 *  returns to IDLE; `cancel` (or the OTHER action word — saying "reject" while awaiting
 *  approval confirmation is an unambiguous change of mind, not a second action) revokes
 *  immediately, no confirmation needed for that, matching "revoca sempre ammessa";
 *  anything else — unmatched vocabulary, low confidence, `status`, `repeat` — neither
 *  executes nor cancels: it re-asks the same confirmation, which is "se non ha capito
 *  ripete invece di indovinare" applied to the one place a wrong guess would matter. */
export function nextVoiceState({ state = 'IDLE', command, hasPendingRun = false }) {
  if (state === 'AWAITING_CONFIRM_APPROVE') {
    if (command === 'approve') return { state: 'IDLE', action: 'approve', utterance: 'Approving.' };
    if (command === 'cancel' || command === 'reject') return { state: 'IDLE', action: null, utterance: 'Cancelled.' };
    return { state: 'AWAITING_CONFIRM_APPROVE', action: null, utterance: 'Still waiting — say approve to confirm, or cancel.' };
  }
  if (state === 'AWAITING_CONFIRM_REJECT') {
    if (command === 'reject') return { state: 'IDLE', action: 'reject', utterance: 'Rejecting.' };
    if (command === 'cancel' || command === 'approve') return { state: 'IDLE', action: null, utterance: 'Cancelled.' };
    return { state: 'AWAITING_CONFIRM_REJECT', action: null, utterance: 'Still waiting — say reject to confirm, or cancel.' };
  }
  // IDLE (or any unrecognised state, treated as IDLE so a bad caller cannot wedge the tower).
  if (command === 'status') return { state: 'IDLE', action: 'status', utterance: null };
  if (command === 'repeat') return { state: 'IDLE', action: 'repeat', utterance: null };
  if (command === 'approve') {
    return hasPendingRun
      ? { state: 'AWAITING_CONFIRM_APPROVE', action: null, utterance: 'Say approve again to confirm.' }
      : { state: 'IDLE', action: null, utterance: 'Nothing pending to approve.' };
  }
  if (command === 'reject') {
    return hasPendingRun
      ? { state: 'AWAITING_CONFIRM_REJECT', action: null, utterance: 'Say reject again to confirm.' }
      : { state: 'IDLE', action: null, utterance: 'Nothing pending to reject.' };
  }
  if (command === 'cancel') return { state: 'IDLE', action: null, utterance: 'Nothing to cancel.' };
  return { state: 'IDLE', action: null, utterance: "Didn't catch that. Say status, approve, or reject." };
}

/** Ties the pure reducer to real (or test-double) I/O. `deps`:
 *  - `hasPendingRun()` — reads whatever the caller considers "a run currently awaiting
 *    approval" (in the browser: `currentWorkspaceRun?.status === 'PENDING_APPROVAL'`).
 *  - `statusSnapshot()` — returns the object `buildStatusUtterance` expects.
 *  - `runAction(kind)` — `'approve'` | `'reject'`, expected to call the SAME
 *    `runWorkspaceAction` the visible buttons already call: this orchestrator invents no
 *    new way to reach the product, only a new way to say an existing one.
 *  - `speak(text)` — side effect, e.g. `speechSynthesis.speak(...)`.
 *  - `onTranscript(entry)` — optional, called with `{heard, confidence, matched,
 *    utterance, state}` after every heard phrase, for a visible transcript log —
 *    accessibility: the spoken response must not be the only channel. */
export function createVoiceControlTower(deps) {
  const { hasPendingRun, statusSnapshot, runAction, speak, onTranscript = () => {} } = deps;
  let state = 'IDLE';
  let lastUtterance = null;

  function say(text) {
    if (!text) return;
    lastUtterance = text;
    speak(text);
  }

  function handleTranscript(transcript, confidence) {
    const command = matchVoiceCommand(transcript, confidence);
    const step = nextVoiceState({ state, command, hasPendingRun: Boolean(hasPendingRun()) });
    state = step.state;
    if (step.action === 'status') say(buildStatusUtterance(statusSnapshot()));
    else if (step.action === 'repeat') say(lastUtterance ?? 'Nothing to repeat.');
    else if (step.action === 'approve' || step.action === 'reject') { say(step.utterance); runAction(step.action); }
    else say(step.utterance);
    onTranscript({ heard: transcript, confidence, matched: command, utterance: lastUtterance, state });
    return state;
  }

  return { handleTranscript, getState: () => state };
}

/** The one piece not exercised by pure unit tests: a real `SpeechRecognition`/
 *  `speechSynthesis` pair only exists in a browser with a speech engine behind it
 *  (missing in this project's own headless E2E — see the header comment). `win` defaults
 *  to the global `window` so a test can inject a fake one instead; feature detection
 *  (`!Ctor`) IS exercised that way, so "voice control is unavailable" is a tested path
 *  even though actually recognising a spoken word is not — the same class of gap
 *  `tools/tui-client.mjs`'s own `wireFunctionKeys` discloses for a real TTY. */
export function initVoiceControl(actions, win = typeof window !== 'undefined' ? window : undefined) {
  const Ctor = win?.SpeechRecognition || win?.webkitSpeechRecognition;
  if (!Ctor || !win?.speechSynthesis || !win?.SpeechSynthesisUtterance) return { available: false, tower: null, recognition: null };
  const recognition = new Ctor();
  recognition.continuous = true;
  recognition.interimResults = false;
  recognition.lang = 'en-US';
  const tower = createVoiceControlTower({
    ...actions,
    speak: (text) => win.speechSynthesis.speak(new win.SpeechSynthesisUtterance(text)),
  });
  recognition.onresult = (event) => {
    const result = event.results[event.results.length - 1];
    const alt = result[0];
    tower.handleTranscript(alt.transcript, alt.confidence);
  };
  return { available: true, tower, recognition };
}
