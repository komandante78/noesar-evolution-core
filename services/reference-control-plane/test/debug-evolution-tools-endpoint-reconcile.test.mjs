// SPDX-License-Identifier: AGPL-3.0-or-later
//
// D-0281: seedDebugEvolutionTools() used to dedup by NAME only, so a tool already
// registered kept its endpoint forever even after NOESAR_DEBUG_EVOLUTION_URL changed --
// the network migration that moved Debug Evolution off the LAN found this by leaving
// three tools pointed at a now-unpublished port. This pre-seeds a workspace with tool
// entries carrying an OLD endpoint (the exact shape a real prior boot would have written)
// and confirms the NEXT boot, with a NEW NOESAR_DEBUG_EVOLUTION_URL, rewrites them.

import test, { describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { AI_STATE_VERSION } from '../src/ai-workspace/atomic-store.mjs';

const OLD_URL = 'http://192.168.178.100:8787';
const NEW_URL = 'http://debug-evolution:8787';
const TOKEN = 'stub-debug-evolution-token';
const SETUP_TOKEN = 'test-only-setup-token-not-a-real-secret';

const workspace = mkdtempSync(join(tmpdir(), 'noesar-de-reconcile-'));
mkdirSync(join(workspace, 'state'), { recursive: true });
const preSeeded = {
  schemaVersion: AI_STATE_VERSION,
  projects: [], conversations: [], messages: [], branches: [], memories: [], artifacts: [],
  sources: [], knowledgeChunks: [], providerProfiles: [], agents: [], agentRuns: [], tasks: [],
  workflows: [], workflowRuns: [], reviewSamples: [], closures: [],
  tools: [
    { id: 'tool-list-projects', name: 'Debug Evolution — List Projects', description: 'x', transport: 'local-http', endpoint: `${OLD_URL}/api/v2/projects`, config: { method: 'GET' }, external: false, consent: { granted: false, grantedAt: null, projectIds: [] }, timeoutMs: 60000, encryptedCredential: null, credentialEphemeral: false, inputSchema: { type: 'object' }, outputSchema: {}, permissions: [], mutative: false, requiresApproval: false, disabled: false, createdAt: '2026-07-31T00:00:00.000Z', updatedAt: '2026-07-31T00:00:00.000Z' },
    { id: 'tool-all-findings', name: 'Debug Evolution — All Findings', description: 'x', transport: 'local-http', endpoint: `${OLD_URL}/api/v2/findings`, config: { method: 'GET' }, external: false, consent: { granted: false, grantedAt: null, projectIds: [] }, timeoutMs: 60000, encryptedCredential: null, credentialEphemeral: false, inputSchema: { type: 'object' }, outputSchema: {}, permissions: [], mutative: false, requiresApproval: false, disabled: false, createdAt: '2026-07-31T00:00:00.000Z', updatedAt: '2026-07-31T00:00:00.000Z' },
    { id: 'tool-sarif', name: 'Debug Evolution — SARIF Report', description: 'x', transport: 'local-http', endpoint: `${OLD_URL}/api/v2/sarif`, config: { method: 'GET' }, external: false, consent: { granted: false, grantedAt: null, projectIds: [] }, timeoutMs: 60000, encryptedCredential: null, credentialEphemeral: false, inputSchema: { type: 'object' }, outputSchema: {}, permissions: [], mutative: false, requiresApproval: false, disabled: false, createdAt: '2026-07-31T00:00:00.000Z', updatedAt: '2026-07-31T00:00:00.000Z' },
  ],
  settings: { defaultProviderId: null, externalEgressDefault: 'deny', retentionDays: 365, semanticSearchEnabled: true },
};
writeFileSync(join(workspace, 'state/ai-workspace.json'), JSON.stringify(preSeeded, null, 2));

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
    assert.equal(raw.tools.length, 3, 'reconcile must not create duplicates');
  });
});
