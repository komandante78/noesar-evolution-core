// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The CodeN terminal's pure decisions — no DOM, no socket, no xterm.
//
// Split out of `coden-terminal.js` so they can be TESTED. That file imports 345 KB of browser
// code at module load, which touches `document`, so it cannot be imported under Node at all —
// and a first attempt at testing it lifted these functions out by balancing braces over the
// source text, which is a parser nobody asked for and it broke on the first run. Three functions
// in their own file is the honest version of the same idea.
//
// It lives in `apps/shared/coden/` rather than beside the page for the reason that tree exists:
// it is imported by the browser over `/shared/` and by Node in the suite, so it may assume
// NEITHER runtime's globals — which `eslint.config.mjs` now enforces for everything here.

/**
 * Decode one chunk of terminal input into an intent.
 *
 * xterm.js hands over raw bytes; `tui-fullscreen.mjs` gets `{name, ctrl}` from readline. This is
 * the only place the two shells legitimately differ, so it is small, total, and returns the same
 * vocabulary the other decoder produces. Exported for its own test — an input decoder proved
 * only through a browser is a decoder proved by nobody.
 */
export function decodeInput(data) {
  if (data === '\r' || data === '\n') return { kind: 'submit' };
  if (data === '' || data === '\b') return { kind: 'backspace' };
  if (data === '') return { kind: 'escape' };
  if (data === '') return { kind: 'interrupt' };   // Ctrl-C
  if (data === '') return { kind: 'clear' };       // Ctrl-L
  if (data === '') return { kind: 'kill-line' };   // Ctrl-U
  if (data === '\t') return { kind: 'tab' };         // completes the menu highlight, never sends
  if (data === '[A') return { kind: 'up' };
  if (data === '[B') return { kind: 'down' };
  if (data === '[C') return { kind: 'right' };
  if (data === '[D') return { kind: 'left' };
  // Anything else beginning with ESC is a sequence this shell does not act on. Returning
  // `ignore` rather than falling through to `text` matters: inserting the raw bytes of an
  // unhandled arrow key into the prompt is how a terminal starts printing `^[[5~` at people.
  if (data.startsWith('')) return { kind: 'ignore' };
  // C0 controls that reached here have no binding. Same reasoning.
  if (data.length === 1 && data.charCodeAt(0) < 0x20) return { kind: 'ignore' };
  return { kind: 'text', text: data };
}

/**
 * Split one raw chunk into the pieces `decodeInput` can decide about, in order.
 *
 * xterm.js does NOT promise one keystroke per `onData`. It hands over whatever arrived in the
 * same tick: a paste is one chunk, and so is a fast typist whose last character and Enter land
 * together. `decodeInput` is total but single-minded — it tests the chunk for equality with
 * `\r`, so `"l\r"` is not a submit, it is the literal text `l\r` appended to the prompt. The
 * line then never sends, a carriage return sits invisibly inside the prompt, and the next Enter
 * submits a line whose first character is stale. That is a lost line, with no error anywhere.
 *
 * Splitting HERE, rather than teaching `decodeInput` a compound intent, is deliberate: the
 * decoder's vocabulary is shared with `tui-fullscreen.mjs` (which gets parsed keypresses from
 * readline and can never see a batched chunk), and a `text-submit` kind would be a word one
 * shell speaks and the other cannot. Segmentation is a property of the transport, so it stays
 * on the transport's side of the seam.
 *
 * `CRLF` collapses to one submit: a paste from a Windows editor must not submit the line and
 * then an empty one after it.
 */
export function segmentInput(data) {
  const raw = String(data ?? '');
  // One character, or an ESC-led sequence: `decodeInput` already decides these whole, and
  // splitting an escape sequence would turn one arrow key into three printable characters.
  if (raw.length <= 1 || raw.startsWith('\x1b')) return [raw];
  const segments = [];
  let text = '';
  let previous = '';
  for (const character of raw) {
    if (character === '\r' || character === '\n') {
      if (text) { segments.push(text); text = ''; }
      if (!(character === '\n' && previous === '\r')) segments.push('\n');
    } else {
      text += character;
    }
    previous = character;
  }
  if (text) segments.push(text);
  return segments;
}

/**
 * Columns and rows for a box, given one character's measured size.
 *
 * Derived, never fixed. The design (§5) requires the terminal to fill the CodeN **content
 * region** and not the browser viewport, so the geometry is whatever that region happens to be —
 * and it changes when the sidebar collapses, when the window resizes, and when the reader zooms.
 * Clamped at the bottom because `renderFrame` itself clamps to 40x10, and a frame rendered for a
 * region smaller than that would be clipped by the emulator rather than laid out for it.
 */
export function geometryFor({ width, height, cellWidth, cellHeight }) {
  if (!(cellWidth > 0) || !(cellHeight > 0)) return { columns: 80, rows: 24 };
  return {
    columns: Math.max(40, Math.floor(width / cellWidth) || 40),
    rows: Math.max(10, Math.floor(height / cellHeight) || 10),
  };
}

/** `wss:` on a secure page, `ws:` otherwise, same host. Derived from the document rather than
 *  configured: this product is self-hosted under whatever host the Owner reaches it on, and a
 *  configured URL would be wrong on every installation but the one it was written for. It is
 *  also what keeps the Origin check on the server satisfiable. */
export function bridgeUrl(location) {
  const scheme = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${scheme}//${location.host}/ws/coden`;
}
