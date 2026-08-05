// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Phase 6, the measurement BEFORE — what an installation with ATOM selected actually does the
// moment ATOM stops answering.
//
// `17` phase 6 states the expected before-state as «atomd fermo ⇒ 503 reasoning_unavailable ⇒
// la sessione si ferma». This file does not assert that; it EXECUTES it, twice, against a real
// daemon that is first up and then really stopped — not a stub whose refusal proves only that a
// stub was written to refuse.
//
// Endpoint and token come from the environment: this file presumes no host (platform law).
//   NOESAR_ATOM_ENDPOINT   the disposable atomd this run controls
//   NOESAR_ATOM_TOKEN      its token
//   NOESAR_AUTHORING_ENDPOINT  the model underneath, for the authoring half
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { WorkspaceActionOrchestrator } from '../services/reference-control-plane/src/workspace-actions.mjs';
import { ReasoningRouter } from '../services/reference-control-plane/src/reasoning-router.mjs';
import { Author, atomAuthoringGenerator } from '../services/reference-control-plane/src/author.mjs';
import { TokenMinter } from '../services/reference-control-plane/src/capability.mjs';
import { EventLedger } from '../services/reference-control-plane/src/events.mjs';

const atomEndpoint = process.env.NOESAR_ATOM_ENDPOINT ?? 'http://127.0.0.1:8411';
const atomToken = process.env.NOESAR_ATOM_TOKEN ?? '';
const phase = process.argv[2] ?? 'up';

const ws = mkdtempSync(join(tmpdir(), 'noesar-phase6-ws-'));
const shadows = mkdtempSync(join(tmpdir(), 'noesar-phase6-shadows-'));
mkdirSync(join(ws, 'src'), { recursive: true });
writeFileSync(join(ws, 'src/login.js'), `export function loginRoute(app) {
  app.post('/login', async (request, reply) => {
    const { user, password } = request.body;
    return reply.send(await authenticate(user, password));
  });
}
`);
writeFileSync(join(ws, 'README.md'), '# demo\n\nA login route with no rate limiting.\n');

// The environment an installation that SELECTED atom runs with. `decompose`/`expect`/`simulate`
// are the default external surfaces; naming them here is only making the default visible.
const env = {
  NOESAR_REASONING_MODE: 'rust-external',
  NOESAR_RUST_REASONING_ENDPOINT: atomEndpoint,
  NOESAR_RUST_REASONING_TOKEN: atomToken,
  NOESAR_EXTERNAL_SURFACES: 'decompose,expect',
};

console.log(`PHASE 6 — MISURA ${phase === 'up' ? 'con atomd VIVO' : 'con atomd FERMATO DAVVERO'}`);
console.log(`atom:     ${atomEndpoint}\n`);

// ---- half one: the reasoning surfaces --------------------------------------------------
const router = new ReasoningRouter({ workspaceRoot: ws, env, sessionId: 'phase6' });
let reasoningLine;
try {
  const plan = router.buildPlan(
    [{ id: 's1', description: 'add a rate limiter', files: ['src/login.js'], commands: [], destructive: false }],
    [], 'safe',
  );
  const value = await router.expect(plan);
  reasoningLine = `expect() ANSWERED — provenance ${JSON.stringify(router.provenance())} — ${JSON.stringify(value).slice(0, 90)}`;
} catch (error) {
  reasoningLine = `expect() THREW ${error.name} (status ${error.status ?? '—'}) — ${String(error.reason ?? error.message).slice(0, 140)}`;
}
console.log(`reasoning  ${reasoningLine}`);
console.log(`           degradations(): ${typeof router.degradations === 'function' ? JSON.stringify(router.degradations()) : 'THE ROUTER HAS NO degradations() — nothing records a fallback'}`);

// ---- half two: a whole task, end to end ------------------------------------------------
const orch = new WorkspaceActionOrchestrator({
  workspaceRoot: ws, shadowsRoot: shadows,
  minter: new TokenMinter(randomBytes(32)), events: new EventLedger(),
  env,
  author: new Author({ generate: atomAuthoringGenerator({ endpoint: atomEndpoint, token: atomToken }), model: `atom ${atomEndpoint}` }),
});
const NOW = Math.floor(Date.now() / 1000);
let taskLine;
try {
  const planned = await orch.plan({
    actor: 'owner', request: 'add rate limiting to the login route', files: [], nowUnix: NOW,
  });
  taskLine = `plan() RETURNED ${planned.status} — authoring ${JSON.stringify(planned.authoring)}`;
} catch (error) {
  taskLine = `plan() THREW ${error.name} (status ${error.status ?? '—'}) code ${error.code ?? '—'} — ${String(error.reason ?? error.message).slice(0, 160)}`;
}
console.log(`task       ${taskLine}`);
