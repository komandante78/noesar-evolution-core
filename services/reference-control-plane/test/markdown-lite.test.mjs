// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The markdown an answer is drawn from. Measured on 2026-10-08 in the simple interface: a CV draft showed `---` between its
// sections as three hyphens, a heading as `## Title`, and every line break was a <br>, so nothing could be spaced as a paragraph.
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { renderMarkdownLite } from '../../../apps/webui-static/markdown-lite.js';

// the page's escaper, as app.js has it
const escape = (value) => String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
const draw = (text) => renderMarkdownLite(text, escape);

describe('what a model writes, drawn as a person would expect', () => {
  test('a blank line ends a paragraph and a single line break stays a line break', () => {
    assert.equal(draw('one\ntwo\n\nthree'), '<p>one<br>two</p><p>three</p>');
  });

  test('a line of hyphens, asterisks or underscores is a rule, not three characters', () => {
    for (const rule of ['---', '***', '___', '- - -', '----------']) assert.equal(draw(`above\n${rule}\nbelow`), '<p>above</p><hr><p>below</p>', rule);
  });

  test('two hyphens, or a hyphen inside a sentence, are not a rule', () => {
    assert.equal(draw('--'), '<p>--</p>');
    assert.equal(draw('a --- b'), '<p>a --- b</p>');
  });

  test('# headings become h3 to h5, because the page already has an h1 and an h2', () => {
    assert.equal(draw('# One'), '<h3>One</h3>');
    assert.equal(draw('## Two'), '<h4>Two</h4>');
    assert.equal(draw('### Three'), '<h5>Three</h5>');
    assert.equal(draw('###### Six'), '<h5>Six</h5>');
    assert.equal(draw('## Closed ##'), '<h4>Closed</h4>');
  });

  test('a hash with no space after it is not a heading', () => {
    assert.equal(draw('#hashtag'), '<p>#hashtag</p>');
  });

  test('bullet lists, with -, * or •, and numbered lists, with 1. or 1)', () => {
    assert.equal(draw('- a\n- b'), '<ul><li>a</li><li>b</li></ul>');
    assert.equal(draw('* a\n• b'), '<ul><li>a</li><li>b</li></ul>');
    assert.equal(draw('1. a\n2) b'), '<ol><li>a</li><li>b</li></ol>');
  });

  test('a list ends at the first line that is not an item, and a different kind of list starts another', () => {
    assert.equal(draw('- a\ntext'), '<ul><li>a</li></ul><p>text</p>');
    assert.equal(draw('- a\n1. b'), '<ul><li>a</li></ul><ol><li>b</li></ol>');
  });

  test('items split by a blank line are one list, so that numbering goes on; anything else after a blank line ends it', () => {
    assert.equal(draw('1. a\n\n2. b\n\n3. c'), '<ol><li>a</li><li>b</li><li>c</li></ol>');
    assert.equal(draw('- a\n\n- b'), '<ul><li>a</li><li>b</li></ul>');
    assert.equal(draw('- a\n\ntext'), '<ul><li>a</li></ul><p>text</p>');
    assert.equal(draw('- a\n\n1. b'), '<ul><li>a</li></ul><ol><li>b</li></ol>');
  });

  test('bold, italic, inline code and links, inside paragraphs, items and headings', () => {
    assert.equal(draw('**Name:** [Candidate]'), '<p><strong>Name:</strong> [Candidate]</p>');
    assert.equal(draw('- *soft* and `code`'), '<ul><li><em>soft</em> and <code>code</code></li></ul>');
    assert.equal(draw('## The **big** one'), '<h4>The <strong>big</strong> one</h4>');
    assert.equal(draw('[home](https://example.com/a)'), '<p><a href="https://example.com/a" target="_blank" rel="noopener noreferrer">home</a></p>');
  });

  test('a link is only drawn for http and https', () => {
    assert.ok(!draw('[x](javascript:alert(1))').includes('<a '));
    assert.ok(!draw('[x](data:text/html,hi)').includes('<a '));
  });

  test('a fenced block keeps its text as it is, between paragraphs, and what is inside is not read as markdown', () => {
    assert.equal(draw('before\n```\n---\n- a\n```\nafter'), '<p>before</p><pre><code>---\n- a\n</code></pre><p>after</p>');
    assert.equal(draw('```js\nconst a = 1;\n```'), '<pre><code>const a = 1;\n</code></pre>');
  });

  test('nothing the model wrote reaches the page as markup', () => {
    const out = draw('<img src=x onerror=alert(1)>\n\n- <script>x</script>\n\n## <b>h</b>\n\n```\n<i>c</i>\n```');
    assert.ok(!/<img|<script|<b>|<i>/.test(out), out);
    assert.ok(out.includes('&lt;img src=x onerror=alert(1)&gt;'));
  });

  test('empty, whitespace and non-string input draw nothing and do not throw', () => {
    assert.equal(draw(''), '');
    assert.equal(draw('\n\n  \n'), '');
    assert.equal(draw(undefined), '');
    assert.equal(draw(null), '');
  });

  test('a real CV draft: headings, rules, lists and bold, in order', () => {
    const draft = 'Certo!\n\n---\n\n**Curriculum Vitae**\n\n**Nome:** [Nome]\n**Email:** [Email]\n\n---\n\n**Lingue:**\n\n- Italiano: Nativo\n- Inglese: [Livello]\n\n---\n\nQuale informazione vuoi aggiungere?';
    const out = draw(draft);
    assert.equal((out.match(/<hr>/g) || []).length, 3, 'the three rules');
    assert.ok(!out.includes('---'), 'none printed as typed');
    assert.ok(out.includes('<p><strong>Nome:</strong> [Nome]<br><strong>Email:</strong> [Email]</p>'));
    assert.ok(out.includes('<ul><li>Italiano: Nativo</li><li>Inglese: [Livello]</li></ul>'));
  });
});
