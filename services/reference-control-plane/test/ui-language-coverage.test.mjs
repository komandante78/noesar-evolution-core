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
    const html = readFileSync(join(repoRoot, 'apps/webui-static/index.html'), 'utf8');
    for (const entry of RUNTIME_ONLY) {
      assert.ok(!html.includes(entry),
        `${JSON.stringify(entry)} is declared runtime-only but appears in the markup — the exemption is hiding a real measurement`);
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
