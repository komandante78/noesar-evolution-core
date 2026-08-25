// SPDX-License-Identifier: AGPL-3.0-or-later
//
// D-0281: seedDebugEvolutionTools() used to dedup by NAME only, so a tool already
// registered kept its endpoint forever even after NOESAR_DEBUG_EVOLUTION_URL changed --
// the network migration that moved Debug Evolution off the LAN found this by leaving
// three tools pointed at a now-unpublished port. This pre-seeds a workspace with tool
// entries carrying an OLD endpoint (the exact shape a real prior boot would have written)
// and confirms the NEXT boot, with a NEW NOESAR_DEBUG_EVOLUTION_URL, rewrites them.
//
// D-0283 amends the precondition, not the property: the reconcile now runs only for a
// module that is INSTALLED AND ACTIVE here, so the workspace is pre-seeded with that
// install state too -- exactly what the live installation this defect was found on has.
// The opposite direction (not installed -> the tools are taken away) is
// module-uninstall-wiring.test.mjs.

import test, { describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { defaultAiState } from '../src/ai-workspace/atomic-store.mjs';
import { OWNER_MODULE_CATALOG } from '../src/owner-module-catalog.mjs';
import { freshTempDir } from './support/workspace.mjs';

const OLD_URL = 'http://192.168.178.100:8787';
const NEW_URL = 'http://debug-evolution:8787';
const TOKEN = 'stub-debug-evolution-token';
const SETUP_TOKEN = 'test-only-setup-token-not-a-real-secret';

const workspace = freshTempDir('noesar-de-reconcile-');
mkdirSync(join(workspace, 'state'), { recursive: true });
// Built from `defaultAiState()` rather than by listing the collections by hand. The hand-
// written version claimed `schemaVersion: AI_STATE_VERSION`, so no migration ran on it, and
// `validateState` rejected the whole file the moment D-0292 added a collection it did not
// list — a fixture that breaks on a purely additive schema change was testing the fixture,
// not the reconcile. Overriding `tools` keeps everything this test is actually about.
const preSeeded = {
  ...defaultAiState(),
  tools: [
    { id: 'tool-list-projects', name: 'Debug Evolution — List Projects', description: 'x', transport: 'local-http', endpoint: `${OLD_URL}/api/v2/projects`, config: { method: 'GET' }, external: false, consent: { granted: false, grantedAt: null, projectIds: [] }, timeoutMs: 60000, encryptedCredential: null, credentialEphemeral: false, inputSchema: { type: 'object' }, outputSchema: {}, permissions: [], mutative: false, requiresApproval: false, disabled: false, createdAt: '2026-07-31T00:00:00.000Z', updatedAt: '2026-07-31T00:00:00.000Z' },
    { id: 'tool-all-findings', name: 'Debug Evolution — All Findings', description: 'x', transport: 'local-http', endpoint: `${OLD_URL}/api/v2/findings`, config: { method: 'GET' }, external: false, consent: { granted: false, grantedAt: null, projectIds: [] }, timeoutMs: 60000, encryptedCredential: null, credentialEphemeral: false, inputSchema: { type: 'object' }, outputSchema: {}, permissions: [], mutative: false, requiresApproval: false, disabled: false, createdAt: '2026-07-31T00:00:00.000Z', updatedAt: '2026-07-31T00:00:00.000Z' },
    { id: 'tool-sarif', name: 'Debug Evolution — SARIF Report', description: 'x', transport: 'local-http', endpoint: `${OLD_URL}/api/v2/sarif`, config: { method: 'GET' }, external: false, consent: { granted: false, grantedAt: null, projectIds: [] }, timeoutMs: 60000, encryptedCredential: null, credentialEphemeral: false, inputSchema: { type: 'object' }, outputSchema: {}, permissions: [], mutative: false, requiresApproval: false, disabled: false, createdAt: '2026-07-31T00:00:00.000Z', updatedAt: '2026-07-31T00:00:00.000Z' },
  ],
};
writeFileSync(join(workspace, 'state/ai-workspace.json'), JSON.stringify(preSeeded, null, 2));

// D-0283: the module is installed and active in this workspace, which is what entitles the
// tools above to exist at all. Written straight to disk rather than driven through the
// catalog routes: this test is about the BOOT-time reconcile, which has to have run before
// the first request could be made.
const moduleRoot = join(workspace, 'sector-modules', 'debug-evolution');
mkdirSync(moduleRoot, { recursive: true });
writeFileSync(join(moduleRoot, 'manifest.json'), JSON.stringify(OWNER_MODULE_CATALOG[0].buildManifest(), null, 2));
writeFileSync(join(moduleRoot, 'state.json'), JSON.stringify({
  status: 'active', installedAtUnix: 1785501878, activatedAtUnix: 1785501881, deactivatedAtUnix: null,
  history: [{ event: 'installed', atUnix: 1785501878 }, { event: 'activated', atUnix: 1785501881 }],
}, null, 2));

process.env.NOESAR_WORKSPACE = workspace;
process.env.NOESAR_SETUP_TOKEN = SETUP_TOKEN;
process.env.NOESAR_LOG_LEVEL = 'ERROR';
process.env.NOESAR_DATA_PLANE = 'reference-json';
process.env.NOESAR_DEBUG_EVOLUTION_URL = NEW_URL;
process.env.NOESAR_DEBUG_EVOLUTION_TOKEN = TOKEN;

// Imported AFTER the pre-seeded file and env are in place: seedDebugEvolutionTools()
// runs once, at this import's module-load time, against the stale state above.
const { server } = await import('../src/server.mjs');

let base = null;

before(async () => {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => { await new Promise((resolve) => server.close(resolve)); });

describe('D-0281 — a Debug Evolution tool endpoint reconciles on boot when NOESAR_DEBUG_EVOLUTION_URL changes', () => {
  test('all three pre-seeded tools now carry the NEW endpoint, same ids, no duplicates', async () => {
    const response = await fetch(`${base}/api/v1/tools`);
    // /api/v1/tools requires a session; this proves the reconcile ran at boot regardless
    // of auth by reading the on-disk state the boot step itself wrote, same as the store
    // the route reads from.
    assert.equal(response.status, 401, 'unauthenticated listing should still be refused');
    const raw = JSON.parse(readFileSync(join(workspace, 'state/ai-workspace.json'), 'utf8'));
    const byName = Object.fromEntries(raw.tools.map((tool) => [tool.name, tool]));
    assert.equal(byName['Debug Evolution — List Projects'].endpoint, `${NEW_URL}/api/v2/projects`);
    assert.equal(byName['Debug Evolution — All Findings'].endpoint, `${NEW_URL}/api/v2/findings`);
    assert.equal(byName['Debug Evolution — SARIF Report'].endpoint, `${NEW_URL}/api/v2/sarif`);
    assert.equal(byName['Debug Evolution — List Projects'].id, 'tool-list-projects', 'reconcile must update in place, not create a new id');
    // The three Debug Evolution tools specifically, not every tool in the store. It counted the
    // whole store until P3 registered the engine's own read methods as built-in tools, and a total
    // was never what this assertion meant: "reconcile must not create duplicates" is a claim about
    // these three records, and a count that any other legitimate tool can break tests the wrong
    // thing. Narrowed, not relaxed — a duplicate of any of the three still fails it.
    const debugEvolution = raw.tools.filter((tool) => tool.name.startsWith('Debug Evolution — '));
    assert.equal(debugEvolution.length, 3, 'reconcile must not create duplicates');
  });
});
