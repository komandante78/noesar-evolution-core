// SPDX-License-Identifier: AGPL-3.0-or-later
//
// `D-0405` slice 1 — the declaration and the markup say the same thing, or this fails.
//
// # What this file is for, and why it is written to die
//
// The 25 CodeN panels used to exist in exactly one place: the `data-bench-panel` and
// `data-agent-panel` attributes of `apps/webui-static/index.html`. `coden-address-book.mjs`
// read them back with a regex, and that was the whole declaration — the browser owned the
// address space because the browser was the only thing that rendered it.
//
// `D-0404` collapses CodeN into one surface and slice 4 deletes those sections. So slice 1
// moves the declaration out first, into `apps/shared/coden/coden-addresses.js`. For exactly as
// long as BOTH exist, this file asserts they are identical: same panels, same order, same
// labels, same `declaredEmpty` sentences. That is what makes the move provably lossless
// *now* rather than provably lossless in hindsight, which is not a thing that exists.
//
// **This test is deliberately mortal.** Slice 4 removes the markup it reads, and this file goes
// with it — at which point the declaration becomes the sole source and nothing else changes.
// Deleting it then is correct and expected. Deleting it BEFORE slice 4 would mean the two
// sources could drift silently for a whole release, which is the precise failure `D-0300`
// recorded when `PANEL_NAMES` had drifted to fourteen entries against a markup of twenty-five
// and nobody noticed, because a list that is only ever compared to itself always agrees.
//
// # Why it compares against the parser rather than re-parsing here
//
// `parseCodenAddressBook()` is the oracle: it is the code that USED to produce the book, it is
// still exercised by `coden-address-book.test.mjs` against the real markup, and it already
// handles the two cases a fresh regex here would get wrong — nested `<section>` (the bench's
// Closure panel has one) and HTML entities. Writing a second parser to check the first would
// be testing a new parser, not the declaration.

import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseCodenAddressBook } from '../src/coden-address-book.mjs';
import { CODEN_PANELS, declaredCodenPanels } from '../../../apps/shared/coden/coden-addresses.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '../../..');
const indexHtml = join(root, 'apps/webui-static/index.html');

/** The panels as the markup declares them, through the parser that has always read them. */
function panelsInMarkup() {
  return parseCodenAddressBook(readFileSync(indexHtml, 'utf8')).filter((entry) => entry.region);
}

describe('the declared address space is the markup, until the markup goes', () => {
  test('the markup still exists — if it does not, this whole file should have been deleted', () => {
    // A guard against the quiet version of the failure: slice 4 removing the markup and this
    // file surviving as a test that passes because it compares two empty lists. If this line
    // ever fails, the fix is to delete this file, not to repair the assertion.
    assert.ok(existsSync(indexHtml), 'apps/webui-static/index.html is gone: delete this test file');
    assert.ok(panelsInMarkup().length > 0,
      'the markup declares no panels: slice 4 has run, so this test file must be deleted');
  });

  test('every panel, in the same order, with the same region', () => {
    assert.deepEqual(
      declaredCodenPanels().map((entry) => entry.address),
      panelsInMarkup().map((entry) => entry.address),
      'the declaration and the markup disagree about which panels exist, or in what order',
    );
  });

  test('every label is the panel\'s own heading, character for character', () => {
    const markup = new Map(panelsInMarkup().map((entry) => [entry.address, entry]));
    for (const entry of declaredCodenPanels()) {
      assert.equal(entry.label, markup.get(entry.address).label,
        `${entry.address}: the declared label is not the heading the markup renders`);
    }
  });

  test('every declared-empty sentence is carried across, verbatim and in order', () => {
    // The 17 sentences here are strings the product SAYS to a person. A transcription error
    // would be a sentence no reviewer re-reads, in a place no reviewer looks — which is why
    // the declaration was generated from the markup and not typed.
    const markup = new Map(panelsInMarkup().map((entry) => [entry.address, entry]));
    let total = 0;
    for (const entry of declaredCodenPanels()) {
      assert.deepEqual(entry.declaredEmpty, markup.get(entry.address).declaredEmpty,
        `${entry.address}: the declared-empty text differs from the markup`);
      total += entry.declaredEmpty.length;
    }
    assert.ok(total > 0, 'no declared-empty text was compared: the comparison proves nothing');
  });

  test('the composed book is the parsed book — the move changed no entry', () => {
    // The property slice 1 exists to preserve, stated as an equality rather than as a promise:
    // what `buildCodenAddressBook()` now composes from two sources equals what the single
    // parser produced before the split, entry for entry, key for key, in order.
    const html = readFileSync(indexHtml, 'utf8');
    const parsed = parseCodenAddressBook(html);
    const composed = [...parsed.filter((entry) => !entry.region), ...declaredCodenPanels()];
    assert.deepEqual(composed, parsed);
  });
});

describe('the declaration is a declaration, not a scrape', () => {
  test('it lives outside the web folder, where the removal cannot reach it', () => {
    const source = readFileSync(join(root, 'apps/shared/coden/coden-addresses.js'), 'utf8');
    // The point of the move: no filesystem read, no markup, no dependency on the shell that
    // slice 4 deletes. If any of these appear, the declaration has grown a way to empty itself.
    for (const forbidden of [/node:fs/, /readFileSync/, /webui-static/, /index\.html/]) {
      assert.doesNotMatch(source.replace(/^\/\/.*$/gm, ''), forbidden,
        `the declaration reached for ${forbidden} — it must not depend on the markup`);
    }
  });

  test('every entry is well-formed, so a shell can render it without checking', () => {
    for (const entry of CODEN_PANELS) {
      assert.ok(['bench', 'agent'].includes(entry.region), `${entry.panel}: unknown region`);
      assert.ok(entry.panel && !/\s/.test(entry.panel), `${entry.panel}: not an address segment`);
      assert.ok(entry.label && entry.label.trim(), `${entry.panel}: has no readable label`);
      assert.ok(Array.isArray(entry.declaredEmpty), `${entry.panel}: declaredEmpty is not a list`);
      for (const line of entry.declaredEmpty) {
        assert.ok(line && line.trim(), `${entry.panel}: an empty declared-empty string`);
      }
    }
  });

  test('no address is declared twice', () => {
    const addresses = declaredCodenPanels().map((entry) => entry.address);
    assert.equal(new Set(addresses).size, addresses.length, 'a duplicate address is declared');
  });
});
