// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The coding agent's terminal shell — the impure half. Everything that decides what the
// screen LOOKS like is in tui-screen.mjs and is pure; this owns raw mode, the alternate
// screen buffer, resize, and the keypress loop.
//
// What this is: a prompt you type into, a transcript above it, and slash commands that act on
// the session — the shape Codex and Claude Code have. A first version of this file drove a
// panel dashboard with a navigator and a bench, which was a misread: that layout is the
// WORKBENCH (`07_INTERFACCIA.md` §4, the browser's page). The terminal is an agent.
//
// The `/` here belongs to the PROMPT and is a command to the session. It is not the address
// box — that is navigation, it lives in the browser's top bar, and it is a different gesture.
// Both exist; conflating them was the original error.
//
// One session, two shells (`06_CODEN_EVOLUTION.md` §9): every command below runs the same
// engine method the browser runs, over the same socket, so detaching one shell leaves the
// work in the engine — which is what `CE-021` measures.

import { emitKeypressEvents } from 'node:readline';
import { renderFrame, SCREEN } from './tui-screen.mjs';
import {
  AGENT_COMMANDS, matchCommands, parseCommandPrompt, resolveCommand,
} from '../apps/webui-static/agent-commands.js';
// What a session looks like — the transcript, the prompt, the menu, and what a typed line
// MEANS — is `apps/webui-static/coden-view-model.js` since phase 2. It used to be here, which
// made this file the only place that knew, and left the browser free to invent a second answer
// when its turn came. This file keeps what it is for: raw mode, keypresses, the frame.
import {
  createView, say, planTurn, detailLines, gitSummary, CLEARED_NOTE,
} from '../apps/webui-static/coden-view-model.js';

/**
 * Runs the agent shell until the user leaves it. Resolves when the screen is torn down; the
 * caller still owns the socket.
 */
export async function runFullScreen({ session, status, out = process.stdout, input = process.stdin }) {
  const view = createView();
  const record = (kind, text, detail) => say(view, kind, text, detail);

  const draw = () => {
    out.write(SCREEN.home + renderFrame({
      width: out.columns || 100, height: out.rows || 24, state: view,
    }).join('\n'));
  };

  // Sourced once at open: the branch the footer shows, and the engine's own declaration about
  // test execution. Not per frame — shelling out to git on every keystroke costs the user
  // nothing but latency.
  const refreshFooter = async () => {
    const git = await session.call('coden.gitStatus', {}).catch(() => null);
    if (git?.available) view.git = gitSummary(git);
    // "No tests ran, and here is why" is a fact; omitting it reports the same footer as a
    // build where the answer is merely unknown.
    if (status?.workspaceActions?.testExecution === false) view.tests = 'tests none (EXECUTE refused)';
  };

  const refilter = () => {
    const parsed = parseCommandPrompt(view.prompt);
    view.menu = parsed ? { hits: matchCommands(parsed.word), selected: 0 } : null;
    draw();
  };

  const submit = async () => {
    const typed = view.prompt.trim();
    view.prompt = '';
    view.menu = null;
    if (!typed) return draw();

    record('user', typed);
    draw();

    // What the line MEANS is decided by the shared model; this shell only performs it. The
    // browser will perform the same intents over its own transport, which is the whole point.
    const turn = planTurn(typed, {
      resolve: resolveCommand, parse: parseCommandPrompt, commands: AGENT_COMMANDS,
    });

    if (turn.kind === 'help') { record('agent', 'Commands:', turn.lines); return draw(); }
    if (turn.kind === 'clear') { view.transcript = [{ kind: 'note', text: CLEARED_NOTE }]; return draw(); }
    if (turn.kind === 'unknown') { record('error', turn.message); return draw(); }
    if (turn.kind !== 'call') return draw();

    record('tool', turn.label);
    draw();
    try {
      const result = await session.call(turn.method, turn.params);
      record('agent', `${turn.command} — ok`, detailLines(result));
    } catch (error) {
      record('error', `${turn.command} refused${error.kind ? ` [${error.kind}]` : ''}: ${error.message}`);
    }
    draw();
  };

  out.write(SCREEN.enter + SCREEN.clear);
  emitKeypressEvents(input);
  const wasRaw = input.isRaw;
  if (input.isTTY) input.setRawMode(true);

  await refreshFooter();
  draw();

  await new Promise((resolve) => {
    const onResize = () => draw();
    const finish = () => {
      input.off('keypress', onKey);
      out.off('resize', onResize);
      if (input.isTTY) input.setRawMode(Boolean(wasRaw));
      out.write(SCREEN.leave);
      resolve();
    };
    function onKey(chunk, key) {
      const name = key?.name ?? '';
      // Ctrl-C / Ctrl-D leave. Not trapped behind a confirmation: refusing to let someone out
      // of a full-screen program is its own kind of rudeness.
      if (key?.ctrl && (name === 'c' || name === 'd')) return finish();

      if (view.menu) {
        if (name === 'escape') { view.menu = null; return draw(); }
        if (name === 'up' || name === 'down') {
          const count = Math.max(1, view.menu.hits.length);
          view.menu.selected = (view.menu.selected + (name === 'down' ? 1 : -1) + count) % count;
          return draw();
        }
        // Tab completes the highlighted command into the prompt without running it — choosing
        // and committing stay two acts, so a keystroke never becomes an action nobody picked.
        if (name === 'tab') {
          const chosen = view.menu.hits[view.menu.selected];
          if (chosen) view.prompt = `/${chosen.name}${chosen.argument ? ' ' : ''}`;
          return refilter();
        }
      }

      if (name === 'return') return void submit();
      if (name === 'backspace') { view.prompt = view.prompt.slice(0, -1); return refilter(); }
      if (chunk && !key?.ctrl && !key?.meta && chunk >= ' ') { view.prompt += chunk; return refilter(); }
      return undefined;
    }
    input.on('keypress', onKey);
    out.on('resize', onResize);
  });
}
