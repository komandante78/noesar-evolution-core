// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The coding agent's terminal surface, and the slash commands both shells share.
//
// This suite tested a panel dashboard first — two framed regions, a bench, a navigator —
// because the surface was built from reading `07_INTERFACCIA.md` §4 as if it described the
// terminal. It does not: §4 is the WORKBENCH (the browser's page). The terminal shell is a
// coding agent, the shape Codex and Claude Code have, and the `/` that matters there is a
// command typed into the PROMPT — not the address box, which is navigation and lives in the
// browser's top bar. The two gestures are different and this file keeps them apart.
//
// Everything asserted below is a PURE function of a state object, which is why the renderer
// is split from the driver: a layout checkable only by looking at a terminal can be claimed,
// not proved.

import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  renderFrame, visibleWidth, clipToWidth, padToWidth, wrapLines, rawIndexAtWidth,
  transcriptRows, promptRows, commandMenuRows, footerText,
} from '../../../tools/tui-screen.mjs';
import {
  AGENT_COMMANDS, matchCommands, isCommandPrompt, parseCommandPrompt, resolveCommand,
} from '../../../apps/webui-static/agent-commands.js';

const ESC = '';
const paint = (text) => `${ESC}[38;5;71m${text}${ESC}[0m`;

const SAMPLE = {
  transcript: [
    { kind: 'user', text: 'fix the off-by-one in session.mjs' },
    { kind: 'agent', text: 'Read the file and prepared a plan.' },
    { kind: 'tool', text: 'Read(services/auth/session.mjs)', detail: ['141 lines'] },
  ],
  prompt: '',
  git: 'main ↑2', mode: 'NORMAL', model: 'Qwen2.5-Coder 7B', context: '38%',
  network: 'local-only', sourcedNote: '6/12 sourced',
};

describe('measurement is of visible columns, never of string length', () => {
  test('a painted string measures only its printable characters', () => {
    assert.equal(visibleWidth(paint('main')), 4);
    assert.ok(paint('main').length > 4);
  });

  test('clipping keeps escapes intact and closes with a reset', () => {
    const clipped = clipToWidth(paint('abcdef'), 3);
    assert.equal(visibleWidth(clipped), 3);
    assert.ok(clipped.endsWith(`${ESC}[0m`));
  });

  test('padding a painted string pads to visible width', () => {
    assert.equal(visibleWidth(padToWidth(paint('ab'), 10)), 10);
  });
});

describe('wrapping never cuts through an escape sequence', () => {
  // The defect this exists for: the first revision found the break position in the
  // escape-STRIPPED text and sliced the RAW text at that index — two different strings, so
  // every wrapped row came out cut through a colour code and the terminal printed the
  // fragments. Nothing was failing at the time; it was found by rendering and looking.
  test('every wrapped row contains only complete escape sequences', () => {
    const painted = Array.from({ length: 12 }, (_, i) => paint(`field${i}`)).join(' · ');
    for (const row of wrapLines([painted], 20)) {
      const stray = row.replace(/\[[0-9;?]*[A-Za-z]/g, '');
      assert.ok(!stray.includes(ESC), `bare ESC survived: ${JSON.stringify(row)}`);
    }
  });

  test('a word longer than the column is broken, never dropped', () => {
    const rows = wrapLines(['supercalifragilistic'], 8);
    assert.ok(rows.length > 1);
    assert.equal(rows.join(''), 'supercalifragilistic');
  });

  test('rawIndexAtWidth lands on an escape boundary, never inside one', () => {
    const source = `${ESC}[1mAB${ESC}[0mCD`;
    const cut = source.slice(0, rawIndexAtWidth(source, 3));
    assert.equal(visibleWidth(cut), 3);
  });
});

describe('the shell is an agent: a transcript, a prompt, a footer', () => {
  test('it fills the terminal it was given and never overflows it', () => {
    for (const [width, height] of [[60, 16], [96, 26], [200, 50]]) {
      const rows = renderFrame({ width, height, state: SAMPLE });
      assert.equal(rows.length, height, `${width}x${height}`);
      for (const row of rows) assert.ok(visibleWidth(row) <= width, `${width}x${height} overflowed`);
    }
  });

  test('there is a prompt box, and it is the same shape every frame', () => {
    const quiet = renderFrame({ width: 96, height: 26, state: SAMPLE }).join('\n');
    const typing = renderFrame({ width: 96, height: 26, state: { ...SAMPLE, prompt: 'a longer thing being typed' } }).join('\n');
    assert.ok(quiet.includes('╭') && quiet.includes('╰'), 'the prompt is a box');
    assert.equal(
      (quiet.match(/╭/g) ?? []).length,
      (typing.match(/╭/g) ?? []).length,
      'the box must not grow or move as the prompt fills',
    );
  });

  test('the newest turn sits just above the prompt, not against the ceiling', () => {
    // A short transcript pads at the TOP. Padding at the bottom — which the first version did
    // — strands the conversation at the ceiling and puts what you just said furthest from the
    // caret.
    const rows = renderFrame({ width: 96, height: 24, state: SAMPLE });
    const promptRow = rows.findIndex((row) => row.includes('╭'));
    const lastContent = rows.reduce((found, row, index) => (row.trim() && index < promptRow ? index : found), -1);
    assert.ok(promptRow > 0, 'a prompt box exists');
    assert.ok(promptRow - lastContent <= 2, `transcript ends ${promptRow - lastContent} rows above the prompt`);
  });

  test('a long transcript keeps its END, because that is the part being read', () => {
    const many = Array.from({ length: 200 }, (_, i) => ({ kind: 'agent', text: `turn ${i}` }));
    const rows = renderFrame({ width: 96, height: 20, state: { ...SAMPLE, transcript: many } }).join('\n');
    assert.ok(rows.includes('turn 199'), 'the newest turn must be on screen');
    assert.ok(!rows.includes('turn 0'), 'the oldest must have scrolled off');
  });

  test('tool lines are indented under the turn they belong to', () => {
    const rows = transcriptRows([{ kind: 'tool', text: 'Read(x.mjs)' }], 60);
    assert.ok(rows[0].startsWith('  '), 'a sub-step reads as a sub-step');
  });

  test('the footer carries state as one line, and omits what has no source', () => {
    assert.ok(footerText(SAMPLE).includes('main ↑2'));
    assert.ok(footerText(SAMPLE).includes('6/12 sourced'));
    const bare = footerText({ mode: 'NORMAL' });
    assert.ok(!bare.includes('—'), 'an absent field is omitted, never shown as a dash-filled slot');
  });

  test('owner bypass is named in words, not signalled by colour alone', () => {
    assert.ok(footerText({ ...SAMPLE, mode: 'OWNER_BYPASS' }).includes('owner bypass'));
  });
});

describe('the slash commands live in the prompt, and both shells share one list', () => {
  test('`/` opens a command only at the START of the prompt', () => {
    // A prompt is prose. `and/or`, or a path like `src/index.mjs`, must never turn into a
    // command menu mid-sentence — the gesture is the first character.
    assert.ok(isCommandPrompt('/plan'));
    assert.ok(!isCommandPrompt('rewrite src/index.mjs'));
    assert.ok(!isCommandPrompt('this and/or that'));
  });

  test('a partial word ranks starts-with above contains above prose', () => {
    const hits = matchCommands('st');
    assert.equal(hits[0].name, 'status', 'a name that starts with the word wins');
  });

  test('an empty word lists every command', () => {
    assert.equal(matchCommands('').length, AGENT_COMMANDS.length);
  });

  test('a partial command is NOT run — choosing and committing stay two acts', () => {
    assert.equal(resolveCommand('/pl'), null, '`/pl` must not silently become `/plan`');
    assert.equal(resolveCommand('/plan fix the thing').command.name, 'plan');
    assert.equal(resolveCommand('/plan fix the thing').argument, 'fix the thing');
  });

  test('the argument is everything after the command word, kept whole', () => {
    // Deliberately NOT split further here: `/reject <run> [why]` has two parts and `/plan
    // <goal>` has one, so a parser that guessed at the boundary would have to know each
    // command's shape. It hands the rest over intact and the command's own handler splits it.
    assert.deepEqual(parseCommandPrompt('/reject 4f2a  not what I asked'),
      { word: 'reject', argument: '4f2a  not what I asked' });
    assert.deepEqual(parseCommandPrompt('/status'), { word: 'status', argument: '' });
  });

  test('every entry names a real engine method, or is honestly not a call at all', () => {
    // An entry with a method that does not exist would render in the menu and fail on use.
    // Since phase 3a the menu is the whole product, so only the WORK entries name a method;
    // `null` on one of those means the shell answers it itself (`/help`, `/clear`), and an
    // entry of any other kind must not carry a method at all — a destination with a method
    // would be two ways of performing one line, and the shells would pick different ones.
    for (const command of AGENT_COMMANDS) {
      // A FORM names a method too (phase 3b): it is a call whose input needs more than one
      // line, not a different kind of destination.
      if (command.kind === 'call' || command.kind === 'shell' || command.kind === 'form') {
        assert.ok(command.method === null || typeof command.method === 'string',
          `\`/${command.name}\` has a method that is neither null nor a name`);
      } else {
        assert.equal(command.method, undefined, `\`/${command.name}\` is not a call but names a method`);
      }
      assert.ok(command.summary.length > 10, `\`/${command.name}\` needs a summary worth reading`);
    }
  });

  test('there is no command that executes arbitrary code', () => {
    // The executor refuses EXECUTE permanently and on purpose. A prompt is not a way around
    // that, and a shell that grew an `/exec` would be routing around its own engine.
    const names = AGENT_COMMANDS.map((c) => c.name);
    for (const forbidden of ['exec', 'run', 'shell', 'bash', 'sh', 'eval']) {
      assert.ok(!names.includes(forbidden), `\`/${forbidden}\` must not exist`);
    }
  });

  test('the menu shows the selected row with a glyph, not only a colour', () => {
    const rows = commandMenuRows({ hits: matchCommands('p'), selected: 1 }, 70);
    assert.ok(rows[1].includes('▸'), 'selection must survive a monochrome terminal');
  });

  test('the menu is only drawn while the prompt is a command', () => {
    const prose = renderFrame({ width: 96, height: 24, state: { ...SAMPLE, prompt: 'just words', menu: null } }).join('\n');
    const command = renderFrame({ width: 96, height: 24, state: { ...SAMPLE, prompt: '/pl', menu: { hits: matchCommands('pl'), selected: 0 } } }).join('\n');
    assert.ok(!prose.includes('/plan'));
    assert.ok(command.includes('/plan'));
  });

  test('a word matching nothing says so instead of showing an empty menu', () => {
    assert.ok(commandMenuRows({ hits: [], selected: 0 }, 60).join('\n').includes('no command matches'));
  });
});

describe('the prompt keeps the caret visible', () => {
  test('a prompt longer than the box shows its tail, not its head', () => {
    const long = 'x'.repeat(400);
    const rows = promptRows(long, 60).join('\n');
    assert.ok(visibleWidth(rows.split('\n')[1]) <= 60);
    assert.ok(rows.includes('▍'), 'the caret must stay on screen while typing');
  });
});
