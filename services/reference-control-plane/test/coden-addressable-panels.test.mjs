// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The workbench's panels as addresses, and the rule that keeps them honest.
//
// Two defects motivate this file, and both were the same defect: a fact kept in two
// places, with only one of them maintained.
//
//  1. The sidebar advertised "CodeN Evolution TUI · not built" for as long as the TUI had
//     been working — tools/tui-client.mjs, src/session-protocol.mjs and
//     bin/codev-child.mjs were all real, the socket was listening, and the destination's
//     own page said SESSION PROTOCOL BUILT one click away. app.js even deleted the string
//     "not built" out of a panel title to stop the flag showing up where it did not fit,
//     which is a workaround holding up a claim nobody had rechecked.
//  2. The Sessions keyboard map taught a terminal vocabulary the terminal never had
//     (`/sessions`, `/archive <n>`, `/select <n…>`). Anyone following it would have typed
//     a slash-prefixed command at a shell whose dispatch has no slashes in it.
//
// So these tests do not check that the interface says something nice. They check the
// interface's claims against the code the claims are about: the panel names against the
// markup that owns them, and every documented command against tui-client.mjs's own
// `case` labels. A claim that cannot drift is worth more than a claim that is currently
// true.
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '../../..');
const html = readFileSync(join(root, 'apps/webui-static/index.html'), 'utf8');
const app = readFileSync(join(root, 'apps/webui-static/app.js'), 'utf8');
const tui = readFileSync(join(root, 'tools/tui-client.mjs'), 'utf8');

/** The two regions of CodeN's address space, by the attributes that define them. The
 *  panel NAMES are not written here either — the point of the exercise is that they live
 *  in exactly one place, and this test reads them from that place like the router does. */
const REGIONS = {
  bench: { control: 'data-bench-tab', panel: 'data-bench-panel' },
  agent: { control: 'data-agent-menu', panel: 'data-agent-panel' },
};
// `control` above is the attribute each region's switcher USED to carry. Phase 3 removed
// both switchers, and the name is kept here for one reason: to assert they stay removed.

/** Every value of `attr` in the markup, in document order. */
function values(attr) {
  return [...html.matchAll(new RegExp(`${attr}="([^"]+)"`, 'g'))].map((match) => match[1]);
}

/** The opening tags carrying `attr`, so a tag's own class list can be inspected. */
function tags(attr) {
  return [...html.matchAll(new RegExp(`<[a-z]+[^>]*${attr}="[^"]+"[^>]*>`, 'g'))].map((match) => match[0]);
}

describe('CodeN Evolution — every panel is an address', () => {
  for (const [region, attrs] of Object.entries(REGIONS)) {
    test(`${region}: the panels exist, are uniquely named, and have no switcher left`, () => {
      const panels = values(attrs.panel);
      assert.ok(panels.length > 0, `no ${attrs.panel} in the markup`);
      assert.equal(new Set(panels).size, panels.length, `duplicate ${attrs.panel} names`);
      // Phase 1 asserted a bijection between panels and their switcher's controls. Phase 3
      // removed the switchers — that was the point of it — so the assertion becomes the
      // opposite one: no control may come back, because a tab strip returning beside the
      // address it duplicates is how three navigation widgets grew here the first time.
      assert.equal((html.match(new RegExp(attrs.control, 'g')) ?? []).length, 0,
        `${attrs.control} is back in the markup; the panels are chosen by address now`);
    });

    test(`${region}: exactly one panel ships active — the default a bare #/coden means`, () => {
      const active = tags(attrs.panel).filter((tag) => /class="[^"]*\bactive\b[^"]*"/.test(tag));
      // initBench() reads this at boot and treats it as the region's default. Two would
      // make the default arbitrary; none would make `#/coden` show an empty region.
      assert.equal(active.length, 1);
    });
  }

  test('the router names no panel — the markup is the only list', () => {
    // The routing block is allowed to know the four ATTRIBUTE names. It must not contain
    // the panel names themselves, or adding a panel to the markup would mean remembering
    // to add it here too, which is the arrangement that produced "not built".
    const start = app.indexOf('// --- the addresses inside CodeN Evolution');
    const end = app.indexOf('// What a page needs before it is worth offering at all.');
    assert.ok(start > 0 && end > start, 'the CodeN routing block moved; update this test');
    const block = app.slice(start, end);
    // `terminal` and `closure` are the exception, and a declared one: they name real
    // per-panel side effects (scroll the terminal into view, load the closures), which is
    // behaviour that cannot be read off an attribute. Every other panel name being absent
    // is what makes the list single-copy.
    const allowed = new Set(['terminal', 'closure']);
    for (const [region, attrs] of Object.entries(REGIONS)) {
      for (const name of values(attrs.panel)) {
        if (allowed.has(name)) continue;
        assert.ok(
          !new RegExp(`['"\`]${name}['"\`]`).test(block),
          `the ${region} panel "${name}" is named in the router; it should be read from the markup`,
        );
      }
    }
  });

  test('a panel move does not reload the page it is inside', () => {
    // VIEW_LOADERS.coden refetches the bench on every activation, so a tab click that
    // went through `location.hash=` would fire hashchange and cost a round of requests
    // per click. pushState is silent; Back still fires hashchange when it traverses two
    // different hashes, so the history stays real. If this ever becomes `location.hash=`
    // again the regression is invisible on screen and visible only in the network log.
    const start = app.indexOf('function goToCodenPanel');
    assert.ok(start > 0);
    const body = app.slice(start, app.indexOf('function initBench'));
    assert.match(body, /history\.pushState/);
    assert.doesNotMatch(body, /location\.hash\s*=/);
  });

  test('completing a bare #/coden address does not activate the page twice', () => {
    // `#/coden` is completed to the panel it is showing. Doing that through
    // `location.hash=` would fire hashchange and run the whole activation — and the page's
    // loader — a second time, for an address that never left the place it was already at.
    const start = app.indexOf('let completing=false;');
    assert.ok(start > 0, 'the address-completion branch is gone');
    const body = app.slice(start, app.indexOf('const scope=', start));
    assert.match(body, /if\(completing\)history\.replaceState/);
    // And the correction must not be gated on `updateHash`. It was, in the first version of
    // this phase, and that made it dead code for every address a person can type: goToHash()
    // passes updateHash as false for everything except a legacy redirect. Eleven tests in
    // this file passed while `#/coden` never completed and a misspelt panel left the address
    // naming a panel that does not exist; a real browser found it in one run.
    assert.match(body, /if\(currentHash!==want\)\{/);
    assert.doesNotMatch(body, /if\(updateHash&&currentHash!==want\)/);
  });
});

describe('phase 3: the switchers are gone and nothing they reached went with them', () => {
  test('the breadcrumb holds no list of its own — it opens the one box', () => {
    // The single visible way into the panels now. If it ever grows its own menu, this page
    // has two lists of destinations again and one of them will go stale, which is the
    // failure mode this whole programme has been unwinding.
    const button = html.match(/<button type="button" id="benchWhere"[^>]*>/)?.[0];
    assert.ok(button, 'the breadcrumb is gone; `/` would be the only way to change panel');
    assert.match(button, /aria-controls="globalSearchResults"/);
    const handler = app.slice(app.indexOf("$('#benchWhere')"), app.indexOf("$('#terminalAdd')"));
    assert.match(handler, /openPalette\(\)/);
    assert.match(handler, /'\/coden\/'/, 'it must open the box filtered to this page');
  });

  test('the breadcrumb names the panel that is open', () => {
    // With no tab left looking selected, this line is the only thing on screen that says
    // where you are. If it stops following the panel it becomes a label that lies.
    const body = app.slice(app.indexOf('function activateCodenPanel'), app.indexOf('function announceCodenPanel'));
    assert.match(body, /benchWhereName/);
    assert.match(body, /region==='bench'/, 'the bench panel is what the breadcrumb names');
  });

  test("the Navigator's rows lead somewhere, like every other row does now", () => {
    // Seven lists of up to six entries, each rendered as a <button> with no handler on it —
    // the same dead control phase 2 found in the search results, in a second place.
    const body = app.slice(app.indexOf('function renderBenchNavigator'), app.indexOf('async function renderBenchStatus'));
    assert.match(body, /data-jump="\$\{escapeHtml\(destination\)\}"/);
    assert.match(body, /opens \$\{escapeHtml\(destination\)\}/, 'and each row says which page it opens');
    // Every list passes a destination: a call left without one renders rows that go nowhere.
    const calls = [...body.matchAll(/=list\((.*?)\);/g)].map((match) => match[1]);
    assert.equal(calls.length, 7, `expected seven rendered lists, found ${calls.length}`);
    for (const call of calls) assert.match(call, /,'[a-z-]+'$/, `a list renders rows with no destination: ${call}`);
  });
});

describe('the interface does not claim what the code contradicts', () => {
  test('the TUI destination carries no "not built" flag, and the files it names exist', () => {
    const navEntry = html.match(/<button class="nav" data-view="coden-tui">[^<]*(?:<[^>]+>[^<]*)*?<\/button>/);
    assert.ok(navEntry, 'the coden-tui nav entry is gone');
    assert.doesNotMatch(navEntry[0], /not built/);
    // The flag is not the point; the claim underneath it is. These three files are what
    // make "built" true, so the test fails if the claim outlives them.
    for (const file of [
      'tools/tui-client.mjs',
      'services/reference-control-plane/src/session-protocol.mjs',
      'services/reference-control-plane/bin/codev-child.mjs',
    ]) assert.ok(existsSync(join(root, file)), `${file} is missing but the TUI is declared built`);
  });

  test('app.js no longer deletes "not built" out of a panel title', () => {
    // The workaround and the flag were one defect. Leaving the workaround behind would
    // quietly absorb the next stale flag instead of letting it be seen.
    assert.doesNotMatch(app, /replace\(['"]not built['"]/);
  });

  test('every terminal command the interface documents exists in the TUI dispatch', () => {
    // The verbs tui-client.mjs actually answers to, read from its own `case` labels
    // rather than from a list beside them.
    const implemented = new Set([...tui.matchAll(/case '([a-z-]+)':/g)].map((match) => match[1]));
    assert.ok(implemented.has('sessions') && implemented.has('plan'), 'the dispatch shape changed');
    // `<code class="cmd">` — the markup says which of its code spans CLAIM to be commands,
    // rather than this test guessing from the tag. The first version guessed, and read
    // `workspace-actions.mjs` and `repo-map` — module names the same pages legitimately
    // mention — as commands the TUI had failed to implement. A denylist would have grown
    // an entry every time a new module got named in prose; declaring the intent once at
    // the source cannot go wrong that way.
    const documented = new Set(
      [...html.matchAll(/<code class="cmd">([^<]+)<\/code>/g)].map((match) => match[1].trim().split(/\s+/)[0]),
    );
    // A floor, because an empty set would pass every assertion below it: if the commands
    // stop being marked, this test must fail rather than quietly verify nothing.
    assert.ok(documented.size >= 10, `only ${documented.size} marked commands found; the markup moved`);
    for (const verb of documented) {
      assert.ok(implemented.has(verb), `the interface documents "${verb}", which the TUI does not implement`);
    }
  });

  test('the Sessions note does not call the terminal unreachable', () => {
    const note = html.match(/id="sessionsTuiGap"[^>]*>(.*?)<\/p>/s);
    assert.ok(note, 'the note is gone');
    assert.doesNotMatch(note[1], /not reachable|not built/);
  });
});
