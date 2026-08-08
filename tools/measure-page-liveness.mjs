// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Owner requirement, s333 point 3a: «devi controllare tutte le pagine della webui, capire cosa
// fanno, come funzionano … perché mi sembrano tutte pagine statiche».
//
// The census is DERIVED, never typed. A hand-written table of what each page does is correct on
// the day it is written and silently wrong afterwards — and this project has paid for exactly
// that shape more than once (`PANEL_NAMES` said fourteen against twenty-five, `D-0300`; the
// change list recorded «too wide» when the Owner meant «wider still», s333). So every column
// below is read out of the files that ship.
//
// # What "live" means here, stated so the word cannot be stretched
//
// A page is **live** when opening it causes the product to go and ask something: it has a
// loader registered in `VIEW_LOADERS`, or its loader is reached through the settings-section
// table, and that loader calls `api(...)`. A page is **static** when nothing about it changes
// after the markup is parsed.
//
// Three things this deliberately does NOT claim:
//
//   1. **Static is not a defect.** `#/not-found` should be static. A page that draws a fixed
//      explanation of a fixed fact is finished, not lazy. The Owner's «mi sembrano tutte pagine
//      statiche» is an impression to be MEASURED, and the useful answer names which ones really
//      are — otherwise "improving" them is guessing.
//   2. **Live is not the same as useful.** A page that fetches and then renders "nothing here"
//      is live and may still read as dead. That is a different repair and it is reported
//      separately, as `declaredEmpty`.
//   3. **This reads source, not a browser.** A loader that throws still counts as a loader. The
//      browser check is where behaviour is measured; this is where COVERAGE is measured, and it
//      is exhaustive over pages in a way clicking never is.
//
// Usage:
//   node tools/measure-page-liveness.mjs            # the table
//   node tools/measure-page-liveness.mjs --json     # machine-readable
//   node tools/measure-page-liveness.mjs --markdown # the census document

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..');
const html = readFileSync(join(repoRoot, 'apps/webui-static/index.html'), 'utf8');
const app = readFileSync(join(repoRoot, 'apps/webui-static/app.js'), 'utf8');

/** Every destination and settings section that has an address, read off the markup. */
function pagesOf() {
  const pages = [];
  for (const m of html.matchAll(/<section class="(view|view active|settings-section|settings-sub)" id="([^"]+)"([^>]*)>/g)) {
    const [, kind, id, rest] = m;
    const section = /data-section="([^"]+)"/.exec(rest)?.[1] ?? null;
    pages.push({
      id,
      kind: kind.startsWith('view') ? 'destination' : 'settings-section',
      section,
      // The address a person can type. A destination is its own name; a settings section lives
      // under `settings/`.
      address: kind.startsWith('view') && !section ? id.replace(/^view-/, '') : `settings/${section ?? id.replace(/^(view|section)-/, '')}`,
      at: m.index,
    });
  }
  return pages.map((page, index) => ({
    ...page,
    body: html.slice(page.at, index + 1 < pages.length ? pages[index + 1].at : html.indexOf('</main>')),
  }));
}

/**
 * Split an object literal into entries, counting brackets rather than splitting on commas.
 *
 * The first version matched `key: value,` with a regex that forbade commas in the value, and
 * silently lost every entry with an argument list —
 * `sessions:()=>loadWorkSessions(sessionPlaceFromHash(),1)` among them, which made this file
 * report a page as static that loads on every open. A measurement that is wrong in the
 * reassuring direction is worse than no measurement.
 */
function entriesOf(source) {
  // Comments are stripped FIRST, and quoted keys are accepted.
  //
  // Two more defects in this file, both found by it reporting a page as static that the very
  // same edit had just made live. A comma inside a `//` comment split an entry in half, so
  // `chat:refreshWorkspaceData` arrived with prose glued to its front and matched nothing —
  // the known trap in this repository, that a source-scanning guard reads comments too, biting
  // a scanner rather than a guard. And a quoted key (`'models-hardware':`) failed a pattern
  // that only allowed bare identifiers, which is how two sections that had just been wired
  // still read as drawing fixed markup.
  const clean = source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').map((line) => line.replace(/(^|\s)\/\/.*$/, '')).join('\n');
  source = clean;
  const entries = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    if ('([{'.includes(ch)) depth += 1;
    else if (')]}'.includes(ch)) depth -= 1;
    else if (ch === ',' && depth === 0) { entries.push(source.slice(start, i)); start = i + 1; }
  }
  entries.push(source.slice(start));
  return entries
    .map((entry) => /^\s*['"]?([a-zA-Z-]+)['"]?\s*:\s*([\s\S]+)$/.exec(entry))
    .filter(Boolean)
    .map((m) => [m[1], m[2].trim()]);
}

/** The two tables app.js dispatches through. Read, not assumed — they are the routing truth. */
function loaderTables() {
  const views = new Map();
  const assign = /Object\.assign\(VIEW_LOADERS,\{([\s\S]*?)\n\}\);/.exec(app)?.[1] ?? '';
  for (const m of entriesOf(assign)) views.set(m[0], m[1]);
  const sections = new Map();
  const sectionTable = /SECTION_LOADERS\s*,?\s*\{([\s\S]*?)\n\}\)/.exec(app)?.[1]
    ?? /registerSectionLoaders\(\{([\s\S]*?)\n\}\)/.exec(app)?.[1] ?? '';
  for (const m of entriesOf(sectionTable)) sections.set(m[0], m[1]);
  return { views, sections };
}

/** Does this named function — or anything it calls by name — reach `api(`? One hop is enough. */
function callsApi(name, depth = 0) {
  if (!name || depth > 2) return false;
  // EVERY name called in the expression, not the first identifier in it. A loader written as
  // `()=>{benchOpenedAt=benchOpenedAt||Date.now();loadCoden();…}` starts with an assignment,
  // and taking the first identifier resolved `benchOpenedAt` — so `#/coden`, one of the
  // busiest pages in the product, was reported as drawing fixed markup.
  const called = [...String(name).matchAll(/\b([a-zA-Z_$][\w$]*)\s*\(/g)].map((m) => m[1]);
  if (called.length > 1 || (called.length === 1 && !/^\s*[a-zA-Z_$][\w$]*\s*$/.test(name))) {
    return called.some((fn) => fn !== 'api' ? callsApi(fn, depth + 1) : true);
  }
  const identifier = called[0] ?? String(name).match(/[a-zA-Z_$][\w$]*/)?.[0];
  if (!identifier) return false;
  const body = new RegExp(`(?:async\\s+)?function\\s+${identifier}\\s*\\([^)]*\\)\\s*\\{`).exec(app);
  if (!body) return /api\(/.test(name);
  const start = body.index + body[0].length;
  let depthCount = 1;
  let i = start;
  while (i < app.length && depthCount > 0) {
    if (app[i] === '{') depthCount += 1;
    else if (app[i] === '}') depthCount -= 1;
    i += 1;
  }
  const source = app.slice(start, i);
  if (/\bapi\(/.test(source)) return true;
  for (const call of source.matchAll(/\b(load[A-Z][\w$]*|refresh[A-Z][\w$]*|render[A-Z][\w$]*)\s*\(/g)) {
    if (callsApi(call[1], depth + 1)) return true;
  }
  return false;
}

/**
 * Every element id written by a renderer that `renderAll()` calls.
 *
 * Derived by reading `renderAll`'s own body for the functions it calls, then each of those for
 * the ids it writes. Typing this list would make it wrong the first time somebody added a
 * renderer — the same failure as every other hand-kept list this project has had to repair.
 */
function renderAllTargets() {
  const call = /function renderAll\(\)\{([\s\S]*?)\n\}/.exec(app)?.[1] ?? '';
  const targets = new Set();
  for (const m of call.matchAll(/\b(render[A-Z][\w$]*|update[A-Z][\w$]*)\s*\(/g)) {
    const body = new RegExp(`function ${m[1]}\\([^)]*\\)\\{([\\s\\S]*?)\\n\\}`).exec(app)?.[1] ?? '';
    for (const id of body.matchAll(/\$\('#([A-Za-z][\w-]*)'\)/g)) targets.add(id[1]);
  }
  return targets;
}
const RENDER_ALL_TARGETS = renderAllTargets();

/** Which settings section each sub-view is drawn inside, read off the markup's nesting order. */
const SUB_VIEW_OWNER = (() => {
  const owner = {};
  let current = null;
  for (const m of html.matchAll(/<section class="(settings-section|settings-sub)" id="([^"]+)"([^>]*)>/g)) {
    const section = /data-section="([^"]+)"/.exec(m[3])?.[1] ?? null;
    if (m[1] === 'settings-section') current = section ?? m[2];
    else owner[m[2]] = current;
  }
  return owner;
})();

const { views, sections } = loaderTables();
const rows = pagesOf().map((page) => {
  const key = page.kind === 'destination' ? page.address : (page.section ?? '');
  // A sub-view has no section of its own: it is drawn inside one, and that one's loader is what
  // runs when it opens. `view-logs` lives in `health`, whose loader calls `loadLogs()`.
  const owner = page.section ?? SUB_VIEW_OWNER[page.id] ?? '';
  const loader = page.kind === 'destination'
    ? views.get(key) ?? null
    : sections.get(page.section ?? owner) ?? null;
  const live = loader ? callsApi(loader) : false;
  // A panel that says why it is empty. Not a fault — it is the product refusing to frame
  // emptiness as though something were coming. Counted so "static" and "declared empty" are
  // never confused: the second is a decision, the first may be an omission.
  // The distinction that decides what "improve it" even MEANS, and the reason this file
  // exists rather than a hand-written list. A page with no loader is not necessarily drawing
  // fixed markup: several are painted by `renderAll()` out of the boot state, which is fetched
  // exactly once when the application starts. Those pages ARE showing real data — and they show
  // whatever it was when you signed in, and never look again. That is precisely how a page can
  // be full of true values and still read as dead, which is the Owner's «mi sembrano tutte
  // pagine statiche» from the inside.
  //
  // Three states, not two:
  //   live      — opening it asks the server something
  //   boot-only — real data, fetched once at sign-in, never refreshed afterwards
  //   static    — nothing about it changes after the markup is parsed
  const ids = [...page.body.matchAll(/id="([A-Za-z][\w-]*)"/g)].map((m) => m[1]);
  const bootPainted = !loader && ids.some((id) => RENDER_ALL_TARGETS.has(id));
  const declaredEmpty = (page.body.match(/class="declared-empty"/g) ?? []).length;
  const forms = (page.body.match(/<(?:input|select|textarea)\b/g) ?? []).length;
  const buttons = (page.body.match(/<button\b/g) ?? []).length;
  return { ...page, body: undefined, loader, live, bootPainted, state: live ? 'live' : (bootPainted ? 'boot-only' : 'static'), declaredEmpty, forms, buttons };
});

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(rows, null, 2));
} else if (process.argv.includes('--markdown')) {
  console.log('| Address | Kind | Loader | Live | Declared-empty panels | Fields | Buttons |');
  console.log('|---|---|---|---|---|---|---|');
  for (const row of rows) {
    console.log(`| \`${row.address}\` | ${row.kind} | ${row.loader ? `\`${row.loader}\`` : '—' } | ${row.live ? 'yes' : 'no'} | ${row.declaredEmpty} | ${row.forms} | ${row.buttons} |`);
  }
} else {
  console.log('ADDRESS                          KIND              LOADER                 STATE      EMPTY  FIELDS  BUTTONS');
  for (const row of rows) {
    console.log(
      `${row.address.padEnd(32)} ${row.kind.padEnd(17)} ${(row.loader ?? '—').slice(0, 22).padEnd(22)} ${row.state.padEnd(10)} ${String(row.declaredEmpty).padStart(5)} ${String(row.forms).padStart(6)} ${String(row.buttons).padStart(8)}`,
    );
  }
  const live = rows.filter((r) => r.state === 'live').length;
  const bootOnly = rows.filter((r) => r.state === 'boot-only');
  const noLoader = rows.filter((r) => r.state === 'static');
  console.log('');
  console.log(`PAGES=${rows.length} LIVE=${live} BOOT_ONLY=${bootOnly.length} STATIC=${noLoader.length}`);
  console.log('');
  console.log('Static is not automatically a defect: #/not-found should be static. What this');
  console.log('measurement is for is that "they all seem static" stops being an impression and');
  console.log('becomes a list — improving a page nobody measured is guessing at which one.');
  if (bootOnly.length > 0) {
    console.log('');
    console.log('Real data, fetched once at sign-in, never refreshed — full of true values and');
    console.log('still dead to look at, which is the complaint from the inside:');
    for (const row of bootOnly) console.log(`  ${row.address}`);
  }
  if (noLoader.length > 0) {
    console.log('');
    console.log('Pages that draw nothing but fixed markup:');
    for (const row of noLoader) console.log(`  ${row.address}  (${row.forms} fields, ${row.buttons} buttons)`);
  }
}
