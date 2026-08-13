// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The voice resolver, driven against the product's REAL address space.
//
// Not a fixture. `buildCodenAddressBook` reads the same `index.html` the browser is served and
// `AGENT_COMMANDS` is the registry both shells resolve typing against, so every assertion below
// is made about the thing that ships. That choice is the direct lesson of `D-0354` (s335): four
// suites were green over a terminal that could not accept a single keystroke, because each of
// them injected a double, and the state that broke the product was not expressible in the double.
// A voice resolver whose whole claim is "it reaches whatever the product has" cannot be tested
// against a list of four pretend entries — the claim is about the real list or it is about
// nothing.
//
// The properties defended here, in order of how much they would cost to get wrong:
//
//   1. Speech cannot reach anything typing cannot. Every line this produces is a line the prompt
//      would have accepted from a keyboard.
//   2. It never picks between candidates. Ambiguity comes back as a question.
//   3. A command that RUNS is never assembled out of a substring of somebody else's description.
//   4. The subject handed to a command is the speaker's own words, not the matcher's leftovers.

import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildCodenAddressBook } from '../src/coden-address-book.mjs';
import { AGENT_COMMANDS, MENU_GROUPS, parseCommandPrompt } from '../../../apps/shared/coden/agent-commands.js';
import { addressEntries } from '../../../apps/webui-static/coden-view-model.js';
import { CATALOGS } from '../../../apps/webui-static/i18n-catalog.js';
import {
  FILLER, VoiceIntent, VoiceDisposition, GROUP_RANK,
  normalise, contentWords, termsFor, rankEntries, destinationOf, resolveUtterance, utteranceReply,
} from '../../../apps/webui-static/voice-intent.js';

const here = dirname(fileURLToPath(import.meta.url));
const webRoot = join(here, '../../../apps/webui-static');

const addresses = buildCodenAddressBook(webRoot);
const entries = [...AGENT_COMMANDS, ...addressEntries(addresses)];
const groupTitles = Object.fromEntries(MENU_GROUPS.map((group) => [group.id, group.title]));
const italian = (text) => CATALOGS.it[text] ?? text;

const hear = (utterance, translate = italian) =>
  resolveUtterance(utterance, { entries, translate, groupTitles });

describe('the list it resolves against is the product\'s own', () => {
  test('the real address book and command registry both arrived', () => {
    // A guard on the fixture, not on the product: if `index.html` ever stops parsing, every
    // assertion below would pass over an empty list and prove nothing at all. That failure mode
    // — a suite that is green because it measured nothing — is the one this file cannot have.
    assert.ok(addresses.length > 40, `only ${addresses.length} addresses were parsed`);
    assert.ok(AGENT_COMMANDS.length > 25);
    assert.ok(entries.length > 80);
  });
});

describe('speech reaches what typing reaches, and nothing else', () => {
  // THE central property. Every line this resolver can produce is fed back through the prompt's
  // own parser and looked up in the same array `planTurn` resolves against. If it resolves,
  // voice has asked for something a keyboard could have asked for; if it does not, voice has
  // invented a capability, which is the one outcome `D-0123` forbids outright.
  const resolvesLikeTyping = (line) => {
    const parsed = parseCommandPrompt(line);
    assert.ok(parsed, `${JSON.stringify(line)} is not even shaped like a prompt line`);
    return entries.some((entry) => entry.name === parsed.word);
  };

  test('every address in the product is reachable by its own address', () => {
    const unreachable = [];
    for (const entry of addresses) {
      const result = hear(entry.address);
      if (result.kind !== VoiceIntent.INTENT) { unreachable.push(`${entry.address} → ${result.kind}`); continue; }
      if (!resolvesLikeTyping(result.line)) unreachable.push(`${entry.address} → ${result.line} resolves to nothing`);
    }
    assert.deepEqual(unreachable, [], 'addresses the microphone cannot reach');
  });

  test('every command in the product is reachable by its own name', () => {
    const unreachable = [];
    for (const command of AGENT_COMMANDS) {
      const result = hear(command.name);
      if (result.kind !== VoiceIntent.INTENT) { unreachable.push(`/${command.name} → ${result.kind}`); continue; }
      assert.ok(resolvesLikeTyping(result.line));
      if (destinationOf(result.entry) !== destinationOf(command)) {
        unreachable.push(`/${command.name} → landed on ${result.entry.name}`);
      }
    }
    assert.deepEqual(unreachable, [], 'commands the microphone sends somewhere else');
  });

  test('no utterance can produce a line the prompt would not resolve', () => {
    // Driven over every label, every summary and a handful of shapes a person actually says,
    // rather than over a written list of phrases — the point is that NO input reaches a line
    // typing could not, so the input set has to be wide enough to be worth the claim.
    const spoken = [
      ...addresses.map((entry) => entry.label),
      ...addresses.map((entry) => italian(entry.label)),
      ...AGENT_COMMANDS.map((command) => command.summary),
      ...AGENT_COMMANDS.map((command) => italian(command.summary)),
      'apri la memoria', 'vai ai documenti', 'plan fix the broken login', 'search getUser',
      'nonsense parola inventata', '', '   ', 'the', 'apri il', '////', '/plan', 'plan',
    ];
    for (const utterance of spoken) {
      const result = hear(utterance);
      if (result.kind !== VoiceIntent.INTENT) continue;
      assert.ok(resolvesLikeTyping(result.line),
        `${JSON.stringify(utterance)} produced ${JSON.stringify(result.line)}, which the prompt does not resolve`);
    }
  });
});

describe('it speaks Italian by reading the product, not a second vocabulary', () => {
  test('every destination is reachable by the Italian the interface paints for it', () => {
    const unreachable = [];
    for (const entry of addresses) {
      const localised = italian(entry.label);
      if (localised === entry.label) continue; // nothing to say in Italian that is not English
      const result = hear(localised);
      // Reached, or a question naming it. Both are correct: several destinations legitimately
      // share a word, and asking is the designed answer to that — landing on the WRONG one, or
      // on nothing at all, is not.
      const reached = result.kind === VoiceIntent.INTENT
        && destinationOf(result.entry) === `address:${entry.address}`;
      const offered = result.kind === VoiceIntent.AMBIGUOUS
        && result.candidates.some((candidate) => destinationOf(candidate) === `address:${entry.address}`);
      if (!reached && !offered) unreachable.push(`${entry.address} ("${localised}") → ${result.kind}`);
    }
    assert.deepEqual(unreachable, [], 'destinations an Italian speaker cannot ask for');
  });

  test('the terms come from the catalogue, so removing the translator removes the Italian', () => {
    // The dependency stated as a failure: with no translator injected, the Italian handles are
    // gone. This is what proves the Italian is DERIVED rather than written into this file.
    const withCatalogue = termsFor({ name: 'memory', summary: 'Memory' }, italian);
    const without = termsFor({ name: 'memory', summary: 'Memory' });
    assert.ok(withCatalogue.includes('memoria'));
    assert.ok(!without.includes('memoria'));
  });

  test('a group heading answers only where nothing else did', () => {
    // `/approvals` is the measured case: s328 added it with no nav button, so it has no label
    // and its only Italian is a sentence nobody says. Its group is titled APPROVAZIONI.
    const result = hear('approvazioni');
    assert.equal(result.kind, VoiceIntent.INTENT);
    assert.equal(result.entry.name, 'approvals');

    // And it must not be able to outrank a real name. Ranked last by construction: an entry that
    // matches on its own name beats one that only shares a room with it.
    const named = rankEntries('memory', entries, italian, groupTitles);
    assert.ok(named.length > 0);
    assert.ok(named[0].rank < GROUP_RANK, 'a name match came back no better than a group match');
  });
});

describe('it never guesses', () => {
  test('a word that names several things comes back as a question, not a pick', () => {
    // "Progetti" is the Italian label of TWO different places: the Projects page in the sidebar
    // and the Projects panel of the CodeN bench. Both are exact label matches, so neither is
    // better evidence than the other, and choosing would be choosing for the person.
    const result = hear('Progetti');
    assert.equal(result.kind, VoiceIntent.AMBIGUOUS);
    const named = result.candidates.map((entry) => entry.name);
    assert.ok(named.includes('projects') && named.includes('coden/bench/projects'), named.join(', '));
  });

  test('a name outranks a panel that merely ends in the same word', () => {
    // The other side of the same rule, and the reason this is not simply "ask whenever two
    // things share a word": `/diff` is a NAME and `coden/bench/diff` only ends in it. Typing
    // `/diff` has never asked, and a bare `/diff` is sent by `planTurn` to that very panel
    // because the command needs a run it was not given. So there was never a choice here.
    const result = hear('diff');
    assert.equal(result.kind, VoiceIntent.INTENT);
    assert.equal(result.line, '/diff');
  });

  test('the three real collisions are the only ones in the whole address space', () => {
    // A measurement kept as an assertion, because the number moving is informative either way:
    // upward means the product grew two names for one word and nobody noticed; downward means
    // something stopped being reachable. Both are worth a look, and neither is worth a silent pass.
    const spoken = new Set([
      ...addresses.map((entry) => entry.label),
      ...addresses.map((entry) => italian(entry.label)),
      ...AGENT_COMMANDS.map((command) => command.name),
    ]);
    const asked = [...spoken].filter((phrase) => hear(phrase).kind === VoiceIntent.AMBIGUOUS);
    assert.deepEqual(asked.sort(), ['Agenti', 'Progetti', 'Sessioni'],
      `${asked.length} of ${spoken.size} spoken names are ambiguous`);
  });

  test('an entry and its own twin are one answer, not a choice', () => {
    // Seventeen commands carry the very address the address book also lists, so the menu holds
    // `memory` twice. Counting candidates without collapsing by destination would have made
    // every main page of the product ambiguous with itself.
    const twins = entries.filter((entry) => entry.name === 'memory');
    assert.equal(twins.length, 2, 'the twinning this collapses no longer exists — re-read the rule before deleting it');
    assert.equal(new Set(twins.map(destinationOf)).size, 1);
    const result = hear('memory');
    assert.equal(result.kind, VoiceIntent.INTENT);
    assert.equal(result.line, '/memory');
  });

  test('silence and filler are reported as unheard, never matched', () => {
    for (const utterance of ['', '   ', 'the', 'apri il', 'go to the', '...']) {
      assert.equal(hear(utterance).kind, VoiceIntent.UNHEARD, JSON.stringify(utterance));
    }
  });

  test('something heard clearly that names nothing says so', () => {
    const result = hear('sblindarifico quantistico');
    assert.equal(result.kind, VoiceIntent.NOTHING);
    assert.equal(result.heard, 'sblindarifico quantistico');
  });
});

describe('a command is never assembled out of somebody else\'s prose', () => {
  test('"stato del motore" reaches status, not closure with an argument', () => {
    // The regression that made the rule. `/closure`'s Italian summary contains "che cosa è stato
    // fatto", so "stato" was found inside it; `/closure` takes an argument; and the rest of the
    // sentence became one. It ran. Found by driving the real list, not by reading the code.
    const result = hear('stato del motore');
    assert.equal(result.kind, VoiceIntent.INTENT);
    assert.equal(result.entry.name, 'status');
    assert.equal(result.argument, '');
  });

  test('no description can be used as a command name and given a subject', () => {
    // The property behind that one case, driven with the STRONGEST possible attack rather than a
    // convenient one. The first content word of a command's own Italian description is the best
    // score a description can earn — `/closure` is described as "Chiudi un lavoro…", so "chiudi
    // il lavoro non ho finito" is a phrase that reads exactly like a command with a subject and
    // is not one. A weaker probe (a word from the middle of the sentence) passed against the
    // broken build too, which made it worthless: it was not the guard that stopped it.
    // Stated as the rule rather than as "nothing may run", because for four commands the
    // description legitimately OPENS with the command's own name — `/approve` is described as
    // "Approve a plan…" — and saying "approve …" is naming it, not quoting its description. So
    // what is asserted is the property itself: whenever a subject is taken, the words in front of
    // it are the entry's own name. Nothing weaker would have caught the `/closure motore` build,
    // and nothing stronger is true.
    const offenders = [];
    for (const command of AGENT_COMMANDS) {
      if (!String(command.argument ?? '').trim()) continue;
      for (const summary of [italian(command.summary), command.summary]) {
        const words = contentWords(summary);
        if (words.length < 2) continue;
        for (const opening of [words.slice(0, 1), words.slice(0, 2)]) {
          const utterance = `${opening.join(' ')} qualcosa che non ho mai detto`;
          const result = hear(utterance);
          if (result.kind !== VoiceIntent.INTENT || !result.argument) continue;
          const named = normalise(result.heard.slice(0, result.heard.length - result.argument.length));
          if (named !== normalise(result.entry.name) && named !== normalise(result.entry.address ?? '')) {
            offenders.push(`${JSON.stringify(utterance)} → ${result.line} (named "${named}")`);
          }
        }
      }
    }
    assert.deepEqual(offenders, [],
      'a description was taken as a command being named, and the rest of the sentence became its subject');
  });

  test('naming the command directly still works, with the subject after it', () => {
    const result = hear('plan sistema il login rotto');
    assert.equal(result.entry.name, 'plan');
    assert.equal(result.line, '/plan sistema il login rotto');
    assert.equal(result.disposition, VoiceDisposition.RUN);
  });
});

describe('the subject is the speaker\'s words', () => {
  test('filler and punctuation inside the argument survive', () => {
    // Matching throws words away; the subject may not. "sistema il login" must not reach a plan
    // as "sistema login" — the article is part of what the person said.
    const result = hear('closure ho finito, resta il test');
    assert.equal(result.entry.name, 'closure');
    assert.equal(result.argument, 'ho finito, resta il test');
    assert.equal(result.line, '/closure ho finito, resta il test');
  });

  test('a command that takes no argument never gets one', () => {
    // `/status` takes nothing. Trailing words must not be handed to it — that is how `/diff
    // <prose>` became a server error in a transcript about a call nobody asked to make.
    for (const utterance of ['status', 'engine status authority shadow']) {
      const result = hear(utterance);
      if (result.kind !== VoiceIntent.INTENT) continue;
      if (!String(result.entry.argument ?? '').trim()) assert.equal(result.argument, '', utterance);
    }
  });
});

describe('going somewhere and doing something are told apart', () => {
  test('an address navigates and a capability waits to be sent', () => {
    assert.equal(hear('memory').disposition, VoiceDisposition.NAVIGATE);
    assert.equal(hear('plan fix the login').disposition, VoiceDisposition.RUN);
  });

  test('every entry the product has falls on one side or the other, deliberately', () => {
    // Not a tautology: it fails if a third `kind` is introduced and nobody decides which side of
    // the microphone it belongs on. A new kind defaulting silently to RUN is safe; defaulting
    // silently to NAVIGATE would let speech act without anyone choosing that.
    for (const entry of entries) {
      const result = hear(entry.name);
      if (result.kind !== VoiceIntent.INTENT) continue;
      assert.ok([VoiceDisposition.NAVIGATE, VoiceDisposition.RUN].includes(result.disposition));
      if (result.entry.kind !== 'address') assert.equal(result.disposition, VoiceDisposition.RUN);
    }
  });
});

describe('what it says back', () => {
  test('each outcome is worded, and in the language in effect', () => {
    assert.equal(utteranceReply({ kind: VoiceIntent.UNHEARD }, italian), 'Non ho capito.');
    assert.match(utteranceReply(hear('sblindarifico'), italian), /^Qui non si chiama/);
    assert.match(utteranceReply(hear('Progetti'), italian), /^Corrisponde a più cose/);
    assert.match(utteranceReply(hear('memory'), italian), /^Vado a memory$/);
    assert.match(utteranceReply(hear('plan fix it'), italian), /^Pronto da mandare: \/plan fix it$/);
  });

  test('with no translator it keeps English — the terminal path', () => {
    assert.equal(utteranceReply({ kind: VoiceIntent.UNHEARD }), 'I did not catch that.');
  });

  test('an unknown result shape is answered, not thrown at', () => {
    // A surface that gets an exception where it expected a sentence shows nothing at all, which
    // reads as the microphone being broken. The honest fallback is the one for "I did not hear".
    assert.equal(utteranceReply(undefined), 'I did not catch that.');
    assert.equal(utteranceReply({ kind: 'something-new' }), 'I did not catch that.');
  });
});

describe('the pieces underneath', () => {
  test('accents fold, case drops, punctuation goes, slashes stay', () => {
    assert.equal(normalise('Perché — Memòria!'), 'perche memoria');
    assert.equal(normalise('CodeN/Bench/Diff'), 'coden/bench/diff');
  });

  test('filler holds no destination — removing it can never change what is reachable', () => {
    // The one hand-written list in the file, guarded by the claim made about it: not one entry
    // is the name of anything the product has.
    const named = new Set(entries.flatMap((entry) => [
      normalise(entry.name), normalise(entry.address ?? ''),
    ].filter(Boolean)));
    const collisions = [...FILLER].filter((word) => named.has(word));
    assert.deepEqual(collisions, [], 'a filler word is also the name of something — saying it would be unreachable');
  });

  test('every filler entry is a single word, because they are matched one token at a time', () => {
    assert.deepEqual([...FILLER].filter((word) => word.includes(' ')), []);
  });
});
