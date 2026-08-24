// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The microphone stays open, so the product must be able to tell what was said TO it.
//
// Owner, 2026-08-24, after hearing the deployed voice: *«parla a caso senza chiedere nulla»*.
//
// # What was actually wrong, measured before anything was changed
//
// The microphone is continuous by the Owner's own earlier instruction (*«resti attiva finché non
// la fermo io»*), so every sound in the room reaches the resolver. Driven against the real
// 42-entry list with the real Italian translation, **ten of 45 realistic transcription fragments
// performed a real action**, and the actions were not harmless:
//
//     "no"     -> /sweep        "ok"     -> /revoke      "senti" -> /model
//     "mm"     -> /help         "niente" -> /retention   "come"  -> /divergence
//     "set"    -> /settings     "doc"    -> /documents   "quanto costa" -> /review
//
// Saying "no" to another person in the room ran a sweep. Every one of those matched at `WORD` (5)
// or `SUBSTRING` (6) — the ranks that mean *the phrase is PART of something* — while every
// legitimate phrase measured resolved at `NAME`, `SEGMENT` or `PROSE`. That is the whole fix:
// speech acts only on an exact match, and anything that neither resolves exactly nor looks like a
// request ends the turn in silence.
//
// This defect PREDATES `D-0676`; what `D-0676` changed is that the misfires stopped being silent
// and started talking, which is how the Owner finally heard it.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { AGENT_COMMANDS, MENU_GROUPS } from '../../../apps/shared/coden/agent-commands.js';
import { addressEntries } from '../../../apps/webui-static/coden-view-model.js';
import { translateString } from '../../../apps/webui-static/i18n.js';
import {
  resolveUtterance, addressedToProduct, rankEntries, VoiceIntent, RANK,
} from '../../../apps/webui-static/voice-intent.js';

const ROOT = new URL('../../../', import.meta.url).pathname;
const translate = (value) => { const out = translateString(value, 'it'); return typeof out === 'string' ? out : out.text; };

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

const groupTitles = () => Object.fromEntries(MENU_GROUPS.map((group) => [group.id, group.title]));
/** Exactly what `heardResult()` passes in `app.js` — including the floor. */
const asVoice = () => ({ entries: realEntries(), translate, groupTitles: groupTitles(), actFloor: RANK.PROSE });
/** The pre-fix behaviour, kept so the regression is measurable and not merely described. */
const asMenu = () => ({ entries: realEntries(), translate, groupTitles: groupTitles() });

/** What a speech-to-text engine emits from room noise, a cough, half a word, or two people
 *  talking to each other. Short, plausible, and not addressed to the product. */
const NOISE = [
  'mo', 'me', 'ri', 'co', 'pro', 'set', 'mod', 'ric', 'doc', 'ah', 'eh', 'mm', 'si', 'no', 'ok',
  'allora', 'cioe', 'va bene', 'senti', 'aspetta', 'un attimo', 'no dai', 'ma dai', 'che', 'come',
  'ecco', 'niente', 'boh', 'pronto', 'scusa', 'grazie mille', 'ciao ciao', 'sto arrivando',
  'due minuti', 'hai capito', 'non lo so', 'va be', 'magari', 'forse', 'adesso', 'domani',
  'poi ti dico',
  // The three that STILL react, kept in the list on purpose. Leaving them out would have made
  // this suite report a clean sweep it has not achieved — measuring only what passes is the
  // shape of a false PASS, and it is exactly what this project forbids.
  'quanto costa', 'dove sei',
];

/** Things a person really says to this product. None of these may be lost. */
const REAL = [
  'apri la memoria', 'memoria', 'impostazioni', 'modelli', 'progetti', 'ricerca', 'settings',
  'chat', 'fammi vedere i progetti', 'apri le impostazioni', 'coden', 'flussi di lavoro',
  'quanti test ci sono nel sistema', 'spiegami come funziona la chat', 'chi sei',
  'perche non funzioni', 'che cosa sai fare', 'dimmi lo stato del sistema',
  'controlla se ci sono errori',
];

/** The three-way decision `applyHeardText` makes, reproduced from its parts. */
function decide(said) {
  const result = resolveUtterance(said, asVoice());
  if (result.kind === VoiceIntent.INTENT) return { what: 'acts', line: result.line };
  if (!addressedToProduct(said)) return { what: 'silent' };
  return { what: 'chat' };
}

describe('nothing said in the room may make the product act', () => {
  test('no noise fragment performs an action', () => {
    const acted = NOISE.map((said) => [said, decide(said)]).filter(([, d]) => d.what === 'acts');
    assert.deepEqual(acted.map(([said, d]) => `${said} -> ${d.line}`), [],
      'a fragment that acts is a product doing something nobody asked for');
  });

  // Seen red first, and this is the case that matters most: the ten that used to fire, and the
  // three destructive-sounding ones among them.
  test('the exact fragments that used to fire are proven to have fired before the fix', () => {
    const usedToFire = ['no', 'ok', 'senti', 'mm', 'niente', 'set', 'doc', 'come'];
    const before = usedToFire.filter((said) => resolveUtterance(said, asMenu()).kind === VoiceIntent.INTENT);
    assert.ok(before.length >= 6, `the premise must be real: only ${before.length} of these fired without the floor`);
    const after = usedToFire.filter((said) => resolveUtterance(said, asVoice()).kind === VoiceIntent.INTENT);
    assert.deepEqual(after, [], 'and none of them may fire with it');
  });

  test('"ok" and "no" specifically can no longer run a capability', () => {
    for (const said of ['ok', 'no']) {
      const before = resolveUtterance(said, asMenu());
      assert.equal(before.kind, VoiceIntent.INTENT, `premise: "${said}" used to resolve`);
      assert.match(before.line, /^\/(revoke|sweep)$/, `premise: "${said}" used to reach ${before.line}`);
      assert.equal(resolveUtterance(said, asVoice()).kind, VoiceIntent.NOTHING);
    }
  });

  // The residue is PINNED, not hidden. Asserting "zero" here would have required quietly dropping
  // the fragments that still react, which is measuring only what passes.
  test('the residue is exactly the two fragments no length rule can separate from a real question', () => {
    const reacting = NOISE.filter((said) => decide(said).what !== 'silent').sort();
    assert.deepEqual(reacting, ['dove sei', 'quanto costa'],
      'the known residue changed — re-measure before accepting it');
    // Both are grammatically questions, and "chi sei" is a question of the same shape that MUST
    // reach the chat. Nothing about their length, word count or opener separates them. The honest
    // remedy is a wake word, which is a separate piece of work and is proposed rather than faked;
    // both are harmless (a spoken answer, no action) and neither can touch the installation.
    for (const said of reacting) assert.equal(decide(said).what, 'chat', `${said} must at most talk, never act`);
  });
});

describe('and nothing a person really says is lost', () => {
  test('every real request still acts or still reaches the chat', () => {
    const lost = REAL.filter((said) => decide(said).what === 'silent');
    assert.deepEqual(lost, [], 'a request that goes silent is worse than the noise this fix removes');
  });

  test('every destination phrase still navigates, at an exact rank', () => {
    for (const [said, line] of [
      ['apri la memoria', '/memory'], ['memoria', '/memory'], ['impostazioni', '/settings'],
      ['modelli', '/models'], ['progetti', '/projects'], ['ricerca', '/research'],
      ['settings', '/settings'], ['chat', '/chat'], ['flussi di lavoro', '/workflows'],
      ['fammi vedere i progetti', '/projects'], ['apri le impostazioni', '/settings'],
    ]) {
      const result = resolveUtterance(said, asVoice());
      assert.equal(result.kind, VoiceIntent.INTENT, `"${said}" must still resolve`);
      assert.equal(result.line, line);
      assert.ok(rankEntries(said, realEntries(), translate, groupTitles())[0].rank <= RANK.PROSE,
        `"${said}" must match at an exact rank, or the floor is doing nothing for it`);
    }
  });

  test('a question reaches the chat even when it is short', () => {
    for (const said of ['chi sei', 'che cosa sai fare', 'perche non funzioni']) {
      assert.equal(decide(said).what, 'chat', `"${said}" is addressed to the product`);
    }
  });

  test('an argument-carrying command is unaffected: it already required an exact name', () => {
    const result = resolveUtterance('plan sistema il build', asVoice());
    assert.equal(result.kind, VoiceIntent.INTENT);
    assert.equal(result.argument, 'sistema il build');
  });
});

describe('the floor is a parameter, not a new global rule', () => {
  test('the default is unchanged, so the typed menu keeps partial matching', () => {
    // A menu shows candidates and the person READS them before clicking. Removing partial matches
    // there would make the product harder to use for no safety gain — the danger is acting on
    // something nobody saw, which is a property of the microphone, not of the ladder.
    assert.equal(resolveUtterance('set', asMenu()).kind, VoiceIntent.INTENT);
    assert.equal(resolveUtterance('set', asVoice()).kind, VoiceIntent.NOTHING);
  });
});
