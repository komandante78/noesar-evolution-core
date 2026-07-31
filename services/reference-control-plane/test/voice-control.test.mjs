// SPDX-License-Identifier: AGPL-3.0-or-later
// D-0270 (Block D3c): voice as a control tower (D-0123), not an assistant — say the status
// without looking, approve/reject an already-computed plan hands-free, never widen what
// the product will do. This file proves the pure reducer/orchestrator against fakes for
// SpeechRecognition/speechSynthesis; the real Web Speech objects are exercised nowhere in
// this suite, same disclosed gap as `tui-client.mjs`'s own `wireFunctionKeys` for a real
// TTY — see voice-control.js's header comment.

import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  VOICE_VOCABULARY, matchVoiceCommand, buildStatusUtterance, nextVoiceState,
  createVoiceControlTower, initVoiceControl,
} from '../../../apps/webui-static/voice-control.js';

describe('matchVoiceCommand — fixed vocabulary only, never a fuzzy match', () => {
  test('every vocabulary word matches itself, case- and whitespace-insensitive', () => {
    for (const word of VOICE_VOCABULARY) {
      assert.equal(matchVoiceCommand(word, 1), word);
      assert.equal(matchVoiceCommand(`  ${word.toUpperCase()}  `, 1), word);
    }
  });

  test('below the confidence threshold, a perfectly-spelled word is still refused', () => {
    assert.equal(matchVoiceCommand('approve', 0.59), null);
    assert.equal(matchVoiceCommand('approve', 0.6), 'approve');
  });

  test('a phrase that merely contains a vocabulary word is not a match — no partial credit', () => {
    assert.equal(matchVoiceCommand('please approve this', 1), null);
    assert.equal(matchVoiceCommand('approved', 1), null);
    assert.equal(matchVoiceCommand('', 1), null);
    assert.equal(matchVoiceCommand(undefined, 1), null);
  });
});

describe('buildStatusUtterance — the same fields the TUI/browser status line already has, never invented', () => {
  test('no run at all', () => {
    assert.equal(buildStatusUtterance({}), 'No plan pending.');
    assert.equal(buildStatusUtterance(), 'No plan pending.');
  });

  test('pending approval carries risk/confidence/file count', () => {
    assert.equal(
      buildStatusUtterance({ status: 'PENDING_APPROVAL', risk: 'low', confidence: 0.82, fileCount: 3 }),
      'Plan pending approval. Risk low. Confidence 82 percent. 3 files.',
    );
    assert.equal(
      buildStatusUtterance({ status: 'PENDING_APPROVAL', fileCount: 1 }),
      'Plan pending approval. Risk unknown. Confidence unknown percent. 1 file.',
    );
  });

  test('every terminal status has its own fixed sentence', () => {
    assert.equal(buildStatusUtterance({ status: 'PROMOTED' }), 'Approved and promoted.');
    assert.equal(buildStatusUtterance({ status: 'REFUSED' }), 'Approved, but not promoted. Check the Shadow panel.');
    assert.equal(buildStatusUtterance({ status: 'REJECTED' }), 'Rejected.');
    assert.equal(buildStatusUtterance({ status: 'RESTORED' }), 'Restored — the promoted files were reverted.');
  });
});

describe('nextVoiceState — repeated confirmation to act, immediate revocation to cancel, never a guess', () => {
  test('approve with nothing pending refuses rather than confirming a phantom run', () => {
    const step = nextVoiceState({ state: 'IDLE', command: 'approve', hasPendingRun: false });
    assert.deepEqual(step, { state: 'IDLE', action: null, utterance: 'Nothing pending to approve.' });
  });

  test('approve with a pending run asks for confirmation instead of executing', () => {
    const step = nextVoiceState({ state: 'IDLE', command: 'approve', hasPendingRun: true });
    assert.equal(step.state, 'AWAITING_CONFIRM_APPROVE');
    assert.equal(step.action, null);
  });

  test('a second "approve" while awaiting confirmation executes', () => {
    const step = nextVoiceState({ state: 'AWAITING_CONFIRM_APPROVE', command: 'approve', hasPendingRun: true });
    assert.deepEqual(step, { state: 'IDLE', action: 'approve', utterance: 'Approving.' });
  });

  test('"cancel" while awaiting confirmation revokes immediately — no second cancel needed', () => {
    const step = nextVoiceState({ state: 'AWAITING_CONFIRM_APPROVE', command: 'cancel', hasPendingRun: true });
    assert.deepEqual(step, { state: 'IDLE', action: null, utterance: 'Cancelled.' });
  });

  test('saying the OTHER action word while awaiting confirmation is treated as revocation, not a second action', () => {
    const step = nextVoiceState({ state: 'AWAITING_CONFIRM_APPROVE', command: 'reject', hasPendingRun: true });
    assert.deepEqual(step, { state: 'IDLE', action: null, utterance: 'Cancelled.' });
  });

  test('unmatched/low-confidence input while awaiting confirmation re-asks — it repeats, it does not guess', () => {
    const step = nextVoiceState({ state: 'AWAITING_CONFIRM_APPROVE', command: null, hasPendingRun: true });
    assert.equal(step.state, 'AWAITING_CONFIRM_APPROVE');
    assert.equal(step.action, null);
    assert.match(step.utterance, /Still waiting/);
  });

  test('reject follows the identical shape, independently of approve', () => {
    const ask = nextVoiceState({ state: 'IDLE', command: 'reject', hasPendingRun: true });
    assert.equal(ask.state, 'AWAITING_CONFIRM_REJECT');
    const confirm = nextVoiceState({ state: 'AWAITING_CONFIRM_REJECT', command: 'reject', hasPendingRun: true });
    assert.deepEqual(confirm, { state: 'IDLE', action: 'reject', utterance: 'Rejecting.' });
  });

  test('status and repeat never touch state, from IDLE', () => {
    assert.deepEqual(nextVoiceState({ state: 'IDLE', command: 'status', hasPendingRun: true }), { state: 'IDLE', action: 'status', utterance: null });
    assert.deepEqual(nextVoiceState({ state: 'IDLE', command: 'repeat', hasPendingRun: false }), { state: 'IDLE', action: 'repeat', utterance: null });
  });
});

describe('createVoiceControlTower — the orchestrator, exercised end to end with fake I/O', () => {
  function stubs({ hasPendingRun = false, snapshot = {} } = {}) {
    const spoken = [];
    const ranActions = [];
    const transcripts = [];
    const tower = createVoiceControlTower({
      hasPendingRun: () => hasPendingRun,
      statusSnapshot: () => snapshot,
      runAction: (kind) => ranActions.push(kind),
      speak: (text) => spoken.push(text),
      onTranscript: (entry) => transcripts.push(entry),
    });
    return { tower, spoken, ranActions, transcripts };
  }

  test('"status" speaks the snapshot sentence and calls no action', () => {
    const { tower, spoken, ranActions } = stubs({ snapshot: { status: 'REJECTED' } });
    tower.handleTranscript('status', 1);
    assert.deepEqual(spoken, ['Rejected.']);
    assert.equal(ranActions.length, 0);
  });

  test('"repeat" with nothing said yet is honest about having nothing to repeat', () => {
    const { tower, spoken } = stubs();
    tower.handleTranscript('repeat', 1);
    assert.deepEqual(spoken, ['Nothing to repeat.']);
  });

  test('"repeat" after a status query re-speaks the exact same sentence', () => {
    const { tower, spoken } = stubs({ snapshot: { status: 'PROMOTED' } });
    tower.handleTranscript('status', 1);
    tower.handleTranscript('repeat', 1);
    assert.deepEqual(spoken, ['Approved and promoted.', 'Approved and promoted.']);
  });

  test('the full approve flow: ask, confirm, execute — runAction only fires after the second "approve"', () => {
    const { tower, spoken, ranActions } = stubs({ hasPendingRun: true });
    tower.handleTranscript('approve', 1);
    assert.equal(ranActions.length, 0, 'must not execute on the first utterance');
    assert.deepEqual(spoken, ['Say approve again to confirm.']);
    tower.handleTranscript('approve', 1);
    assert.deepEqual(ranActions, ['approve']);
    assert.deepEqual(spoken, ['Say approve again to confirm.', 'Approving.']);
  });

  test('an unrelated low-confidence utterance mid-confirmation never triggers runAction', () => {
    const { tower, ranActions } = stubs({ hasPendingRun: true });
    tower.handleTranscript('approve', 1);
    tower.handleTranscript('mumble', 0.9); // not in the vocabulary at all
    tower.handleTranscript('yes', 0.9); // also not in the vocabulary
    assert.equal(ranActions.length, 0);
    assert.equal(tower.getState(), 'AWAITING_CONFIRM_APPROVE');
  });

  test('onTranscript receives one entry per heard phrase, carrying the resulting state', () => {
    const { tower, transcripts } = stubs({ hasPendingRun: true });
    tower.handleTranscript('approve', 1);
    assert.equal(transcripts.length, 1);
    assert.equal(transcripts[0].heard, 'approve');
    assert.equal(transcripts[0].matched, 'approve');
    assert.equal(transcripts[0].state, 'AWAITING_CONFIRM_APPROVE');
  });
});

describe('initVoiceControl — feature detection is the one path this suite can exercise for real', () => {
  test('no SpeechRecognition on the window: declared unavailable, no tower created', () => {
    const result = initVoiceControl({ hasPendingRun: () => false, statusSnapshot: () => ({}), runAction: () => {} }, {});
    assert.deepEqual(result, { available: false, tower: null, recognition: null });
  });

  test('a full fake Web Speech pair: recognition.onresult reaches the tower with transcript+confidence', () => {
    let capturedUtterance = null;
    class FakeUtterance { constructor(text) { this.text = text; } }
    const fakeWin = {
      SpeechRecognition: class { constructor() { this.continuous = false; this.interimResults = true; this.lang = ''; } },
      speechSynthesis: { speak: (utterance) => { capturedUtterance = utterance; } },
      SpeechSynthesisUtterance: FakeUtterance,
    };
    const ranActions = [];
    const result = initVoiceControl({
      hasPendingRun: () => true, statusSnapshot: () => ({ status: 'PENDING_APPROVAL', fileCount: 2 }), runAction: (kind) => ranActions.push(kind),
    }, fakeWin);
    assert.equal(result.available, true);
    assert.equal(result.recognition.continuous, true, 'continuous mode is forced on, regardless of the constructor default');
    result.recognition.onresult({ results: [[{ transcript: 'status', confidence: 1 }]] });
    assert.ok(capturedUtterance instanceof FakeUtterance);
    assert.match(capturedUtterance.text, /Plan pending approval/);
  });
});
