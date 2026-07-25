// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Structural invariants of the shipped WebUI markup.
//
// These exist because of a real, delivered defect that survived a full acceptance phase
// and a WebUI remediation phase: `<section class="view" id="view-tasks">` was never
// closed. HTML does not auto-close a <section> when the next one opens, so every view
// declared after Tasks became a DOM *child* of Tasks. `.view` is display:none unless it
// carries `.active`, and an active element inside a display:none ancestor still has no
// box — so Artifacts, Knowledge, Memory, Models, Agents, CodeN and Compute were
// populated, marked active, and invisible.
//
// That is exactly the reported symptom ("clicking Agents/Tools/Knowledge does nothing"),
// and it was missed twice because the checks looked at `classList` rather than at
// whether anything was on screen. A malformed-markup check is cheap; the failure it
// prevents is the whole product looking dead.
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const INDEX = join(here, '../../../apps/webui-static/index.html');
const html = readFileSync(INDEX, 'utf8');

/** Elements that must nest. Void elements are excluded by construction. */
const PAIRED = ['section', 'form', 'main', 'aside', 'nav', 'article', 'header', 'footer'];

describe('webui markup structure', () => {
  for (const tag of PAIRED) {
    test(`<${tag}> tags are balanced`, () => {
      const open = (html.match(new RegExp(`<${tag}(?=[\\s>])`, 'g')) ?? []).length;
      const close = (html.match(new RegExp(`</${tag}>`, 'g')) ?? []).length;
      assert.equal(open, close, `<${tag}>: ${open} opened, ${close} closed`);
    });
  }

  test('no view section is nested inside another view section', () => {
    // Walk the document tracking section depth, and record the depth at which each
    // `class="view"` section opens. They must all open at the same depth — nesting one
    // inside another is the defect above.
    const tokens = [...html.matchAll(/<section\b([^>]*)>|<\/section>/g)];
    let depth = 0;
    const viewDepths = [];
    for (const token of tokens) {
      if (token[0] === '</section>') { depth -= 1; continue; }
      const attributes = token[1] ?? '';
      const isView = /class="[^"]*\bview\b[^"]*"/.test(attributes);
      const id = attributes.match(/id="([^"]+)"/)?.[1] ?? null;
      if (isView) viewDepths.push({ id, depth });
      depth += 1;
    }
    assert.ok(viewDepths.length >= 20, `expected the full set of views, found ${viewDepths.length}`);
    const baseline = viewDepths[0].depth;
    const nested = viewDepths.filter((entry) => entry.depth !== baseline);
    assert.deepEqual(nested, [], `views nested below the others: ${nested.map((e) => `${e.id}@${e.depth}`).join(', ')}`);
  });

  test('section depth returns to zero at the end of the document', () => {
    const tokens = [...html.matchAll(/<section\b[^>]*>|<\/section>/g)];
    let depth = 0;
    let lowest = 0;
    for (const token of tokens) {
      depth += token[0] === '</section>' ? -1 : 1;
      lowest = Math.min(lowest, depth);
    }
    assert.equal(depth, 0, 'unbalanced <section> nesting');
    assert.equal(lowest, 0, 'a </section> closed more than was open');
  });

  test('every id is unique', () => {
    // getElementById silently returns the first match, so a duplicate id makes one of
    // the two elements permanently unreachable — a handler that appears wired and is not.
    const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
    const seen = new Set();
    const duplicates = new Set();
    for (const id of ids) {
      if (seen.has(id)) duplicates.add(id);
      seen.add(id);
    }
    assert.deepEqual([...duplicates], [], 'duplicate element ids');
  });

  test('every nav target has a matching view section', () => {
    const targets = [...html.matchAll(/data-view="([^"]+)"/g)].map((match) => match[1]);
    assert.ok(targets.length >= 20, `expected the full nav, found ${targets.length}`);
    for (const target of targets) {
      assert.ok(html.includes(`id="view-${target}"`), `nav entry "${target}" has no #view-${target}`);
    }
  });

  test('every view section reachable from the nav is registered as a route', () => {
    const app = readFileSync(join(here, '../../../apps/webui-static/app.js'), 'utf8');
    const routes = app.match(/const ROUTES=new Set\(\[([^\]]+)\]\)/)?.[1] ?? '';
    const targets = [...html.matchAll(/data-view="([^"]+)"/g)].map((match) => match[1]);
    for (const target of targets) {
      assert.ok(routes.includes(`'${target}'`), `nav entry "${target}" is not in ROUTES, so it resolves to not-found`);
    }
  });
});
