// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The simple interface — 2026-10-06.
//
// Measured on a clean installation that day, a first visit met twelve destinations, about twenty
// controls in the chat, a mode to pick by hand, and a chat that took no word until a conversation
// had been created and titled. The simple interface removes all of that from the first screen.
//
// Two kinds of test, because the module is two kinds of thing. The pure functions are driven
// directly. The markup and the stylesheet are read as text, because what has to stay true there is
// a property of the rules, not of a rendering: the approval strip is never hidden, every hidden
// destination is named once, and nothing uses an inline style the page's CSP would refuse.
//
// What this file cannot see is the page drawing itself. That is the browser suite's, and it is
// driven there by a real browser (tools/browser-e2e.mjs, "simple interface").
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  SIMPLE_KEY, SIMPLE_VIEWS, readSimple, writeSimple, inferChatMode, titleFromMessage, setupTokenFromHash,
  TOOL_ACTIONS, toolActionTitle, describeChange, argumentLines, approvalStrip, friendlyModelName, zoneOffer,
} from '../../../apps/webui-static/simple-mode.js';
import { RUNTIME_ONLY, CATALOGS } from '../../../apps/webui-static/i18n-catalog.js';

const here = dirname(fileURLToPath(import.meta.url));
const STATIC = join(here, '../../../apps/webui-static');
const read = (name) => readFileSync(join(STATIC, name), 'utf8');
const html = read('index.html');
const css = read('styles.css');
const app = read('app.js');

describe('the preference', () => {
  test('simple is the default: nothing stored, an unreadable store, or no store at all', () => {
    assert.equal(readSimple({ getItem: () => null }), true);
    assert.equal(readSimple({ getItem: () => { throw new Error('storage refused'); } }), true);
    assert.equal(readSimple(undefined), true);
  });

  test('only an explicit 0 turns it off', () => {
    assert.equal(readSimple({ getItem: (key) => (key === SIMPLE_KEY ? '0' : null) }), false);
    assert.equal(readSimple({ getItem: () => '1' }), true);
    assert.equal(readSimple({ getItem: () => 'off' }), true, 'a value this code did not write is not a choice');
  });

  test('writing records the choice, and a store that refuses does not throw', () => {
    const seen = [];
    writeSimple({ setItem: (key, value) => seen.push([key, value]) }, false);
    writeSimple({ setItem: (key, value) => seen.push([key, value]) }, true);
    assert.deepEqual(seen, [[SIMPLE_KEY, '0'], [SIMPLE_KEY, '1']]);
    assert.doesNotThrow(() => writeSimple({ setItem: () => { throw new Error('private window'); } }, true));
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

// A CSS rule is `selector{declarations}`; the stylesheet has no nested blocks outside @media, and
// the simple block sits at the top level. Good enough to read a selector list and its body.
function simpleRules() {
  const start = css.indexOf('The simple interface (simple-mode.js)');
  assert.ok(start > 0, 'the simple interface block is in the stylesheet');
  const block = css.slice(start);
  return [...block.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ selector: m[1].replace(/\/\*[\s\S]*?\*\//g, '').trim(), body: m[2] }));
}

describe('the markup and the stylesheet', () => {
  test('the page opens simple, and the chat opens empty', () => {
    assert.match(html, /<body data-ui="simple">/);
    assert.match(html, /<section class="view" id="view-chat" data-empty>/);
  });

  test('the welcome sits in the chat panel, before the message list, with its chips', () => {
    const welcome = html.indexOf('id="simpleWelcome"');
    const list = html.indexOf('id="messageList"');
    const panel = html.indexOf('<section class="panel chat-panel">');
    assert.ok(panel > 0 && panel < welcome && welcome < list);
    const chips = html.slice(welcome, list).match(/data-simple-prompt/g) ?? [];
    assert.ok(chips.length >= 3, `${chips.length} chips`);
  });

  test('the no-model notice sits above the composer, not inside the welcome, so it outlives the first conversation', () => {
    const notice = html.indexOf('id="simpleNoModel"');
    const welcomeEnd = html.indexOf('id="messageList"');
    const composer = html.indexOf('<div class="composer chat-composer">');
    assert.ok(notice > welcomeEnd && notice < composer);
    assert.match(app, /classList\.toggle\('hidden',answers\|\|!simpleOn\)/);
  });

  test('"no model" means no running model AND no enabled provider — a provider the person connected answers through the route', () => {
    assert.match(app, /const enabled=simpleOn&&!loaded\?\(await api\('\/api\/v1\/providers'\)\)\.providers\.filter\(\(item\)=>item\.enabled\)/);
    assert.match(app, /const answers=Boolean\(loaded\)\|\|enabled\.length>0/);
  });

  test('the box names the model that answers, not "none", when a connected provider is the one answering', () => {
    assert.match(app, /loaded\?shortModelName\(loaded\):enabled\[0\]\?\.defaultModel\?shortModelName\(enabled\[0\]\.defaultModel\):t\(simpleOn\?'No AI yet':'none'\)/);
    assert.match(app, /label\.textContent=shortModelName\(model\)/, 'and the wizard sets it at once, without waiting for the next refresh');
  });

  test('the notice that no model is connected starts hidden, and leads to where one is connected', () => {
    const notice = html.match(/<div class="notice hidden" id="simpleNoModel"[^>]*>[\s\S]*?<\/div>/)?.[0];
    assert.ok(notice, 'the notice exists and is hidden until the page knows there is no model');
    // Providers (Settings → Privacy), where a local server or a service is registered — not the
    // catalogue of files, whose "Get" is off on a container install (measured 2026-10-06).
    assert.match(notice, /data-view-link="providers"/);
  });

  test('the switch between the two interfaces is outside the destination list', () => {
    const nav = html.slice(html.indexOf('<nav aria-label="Primary">'), html.indexOf('</nav>', html.indexOf('<nav aria-label="Primary">')));
    assert.ok(!nav.includes('simpleToFull') && !nav.includes('fullToSimple'),
      'a button with class "nav" would be bound to navigate(undefined) at boot; these two are not nav items');
    assert.match(html, /id="simpleToFull"/);
    assert.match(html, /id="fullToSimple"/);
  });

  test('no new markup carries an inline style (the page forbids them)', () => {
    for (const id of ['simpleWelcome', 'simpleToFull', 'fullToSimple', 'simpleNewChat']) {
      const at = html.indexOf(`id="${id}"`);
      assert.ok(at > 0, id);
      const tag = html.slice(html.lastIndexOf('<', at), html.indexOf('>', at));
      assert.ok(!/\sstyle=/.test(tag), id);
    }
    assert.ok(!/class="simple-welcome"[^>]*style=/.test(html));
  });

  test('the sidebar keeps exactly the destinations the module names, each of which exists', () => {
    for (const view of SIMPLE_VIEWS) assert.match(html, new RegExp(`data-view="${view}"`), view);
    const hide = simpleRules().find((r) => r.selector.includes('#sidebar .nav:not('));
    assert.ok(hide, 'the rule that hides the other destinations');
    const kept = [...hide.selector.matchAll(/:not\(\[data-view=([a-z-]+)\]\)/g)].map((m) => m[1]).sort();
    assert.deepEqual(kept, [...SIMPLE_VIEWS].sort(), 'the stylesheet and the module name the same four');
  });

  test('SAFETY: simple mode never hides the approval strip, or anything that asks for a decision', () => {
    for (const rule of simpleRules()) {
      if (!rule.selector.includes('data-ui=simple')) continue;
      assert.ok(!/approval|decision/i.test(rule.selector), `a rule hides something about approvals: ${rule.selector}`);
    }
    assert.ok(html.includes('id="approvalStripOpen"'), 'and the strip is in the page to begin with');
  });

  test('the chat in simple mode hides project, conversation, mode, branch, route and the work panel — and nothing the person types into', () => {
    const hidden = simpleRules().filter((r) => /display:none/.test(r.body)).map((r) => r.selector).join(',');
    for (const part of ['.chat-crumb', '#chatModes', '.chat-chips', '.chat-more', '#chatWorkPanel']) assert.ok(hidden.includes(part), part);
    for (const part of ['#chatInput', '#sendMessage', '.chat-composer', '#messageList']) {
      // #messageList is hidden only while the conversation is empty, by a rule that says so
      if (part === '#messageList') continue;
      assert.ok(!hidden.includes(part), `${part} must stay`);
    }
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

  test('the card is only built in the simple interface, and everything on it goes in as text', () => {
    assert.match(app, /if\(simpleOn\)void describeApproval\(row,data\)/);
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

  test('one row per tool in the simple interface: the "running" row is set aside and the card gets the outcome', () => {
    assert.match(app, /approvalRow=renderToolApproval\(article,data\);/);
    assert.match(app, /if\(simpleOn&&approvalRow&&toolRow\)toolRow\.classList\.add\('superseded'\)/);
    assert.match(app, /if\(simpleOn&&approvalRow\)\{approvalRow\.classList\.remove\('awaiting'\);resolveToolActivity\(approvalRow,data\);approvalRow=null;\}/);
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
describe('the bottom strip counts what waits in the chat', () => {
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
    assert.match(refreshCode, /Approvals: unavailable/, 'an unreadable queue is not shown as "0 waiting"');
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

  test('no simple-mode rule hides the strip or its button (the safety test above covers the stylesheet; this covers the markup)', () => {
    assert.ok(html.includes('id="approvalStripOpen"'));
    assert.ok(!/approvalStrip[^>]*\bhidden\b/.test(html), 'the strip is never hidden by the markup');
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
describe('the welcome suggestions', () => {
  const chips = [...html.matchAll(/<button type="button" class="secondary" data-simple-prompt(?: data-prompt-text="[^"]*")?>([^<]+)<\/button>/g)].map((m) => m[1]);

  test('there are four, each translated', () => {
    assert.equal(chips.length, 4);
    for (const chip of chips) assert.ok(typeof CATALOGS.it[chip] === 'string' && CATALOGS.it[chip] !== chip, `not translated: ${chip}`);
  });

  test('none promises file work, a search or a folder: nothing behind those exists yet', () => {
    for (const chip of chips) {
      for (const text of [chip, CATALOGS.it[chip]]) {
        assert.ok(!/\b(pdf|folder|cartella|merge|unisci|research|ricerca|cerca|search|files?|convert|converti)\b/i.test(text), `promises what no tool does: ${text}`);
      }
    }
  });

  test('clicking one never starts an acting turn: in the language the box will hold, none reads as an action', () => {
    for (const chip of chips) {
      assert.notEqual(inferChatMode(chip), 'ACT', chip);
      assert.notEqual(inferChatMode(CATALOGS.it[chip]), 'ACT', CATALOGS.it[chip]);
    }
  });
});

describe('the default-password banner, for a person who has just signed in with the installer\'s account', () => {
  const start = app.indexOf("let banner=$('#defaultPasswordBanner');");
  const bannerCode = app.slice(start, app.indexOf('}else if(banner){banner.remove();}', start));
  const changeCode = app.slice(app.indexOf("$('#securityPasswordForm').addEventListener('submit'"), app.indexOf('function renderMfaEnrolment('));

  test('the banner code is found, and it builds its text and link with the DOM, not with markup', () => {
    assert.ok(start > 0 && bannerCode.includes("banner.id='defaultPasswordBanner'"));
    assert.ok(!/innerHTML/.test(bannerCode));
  });

  test('it says it in the person\'s language and links straight to the form that changes the password', () => {
    assert.match(bannerCode, /t\('This account is still using the default password\.'\)/);
    assert.match(bannerCode, /link\.href='#settings\/security'/);
    assert.match(bannerCode, /link\.textContent=t\('Change it now'\)/);
    assert.match(app, /security:'settings\/security'/, 'and that address is a route that exists');
    assert.ok(html.includes('id="securityPasswordForm"'), 'with the form on that page');
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
  test('the module is imported and the preference is read before anything paints', () => {
    assert.match(app, /from '\.\/simple-mode\.js'/);
    const read = app.indexOf('const simpleOn=readSimple(localStorage)');
    const call = app.lastIndexOf('initRouter();');
    assert.ok(read > 0 && call > read, 'simpleOn is bound before the line that starts painting (D-0416)');
  });

  test('a setup token in the address is taken out before the router reads the hash as a route', () => {
    const take = app.indexOf('const setupLinkToken=setupTokenFromHash(location.hash)');
    const call = app.lastIndexOf('initRouter();');
    assert.ok(take > 0 && take < call);
    assert.match(app, /history\.replaceState\(null,'',location\.pathname\+location\.search\)/);
  });

  test('an empty address lands on the chat in simple mode and on Home otherwise', () => {
    assert.match(app, /if\(!first\)return\{view:simpleOn\?'chat':'home'/);
  });

  test('a first message creates the conversation only in simple mode, and the mode is inferred only there', () => {
    assert.match(app, /if\(!state\.activeConversationId&&!\(simpleOn&&await ensureConversation\(\)\)\)/);
    assert.match(app, /mode:simpleOn\?inferChatMode\(content\):currentMode/);
  });

  test('a failed send in simple mode is shown as an alert and gives the message back, only when nothing was answered', () => {
    assert.match(app, /if\(simpleOn\)\{if\(!assistantText\)\$\('#chatInput'\)\.value=content;toast\(/);
  });

  test('"no model" is told in the welcome\'s own words, which the catalogue already translates', () => {
    assert.match(app, /No enabled model provider\/i\.test\(error\.message\)\?t\('NOESAR needs an AI to answer\.'\)/);
    assert.match(html, /<b>NOESAR needs an AI to answer\.<\/b>/, 'the sentence exists in the markup, so it is covered by the translation check');
  });

  test('the menu button has two states in simple mode and keeps its three in the full interface', () => {
    assert.match(app, /simpleOn\?\(current==='full'\?'hidden':'full'\):SIDEBAR_RANKS\[/);
    assert.match(app, /const fallback=simpleOn\?'hidden':'full'/);
  });

  test('the project a first message creates is named through t(), which RUNTIME_ONLY declares', () => {
    assert.match(app, /name:t\('My things'\)/);
    assert.ok(RUNTIME_ONLY.includes('My things'), 'declared runtime-only');
    assert.equal(CATALOGS.it['My things'], 'Le mie cose', 'and translated');
  });
});

// The register the assistant speaks in follows the interface the person chose; see
// assistant-identity.test.mjs for what the server does with it.
describe('who the assistant is told it is talking to', () => {
  test('a message from the simple interface says so, and one from the full interface says that', () => {
    assert.match(app, /audience:simpleOn\?'everyday':'operator'/);
    const sendChat = app.slice(app.indexOf('async function sendChat('), app.indexOf("$('#sendMessage').addEventListener('click'"));
    assert.ok(sendChat.includes("audience:simpleOn?'everyday':'operator'"), 'inside the one request sendChat makes');
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

  test('the model button says it the same way in the simple interface, and keeps the compact form in the full one', () => {
    assert.match(app, /function shortModelName\(id\)\{[^}]*if\(simpleOn\)return friendlyModelName\(id\);/);
  });

  test("a suggestion that needs the person's words writes the start of the sentence and leaves the cursor below it", () => {
    // inside the chip handler only: the same call exists elsewhere in the file, so a looser check would pass without it
    const chipCode = app.slice(app.indexOf("$$('[data-simple-prompt]')"), app.indexOf('// Choosing a destination closes the menu again'));
    assert.ok(chipCode.length > 100 && chipCode.length < 1200, 'the handler is found, and only the handler');
    assert.ok(chipCode.includes('const open=chip.dataset.promptText;'));
    assert.ok(chipCode.includes('box.value=open?`${t(open)}\\n\\n`:chip.textContent.trim();'));
    assert.ok(chipCode.includes('box.setSelectionRange(box.value.length,box.value.length)'), 'the cursor goes below the sentence');
    const prompts = [...html.matchAll(/data-prompt-text="([^"]*)"/g)].map((m) => m[1]);
    assert.equal(prompts.length, 2, "the two that ask for the person's own text");
    for (const prompt of prompts) {
      assert.ok(prompt.endsWith(':'), `ends where the person goes on: ${prompt}`);
      assert.ok(RUNTIME_ONLY.includes(prompt), `not declared runtime-only: ${prompt}`);
      assert.ok(typeof CATALOGS.it[prompt] === 'string' && CATALOGS.it[prompt] !== prompt, `not translated: ${prompt}`);
      assert.notEqual(inferChatMode(CATALOGS.it[prompt]), 'ACT', 'and none reads as an action');
    }
  });

  test('"no AI", "nothing to approve" and the status line are in the person\'s language', () => {
    for (const phrase of ['No AI yet', 'Nothing to approve', 'Response completed.', 'Generation stopped.']) {
      assert.ok(RUNTIME_ONLY.includes(phrase), `not declared runtime-only: ${phrase}`);
      assert.ok(typeof CATALOGS.it[phrase] === 'string' && CATALOGS.it[phrase] !== phrase, `not translated: ${phrase}`);
    }
    assert.ok(app.includes("function setStatus(message,error=false){$('#statusMessage').textContent=t(message);"));
  });

  test('with nothing waiting the simple strip is one quiet phrase and keeps its button; the moment anything waits it is the full strip', () => {
    const paint = app.slice(app.indexOf('function paintApprovalStrip('), app.indexOf("$('#approvalStripOpen')?.addEventListener"));
    assert.ok(paint.includes('const calm=simpleOn&&view.total===0;'), 'only in the simple interface, and only at zero');
    assert.ok(paint.includes("if(calm)strip.textContent=t('Nothing to approve');else setChip(strip,'Approvals:','Approvals: —',view.total);"));
    assert.ok(!/classList\.toggle\('hidden'/.test(paint), 'nothing in the strip is hidden by its own state: the browser suite measures the strip by this button');
    assert.ok(paint.includes("view.total===0?(calm?'':'Nothing is waiting for a decision.'):view.detail"));
  });

  test('an answer can be copied, and when the browser refuses the person is told how to do it by hand', () => {
    assert.ok(app.includes('data-copy-message="${message.id}">Copy</button>'), 'on assistant messages only');
    const renderLine = app.slice(app.indexOf('function renderMessages('), app.indexOf('function renderMessages(') + 2600);
    assert.ok(renderLine.indexOf("message.role==='assistant'?") < renderLine.indexOf('data-copy-message'), 'inside the assistant-only part');
    const bind = app.slice(app.indexOf("$$('[data-copy-message]')"), app.indexOf("$$('[data-copy-message]')") + 900);
    assert.ok(bind.includes("navigator.clipboard.writeText(message?.content??'')"));
    assert.ok(bind.includes("catch{toast(t('Could not copy. Select the text and copy it by hand.'),{kind:'error'});}"), 'a refusal is said, not swallowed');
    for (const phrase of ['Copy', 'Copied.', 'Could not copy. Select the text and copy it by hand.', 'Retry']) {
      assert.ok(RUNTIME_ONLY.includes(phrase), `not declared runtime-only: ${phrase}`);
      assert.ok(typeof CATALOGS.it[phrase] === 'string' && CATALOGS.it[phrase] !== phrase, `not translated: ${phrase}`);
    }
  });

  test("under an answer the simple interface keeps Copy and Retry and drops the engineer's gestures", () => {
    assert.ok(css.includes('body[data-ui=simple] .message.assistant [data-fork-message],'));
    assert.ok(css.includes('body[data-ui=simple] [data-exclude-message],'));
    assert.ok(css.includes('body[data-ui=simple] .message.assistant [data-edit-message]{display:none}'));
    assert.ok(!css.includes('[data-copy-message]{display:none}') && !css.includes('[data-retry-message]{display:none}'), 'Copy and Retry stay');
  });

  test('Settings shows four doors in the simple interface: the sections that stay are named, every other one is hidden once, and none is lost', () => {
    const menu = [...html.matchAll(/<button class="settings-nav[^"]*" type="button" data-section="([a-z-]+)"/g)].map((m) => m[1]);
    assert.equal(menu.length, 16, 'the full menu still has all sixteen');
    const kept = ['appearance', 'language', 'security', 'models-hardware'];
    const hidden = menu.filter((name) => !kept.includes(name));
    assert.equal(hidden.length, 12);
    for (const name of hidden) assert.ok(css.includes(`body[data-ui=simple] .settings-nav[data-section=${name}]`), `not hidden in the simple interface: ${name}`);
    for (const name of kept) assert.ok(!css.includes(`.settings-nav[data-section=${name}]`), `a kept door is hidden by a rule: ${name}`);
    assert.ok(css.includes('body[data-ui=simple] .settings-menu .settings-group{display:none}'));
    // the password banner sends people to Security, which therefore has to stay in the menu
    assert.ok(kept.includes('security') && app.includes("link.href='#settings/security'"));
  });

  test('a bare settings address lands on a section the simple menu shows, and the full interface lands where it always did', () => {
    assert.ok(app.includes("const wanted=SETTINGS_SECTIONS.includes(requested)?requested:simpleOn?'appearance':DEFAULT_SECTION;"));
    assert.ok(app.includes("const DEFAULT_SECTION='sessions';"), 'the full interface default is untouched');
  });

  test('on a narrow window the open menu is the four destinations with their names, and the history is not squeezed into a row of icons', () => {
    const narrow = css.slice(css.lastIndexOf('@media(max-width:850px){\n  body[data-ui=simple] #chatNav{display:none}'));
    assert.ok(narrow.startsWith('@media(max-width:850px){'), 'the block is found');
    assert.ok(narrow.includes('body[data-ui=simple] #chatNav{display:none}'));
    assert.ok(narrow.includes('body[data-ui=simple] .nav span:not(.nav-count){position:static;width:auto;height:auto'), 'the labels are drawn');
    assert.ok(narrow.includes('body[data-ui=simple] .sidebar nav{flex-wrap:wrap}'));
    assert.ok(!/approv/i.test(narrow), 'and nothing here touches the approval strip');
  });

  test('an answer can be saved as a document from the chat (simple interface only), titled by what the person asked', () => {
    assert.ok(app.includes('${simpleOn?`<button data-save-message="${message.id}">Save this answer</button>`:\'\'}'), 'the button is drawn only in the simple interface');
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
    assert.ok(list.includes("${simpleOn?'Edit':'New version'}"), 'the full interface still says New version');
    assert.ok(list.includes("(simpleOn?t('No documents yet. When an answer is worth keeping, press Save under it.'):'No documents.')"));
    // The markup starts the list as "empty-state" (text centred, 20px padding). A list that is never told it is no longer
    // empty draws every letter and every table centred, in both interfaces (seen on a live page, 2026-10-08).
    assert.ok(list.startsWith("function renderArtifacts(){$('#artifactList').classList.toggle('empty-state',state.artifacts.length===0);"), 'the list stops being "empty" once it holds a document');
    assert.ok(html.includes('id="artifactList" class="card-list empty-state"'), 'and this is why it has to be done: the markup starts it empty');
    assert.ok(list.includes("catch{toast(t('Could not copy. Select the text and copy it by hand.'),{kind:'error'});}"));
  });

  test('the simple interface hides the document form and the jargon next to the list, and nothing else about the page', () => {
    assert.ok(css.includes('body[data-ui=simple] #artifactForm{display:none}'));
    assert.ok(css.includes('body[data-ui=simple] #view-documents .two-col{grid-template-columns:1fr}'));
    assert.ok(css.includes('body[data-ui=simple] #artifactList small,\nbody[data-ui=simple] #view-documents .panel-title span{display:none}'));
    assert.ok(html.includes('id="artifactForm"'), 'the form is still in the page: the full interface uses it');
  });

  test('the project form asks a person for a name, a purpose and the rules; the technical fields stay in the page with their defaults', () => {
    for (const id of ['projectTags', 'projectKnowledgeMode', 'projectKnowledgeLimit']) {
      assert.ok(css.includes(`body[data-ui=simple] #projectForm label:has(#${id})`), `not hidden in the simple interface: ${id}`);
      assert.ok(html.includes(`id="${id}"`), `removed from the page: ${id} (the full interface and the form handler read it)`);
    }
    for (const id of ['projectName', 'projectDescription', 'projectInstructions']) assert.ok(!css.includes(`#projectForm label:has(#${id})`), `a field a person needs is hidden: ${id}`);
    assert.ok(html.includes('<option value="hybrid">Hybrid RAG</option>') && html.includes('id="projectKnowledgeLimit" type="number" min="1" max="50" value="8"'), 'the defaults the hidden fields submit');
  });

  test('the stylesheet names the undo button, drops the English badge and keeps the box in reach on a narrow window', () => {
    assert.ok(css.includes('body[data-ui=simple] #undoHead::after{content:attr(title)'));
    assert.ok(css.includes('body[data-ui=simple] .footer-privacy .verified{display:none}'));
    assert.match(css, /@media\(max-width:850px\)\{\s*body\[data-ui=simple\] \.chat-composer\{position:sticky;bottom:46px/);
    assert.ok(css.includes('body[data-ui=simple] .main:has(#view-chat.active){overflow:visible}'), 'main must not be a scroll container of its own there, or sticky sticks to it');
    assert.ok(css.includes('body[data-ui=simple] .model-switch small{max-width:22ch;direction:ltr}'), 'the name is not cut from its start');
    assert.ok(css.includes('body[data-ui=simple] #sidebar nav #chatNav{order:5}'), 'the destinations come before the history');
    const block = css.slice(css.indexOf('/* ── plain words and a quiet screen'));
    const rules = block.slice(block.indexOf('*/') + 2);
    assert.ok(!/approv/i.test(rules), 'no rule in this block mentions approvals: the strip is never hidden or restyled here');
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
  test('the offer is drawn only in the simple interface, by a button the person presses, with the same PUT as Settings', () => {
    assert.ok(wiring.includes('paintZoneOffer(settings);'), 'every load of the zone repaints the offer');
    assert.ok(wiring.includes("const zone=simpleOn?zoneOffer(settings):'';"), 'simple interface only, and only what zoneOffer returns');
    assert.ok(wiring.includes("if(!zone){bar?.remove();return;}"), 'the line goes away once it no longer applies');
    assert.ok(wiring.includes("await api('/api/v1/settings/timezone',{method:'PUT',body:JSON.stringify({timezone:zone})});"), 'the person\'s own choice, audited by the server like any other');
    assert.ok(wiring.includes('await loadEffectiveZone();await refreshWorkspace();'), 'and the times on the page change at once');
    assert.ok(!/innerHTML/.test(wiring.slice(wiring.indexOf('function paintZoneOffer('))), 'built with the DOM: the zone name comes from the browser');
    assert.ok(!/style\.cssText|style=/.test(wiring), 'no inline style');
    assert.ok(css.includes('body[data-ui=simple] #zoneBanner{'), 'drawn by the stylesheet');
  });

  test('its three sentences are declared runtime-only and translated', () => {
    for (const phrase of ['Times are shown in UTC.', 'Your computer is in', 'Use the time on my computer']) {
      assert.ok(RUNTIME_ONLY.includes(phrase), `not declared runtime-only: ${phrase}`);
      assert.ok(typeof CATALOGS.it[phrase] === 'string' && CATALOGS.it[phrase] !== phrase, `not translated: ${phrase}`);
    }
  });
});
