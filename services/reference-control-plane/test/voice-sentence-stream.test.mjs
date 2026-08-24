// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The segmenter that decides WHEN the product may start speaking.
//
// Every assertion here is really the same one: a sentence handed out cannot be recalled, because
// it has already been spoken aloud. So the interesting cases are not the sentences it finds —
// they are the ones it refuses to find yet.
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { createSentenceStream } from '../../../apps/webui-static/sentence-stream.js';

/** Feed a whole answer one character at a time — the worst case a token stream can produce. */
function byCharacter(text, options) {
  const stream = createSentenceStream(options);
  const out = [];
  for (const char of text) out.push(...stream.push(char));
  out.push(...stream.flush());
  return out;
}

describe('a streamed answer becomes sentences as soon as each one is whole', () => {
  test('the first sentence is released before the rest of the answer exists', () => {
    const stream = createSentenceStream();
    assert.deepEqual(stream.push('Sono NOESAR'), []);
    assert.deepEqual(stream.push(' EVOLUTION.'), []); // no following character yet: still waiting
    assert.deepEqual(stream.push(' Posso'), ['Sono NOESAR EVOLUTION.']);
    // …and the second is still being written, so nothing more is handed out.
    assert.equal(stream.count, 1);
    assert.equal(stream.pending, 'Posso');
  });

  test('splitting is identical whether the text arrives whole or one character at a time', () => {
    const answer = 'Ho aperto la memoria. Contiene tre voci! Vuoi che le legga?';
    const expected = ['Ho aperto la memoria.', 'Contiene tre voci!', 'Vuoi che le legga?'];
    assert.deepEqual(byCharacter(answer), expected);
    const whole = createSentenceStream();
    assert.deepEqual([...whole.push(answer), ...whole.flush()], expected);
  });

  test('an abbreviation, an initial and a decimal never end a sentence', () => {
    assert.deepEqual(byCharacter('Il dott. Rossi arriva. Poi parliamo.'),
      ['Il dott. Rossi arriva.', 'Poi parliamo.']);
    assert.deepEqual(byCharacter('J. R. R. Tolkien lo scrisse. Fine.'),
      ['J. R. R. Tolkien lo scrisse.', 'Fine.']);
    assert.deepEqual(byCharacter('Pi greco vale 3.14 circa. Basta.'),
      ['Pi greco vale 3.14 circa.', 'Basta.']);
    assert.deepEqual(byCharacter('Vedi art. 5, e.g. il primo. Ok.'),
      ['Vedi art. 5, e.g. il primo.', 'Ok.']);
  });

  test('grouped terminators and closing marks stay with their own sentence', () => {
    assert.deepEqual(byCharacter('Davvero?! Sì. "Fatto." Ecco.'),
      ['Davvero?!', 'Sì.', '"Fatto."', 'Ecco.']);
    assert.deepEqual(byCharacter('Aspetta… ci sono. Ecco fatto.'),
      ['Aspetta…', 'ci sono.', 'Ecco fatto.']);
  });

  test('an answer that never terminates is still spoken, once, at the end', () => {
    const stream = createSentenceStream();
    assert.deepEqual(stream.push('nessuna punteggiatura qui'), []);
    assert.deepEqual(stream.flush(), ['nessuna punteggiatura qui']);
    // Flushing twice must not speak it twice — the commonest way a stream ends up doubled.
    assert.deepEqual(stream.flush(), []);
  });

  test('punctuation alone is never sent to the speech engine', () => {
    assert.deepEqual(byCharacter('...'), []);
    assert.deepEqual(byCharacter('  .  '), []);
    assert.deepEqual(byCharacter('Ok. ...'), ['Ok.']);
  });

  test('nothing is lost: every character of the answer comes back in some sentence', () => {
    const answer = 'Primo passo. Il dott. Bianchi ha 3.5 punti! E poi? Fine senza punto';
    const joined = byCharacter(answer).join(' ');
    const strip = (value) => value.replace(/\s+/g, '');
    assert.equal(strip(joined), strip(answer));
  });

  test('CJK terminators end a sentence too — the interface is not English-only', () => {
    assert.deepEqual(byCharacter('完了。次は何ですか？'), ['完了。', '次は何ですか？']);
  });
});
