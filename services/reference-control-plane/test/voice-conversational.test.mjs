// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The voice answers like something you are talking to, not like a remote control.
//
// Owner, 2026-08-24: *«la voce deve fare quello che chiedo in modo naturale stile jarvis»*.
//
// # The premise, corrected by measuring it
//
// This suite was going to be about the voice HIJACKING natural speech into menu navigation. Driven
// against the real 42-entry list with the real Italian translation, that premise was mostly wrong
// and is recorded here rather than quietly dropped: pure navigation requests resolve **correctly**
// (*"apri la memoria"*, *"fammi vedere i progetti"*, *"impostazioni"* all navigate, which is what
// was asked). The resolver is exact-or-containing with no fuzzy matching and it does its job.
//
// Two real defects survived the correction, and they are what this suite pins:
//
//   1. **The product acted in silence.** A performed command returned `reply:''`, and
//      `VoiceSession` treats an empty reply as nothing to say — so the page moved and the room
//      stayed quiet. The acknowledgement existed, as a VISUAL note, which is no use to the person
//      hands-free voice is for.
//   2. **A compound request lost half of itself.** *"apri la memoria e dimmi cosa c'è dentro"*
//      resolves to NOTHING — no handle matches the whole sentence — so the navigation was dropped
//      and only the question survived.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { AGENT_COMMANDS, MENU_GROUPS } from '../../../apps/shared/coden/agent-commands.js';
import { addressEntries } from '../../../apps/webui-static/coden-view-model.js';
import { translateString } from '../../../apps/webui-static/i18n.js';
import { resolveUtterance, resolveCompound, VoiceIntent, VoiceDisposition } from '../../../apps/webui-static/voice-intent.js';

const ROOT = new URL('../../../', import.meta.url).pathname;

// The page's own translate, unwrapped. `translateString` returns `{text, translated}` — passing it
// raw produces handles built from objects, every one of which matches nothing. That mistake made
// an earlier measurement of this exact question report 1/20 instead of 9/20, which is why the
// fixture builds the translate the same way the page does rather than approximating it.
const translate = (value) => { const out = translateString(value, 'it'); return typeof out === 'string' ? out : out.text; };

/** The real address book, read from the markup's own nav attributes — the same source
 *  `addressBook()` reads at runtime, so the entry list is the product's, not a stand-in. */
function realEntries() {
  const html = readFileSync(`${ROOT}apps/webui-static/index.html`, 'utf8');
  const book = [];
  for (const match of html.matchAll(/<button[^>]*class="[^"]*\bnav\b[^"]*"[^>]*data-view="([^"]+)"[^>]*>([\s\S]*?)<\/button>/g)) {
    const label = (match[2].match(/<span(?![^>]*nav-count)(?![^>]*nav-flag)[^>]*>([^<]+)<\/span>/)?.[1] ?? '').trim();
    if (label) book.push({ address: match[1], kind: 'Page', label });
  }
  assert.ok(book.length >= 10, `the address book fixture must be real, found ${book.length}`);
  return [...AGENT_COMMANDS, ...addressEntries(book)];
}

const options = () => ({
  entries: realEntries(), translate,
  groupTitles: Object.fromEntries(MENU_GROUPS.map((group) => [group.id, group.title])),
});

/* ---- what already worked, pinned so the compound change cannot break it ---- */

test('a plain navigation request still navigates, in Italian', () => {
  for (const [said, address] of [
    ['apri la memoria', 'memory'], ['memoria', 'memory'], ['fammi vedere i progetti', 'projects'],
    ['impostazioni', 'settings'], ['apri le impostazioni', 'settings'], ['modelli', 'models'],
    ['ricerca', 'research'],
  ]) {
    const result = resolveUtterance(said, options());
    assert.equal(result.kind, VoiceIntent.INTENT, `"${said}" should resolve`);
    assert.equal(result.disposition, VoiceDisposition.NAVIGATE);
    assert.equal(result.line, `/${address}`, `"${said}" should reach /${address}`);
  }
});

test('ordinary conversation is left alone — it must reach the chat, not a menu', () => {
  for (const said of [
    'ciao come stai', 'chi sei', 'grazie', 'che cosa sai fare?',
    'quanti test ci sono nel sistema?', 'perché non funzioni?', 'spiegami come funziona la chat',
  ]) {
    assert.equal(resolveUtterance(said, options()).kind, VoiceIntent.NOTHING, `"${said}" must not be taken for a command`);
  }
});

/* ---- the compound request ---- */

test('"apri la memoria e dimmi cosa c\'è dentro" is BOTH a navigation and a question', () => {
  const said = 'apri la memoria e dimmi cosa c’è dentro';
  // The premise, asserted rather than described: the whole sentence resolves to nothing today.
  assert.equal(resolveUtterance(said, options()).kind, VoiceIntent.NOTHING);

  const compound = resolveCompound(said, options());
  assert.ok(compound, 'the sentence must split');
  assert.equal(compound.intent.line, '/memory');
  assert.equal(compound.intent.disposition, VoiceDisposition.NAVIGATE);
  assert.equal(compound.tail, 'dimmi cosa c’è dentro');
});

test('the conjunctions a person actually uses, in both languages', () => {
  for (const [said, line, tail] of [
    ['apri la memoria e poi dimmi cosa contiene', '/memory', 'dimmi cosa contiene'],
    ['vai ai progetti e riassumili', '/projects', 'riassumili'],
    ['open settings and tell me what is configured', '/settings', 'tell me what is configured'],
    ['open settings then explain them', '/settings', 'explain them'],
  ]) {
    const compound = resolveCompound(said, options());
    assert.ok(compound, `"${said}" must split`);
    assert.equal(compound.intent.line, line);
    assert.equal(compound.tail, tail);
  }
});

test('"e poi" is tried before the "e" inside it', () => {
  const compound = resolveCompound('apri la memoria e poi spiegami', options());
  assert.equal(compound.tail, 'spiegami', 'splitting on the bare "e" would leave "poi spiegami"');
});

/* ---- and the reason splitting on " e " is safe in Italian ---- */

test('a sentence that merely CONTAINS "e" is not split', () => {
  for (const said of [
    'parlami di gatti e cani',
    'spiegami la differenza fra memoria e conoscenza',
    'ciao come stai e tu',
  ]) {
    assert.equal(resolveCompound(said, options()), null, `"${said}" must stay one conversational turn`);
  }
});

test('a compound whose tail is empty or filler is not a compound', () => {
  for (const said of ['apri la memoria e', 'apri la memoria e poi', 'apri la memoria e   ']) {
    assert.equal(resolveCompound(said, options()), null);
  }
});

test('a head that resolves ambiguously does not act on a guess', () => {
  // The head must resolve UNIQUELY, by the same rule as any other utterance. Anything else and a
  // near miss starts acting, which is exactly what `rankEntries` refuses to do.
  const compound = resolveCompound('qualcosa di inesistente e dimmi altro', options());
  assert.equal(compound, null);
});

test('an empty or whitespace utterance is not a compound', () => {
  for (const said of ['', '   ', null, undefined]) assert.equal(resolveCompound(said, options()), null);
});

/* ---- the silence defect, pinned at the contract the page relies on ---- */

// `applyHeardText` lives in app.js, which needs a DOM. What is checkable here without one is the
// contract it depends on: the acknowledgement is a non-empty string for every performed intent,
// because `VoiceSession` speaks `reply` and treats '' as nothing to say. If this ever returned an
// empty string the product would go silent again with no test noticing.
test('every performed intent has something sayable to say', async () => {
  const { utteranceReply } = await import('../../../apps/webui-static/voice-intent.js');
  for (const said of ['apri la memoria', 'impostazioni', 'modelli']) {
    const result = resolveUtterance(said, options());
    const spoken = utteranceReply(result, translate);
    assert.equal(typeof spoken, 'string');
    assert.ok(spoken.trim().length > 0, `"${said}" must produce a spoken acknowledgement, not silence`);
  }
});

// Found by running the resolver against the bytes the LIVE installation serves, not by review: the
// acknowledgement said "Vado a memory". Correct enough as a visual note beside a nav item already
// reading "Memoria"; wrong the moment an Italian voice pronounces it, because it names the
// destination by a word the person has never seen.
test('the destination is spoken by its translated label, not by its slug', async () => {
  const { utteranceReply } = await import('../../../apps/webui-static/voice-intent.js');
  for (const [said, expected] of [['apri la memoria', 'Vado a Memoria'], ['impostazioni', 'Vado a Impostazioni'], ['modelli', 'Vado a Modelli']]) {
    assert.equal(utteranceReply(resolveUtterance(said, options()), translate), expected);
  }
});

// The regression this suite exists to prevent, stated against app.js's own source: the performed
// branch must return the acknowledgement as `reply`, never ''. Source-text assertions are used
// elsewhere in this tree for exactly this shape of claim about a DOM file.
test('app.js returns the acknowledgement as the spoken reply, not an empty string', () => {
  const source = readFileSync(`${ROOT}apps/webui-static/app.js`, 'utf8');
  const branch = source.slice(source.indexOf('async function applyHeardText'), source.indexOf('async function applyHeardText') + 2600);
  assert.match(branch, /return \{reply:said,reason:direct\.kind===VoiceIntent\.INTENT\?'performed':'not-a-command'\}/,
    'the performed branch must speak what it did');
  assert.doesNotMatch(branch, /return \{reply:'',reason:direct\.kind/, 'the silent return must not come back');
  assert.match(branch, /resolveCompound\(text,\{entries:codenOffered\(\)/, 'the compound path must use the SAME entry list as the direct path');
});
