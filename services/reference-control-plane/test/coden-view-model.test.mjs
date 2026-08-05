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
} from '../../../apps/webui-static/agent-commands.js';
import {
  RUN, createView, say, planTurn, detailLines, gitSummary,
  TRANSCRIPT_KINDS, OPENING_NOTE, DETAIL_LINES, FORMS,
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
    assert.match(turn.message, /No command named/);
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
    assert.ok(read('apps/webui-static/agent-commands.js').length > 0);
    assert.match(fullscreen, /from '\.\.\/apps\/webui-static\/agent-commands\.js'/);
  });
});
