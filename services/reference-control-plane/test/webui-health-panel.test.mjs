// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The Health panel (Settings › Health) read a field the server has never sent.
//
// `buildHealth()` (observability.mjs) sends each subject as `{name, healthy, essential,
// recoveryLevel, detail}`. `loadHealth()` in app.js read `item.status`, which does not
// exist on that shape and never has: every component row rendered the literal word
// "undefined", every row was coloured amber regardless of the real state, and the
// "Degraded" count was always zero because `item.status` is always falsy — a subject that
// had genuinely gone down looked exactly like one that was fine. Measured live on the
// running installation: `/healthz`'s own `components[0]` is
// `{"name":"control-plane","healthy":true,...}` while the panel showed "undefined · amber".
//
// Two more defects of the same shape sat in the same six lines. `health.uptimeSeconds`
// does not exist on the payload at all — the value lives per-subject, at
// `components[].detail.uptimeSeconds`, and only the control-plane probe sets it
// (`process.uptime()`) — so the row always showed "—". And the "Degraded" count was a
// second derivation, in the browser, of a number `buildHealth()` already computed and sent
// as `health.degraded`: an array of the names that are down. That is the exact anti-pattern
// this file's own comment, three lines above `loadHealth`, names by its price — a second
// derivation is how the invariant panel came to show numbers that matched neither the code
// nor itself.
//
// This test reads the real shape `buildHealth()` returns and asserts the client reads
// fields that shape actually has — so a future rename on either side turns this red
// instead of leaving every row silently wrong again.
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '../../..');
const app = readFileSync(join(repoRoot, 'apps/webui-static/app.js'), 'utf8');
const observability = readFileSync(join(here, '../src/observability.mjs'), 'utf8');

describe('the health panel reads the shape buildHealth() actually sends', () => {
  test('each component is read by `healthy`, the field the server sends — never `status`', () => {
    const start = app.indexOf('async function loadHealth');
    const end = app.indexOf('const watchdogBox', start);
    const body = app.slice(start, end);
    assert.ok(body.length > 0, 'loadHealth() not found — this test needs updating');
    assert.doesNotMatch(body, /item\.status\b/,
      'a watchdog subject has no `status` field (observability.mjs sends `healthy`) — this read is always undefined');
    assert.match(body, /item\.healthy/, 'each row should be coloured and labelled from `item.healthy`');
    // The server already counts this — `buildHealth()` returns `degraded` as an array of the
    // down subjects' names. Recomputing it from `item.status` is the second derivation this
    // whole class of defect comes from.
    assert.match(body, /health\.degraded/,
      'the Degraded count should come from the server\'s own `health.degraded`, not be re-derived from a field that does not exist');
  });

  test('the observability module really does send `healthy`, not `status`, per subject', () => {
    // The guard above is only honest if this is still true on the server side.
    const start = observability.indexOf('components: subjects.map');
    const end = observability.indexOf('degraded: down.map', start);
    const body = observability.slice(start, end);
    assert.ok(body.length > 0, 'components: subjects.map(...) not found in observability.mjs — this test needs updating');
    assert.match(body, /healthy:\s*subject\.healthy/);
    assert.doesNotMatch(body, /status:/, 'a `status` field appeared on the component shape — the client-side guard above should read it too');
  });

  test("a component's own name is marked as data, not a sentence to translate", () => {
    // `code` is already a catalogue key — translated elsewhere for a document's kind — so an
    // unmarked component named `code` was silently repainted as "codice", a subject's
    // identity rewritten by an unrelated translation. `metrics()` is shared by three other
    // panels whose labels are phrases this product chose; only here is the label DATA.
    const start = app.indexOf('async function loadHealth');
    const end = app.indexOf('const watchdogBox', start);
    const body = app.slice(start, end);
    assert.match(body, /item\.name\?\?t\('component'\),t\(item\.healthy.*?,Boolean\(item\.name\)/,
      "the component row does not mark its label as data — a subject named the same as an existing catalogue key will render translated");
  });

  test('uptime is read from the control-plane subject\'s own detail, not a top-level field that does not exist', () => {
    const start = app.indexOf('async function loadHealth');
    const end = app.indexOf('const watchdogBox', start);
    const body = app.slice(start, end);
    assert.doesNotMatch(body, /health\.uptimeSeconds\b/,
      'buildHealth() never returns a top-level uptimeSeconds — this read is always undefined');
    assert.match(body, /detail\?\.uptimeSeconds|detail\.uptimeSeconds/,
      'uptime lives at components[].detail.uptimeSeconds, set by the control-plane probe alone');
  });
});
