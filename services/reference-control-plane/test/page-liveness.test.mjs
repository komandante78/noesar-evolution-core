// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Owner, s333 point 3: «devi controllare tutte le pagine della webui … perché mi sembrano tutte
// pagine statiche».
//
// He was right, and the measurement said so before any code changed: nineteen pages asked the
// server something when opened, SEVEN painted real data fetched once at sign-in and never
// again, and nine drew fixed markup. The seven are the worst of the three — a stale number
// looks exactly like a current number, so those pages were alive, wrong, and confident.
//
// What is defended here is not the count. It is the property that a page cannot go quiet
// without somebody writing down why. Every destination and settings section is either live, or
// named below with its reason.

import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '../../..');

/**
 * Pages that draw fixed markup ON PURPOSE, each with the reason.
 *
 * Static is not a defect — `#/not-found` should be static, and a page that explains a fixed
 * fact is finished rather than lazy. What would be a defect is a page going quiet and nobody
 * noticing, which is precisely what happened to the seven. So the list is the exception and it
 * has to be argued for; anything not on it must fetch.
 */
const DELIBERATELY_STATIC = Object.freeze({
  'coden-tui': 'instructions for reaching the terminal shell. There is no state to fetch — a browser page cannot spawn an operating-system shell, and this destination says so rather than simulating one.',
  settings: 'the settings shell itself. It owns no content: every section inside it has its own loader, and giving the shell one too would fetch the same things twice.',
  'settings/appearance': 'theme, accent, text size and motion are stored on this device only and never leave the installation. There is nothing on the server to ask for.',
  'settings/licence': 'declared and not built. No code in this build reads or asserts a licence state, and the panel says exactly that — fetching would imply a source that does not exist.',
  'not-found': 'a fixed explanation of a fixed fact.',
  'access-denied': 'the same, plus a detail the router writes directly.',
});

function census() {
  return JSON.parse(execFileSync('node', ['tools/measure-page-liveness.mjs', '--json'],
    { cwd: repoRoot, maxBuffer: 1e8 }).toString());
}

describe('every page either fetches, or is declared static with a reason', () => {
  const rows = census();

  test('no page paints data fetched once at sign-in and never refreshed', () => {
    // The Owner's complaint, as a property. This is the state that reads as dead while being
    // full of true values, and it is the one that must never come back silently.
    const stale = rows.filter((row) => row.state === 'boot-only').map((row) => row.address);
    assert.deepEqual(stale, [],
      `these pages show data from sign-in and never look again: ${stale.join(', ')}`);
  });

  test('every static page is on the declared list', () => {
    const undeclared = rows.filter((row) => row.state === 'static' && !DELIBERATELY_STATIC[row.address]);
    assert.deepEqual(undeclared.map((row) => row.address), [],
      'a page went quiet without a reason being written down — add a loader, or say here why it has none');
  });

  test('every declared-static page really is static', () => {
    // The other direction, and it matters as much: an entry left here after a page was wired
    // is an exemption protecting nothing, and the next reader trusts it.
    for (const address of Object.keys(DELIBERATELY_STATIC)) {
      const row = rows.find((entry) => entry.address === address);
      assert.ok(row, `${address} is declared static but is no longer a page`);
      assert.equal(row.state, 'static',
        `${address} is declared static and is actually ${row.state} — the declaration is now false`);
    }
  });

  test('the census finds the pages at all — a silent zero would pass everything above', () => {
    // Every assertion here is over a filtered list, and an empty input satisfies all of them.
    // This is the line that makes the others mean something.
    assert.ok(rows.length >= 30, `the census found only ${rows.length} pages`);
    assert.ok(rows.filter((row) => row.state === 'live').length >= 25,
      'almost every page should be live; a sudden collapse here is the measurement breaking, not the product');
  });

  test('a loader written as an arrow with several calls is still seen', () => {
    // Regression on a defect in the measurement itself: taking the FIRST identifier out of
    // `()=>{benchOpenedAt=…;loadCoden();…}` resolved an assignment, and reported `#/coden` —
    // one of the busiest pages in the product — as drawing fixed markup.
    const coden = rows.find((row) => row.address === 'coden');
    assert.equal(coden?.state, 'live');
  });

  test('a loader whose key is quoted, or whose entry follows a comment, is still seen', () => {
    // Two more defects of the measurement, both of which made a page that had JUST been wired
    // still read as static: a comma inside a `//` comment split an entry in half, and a quoted
    // key failed a pattern that only allowed bare identifiers.
    for (const address of ['settings/models-hardware', 'settings/remote-targets', 'chat']) {
      const row = rows.find((entry) => entry.address === address);
      assert.equal(row?.state, 'live', `${address} reads as ${row?.state}`);
    }
  });
});
