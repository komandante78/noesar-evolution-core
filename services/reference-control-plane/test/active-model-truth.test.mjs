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

test('"what is loaded" is asked of the runtime, never of the configuration', () => {
  const body = serverSource.match(/function activeModelId\(\) \{([\s\S]*?)\n\}/)?.[1] ?? '';
  assert.ok(body, 'activeModelId must still exist');
  assert.match(body, /localModels\.status\(\)/,
    'the runtime’s own record of the child it started is the only witness that it is still there');
  assert.match(body, /launched/, 'a released runtime has no launched child, and that is the answer');
  // The regression in one line: `config().model` survives release() on purpose, so reading it as
  // "loaded" makes Free look like it did nothing.
  assert.doesNotMatch(body, /localModels\.config\(\)\.model/,
    'the configured model is what WOULD load; reading it as what IS loaded is the reported bug');
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
