// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Owner, 2026-10-13: "DEVI FARE TEST SU TUTTO". The WCAG audit, repaired and run again, stopped on a page holding 92 error notices.
// It was not the keyboard: each press of a theme card in the audit raised two notices, "[object Object]" and "Unexpected interface
// error. The action did not complete." (the audit's own words for what the page threw: "text.trim is not a function").
//
// Five places call toast({title, body, kind}) with an object where toast(message, {kind}) wants a sentence: the theme change (since
// 2026-07-27), the accent reset, the sessions that stayed where they were, "Restore it first", and "Logs deleted" — the Delete logs
// feature of 2026-10-12, whose success this task never saw. An object printed as a sentence is "[object Object]", and setStatus()
// then called .trim() on it: so every successful press ended with a red notice that stays on screen until it is dismissed.
//
// Held as behaviour, not as a list of five lines: the real toast() is lifted out of app.js and run against a small stand-in for the
// page, with the three shapes the code uses.

import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const app = readFileSync(join(here, '../../../apps/webui-static/app.js'), 'utf8');

// the source of one top-level function, found by balancing its braces: the parameters are skipped first, because a destructured
// parameter ({ kind = 'info' } = {}) has braces of its own that are not the body
function lift(name) {
  const start = app.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `function ${name} not found in app.js`);
  let parens = 0;
  let afterParams = app.indexOf('(', start);
  for (; afterParams < app.length; afterParams += 1) {
    if (app[afterParams] === '(') parens += 1;
    else if (app[afterParams] === ')') { parens -= 1; if (parens === 0) break; }
  }
  let depth = 0;
  for (let i = app.indexOf('{', afterParams); i < app.length; i += 1) {
    if (app[i] === '{') depth += 1;
    else if (app[i] === '}') { depth -= 1; if (depth === 0) return app.slice(start, i + 1); }
  }
  throw new Error(`function ${name} does not close`);
}

function standIn() {
  const made = [];
  const element = (tag) => ({ tag, className: '', innerHTML: '', textContent: '', attrs: {}, children: [], title: '', type: '', listeners: {},
    setAttribute(k, v) { this.attrs[k] = v; }, appendChild(child) { this.children.push(child); }, addEventListener(k, fn) { this.listeners[k] = fn; }, remove() { this.removed = true; } });
  const host = element('div');
  const statuses = [];
  const document = { createElement: (tag) => { const node = element(tag); made.push(node); return node; } };
  const escapeHtml = (value) => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  // the real setStatus() calls t(message) which trims: a non-string breaks here, as it did in the page
  const setStatus = (message, error) => { statuses.push({ text: String(message.trim()), error }); };
  const timers = [];
  // The point of the test is to run the toast() that ships in app.js, which is a browser module and cannot be imported: its own text is evaluated here, against a stand-in for the page.
  // eslint-disable-next-line no-new-func -- evaluating the shipped function is the test; nothing else is built this way
  const toast = new Function('$', 'document', 'escapeHtml', 'setStatus', 'setTimeout', `${lift('toast')}\nreturn toast;`)(() => host, document, escapeHtml, setStatus, (fn, ms) => timers.push(ms));
  return { toast, host, statuses, timers };
}

describe('toast() takes the shapes the code calls it with', () => {
  test('a sentence, as always', () => {
    const { toast, host, statuses } = standIn();
    toast('Workflow created.');
    assert.equal(host.children.length, 1);
    assert.match(host.children[0].innerHTML, /Workflow created\./);
    assert.deepEqual(statuses.map((s) => s.text), ['Workflow created.']);
  });

  test('a sentence with the kind in the second argument still raises an alert that stays', () => {
    const { toast, host, timers } = standIn();
    toast('Something broke', { kind: 'error' });
    assert.equal(host.children[0].attrs.role, 'alert');
    assert.match(host.children[0].className, /toast-error/);
    assert.deepEqual(timers, [], 'an error stays until it is dismissed');
  });

  test('a notice {title, body, kind} reads as its words, not as [object Object], and breaks nothing', () => {
    const { toast, host, statuses } = standIn();
    assert.doesNotThrow(() => toast({ title: 'Theme changed', body: 'This theme is now in use on this device.', kind: 'success' }));
    const html = host.children[0].innerHTML;
    assert.doesNotMatch(html, /\[object Object\]/);
    assert.match(html, /Theme changed/);
    assert.match(html, /This theme is now in use on this device\./);
    assert.match(host.children[0].className, /toast-success/);
    assert.equal(host.children[0].attrs.role, 'status');
    assert.doesNotMatch(statuses[0].text, /\[object Object\]/);
  });

  test('a notice disappears by itself (it is not an error), and a notice without a body is just its title', () => {
    const { toast, host, timers } = standIn();
    toast({ title: 'Logs deleted', kind: 'success' });
    assert.match(host.children[0].innerHTML, /Logs deleted/);
    assert.deepEqual(timers, [6000]);
  });
});

describe('every call that passes an object passes the words toast() reads', () => {
  const calls = [...app.matchAll(/toast\(\{([^}]*)\}/g)].map((m) => m[1]);
  test('the five call sites the sweep found are still there to be held', () => {
    assert.ok(calls.length >= 4, `expected the notices of the theme, the accent, the sessions and the logs, found ${calls.length}`);
  });
  test('each has a title', () => {
    for (const call of calls) assert.match(call, /title:/, `a notice with no title: toast({${call.slice(0, 60)}`);
  });
});
