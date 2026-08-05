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
// The `/` here belongs to the PROMPT, and since phase 3c it is the ONLY one — `16` §4b.4
// rule 1. It was true for a while that navigation was a separate gesture living in the
// browser's top bar; the Owner's decision of 2026-08-05 ends that, because two boxes for one
// question is the thing `D-0299` spent a phase reducing. So this prompt takes both a command
// to the session and an address to go to, resolved against one list.
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
  createView, say, planTurn, detailLines, gitSummary, reasoningSummary, frequencySummary,
  divergenceLines, divergenceSummary, CLEARED_NOTE, startForm, fillForm,
  addressEntries, menuEntriesFor,
} from '../apps/webui-static/coden-view-model.js';
// Phase 3c: the address views, which BOTH terminal shells render. They are not imported from
// `tui-client.mjs` — that file imports this one, and a table two shells share belongs to
// neither of them.
import { showAddress } from './coden-address-views.mjs';

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

  // Phase 3c. The address space, fetched once and kept — the same list the browser derives
  // from the markup, served over the socket so a client from a stale checkout shows the
  // SERVER's addresses rather than its own. `addressState` is what the session-listing views
  // remember a page in, exactly as the line shell's own state does; it is created here so the
  // two shells cannot answer `sessions` off two different "last list shown".
  const addressState = { lastList: null, lastRefused: [], addresses: null };
  let addressBook = [];
  const loadAddresses = async () => {
    if (addressBook.length) return addressBook;
    const served = await session.call('coden.addresses', {}).catch(() => null);
    addressBook = served?.addresses ?? [];
    return addressBook;
  };
  const addressEntry = async (address) =>
    (await loadAddresses()).find((entry) => entry.address === address) ?? null;

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

  // The menu offers the commands AND the address space — `16` §4b.4 rule 1, "una casella,
  // tutto il prodotto". The addresses are appended from the SERVED list through the shared
  // shaper, never written here; `groupMenu` files them under APPLICATIONS by the document's
  // own criterion ("è un posto dove si va"). Commands come first so a typed `/diff` still
  // offers the work command ahead of the Diff panel.
  const offered = () => [...menu.entries, ...addressEntries(addressBook)];
  const refilter = () => {
    const parsed = parseCommandPrompt(view.prompt);
    view.menu = parsed
      ? {
        hits: matchCommands(parsed.word, menuEntriesFor(parsed.word, menu.entries, addressBook)), selected: 0,
        groups: groupMenu, accessFiltered: menu.accessFiltered, hidden: menu.hidden,
      }
      : null;
    draw();
  };

  const submit = async () => {
    const typed = view.prompt.trim();
    view.prompt = '';
    view.menu = null;

    // A form in progress SWALLOWS the line — INCLUDING AN EMPTY ONE — so this runs before the
    // empty-prompt early return below. `/cancel` is the way out and `fillForm` owns it: a form
    // you cannot leave is a trap, and this shell's premise is that you can walk away from it.
    //
    // The ordering is the whole fix. An empty prompt means "do nothing" only while the prompt
    // is taking COMMANDS; inside a form it is an answer, and the field where an empty answer
    // is most likely is the one asking what was NOT done. Dropping it silently did not lose one
    // answer — it shifted every later one up a field. Measured by driving it: a closure came
    // out with `notDone` holding the risk and `residualRisk` holding the next command the user
    // typed. A record whose entire purpose is honesty, quietly filled with the wrong content.
    if (view.form) {
      if (typed) { record('user', typed); draw(); }
      const step = fillForm(view.form, typed);
      if (step.cancelled) { view.form = null; record('note', 'Closure abandoned. Nothing was recorded.'); return draw(); }
      if (step.ask) { record('agent', step.ask); return draw(); }
      view.form = null;
      record('tool', `${step.method}(${step.params.runId})`);
      draw();
      try {
        record('agent', 'closure — recorded', detailLines(await session.call(step.method, step.params)));
      } catch (error) {
        // The register's own refusal, shown as itself. Re-checking the rule in this shell would
        // be a second copy of the one thing `UI-036` exists to enforce.
        record('error', `closure refused${error.kind ? ` [${error.kind}]` : ''}: ${error.message}`);
      }
      return draw();
    }

    if (!typed) return draw();
    record('user', typed);
    draw();

    // What the line MEANS is decided by the shared model; this shell only performs it. The
    // browser will perform the same intents over its own transport, which is the whole point.
    const turn = planTurn(typed, {
      resolve: (text) => resolveCommand(text, offered()),
      parse: parseCommandPrompt,
      commands: offered(),
      groups: groupMenu,
    });

    if (turn.kind === 'help') { record('agent', 'Commands:', turn.lines); return draw(); }
    if (turn.kind === 'clear') { view.transcript = [{ kind: 'note', text: CLEARED_NOTE }]; return draw(); }
    if (turn.kind === 'unknown') { record('error', turn.message); return draw(); }
    if (turn.kind === 'confirm') { record('note', turn.message); return draw(); }
    // A form: this shell walks its fields at the prompt. The browser opens the panel that
    // already holds the same form — one capability, two renditions.
    if (turn.kind === 'form') {
      const begun = startForm(turn.command, turn.argument);
      if (!begun || begun.error) { record('error', begun?.error ?? `\`/${turn.command}\` has no form here.`); return draw(); }
      view.form = begun.form;
      record('agent', begun.ask);
      record('note', 'Answer one line at a time. `/cancel` abandons it.');
      return draw();
    }
    if (turn.kind === 'session') { leave = turn.action; return finish?.(); }

    // A destination — and since phase 3c this shell RENDERS it rather than promising it.
    //
    // What was here answered every destination by saying this shell had none built, and named
    // the phase that would build them. That phase HAD built them — in `showAddress()`, which
    // only the LINE shell called, and the line shell only runs when stdin is a pipe. So a real
    // user over `ssh` got that sentence for every one of the twenty-five, about finished work.
    // Measured at the start of 3c: 25 of 25 rendered in the line shell, 0 of 25 here.
    // (Worded around the old string on purpose: the guard that checks it is gone reads this
    // file's comments too, and cannot tell a quotation from a live message.)
    //
    // The lines come back from the same table both shells now use, and go into the transcript
    // as a detail block — which is what "going somewhere" MEANS in a shell whose whole screen
    // is a transcript. No second view table lives in this file, for the reason that has cost
    // this project twice: a list compared only with itself always agrees.
    if (turn.kind === 'navigate') {
      record('tool', `→ /${turn.command}`);
      draw();
      const known = await addressEntry(turn.address);
      if (!known) {
        record('error', `\`${turn.address}\` is not in the address list this deployment serves.`);
        return draw();
      }
      try {
        const lines = await showAddress(session, addressState, known, turn.argument ?? '', () => {});
        record('agent', known.label, lines);
      } catch (error) {
        record('error', `${known.label} refused${error.kind ? ` [${error.kind}]` : ''}: ${error.message}`);
      }
      return draw();
    }
    if (turn.kind !== 'call') return draw();

    record('tool', turn.label);
    draw();
    try {
      const result = await session.call(turn.method, turn.params);
      // Phase 6 (`D-0312`): the degradation reaches the status line from the ANSWER, the same
      // way the branch does — never from a second question this shell asks on its own, which
      // is how the two shells would start disagreeing about the same session.
      if (result && typeof result === 'object' && result.reasoning) {
        view.reasoning = reasoningSummary(result.reasoning);
        // In the transcript too, and only when it is news. A run that degraded would otherwise
        // change one dim word at the bottom of the screen and nothing else.
        if (result.reasoning.degraded) {
          // The frequency goes in the same line as the event, because «it happened» and «it has
          // happened 4 times in 120 runs» are answered together or the second is never asked.
          record('note', `ATOM was asked for and did not answer — the reference provider answered instead. ${(result.reasoning.reasons ?? []).join(' · ')}  [${frequencySummary(result.reasoning.frequency)}]`);
        }
      }
      // Phase 7 (`CE-010`): the profile is shown BESIDE the change, as four signals with their
      // level — never a number, and never a bare colour. The notes carry what a maintainer
      // would actually say, and they come from the same shaper the browser uses.
      if (result && typeof result === 'object' && result.divergence) {
        record('note', `divergence — ${divergenceSummary(result.divergence)}`,
          divergenceLines(result.divergence).map((line) => `${line.id}: ${line.level}${line.note ? ` — ${line.note}` : ''}`));
      }
      record('agent', `${turn.command} — ok`, detailLines(result));
    } catch (error) {
      // A step that began with ATOM and lost it stops RESUMABLY rather than finishing at a
      // second quality. The checkpoint is shown, because "stopped" and "stopped with
      // everything needed to resume" are different things to be told.
      if (error?.checkpoint?.resumable) {
        record('error', `${turn.command} stopped at \`${error.checkpoint.stoppedAtSurface}\`: ${error.checkpoint.reason}`, detailLines(error.checkpoint));
      } else {
        record('error', `${turn.command} refused${error.kind ? ` [${error.kind}]` : ''}: ${error.message}`);
      }
    }
    draw();
  };

  out.write(SCREEN.enter + SCREEN.clear);
  emitKeypressEvents(input);
  const wasRaw = input.isRaw;
  if (input.isTTY) input.setRawMode(true);

  await refreshFooter();
  // Before the first keystroke, not on it. The menu and the prompt resolve against the same
  // list, so a shell that had not loaded the addresses yet would answer "nothing named that"
  // to an address it is about to start offering — which is worse than a slow open.
  await loadAddresses();
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
