// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Phase 5, step 1 — the measurement that opens the phase.
//
// `16` §1 states the fact from reading the code: no surface produces the CONTENT of a file,
// and `workspace-actions.mjs:537` writes back what the caller passed. This drives the real
// orchestrator end to end on a real workspace, so the claim is measured rather than read:
// a prose request with NO files named, planned and approved, and then the bytes on disk
// compared with the bytes that were there before.
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes, createHash } from 'node:crypto';
import { WorkspaceActionOrchestrator } from '../services/reference-control-plane/src/workspace-actions.mjs';
import { TokenMinter } from '../services/reference-control-plane/src/capability.mjs';
import { EventLedger } from '../services/reference-control-plane/src/events.mjs';

const ws = mkdtempSync(join(tmpdir(), 'noesar-phase5-ws-'));
const shadows = mkdtempSync(join(tmpdir(), 'noesar-phase5-shadows-'));
const sha = (text) => createHash('sha256').update(text).digest('hex').slice(0, 16);

// A small but real repository: the request below names none of it.
mkdirSync(join(ws, 'src'), { recursive: true });
const LOGIN = `export function loginRoute(app) {
  app.post('/login', async (request, reply) => {
    const { user, password } = request.body;
    return reply.send(await authenticate(user, password));
  });
}
`;
writeFileSync(join(ws, 'src/login.js'), LOGIN);
writeFileSync(join(ws, 'src/rate-limit.js'), 'export function rateLimit() { /* not wired to login */ }\n');
writeFileSync(join(ws, 'README.md'), '# demo\n\nA login route with no rate limiting.\n');

const orch = new WorkspaceActionOrchestrator({
  workspaceRoot: ws, shadowsRoot: shadows,
  minter: new TokenMinter(randomBytes(32)), events: new EventLedger(),
});
const NOW = Math.floor(Date.now() / 1000);
const REQUEST = 'add rate limiting to the login route';

console.log('PHASE 5 — MISURA PRIMA\n');
console.log(`request: "${REQUEST}"   (files named by the caller: NONE)\n`);

const before = sha(readFileSync(join(ws, 'src/login.js'), 'utf8'));

let planned;
try {
  planned = await orch.plan({ request: REQUEST, files: [], actor: 'owner', nowUnix: NOW });
} catch (error) {
  console.log(`plan() REFUSED: ${error.code ?? error.name} — ${error.reason ?? error.message}`);
  rmSync(ws, { recursive: true, force: true }); rmSync(shadows, { recursive: true, force: true });
  process.exit(0);
}

console.log(`runId        ${planned.runId}`);
console.log(`status       ${planned.status}`);
console.log(`goal         ${planned.intent.goal}`);
console.log(`grounding    ${planned.grounding ? `${planned.grounding.method ?? 'repository'} — the repository chose the files` : 'null (the caller named them)'}`);
console.log('\nthe plan, step by step:');
for (const step of planned.plan.steps ?? []) {
  console.log(`  ${step.id}  ${step.description}`);
  console.log(`         files:    ${JSON.stringify(step.files)}`);
  console.log(`         commands: ${JSON.stringify(step.commands)}`);
}

// The question the whole phase exists to ask: does anything in that answer contain the
// CONTENT of a file? Search the entire plan for it.
const asText = JSON.stringify(planned);
console.log('\nis there any file CONTENT anywhere in what plan() returned?');
console.log(`  the answer carries the word "contents":      ${asText.includes('"contents"')}`);
console.log(`  the answer contains any line of src/login.js: ${LOGIN.split('\n').filter(Boolean).some((line) => asText.includes(line.trim()))}`);

// And now the end of the road: approve, and compare the bytes.
const approved = await orch.approve({ runId: planned.runId, approverId: 'owner', nowUnix: NOW + 1 });
const after = sha(readFileSync(join(ws, 'src/login.js'), 'utf8'));
console.log('\nafter approve():');
console.log(`  performed        ${JSON.stringify(approved.performed ?? approved.result?.performed ?? null)}`);
console.log(`  src/login.js     ${before} -> ${after}   ${before === after ? '*** UNCHANGED ***' : 'changed'}`);
console.log(`  verdict: the product ${before === after ? 'wrote back the bytes that were already there' : 'wrote new bytes'}`);

rmSync(ws, { recursive: true, force: true });
rmSync(shadows, { recursive: true, force: true });
