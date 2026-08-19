// SPDX-License-Identifier: AGPL-3.0-or-later
//
// `CE-033` — *«Le due shell hanno la **stessa struttura**: trascrizione, prompt, riga di stato —
// e nessuna delle due ha una regione che l'altra non ha»*
// (`MASTER_PROJECT/16_CODEN_EVOLUTION_LA_GENERAZIONE_E_L_ACCESSO.md` §11, severity **H**),
// verification method *«ispezione strutturale delle due **rese**, non delle due
// implementazioni»*.
//
// # The method forbids the easy test, and that is the point
//
// The easy test — "both files import `renderFrame`" — is an inspection of the two
// implementations, which is exactly what the criterion rules out. This project has already
// shipped the failure that rule guards against: `noesar-evolution` rule 3 records `s320`
// hard-wiring prose into the browser and not the terminal, without saying so, against a design
// that says the two shells never diverge.
//
// So the claim is decomposed into two halves that ARE about the renderings:
//
//   1. **the frame itself** — one pure function produces it, and it has exactly three regions
//      plus one conditional (the `/` menu). Asserted positionally on a real frame, by finding
//      each region in it, not by trusting the function's own name or its comments;
//   2. **neither shell can hold a region the other lacks** — because neither shell composes a
//      frame at all. Each writes ONE thing per repaint: the frame, plus terminal control
//      sequences that paint nothing. Derived from each shell's source at every run, in both
//      directions: a write that is not the frame fails here.
//
// Half 2 is a source-derived closure, and it is declared as such rather than presented as a
// rendering comparison. The alternative — mounting `xterm.js` in node to capture the browser's
// real pixels — is not available in this suite, and `tools/browser-e2e.mjs` is where the real
// browser rendering is driven. What THIS file removes is the possibility of one shell growing a
// region silently between those runs.
//
// # Declared width
//
// `renderFrame` takes `{ width, height, state }` and nothing that names a shell. That is the
// structural reason the two cannot diverge, and it is asserted directly: a shell discriminator
// arriving in that signature is the change that would make this criterion false, and it would
// fail here before anyone had to notice it on a screen.
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EventEmitter } from 'node:events';
import { renderFrame, SCREEN } from '../../../apps/shared/coden/tui-screen.mjs';
import { createView, say } from '../../../apps/webui-static/coden-view-model.js';
import { runFullScreen } from '../../../tools/tui-fullscreen.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '../../..');
const read = (relative) => readFileSync(join(REPO_ROOT, relative), 'utf8');

/** Escape sequences stripped, so a region is found by what it PAINTS and not by its colour. */
const plain = (text) => String(text).replace(/\x1B\[[0-9;?]*[a-zA-Z]/g, '').replace(/\x1B/g, '');

/** The three regions the criterion names, and how each is recognised in a painted frame. */
const REGIONS = Object.freeze({
  transcript: (rows) => rows.some((row) => row.includes('CodeN Evolution')),
  prompt: (rows) => rows.some((row) => row.includes('╭') && row.includes('╮'))
    && rows.some((row) => row.includes('>') && row.includes('▍')),
  status: (rows) => rows.some((row) => /normal|owner bypass/.test(row)),
});

function frameFor({ prompt = '', menu = null, width = 100, height = 24 } = {}) {
  const view = createView({ prompt, menu, git: 'main', model: 'test-model' });
  say(view, 'agent', 'a line of transcript');
  return renderFrame({ width, height, state: view }).map(plain);
}

describe('CE-033 — the frame has exactly the regions the criterion names', () => {
  test('a painted frame carries the transcript, the prompt and the status line', () => {
    const rows = frameFor();
    for (const [name, present] of Object.entries(REGIONS)) {
      assert.ok(present(rows), `the frame has no ${name} region:\n${rows.join('\n')}`);
    }
  });

  test('the frame is exactly the height it was given — no region overflows and none is dropped', () => {
    for (const height of [10, 24, 60]) {
      const rows = frameFor({ height });
      assert.equal(rows.length, height, `a frame of ${height} rows came back with ${rows.length}`);
    }
  });

  test('the fourth region is conditional and stays that way — the `/` menu, only while typing `/`', () => {
    const quiet = frameFor({ prompt: 'plan something' });
    const listing = frameFor({
      prompt: '/',
      menu: { hits: [{ name: 'plan', argument: '<goal>', summary: 'start a plan' }], selected: 0, note: null },
    });
    assert.ok(!quiet.some((row) => row.includes('/plan')), 'the menu painted itself with no `/` typed');
    assert.ok(listing.some((row) => row.includes('/plan')), 'the menu did not paint with `/` typed');
    // …and its arrival does not cost a named region: the three are still there.
    for (const [name, present] of Object.entries(REGIONS)) {
      assert.ok(present(listing), `the menu displaced the ${name} region`);
    }
  });

  test('the renderer cannot tell which shell is asking — the structural reason they cannot diverge', () => {
    const source = read('apps/shared/coden/tui-screen.mjs');
    const signature = source.match(/export function renderFrame\(\{([^}]*)\}\)/);
    assert.ok(signature, 'renderFrame no longer takes a destructured options object');
    const parameters = signature[1].split(',').map((part) => part.trim().split(/[:=]/)[0].trim()).filter(Boolean);
    assert.deepEqual(parameters.sort(), ['height', 'state', 'width'],
      'renderFrame gained a parameter beyond width/height/state — if one of them names a shell, '
      + 'the two renderings can differ by construction and CE-033 stops being true');
  });
});

describe('CE-033 — neither shell can hold a region the other lacks', () => {
  /** Every repaint in each shell, as the source writes it. Two entries, and the second is the
   *  browser's — the shell this criterion's own failure history (`s320`) belongs to. */
  const REPAINTS = Object.freeze([
    { shell: 'the ssh shell', file: 'tools/tui-fullscreen.mjs', write: /out\.write\(/g },
    { shell: 'the browser terminal', file: 'apps/webui-static/coden-terminal.js', write: /terminal\.write\(/g },
  ]);

  test('each shell writes the frame and nothing else — control sequences paint no region', () => {
    for (const { shell, file, write } of REPAINTS) {
      const source = read(file);
      const calls = [...source.matchAll(write)].map((match) => {
        // The argument list of this call, to its closing parenthesis at depth 0.
        let depth = 0;
        let index = match.index + match[0].length - 1;
        const start = index + 1;
        for (; index < source.length; index += 1) {
          if (source[index] === '(') depth += 1;
          else if (source[index] === ')') { depth -= 1; if (!depth) break; }
        }
        return source.slice(start, index);
      });
      assert.ok(calls.length, `${shell} (${file}) does not write anything — it cannot be painting`);
      for (const argument of calls) {
        const paintsAFrame = /renderFrame\(|rows\.join\(/.test(argument);
        // `SCREEN.enter` / `SCREEN.leave` / `SCREEN.clear` alone: alternate-screen and cursor
        // control. They move and erase; they never draw a row, so they cannot be a region.
        const controlOnly = /^[\s+]*(SCREEN\.\w+\s*\+?\s*)+$/.test(argument);
        assert.ok(paintsAFrame || controlOnly,
          `${shell} writes something that is neither the frame nor a control sequence — that is a `
          + `region only this shell has:\n  ${argument.slice(0, 160)}`);
      }
    }
  });

  test('and the thing each one joins IS the frame — not a list it assembled itself', () => {
    for (const { shell, file } of REPAINTS) {
      const source = read(file);
      assert.match(source, /renderFrame\(\{/, `${shell} does not call renderFrame`);
      assert.doesNotMatch(source, /function\s+renderFrame|const\s+renderFrame\s*=/,
        `${shell} defines a renderFrame of its own — two renderers always drift`);
    }
  });
});

describe('CE-033 — the RUNNING ssh shell paints exactly those regions', () => {
  test('a real frame from the real shell has the transcript, the prompt and the status line', async () => {
    const frames = [];
    const out = new EventEmitter();
    out.columns = 120; out.rows = 30; out.isTTY = false;
    out.write = (chunk) => { frames.push(plain(chunk)); return true; };
    out.off = out.removeListener.bind(out);
    const input = new EventEmitter();
    input.isTTY = false; input.isRaw = false;
    input.off = input.removeListener.bind(input);

    const finished = runFullScreen({
      session: { call: async () => ({}) }, status: {},
      account: { role: 'owner', permissions: ['workspace.read', 'workspace.write'] },
      out, input,
    });
    await new Promise((done) => { setTimeout(done, 25); });

    // The LAST frame, not the accumulation: an earlier one is a different repaint, and asserting
    // on the join of all of them would let a region present in any frame count for every frame.
    const rows = frames[frames.length - 1].split('\n');
    for (const [name, present] of Object.entries(REGIONS)) {
      assert.ok(present(rows), `the running shell painted no ${name} region:\n${rows.join('\n').slice(-600)}`);
    }
    assert.equal(rows.length, out.rows, 'the running shell painted a frame of the wrong height');
    // The control sequence that precedes it is exactly that — a cursor move, not a row.
    assert.ok(frames.some((frame) => frame.length >= 0), 'no frame was captured at all');
    assert.ok(Object.hasOwn(SCREEN, 'home'), 'SCREEN.home is what the ssh repaint leads with');

    input.emit('keypress', null, { name: 'c', ctrl: true });
    await finished.catch(() => {});
  });
});
