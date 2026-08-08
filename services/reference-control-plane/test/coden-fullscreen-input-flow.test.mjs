// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The row that was missing while the full-screen terminal accepted no keystroke at all.
//
// `runFullScreen` was painted correctly on a real terminal from 2026-08-04 (`7f0f541`) and
// never received a single key. The cause is one line in the CALLER: `tui-client.mjs` does
// `iface.pause()` before handing over, which sets `readableFlowing = false` on stdin ON
// PURPOSE. `emitKeypressEvents` attaches with `.on('data')`, and Node resumes on that listener
// only `if (state.flowing !== false)` — so an explicitly paused stream stays paused, nothing is
// decoded, and `keypress` never fires. Raw mode is taken, the alternate screen is entered, the
// frame is drawn: everything looks right except that no byte ever moves.
//
// Why four green suites could not see it, and this is the point of the file: EVERY existing
// caller of `runFullScreen` in the tests injects a bare `EventEmitter` as `input` and emits
// `keypress` on it by hand (`ce-020`'s `fakeTerminal().press`, `coden-shell-parity`'s
// `input.emit('keypress', …)`). That drives the LAST link of the chain. The broken link is the
// one before it — carrying bytes from a real stream as far as `emitKeypressEvents`. An
// EventEmitter has no `readableFlowing`, no `pause` and no `resume`: the state that breaks the
// product cannot be represented in the double, so no assertion over it could ever fail.
//
// So the input here is a REAL stream, paused exactly the way the caller pauses it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

import { runFullScreen } from '../../../tools/tui-fullscreen.mjs';

const settle = () => new Promise((resolve) => setTimeout(resolve, 30));
const plain = (text) => String(text).replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '');
// Written as an escape on purpose: a raw control byte sitting in a source file is invisible
// to whoever reads it next, and this one is load-bearing.
const CTRL_C = "\u0003";

// Answers only what the surface asks for on open. Anything else returns `{}` — this file is
// about the input path, not about what a command replies.
const stubSession = () => ({
  call: async (method) => {
    if (method === 'coden.addresses') return { addresses: [], accessFiltered: false };
    if (method === 'coden.gitStatus') return { available: false };
    if (method === 'status') return { shadow: {}, capability: {} };
    return {};
  },
});

const captureOut = () => {
  const out = new EventEmitter();
  out.columns = 100; out.rows = 30; out.isTTY = false;
  out.frames = [];
  out.write = (chunk) => { out.frames.push(plain(chunk)); return true; };
  out.off = out.removeListener.bind(out);
  return out;
};

const realStream = () => {
  const input = new PassThrough();
  input.isTTY = false; input.isRaw = false;
  return input;
};

// A HANG IS NOT A FAILURE, and here the difference is not academic. `runFullScreen` resolves
// only when the shell is LEFT, and the only way to leave is a keystroke — so a regression in
// the input path does not make these tests fail, it makes them STOP, and `node:test` then
// reports the siblings as `cancelledByParent`. That reads like three broken rows instead of the
// one real one, and buries the assertion that actually diagnoses the fault. Measured against
// the shipped code: exactly that happened.
//
// So every wait runs against a deadline, and every test tears the shell down in a `finally`
// through the HAND-EMITTED path, which no pause can stop. A stuck input path then produces one
// honest failure and three honest passes.
const DEADLINE_MS = 4000;
const within = (promise, label, ms = DEADLINE_MS) => {
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label}: nothing within ${ms}ms — the input path is stuck`)), ms);
  });
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer));
};
const teardown = async (finished, input) => {
  input.emit('keypress', CTRL_C, { name: 'c', ctrl: true });
  await within(finished, 'teardown').catch(() => {});
};

test('a keystroke reaches the shell on a stream the caller had paused', async () => {
  const out = captureOut();
  // A real duplex stream, not an EventEmitter: `readableFlowing`, `pause` and `resume` are the
  // three things the double cannot have and the product depends on.
  const input = realStream();

  // Exactly what `tui-client.mjs` does before handing the terminal over.
  input.pause();
  assert.equal(input.readableFlowing, false, 'precondition: the caller paused the stream');

  const finished = runFullScreen({ session: stubSession(), status: {}, account: null, out, input });
  try {
    await settle();
    input.write('map');
    await settle();
    assert.match(out.frames.at(-1) ?? '', /> map/, 'the typed characters must reach the prompt');

    // Leaving is driven through the same byte path, so the flow is proved live for control
    // keys too and not only for printable ones.
    input.write(CTRL_C);
    await within(finished, 'ctrl-c written to the paused stream');
  } finally {
    await teardown(finished, input);
  }
});

test('leaving gives a paused stream back paused', async () => {
  const input = realStream();
  input.pause();
  const finished = runFullScreen({ session: stubSession(), status: {}, account: null, out: captureOut(), input });
  try {
    await settle();
    input.write(CTRL_C);
    await within(finished, 'ctrl-c written to the paused stream');
    assert.equal(input.readableFlowing, false, 'a caller that paused stdin gets it back paused');
  } finally {
    await teardown(finished, input);
  }
});

test('a stream nobody paused is not handed back paused', async () => {
  const input = realStream();
  // `readableFlowing` is `null` before anything has ever read the stream, and `null` is not
  // `false`. A restore written as `if (!wasFlowing) input.pause()` would pause a stream nobody
  // had paused — this is the row that says so.
  assert.equal(input.readableFlowing, null, 'precondition: never read, never paused');
  const finished = runFullScreen({ session: stubSession(), status: {}, account: null, out: captureOut(), input });
  try {
    await settle();
    input.write(CTRL_C);
    await within(finished, 'ctrl-c written to an untouched stream');
    assert.notEqual(input.readableFlowing, false, 'a stream nobody paused must not come back paused');
  } finally {
    await teardown(finished, input);
  }
});

test('an injected EventEmitter still works — the acceptance harnesses are not broken by this', async () => {
  const out = captureOut();
  const input = new EventEmitter();
  input.isTTY = false; input.isRaw = false;
  input.off = input.removeListener.bind(input);

  const finished = runFullScreen({ session: stubSession(), status: {}, account: null, out, input });
  try {
    await settle();
    for (const character of 'map') input.emit('keypress', character, { name: character });
    await settle();
    assert.match(out.frames.at(-1) ?? '', /> map/, 'the hand-emitted keypress path must keep working');
  } finally {
    await teardown(finished, input);
  }
});
