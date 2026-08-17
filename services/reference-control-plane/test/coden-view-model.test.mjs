// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Phase 2 of `MASTER_PROJECT/17_CODEN_EVOLUTION_PIANO_DI_LAVORO.md`.
//
// What this defends is not a function: it is the property that ONE description of a session
// exists. Phase 1 repaired a drift that happened because two shells each held their own answer
// and nothing compared them. Extracting the model only helps if a shell cannot quietly grow a
// second one, so the last describe here reads the shells' own source and fails when it does.

import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  AGENT_COMMANDS, parseCommandPrompt, resolveCommand,
} from '../../../apps/shared/coden/agent-commands.js';
import {
  RUN, createView, say, planTurn, detailLines, gitSummary,
  TRANSCRIPT_KINDS, OPENING_NOTE, DETAIL_LINES, FORMS, addressEntries, requiresArgument, panelOwning,
} from '../../../apps/webui-static/coden-view-model.js';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '../../..');
const read = (relative) => readFileSync(join(repoRoot, relative), 'utf8');

const deps = { resolve: resolveCommand, parse: parseCommandPrompt, commands: AGENT_COMMANDS };

describe('the view model — what a session looks like, decided once', () => {
  test('a new view opens with the transcript, the prompt and no menu', () => {
    const view = createView();
    assert.deepEqual(view.transcript, [{ kind: 'note', text: OPENING_NOTE }]);
    assert.equal(view.prompt, '');
    assert.equal(view.menu, null);
  });

  test('an unknown transcript kind throws instead of rendering as blank', () => {
    // The failure this prevents: a shell inventing a fifth kind, and the other shell showing
    // an empty row for it. Loud here, invisible there.
    const view = createView();
    assert.throws(() => say(view, 'warning', 'x'), /unknown transcript kind/);
    for (const kind of TRANSCRIPT_KINDS) assert.doesNotThrow(() => say(view, kind, 'x'));
  });

  test('every entry in the shared registry can actually be performed', () => {
    // The registry and the call map are two lists; this is the only thing that keeps them
    // consistent. Phase 3a made the registry the WHOLE menu — work, applications, configure,
    // session — so "has an engine call" stopped being the right question for every entry and
    // became the right question for the WORK ones. Each other kind is checked for what IT
    // needs, which makes this stricter than before rather than looser: every kind must declare
    // something a shell can act on, and an entry with a kind nobody handles fails outright.
    for (const command of AGENT_COMMANDS) {
      if (command.kind === 'call') {
        assert.ok(RUN[command.name], `\`/${command.name}\` is offered but has no engine call`);
      } else if (command.kind === 'address') {
        assert.ok(command.address, `\`/${command.name}\` is a destination with no address`);
      } else if (command.kind === 'form') {
        // A form declares BOTH: the method it ends at and the field script that gets there.
        assert.ok(command.method, `\`/${command.name}\` is a form with no method to submit to`);
        assert.ok(FORMS[command.name]?.fields?.length, `\`/${command.name}\` is a form with no fields`);
      } else if (command.kind === 'session') {
        assert.ok(command.action, `\`/${command.name}\` is a session entry with no action`);
      } else {
        assert.equal(command.kind, 'shell', `\`/${command.name}\` has an unknown kind \`${command.kind}\``);
        // `help` and `clear` — answered by planTurn itself, so they own no method and no
        // address. Named explicitly: "the shell answers it" is a claim planTurn has to honour,
        // and a third entry making it would go silently unanswered.
        assert.ok(['help', 'clear'].includes(command.name),
          `\`/${command.name}\` says the shell answers it, but planTurn answers only help and clear`);
      }
    }
  });

  test('`/plan <prose>` sends the sentence and an empty file list', () => {
    // Phase 1's property, now stated where both shells read it rather than in one of them.
    const turn = planTurn('/plan restore the session token', deps);
    assert.equal(turn.kind, 'call');
    assert.equal(turn.method, 'workspace.plan');
    assert.deepEqual(turn.params, { request: 'restore the session token', files: [] });
  });

  test('`/` and `/help` both return the command list, formatted once', () => {
    for (const typed of ['/', '/help']) {
      const turn = planTurn(typed, deps);
      assert.equal(turn.kind, 'help');
      assert.equal(turn.lines.length, AGENT_COMMANDS.length);
    }
  });

  test('a slash word that names nothing is said, not guessed at', () => {
    const turn = planTurn('/pIan something', deps);
    assert.equal(turn.kind, 'unknown');
    assert.match(turn.message, /Nothing named/);
  });

  test('a near miss names the commands it is near, and still runs none of them', () => {
    // Owner report, 2026-08-17: `/model` came back "Nothing named `mode`" — one dropped
    // character, and a shell that knew the answer and did not offer it. The dead end is the
    // defect, not the refusal: refusing to GUESS is right (`resolveCommand` is exact on
    // purpose), refusing to POINT is not.
    const turn = planTurn('/mode', deps);
    assert.equal(turn.kind, 'unknown');
    assert.match(turn.message, /Nothing named `mode`/);
    assert.match(turn.message, /Did you mean \/model/);
    assert.deepEqual(turn.suggestions, ['/model']);
    // Named, never run: the turn is still `unknown`, so no shell can treat it as a command.
    assert.equal(turn.command, undefined);
  });

  test('the suggestions come from the offered list, so a hidden command is never suggested', () => {
    // The failure this prevents: suggesting `/plan` to an account whose menu does not carry it,
    // which is a 403 announced as a hint. `commands` here is what the shell OFFERS — the same
    // array the menu paints — not `AGENT_COMMANDS` reached past the filter.
    const offered = AGENT_COMMANDS.filter((entry) => entry.name !== 'model');
    const turn = planTurn('/mode', { ...deps, commands: offered });
    assert.deepEqual(turn.suggestions, []);
    assert.doesNotMatch(turn.message, /Did you mean/);
  });

  test('prose gets no suggestions — the branch is about slash words', () => {
    const turn = planTurn('summarise the repository', deps);
    assert.equal(turn.kind, 'unknown');
    assert.deepEqual(turn.suggestions, []);
    assert.doesNotMatch(turn.message, /Did you mean/);
  });

  test('an empty line is a turn that does nothing', () => {
    assert.equal(planTurn('   ', deps).kind, 'empty');
  });

  test('a long result is truncated WITH its count, never silently', () => {
    const long = Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`k${i}`, i]));
    const lines = detailLines(long);
    assert.equal(lines.length, DETAIL_LINES + 1);
    assert.match(lines.at(-1), /^… \d+ more lines$/);
  });

  test('the git line reports what the engine answered, and `—` when it did not', () => {
    assert.equal(gitSummary(null), '—');
    assert.equal(gitSummary({ available: false }), '—');
    assert.equal(gitSummary({ available: true, branch: 'main', hasUpstream: true, ahead: 2, behind: 1 }), 'main ↑2 ↓1');
    assert.equal(gitSummary({ available: true, detached: true, hasUpstream: false }), 'detached (no upstream)');
  });
});

describe('no shell keeps a description of its own (phase 2)', () => {
  const fullscreen = read('tools/tui-fullscreen.mjs');

  test('the terminal shell imports the model instead of defining one', () => {
    assert.match(fullscreen, /from '\.\.\/apps\/webui-static\/coden-view-model\.js'/,
      'the terminal shell no longer imports the shared view model');
    // The two things that used to live here, and whose return would mean the drift is back.
    assert.ok(!/^const RUN = \{/m.test(fullscreen),
      'the terminal shell has grown its own command→call map again');
    assert.ok(!/transcript: \[\s*\n\s*\{ kind: 'note'/.test(fullscreen),
      'the terminal shell has grown its own opening transcript again');
  });

  test('the shared model is pure: no transport, no terminal, no DOM', () => {
    const model = read('apps/webui-static/coden-view-model.js');
    for (const forbidden of [/\bimport .*node:/, /\bdocument\./, /\bfetch\(/, /process\./, /\\x1b/]) {
      assert.ok(!forbidden.test(model),
        `the view model reached for ${forbidden} — it must stay renderable by either shell`);
    }
  });

  test('the model lives where BOTH shells can already import it', () => {
    // A copy under tools/ would be unreachable from the browser, and a copy in each would be
    // the second copy this phase exists to remove. `agent-commands.js` set the precedent.
    assert.ok(read('apps/shared/coden/agent-commands.js').length > 0);
    // `D-0405` slice 1: the registry moved OUT of the web folder, so that removing the web
    // CodeN cannot take the terminal's vocabulary with it. Asserting the new specifier is not
    // enough — the old one must also be gone, or a stale second import would keep the
    // dependency alive while this test went green on the new one.
    assert.match(fullscreen, /from '\.\.\/apps\/shared\/coden\/agent-commands\.js'/);
    assert.doesNotMatch(fullscreen, /apps\/webui-static\/agent-commands\.js/);
  });
});

// ---------------------------------------------------------------------------------------
// s333 point 2 — a required argument that was not given.
//
// Owner: «i comandi / non so se funzionano, non vedo cambiamenti e non si capisce». Measured
// in the browser: `/diff` fired `workspace.get()` with no run and came back "diff refused: no
// run" — a server sentence about a call nobody asked to make, with nothing on screen moving.
// Nine of the thirty-three commands take a required argument and every one behaved this way.
describe('a command that needs a subject it was not given', () => {
  const addresses = [
    { address: 'coden/bench/diff', label: 'Diff' },
    { address: 'coden/agent/plan', label: 'Plan' },
    { address: 'projects', label: 'Projects' },
  ];
  const offered = [...AGENT_COMMANDS, ...addressEntries(addresses)];
  const turn = (text) => planTurn(text, {
    resolve: (line) => resolveCommand(line, offered),
    parse: parseCommandPrompt,
    commands: offered,
  });

  test('the required/optional distinction is read from the catalogue, not a second list', () => {
    assert.equal(requiresArgument({ argument: '<run>' }), true);
    assert.equal(requiresArgument({ argument: '[path]' }), false, 'square brackets mean optional');
    assert.equal(requiresArgument({ argument: '' }), false);
    assert.equal(requiresArgument({}), false);
  });

  test('it goes to the panel that shows the thing, rather than making a doomed call', () => {
    const result = turn('/diff');
    assert.equal(result.kind, 'navigate', 'this used to be kind "call" and was always refused');
    assert.equal(result.address, 'coden/bench/diff');
    assert.match(result.because, /needs <run>/, 'the move must state why it happened');
  });

  test('the agent column is the same rule, not a second one', () => {
    const result = turn('/plan');
    assert.equal(result.kind, 'navigate');
    assert.equal(result.address, 'coden/agent/plan');
  });

  test('with the subject supplied it runs, exactly as before', () => {
    const result = turn('/diff run-7');
    assert.equal(result.kind, 'call', 'giving the argument must not be diverted to a panel');
    assert.equal(result.argument, 'run-7');
  });

  test('an optional argument is still optional — nothing is diverted', () => {
    const result = turn('/map');
    assert.equal(result.kind, 'call', '[path] is optional, so /map runs');
  });

  test('a command with no panel of its own says what is missing and runs nothing', () => {
    const result = turn('/approve');
    assert.equal(result.kind, 'needs-argument');
    assert.match(result.message, /<run>/);
    assert.ok(!('method' in result), 'no transport may be named: naming one is how it got called');
  });

  test('the panel offered is a panel of THIS bench, never a destination that merely matches', () => {
    // `panelOwning` is restricted to `coden/`. Without that, a command could be answered by
    // jumping out of the page to something that happens to end in the same word — a different
    // promise from "here is the panel that shows this".
    assert.equal(panelOwning('projects', addressEntries(addresses)), null,
      'the bare `projects` destination must not be offered as a bench panel');
    assert.equal(panelOwning('diff', addressEntries(addresses))?.address, 'coden/bench/diff');
  });

  test('every command declaring a required argument is covered by the rule', () => {
    // Not a sample. If a tenth command is added tomorrow with `<something>`, it is covered the
    // moment it is declared — and this fails if the rule ever stops applying to one of them.
    const required = AGENT_COMMANDS.filter((c) => requiresArgument(c) && c.kind !== 'address');
    assert.ok(required.length >= 9, `expected the measured nine or more, saw ${required.length}`);
    for (const command of required) {
      const result = turn(`/${command.name}`);
      assert.ok(['navigate', 'needs-argument'].includes(result.kind),
        `/${command.name} still resolves to ${result.kind} with no argument`);
    }
  });
});
