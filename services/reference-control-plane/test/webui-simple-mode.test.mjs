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
  TOOL_ACTIONS, toolActionTitle, describeChange, argumentLines, approvalStrip,
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
    assert.match(app, /loaded\?shortModelName\(loaded\):enabled\[0\]\?\.defaultModel\?shortModelName\(enabled\[0\]\.defaultModel\):t\('none'\)/);
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
    assert.match(app, /No enabled model provider\/i\.test\(error\.message\)\?t\('NOESAR needs a model to answer\.'\)/);
    assert.match(html, /<b>NOESAR needs a model to answer\.<\/b>/, 'the sentence exists in the markup, so it is covered by the translation check');
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
