// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The grammar that keeps a stray Chinese word out of an Italian answer (output-guard.mjs). The measurement behind it is in the
// header of that file; this pins the decisions about WHEN it is sent, because a guard that fires on a translation into Chinese
// would turn a working request into an empty one.
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { scriptGrammar } from '../src/ai-workspace/output-guard.mjs';

// the character class of the grammar, as a JavaScript pattern (the syntax is the same)
const allowed = (grammar) => new RegExp(`^${grammar.slice('root ::= '.length)}$`, 'u');

describe('when the guard is sent', () => {
  test('for a language written in Latin letters, and a turn with no tools, and a person who asked for nothing foreign', () => {
    for (const language of ['it', 'en', 'it-IT', 'en_GB', 'fr', 'de', 'es', 'pt-BR']) {
      assert.match(scriptGrammar({ language, userText: 'aiutami con il curriculum' }), /^root ::= \[\^/, language);
    }
  });

  test('not for a language written in another script, nor for a language nobody named', () => {
    for (const language of ['zh', 'zh-CN', 'ja', 'ko', 'ru', 'uk', 'ar', 'fa', 'he', 'th', 'hi', 'el']) assert.equal(scriptGrammar({ language, userText: 'x' }), '', language);
    for (const language of ['', undefined, null, 'x', '123', ['it'], {}]) assert.equal(scriptGrammar({ language, userText: 'x' }), '', String(language));
  });

  test('not for a turn that offers tools: a tool call has its own grammar', () => {
    assert.equal(scriptGrammar({ language: 'it', userText: 'x', hasTools: true }), '');
  });

  test('not when the person writes those characters or asks for those languages, in Italian or English', () => {
    for (const userText of ['traduci in cinese: buongiorno', 'come si dice grazie in giapponese?', 'Translate this into Korean', 'what is "hello" in Mandarin', 'scrivi in coreano', 'spiegami i kanji', 'cosa significa 你好?', '草稿 vuol dire?', 'ひらがな']) {
      assert.equal(scriptGrammar({ language: 'it', userText }), '', userText);
    }
  });

  test('nor when the request is written in Spanish, French, German or Portuguese', () => {
    const asked = {
      es: ['traduce esto al chino', 'cómo se dice gracias en japonés', 'escríbelo en coreano', 'explícame los ideogramas', 'en mandarín, por favor'],
      fr: ['traduis en chinois', 'comment dit-on merci en japonais', 'écris-le en coréen', 'explique-moi les idéogrammes'],
      de: ['übersetze das ins Chinesische', 'wie sagt man danke auf Japanisch', 'schreib es auf Koreanisch', 'was ist ein Ideogramm', 'auf Kantonesisch'],
      pt: ['traduza para chinês', 'como se diz obrigado em japonês', 'escreva em coreano', 'em cantonês, por favor'],
    };
    for (const [language, texts] of Object.entries(asked)) {
      for (const userText of texts) assert.equal(scriptGrammar({ language, userText }), '', `${language}: ${userText}`);
    }
  });

  test('and is sent for words that merely resemble them', () => {
    for (const userText of ['il ristorante cinesino sotto casa', 'chinatown a Milano', 'ho mangiato sushi ieri']) {
      assert.notEqual(scriptGrammar({ language: 'it', userText }), '', userText);
    }
    // "China" alone is the country in Spanish and Portuguese, not a request for its language.
    for (const [language, userText] of [['es', 'quiero viajar a China'], ['pt', 'a economia da China'], ['fr', 'la Chine et le Japon'], ['de', 'Reise nach Japan']]) {
      assert.notEqual(scriptGrammar({ language, userText }), '', `${language}: ${userText}`);
    }
  });
});

describe('what the grammar forbids', () => {
  const grammar = scriptGrammar({ language: 'it', userText: 'ciao' });
  const ok = allowed(grammar);

  test('Chinese, Japanese and Korean characters and the full-width forms', () => {
    for (const text of ['primo草稿', '草', 'ひら', 'カタカナ', '한글', '，', '：', 'ＡＢＣ']) assert.ok(!ok.test(text), text);
  });

  test('and nothing a person writes in Italian, English, French or German', () => {
    for (const text of ['Ecco una bozza, è già fatta.', 'perché però più', 'It is fine: 100% — “quoted” (done)…', 'déjà vu çà', 'Straße Müller', '€ 12,50 · 3 × 4', 'a\nb\tc', '🙂 ok', '']) assert.ok(ok.test(text), text);
  });

  test('and the grammar is the single rule llama.cpp expects', () => {
    assert.match(grammar, /^root ::= \[\^[^\]]+\]\*$/);
  });
});
