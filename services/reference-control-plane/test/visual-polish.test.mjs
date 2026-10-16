// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Owner, 2026-10-16: "voglio che la grafica sia impeccabile". 45 shots of the interface, each looked at (not measured), found what no contrast
// number, no overflow check and no 24 px check had: field labels set at 16 px beside captions of 12 px, a key field squeezed to 40 px, an
// icon tile standing alone, a badge broken over two lines, an empty box where a column should be, a system error read as the page's own words.
//
// Held as properties of the sources, one test for each defect; tools/sweep-pages.mjs measures the same things in a real browser, on every address.

import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const dir = join(here, '../../../apps/webui-static');
const strip = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');
const look = strip(readFileSync(join(dir, 'look.css'), 'utf8'));
const sheet = strip(readFileSync(join(dir, 'styles.css'), 'utf8'));
const html = readFileSync(join(dir, 'index.html'), 'utf8');
const app = readFileSync(join(dir, 'app.js'), 'utf8');
const parse = (css) => [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ selector: m[1].trim().replace(/\s+/g, ' '), body: m[2].replace(/\s+/g, '') }));
const rules = parse(look);
const sheetRules = parse(sheet);
const declared = (body, property) => body.match(new RegExp(`(?:^|;)${property}:([^;]+)`))?.[1];
const ruleFor = (test) => rules.find((r) => test(r.selector));
const sheetRuleFor = (test) => sheetRules.find((r) => test(r.selector));

describe('a field label is a caption wherever the markup puts it', () => {
  // the captions live in styles.css, beside .form-stack label (12 px); look.css keeps everything it sets at 14 px or more
  const label = sheetRuleFor((s) => s.startsWith(':is(.inline-form,.accent-row,.panel,details,.entity-card,.search-row)>label'));

  test('one rule covers the inline row, the accent row, a bare label in a card, in a provider card and in a <details>', () => {
    assert.ok(label, 'no rule for labels in .inline-form, .accent-row, .panel and details in styles.css');
  });

  test('it is the 12 px caption of the legacy form-stack, scaled by the text size, stacked over its control', () => {
    assert.equal(declared(label?.body ?? '', 'font-size'), 'calc(var(--text-scale)*12px)');
    assert.equal(declared(label?.body ?? '', 'display'), 'grid');
  });

  test('a label that wraps a box or a radio is not turned into a caption', () => {
    assert.match(label?.selector ?? '', /:not\(\.check\)/);
    assert.match(label?.selector ?? '', /:not\(:has\(>input\[type=checkbox\]\)\)/);
  });

  test('a box or radio label is 13 px: a sentence, not the 16 px of the page', () => {
    const check = sheetRuleFor((s) => /^label\.check,/.test(s));
    assert.equal(declared(check?.body ?? '', 'font-size'), 'calc(var(--text-scale)*13px)');
  });

  test('the controls of a row sit on one line, so the button is level with the fields and not with their captions', () => {
    const row = ruleFor((s) => s.startsWith('.inline-form:has(>label)'));
    assert.equal(declared(row?.body ?? '', 'align-items'), 'end');
  });
});

describe('a text field is wide enough to type in', () => {
  test('a row of search fields wraps, and its fields have a basis: the log filters were 73 px on a desktop, 24 px on a phone', () => {
    const row = ruleFor((s) => s === '.search-row');
    assert.equal(declared(row?.body ?? '', 'flex-wrap'), 'wrap');
    const field = ruleFor((s) => s.startsWith('.search-row>input:not([type=checkbox])'));
    assert.ok(declared(field?.body ?? '', 'flex'), 'no flex basis for the fields of a search row');
    assert.ok(declared(field?.body ?? '', 'min-width'), 'no minimum width for the fields of a search row');
  });

  test('the text fields of an inline row have a width to read their placeholder in', () => {
    const field = ruleFor((s) => s.startsWith('.inline-form>label>input:not([type=checkbox])'));
    assert.match(declared(field?.body ?? '', 'min-width') ?? '', /^min\(\d+rem,100%\)$/);
  });

  // not the boxes: a checkbox inside a label of the same row took the same basis and grew to 89 px (seen in the first shot after the fix)
  test('the API key of a provider card has a basis and wraps, instead of sharing 335 px with three neighbours', () => {
    const input = ruleFor((s) => s === '.provider-card .inline-form input:not([type=checkbox]):not([type=radio])');
    // the helper strips whitespace, so `2 1 150px` reads as `21150px`: grow 2, shrink 1, a basis in px
    assert.match(declared(input?.body ?? '', 'flex') ?? '', /^21\d+px$/);
    assert.equal(declared(input?.body ?? '', 'min-width'), '0');
  });
});

describe('a header does not leave debris', () => {
  test('the info mark of a card title stays beside the title', () => {
    const info = ruleFor((s) => s === '.panel-title>h2+.icon-info');
    assert.equal(declared(info?.body ?? '', 'margin-inline-end'), 'auto');
  });

  test('the icon tile of a header whose title is hidden is not drawn', () => {
    const tile = ruleFor((s) => s === '.section-header:has(>h1.visually-hidden)>.section-icon');
    assert.equal(declared(tile?.body ?? '', 'display'), 'none');
  });

  test('the help button stays at the end of the header, with or without the tile before it', () => {
    const help = ruleFor((s) => s === '.section-header>.help-button');
    assert.equal(declared(help?.body ?? '', 'margin-inline-start'), 'auto');
  });

  test('a badge never breaks over two lines', () => {
    const badge = ruleFor((s) => s === '.badge');
    assert.equal(declared(badge?.body ?? '', 'white-space'), 'nowrap');
  });

  test('a badge or a button of a header keeps to one line', () => {
    const keep = ruleFor((s) => s === '.section-header>.badge,.section-header>button');
    assert.equal(declared(keep?.body ?? '', 'white-space'), 'nowrap');
  });

  test('the Tasks tab has the header of the other tabs of Automations: a hidden title, no eyebrow and no second description', () => {
    const header = html.match(/<section class="view" id="view-tasks">\s*(<div class="section-header">[\s\S]*?<\/div>)/)?.[1] ?? '';
    assert.match(header, /<h1 class="visually-hidden">Tasks<\/h1>/);
    assert.doesNotMatch(header, /eyebrow|page-title/);
  });
});

describe('CodeN does not draw an empty column', () => {
  const closed = ruleFor((s) => s.startsWith('#view-coden.active:not(:has(.bench-agent .agent-panel.active))') && !s.endsWith('.bench-agent'));
  const hidden = ruleFor((s) => s.startsWith('#view-coden.active:not(:has(.bench-agent .agent-panel.active))') && s.endsWith('.bench-agent'));

  test('when no agent panel and no job is showing, the grid has one column', () => {
    assert.equal(declared(closed?.body ?? '', 'grid-template-columns'), 'minmax(0,1fr)');
    assert.match(closed?.selector ?? '', /\.coden-work:not\(\.hidden\)/);
  });

  test('and the column itself is not drawn', () => {
    assert.equal(declared(hidden?.body ?? '', 'display'), 'none');
  });
});

describe('the unit of a number sits beside it', () => {
  test('the model size field wraps its input and its unit together', () => {
    assert.match(html, /<label>Model size<span class="with-unit"><input id="modelSize"[^>]*><span translate="no">B<\/span><\/span><\/label>/);
    const unit = ruleFor((s) => s === '.with-unit');
    assert.equal(declared(unit?.body ?? '', 'display'), 'flex');
  });
});

describe('a model folder that does not exist yet is not a fault', () => {
  // lifted out of app.js and run against a stand-in for the page, as toast-shapes.test.mjs does
  function lift(name) {
    const at = app.indexOf(`function ${name}(`);
    assert.ok(at >= 0, `function ${name} not found in app.js`);
    const start = app.slice(Math.max(0, at - 6), at) === 'async ' ? at - 6 : at;
    let parens = 0;
    let i = app.indexOf('(', at);
    for (; i < app.length; i += 1) { if (app[i] === '(') parens += 1; else if (app[i] === ')') { parens -= 1; if (parens === 0) break; } }
    let depth = 0;
    for (let j = app.indexOf('{', i); j < app.length; j += 1) {
      if (app[j] === '{') depth += 1;
      else if (app[j] === '}') { depth -= 1; if (depth === 0) return app.slice(start, j + 1); }
    }
    throw new Error(`function ${name} does not close`);
  }

  async function shown(answer) {
    const list = { className: '', textContent: '', replaceChildren() { this.textContent = ''; } };
    // eslint-disable-next-line no-new-func -- the shipped function is the thing under test; nothing else is built this way
    const run = new Function('$', 'api', 't', 'reportError', 'withBusy', 'document', `${lift('loadInstallableModels')}\nreturn loadInstallableModels;`)(
      () => list, async () => answer, (text) => text, () => {}, () => {}, { createElement: () => ({ append() {}, setAttribute() {} }) });
    await run();
    return list.textContent;
  }

  test('ENOENT, which is what a new installation answers, reads as "no files here"', async () => {
    const text = await shown({ files: [], directory: '/workspace/models', reason: "ENOENT: no such file or directory, scandir '/workspace/models'" });
    assert.equal(text, 'No model files are present in /workspace/models');
  });

  test('any other reason is still told, because it is a fault', async () => {
    const text = await shown({ files: [], directory: '/workspace/models', reason: 'EACCES: permission denied' });
    assert.equal(text, 'No model files could be read from /workspace/models: EACCES: permission denied');
  });
});
