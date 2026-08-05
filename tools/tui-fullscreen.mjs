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
  matchCommands, parseCommandPrompt, resolveCommand, menuFor, groupMenu,
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
export async function runFullScreen({
  session, status, account = null, onLeave = null,
  out = process.stdout, input = process.stdin,
}) {
  const view = createView();
  const record = (kind, text, detail) => say(view, kind, text, detail);

  // The menu this account may use, and the fact that it WAS filtered — `CE-036`. Computed
  // once: an account's permissions do not change inside a session, and recomputing per
  // keystroke would only invite the two shells to answer differently at different moments.
  // `account` null means the caller did not say who is asking; `menuFor` then declares
  // `accessFiltered:false` rather than showing everything as though it had been checked.
  //
  // Named `account`, not `authority`: `authority` is a PANEL of this product
  // (`coden/agent/authority`), and `coden-addressable-panels.test.mjs` refuses any panel name
  // written into this client — panel names come from the served list. The guard fired on the
  // first draft, correctly: it cannot tell a variable from a hand-written panel table, and a
  // guard narrowed to let this through would stop catching the thing it exists for.
  const menu = menuFor(account);

  // Why the session group needs these two. `/logout` has to tear the screen down from inside
  // the submit handler, which runs before the keypress loop below has been built — so the
  // teardown is bound here and filled in there, and `leave` carries out WHY the shell ended so
  // the caller can end the session rather than guess from a bare return.
  let leave = null;
  let finish = null;

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
    view.menu = parsed
      ? {
        hits: matchCommands(parsed.word, menu.entries), selected: 0,
        groups: groupMenu, accessFiltered: menu.accessFiltered, hidden: menu.hidden,
      }
      : null;
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
      resolve: (text) => resolveCommand(text, menu.entries),
      parse: parseCommandPrompt,
      commands: menu.entries,
      groups: groupMenu,
    });

    if (turn.kind === 'help') { record('agent', 'Commands:', turn.lines); return draw(); }
    if (turn.kind === 'clear') { view.transcript = [{ kind: 'note', text: CLEARED_NOTE }]; return draw(); }
    if (turn.kind === 'unknown') { record('error', turn.message); return draw(); }
    if (turn.kind === 'confirm') { record('note', turn.message); return draw(); }
    if (turn.kind === 'session') { leave = turn.action; return finish?.(); }

    // A destination. The name comes from the served address list, never from a second table
    // in this file — the arrangement that had drifted to fourteen names against a markup of
    // twenty-five. What this shell CANNOT do yet it says: phase 3a builds the form, and
    // rendering another destination in this shell is 3b, along with the seventeen CodeN
    // addresses already measured as having no view here. Saying so is the same posture
    // `coden.addresses` takes when it cannot read its source — an honest UNAVAILABLE beats a
    // blank screen that reads as "there is nothing there".
    if (turn.kind === 'navigate') {
      record('tool', `→ /${turn.command}`);
      const known = await session.call('coden.addresses', {})
        .then(({ addresses }) => addresses.find((entry) => entry.address === turn.address))
        .catch(() => null);
      record(known ? 'agent' : 'error', known
        ? `${known.label} — this shell has no view for it yet (phase 3b). The browser renders it at #/${turn.address}.`
        : `\`${turn.address}\` is not in the address list this deployment serves.`);
      return draw();
    }
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
    finish = () => {
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

  // Reported rather than acted on here: ending the session is the caller's, because the caller
  // is what owns the socket (`CE-021` — detaching a shell must leave the work in the engine,
  // so a shell that closed the session itself would be the one gesture that breaks it).
  if (leave && typeof onLeave === 'function') await onLeave(leave);
  return leave;
}
