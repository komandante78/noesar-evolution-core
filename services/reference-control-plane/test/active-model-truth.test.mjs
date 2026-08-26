// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Owner-reported, 2026-08-26, twice in one screenshot: pressing Free left the model shown as
// "In use", and the global Model chip read «nessuno» with a model resident and answering.
//
// One shape, two places: something naming the model was answering a DIFFERENT question from the
// one it appeared to answer. The server asked "what is configured" and printed it as "what is
// loaded"; the chip asked "what did this conversation override" and printed «none» when nothing
// had. This file pins both, structurally — the way this repository already checks app.js and the
// server source, since neither exposes a boundary a unit test could import through.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const serverSource = readFileSync(join(ROOT, 'services/reference-control-plane/src/server.mjs'), 'utf8');
const appJs = readFileSync(join(ROOT, 'apps/webui-static/app.js'), 'utf8');

test('one function answers "which model has this runtime actually started"', () => {
  const body = serverSource.match(/function launchedModelId\(\) \{([\s\S]*?)\n\}/)?.[1] ?? '';
  assert.ok(body, 'launchedModelId must exist — two readers deriving this separately is how the '
    + 'same bug got fixed in one of them and reported again from the other');
  assert.match(body, /localModels\.status\(\)/);
  assert.match(body, /launched/, 'release() sets launched to null; that is the whole signal');
  assert.doesNotMatch(body, /config\(\)\.model/,
    'the configured model survives release() on purpose — reading it as "running" is the bug');
});

test('both readers of "what is loaded" come from that one function', () => {
  const active = serverSource.match(/function activeModelId\(\) \{([\s\S]*?)\n\}/)?.[1] ?? '';
  assert.match(active, /launchedModelId\(\)/);
  assert.doesNotMatch(active, /localModels\.config\(\)\.model/);

  // The one that actually caused the second report. resolveActiveModel returns LOADED for a
  // non-empty localRuntimeModel WITHOUT probing — sound only because that argument is meant to be
  // a model this product started. Handed the configured name instead, it answered LOADED for a
  // process that no longer existed and never reached a probe that would have noticed.
  const refresh = serverSource.match(/async function refreshActiveModel\([\s\S]*?\n\}/)?.[0] ?? '';
  assert.ok(refresh, 'refreshActiveModel must still exist');
  assert.match(refresh, /localRuntimeModel: launchedModelId\(\)/,
    'the resolver skips the probe for this argument, so it must only ever receive a model that '
    + 'is genuinely running');
  assert.doesNotMatch(refresh, /localRuntimeModel: localModels\.config\(\)\.model/);
});

test('the probe stays the fallback — a model this runtime did not start is still a model', () => {
  const body = serverSource.match(/function activeModelId\(\) \{([\s\S]*?)\n\}/)?.[1] ?? '';
  assert.match(body, /activeModelSnapshot\.state === ActiveModelState\.LOADED/,
    'on a sidecar installation the probe is the only witness there is, and removing it would '
    + 'trade one wrong answer for another');
});

test('the global Model chip asks the installation before it concludes none', () => {
  const body = appJs.match(/function updatePrivacyFromProvider\(\)\{([\s\S]*?)\n\}/)?.[1] ?? '';
  assert.ok(body, 'updatePrivacyFromProvider must still exist');
  assert.match(body, /refreshCodenModelChip\(\)/,
    'with no override set, the chip must ask what is resident rather than print none');
  assert.doesNotMatch(body, /\|\|'none'/,
    'an empty provider field is not evidence that no model is loaded');
});

test('one request writes every chip that names the resident model', () => {
  const body = appJs.match(/async function refreshCodenModelChip\(\)\{([\s\S]*?)\n\}/)?.[1] ?? '';
  assert.match(body, /#codenModelChipLabel/, 'the CodeN chip');
  assert.match(body, /#chatModelLabel/, 'the composer switcher');
  assert.match(body, /#modelChip/, 'the global chip — whose CodeN sibling has claimed since s336 '
    + 'that the two carry the same value');
});
