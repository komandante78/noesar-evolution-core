// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The browser terminal's pure parts, tested without a browser.
//
// `D-0413` slice 3 puts `apps/webui-static/coden-terminal.js` between xterm.js and the slice-2
// bridge. Most of that file is lifecycle — sockets, observers, timers — and is honestly only
// provable in a real browser, which is `[UNVERIFIED]` until a browser drives it. What IS
// provable here are the three decisions it makes on its own, and they are the three that would
// be hardest to notice going wrong:
//
//   `decodeInput`   bytes -> intent. Wrong here and the terminal prints `^[[5~` at people, or
//                   silently swallows Enter. xterm gives raw bytes; readline gives the other
//                   shell parsed keypresses. This is the ONE place the two shells legitimately
//                   differ, so it is the one place that needs its own oracle.
//   `geometryFor`   a box and a cell -> columns and rows. Wrong here and the server is asked
//                   for a viewport of `Infinity` columns, or the frame is clipped by the
//                   emulator rather than laid out for it.
//   `bridgeUrl`     the page's location -> the socket URL. Wrong here and an installation
//                   behind TLS opens `ws:` from an `https:` page, which browsers refuse as
//                   mixed content — an outage that appears only on the deployments that took
//                   security seriously.
//
// Imported directly, with no DOM: those three are exported precisely so they can be. The module
// also imports xterm.js at load, so this file imports the FUNCTIONS through a source read rather
// than executing the module — see below.

import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const source = readFileSync(join(repoRoot, 'apps/webui-static/coden-terminal.js'), 'utf8');

// The three pure decisions live in their own module — `apps/shared/coden/terminal-input.mjs`
// — precisely so this file can import them. `coden-terminal.js` itself imports 345 KB of xterm
// at module load, which touches `document`, so it cannot be imported under Node; the first
// version of this test lifted the functions out by balancing braces over its source text, which
// is a parser nobody asked for. It latched onto a DESTRUCTURED PARAMETER's brace instead of the
// function body and silently produced invalid JavaScript. Splitting the module was the fix, and
// it is the better design anyway: pure logic apart from browser-bound lifecycle.
import * as pure from '../../../apps/shared/coden/terminal-input.mjs';

describe('decodeInput — bytes to intent, the one place the two shells differ', () => {
  test('Enter submits, in both forms a terminal can send', () => {
    assert.equal(pure.decodeInput('\r').kind, 'submit');
    assert.equal(pure.decodeInput('\n').kind, 'submit');
  });

  test('the two backspace bytes both erase', () => {
    // DEL (0x7f) is what most terminals send; BS (0x08) is what some send. A shell that handles
    // only one has a backspace key that works on the author's machine.
    assert.equal(pure.decodeInput('\x7f').kind, 'backspace');
    assert.equal(pure.decodeInput('\b').kind, 'backspace');
  });

  test('the control keys that have a binding are decoded, each to its own intent', () => {
    assert.equal(pure.decodeInput('\x1b').kind, 'escape');
    assert.equal(pure.decodeInput('\x03').kind, 'interrupt');
    assert.equal(pure.decodeInput('\x0c').kind, 'clear');
    assert.equal(pure.decodeInput('\x15').kind, 'kill-line');
  });

  test('the arrow keys are decoded and never reach the prompt as text', () => {
    assert.equal(pure.decodeInput('\x1b[A').kind, 'up');
    assert.equal(pure.decodeInput('\x1b[B').kind, 'down');
    assert.equal(pure.decodeInput('\x1b[C').kind, 'right');
    assert.equal(pure.decodeInput('\x1b[D').kind, 'left');
  });

  test('tab completes the menu highlight and is never inserted as a character', () => {
    assert.equal(pure.decodeInput('\t').kind, 'tab');
  });

  test('an escape sequence with no binding is IGNORED, not inserted', () => {
    // The defect this prevents, and it is a visible one: falling through to `text` would put
    // the raw bytes of Page Up into the prompt, and the terminal starts printing `^[[5~` at
    // whoever pressed it.
    for (const sequence of ['\x1b[5~', '\x1b[6~', '\x1b[1;5C', '\x1bOP', '\x1b[200~']) {
      assert.equal(pure.decodeInput(sequence).kind, 'ignore', `${JSON.stringify(sequence)} was not ignored`);
    }
  });

  test('an unbound C0 control is ignored rather than inserted', () => {
    for (const code of [0x00, 0x01, 0x07, 0x1a]) {
      assert.equal(pure.decodeInput(String.fromCharCode(code)).kind, 'ignore');
    }
  });

  test('ordinary text is text, including non-ASCII and pasted runs', () => {
    assert.deepEqual(pure.decodeInput('a'), { kind: 'text', text: 'a' });
    assert.deepEqual(pure.decodeInput('/plan'), { kind: 'text', text: '/plan' });
    // A paste arrives as one chunk, not one byte per event.
    assert.deepEqual(pure.decodeInput('summarise the repo'), { kind: 'text', text: 'summarise the repo' });
    assert.deepEqual(pure.decodeInput('è'), { kind: 'text', text: 'è' });
    assert.deepEqual(pure.decodeInput('→'), { kind: 'text', text: '→' });
  });

  test('every intent it can return is one the input handler acts on', () => {
    // The seam that would rot silently: a decoder returning a kind nothing handles is a key
    // that does nothing, with no error anywhere. Read from the source of the handler itself.
    // Each side read from the file that OWNS it: the intents from the decoder's own module, the
    // handling from the client. Scanning `coden-terminal.js` for both — as the first version did
    // — swept up `{ kind: 'note' }` from the transcript, which is a different vocabulary that
    // happens to share a field name, and reported a real-looking failure about a key that does
    // not exist.
    const decoder = readFileSync(join(repoRoot, 'apps/shared/coden/terminal-input.mjs'), 'utf8');
    const kinds = new Set([...decoder.matchAll(/return \{ kind: '([a-z-]+)'/g)].map((match) => match[1]));
    const handled = new Set(['ignore']); // returned early, deliberately
    for (const match of source.matchAll(/intent\.kind === '([a-z-]+)'/g)) handled.add(match[1]);
    // The grouped form too — the arrows share one branch, and a check that only understood
    // `intent.kind === '…'` reported them unhandled when they were handled three lines above.
    // Recognising both spellings is the fix; narrowing the CODE to suit the CHECK would have
    // been the tail wagging the dog.
    for (const match of source.matchAll(/\[((?:\s*'[a-z-]+',?)+)\]\.includes\(intent\.kind\)/g)) {
      for (const name of match[1].matchAll(/'([a-z-]+)'/g)) handled.add(name[1]);
    }
    for (const kind of kinds) {
      assert.ok(handled.has(kind), `decodeInput can return '${kind}' and nothing acts on it: that key does nothing`);
    }
    assert.ok(kinds.size >= 8, `the scan found ${kinds.size} intents; it is not reading the real decoder`);
  });
});

describe('geometryFor — the region, never the viewport', () => {
  test('columns and rows come out of the box divided by the cell', () => {
    assert.deepEqual(pure.geometryFor({ width: 800, height: 480, cellWidth: 8, cellHeight: 16 }),
      { columns: 100, rows: 30 });
  });

  test('an unmeasured cell falls back instead of dividing by zero', () => {
    // The real case, not a hypothetical: the host is `display:none` until CodeN is the active
    // destination, and xterm has measured nothing. Dividing by 0 gives Infinity, and the client
    // would ask the server for a viewport of Infinity columns.
    for (const cell of [{}, { cellWidth: 0, cellHeight: 16 }, { cellWidth: 8, cellHeight: 0 },
      { cellWidth: NaN, cellHeight: 16 }, { cellWidth: undefined, cellHeight: undefined }]) {
      const geometry = pure.geometryFor({ width: 800, height: 480, ...cell });
      assert.deepEqual(geometry, { columns: 80, rows: 24 }, `${JSON.stringify(cell)} did not fall back`);
      assert.ok(Number.isFinite(geometry.columns) && Number.isFinite(geometry.rows));
    }
  });

  test('a tiny region clamps to what the renderer itself clamps to', () => {
    // `renderFrame` clamps to 40x10. Asking for less would have the emulator clip a frame that
    // was laid out for a bigger box, rather than laying one out for the box there is.
    const geometry = pure.geometryFor({ width: 100, height: 40, cellWidth: 8, cellHeight: 16 });
    assert.equal(geometry.columns, 40);
    assert.equal(geometry.rows, 10);
  });

  test('the result is always whole numbers', () => {
    const geometry = pure.geometryFor({ width: 803.7, height: 481.3, cellWidth: 8.4, cellHeight: 16.2 });
    assert.ok(Number.isInteger(geometry.columns) && Number.isInteger(geometry.rows),
      'a fractional geometry was sent: the bridge validates integers and would refuse it');
  });
});

describe('bridgeUrl — the scheme follows the page, or the browser refuses it', () => {
  test('an https page gets wss, and an http page gets ws', () => {
    // Mixed content: a `ws:` socket opened from an `https:` page is blocked by every browser.
    // The failure appears ONLY on installations that configured TLS, which are the ones least
    // likely to be the machine this was developed on.
    assert.equal(pure.bridgeUrl({ protocol: 'https:', host: 'box.example:8443' }), 'wss://box.example:8443/ws/coden');
    assert.equal(pure.bridgeUrl({ protocol: 'http:', host: '127.0.0.1:8088' }), 'ws://127.0.0.1:8088/ws/coden');
  });

  test('the host is taken from the page, never configured', () => {
    // Self-hosted: this product runs under whatever host the Owner reaches it on. A configured
    // URL is wrong on every installation but the one it was written for — and it is also what
    // keeps the server's Origin check satisfiable, since both derive from the same request.
    assert.match(pure.bridgeUrl({ protocol: 'http:', host: 'nas.local' }), /^ws:\/\/nas\.local\/ws\/coden$/);
    assert.doesNotMatch(source, /ws:\/\/localhost|wss:\/\/localhost|ws:\/\/127\.0\.0\.1/,
      'a hard-coded socket host is in the client');
  });

  test('the path is the one the bridge actually serves', () => {
    const bridge = readFileSync(join(repoRoot, 'services/reference-control-plane/src/coden-bridge.mjs'), 'utf8');
    const served = bridge.match(/export const BRIDGE_PATH = '([^']+)'/)?.[1];
    assert.ok(served, 'the bridge no longer declares its path');
    assert.ok(pure.bridgeUrl({ protocol: 'http:', host: 'h' }).endsWith(served),
      `the client connects to a path the server does not serve (${served})`);
  });
});

describe('the client speaks the version the bridge speaks', () => {
  test('the protocol constant matches the bridge, exactly', () => {
    // The versioned envelope is only worth having if both ends agree on the value. Two
    // constants that drift are worse than none: the client would refuse every frame.
    const bridge = readFileSync(join(repoRoot, 'services/reference-control-plane/src/coden-bridge.mjs'), 'utf8');
    const server = bridge.match(/export const BRIDGE_PROTOCOL = '([^']+)'/)?.[1];
    const client = source.match(/const BRIDGE_PROTOCOL = '([^']+)'/)?.[1];
    assert.equal(client, server, 'the page and the bridge disagree about the protocol version');
  });

  test('the client refuses an unknown protocol rather than half-reading it', () => {
    assert.match(source, /frame\.protocol !== BRIDGE_PROTOCOL/,
      'the client no longer checks the envelope version it was given');
  });

  test('it imports the renderer and the model, and defines neither', () => {
    // `CE-033`: the two shells must not diverge. The browser half may not grow its own frame
    // painter or its own idea of what a typed line means.
    assert.match(source, /from '\.\.\/shared\/coden\/tui-screen\.mjs'/, 'the browser does not use the shared renderer');
    assert.match(source, /from '\.\/coden-view-model\.js'/, 'the browser does not use the shared view model');
    assert.doesNotMatch(source, /function renderFrame\s*\(/, 'the browser has grown a second renderer');
    assert.doesNotMatch(source, /const AGENT_COMMANDS\s*=/, 'the browser has grown its own command list');
  });

  test('every draw hides the terminal cursor before positioning it', () => {
    // `tui-fullscreen.mjs` (the ssh shell) hides the real cursor ONCE, via `SCREEN.enter`,
    // before its draw loop starts — the caret a reader sees is the `›` `renderFrame` paints,
    // never the terminal's own. This shell mounts xterm.js directly (no `enter`/`leave`,
    // there is no alternate screen to enter) and used to never hide it at all: xterm's real
    // cursor stayed visible and parked wherever the last `write()` left it, which
    // `renderFrame` always right-pads to — the bottom-right cell of the box, every frame.
    // Reported live 2026-08-14: a stray cursor in the terminal's bottom-right corner.
    assert.match(source, /terminal\.write\(SCREEN\.hideCursor \+ SCREEN\.clear/,
      'draw() no longer hides the cursor before writing a frame — it will park visibly at the end of the last (padded) row');
  });

  test('every draw erases the screen rather than only homing the cursor', () => {
    // `F-TERM-002`, 2026-08-15: `SCREEN.home` alone (`\x1b[H`, no `\x1b[2J`) only REPOSITIONS
    // the cursor — it never erases what was there. With no alternate screen buffer entered
    // (see the test above), nothing guarantees a new frame lands exactly where the previous one
    // did, and when it does not, home-only leaves the old frame's content on screen instead of
    // overwriting it. Measured live: the browser e2e suite found five stale prompt-box
    // snapshots — one per keystroke of a five-character command — still on screen after the
    // line was submitted and the data model's prompt was already empty. `SCREEN.clear`
    // (`\x1b[2J\x1b[H`, defined in `tui-screen.mjs` and until this fix never used by this file)
    // erases the visible screen unconditionally before writing, so a frame cannot leave a trace
    // of the one before it regardless of where home lands.
    assert.doesNotMatch(source, /terminal\.write\([^)]*SCREEN\.hideCursor \+ SCREEN\.home\b/,
      'draw() went back to home-only, which can leave a stale frame on screen — see F-TERM-002');
  });
});
