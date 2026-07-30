// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Structural invariants of the shipped WebUI markup.
//
// These exist because of a real, delivered defect that survived a full acceptance phase
// and a WebUI remediation phase: `<section class="view" id="view-tasks">` was never
// closed. HTML does not auto-close a <section> when the next one opens, so every view
// declared after Tasks became a DOM *child* of Tasks. `.view` is display:none unless it
// carries `.active`, and an active element inside a display:none ancestor still has no
// box — so Artifacts, Knowledge, Memory, Models, Agents, CodeN and Compute were
// populated, marked active, and invisible.
//
// That is exactly the reported symptom ("clicking Agents/Tools/Knowledge does nothing"),
// and it was missed twice because the checks looked at `classList` rather than at
// whether anything was on screen. A malformed-markup check is cheap; the failure it
// prevents is the whole product looking dead.
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const INDEX = join(here, '../../../apps/webui-static/index.html');
const html = readFileSync(INDEX, 'utf8');

/** Elements that must nest. Void elements are excluded by construction. */
const PAIRED = ['section', 'form', 'main', 'aside', 'nav', 'article', 'header', 'footer'];

/** The thirteen destinations, in sidebar order (Memory joined since D-0265,
 *  14_MEMORIA_A_CUBI.md CUBE-009). A destination is a place you decide to go
 *  to; everything else is a section you arrive at. */
const DESTINATIONS = [
  'home', 'chat', 'coden', 'coden-tui', 'projects', 'documents', 'knowledge', 'memory',
  'agents', 'workflows', 'models', 'research', 'settings',
];
/** The single Settings destination's own menu — menu inside the menu, in three groups. */
const SETTINGS_SECTIONS = [
  'sessions', 'appearance', 'language', 'about', 'licence', 'privacy', 'people',
  'security', 'models-hardware', 'storage', 'audit', 'health', 'updates',
];
/** Pages that changed rank. Their markup must still exist somewhere in the document.
 *  'memory' left this list at D-0265: it is a real destination again (CUBE-009), not a
 *  demoted page — #view-memory is now Memory itself, and the manual notes panel that
 *  used to own that id was renamed to #memory-notes-block, not deleted. */
const DEMOTED = [
  'view-tasks', 'view-tools', 'view-approvals', 'view-providers',
  'view-hardware', 'view-users', 'view-security', 'view-health', 'view-logs',
  'view-updates', 'view-backups', 'view-about',
];
/** Names that used to route and no longer do. Each must have a forwarding address. */
const RETIRED_ROUTES = [
  'tasks', 'tools', 'approvals', 'providers', 'hardware', 'users',
  'security', 'health', 'logs', 'updates', 'backups', 'about',
];

describe('webui markup structure', () => {
  for (const tag of PAIRED) {
    test(`<${tag}> tags are balanced`, () => {
      const open = (html.match(new RegExp(`<${tag}(?=[\\s>])`, 'g')) ?? []).length;
      const close = (html.match(new RegExp(`</${tag}>`, 'g')) ?? []).length;
      assert.equal(open, close, `<${tag}>: ${open} opened, ${close} closed`);
    });
  }

  test('no view section is nested inside another view section', () => {
    // Walk the document tracking section depth, and record the depth at which each
    // `class="view"` section opens. They must all open at the same depth — nesting one
    // inside another is the defect above.
    const tokens = [...html.matchAll(/<section\b([^>]*)>|<\/section>/g)];
    let depth = 0;
    const viewDepths = [];
    for (const token of tokens) {
      if (token[0] === '</section>') { depth -= 1; continue; }
      const attributes = token[1] ?? '';
      const isView = /class="[^"]*\bview\b[^"]*"/.test(attributes);
      const id = attributes.match(/id="([^"]+)"/)?.[1] ?? null;
      if (isView) viewDepths.push({ id, depth });
      depth += 1;
    }
    // Twelve destinations plus the two error pages. The number is asserted exactly rather
    // than as a floor: the point of the restructure is that the count came DOWN, and a
    // floor cannot notice a destination quietly reappearing.
    assert.equal(viewDepths.length, DESTINATIONS.length + 2,
      `expected ${DESTINATIONS.length} destinations + not-found + access-denied, found ${viewDepths.length}`);
    const baseline = viewDepths[0].depth;
    const nested = viewDepths.filter((entry) => entry.depth !== baseline);
    assert.deepEqual(nested, [], `views nested below the others: ${nested.map((e) => `${e.id}@${e.depth}`).join(', ')}`);
  });

  test('section depth returns to zero at the end of the document', () => {
    const tokens = [...html.matchAll(/<section\b[^>]*>|<\/section>/g)];
    let depth = 0;
    let lowest = 0;
    for (const token of tokens) {
      depth += token[0] === '</section>' ? -1 : 1;
      lowest = Math.min(lowest, depth);
    }
    assert.equal(depth, 0, 'unbalanced <section> nesting');
    assert.equal(lowest, 0, 'a </section> closed more than was open');
  });

  test('every id is unique', () => {
    // getElementById silently returns the first match, so a duplicate id makes one of
    // the two elements permanently unreachable — a handler that appears wired and is not.
    const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
    const seen = new Set();
    const duplicates = new Set();
    for (const id of ids) {
      if (seen.has(id)) duplicates.add(id);
      seen.add(id);
    }
    assert.deepEqual([...duplicates], [], 'duplicate element ids');
  });

  test('every nav target has a matching view section', () => {
    const targets = [...html.matchAll(/data-view="([^"]+)"/g)].map((match) => match[1]);
    assert.deepEqual(targets, DESTINATIONS, 'the sidebar is not the twelve declared destinations');
    for (const target of targets) {
      assert.ok(html.includes(`id="view-${target}"`), `nav entry "${target}" has no #view-${target}`);
    }
  });

  // --- the demotion, checked in both directions ------------------------------
  //
  // Changing rank is not the same as deleting. Fifteen entries left the sidebar; every one
  // of them still has to exist somewhere and still has to be reachable by the address it
  // answered on before. Nothing here would notice a page that merely LOOKS present, which
  // is why the browser suite walks the same list on a running installation — but a page
  // deleted outright, or an address left pointing at nothing, is caught here for free.
  // --- the token layer -------------------------------------------------------
  //
  // Nine themes and a free colour picker are remappings of tokens. That is only possible
  // while EVERY colour lives in one place: a single literal left in a rule is a colour no
  // theme can move, and it does not announce itself — it simply stays the same shade while
  // everything around it changes. The layer holds only as long as this is enforced.
  test('no colour literal survives outside the token definitions', () => {
    const css = readFileSync(join(here, '../../../apps/webui-static/styles.css'), 'utf8');
    // A literal is legitimate where it DEFINES a token and nowhere else. The first version
    // of this check stripped the :root block by position, which stopped being the whole
    // truth the moment the nine themes arrived: a theme is a second block of token
    // definitions, and every one of its values is a literal by necessity. Stripping custom
    // property declarations wherever they appear states the actual rule, and it keeps
    // working for the next block of definitions nobody has written yet.
    const withoutTokenDefinitions = css.replace(/--[a-z0-9-]+\s*:[^;}]*[;}]/g, '');
    // Colour KEYWORDS count. The first version of this guard looked for #hex and rgb() only,
    // and two `color:white` declarations walked straight through it — on the primary button
    // and the active nav entry, which then stayed white text when the light theme turned the
    // surface underneath them white. A keyword is a colour no theme can remap, which is the
    // whole property being defended; the notation it is written in is irrelevant.
    const literals = withoutTokenDefinitions.match(/#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)|\b(?:white|black|red|blue|green|yellow|orange|purple|grey|gray|silver|navy|teal|olive|maroon|aqua|fuchsia|lime)\b(?=\s*[;}!])/g) ?? [];
    assert.deepEqual(literals, [],
      `${literals.length} colour literal(s) outside :root — a colour no theme can remap: ${[...new Set(literals)].slice(0, 8).join(', ')}`);
  });

  test('every token the stylesheet references is defined', () => {
    const css = readFileSync(join(here, '../../../apps/webui-static/styles.css'), 'utf8');
    // Definitions are collected from the WHOLE stylesheet, not only from :root. A token that
    // legitimately varies by state — the two grid widths the sidebar and context-panel ranks
    // drive — is defined on `.app-shell`, and that is a definition too. Colour tokens are
    // still forced into :root by the check above.
    const defined = new Set([...css.matchAll(/--([a-z0-9-]+)\s*:/g)].map((m) => m[1]));
    const used = new Set([...css.matchAll(/var\(--([a-z0-9-]+)/g)].map((m) => m[1]));
    // A var() naming a token that does not exist fails SILENTLY: the property falls back to
    // its inherited value, so a typo shows up as a slightly wrong colour rather than as an
    // error. That is the one failure mode of this design, and it is checked here.
    const missing = [...used].filter((name) => !defined.has(name)).sort();
    assert.deepEqual(missing, [], `var() references undefined tokens: ${missing.join(', ')}`);
    const unused = [...defined].filter((name) => !used.has(name)).sort();
    assert.deepEqual(unused, [], `tokens defined and never used: ${unused.join(', ')}`);
  });

  test('every Settings section sits inside the Settings destination', () => {
    const sections = [...html.matchAll(/class="settings-section"[^>]*data-section="([^"]+)"/g)].map((m) => m[1]);
    assert.equal(sections.length, SETTINGS_SECTIONS.length, `expected ${SETTINGS_SECTIONS.length} sections, found ${sections.length}`);
    assert.deepEqual([...sections].sort(), [...SETTINGS_SECTIONS].sort(), 'the sections are not the declared set');

    // Containment is checked by NESTING, not by position in the file.
    //
    // The first version of this check sliced the document between #view-settings and
    // #view-not-found and asked whether each section appeared in that text. A section
    // moved OUT of #view-settings but left sitting between the two still passed — it was
    // testing document order, which is not the property that matters. A section outside
    // its destination is display:none-controlled by a class no page clears, so it would
    // render on top of an unrelated page. Found by seeding exactly that defect and
    // watching the check stay green.
    const tokens = [...html.matchAll(/<section\b([^>]*)>|<\/section>/g)];
    let depth = 0;
    let settingsDepth = null;
    const escaped = [];
    for (const token of tokens) {
      if (token[0] === '</section>') {
        depth -= 1;
        if (settingsDepth !== null && depth === settingsDepth) settingsDepth = null;
        continue;
      }
      const attributes = token[1] ?? '';
      if (/id="view-settings"/.test(attributes)) settingsDepth = depth;
      else if (/class="settings-section"/.test(attributes)) {
        const key = attributes.match(/data-section="([^"]+)"/)?.[1] ?? '(unnamed)';
        if (settingsDepth === null || depth <= settingsDepth) escaped.push(key);
      }
      depth += 1;
    }
    assert.deepEqual(escaped, [],
      `sections outside #view-settings, which would render on a page that does not contain them: ${escaped.join(', ')}`);
  });

  test('every Settings section has a menu entry and every entry a section', () => {
    const menu = [...html.matchAll(/class="settings-nav[^"]*"[^>]*data-section="([^"]+)"/g)].map((m) => m[1]);
    assert.deepEqual([...menu].sort(), [...SETTINGS_SECTIONS].sort(), 'menu and sections disagree');
    const groups = [...html.matchAll(/class="settings-group">([^<]+)</g)].map((m) => m[1].trim());
    assert.equal(groups.length, 3, `expected three groups, found ${groups.length}: ${groups.join(' | ')}`);
  });

  test('no demoted page was deleted rather than demoted', () => {
    for (const id of DEMOTED) {
      assert.ok(html.includes(`id="${id}"`), `${id} is gone: a change of rank must not delete a page`);
    }
  });

  test('every address a demoted page answered on still resolves', () => {
    const app = readFileSync(join(here, '../../../apps/webui-static/app.js'), 'utf8');
    const legacy = app.match(/const LEGACY_ROUTES=\{([\s\S]*?)\};/)?.[1] ?? '';
    assert.ok(legacy.length > 0, 'app.js declares no legacy route map');
    const routes = app.match(/const ROUTES=new Set\(\[([^\]]+)\]\)/)?.[1] ?? '';
    const sections = app.match(/const SETTINGS_SECTIONS=\[([^\]]+)\]/)?.[1] ?? '';
    for (const name of RETIRED_ROUTES) {
      assert.ok(new RegExp(`\\b${name}:'`).test(legacy),
        `"${name}" left the sidebar with no forwarding address: an old link or bookmark now 404s`);
    }
    // And the forwarding addresses must themselves be real.
    for (const [, target] of legacy.matchAll(/:'([^']+)'/g)) {
      const [view, section] = target.split('/');
      assert.ok(routes.includes(`'${view}'`), `legacy target "${target}" points at a destination that is not a route`);
      if (section) assert.ok(sections.includes(`'${section}'`), `legacy target "${target}" points at a section that does not exist`);
    }
  });

  test('every view section reachable from the nav is registered as a route', () => {
    const app = readFileSync(join(here, '../../../apps/webui-static/app.js'), 'utf8');
    const routes = app.match(/const ROUTES=new Set\(\[([^\]]+)\]\)/)?.[1] ?? '';
    const targets = [...html.matchAll(/data-view="([^"]+)"/g)].map((match) => match[1]);
    for (const target of targets) {
      assert.ok(routes.includes(`'${target}'`), `nav entry "${target}" is not in ROUTES, so it resolves to not-found`);
    }
  });
});

// ---------------------------------------------------------------------------
// The parts the design asked for and the graphics did not cover.
//
// Each of these guards a criterion that a reasonable-looking change can silently
// undo. Two of them make a Critical criterion MECHANICALLY checkable for the first
// time — UI-036 (the NOT DONE box) and UI-046 (no physical direction properties) —
// which matters because both had been asserted rather than measured.
// ---------------------------------------------------------------------------
describe('the missing interface parts', () => {
  const css = readFileSync(join(here, '../../../apps/webui-static/styles.css'), 'utf8');
  const app = readFileSync(join(here, '../../../apps/webui-static/app.js'), 'utf8');

  test('UI-040 · every font size is a multiple of the text scale', () => {
    // A bare pixel size is a size the text-size setting cannot move, and it would be
    // invisible: the interface would grow around one label that stayed behind.
    const bare = [...css.matchAll(/font-size:\s*[0-9.]+px/g)].map((match) => match[0]);
    assert.deepEqual(bare, [], `these sizes ignore --text-scale: ${bare.join(', ')}`);
    assert.match(css, /--text-scale:\s*1/, 'the scale itself must be defined');
    assert.match(css, /zoom:var\(--ui-zoom\)/, 'UI-041: zoom is a second, independent multiplier');
  });

  test('UI-046 · no physical left/right declaration survives in the stylesheet', () => {
    // Written as a property-position match so that `--text-bright` and a comment
    // mentioning `left:-9999px` are not counted. The defect this prevents is real: an
    // off-screen skip link once stretched the RTL scroll area to 11439px.
    const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
    const physical = [...withoutComments.matchAll(/[;{]\s*(?:margin|padding|border|inset)?-?(?:left|right)\s*:/g)].map((match) => match[0].trim());
    assert.deepEqual(physical, [], `physical direction properties: ${physical.join(' ')}`);
  });

  test('UI-036 · the closure carries a NOT DONE box and a way to declare it empty', () => {
    assert.match(html, /id="closureNotDone"/, 'the NOT DONE box must exist');
    assert.match(html, /id="closureNothing"/, 'declaring the box empty must be an explicit act');
    assert.match(html, /id="closureRisk"/, 'the closure carries the residual risk');
    assert.match(html, /id="closureReviewTime"/, 'and the human review time');
    // And the refusal must be reachable: a client that submits an empty box without
    // saying so would leave the rule to the server alone and tell the person nothing.
    assert.match(app, /The NOT DONE box is empty/, 'the empty box is refused with a reason');
  });

  test('UI-030…UI-033 · the bench has three regions, eleven tabs, and a terminal outside them', () => {
    for (const region of ['bench-navigator', 'bench-main', 'bench-agent']) {
      assert.ok(html.includes(`class="${region}`), `the ${region} region is missing`);
    }
    const tabs = [...html.matchAll(/data-bench-tab="([^"]+)"/g)].map((match) => match[1]);
    const panels = [...html.matchAll(/data-bench-panel="([^"]+)"/g)].map((match) => match[1]);
    assert.equal(tabs.length, 11, `UI-032 names eleven tabs, found ${tabs.length}`);
    assert.deepEqual(tabs, panels, 'every tab must have exactly one panel, in the same order');
    // UI-033: the terminal is a region, not a tab that disappears. If its markup ever
    // moves inside the panels it becomes exactly what the criterion forbids.
    // Written as positions rather than as a slice between two literal strings: a slice
    // whose end marker moves silently becomes an assertion about an empty string, which
    // passes for the wrong reason.
    const panelsStart = html.indexOf('<div class="bench-panels">');
    const lastPanel = html.lastIndexOf('data-bench-panel=');
    const terminal = html.indexOf('id="benchTerminal"');
    assert.ok(panelsStart > 0 && lastPanel > panelsStart, 'the tab panels block must exist');
    assert.ok(terminal > lastPanel, 'the terminal must live outside the tab panels, after them');
    assert.match(html, /class="bench-terminal"[^>]*id="benchTerminal"/, 'the terminal region must exist');
  });

  test('UI-035 · the status line has its twelve fields and declares how many have a source', () => {
    const fields = [...html.matchAll(/data-status-field="([^"]+)"/g)].map((match) => match[1]);
    assert.equal(fields.length, 12, `UI-035 names twelve fields, found ${fields.length}`);
    assert.match(html, /id="statusSourced"/, 'the line must state how many of them are real');
    assert.match(app, /of 12 fields have a source/, 'and the count must be computed, not written down');
  });

  test('UI-037 · the top bar keeps its reference elements and ADDS coverage', () => {
    for (const id of ['globalSearch', 'projectChip', 'modelChip', 'languageSelect', 'timezoneChip', 'userAvatar', 'coverageChip']) {
      assert.match(html, new RegExp(`id="${id}"`), `the top bar lost "${id}"`);
    }
  });

  test('UI-001…UI-012 · Sessions is built, and no longer declares itself unbuilt', () => {
    const section = html.slice(html.indexOf('id="section-sessions"'), html.indexOf('id="section-appearance"'));
    assert.equal(/DECLARED · NOT BUILT/.test(section), false, 'the section still calls itself unbuilt');
    for (const id of ['sessionsRecent', 'sessionsOverflowCount', 'sessionsRange', 'sessionsSelectedCount', 'sessionsDeleteSelected', 'sessionsReturn']) {
      assert.ok(section.includes(`id="${id}"`), `Sessions is missing "${id}"`);
    }
    assert.equal((section.match(/data-place="/g) ?? []).length, 3, 'three places: working list, archive, bin');
  });

  test('UI-008…UI-010 · one confirmation exists and nothing preselects the dangerous button', () => {
    assert.match(html, /id="confirmScrim"/);
    assert.match(html, /role="alertdialog"[^>]*aria-modal="true"/, 'the confirmation must be a modal dialog');
    // The dangerous button carries no autofocus, and the code focuses the card instead.
    const card = html.slice(html.indexOf('id="confirmScrim"'), html.indexOf('</div>', html.indexOf('confirm-actions')));
    assert.equal(/autofocus/.test(card), false, 'nothing in the confirmation is preselected');
    assert.match(app, /card\.tabIndex=-1;card\.focus\(\)/, 'focus lands on the dialog, not on a button');
    assert.match(app, /event\.key==='Escape'/, 'Esc cancels');
  });

  test('UI-043 · the event region is announced from events, never from a stream', () => {
    assert.match(html, /id="eventAnnouncer"[^>]*aria-live="polite"/);
    // The delta branch must not announce. It is the one place where a live region turns
    // from an aid into an obstacle, by reading the same answer twice.
    const deltaBranch = app.slice(app.indexOf("else if(event==='delta')"), app.indexOf("else if(event==='error')"));
    assert.equal(/announceEvent/.test(deltaBranch), false, 'the streaming branch must not announce');
    assert.match(app, /announceEvent\(`Reply complete/, 'the completed event announces one summary');
  });
});

describe('the initial screen · UI-060…UI-063', () => {
  const app = readFileSync(join(here, '../../../apps/webui-static/app.js'), 'utf8');
  const css = readFileSync(join(here, '../../../apps/webui-static/styles.css'), 'utf8');
  const home = html.slice(html.indexOf('id="view-home"'), html.indexOf('id="view-chat"'));

  test('UI-060 · the six entry actions have a container, and the count is declared', () => {
    // The buttons are rendered from the payload, so the markup carries the place they go
    // and the badge that states how many of the six can act. The count itself is held to
    // six in the payload's own suite — asserting it twice, in two languages, is how two
    // statements of one rule drift apart.
    assert.match(home, /id="homeEntryActions"/);
    assert.match(home, /id="homeEntryWired"/);
    assert.match(app, /renderEntryActions/);
  });

  test('UI-061 · the ten goals are rendered from the list, not written into the markup', () => {
    assert.match(home, /id="homeGoalActions"/);
    // A goal must not fire a request on one click: the composer is filled and focused, and
    // the person presses send. A screen that submits for you has decided what you meant.
    const renderer = app.slice(app.indexOf('function renderQuickActions'), app.indexOf('function renderServices'));
    assert.match(renderer, /composer\.value=action\.goal/);
    assert.equal(/sendChat\(\)/.test(renderer), false, 'a quick action must not send anything by itself');
  });

  test('UI-062 · active and scheduled work sit in one panel, and every task lands in one group', () => {
    assert.match(home, /id="taskList"/);
    assert.match(home, /id="taskScheduledList"/);
    assert.match(home, /id="taskZoneChip"/);
    // The grouping is imported from the tested module rather than reimplemented here: two
    // implementations of one rule is how a task comes to appear in both groups.
    assert.match(app, /import \{[^}]*splitTasks[^}]*\} from '\.\/schedule\.js'/);
    assert.match(app, /const \{active,scheduled\}=splitTasks/);
  });

  test('UI-062 · a wall clock is resolved against a zone before it is sent', () => {
    // The defect this holds shut: `datetime-local` yields a wall clock with no zone, and
    // sending it raw let the control plane resolve it against the container's UTC clock.
    assert.match(app, /function scheduledInstantFromField/);
    assert.match(app, /scheduledAt:scheduledInstantFromField/);
    assert.match(app, /dueAt:scheduledInstantFromField/);
    assert.equal(/scheduledAt:\$\('#taskScheduledAt'\)\.value/.test(app), false,
      'the raw field value must never be sent again');
  });

  test('UI-063 · health, tools and models each have a panel', () => {
    for (const id of ['homeServices', 'homeTools', 'homeModels']) {
      assert.ok(home.includes(`id="${id}"`), `${id} is missing from the initial screen`);
    }
    assert.match(app, /renderServices/);
    assert.match(app, /renderTools/);
    assert.match(app, /renderModels/);
  });

  test('UI-063 · a withheld block is rendered as withheld, never as empty', () => {
    // The two are indistinguishable on screen unless the interface says which it is, and
    // only one of them is a fact about the product rather than about the reader.
    assert.match(app, /function withheldHtml/);
    assert.match(app, /are not shown to this account/);
    assert.match(app, /block\.requires/);
  });

  test('the new surface obeys the two rules that are easiest to break', () => {
    // Both have already been broken once on this project, which is why they are asserted
    // on the new selectors specifically rather than trusted to the global checks.
    const block = css.slice(css.indexOf('.entry-panel'), css.indexOf('@media(forced-colors:active)', css.indexOf('.entry-panel')));
    assert.ok(block.length > 500, 'the new block must actually be found before it is checked');
    assert.deepEqual([...block.matchAll(/font-size:\s*[0-9.]+px/g)].map((m) => m[0]), [],
      'a bare pixel size on the new surface would not move with the text-size setting');
    assert.deepEqual([...block.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/[;{]\s*(?:margin|padding|border|inset)?-?(?:left|right)\s*:/g)].map((m) => m[0].trim()), [],
      'the new surface must be written in logical properties');
    assert.match(block, /\.goal-action\{[^}]*min-height:3[4-9]px/, 'WCAG 2.5.8: a pill must clear the 24px floor');
  });

  // INST-006 (MASTER_PROJECT/08 §11, MASTER_PROJECT/05 §9): the backup is not encrypted and
  // contains the authentication master key. `05` says this must not be left implicit — this
  // asserts the disclosure text itself, not just that the Backups section exists (D-0223
  // found the text already present but unprotected: nothing stopped a future edit from
  // quietly deleting the one sentence that makes this an honest feature instead of a trap).
  test('INST-006 · the workspace backup discloses that it is unencrypted and carries the auth master key', () => {
    // Bounded by the next `settings-section`, not the next `</section>`: the Backups view
    // nests two `.panel` sections of its own, and the disclosure lives in the second one.
    const start = html.indexOf('id="view-backups"');
    const end = html.indexOf('class="settings-section"', start + 1);
    const backups = html.slice(start, end);
    assert.match(backups, /not encrypted/i);
    assert.match(backups, /authentication master key/i);
  });
});
