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
    // a percentage here is cyclic (the label is as wide as its field): the field stayed at 174 px; a width taken from the window is not
    const width = /^min\((\d+)rem,calc\(100vw-6rem\)\)$/.exec(declared(field?.body ?? '', 'min-width') ?? '');
    assert.ok(width, 'the minimum width is not min(Nrem, calc(100vw - 6rem))');
    // at the 16 px of a field, 20rem cut "owner/name, or a huggingface.co ad" and "Model, publisher or declared workloa"
    assert.ok(Number(width[1]) >= 26, `${width[1]}rem is not room for the longest placeholder of an inline row`);
  });

  test('a placeholder that does not fit ends in dots, not in the middle of a word', () => {
    const dots = rules.find((r) => r.selector.startsWith('input:not([type=checkbox])') && declared(r.body, 'text-overflow') === 'ellipsis');
    assert.ok(dots, 'no text-overflow:ellipsis for the text fields');
  });

  // not the boxes: a checkbox inside a label of the same row took the same basis and grew to 89 px (seen in the first shot after the fix)
  test('the API key of a provider card has a basis and wraps, instead of sharing 335 px with three neighbours', () => {
    const input = ruleFor((s) => s === '.provider-card .inline-form input:not([type=checkbox]):not([type=radio])');
    // the helper strips whitespace, so `2 1 150px` reads as `21150px`: grow 2, shrink 1, a basis in px
    assert.match(declared(input?.body ?? '', 'flex') ?? '', /^21\d+px$/);
    assert.equal(declared(input?.body ?? '', 'min-width'), '0');
    // and the select beside it has room for "Session only" and its arrow (about 135 px: at 120 the arrow sat on the last letter)
    const select = ruleFor((s) => s === '.provider-card .inline-form select');
    // `1 1 140px` with its whitespace stripped is `11140px`: grow 1, shrink 1, then the basis
    const basis = Number(declared(select?.body ?? '', 'flex')?.match(/^\d\d(\d+)px$/)?.[1]);
    assert.ok(basis >= 135, `the select of a provider card has a basis of ${basis} px`);
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

  test('the main button of a header is at the end of it, and the help mark follows it', () => {
    const button = ruleFor((s) => s === '.section-header>.primary');
    assert.equal(declared(button?.body ?? '', 'margin-inline-start'), 'auto');
    const follow = ruleFor((s) => s === '.section-header>.primary+.help-button');
    assert.equal(declared(follow?.body ?? '', 'margin-inline-start'), '0');
  });

  test('the settings block (menu and page) is centred, and still fills a narrow window', () => {
    const layout = ruleFor((s) => s === '#view-settings .settings-layout');
    assert.equal(declared(layout?.body ?? '', 'margin-inline'), 'auto');
    assert.equal(declared(layout?.body ?? '', 'width'), 'fit-content');
    assert.equal(declared(layout?.body ?? '', 'max-width'), '100%');
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

// Owner, 2026-10-16 (second look, with data in the pages: a lab instance, a made-up model, no graphics card): the caption fix above made every field set
// inside a label type at 12 px — a field takes its size from the label around it (`font:inherit`) — while the fields that are not in a label kept 16 px.
// Knowledge had a search at 16 over a note form at 12; the plan form a goal at 12 over a path and contents at 16.
describe('what a person types is one size in every form', () => {
  const field = ruleFor((s) => s.startsWith('label:not(.chat-more-field)>:is(input,select,textarea)'));

  test('one rule sizes the field of a label, of an inline row, of a search row, of the accent row and of a file of the plan form', () => {
    assert.ok(field, 'no rule that sets the size of a field in look.css');
    for (const parent of ['.inline-form>', '.search-row>', '.accent-row>', '.plan-file-row>']) assert.ok(field.selector.includes(parent), `${parent} is not covered`);
  });

  test('the size is 1rem, set on the field itself, not left to the caption around it', () => {
    assert.equal(declared(field?.body ?? '', 'font-size'), '1rem');
  });

  test('the small menu fields of a chat keep the size they were drawn with', () => {
    assert.match(field?.selector ?? '', /:not\(\.chat-more-field\)/);
    assert.equal(declared(ruleFor((s) => s === '.chat-more-field select,.chat-more-field input')?.body ?? '', 'font-size'), '0.9375rem');
  });
});

describe('a field and its button are on one line: a file of the plan form, the command line of the bench terminal', () => {
  test('the row does not wrap: the button was alone under a full-width field', () => {
    assert.equal(declared(ruleFor((s) => s === '.plan-file-row .inline-form,#terminalCommandForm')?.body ?? '', 'flex-wrap'), 'nowrap');
  });

  test('the field takes what the button leaves, and can shrink to it', () => {
    const path = ruleFor((s) => s === '.plan-file-row .plan-file-path,#terminalCommandInput');
    assert.equal(declared(path?.body ?? '', 'flex'), '110'); // the parser strips spaces: 1 1 0
    assert.equal(declared(path?.body ?? '', 'min-width'), '0');
  });
});

describe('the divergence profile is a card in a row of its own', () => {
  const layouts = rules.filter((r) => /^#view-coden\.active$/.test(r.selector) && declared(r.body, 'grid-template-areas'));

  test('the grid of CodeN names a row for it, above the status bar, in every layout', () => {
    assert.ok(layouts.length >= 2, 'expected the desktop and the narrow layout of CodeN');
    for (const layout of layouts) {
      const areas = declared(layout.body, 'grid-template-areas');
      assert.ok(areas.includes('"divergence'), `no divergence row in ${areas}`);
      assert.ok(areas.indexOf('"divergence') < areas.indexOf('"bar'), `the strip is not above the bar in ${areas}`);
    }
  });

  test('the strip sits in that row — not in the one of the status bar, where it was drawn over it', () => {
    assert.equal(declared(ruleFor((s) => s === '#view-coden #codenDivergence')?.body ?? '', 'grid-area'), 'divergence');
  });

  test('it is a card like the others: a border, a radius, the card background, room inside', () => {
    const body = ruleFor((s) => s === '#view-coden #codenDivergence')?.body ?? '';
    for (const property of ['border', 'border-radius', 'background', 'padding']) assert.ok(declared(body, property), `no ${property}`);
    assert.equal(declared(body, 'background'), 'var(--n-card)');
  });

  test('a signal is its name, its level and its note, in columns; the level has a colour of its own for each answer, and says the word as well', () => {
    assert.equal(declared(ruleFor((s) => s === '.divergence-signal')?.body ?? '', 'display'), 'grid');
    for (const level of ['none', 'medium', 'high']) assert.ok(ruleFor((s) => s === `.divergence-signal.level-${level} .divergence-level`), `no colour for ${level}`);
  });

  test('the three words of a signal are separated by spaces in the text, and an answer that says "unavailable" has no heading repeating it', () => {
    assert.match(app, /row\.append\(id,' ',level,' ',note\)/);
    assert.match(app, /if\(divergence\?\.available\)\{\s*const head/);
  });
});

describe('a run in a list is a card, not three loose spans', () => {
  // workRunRows() draws it for the Work column of a chat and for the runs no chat owns; neither had a rule, so the status word, the goal and the files
  // ran together on one line in the type of the page.
  test('the run is a card with its status, its goal and its files one under the other', () => {
    const body = ruleFor((s) => s === '.work-run')?.body ?? '';
    assert.equal(declared(body, 'display'), 'grid');
    for (const property of ['border', 'border-radius', 'background', 'padding']) assert.ok(declared(body, property), `no ${property}`);
  });

  test('the status is the quiet word and the goal the heavy one, and a long path breaks instead of leaving the card', () => {
    assert.equal(declared(ruleFor((s) => s === '.work-run-status')?.body ?? '', 'color'), 'var(--n-muted)');
    assert.equal(declared(ruleFor((s) => s === '.work-run-goal')?.body ?? '', 'font-weight'), '600');
    assert.equal(declared(ruleFor((s) => s === '.work-run-status,.work-run-goal,.work-run small')?.body ?? '', 'overflow-wrap'), 'anywhere');
  });
});

describe('the crumb of a chat header keeps its selects inside their labels', () => {
  test('a select is never wider than its label: on a phone the project name was printed over the title of the conversation', () => {
    const select = ruleFor((s) => s === '#view-chat .chat-crumb select');
    assert.match(declared(select?.body ?? '', 'max-width') ?? '', /100%/);
  });
});

describe('cards stacked in a page are a line apart', () => {
  // the view and a settings page are blocks, and a panel has no margin of its own: on Automations, Research, Models and Health and logs the boxes touched
  const stack = rules.find((r) => r.selector.startsWith(':is(.view,.settings-sub)>:is(.panel,.two-col,.dashboard-grid)+'));

  test('a card, or a row of two, that follows another card in a view or a settings page has a margin above it', () => {
    assert.ok(stack, 'no rule for stacked cards in a view or a settings page');
    assert.equal(declared(stack.body, 'margin-top'), '16px');
  });

  test('the same 16 px as the gap of the grids it stands beside, so a stack and a grid have one rhythm', () => {
    const grid = sheetRuleFor((s) => s.includes('.two-col') && s.includes('.dashboard-grid'));
    assert.equal(declared(grid?.body ?? '', 'gap'), '16px');
  });
});

describe('on a phone, nothing is printed under the menu button or out of its row', () => {
  test('a settings page scrolled to by its address stops below the menu button', () => {
    const section = ruleFor((s) => s === '.settings-section');
    const margin = /^(\d+(?:\.\d+)?)rem$/.exec(declared(section?.body ?? '', 'scroll-margin-top') ?? '');
    assert.ok(margin, 'no scroll-margin-top in rem for .settings-section');
    // the menu button ends 51 px from the top and a section may start with a card (Skills), not with a heading: 3.5rem (56 px) is the least that clears it
    assert.ok(Number(margin[1]) >= 3.5, `${margin[1]}rem: the first line of the page is under the menu button`);
  });

  test('the title of a session is a block, so that its ellipsis clips: on an inline span it does nothing', () => {
    assert.equal(declared(ruleFor((s) => s === '.session-row .session-title')?.body ?? '', 'display'), 'block');
  });
});

describe('a session row on a phone gives the title the whole width', () => {
  test('two columns, the box and the text; the buttons go on the line under the title', () => {
    assert.equal(declared(ruleFor((s) => s === '.session-row')?.body ?? '', 'grid-template-columns'), 'autominmax(0,1fr)');
    assert.equal(declared(ruleFor((s) => s === '.session-row .session-actions')?.body ?? '', 'grid-column'), '2');
  });
});

describe('a page opens at its top', () => {
  // #mainContent is the element that scrolls (on a phone and on a desktop); nothing reset it when the address changed
  test('activate() puts the scroller back at the top when the page or the settings section changes, and only then', () => {
    assert.ok(app.includes("let lastOpenedAt='';"));
    assert.ok(app.includes('const openedAt=`${target}/${activeSection}`;'));
    assert.ok(app.includes("if(openedAt!==lastOpenedAt){lastOpenedAt=openedAt;const scroller=$('#mainContent');if(scroller)scroller.scrollTop=0;}"));
  });
});
