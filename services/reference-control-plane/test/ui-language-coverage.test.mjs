// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Owner, s333 point 4: «ho visto un mix … va fatto un controllo approfondito».
//
// What is defended here is not a function — it is the property that a half-translated interface
// cannot ship quietly. Before this file the translation had NO test of any kind, and coverage
// had drifted to 9.97% without anything turning red: 72 of 722 visible strings had an entry, and
// a string without one renders in the source language and says nothing at all. That silence is
// the defect. Every assertion below exists to convert it into a failure.
//
// The s330 rule applies with full force here: a test that asserts the value a system HAS, rather
// than the property it must HOLD, pins the defect as a requirement. So nothing below asserts
// "coverage is 793" — it asserts "coverage is complete", which stays meaningful when the
// interface grows.

import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  CATALOGS, SOURCE_LANGUAGE, RUNTIME_ONLY, LANGUAGE_NAMES, UNTRANSLATED_TAGS,
} from '../../../apps/webui-static/i18n-catalog.js';
import { resolveLanguage, translateString, applyToTextNode } from '../../../apps/webui-static/i18n.js';
import { AGENT_COMMANDS, MENU_GROUPS, hiddenNote } from '../../../apps/shared/coden/agent-commands.js';
import { promptKeys } from '../../../apps/webui-static/coden-view-model.js';
import { PAGE_HELP } from '../../../apps/webui-static/page-help.js';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '../../..');

function coverageReport() {
  // The tool exits non-zero when there are gaps; that is its contract, so a non-zero exit is
  // read as data rather than as a crash. Reading `stdout` off the thrown error is deliberate.
  try {
    return JSON.parse(execFileSync('node', ['tools/measure-ui-language-coverage.mjs', '--json'],
      { cwd: repoRoot, maxBuffer: 1e8 }).toString());
  } catch (error) {
    if (!error.stdout) throw error;
    return JSON.parse(error.stdout.toString());
  }
}

describe('every visible string in the markup is translatable', () => {
  const report = coverageReport();

  test('no page has an uncovered string in any catalogue', () => {
    for (const [code, result] of Object.entries(report.languages)) {
      const gaps = result.perPage.filter((page) => page.missing.length > 0);
      const detail = gaps.map((page) => `${page.page}: ${page.missing.length} — e.g. ${JSON.stringify(page.missing[0])}`);
      assert.deepEqual(detail, [], `${code} has uncovered strings:\n  ${detail.join('\n  ')}`);
      // Asserted as a property, not a number: "covered equals total" survives the interface
      // growing, where "covered is 793" would have to be edited every time and would therefore
      // be edited without thought.
      assert.equal(result.covered, result.total, `${code}: ${result.covered} of ${result.total}`);
    }
  });

  test('no catalogue entry claims coverage of a screen that does not exist', () => {
    for (const [code, result] of Object.entries(report.languages)) {
      assert.deepEqual(result.dead, [],
        `${code} has entries matching nothing on any screen — a stale entry is a claim of coverage that no page can honour`);
    }
  });

  test('the tool fails when a string is uncovered — the check can actually go red', () => {
    // A completeness check that cannot fail is decoration. This drives the real tool against a
    // catalogue with one entry removed and requires a non-zero exit, so the green above means
    // something. Without this, deleting the exit code would leave every other test passing.
    const catalogPath = join(repoRoot, 'apps/webui-static/i18n-catalog.js');
    const original = readFileSync(catalogPath, 'utf8');
    const victim = "  'Send': 'Invia',\n";
    assert.ok(original.includes(victim), 'the string this test removes must exist to be removed');
    let exitCode = 0;
    try {
      writeFileSync(catalogPath, original.replace(victim, ''));
      execFileSync('node', ['tools/measure-ui-language-coverage.mjs'], { cwd: repoRoot, maxBuffer: 1e8 });
    } catch (error) {
      exitCode = error.status ?? 1;
    } finally {
      writeFileSync(catalogPath, original);
    }
    assert.equal(exitCode, 1, 'removing a catalogue entry must make the coverage check fail');
  });

  test('D-0630 ORACLE: a visible string typed straight into a data file is caught, not invisible', () => {
    // This is the exact defect that shipped in D-0625 and went unnoticed through the whole
    // phase: the model catalogue seed's descriptions were written in Italian, and this tool
    // scanned only index.html — a data file's own strings were invisible to it by construction.
    // Reproduced here against the real seed and asserted to fail, so the fix (DATA_FILES in
    // tools/measure-ui-language-coverage.mjs) cannot silently stop being exercised.
    const seedPath = join(repoRoot, 'capabilities/model-catalog-seed.json');
    const original = readFileSync(seedPath, 'utf8');
    const seed = JSON.parse(original);
    seed.models[0].description = 'Questa e una descrizione scritta per errore in italiano.';
    let exitCode = 0;
    try {
      writeFileSync(seedPath, `${JSON.stringify(seed, null, 2)}\n`);
      execFileSync('node', ['tools/measure-ui-language-coverage.mjs'], { cwd: repoRoot, maxBuffer: 1e8 });
    } catch (error) {
      exitCode = error.status ?? 1;
    } finally {
      writeFileSync(seedPath, original);
    }
    assert.equal(exitCode, 1, 'a data-file string outside the translation catalogue must make the coverage check fail');
  });
});

describe('the source language is a source, not a translation', () => {
  test('the source catalogue is empty — the markup already says it', () => {
    assert.deepEqual(CATALOGS[SOURCE_LANGUAGE], {},
      'an entry for the source language would be a second place the English lives, free to drift from the markup');
  });

  test('every language ships a display name in its own language', () => {
    for (const code of Object.keys(CATALOGS)) {
      assert.ok(LANGUAGE_NAMES[code], `${code} has no display name`);
    }
  });
});

describe('the catalogue cannot translate twice or contradict itself', () => {
  test('translating an already-translated node again changes nothing', () => {
    // The first version of this test asserted a PROXY — "no catalogue value is also a key" — and
    // went red on `Accounts -> Account`, which is simply correct Italian (the noun does not
    // inflect). The proxy was wrong, not the catalogue: idempotence here does not come from the
    // absence of collisions, it comes from every pass reading the node's STORED SOURCE rather
    // than what the node currently shows. So the property is asserted directly, on the real code
    // path, including the collision that exposed the mistake.
    for (const source of ['Accounts', 'Account', 'Send', 'Home', 'Not in the catalogue at all']) {
      const node = { nodeValue: source };
      applyToTextNode(node, 'it');
      const afterFirst = node.nodeValue;
      applyToTextNode(node, 'it');
      assert.equal(node.nodeValue, afterFirst, `${JSON.stringify(source)} changed on a second pass`);
      // And it must be reversible: choosing the source language restores the English, which is
      // what lets the picker work without reloading the page.
      applyToTextNode(node, SOURCE_LANGUAGE);
      assert.equal(node.nodeValue, source, `${JSON.stringify(source)} did not come back`);
    }
  });

  test('runtime-only entries are declared, and each one really is absent from the markup', () => {
    // Asked of the extractor, not of the raw file. A substring search says "Replace" is in the
    // markup because "Replace authenticator" is — and would have forced a real runtime string
    // out of the declared list to silence a false alarm, which is how an exemption list stops
    // meaning anything.
    const visible = new Set(coverageReport().visible);
    for (const entry of RUNTIME_ONLY) {
      assert.ok(!visible.has(entry),
        `${JSON.stringify(entry)} is declared runtime-only but IS a visible string in the markup — the exemption is hiding a real measurement`);
    }
  });

  // The hole that declaration left. Runtime-only exempts a string from the MARKUP scan and
  // from nothing else, but five of the CodeN terminal's states were listed there and never
  // translated: the static tool skipped them by declaration and I18N-RUNTIME never saw them
  // because reaching them needs a socket that moves. Both checks green, the status line in
  // English. Saying where a string lives is not saying it needs no translation.
  test('every runtime-only string is translated in every catalogue', () => {
    for (const [code, catalogue] of Object.entries(CATALOGS)) {
      if (code === SOURCE_LANGUAGE) continue;
      const untranslated = RUNTIME_ONLY.filter((entry) => !(entry in catalogue));
      assert.deepEqual(untranslated, [],
        `${code}: declared runtime-only but absent from the catalogue, so each renders in ${SOURCE_LANGUAGE}`);
    }
  });
});

describe('resolving a language', () => {
  test('auto follows the browser, and only among languages we ship', () => {
    assert.equal(resolveLanguage('auto', 'it-IT'), 'it');
    assert.equal(resolveLanguage('auto', 'en-GB'), 'en');
    assert.equal(resolveLanguage('auto', 'de-DE'), SOURCE_LANGUAGE, 'a language we do not ship falls back to the source');
    assert.equal(resolveLanguage('auto', ''), SOURCE_LANGUAGE);
  });

  test('an explicit choice beats the browser', () => {
    // This is the Owner's «clicco sulla traduzione e rimane in inglese» read as a requirement:
    // choosing English on an Italian browser must produce English.
    assert.equal(resolveLanguage('en', 'it-IT'), 'en');
    assert.equal(resolveLanguage('it', 'en-GB'), 'it');
  });

  test('a stored language we no longer ship does not strand the interface', () => {
    assert.equal(resolveLanguage('de', 'it-IT'), SOURCE_LANGUAGE);
  });
});

describe('translating one string', () => {
  test('a known string is translated and reports success', () => {
    assert.deepEqual(translateString('Send', 'it'), { text: 'Invia', translated: true });
  });

  test('surrounding whitespace belongs to the layout and survives', () => {
    assert.equal(translateString('\n  Send  \n', 'it').text, '\n  Invia  \n');
  });

  test('an unknown string is reported, not swallowed', () => {
    const result = translateString('A sentence nobody has translated', 'it');
    assert.equal(result.translated, false);
    assert.equal(result.missing, 'A sentence nobody has translated');
    assert.equal(result.text, 'A sentence nobody has translated', 'it still renders — in the source language');
  });

  test('the source language never reports a gap', () => {
    assert.deepEqual(translateString('Anything at all', SOURCE_LANGUAGE), { text: 'Anything at all', translated: true });
  });

  test('a string with no letter carries no language and is never a gap', () => {
    for (const symbol of [' — ', '···', '0', '  ', '→']) {
      assert.equal(translateString(symbol, 'it').translated, true, `${JSON.stringify(symbol)} was reported as untranslated`);
    }
  });
});

describe('the translator and the measurement tool cannot drift apart', () => {
  test('both read the excluded tags from the same place', () => {
    const toolSource = readFileSync(join(repoRoot, 'tools/measure-ui-language-coverage.mjs'), 'utf8');
    assert.ok(toolSource.includes('UNTRANSLATED_TAGS'),
      'the tool must import the exclusion list rather than keep a copy — two copies is how a measurement stops measuring the thing it names');
    assert.ok(UNTRANSLATED_TAGS.includes('code') && UNTRANSLATED_TAGS.includes('pre'));
  });

  test('no render function calls applyTranslations — the observer is the mechanism', () => {
    // The repair for defect 2 was structural: 48 of 58 renderers were never translated, and the
    // fix is NOT to add a call to each. If a call site reappears in app.js, someone has started
    // rebuilding the per-renderer discipline this replaced, and the next 48 renderers will be
    // forgotten exactly as the last 48 were.
    const app = readFileSync(join(repoRoot, 'apps/webui-static/app.js'), 'utf8');
    assert.ok(!app.includes('applyTranslations'),
      'app.js calls applyTranslations directly; translation is a property of the document, held by the MutationObserver in i18n.js');
  });
});

// ——— the `/` menu, s336 voice stage 2 ———
//
// The gap this block closes was invisible to BOTH existing measurements at once, which is why it
// survived s333 point 3's «controllo approfondito» and shipped reading `VERDICT=COVERED`:
//
//   - `measure-ui-language-coverage.mjs` reads `index.html`. Every row of the `/` menu is
//     composed at render time out of `AGENT_COMMANDS`, so there is nothing in that file to read.
//   - `I18N-RUNTIME` reads the translator's own record of misses after visiting every VIEW. The
//     menu is not a view; it is a box that opens over one. Nothing in the run ever opened it.
//
// Two measurements, each sound, each agreeing with itself, and between them a surface the Owner
// uses for every navigation in the product — thirty-three command descriptions, seven group
// headings and the whole prompt legend — rendering in English whatever language was chosen.
//
// So the guard goes HERE, in the unit suite, beside the registry that owns the strings. It reads
// the registry rather than a list of its own: adding a thirty-fourth command with no translation
// has to turn something red, and it can only do that if nobody has to remember to add it.
describe('the `/` menu is translated — the surface neither measurement could see', () => {
  const languages = Object.keys(CATALOGS).filter((code) => code !== SOURCE_LANGUAGE);

  test('every command summary has an entry in every catalogue', () => {
    for (const code of languages) {
      const missing = AGENT_COMMANDS.filter((command) => !CATALOGS[code][command.summary])
        .map((command) => `/${command.name}`);
      assert.deepEqual(missing, [],
        `${code}: ${missing.length} of ${AGENT_COMMANDS.length} command descriptions render in English in the one menu this product navigates by`);
    }
  });

  test('every argument placeholder has an entry in every catalogue', () => {
    const placeholders = [...new Set(AGENT_COMMANDS.map((command) => command.argument).filter(Boolean))];
    for (const code of languages) {
      const missing = placeholders.filter((placeholder) => !CATALOGS[code][placeholder]);
      assert.deepEqual(missing, [], `${code}: untranslated argument placeholders`);
    }
  });

  test('every group heading has an entry in every catalogue', () => {
    for (const code of languages) {
      const missing = MENU_GROUPS.filter((group) => !CATALOGS[code][group.title]).map((group) => group.title);
      assert.deepEqual(missing, [], `${code}: the bare / paints these headings in English`);
    }
  });

  // The two composed sentences. Asserted as PROPERTIES rather than as their finished text — the
  // s330 rule: pinning `2 nascosti — richiedono workspace.write` would make today's wording the
  // requirement, and the wording is not what matters. What matters is that the translated parts
  // arrive, the count survives, and the permission name is NOT translated: `workspace.write` is
  // a token the server matches, and a localised one names a permission that does not exist.
  test('the filter note is composed from translated parts, and permission names are not among them', () => {
    const translate = (text) => CATALOGS.it[text] ?? text;
    const note = hiddenNote({ accessFiltered: true, hidden: 2, hiddenBy: { 'workspace.write': 2 } }, translate);
    assert.match(note, /^2 /, 'the count is lost');
    assert.ok(note.includes(CATALOGS.it['hidden — they need']), 'the sentence was not translated');
    assert.ok(note.includes('workspace.write'), 'the permission token was translated — it names nothing then');
    assert.ok(!note.includes('hidden — they need'), 'the English fragment survived alongside the Italian one');
  });

  test('the note and the legend keep English when no translator is passed — the terminal path', () => {
    // The default argument is what the terminal relies on, and a default that quietly became
    // browser-shaped would change a shell nobody was looking at. Exercised, not assumed.
    assert.match(hiddenNote({ accessFiltered: false }), /^Not filtered/);
    assert.deepEqual(promptKeys(null), ['Enter sends', '/ opens the menu', 'Tab completes without sending']);
  });

  test('every legend fragment either has an entry or carries no language', () => {
    // Driven through all four frames the function can produce rather than through a written list
    // of fragments, so a fifth frame added later is covered by construction.
    const frames = [null, { level: 'groups' }, { level: 'entries' }, { level: 'entries', group: { title: 'WORK' } }];
    for (const code of languages) {
      const translate = (text) => CATALOGS[code][text] ?? text;
      for (const frame of frames) {
        const english = promptKeys(frame);
        const localised = promptKeys(frame, translate);
        assert.equal(localised.length, english.length, 'a frame lost or gained a key under translation');
        for (const [index, key] of english.entries()) {
          // A fragment with no letter in it carries no language — the same rule `translateString`
          // applies — so it is allowed to come back unchanged. Anything with a word in it is not.
          if (!/\p{L}/u.test(key)) continue;
          assert.notEqual(localised[index], key, `${code}: the legend fragment ${JSON.stringify(key)} has no translation`);
        }
      }
    }
  });

  // Written after making the mistake, not before: adding the `/` menu's strings put a SECOND
  // entry for a sentence the catalogue already had, and the later one silently replaced the
  // earlier. Nothing could have caught it at runtime — a duplicate key in an object literal is
  // gone by the time anything can look — so this reads the source. The failure it prevents is
  // the nastiest kind available here: two translations of one sentence, one of them dead, and
  // the interface showing whichever came last with every check still green.
  test('no sentence is translated twice', () => {
    const source = readFileSync(join(repoRoot, 'apps/webui-static/i18n-catalog.js'), 'utf8');
    const body = source.slice(source.indexOf('const it = {'));
    const seen = new Map();
    // All three ways a key is written in this file, not one of them. The first version read
    // single quotes only and therefore never examined 20 of the 1369 entries: the whole
    // account-recovery and authenticator block, written with double quotes, plus `models:`,
    // written as a bare identifier. A second translation of any of those would have killed the
    // first in silence with this check green — and those are the sentences a person reads when
    // they are locked out.
    for (const match of body.matchAll(/^ {2}((?:'(?:[^'\\]|\\.)*')|(?:"(?:[^"\\]|\\.)*")|(?:[A-Za-z_$][\w$]*))\s*:/gm)) {
      seen.set(match[1], (seen.get(match[1]) ?? 0) + 1);
    }
    assert.ok(seen.size > 500, 'the key scanner matched almost nothing — it has stopped measuring');
    const duplicated = [...seen].filter(([, count]) => count > 1).map(([key]) => key);
    assert.deepEqual(duplicated, [], 'these sentences have two entries; the second one wins and the first is dead');
    // The backstop, and the only part of this that cannot be fooled by HOW a key is written:
    // every key line in the file has to still be a key in the object. One fewer means two
    // lines collapsed into one entry — including the case the scan above cannot see, the same
    // sentence written once in single quotes and once in double.
    assert.equal(seen.size, Object.keys(CATALOGS.it).length,
      'the file has key lines the catalogue has no keys for — a sentence is translated twice and the later entry silently won');
  });

  // The derivation is load-bearing and quiet: if it were replaced by a copied list, this suite
  // would keep passing while the tool started reporting every command description as a dead
  // entry — or, worse, someone would silence the tool by adding a blanket exemption.
  test('the runtime-only list is derived from the registries, not copied', () => {
    for (const command of AGENT_COMMANDS) {
      assert.ok(RUNTIME_ONLY.includes(command.summary),
        `/${command.name}'s description is not declared runtime-only, so the tool will report it as matching no screen`);
    }
    for (const group of MENU_GROUPS) assert.ok(RUNTIME_ONLY.includes(group.title));
    // Added after the copy drifted. `page-help.js` owns these sentences; 68 of them were
    // restated here, one fell behind when its page's help text was extended, and the panel
    // rendered in English with every check green — the stale entry was forgiven because it
    // was declared runtime-only.
    for (const [address, entry] of Object.entries(PAGE_HELP)) {
      for (const text of [entry.what, entry.howto]) {
        assert.ok(RUNTIME_ONLY.includes(text),
          `${address}: a help text is not declared runtime-only, so the tool will report it as matching no screen`);
      }
    }
    const catalogueSource = readFileSync(join(repoRoot, 'apps/webui-static/i18n-catalog.js'), 'utf8');
    assert.match(catalogueSource, /\.\.\.AGENT_COMMANDS\.map/,
      'the runtime-only list restates the command strings instead of deriving them — that is a second list, and a second list is what PANEL_NAMES was');
    assert.match(catalogueSource, /\.\.\.Object\.values\(PAGE_HELP\)/,
      'the runtime-only list restates the help texts instead of deriving them — that copy is what drifted');
  });
});
