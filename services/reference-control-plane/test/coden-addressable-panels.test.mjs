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
import { parseCodenAddressBook } from '../src/coden-address-book.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '../../..');
const html = readFileSync(join(root, 'apps/webui-static/index.html'), 'utf8');
const app = readFileSync(join(root, 'apps/webui-static/app.js'), 'utf8');
const tui = readFileSync(join(root, 'tools/tui-client.mjs'), 'utf8');
// Phase 4: the address space as the server derives it, used below to check the interface's
// own documented examples against the interface's own attributes.
const declaredAddresses = parseCodenAddressBook(html).map((entry) => entry.address);

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
      // Phase 4 put ADDRESSES in this column beside the verbs, and the two are checked
      // against different things: a verb must exist in the dispatch, an address must exist
      // in the address space. `/` itself is neither — it is the prefix the dispatch tests
      // for ahead of the verb table, so that no command can shadow an address.
      if (verb === '/') {
        assert.match(tui, /command\.startsWith\('\/'\)/, 'the interface documents `/`, which the TUI does not answer to');
        continue;
      }
      if (verb.startsWith('/')) {
        const documentedAddress = verb.replace(/^\/+/, '');
        assert.ok(
          declaredAddresses.includes(documentedAddress) || declaredAddresses.some((address) => address.endsWith(`/${documentedAddress}`)),
          `the interface documents the address "${verb}", which this markup does not declare`,
        );
        continue;
      }
      assert.ok(implemented.has(verb), `the interface documents "${verb}", which the TUI does not implement`);
    }
  });

  test('the Sessions note does not call the terminal unreachable', () => {
    const note = html.match(/id="sessionsTuiGap"[^>]*>(.*?)<\/p>/s);
    assert.ok(note, 'the note is gone');
    assert.doesNotMatch(note[1], /not reachable|not built/);
  });
});

describe('phase 4: the terminal keeps no list of its own', () => {
  test('tui-client.mjs asks the server for the address space instead of declaring one', () => {
    assert.match(tui, /session\.call\('coden\.addresses'/, 'the client no longer fetches the address list');
    // The two lists this file used to carry, by the names they had. A regression that
    // reintroduces either would be invisible on screen — the client would simply answer
    // from a copy again, correctly, right up until the markup moved.
    assert.doesNotMatch(tui, /const PANEL_NAMES\s*=/);
    assert.doesNotMatch(tui, /DECLARED_EMPTY_PANELS/);
  });

  test('no panel name is written into the client, except the three that are also verbs', () => {
    // `plan`, `map` and `sessions` are dispatch verbs that predate the address space and
    // are commands in their own right; every other panel name appearing as a literal here
    // would mean a second list had started to grow back. Full ADDRESSES ('coden/bench/map')
    // are allowed and expected — those are the routing table's keys, and a name inside one
    // cannot drift from the markup, because the whole address has to match.
    const verbsThatAreAlsoPanels = new Set(['plan', 'map', 'sessions']);
    for (const entry of parseCodenAddressBook(html).filter((address) => address.region)) {
      if (verbsThatAreAlsoPanels.has(entry.panel)) continue;
      assert.doesNotMatch(
        tui, new RegExp(`['"\`]${entry.panel}['"\`]`),
        `the panel "${entry.panel}" is named in tui-client.mjs; it should come from the served list`,
      );
    }
  });

  test('both shells rank matches the same way, and the browser\'s copy is the one to follow', () => {
    // Two implementations of one rule, because the browser's must answer without a round
    // trip and the terminal's must answer without a DOM. They cannot share code, so this
    // asserts the SHAPE of both: three ranks, address-prefix then address-substring then
    // label. If the browser's rule changes, this fails and names the file that has to
    // follow it.
    const browser = app.slice(app.indexOf('function matchAddresses'), app.indexOf('const palette='));
    const terminal = tui.slice(tui.indexOf('export function matchAddresses'), tui.indexOf('export function functionKeyAddresses'));
    for (const source of [browser, terminal]) {
      assert.ok(source.length > 200, 'one of the two matchers moved; this test cannot see it');
      assert.match(source, /startsWith\([a-z]+\)\)\s*return\s*\{\s*entry,\s*rank:\s*0/);
      assert.match(source, /address\.includes\([a-z]+\)\)\s*return\s*\{\s*entry,\s*rank:\s*1/);
      assert.match(source, /label[\s\S]{0,60}includes\([a-z]+\)\)\s*return\s*\{\s*entry,\s*rank:\s*2/);
      assert.match(source, /replace\(\/\^\\\/\+\//, 'the leading slash is no longer stripped');
    }
  });

  test('the hotkeys are derived from the served list, not from a mapping typed beside it', () => {
    const body = tui.slice(tui.indexOf('export function functionKeyAddresses'), tui.indexOf('const ADDRESS_VIEWS'));
    assert.match(body, /region === 'bench'/);
    assert.match(body, /slice\(0, 9\)/);
  });

  test('phase 5: the program the interface tells people to run is in the image', () => {
    // The TUI page names a command and says to run it "from a real terminal on this host (or
    // over SSH into it)". Measured on the live installation in phase 5: the socket was
    // listening at /run/codev-peer.sock and the program was NOT in the image — oci/Dockerfile
    // copied only `tools/acceptance/` out of `tools/`, so there was nothing shipped that could
    // speak to it. A destination that cannot be reached on the deployment is the "not built"
    // flag one layer down, so the page and the recipe are tied here instead of being kept in
    // step by memory.
    const commanded = html.match(/<pre>node (tools\/[a-z-]+\.mjs)[^<]*<\/pre>/);
    assert.ok(commanded, 'the TUI page no longer names the program to run; find where it moved');
    const dockerfile = readFileSync(join(root, 'oci/Dockerfile'), 'utf8');
    assert.ok(
      new RegExp(`^COPY[^\\n]*\\s${commanded[1].replace(/\//g, '\\/')}\\s`, 'm').test(dockerfile),
      `the interface says to run \`${commanded[1]}\`, which oci/Dockerfile does not put in the image`,
    );
    assert.ok(existsSync(join(root, commanded[1])), `${commanded[1]} does not exist in the repository`);
    // And it must work as printed, with no argument: inside the image the client's own
    // fallback (`<repo>/.workspace/tui.sock`) is the wrong path, because the repo root there
    // is /opt/noesar while the socket lives on the /run tmpfs. Measured by running the
    // shipped client in a container built from this file.
    assert.match(dockerfile, /NOESAR_TUI_SOCKET_PATH=\/run\/codev-peer\.sock/,
      'the image does not tell the client where the socket is, so the printed command needs an argument the page does not print');
  });
});
