// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The part of markdown an answer actually uses, drawn as the page's own markup.
//
// A model answers in markdown — bold, code, links, lists, and, in a letter or a CV, headings and
// horizontal rules. The first version here handled the first four and printed the rest as typed:
// measured on 2026-10-08 in the simple interface, a CV draft showed `---` between its sections as
// three hyphens, and every line break was a `<br>`, so a paragraph could not be spaced.
//
// Hand-rolled and dependency-free, like everything else in this page: it runs AFTER `escape`, so the
// tags it inserts are the only markup in its result and nothing in the model's own text is left
// unescaped for it to inject through. `escape` is passed in because the page owns the one escaper.
//
// What it makes: paragraphs (a blank line ends one; a single line break stays a line break),
// headings (`#`..`######`, drawn as h3..h5: the page already has an h1 and an h2), bullet and numbered
// lists, horizontal rules, fenced and inline code, bold, italic, and http(s) links.

const PLACEHOLDER = /^\u0000\d+\u0000$/;
const RULE = /^\s*([-*_])(\s*\1){2,}\s*$/;
const BULLET = /^\s*[-*•] (.+)$/;
const NUMBERED = /^\s*\d{1,3}[.)] (.+)$/;
const HEADING = /^(#{1,6})\s+(.+?)\s*#*\s*$/;

export function renderMarkdownLite(text, escape) {
  const blocks = [];
  let html = escape(text).replace(/```[^\n]*\n?([\s\S]*?)```/g, (_, code) => {
    blocks.push(`<pre><code>${code}</code></pre>`);
    return `\u0000${blocks.length - 1}\u0000`;
  });
  html = html.replace(/`([^`\n]+?)`/g, '<code>$1</code>');
  html = html.replace(/\*\*([^*\n]+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/(?<![*\w])\*([^*\n]+?)\*(?!\w)/g, '<em>$1</em>');
  html = html.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');

  const out = [];
  let list = null;
  let paragraph = [];
  const endParagraph = () => { if (paragraph.length) { out.push(`<p>${paragraph.join('<br>')}</p>`); paragraph = []; } };
  const endList = () => { if (list) { out.push(`</${list}>`); list = null; } };
  const startList = (kind) => { endParagraph(); if (list !== kind) { endList(); out.push(`<${kind}>`); list = kind; } };

  for (const line of html.split('\n')) {
    let found;
    if (PLACEHOLDER.test(line.trim())) { endParagraph(); endList(); out.push(line.trim()); continue; }
    if (RULE.test(line)) { endParagraph(); endList(); out.push('<hr>'); continue; }
    if ((found = line.match(BULLET))) { startList('ul'); out.push(`<li>${found[1]}</li>`); continue; }
    if ((found = line.match(NUMBERED))) { startList('ol'); out.push(`<li>${found[1]}</li>`); continue; }
    if ((found = line.match(HEADING))) {
      endParagraph(); endList();
      const level = Math.min(found[1].length + 2, 5);
      out.push(`<h${level}>${found[2]}</h${level}>`);
      continue;
    }
    // a blank line between two items does not end the list: a model writes "1. a", a blank line, "2. b" and means one list, numbered 1, 2
    if (line.trim() === '') { endParagraph(); continue; }
    endList();
    paragraph.push(line);
  }
  endParagraph(); endList();
  return out.join('').replace(/\u0000(\d+)\u0000/g, (_, i) => blocks[Number(i)]);
}
