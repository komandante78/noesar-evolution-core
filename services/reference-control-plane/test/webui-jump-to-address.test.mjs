// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The one box: `/` and Ctrl K reach the same box, and it answers with addresses as well as
// with content.
//
// The Owner's objection to the workbench was "too many menus", and the accepted answer is a
// single jump-to-address mechanism. The obvious build — a command-palette overlay summoned
// by `/` — would have missed the objection: the top bar already carries a search box on
// Ctrl K, so an overlay would have ADDED a navigation widget while the complaint was about
// how many there are. These tests hold that line, and three properties under it:
//
//  * the list of addresses is read off the interface, never written out beside it (the rule
//    phase 1 established after "not built" survived a working TUI for months);
//  * `/` uses the SAME typing guard `[` and `]` already use, not a second opinion about
//    what counts as typing — a shortcut that fires while someone writes a message is a
//    defect wearing a shortcut's clothes;
//  * every kind of thing the server's search can return leads somewhere. Those rows were
//    rendered as <button> with no handler at all: eight kinds of result, each one a control
//    that did nothing when clicked.
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '../../..');
const html = readFileSync(join(root, 'apps/webui-static/index.html'), 'utf8');
const app = readFileSync(join(root, 'apps/webui-static/app.js'), 'utf8');
const css = readFileSync(join(root, 'apps/webui-static/styles.css'), 'utf8');
const workspace = readFileSync(join(root, 'services/reference-control-plane/src/ai-workspace/workspace-service.mjs'), 'utf8');

/** A named function's body, by brace balance — the checks below are about what one function
 *  contains, and a slice between two string markers breaks the moment code moves. */
function functionBody(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start > 0, `${name} is gone`);
  const open = source.indexOf('{', start);
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    else if (source[index] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(open, index + 1);
    }
  }
  throw new Error(`${name} is not brace-balanced`);
}

describe('the one box is the only new navigation widget', () => {
  test('there is no second search or palette element beside the existing box', () => {
    // One input in the top bar, one popover under it. A dialog/overlay added for the same
    // job would show up here as a second element with the same purpose.
    assert.equal((html.match(/id="globalSearch"/g) ?? []).length, 1);
    assert.equal((html.match(/id="globalSearchResults"/g) ?? []).length, 1);
    assert.doesNotMatch(html, /id="commandPalette"|class="[^"]*command-palette/);
  });

  test('the box is a combobox over a listbox, not a bare input', () => {
    const input = html.match(/<input id="globalSearch"[^>]*>/)?.[0] ?? '';
    for (const attribute of ['role="combobox"', 'aria-expanded', 'aria-controls="globalSearchResults"', 'aria-autocomplete="list"']) {
      assert.ok(input.includes(attribute), `the box is missing ${attribute}`);
    }
    assert.match(html.match(/<div id="globalSearchResults"[^>]*>/)?.[0] ?? '', /role="listbox"/);
    // Focus stays in the input, so the highlighted row is named rather than focused.
    assert.match(app, /aria-activedescendant/);
  });

  test('the highlighted row has a style — otherwise the selection is invisible', () => {
    assert.match(css, /\.search-popover button\.active\{/);
    assert.match(css, /\.palette-group\{/);
    // A highlight built only from colour disappears in forced-colours mode.
    assert.match(css, /forced-colors:active\)\{\n\s*\.search-popover button\.active\{border/);
  });
});

describe('the addresses are read off the interface, not written beside it', () => {
  test('addressBook() names no destination of its own', () => {
    const body = functionBody(app, 'addressBook');
    // It is allowed to know the selectors and the two Sessions places that have no menu
    // entry to be read from. Every other address must come out of the DOM.
    // `class="nav[^"]*"`, because Home ships as `class="nav active"` — an exact-class regex
    // silently found twelve of the thirteen and the count guard below is what said so.
    const destinations = [...html.matchAll(/<button class="nav[^"]*" data-view="([a-z-]+)"/g)].map((match) => match[1]);
    assert.ok(destinations.length >= 13, `only ${destinations.length} destinations found in the markup`);
    for (const view of destinations) {
      assert.ok(!new RegExp(`['"\`]${view}['"\`]`).test(body), `addressBook() names the destination "${view}"`);
    }
    // And it reads the three sources it should.
    assert.match(body, /\.nav/);
    assert.match(body, /\.settings-nav/);
    assert.match(body, /CODEN_REGIONS/);
  });

  test('a page this account may not open is never offered', () => {
    // applyNavAccess() hides those entries in the DOM; addressBook() skips hidden ones, so
    // the box cannot offer a page whose every request would answer 403. If this skip is
    // ever dropped, the gate becomes decoration in one more place.
    const body = functionBody(app, 'addressBook');
    assert.equal((body.match(/node\.hidden/g) ?? []).length, 2, 'both the sidebar and the Settings menu must be filtered by access');
  });
});

describe('the keys', () => {
  test('`D-0406` — a bare `/` no longer opens this box, and must not come back', () => {
    // Inverted on 2026-08-13, deliberately. `16` §4b.4 decided «nel prompt comanda: c'è una `/`
    // sola» on 2026-08-05, and nothing enforced it — this test was in fact enforcing the
    // OPPOSITE, which is why the ambiguity survived three months of green runs. Two gestures
    // shared one key: navigation here, and the agent's command menu inside CodeN, which since
    // `D-0404` is a terminal where every keystroke belongs to the prompt.
    //
    // Asserted as an absence, so the binding cannot quietly return. `Ctrl-K` is the box's key
    // and always was — the placeholder has advertised it all along.
    assert.doesNotMatch(app, /event\.key!=='\/'[^\n]*isTyping\(event\.target\)/,
      'the bare `/` palette binding is back: inside CodeN it would fight the prompt for the key');
    // `isTyping` itself stays — the sidebar keys still use it, and it was never the problem.
    assert.match(app, /function isTyping\(target\)/);
  });

  test('Ctrl K still opens the box it has always opened', () => {
    assert.match(app, /\(event\.ctrlKey\|\|event\.metaKey\)&&event\.key\.toLowerCase\(\)==='k'/);
  });

  test('the box does not open over the sign-in gate', () => {
    // The top bar is behind the auth gate at boot; focusing an invisible box would be a
    // keystroke that appears to do nothing.
    assert.match(functionBody(app, 'openPalette'), /authGate/);
  });
});

describe('every kind of result leads somewhere', () => {
  test('CONTENT_HOME covers every type the server search can return', () => {
    // Read from the service itself: `push('project', …)`, `push('memory', …)`. This is the
    // invariant that stops the dead buttons coming back — a ninth type added to the search
    // fails here instead of shipping as a row that does nothing when clicked.
    const served = [...workspace.matchAll(/push\('([a-z]+)',/g)].map((match) => match[1]);
    assert.ok(served.length >= 8, `only ${served.length} search types found; globalSearch moved`);
    const mapped = app.match(/const CONTENT_HOME=\{([^}]+)\}/)?.[1] ?? '';
    for (const type of new Set(served)) {
      assert.match(mapped, new RegExp(`\\b${type}:`), `search returns "${type}" results with no page to open`);
    }
  });

  test('a content row carries where it goes, or says it cannot', () => {
    // The row is honest about its limit: it opens the page that owns that kind of thing,
    // and nothing in this product has a per-item address yet.
    assert.match(app, /data-jump="\$\{escapeHtml\(home\)\}" title="Opens/);
    assert.match(app, /disabled title="This kind of result has no page of its own yet\."/);
  });

  test('going to an address activates the router once', () => {
    const body = functionBody(app, 'jumpTo');
    // navigate() would activate here and then again on the hashchange its own rewrite
    // fires. Inside the workbench a panel move is the phase-1 in-page move, with no refetch.
    assert.doesNotMatch(body, /navigate\(/);
    assert.match(body, /goToCodenPanel/);
    assert.match(body, /location\.hash=want/);
  });
});
