// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Owner requirement, s333 point 4: «controllare se tutto il sistema è in lingua inglese e se
// in tutte le pagine funziona la traduzione … ho visto un mix … va fatto un controllo
// approfondito».
//
// "Un mix" is the exact shape of an exact-match dictionary with partial coverage: the strings
// that are in it change language, the ones that are not stay put, on the SAME screen. That is
// not a broken switch — it is missing coverage that fails in silence. This file exists so it
// cannot fail in silence again: the gap becomes a number, per page, and a non-zero exit.
//
// # What it measures
//
// Every user-visible string in the static markup of `apps/webui-static/index.html`, attributed
// to the page (view / settings section) it lives in, checked against each translation catalog
// that is not the source language. Visible means: a text node the translator would walk, or a
// `placeholder` / `title` / `aria-label` attribute — the same three attributes `i18n.js`
// touches, and the same `SCRIPT/STYLE/CODE/PRE` exclusions it applies. Reading the exclusions
// from anywhere but the translator would let the two drift, so they are imported from it.
//
// # What it does NOT measure, stated so the number cannot be read as more than it is
//
// Strings that only exist once JavaScript has painted something. This file reads markup; it
// does not run the application, so a panel whose text is assembled at render time is invisible
// to it. That half is measured where it is exact rather than guessed — in the browser, against
// the real DOM, by `tools/browser-e2e.mjs` (`I18N-RUNTIME`), which visits every destination in
// each language and reports what actually rendered untranslated. Neither measure is sufficient
// alone: this one is exhaustive over markup, that one is exhaustive over what a person sees.
// A green run here with a red run there means the gap is in the JavaScript, and vice versa.
//
// It also does not judge whether a translation is GOOD. It reports presence, never quality.
//
// Usage:
//   node tools/measure-ui-language-coverage.mjs           # report, exit 1 if anything is uncovered
//   node tools/measure-ui-language-coverage.mjs --list it # print the uncovered strings for `it`
//   node tools/measure-ui-language-coverage.mjs --json    # machine-readable

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { CATALOGS, SOURCE_LANGUAGE, UNTRANSLATED_TAGS, RUNTIME_ONLY } from '../apps/webui-static/i18n-catalog.js';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..');
const HTML = join(repoRoot, 'apps/webui-static/index.html');

/** Attributes `translateNode` reads. Kept in one place so the tool cannot measure a different set. */
const TRANSLATED_ATTRIBUTES = ['placeholder', 'title', 'aria-label'];

/**
 * Split the document into pages, then harvest the visible strings of each.
 *
 * A "page" is what the Owner means by one: a destination in the sidebar, or a section of
 * Settings that has its own address. Everything before the first such section (the top bar,
 * the sign-in gate, the status strip) belongs to `chrome`, which is a page in the only sense
 * that matters here — it is on screen, so it is either translated or it is not.
 */
function pagesOf(html) {
  // `</main>` matters: the context panel, the toasts, the announcers and every dialog live
  // AFTER it. Without this boundary they are attributed to whichever view happens to be last
  // in the file, which both misnames them and hides how many there are — the first run of this
  // tool credited 34 strings to `access-denied`, a page with four.
  const tailAt = html.indexOf('</main>');
  const head = tailAt === -1 ? html : html.slice(0, tailAt);
  const boundary = /<section class="(?:view|view active|settings-section|settings-sub)" id="([^"]+)"/g;
  const marks = [...head.matchAll(boundary)].map((m) => ({ id: m[1], at: m.index }));
  const pages = [];
  if (marks.length === 0) return [{ id: 'chrome', body: html }];
  pages.push({ id: 'chrome', body: head.slice(0, marks[0].at) });
  marks.forEach((mark, index) => {
    const end = index + 1 < marks.length ? marks[index + 1].at : head.length;
    // The raw id, never a prettified one: `section-health` and `view-health` are two different
    // places, and stripping the prefix collapsed them into one row that under-reported both.
    pages.push({ id: mark.id, body: head.slice(mark.at, end) });
  });
  if (tailAt !== -1) pages.push({ id: 'chrome-tail (context panel · dialogs · toasts)', body: html.slice(tailAt) });
  return pages;
}

/**
 * The same exclusions `translateNode` applies, plus comments, which are not on screen.
 *
 * The replacement is `><` and not a space, and the difference is not cosmetic. An excluded
 * element SEPARATES the text around it into two DOM text nodes, which are two independent
 * translation units. Replacing it with a space glues them into one string that no text node
 * will ever equal — so every such entry would sit in the catalogue matching nothing, and the
 * sentence on screen would stay untranslated while the count claimed otherwise. The first
 * draft of this file did exactly that and produced strings like `"at  , mode  , owned by"`.
 */
function strip(body) {
  let out = body.replace(/<!--[\s\S]*?-->/g, '><');
  for (const tag of UNTRANSLATED_TAGS) {
    out = out.replace(new RegExp(`<${tag}[\\s\\S]*?<\\/${tag}>`, 'gi'), '><');
  }
  return out;
}

/**
 * Entities are DECODED, never stripped.
 *
 * A browser hands the translator `"None"`, not `&quot;None&quot;` and not `  None  `. Deleting
 * the entity produces a key no text node can equal — the same class of error as gluing text
 * across an excluded element, and it hid behind a plausible-looking string until the dead-entry
 * check named it. Decoding happens after the text is cut out from between the tags, so putting
 * `<` and `>` back cannot disturb the cut.
 */
const NAMED_ENTITIES = {
  quot: '"', apos: "'", nbsp: ' ', hellip: '…', mdash: '—', ndash: '–',
  middot: '·', bull: '•', laquo: '«', raquo: '»', rsquo: '’', lsquo: '‘',
  ldquo: '“', rdquo: '”', times: '×', deg: '°', lt: '<', gt: '>',
};

function decodeEntities(text) {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&([a-z]+);/gi, (whole, name) => NAMED_ENTITIES[name.toLowerCase()] ?? whole)
    .replace(/&amp;/g, '&'); // last: an ampersand must not re-open another entity
}

function visibleStrings(body) {
  const stripped = strip(body);
  const found = new Set();
  for (const m of stripped.matchAll(/>([^<>]+)</g)) {
    const text = decodeEntities(m[1]).trim();
    // A string with no letter carries no language: separators, counters, bullets, `—`.
    if (text && /\p{L}/u.test(text)) found.add(text);
  }
  for (const attribute of TRANSLATED_ATTRIBUTES) {
    for (const m of stripped.matchAll(new RegExp(`\\s${attribute}="([^"]+)"`, 'g'))) {
      const text = decodeEntities(m[1]).trim();
      if (text && /\p{L}/u.test(text)) found.add(text);
    }
  }
  return found;
}

const html = readFileSync(HTML, 'utf8');
const pages = pagesOf(html).map((page) => ({ ...page, strings: visibleStrings(page.body) }));
const targets = Object.keys(CATALOGS).filter((code) => code !== SOURCE_LANGUAGE);

const report = { sourceLanguage: SOURCE_LANGUAGE, languages: {} };
for (const code of targets) {
  const dictionary = CATALOGS[code];
  const perPage = [];
  let covered = 0;
  let total = 0;
  for (const page of pages) {
    const missing = [...page.strings].filter((s) => !Object.hasOwn(dictionary, s));
    covered += page.strings.size - missing.length;
    total += page.strings.size;
    perPage.push({ page: page.id, total: page.strings.size, missing });
  }
  // A catalog entry matching nothing in the markup is not harmless: it is a claim of coverage
  // that no screen can honour, and it inflates any count taken from the catalog's own size.
  const everything = new Set(pages.flatMap((p) => [...p.strings]));
  // A declared runtime-only string is not stale: it is text JavaScript writes, which a reader
  // of markup cannot see. Only the strings NAMED in RUNTIME_ONLY are forgiven — anything else
  // matching no screen is still reported, so the exemption cannot quietly widen.
  const runtimeOnly = new Set(RUNTIME_ONLY);
  const dead = Object.keys(dictionary).filter((k) => !everything.has(k) && !runtimeOnly.has(k));
  report.languages[code] = { covered, total, perPage, dead };
}

// `--json` prints JSON and nothing else. The verdict lines below are prose, and prose on the
// same stream turns a machine-readable mode into a parse error for whoever consumes it.
const asJson = process.argv.includes('--json');
if (asJson) {
  console.log(JSON.stringify(report, null, 2));
} else {
  const listFor = process.argv[process.argv.indexOf('--list') + 1];
  for (const code of targets) {
    const r = report.languages[code];
    const pct = r.total === 0 ? 100 : (r.covered / r.total) * 100;
    console.log(`\n=== ${code.toUpperCase()} — static markup of index.html ===`);
    console.log(`covered ${r.covered} of ${r.total} visible strings  (${pct.toFixed(2)}%)`);
    console.log(`catalog entries matching nothing on any screen: ${r.dead.length}`);
    console.log('');
    console.log('  PAGE                            TOTAL  MISSING');
    for (const p of r.perPage.filter((x) => x.total > 0)) {
      const flag = p.missing.length === 0 ? '  ok' : '  <<';
      console.log(`  ${p.page.padEnd(30)} ${String(p.total).padStart(5)}  ${String(p.missing.length).padStart(7)}${flag}`);
    }
    if (process.argv.includes('--list') && listFor === code) {
      console.log(`\n--- uncovered strings for ${code} ---`);
      for (const p of r.perPage) {
        for (const s of p.missing) console.log(`  [${p.page}] ${JSON.stringify(s)}`);
      }
    }
    for (const s of r.dead) console.log(`  DEAD ENTRY (matches no screen): ${JSON.stringify(s)}`);
  }
}

const incomplete = targets.filter((code) => report.languages[code].covered !== report.languages[code].total);
const withDead = targets.filter((code) => report.languages[code].dead.length > 0);
if (incomplete.length > 0 || withDead.length > 0) process.exitCode = 1;
if (asJson) process.exit(process.exitCode ?? 0);
console.log('');
if (incomplete.length === 0 && withDead.length === 0) {
  console.log('VERDICT=COVERED  every visible string in the static markup has an entry in every');
  console.log('                 catalogue, and no catalogue entry matches a screen that does not exist.');
  console.log('                 This says nothing about text that only appears once JavaScript has run:');
  console.log('                 that half is measured in the browser by I18N-RUNTIME.');
} else {
  if (incomplete.length > 0) console.log(`VERDICT=GAPS  incomplete: ${incomplete.join(', ')}`);
  if (withDead.length > 0) console.log(`VERDICT=GAPS  catalogue entries matching no screen: ${withDead.join(', ')}`);
  console.log('              Re-run with --list <code> for the strings. A missing entry does not');
  console.log('              raise an error in the browser: it renders in the source language and');
  console.log('              says nothing, which is the "mix" this check exists to make loud.');
}
