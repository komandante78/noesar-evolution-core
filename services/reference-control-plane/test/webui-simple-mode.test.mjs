// SPDX-License-Identifier: AGPL-3.0-or-later
//
// One interface for everyone — 2026-10-11 (before it, the simple interface of 2026-10-06).
//
// Measured on a clean installation on 2026-10-06, a first visit met twelve destinations, about twenty
// controls in the chat, a mode to pick by hand, and a chat that took no word until a conversation
// had been created and titled. The simple interface removed all of that — beside a full interface
// that kept it, and the Owner called the pair the wrong answer on 2026-10-09: «una grafica sola», for
// normal and professional users alike. Since 2026-10-11 there is one interface, built as the drawings
// in PROGETTO_GRAFICA_UNICA_20261009/NUOVA_GRAFICA; the simple interface's way of speaking is
// everyone's, and the level (Base / Advanced) only adds details.
//
// Two kinds of test, because the module is two kinds of thing. The pure functions are driven
// directly. The markup and the stylesheets are read as text, because what has to stay true there is
// a property of the rules, not of a rendering: nothing that asks for a decision is hidden while it
// waits, the level never removes a place, and nothing uses an inline style the page's CSP would refuse.
//
// What this file cannot see is the page drawing itself. That is the browser suite's, and it is
// driven there by a real browser (tools/browser-e2e.mjs, "one interface").
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  LEVEL_KEY, readLevel, writeLevel, inferChatMode, titleFromMessage, setupTokenFromHash,
  TOOL_ACTIONS, toolActionTitle, READ_ACTIVITY, toolActivityTitle, describeChange, argumentLines, approvalStrip, friendlyModelName, zoneOffer,
  SCHEME_KEY, readScheme, writeScheme, themeForScheme, friendlyWhen, describeComputer,
} from '../../../apps/webui-static/simple-mode.js';
import { RUNTIME_ONLY, CATALOGS } from '../../../apps/webui-static/i18n-catalog.js';
import { PAGE_HELP, SIMPLE_HELP } from '../../../apps/webui-static/page-help.js';

const here = dirname(fileURLToPath(import.meta.url));
const STATIC = join(here, '../../../apps/webui-static');
const read = (name) => readFileSync(join(STATIC, name), 'utf8');
const html = read('index.html');
const css = read('styles.css');
const app = read('app.js');
const look = read('look.css');

describe('the level', () => {
  test('Base is the default: nothing stored, an unreadable store, or no store at all', () => {
    assert.equal(readLevel({ getItem: () => null }), 'base');
    assert.equal(readLevel({ getItem: () => { throw new Error('storage refused'); } }), 'base');
    assert.equal(readLevel(undefined), 'base');
  });

  test('only an explicit "advanced" is Advanced', () => {
    assert.equal(readLevel({ getItem: (key) => (key === LEVEL_KEY ? 'advanced' : null) }), 'advanced');
    assert.equal(readLevel({ getItem: () => 'full' }), 'base', 'a value this code did not write is not a choice');
  });

  test('writing records the choice, and a store that refuses does not throw', () => {
    const seen = [];
    writeLevel({ setItem: (key, value) => seen.push([key, value]) }, 'advanced');
    writeLevel({ setItem: (key, value) => seen.push([key, value]) }, 'anything');
    assert.deepEqual(seen, [[LEVEL_KEY, 'advanced'], [LEVEL_KEY, 'base']]);
    assert.doesNotThrow(() => writeLevel({ setItem: () => { throw new Error('private window'); } }, 'advanced'));
  });

  test('the old preference is gone, not kept beside the new one: one interface, no switch', () => {
    assert.doesNotMatch(app, /readSimple|writeSimple|simpleOn|noesar\.ui\.simple/);
    assert.doesNotMatch(html, /data-ui=|simple-only|advanced-only|simpleToFull|fullToSimple/);
    assert.doesNotMatch(css, /data-ui=simple/);
  });
});

describe('the mode a message implies', () => {
  const table = [
    // acting on things
    ['Unisci questi tre PDF in uno solo', 'ACT'],
    ['Puoi unire questi PDF?', 'ACT'],
    ['Riordina la cartella Download', 'ACT'],
    ['Converti il file in PDF', 'ACT'],
    ['Delete the old backups', 'ACT'],
    ['Install ffmpeg', 'ACT'],
    // making something
    ['Scrivi una email al commercialista', 'CREATE'],
    ['Prepara una scheda su questo argomento', 'CREATE'],
    ['Write a short summary of this contract', 'CREATE'],
    ['Draft a reply to this message', 'CREATE'],
    // a verb for making wins over a verb for acting in the same sentence: the thing being asked
    // for is the text, the delete is only what the text is about
    ['Write a script to delete the cache', 'CREATE'],
    // everything else is a conversation
    ['Riassumi questo documento', 'ASK'],
    ['Summarize this document', 'ASK'],
    ['Is the file merged?', 'ASK'],
    // information questions are answered, never acted on, even with an action verb inside
    ['Come posso unire due PDF?', 'ASK'],
    ['Come converti un file in PDF?', 'ASK'],
    ['How do I merge two PDFs?', 'ASK'],
    ['What does convert do?', 'ASK'],
    ['Cosa significa elimina?', 'ASK'],
    ['Perché non si apre il file?', 'ASK'],
    // a command, an empty box, nothing at all
    ['/help', 'ASK'],
    ['   ', 'ASK'],
    ['', 'ASK'],
    [undefined, 'ASK'],
  ];
  for (const [text, expected] of table) {
    test(`${JSON.stringify(text)} is ${expected}`, () => assert.equal(inferChatMode(text), expected));
  }

  test('every mode it can return is one the server knows', () => {
    const known = new Set(['ASK', 'CREATE', 'ACT']);
    for (const [text] of table) assert.ok(known.has(inferChatMode(text)));
  });
});

describe('the title a first message earns', () => {
  test('a short first line is kept as it is', () => {
    assert.equal(titleFromMessage('Unisci questi tre PDF'), 'Unisci questi tre PDF');
  });

  test('only the first non-empty line counts, and its spaces are flattened', () => {
    assert.equal(titleFromMessage('\n   prima   riga \nseconda riga'), 'prima riga');
  });

  test('a long line is cut at a word and says so', () => {
    const title = titleFromMessage('Prepara una scheda molto lunga su come si organizza una cartella piena di fatture del 2025');
    assert.ok(title.endsWith('…'));
    assert.ok(title.length <= 49);
    assert.ok(!title.slice(0, -1).endsWith(' '));
    assert.ok(!/\s\S{0,2}…$/.test(title) || title.length > 30, 'it did not cut in the middle of a word');
  });

  test('a first line that only opens a sentence takes the line that finishes it', () => {
    assert.equal(titleFromMessage('Riassumi questo testo:\n\nLa riunione di condominio si terrà giovedì 14 novembre'), 'Riassumi questo testo: La riunione di…');
    assert.equal(titleFromMessage('Riassumi questo testo:'), 'Riassumi questo testo:', 'nothing after it: as it stands');
    assert.equal(titleFromMessage('Fai questo:\nprimo\nsecondo'), 'Fai questo: primo', 'only the next line');
    assert.equal(titleFromMessage('Una frase normale.\ne poi altro'), 'Una frase normale.', 'a first line that does not end in a colon is alone');
  });

  test('a line with no space is cut at the limit', () => {
    assert.equal(titleFromMessage('x'.repeat(100)), `${'x'.repeat(48)}…`);
  });

  test('nothing to name falls back to a title the server accepts', () => {
    assert.equal(titleFromMessage(''), 'New conversation');
    assert.equal(titleFromMessage(null), 'New conversation');
    assert.equal(titleFromMessage('  \n  '), 'New conversation');
  });
});

describe('a setup token carried in a link', () => {
  test('a token-shaped fragment is taken', () => {
    assert.equal(setupTokenFromHash('#setup=kCxtsFBbBAPK6OL5nfSRMRgI7XPSRxCr-g3xTJ1h6Ao'), 'kCxtsFBbBAPK6OL5nfSRMRgI7XPSRxCr-g3xTJ1h6Ao');
  });

  test('anything else is ignored, so a link cannot make the page type something odd into a field', () => {
    for (const hash of ['#/chat', '', undefined, '#setup=short', '#setup=', '#setup=abc def ghi jkl mno pqr', '#setup=<script>alert(1)</script>', '#setup=aaaaaaaaaaaaaaaa&x=1', `#setup=${'a'.repeat(129)}`]) {
      assert.equal(setupTokenFromHash(hash), '', JSON.stringify(hash));
    }
  });
});

describe('the markup and the stylesheets', () => {
  test('the page opens on the level, and the chat opens empty', () => {
    assert.match(html, /<body data-level="base">/);
    assert.match(html, /<section class="view" id="view-chat" data-empty>/);
    assert.match(html, /href="\/styles\.css">\s*<link rel="stylesheet" href="\/look\.css">/, 'look.css after styles.css, so it wins at equal weight');
  });

  test('the first screen sits in the chat panel, before the message list: a greeting and four sentences to start from', () => {
    const welcome = html.indexOf('id="simpleWelcome"');
    const list = html.indexOf('id="messageList"');
    const panel = html.indexOf('<section class="chat-panel">');
    assert.ok(panel > 0 && panel < welcome && welcome < list);
    assert.match(html.slice(welcome, list), /id="chatGreeting"/);
    assert.equal((html.slice(welcome, list).match(/data-simple-prompt/g) ?? []).length, 3);
    assert.match(html.slice(welcome, list), /data-view-link="coden"/, 'the fourth leads to CodeN Evolution (decision A, 2026-10-11)');
  });

  test('the no-model notice sits above the composer, not inside the welcome, so it outlives the first conversation', () => {
    const notice = html.indexOf('id="simpleNoModel"');
    const welcomeEnd = html.indexOf('id="messageList"');
    const composer = html.indexOf('<div class="composer chat-composer">');
    assert.ok(notice > welcomeEnd && notice < composer);
    assert.match(app, /classList\.toggle\('hidden',answers\)/);
  });

  test('"no model" means no running model AND no enabled provider — a provider the person connected answers through the route', () => {
    assert.match(app, /const enabled=!loaded\?\(await api\('\/api\/v1\/providers'\)\)\.providers\.filter\(\(item\)=>item\.enabled\)/);
    assert.match(app, /const answers=Boolean\(loaded\)\|\|enabled\.length>0/);
  });

  test('the box names the model that answers, not "none", when a connected provider is the one answering', () => {
    assert.match(app, /loaded\?shortModelName\(loaded\):enabled\[0\]\?\.defaultModel\?shortModelName\(enabled\[0\]\.defaultModel\):t\('No AI yet'\)/);
    assert.match(app, /label\.textContent=shortModelName\(model\)/, 'and the wizard sets it at once, without waiting for the next refresh');
  });

  test('the notice that no model is connected starts hidden, and leads to where one is connected', () => {
    const notice = html.match(/<div class="notice hidden" id="simpleNoModel"[^>]*>[\s\S]*?<\/div>/)?.[0];
    assert.ok(notice, 'the notice exists and is hidden until the page knows there is no model');
    assert.match(notice, /data-view-link="providers"/);
  });

  test('the menu: New chat, Search, Library, Automations, CodeN Evolution, your projects, Recent, and you', () => {
    const nav = html.slice(html.indexOf('<nav aria-label="Primary">'), html.indexOf('</nav>', html.indexOf('<nav aria-label="Primary">')));
    const order = ['id="newChat"', 'id="openSearch"', 'data-view-link="knowledge"', 'data-view-link="agents"', 'data-view="coden"', 'id="menuProjects"', 'id="chatNav"'];
    const at = order.map((needle) => nav.indexOf(needle));
    assert.ok(at.every((index) => index >= 0), `missing from the menu: ${order.filter((_, i) => at[i] < 0).join(', ')}`);
    assert.deepEqual([...at].sort((a, b) => a - b), at, 'in the drawing\'s order');
    const foot = html.slice(html.indexOf('<div class="sidebar-foot">'), html.indexOf('</aside>'));
    for (const needle of ['id="meButton"', 'id="userAvatar"', 'data-view="settings"', 'id="logoutButton"']) assert.ok(foot.includes(needle), needle);
    assert.ok(!nav.includes('id="openSearch" data-view'), 'Search opens a box; it is not a page');
  });

  test('no markup of the one interface carries an inline style (the page forbids them)', () => {
    for (const id of ['simpleWelcome', 'newChat', 'openSearch', 'searchDialog', 'chatWeb', 'chatAttach', 'footerPrivacy', 'approvalStrip', 'levelChoices']) {
      const at = html.indexOf(`id="${id}"`);
      assert.ok(at > 0, id);
      const tag = html.slice(html.lastIndexOf('<', at), html.indexOf('>', at));
      assert.ok(!/\sstyle=/.test(tag), id);
    }
  });

  test('SAFETY: the level never hides a place, and nothing hides what waits for a decision', () => {
    // .level-advanced is the only thing the level switches, and it is never on a destination, the box, or the strip
    for (const match of html.matchAll(/<[^>]*class="[^"]*\blevel-advanced\b[^"]*"[^>]*>/g)) {
      assert.ok(!/data-view=|id="(chatInput|sendMessage|approvalStrip|approvalStripOpen)"/.test(match[0]), `the level hides a place: ${match[0]}`);
    }
    for (const block of [look, css]) {
      for (const rule of block.matchAll(/([^{}]+)\{([^{}]*display:none[^{}]*)\}/g)) {
        assert.ok(!/approval/i.test(rule[1]) || /\.hidden/.test(rule[1]), `a rule hides something about approvals: ${rule[1].trim()}`);
      }
    }
    assert.ok(html.includes('id="approvalStripOpen"'), 'and the strip is in the page to begin with');
  });

  test('the chat keeps the project and the chat as a breadcrumb, and everything else about it behind "⋯"', () => {
    const head = html.slice(html.indexOf('<div class="chat-head"'), html.indexOf('<div class="chat-grid">'));
    for (const id of ['chatProject', 'chatConversation', 'chatMore']) assert.ok(head.includes(`id="${id}"`), id);
    const more = head.slice(head.indexOf('id="chatMoreMenu"'));
    for (const id of ['newConversation', 'clearConversation', 'undoHead', 'chatBranch', 'forkBranch', 'compareBranches', 'mergeBranch', 'chatProvider', 'chatModel', 'compareModels']) {
      assert.ok(more.includes(`id="${id}"`), `"${id}" is behind ⋯`);
    }
    assert.doesNotMatch(html, /id="chatModes"/, 'no mode to pick by hand: the message implies it (inferChatMode)');
  });
});

describe('what a waiting tool is about to do, in plain words', () => {
  test('the tools that change files have a plain phrase, and nothing else does (no guessing)', () => {
    assert.equal(toolActionTitle('engine_workspace_approve'), 'Apply the change to your files');
    assert.equal(toolActionTitle('engine_workspace_restore'), 'Put your files back as they were');
    for (const name of ['engine_closure_record', 'something_else', '', undefined, 'constructor', '__proto__', 'toString', 'hasOwnProperty']) {
      assert.equal(toolActionTitle(name), null, String(name));
    }
    assert.ok(Object.keys(TOOL_ACTIONS).every((name) => name.startsWith('engine_workspace_')));
  });

  test('the tools that only look have a plain phrase for the running-tool row, declared and translated in every language', () => {
    assert.equal(toolActivityTitle('engine_files_list'), 'Look at your files');
    assert.equal(toolActivityTitle('engine_files_read'), 'Read a file');
    assert.equal(toolActivityTitle('engine_workspace_approve'), 'Apply the change to your files', 'the change tools keep theirs');
    for (const name of ['engine_status', 'something_else', undefined, 'constructor', '__proto__']) assert.equal(toolActivityTitle(name), null, String(name));
    for (const phrase of Object.values(READ_ACTIVITY)) {
      assert.ok(RUNTIME_ONLY.includes(phrase), `not declared runtime-only: ${phrase}`);
      for (const code of Object.keys(CATALOGS).filter((language) => language !== 'en')) {
        assert.ok(typeof CATALOGS[code][phrase] === 'string' && CATALOGS[code][phrase] !== phrase, `${code}: not translated: ${phrase}`);
      }
    }
    assert.match(app, /const plain=toolActivityTitle\(data\.name\);/, 'said in plain words, for everyone');
  });

  const entry = (over = {}) => ({ path: 'a.md', status: 'MODIFIED', before: 'one\ntwo\n', after: 'one\nthree\n', diffAvailable: true, ...over });

  test('a measured run becomes files with a kind, the text on each side, and line counts', () => {
    const out = describeChange({
      request: 'add a changelog', status: 'MEASURED',
      diff: [entry(), entry({ path: 'new.md', status: 'CREATED', before: null, after: 'x\n' }), entry({ path: 'gone.md', status: 'DELETED', before: 'bye', after: null }), entry({ path: 'odd.md', status: 'WEIRD' })],
    });
    assert.equal(out.request, 'add a changelog');
    assert.equal(out.status, 'MEASURED');
    assert.deepEqual(out.files.map((f) => [f.path, f.kind]), [['a.md', 'changed'], ['new.md', 'new'], ['gone.md', 'removed'], ['odd.md', 'unknown']]);
    assert.deepEqual([out.files[0].beforeLines, out.files[0].afterLines], [2, 2]);
    assert.deepEqual([out.files[1].before, out.files[1].after, out.files[1].afterLines], [null, 'x\n', 1]);
  });

  test('a side that could not be read is null, never an empty string; an empty file is an empty string', () => {
    const [unread, empty] = describeChange({ diff: [entry({ before: null, after: null, diffAvailable: false }), entry({ before: '', after: 'x' })] }).files;
    assert.deepEqual([unread.before, unread.after, unread.beforeLines], [null, null, null]);
    assert.deepEqual([empty.before, empty.beforeLines], ['', 0]);
  });

  test('long text is cut, and the card is told it was', () => {
    const [file] = describeChange({ diff: [entry({ after: 'y'.repeat(5000) })] }).files;
    assert.equal(file.after.length, 2000);
    assert.equal(file.cut, true);
    assert.equal(describeChange({ diff: [entry()] }).files[0].cut, false);
  });

  test('no run, no diff, a diff that is not a list, and entries without a path are all an empty card, not an error', () => {
    for (const run of [null, undefined, {}, { diff: null }, { diff: 'x' }, { diff: [null, {}, { status: 'CREATED' }] }]) {
      assert.deepEqual(describeChange(run).files, [], JSON.stringify(run));
    }
    assert.equal(describeChange({ request: 'q'.repeat(900) }).request.length, 500);
    assert.equal(describeChange({ request: 5 }).request, null);
  });

  test('the arguments of a tool with no phrase are shown as short lines, capped in number and width', () => {
    assert.deepEqual(argumentLines({ name: 'x', list: ['a', 'b'], deep: { k: 1 } }), ['name: x', 'list: a, b', 'deep: {"k":1}']);
    assert.equal(argumentLines({ long: 'z'.repeat(300) })[0].length, 'long: '.length + 120 + 1);
    assert.equal(argumentLines(Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`k${i}`, i]))).length, 6);
    for (const bad of [null, undefined, 'text', 5, ['a']]) assert.deepEqual(argumentLines(bad), []);
  });

  // exactly the two functions that build the card: from describeApproval up to the function after them
  const cardStart = app.indexOf('async function describeApproval(');
  const cardCode = app.slice(cardStart, app.indexOf('function resolveToolActivity('));

  test('the card is built for everyone, and everything on it goes in as text', () => {
    assert.match(app, /\n  void describeApproval\(row,data\);/);
    assert.ok(cardStart > 0 && cardCode.includes('function appendChangedFiles('), 'both functions are in the slice');
    assert.ok(!/innerHTML|insertAdjacentHTML|outerHTML/.test(cardCode), 'a model\'s arguments are not this page\'s markup to trust');
    assert.match(cardCode, /textContent/);
  });

  test('the run is read from the engine\'s own route, and the buttons still work when it cannot be read', () => {
    assert.match(cardCode, /api\(`\/api\/v1\/workspace-actions\/\$\{encodeURIComponent\(runId\)\}`\)\.catch\(\(\)=>null\)/);
    assert.match(cardCode, /if\(!card\.childElementCount\)return;/);
  });

  test('every phrase the card says is in RUNTIME_ONLY and translated', () => {
    const code = cardCode;
    const said = new Set([...code.matchAll(/\bt\('([^']+)'\)/g)].map((m) => m[1]));
    for (const phrase of Object.values(TOOL_ACTIONS)) said.add(phrase);
    // said through a variable or a ternary, which the pattern above cannot see
    for (const word of ['new file', 'changed', 'removed', 'Before', 'After', 'These files will change:', 'These files will go back to how they were:']) said.add(word);
    assert.ok(said.size >= 20, `${said.size} phrases found`);
    for (const phrase of said) {
      assert.ok(RUNTIME_ONLY.includes(phrase), `not declared runtime-only: ${phrase}`);
      assert.ok(typeof CATALOGS.it[phrase] === 'string' && CATALOGS.it[phrase] !== phrase, `not translated: ${phrase}`);
    }
  });

  test('one row per tool: the "running" row is set aside and the card gets the outcome', () => {
    assert.match(app, /approvalRow=renderToolApproval\(article,data\);/);
    assert.match(app, /if\(approvalRow&&toolRow\)toolRow\.classList\.add\('superseded'\)/);
    assert.match(app, /if\(approvalRow\)\{approvalRow\.classList\.remove\('awaiting'\);resolveToolActivity\(approvalRow,data\);approvalRow=null;\}/);
    assert.match(css, /\.tool-activity-row\.superseded\{display:none\}/, 'by a class with a rule of its own: the hidden attribute loses to display:flex');
  });

  test('the stylesheet gives the card a line of its own, and puts the two buttons after it', () => {
    assert.match(css, /\.tool-activity-row\.has-change\{flex-wrap:wrap\}/);
    assert.match(css, /\.tool-activity-row\.has-change>\.tool-change\{order:5;flex-basis:100%/);
    assert.match(css, /\.tool-activity-row\.has-change>button\{order:6\}/);
    assert.match(css, /\.tool-activity-row\.has-change \.tool-activity-name\{font-family:inherit/, 'the plain title is not set in the technical typeface');
  });
});

// The strip at the bottom of the page is where a person is told that something waits. It read the
// queue behind /api/v1/approvals only, and a tool waiting in the CHAT is held by the running turn,
// so it said "Nothing is waiting for a decision" with a card on screen asking for one.
// 2026-10-11: the strip is a banner at the top of the page, shown while something waits (or the queue cannot be read).
describe('the strip counts what waits in the chat', () => {
  test('nothing waiting: zero, no detail (the caller owns the sentence), nowhere to send the person', () => {
    assert.deepEqual(approvalStrip(), { total: 0, detail: '', inChatOnly: false });
    assert.deepEqual(approvalStrip({ queueTotal: 0, queueTitles: [], chatTitles: [] }), { total: 0, detail: '', inChatOnly: false });
  });

  test('only the queue: as it always was', () => {
    assert.deepEqual(approvalStrip({ queueTotal: 2, queueTitles: ['A', 'B'] }), { total: 2, detail: 'A · B', inChatOnly: false });
    assert.equal(approvalStrip({ queueTotal: 5, queueTitles: ['A', 'B'] }).detail, 'A · B and 3 more');
  });

  test('only the chat: one waiting tool is one decision, and the strip points at the chat, not an empty queue', () => {
    assert.deepEqual(approvalStrip({ chatTitles: ['Apply the change to your files'] }), { total: 1, detail: 'In this chat: Apply the change to your files', inChatOnly: true });
    assert.equal(approvalStrip({ chatTitles: ['x'], chatLabel: 'In questa chat:' }).detail, 'In questa chat: x');
  });

  test('both: the chat goes first, the count is the sum, and the queue still gets its own button', () => {
    const both = approvalStrip({ queueTotal: 2, queueTitles: ['A', 'B'], chatTitles: ['X'] });
    assert.deepEqual(both, { total: 3, detail: 'In this chat: X · A and 1 more', inChatOnly: false });
  });

  test('two waiting in the chat and none in the queue still point at the chat', () => {
    const view = approvalStrip({ chatTitles: ['X', 'Y', 'Z'] });
    assert.equal(view.total, 3);
    assert.equal(view.inChatOnly, true);
    assert.equal(view.detail, 'In this chat: X · In this chat: Y and 1 more');
  });

  const registerCode = app.slice(app.indexOf('function renderToolApproval('), app.indexOf('async function describeApproval('));
  const refreshCode = app.slice(app.indexOf('async function refreshApprovals('), app.indexOf('function bindApprovalActions('));

  test('a card registers its wait when it is drawn and forgets it the moment it is decided', () => {
    assert.match(registerCode, /chatWaiting\.set\(row,/);
    assert.match(registerCode, /paintApprovalStrip\(\);/);
    const decide = registerCode.slice(registerCode.indexOf('const decide='), registerCode.indexOf('const yes='));
    assert.match(decide, /forgetChatWait\(row\);/, 'a decided card is not waiting any more');
    // …and BEFORE the request goes out, so the strip does not say "waiting" about a decision already taken
    assert.ok(decide.indexOf('forgetChatWait(row)') < decide.indexOf('api('), 'forgotten before the call, not after it');
  });

  test('a turn that ends, by result or by any other way, leaves nothing waiting', () => {
    const result = app.slice(app.indexOf("}else if(event==='tool-result'){"), app.indexOf("}else if(event==='error'){"));
    assert.match(result, /forgetChatWait\(approvalRow\);/);
    // approvalRow is set to null by the simple branch: forgotten first, or the row would stay counted
    assert.ok(result.indexOf('forgetChatWait(approvalRow)') < result.indexOf('approvalRow=null'), 'forgotten before the variable is cleared');
    const finallyBlock = app.slice(app.indexOf('}finally{\n    // A turn that ends'), app.indexOf("$('#sendMessage').addEventListener('click'"));
    assert.match(finallyBlock, /forgetChatWait\(approvalRow\);/);
  });

  test('the strip is painted from one place, from both sources, and a failed read still says so', () => {
    assert.match(refreshCode, /lastQueue=\{total,items,failed:false\};\s*paintApprovalStrip\(\);/);
    assert.match(refreshCode, /lastQueue=\{\.\.\.lastQueue,failed:true\};/);
    assert.match(refreshCode, /The approvals waiting for you could not be read\./, 'an unreadable queue is not shown as "nothing waiting"');
    assert.match(refreshCode, /\$\('#approvalStrip'\)\?\.classList\.remove\('hidden'\);/, 'and it is shown, not left hidden');
    const paint = app.slice(app.indexOf('function paintApprovalStrip('), app.indexOf("$('#approvalStripOpen')?.addEventListener"));
    assert.match(paint, /if\(lastQueue\.failed\)return;/, 'the failure message is not painted over by a chat card');
    assert.match(paint, /approvalStrip\(\{queueTotal:lastQueue\.total,queueTitles:/);
    assert.match(paint, /chatTitles:\[\.\.\.chatWaiting\.values\(\)\]/);
  });

  test('the queue\'s own list and nav badge stay the queue\'s alone: they lead to the queue and its buttons', () => {
    assert.ok(!refreshCode.includes('chatWaiting'), 'a chat wait is not a queue item and has no queue button');
  });

  test('a card that has left the page is not counted: nobody can decide it', () => {
    const paint = app.slice(app.indexOf('function paintApprovalStrip('), app.indexOf("$('#approvalStripOpen')?.addEventListener"));
    assert.match(paint, /if\(!row\.isConnected\)chatWaiting\.delete\(row\)/);
  });

  test('with only the chat waiting the button says so and goes to the chat; otherwise it is the queue\'s', () => {
    assert.match(app, /open\.dataset\.viewLink=view\.inChatOnly\?'chat':'settings\/audit'/);
    assert.match(app, /open\.textContent=t\(view\.inChatOnly\?'Show in chat':'Open queue'\)/);
    assert.match(html, /id="approvalStripOpen" type="button" data-view-link="settings\/audit">Open queue</, 'the queue stays its default');
  });

  test('the two new phrases are declared runtime-only and translated', () => {
    for (const phrase of ['In this chat:', 'Show in chat']) {
      assert.ok(RUNTIME_ONLY.includes(phrase), `not declared runtime-only: ${phrase}`);
      assert.ok(typeof CATALOGS.it[phrase] === 'string' && CATALOGS.it[phrase] !== phrase, `not translated: ${phrase}`);
    }
  });

  test('the strip speaks only while something waits: nothing waiting, nothing said (rule 5 of the one interface)', () => {
    const paint = app.slice(app.indexOf('function paintApprovalStrip('), app.indexOf("$('#approvalStripOpen')?.addEventListener"));
    assert.match(paint, /\$\('#approvalStrip'\)\?\.classList\.toggle\('hidden',view\.total===0\);/);
    assert.ok(paint.indexOf('if(lastQueue.failed)return;') < paint.indexOf("classList.toggle('hidden'"), 'a failed read is never hidden by a count of zero');
    assert.ok(html.includes('id="approvalStripOpen"'));
  });
});

// A stranger who installs from the sources meets root/noesar, not a setup token: oci/Dockerfile, the
// file deployment/docker/build.sh builds, does not set NOESAR_SETUP_TOKEN_FILE, and with no token the
// server seeds that account. The first thing on the screen after signing in is then this banner, which
// was in English only, sent the person to "Settings" (the Sessions list, sixteen sections from the
// password), and stayed up after the password had been changed, until the next reload.
// The first screen made four suggestions that the product could not keep: "merge PDF files" and "tidy up a
// folder" have no tool behind them (the 36 built-in tools plan, measure and apply changes to a repository
// workspace, read status, search and judge documents; none merges, converts or reorders a person's files),
// "research a topic" needs a search instance the operator has to run, and the first of them was read as an
// acting request the moment it was clicked. What a person sees on the first screen has to be something a
// connected model does today with nothing else installed; the file-work suggestions come back with the tools.
describe('the first screen', () => {
  const start = html.slice(html.indexOf('id="simpleWelcome"'), html.indexOf('id="messageList"'));
  const cards = [...start.matchAll(/<button type="button" data-simple-prompt( data-prompt-web)? data-prompt-text="([^"]*)">[\s\S]*?<span>([^<]+)<\/span><\/button>/g)]
    .map((m) => ({ web: Boolean(m[1]), prompt: m[2], title: m[3] }));

  test('the drawing\'s four: summarize a document, write a letter, search the internet, work on code — all translated', () => {
    assert.deepEqual(cards.map((card) => card.title), ['Summarize a document', 'Write a letter', 'Search the internet']);
    assert.match(start, /data-view-link="coden"[\s\S]*?<span>Work on code<\/span>/);
    for (const text of [...cards.map((card) => card.title), 'Work on code', 'What shall we do?']) {
      assert.ok(typeof CATALOGS.it[text] === 'string' && CATALOGS.it[text] !== text, `not translated: ${text}`);
    }
  });

  test('what a sentence writes into the box is declared runtime-only and translated, ends where the person goes on, and never reads as an action', () => {
    for (const card of cards) {
      assert.ok(RUNTIME_ONLY.includes(card.prompt), `not declared runtime-only: ${card.prompt}`);
      assert.ok(typeof CATALOGS.it[card.prompt] === 'string' && CATALOGS.it[card.prompt] !== card.prompt, `not translated: ${card.prompt}`);
      assert.ok(card.prompt.endsWith(':'), `ends where the person goes on: ${card.prompt}`);
      assert.notEqual(inferChatMode(card.prompt), 'ACT', card.prompt);
      assert.notEqual(inferChatMode(CATALOGS.it[card.prompt]), 'ACT', CATALOGS.it[card.prompt]);
    }
  });

  test('"Search the internet" also switches the web search on, and the greeting is painted with the person\'s name', () => {
    assert.deepEqual(cards.map((card) => card.web), [false, false, true]);
    assert.match(app, /if\(chip\.hasAttribute\('data-prompt-web'\)\)setWeb\(true\);/);
    const greet = app.slice(app.indexOf('function paintGreeting('), app.indexOf('function paintGreeting(') + 600);
    assert.match(greet, /currentUser\?\.displayName/);
    assert.match(greet, /slot\.setAttribute\('translate','no'\)/, 'composed from t() parts, so the translator leaves it alone');
    for (const phrase of ['Good morning', 'Good afternoon', 'Good evening']) assert.ok(RUNTIME_ONLY.includes(phrase) && CATALOGS.it[phrase], phrase);
  });
});

describe('the default-password banner, for a person who has just signed in with the installer\'s account', () => {
  const start = app.indexOf("let banner=$('#defaultPasswordBanner');");
  const bannerCode = app.slice(start, app.indexOf('}else if(banner){banner.remove();}', start));
  const changeCode = app.slice(app.indexOf("$('#securityPasswordForm').addEventListener('submit'"), app.indexOf('function renderMfaEnrolment('));
  // the words are written by one function, so that the same words can be written again when the language changes
  const paintCode = app.slice(app.indexOf('function paintDefaultPasswordBanner()'), app.indexOf('function repaintForLanguage()'));

  test('the banner code is found, and it builds its text and link with the DOM, not with markup', () => {
    assert.ok(start > 0 && bannerCode.includes("banner.id='defaultPasswordBanner'"));
    assert.ok(!/innerHTML/.test(bannerCode));
  });

  test('it says it in the person\'s language and links straight to the form that changes the password', () => {
    assert.ok(paintCode.length > 0 && paintCode.length < 600, 'the function that writes the two phrases is found');
    assert.match(paintCode, /t\('This account is still using the default password\.'\)/);
    assert.match(paintCode, /querySelector\('a'\)\.textContent=t\('Change it now'\)/);
    assert.match(bannerCode, /paintDefaultPasswordBanner\(\)/, 'written when the banner is made');
    assert.match(bannerCode, /banner\.setAttribute\('translate','no'\)/, 'and marked, so the translator leaves the finished words alone');
    assert.match(bannerCode, /link\.href='#settings\/security'/);
    assert.match(app, /security:'settings\/security'/, 'and that address is a route that exists');
    assert.ok(html.includes('id="securityPasswordForm"'), 'with the form on that page');
  });

  test('what the code drew with t() is drawn again when the language changes, not only what the translator walks', () => {
    const repaint = app.slice(app.indexOf('function repaintForLanguage()'), app.indexOf('function labelHelpButtons()'));
    assert.match(app, /\$\('#languageSelect'\)\?\.addEventListener\('change',repaintForLanguage\)/);
    for (const painter of ['renderAll()', 'renderChatNav()', 'paintApprovalStrip()', 'paintDefaultPasswordBanner()', 'paintSimpleComputer(lastComputerReport)', 'refreshCodenModelChip()', 'refreshMessages()', 'goToHash()']) {
      assert.ok(repaint.includes(painter), `the language change does not draw again: ${painter}`);
    }
    assert.match(repaint, /if\(!currentUser\)return;/, 'and does nothing at the sign-in window, where there is nothing to draw');
  });

  test('the model card is translate="no" as a whole, so every word in it goes through t()', () => {
    const card = app.slice(app.indexOf('function modelCard('), app.indexOf('function modelCard(') + 2600);
    assert.match(card, /<article class="entity-card model-tile" translate="no">/);
    assert.match(card, /escapeHtml\(t\(modelCategoryTitle\(f\)\)\)/, 'the category badges');
    assert.match(card, /<em>\$\{escapeHtml\(t\('undeclared'\)\)\}<\/em>/, 'the word "undeclared"');
    assert.ok(!card.includes("'<em>undeclared</em>'"), 'and no literal English where a word is drawn');
    assert.match(app, /<p class="model-description">\$\{escapeHtml\(t\(item\.description\)\)\}<\/p>/, 'the description');
    assert.match(app, /<h4 translate="no">\$\{escapeHtml\(t\(modelCategoryTitle\(key\)\)\)\}<\/h4>/, 'and the headings of the suggested models');
  });

  test('a successful change takes the banner away at once, and the page stops believing the flag', () => {
    assert.match(changeCode, /currentUser\.mustChangePassword=false;/);
    assert.match(changeCode, /\$\('#defaultPasswordBanner'\)\?\.remove\(\);/);
    assert.ok(changeCode.indexOf("#defaultPasswordBanner'")  > changeCode.indexOf('await api(') , 'only after the server said yes');
    assert.ok(changeCode.indexOf("#defaultPasswordBanner'") < changeCode.indexOf("toast(`Password changed."), 'before the toast, so a failing toast cannot leave it up');
  });

  test('a failed change leaves the banner where it is (the removal is inside the try, after the call)', () => {
    const tryStart = changeCode.indexOf('try{');
    assert.ok(changeCode.indexOf("#defaultPasswordBanner'") > tryStart);
    assert.ok(changeCode.indexOf('}catch(error){reportError(') > changeCode.indexOf("#defaultPasswordBanner'"));
  });

  test('the two phrases are declared runtime-only and translated', () => {
    for (const phrase of ['This account is still using the default password.', 'Change it now']) {
      assert.ok(RUNTIME_ONLY.includes(phrase), `not declared runtime-only: ${phrase}`);
      assert.ok(typeof CATALOGS.it[phrase] === 'string' && CATALOGS.it[phrase] !== phrase, `not translated: ${phrase}`);
    }
  });
});

describe('connecting a model in plain words', () => {
  const start = app.indexOf('function wizardShow(state)');
  const end = app.indexOf('function initModelWizard()');
  const wizard = app.slice(start, end);

  test('the code exists, between the two functions that frame it', () => {
    assert.ok(start > 0 && end > start);
    assert.match(app, /\$\('#modelWizardOpen'\)\?\.addEventListener\('click',wizardSearch\)/);
  });

  test('every state the code can show has its sentence in the markup, and every sentence is used', () => {
    // every quoted word inside a call to wizardShow(…), so that a state chosen by a ternary counts too
    const used = new Set([...wizard.matchAll(/wizardShow\(([^)]*)\)/g)].flatMap((call) => [...call[1].matchAll(/'([a-z]+)'/g)].map((m) => m[1])));
    used.delete('found'); // the list of what was found is a container, not a sentence
    const inMarkup = new Set([...html.matchAll(/data-wizard-state="([a-z]+)"/g)].map((m) => m[1]));
    assert.deepEqual([...used].sort(), [...inMarkup].sort());
    assert.match(html, /id="modelWizardFound"/);
  });

  test('the three answers about tools are in the markup, and "could not check" is not shown as "no"', () => {
    for (const kind of ['yes', 'no', 'unknown']) assert.match(html, new RegExp(`data-wizard-tools="${kind}"`));
    assert.match(wizard, /tools===true\?'yes':tools===false\?'no':'unknown'/);
  });

  test('no address is typed or sent from the page: the search sends an empty body and a connection uses what the server found', () => {
    assert.match(wizard, /api\('\/api\/v1\/models\/discover',\{method:'POST',body:'\{\}'\}\)/);
    assert.ok(!/<input/.test(html.slice(html.indexOf('id="modelWizard"'), html.indexOf('id="modelFoundTemplate"'))), 'no text box in the wizard');
    assert.match(wizard, /baseUrl:server\.baseUrl/);
    assert.ok(!/\.baseUrl\s*=[^=]|baseUrl:\$\(/.test(wizard), 'the base URL is never read from a field');
  });

  test('it makes the same profile the Providers page would, and switches it off again if it does not answer', () => {
    assert.match(wizard, /type:'local-openai-compatible'/);
    assert.match(wizard, /enabled:true/);
    assert.match(wizard, /\/health`\)/, 'the proof that it answers is the health check');
    assert.match(wizard, /catch\(error\)\{[\s\S]*enabled:false/, 'a profile that does not answer is not left enabled');
  });

  test('a person who may not manage providers is told so instead of seeing an error', () => {
    assert.match(wizard, /error\.status===403\)\{wizardShow\('denied'\)/);
  });

  test('the notice offers the wizard and, beside it, the Providers page for everything else', () => {
    const notice = html.slice(html.indexOf('id="simpleNoModel"'), html.indexOf('id="modelWizard"'));
    assert.match(notice, /id="modelWizardOpen"/);
    assert.match(notice, /data-view-link="providers"/);
  });

  test('an answer hides the notice for good', () => {
    assert.match(app, /Response completed\.'\);[\s\S]{0,260}\$\('#simpleNoModel'\)\?\.classList\.add\('hidden'\)/);
  });
});

describe('the wiring in app.js', () => {
  test('the module is imported and the level is read before anything paints', () => {
    assert.match(app, /from '\.\/simple-mode\.js'/);
    const read = app.indexOf('let uiLevel=readLevel(localStorage);document.body.dataset.level=uiLevel;');
    const call = app.lastIndexOf('initRouter();');
    assert.ok(read > 0 && call > read, 'the level is bound before the line that starts painting (D-0416)');
  });

  test('a setup token in the address is taken out before the router reads the hash as a route', () => {
    const take = app.indexOf('const setupLinkToken=setupTokenFromHash(location.hash)');
    const call = app.lastIndexOf('initRouter();');
    assert.ok(take > 0 && take < call);
    assert.match(app, /history\.replaceState\(null,'',location\.pathname\+location\.search\)/);
  });

  test('an empty address, #/home typed or bookmarked, and a legacy name for Home all open the chat', () => {
    assert.match(app, /if\(!first\)return\{view:'chat',section:'',place:''\};/);
    assert.match(app, /if\(first==='home'\)return\{view:'chat',section:'',place:'',redirected:true\};/);
    assert.match(app, /view:lv==='home'\?'chat':lv/);
    const route = app.slice(app.indexOf('function routeFromHash()'), app.indexOf('function sessionPlaceFromHash()'));
    assert.ok(route.indexOf("first==='home'") < route.indexOf('LEGACY_ROUTES[first]'), 'the check comes before the legacy table');
  });

  test('opening NOESAR is a new chat: no conversation is picked for the person because it happened to be first', () => {
    const refresh = app.slice(app.indexOf('async function refreshWorkspace(){'), app.indexOf('\n', app.indexOf('async function refreshWorkspace(){')));
    assert.ok(!/activeConversationId=c\?\.id/.test(refresh), refresh);
  });

  test('a first message creates the conversation, and the mode is inferred from what it says', () => {
    assert.match(app, /if\(!state\.activeConversationId&&!\(await ensureConversation\(\)\)\)/);
    assert.match(app, /mode:inferChatMode\(content\),/);
  });

  test('a failed send is shown as an alert and gives the message back, only when nothing was answered', () => {
    assert.match(app, /if\(!assistantText\)\$\('#chatInput'\)\.value=content;\n\s*toast\(/);
  });

  test('"no model" is told in the welcome\'s own words, which the catalogue already translates', () => {
    assert.match(app, /No enabled model provider\/i\.test\(error\.message\)\?t\('NOESAR needs an AI to answer\.'\)/);
    assert.match(html, /<b>NOESAR needs an AI to answer\.<\/b>/, 'the sentence exists in the markup, so it is covered by the translation check');
  });

  test('the menu: open on a computer, a drawer on a phone; [ and ] still narrow and widen it', () => {
    const rank = app.slice(app.indexOf('const SIDEBAR_RANKS='), app.indexOf('function initSettingsMenu('));
    assert.match(rank, /if\(narrowQuery\.matches\)return 'hidden';/);
    assert.match(rank, /\?stored:'full'/);
    assert.match(rank, /applySidebarRank\(\$\('#appShell'\)\?\.dataset\.sidebar==='hidden'\?'full':'hidden'\)/);
    assert.match(rank, /if\(event\.key==='\['\)stepSidebarRank\(-1\);/);
    assert.match(rank, /function closeDrawer\(\)\{if\(narrowQuery\.matches\)applySidebarRank\('hidden'\);\}/);
    assert.match(rank, /const SIDEBAR_KEY='noesar\.menu\.rank';/, 'its own key: the old one held the simple view\'s "hidden" for everyone who used it');
  });

  test('the project a first message creates is named through t(), which RUNTIME_ONLY declares', () => {
    assert.match(app, /name:t\('My things'\)/);
    assert.ok(RUNTIME_ONLY.includes('My things'), 'declared runtime-only');
    assert.equal(CATALOGS.it['My things'], 'Le mie cose', 'and translated');
  });
});

// The register the assistant speaks in: one interface, one register — the one that speaks to a person. See
// assistant-identity.test.mjs for what the server does with it.
describe('who the assistant is told it is talking to', () => {
  test('every message from the page says it comes from a person', () => {
    const sendChat = app.slice(app.indexOf('async function sendChat('), app.indexOf("$('#sendMessage').addEventListener('click'"));
    assert.ok(sendChat.includes("audience:'everyday',"), 'inside the one request sendChat makes');
    assert.doesNotMatch(app, /audience:'operator'/);
  });
});

// Measured on a clean installation with a real model, the first screens spoke in the product's own words:
// "model server", a raw file path in a drop-down ("/models/qwen2.5-7b-instruct-q4_k_m-00001-of-00002.gguf"),
// an address and a port, a bare "↩", an English badge, and a suggestion that was SENT before the person had
// pasted the text it asked for ("first paste it, then I will go on").
describe('plain words on the first screens', () => {
  const sampleIds = [
    ['/models/qwen2.5-7b-instruct-q4_k_m-00001-of-00002.gguf', 'Qwen2.5 7B Instruct'],
    ['Qwen3.6-35B-A3B-UD-IQ4_XS.gguf', 'Qwen3.6 35B A3B'],
    ['mistral-7b-instruct-v0.3.Q4_K_M.gguf', 'Mistral 7B Instruct V0.3'],
    ['llama3.2:3b', 'Llama3.2 3B'],
    ['qwen2.5-7b-instruct', 'Qwen2.5 7B Instruct'],
    ['fake-llama-3b', 'Fake Llama 3B'],
  ];

  test('a model id is said the way a person would: path, extension, part number and quantisation go', () => {
    for (const [id, said] of sampleIds) assert.equal(friendlyModelName(id), said, id);
  });

  test('a hosted model keeps its own id, and nothing breaks on odd input', () => {
    for (const id of ['gpt-4o', 'claude-3-5-sonnet', 'gemini-1.5-pro']) assert.equal(friendlyModelName(id), id);
    assert.equal(friendlyModelName(''), '');
    assert.equal(friendlyModelName(null), '');
    assert.equal(friendlyModelName(undefined), '');
    assert.equal(friendlyModelName('/models/x.gguf'), 'X');
    assert.equal(friendlyModelName('/models/.gguf'), '/models/.gguf', 'nothing left after tidying: the id itself, never an empty label');
  });

  test('the wizard shows the friendly name but sends the raw id, and the address is only a tooltip', () => {
    const search = app.slice(app.indexOf('async function wizardSearch('), app.indexOf('function wizardFailed('));
    assert.ok(search.includes('<option value="${escapeHtml(id)}">${escapeHtml(friendlyModelName(id))}</option>'));
    assert.ok(search.includes('found.textContent=server.name;found.title=`${server.host}:${server.port}`'));
    assert.ok(!search.includes('textContent=`${server.name} · '), 'no address in the visible text');
  });

  test('the model button says it the same way, for everyone', () => {
    assert.match(app, /function shortModelName\(id\)\{[^}]*return friendlyModelName\(id\);/);
  });

  test("a sentence to start from is written into the box, not sent, and leaves the cursor at its end", () => {
    const chipCode = app.slice(app.indexOf("$$('[data-simple-prompt]')"), app.indexOf('function setWeb(on){'));
    assert.ok(chipCode.length > 100 && chipCode.length < 1800, 'the handler is found, and only the handler');
    assert.ok(chipCode.includes('const open=chip.dataset.promptText;'));
    assert.ok(chipCode.includes("box.value=chip.hasAttribute('data-prompt-complete')?t(open):`${t(open)} `;"));
    assert.ok(chipCode.includes('box.setSelectionRange(box.value.length,box.value.length)'), 'the cursor goes after the sentence');
  });

  test('"no AI" and the status line are in the person\'s language', () => {
    for (const phrase of ['No AI yet', 'Response completed.', 'Generation stopped.']) {
      assert.ok(RUNTIME_ONLY.includes(phrase), `not declared runtime-only: ${phrase}`);
      assert.ok(typeof CATALOGS.it[phrase] === 'string' && CATALOGS.it[phrase] !== phrase, `not translated: ${phrase}`);
    }
    assert.ok(app.includes("function setStatus(message,error=false){$('#statusMessage').textContent=t(message);"));
  });

  test('an answer can be copied, and when the browser refuses the person is told how to do it by hand', () => {
    const renderLine = app.slice(app.indexOf('function messageHtml('), app.indexOf('function renderMessages('));
    assert.ok(renderLine.includes('<button data-copy-message="${id}">'), 'the button is drawn');
    assert.ok(renderLine.indexOf('${assistant?`<button data-copy-message') > 0, 'on assistant messages only');
    const bind = app.slice(app.indexOf("$$('[data-copy-message]')"), app.indexOf("$$('[data-copy-message]')") + 900);
    assert.ok(bind.includes("navigator.clipboard.writeText(message?.content??'')"));
    assert.ok(bind.includes("catch{toast(t('Could not copy. Select the text and copy it by hand.'),{kind:'error'});}"), 'a refusal is said, not swallowed');
    for (const phrase of ['Copy', 'Copied.', 'Could not copy. Select the text and copy it by hand.', 'Retry']) {
      assert.ok(RUNTIME_ONLY.includes(phrase), `not declared runtime-only: ${phrase}`);
      assert.ok(typeof CATALOGS.it[phrase] === 'string' && CATALOGS.it[phrase] !== phrase, `not translated: ${phrase}`);
    }
  });

  test("under an answer: Copy and Retry, and the rest behind ⋯ — nothing removed", () => {
    const renderLine = app.slice(app.indexOf('function messageHtml('), app.indexOf('function renderMessages('));
    const more = renderLine.slice(renderLine.indexOf('<details class="message-more">'));
    for (const action of ['data-save-message', 'data-edit-message', 'data-fork-message', 'data-exclude-message']) assert.ok(more.includes(action), `${action} is behind ⋯`);
    assert.match(renderLine, /<div class="message-actions">\$\{assistant\?`<button data-copy-message[^`]*data-retry-message[^`]*`:''\}\$\{more\}<\/div>/, 'Copy and Retry in view, then ⋯');
  });

  test('Settings: the drawing\'s menu, "You" then "This NOESAR", and every section is still reachable', () => {
    const menu = [...html.matchAll(/<button class="settings-nav[^"]*" type="button" data-section="([a-z-]+)"/g)].map((m) => m[1]);
    assert.deepEqual(menu, ['appearance', 'language', 'security', 'privacy', 'models-hardware', 'modules', 'skills', 'people', 'storage', 'sessions', 'health', 'audit', 'updates', 'about', 'licence', 'remote-targets']);
    // the eleven of the drawing, and under four of them the sections they carry, listed while the entry is open
    const subs = [...html.matchAll(/<button class="settings-nav settings-nav-sub" type="button" data-section="([a-z-]+)" data-group="([a-z-]+)"/g)].map((m) => [m[1], m[2]]);
    assert.deepEqual(subs, [['skills', 'modules'], ['sessions', 'storage'], ['audit', 'health'], ['about', 'updates'], ['licence', 'updates'], ['remote-targets', 'updates']]);
    const groups = app.match(/const SETTINGS_GROUPS=(\{[^;]*\});/)?.[1];
    assert.ok(groups, 'the entries that carry more than one section');
    const carried = Object.values(Function(`return ${groups}`)()).flat();
    for (const section of ['sessions', 'appearance', 'language', 'about', 'licence', 'privacy', 'people', 'security', 'skills', 'models-hardware', 'storage', 'audit', 'health', 'updates', 'modules', 'remote-targets']) {
      assert.ok(menu.includes(section) || carried.includes(section), `no way to the section "${section}"`);
    }
    assert.match(html, /<button class="nav settings-link" data-view="coden-tui" type="button"><span>Terminal access<\/span><\/button>/);
    assert.ok(app.includes("link.href='#settings/security'") && menu.includes('security'), 'the password banner sends people to Security, which is in the menu');
  });

  test('a bare settings address lands on the first entry: how the page looks, and its level', () => {
    assert.ok(app.includes("const wanted=SETTINGS_SECTIONS.includes(requested)?requested:'appearance';"));
  });

  test('an answer can be saved as a document from the chat, titled by what the person asked', () => {
    assert.ok(app.includes('${assistant?`<button data-save-message="${id}">Save this answer</button>`:\'\'}'), 'the button is drawn under every answer');
    const bind = app.slice(app.indexOf('function bindMessageActions('), app.indexOf('function bindMessageActions(') + 1300);
    assert.ok(bind.includes("await api('/api/v1/artifacts',{method:'POST',body:JSON.stringify({projectId:state.activeProjectId||null,type:'document',title:titleFromMessage(asked?.content??message.content),content:message.content})});"));
    assert.ok(bind.includes("const asked=messages.slice(0,messages.indexOf(message)).reverse().find((item)=>item.role==='user');"), 'named for the question, from the message before the answer');
    assert.ok(bind.includes("toast(t('Saved in Documents.'))"));
    assert.ok(bind.includes("catch(error){toast(error.message,{kind:'error'});}"), 'a refusal is shown, not swallowed');
    for (const phrase of ['Save this answer', 'Saved in Documents.', 'No documents yet. When an answer is worth keeping, press Save under it.']) {
      assert.ok(RUNTIME_ONLY.includes(phrase), `not declared runtime-only: ${phrase}`);
      assert.ok(typeof CATALOGS.it[phrase] === 'string' && CATALOGS.it[phrase] !== phrase, `not translated: ${phrase}`);
    }
  });

  test('the list of documents has Copy and Edit, says what to do when it is empty, and the full interface keeps its words', () => {
    const list = app.slice(app.indexOf('function renderArtifacts('), app.indexOf("$('#artifactForm').addEventListener('submit'"));
    assert.ok(list.includes('<button data-copy-artifact="${item.id}">Copy</button>'), 'the button is drawn on every document');
    assert.ok(list.includes("$$('[data-copy-artifact]').forEach("), 'and it does something');
    assert.ok(list.includes('">Edit</button>'), 'Edit, for everyone');
    assert.ok(list.includes("||t('No documents yet. When an answer is worth keeping, press Save under it.')"));
    // The markup starts the list as "empty-state" (text centred, 20px padding). A list that is never told it is no longer
    // empty draws every letter and every table centred, in both interfaces (seen on a live page, 2026-10-08).
    assert.ok(list.startsWith("function renderArtifacts(){$('#artifactList').classList.toggle('empty-state',state.artifacts.length===0);"), 'the list stops being "empty" once it holds a document');
    assert.ok(html.includes('id="artifactList" class="card-list empty-state"'), 'and this is why it has to be done: the markup starts it empty');
    assert.ok(list.includes("catch{toast(t('Could not copy. Select the text and copy it by hand.'),{kind:'error'});}"));
  });

});

describe('the time a person reads, when the server cannot know their zone', () => {
  const rome = { effective: 'UTC', source: 'utc-fallback', browserReported: 'Europe/Rome' };

  test('the browser zone is offered when the server fell back to UTC and the browser says otherwise', () => {
    assert.equal(zoneOffer(rome), 'Europe/Rome');
    assert.equal(zoneOffer({ ...rome, browserReported: ' Europe/Rome ' }), 'Europe/Rome');
  });

  test('nothing is offered when the zone is somebody\'s decision, when the browser agrees, or when nothing is known', () => {
    for (const source of ['manual-override', 'user', 'host', 'installer', 'browser']) {
      assert.equal(zoneOffer({ ...rome, source }), '', `a zone from "${source}" is not a gap`);
    }
    assert.equal(zoneOffer({ ...rome, browserReported: 'UTC' }), '', 'the browser already says UTC');
    assert.equal(zoneOffer({ ...rome, browserReported: null }), '');
    assert.equal(zoneOffer({ ...rome, browserReported: '' }), '');
    assert.equal(zoneOffer(null), '');
    assert.equal(zoneOffer(undefined), '');
  });

  const wiring = app.slice(app.indexOf('async function loadEffectiveZone('), app.indexOf('let confirmResolve=null;'));
  test('the offer is drawn by a button the person presses, with the same PUT as Settings', () => {
    assert.ok(wiring.includes('paintZoneOffer(settings);'), 'every load of the zone repaints the offer');
    assert.ok(wiring.includes("const zone=zoneOffer(settings);"), 'only what zoneOffer returns');
    assert.ok(wiring.includes("if(!zone||$('#defaultPasswordBanner')){bar?.remove();return;}"), 'the line goes away once it no longer applies, and never stands beside the default-password notice');
    assert.ok(wiring.includes("await api('/api/v1/settings/timezone',{method:'PUT',body:JSON.stringify({timezone:zone})});"), 'the person\'s own choice, audited by the server like any other');
    assert.ok(wiring.includes('await loadEffectiveZone();await refreshWorkspace();'), 'and the times on the page change at once');
    assert.ok(!/innerHTML/.test(wiring.slice(wiring.indexOf('function paintZoneOffer('))), 'built with the DOM: the zone name comes from the browser');
    assert.ok(!/style\.cssText|style=/.test(wiring), 'no inline style');
    assert.ok(look.includes('#zoneBanner{'), 'drawn by the stylesheet');
    assert.ok(wiring.includes("($('#mainContent')??document.body).prepend(bar);"), 'at the top of the page, beside the menu');
  });

  test('its three sentences are declared runtime-only and translated', () => {
    for (const phrase of ['Times are shown in UTC.', 'Your computer is in', 'Use the time on my computer']) {
      assert.ok(RUNTIME_ONLY.includes(phrase), `not declared runtime-only: ${phrase}`);
      assert.ok(typeof CATALOGS.it[phrase] === 'string' && CATALOGS.it[phrase] !== phrase, `not translated: ${phrase}`);
    }
  });
});

describe('the page is light or dark by the computer, unless the person chose', () => {
  const store = (initial) => { const data = new Map(Object.entries(initial)); return { getItem: (k) => (data.has(k) ? data.get(k) : null), setItem: (k, v) => data.set(k, v), data }; };

  test('"auto" follows the computer: dark computer, midnight; anything else, daylight', () => {
    assert.equal(themeForScheme('auto', true), 'midnight');
    assert.equal(themeForScheme('auto', false), 'daylight');
    assert.equal(themeForScheme(undefined, false), 'daylight');
  });

  test('a choice beats the computer, in both directions', () => {
    assert.equal(themeForScheme('light', true), 'daylight');
    assert.equal(themeForScheme('dark', false), 'midnight');
  });

  test('the preference is "auto" unless it says light or dark, and a refused storage is "auto"', () => {
    assert.equal(readScheme(store({})), 'auto');
    assert.equal(readScheme(store({ [SCHEME_KEY]: 'dark' })), 'dark');
    assert.equal(readScheme(store({ [SCHEME_KEY]: 'light' })), 'light');
    assert.equal(readScheme(store({ [SCHEME_KEY]: 'midnight' })), 'auto');
    assert.equal(readScheme({ getItem() { throw new Error('private window'); } }), 'auto');
    assert.equal(readScheme(null), 'auto');
  });

  test('writing keeps only the three values, and a refused storage does not throw', () => {
    const s = store({});
    writeScheme(s, 'dark'); assert.equal(s.data.get(SCHEME_KEY), 'dark');
    writeScheme(s, 'auto'); assert.equal(s.data.get(SCHEME_KEY), 'auto');
    writeScheme(s, 'nonsense'); assert.equal(s.data.get(SCHEME_KEY), 'auto');
    assert.doesNotThrow(() => writeScheme({ setItem() { throw new Error('private window'); } }, 'dark'));
  });

  test('light or dark is the look; a theme picked by hand among the nine replaces it until light or dark is chosen again', () => {
    const start = app.indexOf("const darkQuery=matchMedia('(prefers-color-scheme: dark)');");
    const code = app.slice(start, app.indexOf('\n', app.indexOf('darkQuery.addEventListener', start)));
    assert.ok(start > 0 && code.includes("function applySchemeTheme(){if(readTheme())return;document.documentElement.dataset.theme=themeForScheme(readScheme(localStorage),darkQuery.matches);}"));
    assert.ok(code.includes('if(readTheme())applyTheme(readTheme());else applySchemeTheme();'));
    assert.match(app, /const THEME_KEY='noesar\.theme\.chosen';/, 'its own key: the old one was written on every load');
    assert.ok(app.includes("try{localStorage.removeItem(THEME_KEY);}catch{}writeScheme(localStorage,choice.dataset.scheme);applySchemeTheme();paintSchemeChoices();"), 'a light/dark choice forgets the theme');
  });

  test('Settings offers the three choices, each pressed state kept in aria-pressed', () => {
    for (const choice of ['auto', 'light', 'dark']) assert.ok(html.includes(`data-scheme="${choice}" aria-pressed="false"`), choice);
    assert.ok(app.includes("choice.setAttribute('aria-pressed',String(choice.dataset.scheme===chosen))"));
    for (const phrase of ['Light or dark', 'Like this computer', 'Light', 'Dark']) assert.ok(typeof CATALOGS.it[phrase] === 'string' && CATALOGS.it[phrase] !== phrase, `not translated: ${phrase}`);
  });
});

describe('a time a person can read', () => {
  const now = new Date('2026-10-08T04:40:00Z');
  const rome = { now, zone: 'Europe/Rome', lang: 'it' };

  test('today and yesterday are words, with the time, in the language of the page', () => {
    assert.equal(friendlyWhen('2026-10-08T02:36:00Z', rome), 'Oggi, 04:36');
    assert.equal(friendlyWhen('2026-10-07T14:52:00Z', rome), 'Ieri, 16:52');
    assert.equal(friendlyWhen('2026-10-08T02:36:00Z', { ...rome, lang: 'en-GB' }), 'Today, 04:36');
    assert.equal(friendlyWhen('2026-10-07T14:52:00Z', { ...rome, lang: 'en-GB' }), 'Yesterday, 16:52');
  });

  test('older times give the day and month, and the year only when it is not this one', () => {
    assert.equal(friendlyWhen('2026-10-06T14:52:00Z', rome), '6 ott, 16:52');
    assert.equal(friendlyWhen('2025-12-30T10:00:00Z', rome), '30 dic 2025, 11:00');
  });

  test('"today" is today in the person\'s zone, not in UTC', () => {
    // 22:30 UTC on the 7th is 00:30 on the 8th in Rome
    assert.equal(friendlyWhen('2026-10-07T22:30:00Z', rome), 'Oggi, 00:30');
    assert.equal(friendlyWhen('2026-10-07T22:30:00Z', { ...rome, zone: 'UTC' }), 'Ieri, 22:30');
  });

  test('the zone is named only when asked for', () => {
    assert.equal(friendlyWhen('2026-10-08T02:36:00Z', rome), 'Oggi, 04:36');
    assert.equal(friendlyWhen('2026-10-08T02:36:00Z', { ...rome, showZone: true }), 'Oggi, 04:36 · Europe/Rome');
  });

  test('a time that is not one is a dash, and an unknown zone does not throw', () => {
    assert.equal(friendlyWhen('not a time', rome), '—');
    assert.equal(friendlyWhen(undefined, rome), '—');
    assert.doesNotThrow(() => friendlyWhen('2026-10-08T02:36:00Z', { ...rome, zone: 'Not/AZone' }));
    assert.ok(!friendlyWhen('2026-10-08T02:36:00Z', { ...rome, zone: 'Not/AZone', showZone: true }).includes('Not/AZone'), 'a zone that does not exist is not named');
  });

  test('the page uses it everywhere, naming the zone only where it is not the computer\'s own', () => {
    const code = app.slice(app.indexOf('function formatInstant('), app.indexOf('function instantHtml('));
    assert.ok(code.includes("return friendlyWhen(date,{zone,lang:document.documentElement.lang||undefined,showZone:withZone&&zone!==Intl.DateTimeFormat().resolvedOptions().timeZone});"));
  });

  test('the list of chats says when, not how many messages, and not in English', () => {
    const row = app.slice(app.indexOf('function chatNavRowHtml('), app.indexOf('function renderChatNav('));
    assert.ok(row.includes('<small class="level-advanced">${when}</small>'), 'when, and only at the Advanced level: the menu shows titles');
    assert.ok(!row.includes('messageCount'));
  });
});

describe('the computer, in plain words', () => {
  test('processor, memory and graphics card, as the machine reported them', () => {
    const report = { cpu: { model: 'AMD Ryzen 5 5600X 6-Core Processor', logicalCores: 12 }, memory: { totalBytes: 33585311744 }, accelerators: [] };
    assert.deepEqual(describeComputer(report), [['Processor', 'AMD Ryzen 5 5600X 6-Core Processor'], ['Memory', '31 GB'], ['Graphics card', '']]);
  });

  test('a graphics card is named when the report names it, and "Yes" when it only says one is there', () => {
    assert.equal(describeComputer({ accelerators: [{ name: 'NVIDIA GeForce RTX 3060' }] })[2][1], 'NVIDIA GeForce RTX 3060');
    assert.equal(describeComputer({ accelerators: [{ model: 'A' }, { vendor: 'B' }] })[2][1], 'A, B');
    assert.equal(describeComputer({ accelerators: [{}] })[2][1], 'Yes');
  });

  test('a report with nothing in it, or none, gives empty values and does not throw', () => {
    assert.deepEqual(describeComputer(undefined), [['Processor', ''], ['Memory', ''], ['Graphics card', '']]);
    assert.deepEqual(describeComputer({ memory: { totalBytes: 'many' } })[1], ['Memory', '']);
  });

  test('the labels are strings of the interface, translated', () => {
    for (const label of ['Processor', 'Memory', 'Graphics card', 'None found']) assert.ok(typeof CATALOGS.it[label] === 'string', label);
  });
});

describe('what the pages say in plain words (2026-10-08)', () => {
  test('the sign-in window says what to type and calls the password a password', () => {
    assert.ok(html.includes('<label>Password<input id="loginPassword"'));
    assert.ok(!html.includes('Passphrase'), 'no jargon on the one screen everybody passes');
    assert.ok(html.includes('id="loginHint"'));
    assert.ok(html.includes('<p id="authDescription">Use your NOESAR name and password.</p>'), 'the sub-title does not repeat the title, "Sign in"');
    for (const phrase of ['Use your NOESAR name and password.', 'Password', 'If you have just installed NOESAR, you find them at the end of the installation.']) {
      assert.ok(typeof CATALOGS.it[phrase] === 'string' && CATALOGS.it[phrase] !== phrase || phrase === 'Password', `not translated: ${phrase}`);
    }
    assert.ok(!('Passphrase' in CATALOGS.it), 'a stale entry');
  });

  test('the line under the box says where your words go, as a person says it, from the server\'s own verdict', () => {
    const privacy = app.slice(app.indexOf('async function refreshPrivacy('), app.indexOf('// The eight elements'));
    assert.ok(privacy.includes('lastPrivacy={external:Boolean(banner.external),unconfirmed:false};'), 'from banner.external, never invented');
    assert.ok(privacy.includes('lastPrivacy={external:false,unconfirmed:true};'), 'an unanswered check is not a local-only guarantee');
    const line = privacy.slice(privacy.indexOf('function paintLockline('));
    for (const phrase of ['NOESAR could not check where your words go.', 'An outside AI service is in use.', 'Your words are sent to it because you chose it.', 'Internet: only searches in general words', 'your documents stay on this computer', 'Everything stays on this computer', 'NOESAR can be wrong: check what matters']) {
      assert.ok(line.includes(`'${phrase}'`), `the line says: ${phrase}`);
      assert.ok(RUNTIME_ONLY.includes(phrase), `not declared runtime-only: ${phrase}`);
      assert.ok(typeof CATALOGS.it[phrase] === 'string' && CATALOGS.it[phrase] !== phrase, `not translated: ${phrase}`);
    }
    assert.match(line, /getAttribute\('aria-pressed'\)==='true'/, 'and it follows the web switch');
  });

  test('the box says what to write, painted by t() because the translator would put a changed placeholder back', () => {
    assert.match(html, /<textarea id="chatInput" placeholder="Write what you need…" aria-describedby="chatCommands" translate="no"><\/textarea>/);
    const code = app.slice(app.indexOf('function initInterface(){'), app.indexOf('function setWeb(on){'));
    assert.ok(code.includes("const paint=()=>box.setAttribute('placeholder',t('Write what you need…'));"));
    assert.ok(code.includes("$('#languageSelect')?.addEventListener('change',()=>setTimeout(()=>{paint();paintGreeting();paintLockline();},0));"), 'and repainted when the language changes');
    assert.equal(CATALOGS.it['Write what you need…'], 'Scrivi cosa ti serve…', 'the markup carries it, so the static check covers it');
  });

  test('the default-password notice is a class, not inline style, and a message beside a button', () => {
    const start = app.indexOf("let banner=$('#defaultPasswordBanner');");
    const code = app.slice(start, app.indexOf('}else if(banner){banner.remove();}', start));
    assert.ok(code.includes("banner.className='top-notice'"));
    assert.ok(!/style\.cssText/.test(code), 'the looks are in the stylesheets');
    assert.ok(code.includes('banner.append(message,link);'));
    assert.ok(/\.top-notice\{/.test(look), 'look.css draws it');
  });

  test('Settings has a plain page for each door: light or dark, language, password, and the AI with the computer', () => {
    for (const id of ['simpleAppearance', 'schemeChoices', 'levelChoices', 'textSizeGroup', 'simpleLanguage', 'languageSelect', 'simpleAi', 'simpleAiNow', 'simpleAiSearch', 'simpleComputer']) assert.ok(html.includes(`id="${id}"`), `missing: ${id}`);
    for (const phrase of ['Account and security', 'Models', 'Appearance and level', 'Interface level', 'Language of the screens', 'The AI that answers you', 'Look for an AI on this computer', 'This computer']) {
      assert.ok(typeof CATALOGS.it[phrase] === 'string' && CATALOGS.it[phrase] !== phrase, `not translated: ${phrase}`);
    }
  });

  test('"Look for an AI" opens the same wizard as the chat does, with only the part that is needed', () => {
    assert.ok(app.includes("$('#simpleAiSearch')?.addEventListener('click',()=>{\n    navigate('chat');\n    const notice=$('#simpleNoModel');notice?.classList.remove('hidden');notice?.classList.add('wizard-only');\n    $('#modelWizardOpen')?.click();"));
    assert.ok(look.includes('#simpleNoModel.wizard-only>b'));
  });

  test('the language of the screens is one select, in Settings; the sign-in window\'s drives it', () => {
    assert.ok(html.slice(html.indexOf('id="section-language"')).includes('<select id="languageSelect">'));
    assert.ok(app.includes("main.value=event.target.value;main.dispatchEvent(new Event('change',{bubbles:true}));"));
    assert.ok(app.includes('mine.innerHTML=main.innerHTML;mine.value=main.value;'));
  });

  test('the banner and the menu use words a person knows', () => {
    assert.equal(CATALOGS.it['Open queue'], 'Vedi l’elenco');
    assert.equal(CATALOGS.it['Library'], 'Libreria');
    assert.equal(CATALOGS.it['Automations'], 'Automazioni');
  });
});

describe('look.css: the one interface, readable by everyone', () => {
  const rules = [...look.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ selector: m[1].trim(), body: m[2] }));

  test('every font size follows the text size setting: rem (the root follows --text-scale), never a bare pixel size', () => {
    assert.match(look, /html\{font-size:calc\(var\(--text-scale,1\)\*16px\)\}/);
    for (const m of look.replace('html{font-size:calc(var(--text-scale,1)*16px)}', '').matchAll(/font-size:([^;}]+)/g)) assert.ok(/rem$|^inherit$/.test(m[1].trim()), `bare size: ${m[1]}`);
  });

  test('nothing a person reads is set under 14px at the default size', () => {
    for (const m of look.matchAll(/font-size:([\d.]+)rem/g)) {
      if (Number(m[1]) * 16 < 14) {
        const at = look.lastIndexOf('}', m.index);
        const selector = look.slice(at + 1, look.indexOf('{', at + 1)).trim();
        assert.ok(/verified|kbd|small/.test(selector), `under 14px: ${selector} ${m[0]}`);
      }
    }
  });

  test('messages: the answer 18px on a readable line, your words 17px in a bubble, the box 17px', () => {
    assert.match(look, /#messageList \.message\.assistant \.message-body,#messageList \.message\.streaming \.message-body\{font-size:1\.125rem;line-height:1\.65;max-width:66ch/);
    assert.match(look, /#messageList \.message\.user \.message-body\{max-width:78%;[^}]*font-size:1\.0625rem/);
    assert.match(look, /#chatInput\{[^}]*font-size:1\.0625rem/);
  });

  test('the menu entries, the box\'s buttons and the actions under an answer are at least 40px tall', () => {
    for (const selector of ['.sidebar .nav,.sidebar .nav-act{', '.composer-plus{', '.composer-web{', '.composer-model{', '.composer-send{', '.message-actions>button,.message-more>summary{']) {
      const rule = rules.find((r) => `${r.selector}{` === selector);
      assert.ok(rule, selector);
      const height = Number(rule.body.match(/(?:min-height|height):(\d+)px/)?.[1]);
      assert.ok(height >= 40, `${selector} ${height}px`);
    }
  });

  test('the two looks define the same tokens, and keep text readable: 4.5:1 for text, 3:1 for the edge of the box', () => {
    const block = (selector) => look.slice(look.indexOf(selector)).match(/\{([^}]*)\}/)[1];
    const tokens = (text) => Object.fromEntries([...text.matchAll(/(--n-[a-z-]+):(#[0-9a-f]{6})/g)].map((m) => [m[1], m[2]]));
    const light = tokens(block(':root[data-theme="daylight"]{'));
    const dark = tokens(block(':root,:root[data-theme="midnight"]{'));
    assert.deepEqual(Object.keys(light).sort(), Object.keys(dark).sort());
    const channel = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    const luminance = (hex) => { const n = parseInt(hex.slice(1), 16); return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255); };
    const ratio = (a, b) => { const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
    for (const [name, t] of [['light', light], ['dark', dark]]) {
      for (const [fg, bg] of [['--n-ink', '--n-bg'], ['--n-ink', '--n-card'], ['--n-ink', '--n-side'], ['--n-muted', '--n-bg'], ['--n-muted', '--n-card'], ['--n-muted', '--n-side'], ['--n-on-accent', '--n-accent'], ['--n-accent-ink', '--n-accent-soft'], ['--n-accent-ink', '--n-bg'], ['--n-warn-ink', '--n-warn-bg'], ['--n-ink', '--n-bubble']]) {
        assert.ok(ratio(t[fg], t[bg]) >= 4.5, `${name}: ${fg} on ${bg} is ${ratio(t[fg], t[bg]).toFixed(2)}:1`);
      }
      assert.ok(ratio(t['--n-edge'], t['--n-card']) >= 1.3, `${name}: the edge of the box disappears`);
    }
  });

  test('the level adds, it never removes: .level-advanced is the only switch, and it only shows things', () => {
    assert.match(look, /\.level-advanced\{display:none!important\}/);
    assert.match(look, /body\[data-level=advanced\] \.level-advanced\{display:revert!important\}/);
    for (const rule of rules) {
      if (!/data-level/.test(rule.selector)) continue;
      assert.ok(/body\[data-level=advanced\]|body:not\(\[data-level=advanced\]\) \.sidebar \.nav-act kbd/.test(rule.selector), `the level does something else: ${rule.selector}`);
    }
  });

  test('nothing here hides the strip that shows what waits for a decision, except its own empty state', () => {
    for (const rule of rules) {
      if (!/approval/i.test(rule.selector)) continue;
      assert.ok(!/display:\s*none|visibility:\s*hidden|opacity:\s*0\b|height:\s*0\b/.test(rule.body) || /\.hidden$/.test(rule.selector), `hides the strip: ${rule.selector}`);
    }
  });

  test('the chat keeps its box in view: the conversation scrolls, the page does not', () => {
    assert.match(look, /#view-chat\.active\{display:flex;flex-direction:column;flex:1;min-height:0;padding:0\}/);
    assert.match(look, /#messageList\{flex:1;min-height:0;overflow:auto;/);
  });

  test('on a phone the menu is a drawer over the page, opened by the one button, and the chat fills the screen', () => {
    const phone = look.slice(look.indexOf('@media (max-width:900px){'));
    assert.match(phone, /\.menu-toggle\{position:fixed;[^}]*display:grid/);
    assert.match(phone, /\.app-shell \.sidebar\{position:fixed;/);
    assert.match(phone, /\.app-shell\[data-sidebar=hidden\] \.sidebar\{display:none\}/);
  });
});

describe('the "i" of the four pages, in plain words', () => {
  // Gulpease: 89 + (300 * sentences - 10 * letters) / words. 80 is easy for a primary-school leaver, 60 for lower secondary.
  const gulpease = (text) => {
    const words = text.split(/\s+/).filter(Boolean);
    const letters = (text.match(/\p{L}/gu) || []).length;
    const sentences = (text.match(/[.!?:]+(\s|$)/g) || []).length || 1;
    return 89 + (300 * sentences - 10 * letters) / words.length;
  };
  const entries = Object.entries(SIMPLE_HELP).flatMap(([address, entry]) => [[address, 'what', entry.what], [address, 'howto', entry.howto]]);

  test('the plain words exist for four pages, and each of them also has its longer entry', () => {
    assert.deepEqual(Object.keys(SIMPLE_HELP).sort(), ['chat', 'documents', 'projects', 'settings']);
    for (const address of Object.keys(SIMPLE_HELP)) assert.ok(PAGE_HELP[address], address);
  });

  test('short, and without the words of the full interface', () => {
    for (const [address, part, text] of entries) {
      assert.ok(text.split(/\s+/).length <= 30, `${address}.${part} is long: ${text.split(/\s+/).length} words`);
      assert.ok(!/\b(artifacts?|context|graph|branch(es)?|retrieval|knowledge|tokens?|plan|approve|runtime|provider|MCP|schema|API|versions?)\b/i.test(text), `${address}.${part} says something from the full interface: ${text}`);
    }
  });

  test('translated, and easy to read in Italian (Gulpease at least 60: lower secondary school)', () => {
    for (const [address, part, text] of [...entries, ['heading', 'what', 'What you can do here']]) {
      assert.ok(RUNTIME_ONLY.includes(text), `not declared runtime-only: ${text}`);
      assert.ok(typeof CATALOGS.it[text] === 'string' && CATALOGS.it[text] !== text, `not translated: ${text}`);
      if (address !== 'heading') assert.ok(gulpease(CATALOGS.it[text]) >= 60, `${address}.${part} is hard to read: Gulpease ${gulpease(CATALOGS.it[text]).toFixed(0)} — ${CATALOGS.it[text]}`);
    }
  });

  test('what they tell a person to press is what the page has, in both languages', () => {
    assert.ok(SIMPLE_HELP.documents.howto.includes('"Save this answer"') && CATALOGS.it[SIMPLE_HELP.documents.howto].includes(`«${CATALOGS.it['Save this answer']}»`));
    assert.ok(SIMPLE_HELP.projects.howto.includes('"Use project"') && CATALOGS.it[SIMPLE_HELP.projects.howto].includes(`«${CATALOGS.it['Use project']}»`));
  });

  test('the plain words are shown where they exist, the longer entry everywhere else', () => {
    const code = app.slice(app.indexOf('function openHelp('), app.indexOf('function installHelpButtons('));
    assert.ok(code.includes('const plain=SIMPLE_HELP[address]??null;') && code.includes('const entry=plain??PAGE_HELP[address];'));
    assert.ok(code.includes("t(plain?'What you can do here':'What is worth doing here')"));
  });
});

describe('look.css: the two states the first screen can be in', () => {
  test('with no AI connected, the notice is the next step and the sentences step aside', () => {
    assert.ok(look.includes('.chat-panel:has(#simpleNoModel:not(.hidden)) .chat-start-chips{display:none}'));
  });

  test('the panel behind the "i" has plain headings', () => {
    assert.ok(look.includes('.help-panel h3{text-transform:none;letter-spacing:0;'));
  });
});

describe('the line under the title of the sign-in window says what this step is', () => {
  const block = app.slice(app.indexOf('const AUTH_DESCRIPTIONS={'), app.indexOf('function authError('));
  const forms = ['#setupForm', '#setupMfaForm', '#loginForm', '#loginMfaForm', '#recoveryStartForm', '#recoveryFinishForm'];
  const descriptions = Object.fromEntries([...block.matchAll(/'(#\w+)':'([^']+)'/g)].map((m) => [m[1], m[2]]));

  test('every one of the six steps has its own sentence, and showOnly writes it', () => {
    for (const form of forms) assert.ok(descriptions[form], `no sentence for ${form}`);
    assert.ok(block.includes("const description=AUTH_DESCRIPTIONS[form];\n  if(description)$('#authDescription').textContent=description;"));
  });

  test('the sign-in step does not speak on the first-setup screen, and the first-setup step does not speak on the sign-in one', () => {
    assert.notEqual(descriptions['#setupForm'], descriptions['#loginForm']);
    assert.ok(!/password/i.test(descriptions['#setupMfaForm']) && !/password/i.test(descriptions['#recoveryStartForm']));
    assert.equal(html.match(/<p id="authDescription">([^<]+)<\/p>/)[1], descriptions['#loginForm'], 'what the page shows before the script runs is the sign-in sentence');
  });

  test('each is short enough to stay on one line of the card (a second line pushes the button of the QR step below a 900px window)', () => {
    for (const [form, text] of Object.entries(descriptions)) assert.ok(text.length <= 50, `${form}: ${text.length} characters`);
  });

  test('each is translated, and the four set from code are declared runtime-only', () => {
    for (const [form, text] of Object.entries(descriptions)) {
      assert.ok(typeof CATALOGS.it[text] === 'string' && CATALOGS.it[text] !== text, `not translated: ${text}`);
      if (form !== '#loginForm') assert.ok(RUNTIME_ONLY.includes(text), `not declared runtime-only: ${text}`);
    }
  });
});

describe('the language can be changed', () => {
  test('in Settings › Language and time, big enough to press', () => {
    const section = html.slice(html.indexOf('id="section-language"'), html.indexOf('id="view-about"'));
    assert.ok(section.includes('<label class="language-picker">Language of the screens<select id="languageSelect">'));
  });

  test('the sign-in window offers it too, because that is the one screen a person who cannot read the page\'s language still has to pass', () => {
    assert.ok(html.includes('<label class="auth-language">Language<select id="authLanguageSelect"></select></label>'));
    assert.ok(html.indexOf('id="authLanguageSelect"') < html.indexOf('</section>', html.indexOf('id="authError"')), 'inside the card');
    assert.ok(app.includes("$('#authLanguageSelect')?.addEventListener('change',(event)=>{"));
    assert.ok(look.includes('.auth-language{'));
  });

  test('a sign-in card taller than the window is reached by scrolling it', () => {
    assert.ok(read('styles.css').includes('.auth-gate{overflow-y:auto;align-items:safe center}'));
  });

  test('one setting: the select in Settings is the one the translator listens to', () => {
    assert.equal((html.match(/<select id="languageSelect">/g) ?? []).length, 1);
    assert.doesNotMatch(html, /menuLanguageSelect|simpleLanguageSelect/);
  });
});
