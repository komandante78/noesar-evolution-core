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
import { matchAddresses } from '../../../apps/webui-static/coden-view-model.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '../../..');
const html = readFileSync(join(root, 'apps/webui-static/index.html'), 'utf8');
const app = readFileSync(join(root, 'apps/webui-static/app.js'), 'utf8');
const tui = readFileSync(join(root, 'tools/tui-client.mjs'), 'utf8');
// Phase 3c: the address VIEWS moved out of the client into a module both terminal shells
// render — so the guards below read that file too, rather than passing because the table they
// were watching had simply left the file they were watching it in.
const views = readFileSync(join(root, 'apps/shared/coden/coden-address-views.mjs'), 'utf8');
const model = readFileSync(join(root, 'apps/webui-static/coden-view-model.js'), 'utf8');
const css = readFileSync(join(root, 'apps/webui-static/styles.css'), 'utf8');
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
    //
    // The anchor stopped being `let completing=false;` on 2026-08-28 (n.6): a bare `#/coden`
    // now completes to Authority, so the flag is decided rather than initialised. What this
    // test is about — replaceState, and not gated on `updateHash` — is unchanged.
    const start = app.indexOf('let completing=');
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
  test('phase 3c — the panels are reachable with a MOUSE, and by exactly one menu', () => {
    // This used to assert the breadcrumb existed, "or `/` would be the only way to change
    // panel" — a real rule of this product: a keyboard shortcut is the fast path, never the
    // only path. Phase 3c removes the breadcrumb AND the top address box (§4b.4 rule 1: there
    // is one `/`), so the rule is asserted on the property instead of on the widget that used
    // to satisfy it. The affordance moved into the prompt's own hint, which already said `/`
    // opens the menu; nothing was added to the screen, one label became operable.
    const control = html.match(/<button[^>]*id="codenPromptOpenMenu"[^>]*>/)?.[0];
    assert.ok(control, 'no mouse path to the menu — `/` would be the only way to change panel');
    assert.match(control, /aria-controls="codenMenu"/, 'the control must name the ONE menu');
    // Read off the NAMED function, not off a window between two selector strings.
    //
    // The window used to start at the first `$('#codenPromptOpenMenu')` in the file and run to
    // `$('#terminalAdd')`, which was the handler exactly as long as the first mention of that id
    // WAS the handler. Point 2a made the hint line re-render on every keystroke — so the control
    // is rebuilt constantly and the handler had to become a named function bound on each
    // repaint. The first mention moved into the renderer, the window opened across three
    // thousand lines, and this guard failed on an `openPalette(` belonging to something else
    // entirely. The property is about one function; that is what is read now.
    const opener = app.slice(app.indexOf('function openCodenMenu(){'), app.indexOf('function renderCodenPromptKeys('));
    assert.ok(opener.length > 0 && opener.length < 800, 'openCodenMenu is not a small named function');
    assert.match(opener, /renderCodenMenu\(\)/, 'the control does not open the menu it names');
    assert.doesNotMatch(opener, /openPalette\(/, 'it opens the address box the phase removed');
    // …and the control is actually wired to it, by DELEGATION onto a node that outlives the
    // repaint. Point 2a rebuilds the hint line on every keystroke, so a listener bound to the
    // button itself works exactly until the first character is typed — mutation proved no test
    // could see that, so the repair was to remove the failure mode rather than to watch for it.
    assert.match(app, /\$\('#codenShell'\)\?\.addEventListener\('click',\(event\)=>\{[\s\S]{0,160}?#codenPromptOpenMenu/,
      'the mouse control is not delegated onto a node that survives a repaint');
    // And the renderer does NOT bind it: a second, direct binding would re-introduce exactly
    // the lifetime the delegation exists to remove, and would leak a listener per keystroke.
    const painter = app.slice(app.indexOf('function renderCodenPromptKeys('), app.indexOf('function renderCodenMenu('));
    assert.doesNotMatch(painter, /addEventListener/,
      'the hint renderer binds a listener to a control it is about to destroy');

    // And the widgets it replaces are really gone, in both directions: the breadcrumb is no
    // longer a control, and the top box is not shown on this destination. Asserted on the
    // markup and the stylesheet rather than on a comment, since a comment is what a guard in
    // this repository cannot tell from a fact.
    assert.ok(!/<button[^>]*id="benchWhere"/.test(html), 'the breadcrumb is a control again');
    assert.match(css, /\.app-shell\[data-view="coden"\] \.command\{display:none\}/,
      'the top address bar is still shown on the destination that has a prompt');
    assert.match(app, /shell\.dataset\.view=target/, 'nothing tells the shell which destination is open');
  });

  test('the breadcrumb names the panel that is open', () => {
    // With no tab left looking selected, this line is the only thing on screen that says
    // where you are. If it stops following the panel it becomes a label that lies.
    const body = app.slice(app.indexOf('function activateCodenPanel'), app.indexOf('function announceCodenPanel'));
    assert.match(body, /benchWhereName/);
    assert.match(body, /region==='bench'/, 'the bench panel is what the breadcrumb names');
  });

  test("the Navigator's rows lead somewhere, like every other row does now", () => {
    // Six lists of up to six entries, each rendered as a <button> with no handler on it —
    // the same dead control phase 2 found in the search results, in a second place.
    //
    // It was seven until F-NAV-001. The seventh was Tools, and its destination was 'coden' —
    // the screen the row was already sitting on, because the page it should have opened had
    // been demoted by D-0137 and nothing replaced it. The tools panel now holds the register
    // form and the tool cards themselves, so a six-name preview of them, beside them, pointing
    // at itself, is the second copy of one fact this bench exists to avoid. The count is not
    // the invariant here — the loop below is. A list that renders rows going nowhere is the
    // defect; how many lists there are is a fact about the markup, and it moved.
    const body = app.slice(app.indexOf('function renderBenchNavigator'), app.indexOf('async function renderBenchStatus'));
    assert.match(body, /data-jump="\$\{escapeHtml\(destination\)\}"/);
    // The verb was a literal here until the tooltip was translated: these rows carry
    // `translate="no"` because they are named after a person's own projects and sessions, and
    // that exemption covers the title attribute too — so the one English word inside it could
    // not be reported by either measurement. What this test is for is unchanged: the row must
    // still say WHICH page it opens, and the destination must still be in the title.
    assert.match(body, /\$\{escapeHtml\(t\('opens'\)\)\} \$\{escapeHtml\(destination\)\}/,
      'and each row says which page it opens, in the language the reader is reading');
    // Every list passes a destination: a call left without one renders rows that go nowhere.
    const calls = [...body.matchAll(/=list\((.*?)\);/g)].map((match) => match[1]);
    assert.equal(calls.length, 6, `expected six rendered lists, found ${calls.length}`);
    for (const call of calls) assert.match(call, /,'[a-z-]+'$/, `a list renders rows with no destination: ${call}`);
  });

  test('registering a tool is reachable: the controls live in the addressed panel', () => {
    // F-NAV-001, and the property is REACHABILITY, not presence. The register form and the tool
    // cards were in the markup the whole time, and app.js bound the submit and refilled the list
    // on every render — live code, on #view-tools, which LEGACY_ROUTES has redirected away from
    // since D-0137 put tools inside CodeN. Nothing was broken and nothing was missing; there was
    // simply no address and no click that arrived there, so registering a tool, granting it
    // consent or saving its key could not be done at all. A test that only asked whether the
    // form existed would have stayed green through every day of that.
    const panelAt = html.indexOf('data-bench-panel="tools"');
    assert.ok(panelAt > 0, 'the bench has no tools panel');
    const nextPanelAt = html.indexOf('data-bench-panel=', panelAt + 1);
    const endsPanel = (at) => at > panelAt && (nextPanelAt < 0 || at < nextPanelAt);
    for (const id of ['id="toolForm"', 'id="toolList"']) {
      const at = html.indexOf(id);
      assert.ok(at > 0, `${id} is gone`);
      assert.ok(endsPanel(at), `${id} sits outside the tools panel, where no address reaches it`);
    }
    // And it must not have been left behind in the demoted page as a second copy.
    const demoted = html.slice(html.indexOf('id="view-tools"'));
    const demotedEnd = demoted.indexOf('<section class="view"', 1);
    assert.doesNotMatch(demotedEnd > 0 ? demoted.slice(0, demotedEnd) : demoted, /id="toolForm"|id="toolList"/,
      'the demoted page still carries the controls: two copies, one of them unreachable');
  });

  test('the controls that promise tool management arrive where tools are managed', () => {
    // The other half of F-NAV-001, and the half that is easy to miss: while the form had no
    // home, the things POINTING at it pointed at the nearest tool-shaped page instead. Research
    // said "A research provider is registered the same way any other external tool is. Register
    // one in Agents" — and #view-agents has #agentForm and #agentTools, which ATTACH tools that
    // already exist. Registering one there was never possible, so the one instruction the
    // product gave for connecting a search provider led somewhere it could not be followed.
    // That is why the audit read "no provider onboarding" as a separate gap: it was this one.
    const agents = html.slice(html.indexOf('id="view-agents"'));
    const agentsEnd = agents.indexOf('<section class="view"', 1);
    assert.doesNotMatch(agentsEnd > 0 ? agents.slice(0, agentsEnd) : agents, /id="toolForm"/,
      'Agents has a tool-registration form: then the hint this test guards was right all along');
    const hint = html.match(/id="researchProviderRegisterHint"[^>]*>([\s\S]*?)<\/p>/)?.[1] ?? '';
    assert.ok(hint.length > 0, 'the research provider hint is gone');
    assert.match(hint, /href="#\/coden\/bench\/tools"/,
      'the research hint sends you somewhere other than the panel that registers tools');
    // Home's "Manage" used the demoted name 'tools', which forwards to the bench's DEFAULT panel:
    // CodeN, but not the tools in it. Landing near the thing is not landing on it.
    const manage = html.match(/homeToolsTitle">Installed tools<\/h2><button class="text-button" data-view-link="([^"]+)"/)?.[1];
    assert.equal(manage, 'coden/bench/tools', 'Home\'s Installed-tools Manage does not name the tools panel');
  });
});

describe('the interface does not claim what the code contradicts', () => {
  test('Knowledge does not promise a transcription this build cannot do', () => {
    // The voice layer took speech-to-text with it, and file-extractors.mjs says so to the user:
    // audio and video are stored and described, not read. The Knowledge header went on offering
    // "recordings — ingested, indexed, and searched", which is the same shape of untruth as the
    // system message that kept telling the model this installation could hear: a sentence that
    // outlived the code it described. The claim is checked against the extractor, not against a
    // document, because documents are what were wrong.
    const extractors = readFileSync(
      join(here, '../src/ai-workspace/file-extractors.mjs'), 'utf8');
    const noSpeech = /has no transcription/.test(extractors);
    assert.ok(noSpeech, 'the extractor now transcribes: this test is the thing that is stale');
    // Read from page-help.js since 2026-08-28: the page headers were removed and this sentence
    // moved there with the rest of that prose. What is checked is unchanged — the claim, against
    // the extractor. Following the sentence to where it now lives is the point; dropping the
    // test when the markup lost it would have retired the guard along with the header.
    const help = readFileSync(join(root, 'apps/webui-static/page-help.js'), 'utf8');
    const entry = help.match(/\n {2}knowledge: \{([\s\S]*?)\n {2}\},/)?.[1] ?? '';
    assert.ok(entry.length > 0, 'the Knowledge help entry is gone');
    assert.doesNotMatch(entry, /recordings —/,
      'Knowledge offers recordings as searchable evidence while the extractor refuses to read them');
    assert.match(entry, /never transcribed|no speech-to-text/,
      'Knowledge does not say that audio and video are not transcribed');
  });
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

  test('phase 3c — the ranking exists ONCE, and both shells import it', () => {
    // This test used to assert the SHAPE of two implementations, on the premise that "they
    // cannot share code, so this asserts the shape of both". The premise was false: the rule
    // needs a list and a query, and where the list comes from is the only part that differs.
    // Both copies were real, byte-different, and the terminal's carried a comment naming the
    // browser's — a documented duplicate, which drifts exactly like an undocumented one. A
    // test that checks two copies agree TODAY is the arrangement that let `PANEL_NAMES` reach
    // fourteen against twenty-five; the fix is that there is nothing left to compare.
    assert.match(model, /export function matchAddresses\(addresses, query\)/,
      'the shared model no longer owns the ranking');
    for (const [label, source] of [['the browser', app], ['the terminal', tui]]) {
      assert.doesNotMatch(source, /function matchAddresses\s*\(\s*query\s*\)/,
        `${label} has grown its own ranking again`);
      assert.doesNotMatch(source, /rank:\s*[012]/,
        `${label} spells out the ranks itself instead of importing the rule`);
      assert.match(source, /matchAddresses/, `${label} does not use the shared ranking at all`);
    }
    // And the rule itself still ranks the way the product depends on: prefix, then substring,
    // then the label's prose. Asserted on BEHAVIOUR now that there is one implementation —
    // reading its source shape was only ever a way to compare two of them.
    const book = [
      { address: 'coden/bench/diff', label: 'Diff' },
      { address: 'settings/models', label: 'Models — the difference engine' },
      { address: 'chat', label: 'Chat' },
    ];
    assert.deepEqual(matchAddresses(book, 'coden/bench/diff').map((e) => e.address), ['coden/bench/diff']);
    assert.deepEqual(matchAddresses(book, '/diff').map((e) => e.address), ['coden/bench/diff', 'settings/models'],
      'a leading slash was not stripped, or the label rank was lost');
    assert.equal(matchAddresses(book, '').length, book.length, 'an empty query must list everything');
  });

  test('the hotkeys are derived from the served list, not from a mapping typed beside it', () => {
    // The end anchor was `const ADDRESS_VIEWS`, which left the client in phase 3c. A slice
    // whose end anchor is missing runs to the end of the file — so this would have kept
    // passing while measuring the whole client instead of the one function, which is a guard
    // that has quietly stopped guarding. Anchored on the next declaration instead.
    const start = tui.indexOf('export function functionKeyAddresses');
    const end = tui.indexOf('export function addressForFunctionKey');
    assert.ok(start > 0 && end > start, 'functionKeyAddresses moved; update this test');
    const body = tui.slice(start, end);
    assert.match(body, /region === 'bench'/);
    assert.match(body, /slice\(0, 9\)/);
  });

  test('phase 3c — the address views are rendered by BOTH terminal shells, from one table', () => {
    // The defect this phase opened on. Phase 3b built a view for every address, in
    // `showAddress`, printing to stdout — and `tui-client.mjs` only runs its line shell when
    // stdin is a PIPE. On a real TTY, which is what `ssh` gives you, `runFullScreen` answered
    // "this shell has no view for it yet (phase 3b)" for all twenty-five. Measured: 25 of 25
    // rendered in the line shell, 0 of 25 at the prompt.
    assert.match(views, /export async function showAddress/, 'the shared view table is gone');
    assert.doesNotMatch(views, /console\.log\(/,
      'a view writes straight to stdout again, which only one of the two shells can render');
    const shell = readFileSync(join(root, 'tools/tui-fullscreen.mjs'), 'utf8');
    // `D-0413` slice 3: the view table moved to `apps/shared/coden/`, because the BROWSER is now
    // a third consumer of it and cannot import out of `tools/`. Same move, same reason and same
    // mechanism as `agent-commands.js` in slice 1 — and asserted the same way, as a pair: the
    // new specifier must be present AND the old one absent, or a stale second import would keep
    // the `tools/` dependency alive while this line went green on the new one.
    assert.match(shell, /from '\.\.\/apps\/shared\/coden\/coden-address-views\.mjs'/,
      'the prompt does not render addresses off the shared table');
    assert.doesNotMatch(shell, /from '\.\/coden-address-views\.mjs'/,
      'the prompt still reaches into tools/ for the view table the browser also needs');
    assert.doesNotMatch(shell, /no view for it yet/,
      'the prompt still promises a phase that has shipped');
    // And neither shell may grow a table of its own again — the failure mode is not "the
    // views are missing", it is "there are two of them and one is maintained".
    for (const [label, source] of [['the line shell', tui], ['the prompt', shell]]) {
      assert.doesNotMatch(source, /const ADDRESS_VIEWS/, `${label} has grown its own view table`);
      assert.doesNotMatch(source, /const TRANSPORT_NOTES/, `${label} has grown its own transport notes`);
    }
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
    const tuiSocket = dockerfile.match(/^\s*NOESAR_TUI_SOCKET_PATH=(\S+?)\s*\\?$/m);
    assert.ok(tuiSocket, 'the image does not tell the client where the socket is, so the printed command needs an argument the page does not print');
    assert.match(tuiSocket[1], /^\/run\//,
      `the client socket must live on the /run tmpfs, not at ${tuiSocket[1]} — a socket under the workspace is published onto a host bind mount`);

    // D-0338. This used to assert the LITERAL `/run/codev-peer.sock`, which was the defect
    // rather than the requirement: that is the supervisor's INTERNAL path, hard-coded in
    // `noesar-supervisor/src/lib.rs` for both `api` and `codev`. Pointing the external path at
    // it made the relay bind the socket `api` was about to listen on, so the terminal
    // transport was never served in production — and this guard held that configuration in
    // place, because it asserted a value instead of a rule.
    //
    // Read from the supervisor rather than repeated here: a constant copied into a test is a
    // second source of truth, and that drift is what produced the defect in the first place.
    const supervisor = readFileSync(join(root, 'rust/crates/noesar-supervisor/src/lib.rs'), 'utf8');
    const internal = supervisor.match(/CODEV_PEER_SOCKET_PATH:\s*&str\s*=\s*"([^"]+)"/);
    assert.ok(internal, 'the supervisor no longer declares its internal socket path; find where it moved');
    assert.notEqual(tuiSocket[1], internal[1],
      `the image points the client at ${tuiSocket[1]}, which is the supervisor's INTERNAL socket — the relay would bind the path \`api\` listens on, and the terminal transport would not be served`);
  });
});
