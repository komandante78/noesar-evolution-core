// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Phase 4: the parser that lets a terminal be told the address space without keeping a copy
// of it. Every assertion here is against the REAL apps/webui-static/index.html, because a
// parser proved only against a fixture proves that the fixture parses.
//
// The property under test is not "it finds some addresses". It is that what it finds is
// exactly what the markup declares — the same attributes the browser's own router and
// address box read — so that the two shells cannot come to disagree about what exists.

import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseCodenAddressBook, buildCodenAddressBook, elementSlice } from '../src/coden-address-book.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '../../..');
const webRoot = join(root, 'apps/webui-static');
const html = readFileSync(join(webRoot, 'index.html'), 'utf8');
const book = buildCodenAddressBook(webRoot);
const byAddress = new Map(book.map((entry) => [entry.address, entry]));

/** Every value of `attr` in the markup, in document order — the same helper
 *  coden-addressable-panels.test.mjs uses, and for the same reason: the expected list is
 *  read from the markup rather than typed out beside it. */
function values(attr) {
  return [...html.matchAll(new RegExp(`${attr}="([^"]+)"`, 'g'))].map((match) => match[1]);
}

describe('the address book is the markup, read back', () => {
  test('the panels it finds are exactly the panels the markup declares, in order', () => {
    for (const [region, attr] of [['bench', 'data-bench-panel'], ['agent', 'data-agent-panel']]) {
      assert.deepEqual(
        book.filter((entry) => entry.region === region).map((entry) => entry.panel),
        values(attr),
        `the ${region} region's panels do not match the markup`,
      );
    }
  });

  test('the pages and settings sections it finds are exactly the ones the sidebar and menu declare', () => {
    assert.deepEqual(
      book.filter((entry) => entry.kind === 'Page').map((entry) => entry.address),
      [...html.matchAll(/<button class="nav[^"]*" data-view="([^"]+)"/g)].map((match) => match[1]),
    );
    // From the MENU's buttons, not from every `data-section` in the file: the sections
    // themselves carry the same attribute, so counting attributes would count each twice.
    assert.deepEqual(
      book.filter((entry) => entry.kind === 'Settings').map((entry) => entry.address),
      [...html.matchAll(/<button class="settings-nav[^"]*"[^>]*data-section="([^"]+)"/g)].map((match) => `settings/${match[1]}`),
    );
  });

  test('every entry carries a label a person can read', () => {
    // The browser's own address box drops an entry with no label (`add()` refuses one), so
    // an unlabelled entry here would be an address the two shells disagree about.
    for (const entry of book) assert.ok(entry.label && entry.label.trim(), `${entry.address} has no label`);
    assert.equal(byAddress.get('coden/bench/diff').label, 'Diff');
    assert.equal(byAddress.get('coden/agent/activity').label, 'Agent activity');
  });

  test('a long panel is read whole, from its own tag to its own close', () => {
    // Closure is the longest — a <section> holding a form, a second heading and a list.
    assert.equal(byAddress.get('coden/bench/closure').label, 'Closure — stage 16');
    const slice = elementSlice(html, html.indexOf('<section class="bench-panel" data-bench-panel="closure"'), 'section');
    assert.ok(slice.includes('closureForm'), 'the slice stops before the panel does');
    assert.ok(slice.endsWith('</section>'));
    assert.ok(!slice.includes('data-bench-panel="projects"'), 'the slice runs past the panel it is for');
  });

  test('a panel containing another section is still read whole — proved on markup, not on hope', () => {
    // No panel nests a <section> TODAY (Closure nests <div>s), so the depth counting in
    // elementSlice is not exercised by the interface as it stands: a lazy first-close match
    // would pass every other assertion in this file. Found by mutating the counter and
    // watching nothing fail. Untested robustness is robustness that turns out not to work
    // on the day it is first needed, so the case is made here explicitly — without the
    // count, `label` below is "Inner" and the panel's own declared paragraph is lost.
    const nested = '<section class="bench-panel" data-bench-panel="outer"><h3>Outer</h3>'
      + '<section class="inner"><h3>Inner</h3></section>'
      + '<p class="declared-empty">The paragraph after the inner section.</p></section>';
    const parsed = parseCodenAddressBook(nested);
    assert.equal(parsed.length, 1);
    assert.equal(parsed[0].label, 'Outer');
    assert.deepEqual(parsed[0].declaredEmpty, ['The paragraph after the inner section.']);
  });

  test('entities are decoded — proved on markup that has some, since today\'s panels do not', () => {
    // Nothing the parser captures out of the current interface carries an entity, so this
    // too passed with the decoding removed. A panel whose declared text says «"None" is an
    // answer» is one edit away (the Closure hint already says exactly that, a few tags out
    // of reach), and it must not arrive at a terminal as `&quot;None&quot;`.
    const withEntities = '<section data-bench-panel="quoted"><h3>Risk &amp; residue</h3>'
      + '<p class="declared-empty">&quot;None&quot; is an answer; silence is not.</p></section>';
    const [entry] = parseCodenAddressBook(withEntities);
    assert.equal(entry.label, 'Risk & residue');
    assert.deepEqual(entry.declaredEmpty, ['"None" is an answer; silence is not.']);
  });

  test('declaredEmpty carries the product\'s own declared statements — and only those', () => {
    // `<p class="declared-empty">` is the product's marker for "this is a statement about
    // the product". A placeholder standing in for data that has not loaded is not one, and
    // a shell that printed it would report an empty list it never asked for. Closure's
    // "Nothing closed yet." and the Navigator lists' "—" are that second kind.
    assert.match(byAddress.get('coden/bench/tests').declaredEmpty[0], /nothing here has ever run a plan-declared command/);
    assert.deepEqual(byAddress.get('coden/bench/closure').declaredEmpty, []);
    assert.deepEqual(byAddress.get('coden/bench/projects').declaredEmpty, []);
    // Activity declares five of them, under five headings, and all five are the product
    // speaking. The old hand-copied table in tui-client.mjs carried two, merged into one
    // sentence that appears nowhere in the interface.
    assert.equal(byAddress.get('coden/agent/activity').declaredEmpty.length, 5);
  });

  test('markup is stripped and entities decoded, so nothing prints as tags in a terminal', () => {
    const logs = byAddress.get('coden/bench/logs').declaredEmpty.join(' ');
    assert.doesNotMatch(logs, /<[a-z/]/);
    assert.match(logs, /causal event trail of this piece of work/);
    for (const entry of book) {
      assert.doesNotMatch(entry.label, /&(amp|lt|gt|quot|#39|nbsp);/, `${entry.address} label carries a raw entity`);
    }
  });

  test('it names no address the markup does not carry — including the two the browser adds by hand', () => {
    // app.js names `settings/sessions/archived` and `settings/sessions/bin` itself, because
    // they are pages with no menu entry. Repeating them here would be a second hand-written
    // pair — the exact arrangement this module exists to end. The terminal reaches both
    // through `sessions archived` / `sessions bin`.
    assert.equal(byAddress.has('settings/sessions/archived'), false);
    assert.equal(byAddress.has('settings/sessions/bin'), false);
    assert.equal(new Set(book.map((entry) => entry.address)).size, book.length, 'duplicate addresses');
  });

  test('a document with no interface in it yields nothing, rather than inventing a default', () => {
    assert.deepEqual(parseCodenAddressBook('<html><body><p>nothing here</p></body></html>'), []);
  });
});
