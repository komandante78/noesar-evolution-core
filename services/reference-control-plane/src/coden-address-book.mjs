// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The product's address list, read from the interface that owns it.
//
// Phase 1 made every workbench panel an address and put the list of them in exactly one
// place: the markup's own `data-bench-panel`/`data-agent-panel` attributes. Phase 2 built
// the `/` jump on top of that list, in the browser, by reading the DOM. Phase 4 gives the
// terminal shell the same `/` — and the terminal has no DOM.
//
// The wrong build is obvious and was rejected: let tools/tui-client.mjs carry its own list
// of panels. It already did, and that list had already drifted — fourteen names against the
// markup's twenty-five, with the agent column's and the bench's names flattened into one
// namespace and eleven bench panels simply missing. Nobody had noticed, because a list that
// is only ever compared to itself always agrees. That is the same failure that let the
// sidebar advertise the TUI as "not built" for as long as the TUI had been working.
//
// So the terminal does not get a copy. It gets the list, over the wire, derived here from
// the same file the browser renders — one fact, one copy, two shells. A client running from
// a stale checkout therefore shows the SERVER's address space, not its own, which is the
// point: "the same live session as the workbench" has to mean the same product.
//
// What this module deliberately does NOT do:
//  - It does not say which addresses a given account may open. The browser's box filters by
//    `hidden` in the DOM (applyNavAccess), a client-side fact this transport does not carry.
//    Nothing here leaks: these are label strings out of a static file every signed-in client
//    is already served. But the terminal's list is not access-filtered, and it says so.
//  - It does not say which addresses a given TRANSPORT can render. That is the client's own
//    business — a map from address to protocol call — and putting it here would make the
//    server assert something about a shell it cannot see.
//  - It does not name `settings/sessions/archived` and `settings/sessions/bin`. The browser's
//    box names those two by hand because they are pages with no menu entry of their own;
//    repeating them here would be a second hand-written pair, which is the thing this file
//    exists to stop. The terminal reaches both with `sessions archived` / `sessions bin`.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** The two regions of CodeN's address space, by the attribute that defines each — the same
 *  pair `CODEN_REGIONS` declares in app.js, and for the same reason: the panel NAMES are not
 *  written down anywhere, only the attribute that carries them. */
const PANEL_ATTRIBUTES = { bench: 'data-bench-panel', agent: 'data-agent-panel' };

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", apos: "'", nbsp: ' ' };

function decodeEntities(text) {
  return text.replace(/&(amp|lt|gt|quot|#39|apos|nbsp);/g, (_match, name) => ENTITIES[name]);
}

/** Text as a reader sees it: markup removed, whitespace collapsed, entities decoded. The
 *  order matters — decoding first would turn `&lt;b&gt;` into a tag this then strips. */
function textOf(fragment) {
  return decodeEntities(fragment.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
}

/** The full source of one element, from its opening tag at `start` to its matching close.
 *  Counted rather than matched lazily: a panel that contains a nested <section> (the bench's
 *  Closure panel does) would otherwise end at the inner close tag and lose everything after
 *  it, which is how a parser quietly returns half a panel. */
export function elementSlice(html, start, tag) {
  const open = new RegExp(`<${tag}\\b`, 'g');
  const close = new RegExp(`</${tag}>`, 'g');
  let depth = 0;
  let index = start;
  for (;;) {
    open.lastIndex = index;
    close.lastIndex = index;
    const nextOpen = open.exec(html);
    const nextClose = close.exec(html);
    if (!nextClose) return html.slice(start); // unbalanced markup: give what there is
    if (nextOpen && nextOpen.index < nextClose.index) {
      depth += 1;
      index = nextOpen.index + 1;
      continue;
    }
    depth -= 1;
    index = nextClose.index + 1;
    if (depth <= 0) return html.slice(start, nextClose.index + tag.length + 3);
  }
}

/** A nav entry's label is its first <span> that is not a badge — the same
 *  `span:not(.nav-count):not(.nav-flag)` selector the browser's own address book uses. */
function navLabel(inner) {
  for (const match of inner.matchAll(/<span([^>]*)>([\s\S]*?)<\/span>/g)) {
    if (/nav-count|nav-flag/.test(match[1])) continue;
    const label = textOf(match[2]);
    if (label) return label;
  }
  return '';
}

/**
 * Every address the interface declares, in the order the interface declares it.
 *
 * `declaredEmpty` carries the panel's own `<p class="declared-empty">` paragraphs, and ONLY
 * those. The class is the product's marker for "this text is a statement about the product",
 * as opposed to a placeholder standing in for data that has not loaded yet — Closure's
 * "Nothing closed yet." and the Navigator lists' "—" are the second kind, and a shell that
 * printed them would be reporting an empty list it never asked for. Reading the marker
 * instead of guessing from the tag is the same rule the `<code class="cmd">` convention
 * already established for the documented commands.
 */
export function parseCodenAddressBook(html) {
  const addresses = [];

  for (const match of html.matchAll(/<button class="nav[^"]*" data-view="([^"]+)"[^>]*>([\s\S]*?)<\/button>/g)) {
    const label = navLabel(match[2]);
    if (label) addresses.push({ address: match[1], kind: 'Page', label });
  }

  for (const match of html.matchAll(/<button class="settings-nav[^"]*"[^>]*data-section="([^"]+)"[^>]*>([\s\S]*?)<\/button>/g)) {
    const label = textOf(match[2]);
    if (label) addresses.push({ address: `settings/${match[1]}`, kind: 'Settings', label });
  }

  for (const [region, attribute] of Object.entries(PANEL_ATTRIBUTES)) {
    for (const match of html.matchAll(new RegExp(`<section[^>]*${attribute}="([^"]+)"[^>]*>`, 'g'))) {
      const panel = match[1];
      const slice = elementSlice(html, match.index, 'section');
      const heading = slice.match(/<h3[^>]*>([\s\S]*?)<\/h3>/);
      addresses.push({
        address: `coden/${region}/${panel}`,
        kind: region === 'bench' ? 'Bench' : 'Agent',
        region,
        panel,
        label: heading ? textOf(heading[1]) : panel,
        declaredEmpty: [...slice.matchAll(/<p class="declared-empty">([\s\S]*?)<\/p>/g)]
          .map((paragraph) => textOf(paragraph[1]))
          .filter(Boolean),
      });
    }
  }

  return addresses;
}

/** Read from the same directory server.mjs serves the WebUI out of, so the list a terminal
 *  is told about and the list a browser is shipped are the same bytes. Not cached: this is
 *  called once per terminal session, and a cache would answer for a file that changed under
 *  a redeploy the process survived. */
export function buildCodenAddressBook(webRoot) {
  return parseCodenAddressBook(readFileSync(join(webRoot, 'index.html'), 'utf8'));
}
