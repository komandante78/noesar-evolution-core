// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Owner, 2026-10-16: "lavora con estensione chrome per fare tutti i test della grafica dal vivo". Looking at the CodeN page of the
// release shots, the "Recursive scope" box was a white square on a dark page — and it was white in the shot of 12 October too.
//
// The page says `<meta name="color-scheme" content="light dark">`, which hands every native control (boxes, radios, scrollbars, the open
// list of a <select>, date pickers) to the scheme of the OPERATING SYSTEM. A theme must say which scheme it is: the generator already
// said so for two themes (its own comment: "or form controls and scrollbars keep rendering for the old one") and forgot the other seven.
// On a computer set to light, seven of the nine themes drew white native controls on a dark page; on a computer set to dark, Daylight
// was the only one right and the rest depended on the machine.
//
// Held as a property of the stylesheet AND of the generator that writes its theme block: every theme names its scheme, and the one light
// theme is the only one that says light. (The block in styles.css is not byte-for-byte what the generator writes today — daylight differs
// by rounding in 45 token lines, measured 2026-10-16 — so the generator is run on a copy, here, and not compared whole.)

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '../../..');

const THEMES = ['midnight', 'slate', 'graphite', 'indigo', 'teal', 'amber', 'violet', 'daylight', 'contrast'];
const LIGHT = ['daylight'];

const parse = (text) => [...text.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)]
  .map((m) => ({ selector: m[1].trim().replace(/\s+/g, ' '), body: m[2].replace(/\s+/g, '') }));

// The scheme a theme resolves to: the declarations of every rule whose selector names it, in the order of the file. The default theme
// has no data-theme attribute until a person chooses one, so it is also what `:root:not([data-theme])` matches.
const schemeOf = (rules, id) => {
  const names = (selector) => selector.split(',').map((part) => part.trim()).some((part) => part === `:root[data-theme="${id}"]` || (id === 'midnight' && part === ':root:not([data-theme])'));
  let scheme;
  for (const rule of rules) if (names(rule.selector)) scheme = rule.body.match(/(?:^|;)color-scheme:([^;]+)/)?.[1] ?? scheme;
  return scheme;
};

const sheet = parse(readFileSync(join(root, 'apps/webui-static/styles.css'), 'utf8'));

function generated() {
  const dir = mkdtempSync(join(tmpdir(), 'noesar-themes-'));
  try {
    mkdirSync(join(dir, 'tools'));
    mkdirSync(join(dir, 'apps/webui-static'), { recursive: true });
    cpSync(join(root, 'tools/generate-themes.mjs'), join(dir, 'tools/generate-themes.mjs'));
    for (const file of ['styles.css', 'colour.js']) cpSync(join(root, 'apps/webui-static', file), join(dir, 'apps/webui-static', file));
    execFileSync(process.execPath, [join(dir, 'tools/generate-themes.mjs')], { cwd: dir, encoding: 'utf8' });
    return parse(readFileSync(join(dir, 'apps/webui-static/styles.css'), 'utf8'));
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

for (const [where, rules] of [['styles.css', () => sheet], ['what the generator writes', generated]]) {
  test(`${where}: every theme says which colour scheme it is, so native controls follow the theme and not the operating system`, () => {
    const list = rules();
    for (const id of THEMES) assert.ok(schemeOf(list, id), `${id} declares no color-scheme: its boxes, radios and scrollbars follow the operating system`);
  });

  test(`${where}: the dark themes say dark, and the one light theme says light`, () => {
    const list = rules();
    for (const id of THEMES) assert.equal(schemeOf(list, id), LIGHT.includes(id) ? 'light' : 'dark', `${id} must draw its native controls ${LIGHT.includes(id) ? 'light' : 'dark'}`);
  });
}

test('no theme exists that this file does not know: a tenth theme must be classified here, deliberately', () => {
  const named = new Set(sheet.flatMap((r) => r.selector.split(',')).map((s) => s.trim().match(/^:root\[data-theme="([a-z-]+)"\]$/)?.[1]).filter(Boolean));
  assert.deepEqual([...named].filter((id) => !THEMES.includes(id)), [], 'a theme block with a name this test does not list');
});
