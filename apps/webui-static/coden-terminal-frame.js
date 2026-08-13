// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The child half of the embedded terminal — `D-0418`.
//
// This module runs inside `coden-terminal.html`, the one document allowed to apply inline
// styles. It does three things and deliberately no more:
//
//   1. mounts the emulator with a palette derived from the PRODUCT's theme tokens,
//   2. tells the parent what state the attachment is in, so the visible status line, the live
//      region and `data-terminal-state` stay where the rest of the interface can see them,
//   3. follows the parent when the operator changes theme or text size.
//
// It holds no authority of its own. The socket it opens is the same `WS /ws/coden` the parent
// would have opened, authenticated by the same same-origin session cookie — an iframe of the
// same origin is not a weaker caller, it is the same caller in a second document.
import { mountCodenTerminal } from './coden-terminal.js';

/** The parent is the only correspondent, and it is verified twice: same origin AND the actual
 *  window that framed this one. A message from anything else is dropped without a reply — an
 *  embedded document that answers whoever writes to it is a hole, not a feature. */
const PARENT = window.parent;
const ORIGIN = window.location.origin;

/** The palette, read from the product's own custom properties. Named tokens rather than literal
 *  colours: the nine themes redefine these, so the terminal changes with them instead of being a
 *  tenth theme nobody maintains. Every value is resolved from the live computed style, so a
 *  theme added later needs no edit here. */
function paletteFromTokens() {
  const style = getComputedStyle(document.documentElement);
  const token = (name, fallback) => {
    const value = style.getPropertyValue(name).trim();
    return value || fallback;
  };
  return {
    background: token('--surface-code', '#0b1020'),
    foreground: token('--text-code', '#e7eeff'),
    cursor: token('--accent-brand', '#82a7ff'),
    cursorAccent: token('--surface-code', '#0b1020'),
    selectionBackground: token('--accent-wash-strong', 'rgba(72,113,255,.23)'),
    black: token('--surface-root', '#070b16'),
    red: token('--red', '#ff6b6b'),
    green: token('--green', '#4ade80'),
    yellow: token('--amber', '#fbbf24'),
    blue: token('--blue', '#60a5fa'),
    magenta: token('--accent-fill-to', '#6442d6'),
    cyan: token('--cyan', '#22d3ee'),
    white: token('--text-primary', '#eef4ff'),
    // The bright half is the same hue set: the renderer uses dim/normal, not sixteen distinct
    // colours, and inventing eight more would be inventing contrast nobody measured.
    brightBlack: token('--muted', '#8d9ab0'),
    brightRed: token('--red', '#ff6b6b'),
    brightGreen: token('--green', '#4ade80'),
    brightYellow: token('--amber', '#fbbf24'),
    brightBlue: token('--blue', '#60a5fa'),
    brightMagenta: token('--accent-link', '#7ea1ff'),
    brightCyan: token('--cyan', '#22d3ee'),
    brightWhite: token('--text-primary', '#eef4ff'),
  };
}

function tell(message) {
  if (PARENT === window) return;
  PARENT.postMessage({ ...message, channel: 'coden-terminal' }, ORIGIN);
}

const host = document.querySelector('#terminalHost');
let terminal = null;

try {
  terminal = mountCodenTerminal({
    host,
    // No status element in this document: the visible one belongs to the parent's region, and
    // two writers for one state is the race `coden-terminal.js` already refuses.
    statusEl: null,
    theme: paletteFromTokens(),
    onState: (state, detail) => tell({ type: 'state', state, detail }),
  });
} catch (error) {
  // Said to the parent rather than swallowed: a blank iframe is indistinguishable from a slow
  // one, and this document has no status line of its own to fail into.
  tell({ type: 'state', state: 'failed', detail: `This terminal could not start: ${error.message}` });
  throw error;
}

window.addEventListener('message', (event) => {
  if (event.origin !== ORIGIN || event.source !== PARENT) return;
  const data = event.data;
  if (!data || data.channel !== 'coden-terminal') return;
  if (data.type === 'theme') {
    // The document's own theme attribute first — the palette is READ from the tokens it selects,
    // so the order matters: set it, then re-read, then hand the result to the emulator.
    if (typeof data.theme === 'string' && data.theme) document.documentElement.dataset.theme = data.theme;
    if (typeof data.textScale === 'string' && data.textScale) {
      document.documentElement.style.setProperty('--text-scale', data.textScale);
    }
    terminal?.setTheme(paletteFromTokens());
    return;
  }
  if (data.type === 'focus') { terminal?.focus(); }
});

// The parent cannot see this document's readiness any other way, and it needs to know before it
// forwards the current theme.
tell({ type: 'ready' });
