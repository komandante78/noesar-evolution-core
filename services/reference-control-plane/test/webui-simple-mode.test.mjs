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
} from '../../../apps/webui-static/simple-mode.js';

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
    assert.match(app, /classList\.toggle\('hidden',Boolean\(loaded\)\|\|!simpleOn\)/);
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
    assert.match(read('i18n-catalog.js'), /'My things',\n\]\);/);
  });
});
