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

/** How each command turns into a call and a transcript entry. The engine method comes from
 *  the shared registry, so this decides only what to send and how to say what came back. */
const RUN = {
  plan: (argument) => ['workspace.plan', { request: argument, files: [] }],
  simulate: (argument) => ['workspace.simulate', { runId: argument }],
  approve: (argument) => ['workspace.approve', { runId: argument }],
  reject: (argument) => {
    const [runId, ...why] = argument.split(' ');
    return ['workspace.reject', { runId, reason: why.join(' ') || undefined }];
  },
  restore: (argument) => ['workspace.restore', { runId: argument }],
  diff: (argument) => ['workspace.get', { runId: argument }],
  map: (argument) => ['repoMap.scan', argument ? { path: argument } : {}],
  search: (argument) => ['repoMap.search', { q: argument }],
  events: (argument) => ['events.correlation', { correlationId: argument }],
  status: () => ['status', {}],
  sessions: (argument) => ['sessions.list', argument ? { filter: argument } : {}],
  git: () => ['coden.gitStatus', {}],
};

// Ten lines, and the count of what was dropped.
//
// It was twenty-four, and a single `/map` buried the tool call that produced it: the answer
// scrolled the question off the screen, which is the opposite of what a transcript is for.
// Truncating is the fix; truncating SILENTLY would not be — a reader who cannot see that
// there was more would take ten lines for the whole answer.
const DETAIL_LINES = 10;

const detailLines = (value) => {
  const all = (value === undefined || value === null ? '(nothing)' : JSON.stringify(value, null, 2)).split('\n');
  return all.length <= DETAIL_LINES
    ? all
    : [...all.slice(0, DETAIL_LINES), `… ${all.length - DETAIL_LINES} more lines`];
};

/**
 * Runs the agent shell until the user leaves it. Resolves when the screen is torn down; the
 * caller still owns the socket.
 */
export async function runFullScreen({ session, status, out = process.stdout, input = process.stdin }) {
  const view = {
    transcript: [
      { kind: 'note', text: 'CodeN Evolution — attached to the live session. Type a command, or / for the list.' },
    ],
    prompt: '',
    menu: null,
    mode: 'NORMAL',
    network: 'local-only',
    git: '—',
    model: '—',
    context: '—',
    sourcedNote: null,
  };

  const say = (kind, text, detail) => { view.transcript.push({ kind, text, detail }); };

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
    if (git?.available) {
      const parts = [git.detached ? 'detached' : git.branch];
      if (!git.hasUpstream) parts.push('(no upstream)');
      else {
        if (git.ahead) parts.push(`↑${git.ahead}`);
        if (git.behind) parts.push(`↓${git.behind}`);
      }
      view.git = parts.join(' ');
    }
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

    say('user', typed);
    draw();

    if (typed === '/help' || typed === '/') {
      say('agent', 'Commands:', AGENT_COMMANDS.map((c) => `/${c.name} ${c.argument}`.trim().padEnd(28) + c.summary));
      return draw();
    }
    if (typed === '/clear') {
      view.transcript = [{ kind: 'note', text: 'Transcript cleared. The session kept its state — this shell is a viewer.' }];
      return draw();
    }

    const resolved = resolveCommand(typed);
    if (!resolved) {
      // Prose, or a slash word that names nothing. Said plainly rather than guessed at: the
      // reference provider has no model (`workspace-actions.mjs` says so in its own status),
      // so this shell cannot answer prose, and quietly running the nearest command would be
      // an action nobody chose.
      say('error', typed.startsWith('/')
        ? `No command named \`${parseCommandPrompt(typed).word}\`. Type / for the list.`
        : 'This shell has no model wired for prose. Every capability is a command — type / for the list.');
      return draw();
    }

    const build = RUN[resolved.command.name];
    if (!build) { say('error', `\`/${resolved.command.name}\` has no transport here.`); return draw(); }
    const [method, params] = build(resolved.argument);
    say('tool', `${method}(${resolved.argument || ''})`);
    draw();
    try {
      const result = await session.call(method, params);
      say('agent', `${resolved.command.name} — ok`, detailLines(result));
    } catch (error) {
      say('error', `${resolved.command.name} refused${error.kind ? ` [${error.kind}]` : ''}: ${error.message}`);
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
