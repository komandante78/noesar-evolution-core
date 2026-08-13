// SPDX-License-Identifier: AGPL-3.0-or-later
//
// CodeN Evolution in the browser — the TUI, not a second interface.
//
// `D-0404` collapses CodeN into ONE surface. This file is the browser's half of that: it draws
// the SAME frames `ssh` draws, produced by the SAME renderer, over the slice-2 bridge, into a
// terminal emulator. What it is not is a web version of the terminal — there is no second
// layout here, no second menu and no second vocabulary.
//
// # What is shared, what is not, and why the difference is legitimate
//
//   SHARED  the renderer          `../shared/coden/tui-screen.mjs`  — byte-identical frames
//   SHARED  what a line MEANS     `./coden-view-model.js`           — planTurn, say, prompt
//   SHARED  the command registry  `../shared/coden/agent-commands.js`
//   NOT     key decoding          readline gives the terminal shell parsed keypresses; xterm.js
//                                 gives this one raw bytes. Two decoders, one meaning.
//
// That last line is the one honest divergence, and it is declared rather than left to be found
// (`noesar-evolution` rule 3: *if you build for one shell, declare the state of the other in the
// same breath*). The decoder below turns bytes into the same intents `tui-fullscreen.mjs` gets
// from `emitKeypressEvents`; everything downstream of the intent is the shared model. A test
// asserts both shells reach `planTurn` and neither invents an entry of its own.
//
// # No PTY behind this
//
// The socket carries `{id, method, params}` against a fixed method table (`coden-bridge.mjs`).
// Typing into this terminal never reaches a shell, because there is no shell to reach.

import { Terminal } from './vendor/xterm/xterm.mjs';
// The pure decisions live in the shared tree so the suite can import them without a browser.
import { decodeInput, geometryFor, bridgeUrl } from '../shared/coden/terminal-input.mjs';
import { SCREEN, renderFrame } from '../shared/coden/tui-screen.mjs';
import { createView, say, planTurn, promptKeys, menuFrame, startForm, CLEARED_NOTE } from './coden-view-model.js';
import {
  accountFromUser, menuFor, groupMenu, hiddenNote, resolveCommand, parseCommandPrompt,
} from '../shared/coden/agent-commands.js';

/** The bridge's own envelope version. A frame announcing anything else is from a server this
 *  build does not understand, and is refused rather than half-read — the versioned contract
 *  `D-0404` asks for, used rather than merely declared. */
const BRIDGE_PROTOCOL = 'noesar-coden-bridge/1';

/** Reconnection backoff. Capped, and jittered, because N viewports of one account all lose the
 *  socket at the same instant when the server restarts: without jitter they would return in
 *  lockstep and the handshake budget would refuse the herd it just created. */
const BACKOFF_MS = [500, 1000, 2000, 4000, 8000, 15_000];

/** The platform monospace stack. No webfont ships (`D-0413`): the renderer's whole non-ASCII
 *  repertoire is box drawing, geometric shapes and dingbats — standard Unicode, no private-use
 *  codepoint — and every face below covers it. A multi-megabyte binary to gain nothing
 *  measurable is cost without benefit, and an installation behind a slow link pays it on every
 *  first load. Ordered by what each platform actually ships and how well it draws box glyphs. */
const FONT_STACK = '"Cascadia Mono", "JetBrains Mono", "SF Mono", Menlo, Consolas, "DejaVu Sans Mono", "Liberation Mono", monospace';

/** Every operational state this surface can be in. `76` makes these first-class rather than
 *  polish: a terminal that is merely blank while connecting is indistinguishable from one that
 *  is broken, and the person looking at it cannot tell which. */
export const TerminalState = Object.freeze({
  IDLE: 'idle',
  CONNECTING: 'connecting',
  LIVE: 'live',
  RECONNECTING: 'reconnecting',
  REFUSED: 'refused',
  FAILED: 'failed',
});

/**
 * Mount the terminal into `host` and keep it attached.
 *
 * Returns a handle with `dispose()`, `state()` and `resize()`. The caller owns when it starts —
 * the page only connects when CodeN is the visible destination, because a socket held open by a
 * background view is a viewport slot spent on a screen nobody is looking at.
 */
export function mountCodenTerminal({ host, statusEl = null, location = window.location, WebSocketImpl = window.WebSocket } = {}) {
  const terminal = new Terminal({
    fontFamily: FONT_STACK,
    fontSize: 13,
    lineHeight: 1.2,
    cursorBlink: true,
    // On, and not an afterthought. §9 of the design is explicit that a terminal in a browser is
    // ONE element to an accessibility audit, that this is worse than the DOM it replaces, and
    // that the conformance claim is scoped rather than extended into a lie. Screen-reader mode
    // makes xterm mirror the buffer into a live region; it is a mitigation, not an equivalence.
    screenReaderMode: true,
    // The transcript already lives in the engine and is redrawn on reattach, so the emulator's
    // own scrollback would be a second, divergent copy of it.
    scrollback: 0,
    allowProposedApi: false,
    convertEol: false,
  });

  let socket = null;
  let view = createView();
  let account = null;
  let state = TerminalState.IDLE;
  let attempt = 0;
  let disposed = false;
  let reconnectTimer = null;
  let nextId = 1;
  const pending = new Map();
  let observer = null;
  /** The product's address space, fetched once per attachment from `coden.addresses` — the same
   *  list the terminal shell is told, over the same method. Empty until the first reply, which
   *  `menuFrame` handles: a menu that offers no destinations is correct while none are known,
   *  and inventing a local list here is precisely what `D-0300` forbade. */
  let addressBook = [];
  /** Said once per attachment — see the arrow branch in the input handler. */
  let arrowsExplained = false;

  const setState = (next, detail = '') => {
    if (state === next && !detail) return;
    state = next;
    // One writer for the status line. Two would race, and the loser would leave the surface
    // claiming a state it is not in — which on a connection widget is worse than no widget.
    if (statusEl) {
      statusEl.dataset.state = next;
      statusEl.textContent = detail || DEFAULT_STATUS[next];
    }
    host.dataset.terminalState = next;
  };

  const draw = () => {
    const rows = renderFrame({ width: terminal.cols, height: terminal.rows, state: view });
    // `\r\n`, not `\n`: without the carriage return every row after the first starts at the
    // column the previous one ended on, and the frame walks diagonally off the screen. The
    // terminal shell writes `\n` because a TTY in cooked mode supplies the return; xterm.js
    // does not, and `convertEol` is deliberately off so this stays explicit.
    terminal.write(SCREEN.home + rows.join('\r\n'));
  };

  /** One request over the bridge, resolved by id. Rejects if the socket dies first, so a caller
   *  awaiting a reply is never left hanging on a connection that has gone. */
  const call = (method, params) => new Promise((resolve, reject) => {
    if (!socket || socket.readyState !== 1) return reject(new Error('not connected'));
    const id = nextId += 1;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });

  const failPending = (reason) => {
    for (const { reject } of pending.values()) reject(new Error(reason));
    pending.clear();
  };

  function onFrame(frame) {
    if (frame.protocol && frame.protocol !== BRIDGE_PROTOCOL) {
      // A server speaking a version this build does not know. Refusing beats half-reading it:
      // the fields it does recognise might mean something else entirely.
      setState(TerminalState.FAILED, `This page speaks ${BRIDGE_PROTOCOL}; the server speaks ${frame.protocol}. Reload after updating.`);
      socket?.close();
      return;
    }
    if (frame.id !== undefined && frame.id !== null && pending.has(frame.id)) {
      const { resolve, reject } = pending.get(frame.id);
      pending.delete(frame.id);
      if (frame.ok) resolve(frame.result); else reject(Object.assign(new Error(frame.error?.reason ?? 'call failed'), { kind: frame.error?.kind }));
      return;
    }
    if (frame.type === 'welcome') {
      account = accountFromUser(frame.user ? { ...frame.user, permissions: frame.permissions } : null);
      attempt = 0;
      setState(TerminalState.LIVE);
      record('note', `Attached as ${frame.user?.username ?? 'unknown'}. ${frame.siblings?.length ?? 0} other viewport(s) on this session.`);
      sendGeometry();
      draw();
      // Fetched, never assumed, and re-fetched on every attachment rather than cached across
      // one: a client running from a stale page must show the SERVER's address space, which is
      // the whole reason `coden-address-book.mjs` refuses to cache it either.
      call('coden.addresses', {})
        .then((result) => { addressBook = result?.addresses ?? result ?? []; refreshMenu(); draw(); })
        .catch((error) => { record('error', `The address list is unavailable: ${error.message}`); draw(); });
      return;
    }
    if (frame.type === 'session.changed') {
      // The push half of "live at the same time": another viewport of this account changed the
      // session. Announced rather than silently re-read, because a screen that updates with no
      // explanation is a screen the reader stops trusting.
      record('note', `Another viewport ran ${frame.method}.`);
      draw();
      return;
    }
    if (frame.type === 'viewport.attached') { record('note', 'Another viewport attached to this session.'); draw(); return; }
    if (frame.type === 'viewport.detached') { record('note', 'A viewport detached from this session.'); draw(); return; }
  }

  function sendGeometry() {
    if (!socket || socket.readyState !== 1) return;
    socket.send(JSON.stringify({ id: nextId += 1, method: 'viewport.resize', params: { columns: terminal.cols, rows: terminal.rows } }));
  }

  function connect() {
    if (disposed) return;
    setState(attempt === 0 ? TerminalState.CONNECTING : TerminalState.RECONNECTING);
    let opened;
    try {
      opened = new WebSocketImpl(bridgeUrl(location));
    } catch (error) {
      return scheduleReconnect(error.message);
    }
    socket = opened;

    opened.addEventListener('message', (event) => {
      let frame;
      try { frame = JSON.parse(event.data); } catch { return; }
      try { onFrame(frame); } catch (error) { setState(TerminalState.FAILED, error.message); }
    });

    opened.addEventListener('close', (event) => {
      failPending('the connection closed');
      if (disposed) return;
      // The socket that closed is no longer the current one — `disposeSocket()` already
      // replaced it with `null` after a deliberate detach. Without this line `/logout` closes
      // the socket, this handler treats it as a dropped link, and the viewport reconnects
      // itself: the product undoing what the person just asked it to do.
      if (socket !== opened) return;
      // 1008 is the bridge's policy refusal and 1011 its internal error; neither is fixed by
      // trying again, and retrying a refusal is how a client turns one rejection into a
      // rate-limit. Everything else is treated as a network event and retried.
      if (event.code === 1008) return setState(TerminalState.REFUSED, 'This session is not permitted to attach. Sign in again.');
      scheduleReconnect(event.reason || `closed (${event.code})`);
    });

    // `error` carries no detail by design in browsers — the close event that follows it does.
    opened.addEventListener('error', () => { /* handled by close */ });
  }

  /** Close the socket and STAY closed. Distinct from a network drop on purpose: `/logout`
   *  detached this viewport deliberately, and reconnecting after it would undo what the person
   *  just asked for — the difference between "the link broke" and "I left". */
  function disposeSocket(reason) {
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
    failPending(reason);
    const closing = socket;
    socket = null;
    try { closing?.close(1000, 'detached'); } catch { /* already gone */ }
    setState(TerminalState.IDLE, `Detached — ${reason}. Reload to attach again.`);
  }

  function scheduleReconnect(reason) {
    if (disposed) return;
    const delay = BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)];
    attempt += 1;
    // Jitter: every viewport of this account lost the socket at the same instant, and returning
    // in lockstep is how they collectively trip the handshake budget on the way back.
    const jittered = delay + Math.floor(Math.random() * 250);
    setState(TerminalState.RECONNECTING, `Reconnecting in ${Math.round(jittered / 1000)}s — ${reason}`);
    record('error', `Disconnected: ${reason}`);
    draw();
    reconnectTimer = setTimeout(connect, jittered);
  }

  /** `say(view, kind, text, detail)`, with the kind first — it validates against
   *  `TRANSCRIPT_KINDS` and THROWS on an unknown one. Wrapped exactly as `tui-fullscreen.mjs`
   *  wraps it (`record`), so the two shells put the same shapes into the same transcript. */
  const record = (kind, text, detail) => say(view, kind, text, detail);

  /** The entries this account is offered, from the one registry, filtered and declared filtered
   *  — the same call the terminal shell makes. A shell that built its own list is `PANEL_NAMES`. */
  const offered = () => menuFor(account);

  /** The menu frame under the current prompt. `menuFrame(parsed, {commands, addresses})`, where
   *  `parsed` comes from `parseCommandPrompt` — not a bag of functions, which is what the first
   *  version of this file passed. Drawn only while the prompt begins with `/`, exactly as
   *  `renderFrame` expects. */
  function refreshMenu() {
    const prompt = String(view.prompt ?? '');
    if (!prompt.startsWith('/')) { view.menu = null; return; }
    const menu = offered();
    const frame = menuFrame(parseCommandPrompt(prompt), { commands: menu.entries, addresses: addressBook });
    view.menu = frame ? { ...frame, note: hiddenNote(menu), keys: promptKeys(frame) } : null;
  }

  terminal.onData((data) => {
    const intent = decodeInput(data);
    if (intent.kind === 'ignore') return;
    // Prompt editing lives here because the two shells decode keys differently and must: this
    // one gets bytes from xterm.js, the other gets parsed keypresses from readline. What a
    // finished line MEANS is `planTurn`, which is shared, and that is the boundary that matters.
    const prompt = String(view.prompt ?? '');
    if (intent.kind === 'text') view.prompt = prompt + intent.text;
    else if (intent.kind === 'backspace') view.prompt = [...prompt].slice(0, -1).join('');
    else if (intent.kind === 'kill-line') view.prompt = '';
    else if (intent.kind === 'escape') view.prompt = prompt.startsWith('/') ? '' : prompt;
    else if (intent.kind === 'interrupt') { view.prompt = ''; record('note', 'Cancelled.'); }
    else if (intent.kind === 'clear') view.transcript = [{ kind: 'note', text: CLEARED_NOTE }];
    // The arrows are DECODED so they can never be inserted into the prompt as raw bytes — that
    // safety property is the main reason `decodeInput` knows about them at all — but this shell
    // does not yet move anything with them. `tui-fullscreen.mjs` uses ↑↓ to walk the `/` menu,
    // and doing the same here needs the menu's selection state, which the shared view model does
    // not carry: the terminal shell keeps it in its own keypress loop.
    //
    // **Declared, not hidden** (`noesar-evolution` rule 3: if you build for one shell, say what
    // the other one does). Said ONCE per attachment rather than on every press, because a hint
    // repeated on every keystroke is noise the reader learns to scroll past.
    else if (['up', 'down', 'left', 'right'].includes(intent.kind)) {
      if (!arrowsExplained) {
        arrowsExplained = true;
        record('note', 'Arrow keys do not move the menu in this viewport yet — type to filter it. They do move it over `ssh`.');
      }
    }
    else if (intent.kind === 'submit') {
      const line = prompt.trim();
      view.prompt = '';
      refreshMenu();
      if (line) { submit(line); return; }
    }
    refreshMenu();
    draw();
  });

  /** One typed line, resolved through the SAME `planTurn` the terminal shell drives, with the
   *  same four collaborators. Every branch below mirrors `tui-fullscreen.mjs`'s handling so the
   *  two shells give the same answer to the same line — `CE-033`'s "le due shell non divergono". */
  async function submit(typed) {
    const menu = offered();
    const turn = planTurn(typed, {
      resolve: (text) => resolveCommand(text, menu),
      parse: parseCommandPrompt,
      commands: menu,
      groups: groupMenu,
    });

    if (turn.kind === 'empty') return draw();
    if (turn.kind === 'help') { record('agent', 'Commands:', turn.lines); return draw(); }
    if (turn.kind === 'clear') { view.transcript = [{ kind: 'note', text: CLEARED_NOTE }]; return draw(); }
    if (turn.kind === 'unknown') { record('error', turn.message); return draw(); }
    if (turn.kind === 'confirm') { record('note', turn.message); return draw(); }
    if (turn.kind === 'needs-argument') { record('note', turn.message); return draw(); }
    if (turn.kind === 'form') {
      const begun = startForm(turn.command, turn.argument);
      if (!begun || begun.error) { record('error', begun?.error ?? `\`/${turn.command}\` has no form here.`); return draw(); }
      view.form = begun.form;
      record('agent', begun.ask);
      record('note', 'Answer one line at a time. `/cancel` abandons it.');
      return draw();
    }
    if (turn.kind === 'session') {
      // `/logout` and friends end the ATTACHMENT here, not a TTY: this shell has no screen to
      // restore, so it closes the socket and says so rather than pretending to exit.
      record('note', 'Detaching this viewport.');
      draw();
      disposeSocket('detached by /logout');
      return;
    }
    if (turn.kind !== 'call') { draw(); return; }

    record('user', typed);
    draw();
    try {
      const result = await call(turn.method, turn.params);
      record('agent', typeof result === 'string' ? result : JSON.stringify(result, null, 2));
    } catch (error) {
      // Errors are said into the transcript, never swallowed and never thrown at the console:
      // a terminal that silently does nothing is the failure mode this product has already
      // shipped once, and the person typing has no other channel.
      record('error', `${error.kind ? `${error.kind}: ` : ''}${error.message}`);
    }
    draw();
  }

  function measure() {
    const box = host.getBoundingClientRect();
    // xterm exposes the measured cell box through its renderer; when it has not measured yet
    // (the host is display:none, which is exactly the case on a hidden view) fall back rather
    // than dividing by zero and asking the server for a viewport of Infinity columns.
    const cell = terminal._core?._renderService?.dimensions?.css?.cell;
    return geometryFor({ width: box.width, height: box.height, cellWidth: cell?.width, cellHeight: cell?.height });
  }

  function resize() {
    const { columns, rows } = measure();
    if (columns === terminal.cols && rows === terminal.rows) return;
    terminal.resize(columns, rows);
    sendGeometry();
    draw();
  }

  terminal.open(host);
  resize();
  connect();

  // The region resizes with the window, the sidebar and the reader's zoom — not only with
  // `window.onresize`. A ResizeObserver watches the box itself, which is the thing that
  // actually determines the geometry (§5: the CodeN region, never the viewport).
  if (typeof ResizeObserver === 'function') {
    observer = new ResizeObserver(() => resize());
    observer.observe(host);
  }

  return {
    state: () => state,
    resize,
    terminal,
    dispose() {
      disposed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      observer?.disconnect();
      failPending('the terminal was closed');
      try { socket?.close(1000, 'viewport closed'); } catch { /* already gone */ }
      terminal.dispose();
    },
  };
}

const DEFAULT_STATUS = Object.freeze({
  [TerminalState.IDLE]: 'Not connected.',
  [TerminalState.CONNECTING]: 'Connecting to the session…',
  [TerminalState.LIVE]: 'Attached.',
  [TerminalState.RECONNECTING]: 'Reconnecting…',
  [TerminalState.REFUSED]: 'Not permitted to attach.',
  [TerminalState.FAILED]: 'This terminal could not start.',
});
