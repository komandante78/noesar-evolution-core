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

/** The twelve destinations, in sidebar order. A destination is a place you decide to go
 *  to; everything else is a section you arrive at. */
const DESTINATIONS = [
  'home', 'chat', 'coden', 'coden-tui', 'projects', 'documents', 'knowledge',
  'agents', 'workflows', 'models', 'research', 'settings',
];
/** The single Settings destination's own menu — menu inside the menu, in three groups. */
const SETTINGS_SECTIONS = [
  'sessions', 'appearance', 'language', 'about', 'licence', 'privacy', 'people',
  'security', 'models-hardware', 'storage', 'audit', 'health', 'updates',
];
/** Pages that changed rank. Their markup must still exist somewhere in the document. */
const DEMOTED = [
  'view-tasks', 'view-tools', 'view-memory', 'view-approvals', 'view-providers',
  'view-hardware', 'view-users', 'view-security', 'view-health', 'view-logs',
  'view-updates', 'view-backups', 'view-about',
];
/** Names that used to route and no longer do. Each must have a forwarding address. */
const RETIRED_ROUTES = [
  'tasks', 'tools', 'memory', 'approvals', 'providers', 'hardware', 'users',
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
    const root = /:root\{[^}]*\}/.exec(css);
    assert.ok(root, ':root token block not found');
    const body = css.replace(root[0], '');
    const literals = body.match(/#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)/g) ?? [];
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
