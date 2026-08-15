// SPDX-License-Identifier: AGPL-3.0-or-later
//
// SUPERSEDED, D-0275 (2026-07-31). This file used to prove GET/PUT
// /api/v1/settings/modules end to end (D-0273's ad-hoc external-link mechanism). That
// mechanism was retired the day after it shipped, once the real sector-modules activation
// framework (D-0274, D-0275) existed to replace it — see modules-registry.mjs's own
// header and docs/DECISION_LOG.md D-0275. Rewritten rather than deleted (CLAUDE10.md rule
// 12): it is now a regression guard that the retirement is real, not merely a UI change
// that left a reachable route behind it.
import test, { describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { freshTempDir } from './support/workspace.mjs';

const SETUP_TOKEN = 'test-only-setup-token-not-a-real-secret';

const workspace = freshTempDir('noesar-modules-http-');
process.env.NOESAR_WORKSPACE = workspace;
process.env.NOESAR_SETUP_TOKEN = SETUP_TOKEN;
process.env.NOESAR_LOG_LEVEL = 'ERROR';
process.env.NOESAR_DATA_PLANE = 'reference-json';

const { server } = await import('../src/server.mjs');

let base = null;

async function get(path) {
  const response = await fetch(`${base}${path}`);
  return { status: response.status };
}
async function put(path) {
  const response = await fetch(`${base}${path}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: '{}' });
  return { status: response.status };
}

before(async () => {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

describe('the D-0273 module-settings routes are gone, not merely unlinked from the UI', () => {
  test('GET /api/v1/settings/modules answers 404, not the retired 200/401 shape', async () => {
    const attempt = await get('/api/v1/settings/modules');
    assert.equal(attempt.status, 404);
  });

  test('PUT /api/v1/settings/modules/debug-evolution answers 404', async () => {
    const attempt = await put('/api/v1/settings/modules/debug-evolution');
    assert.equal(attempt.status, 404);
  });
});
