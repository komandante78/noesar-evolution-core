// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Phase 5, the measurement that closes it — the same workspace and the same prose request as
// `phase5-measure-before.mjs`, with the Author wired to a REAL model. Not a stub: a stub would
// have proved the wiring and nothing about the claim, and `17` rule 2 says a thing is not
// declared working until it has been executed in the session that declares it.
//
// Endpoint is taken from the environment so this file presumes no host (platform law):
//   NOESAR_AUTHORING_ENDPOINT   default http://127.0.0.1:8420
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes, createHash } from 'node:crypto';
import { WorkspaceActionOrchestrator } from '../services/reference-control-plane/src/workspace-actions.mjs';
import { Author, openAiChatGenerator, atomAuthoringGenerator } from '../services/reference-control-plane/src/author.mjs';
import { TokenMinter } from '../services/reference-control-plane/src/capability.mjs';
import { EventLedger } from '../services/reference-control-plane/src/events.mjs';

const ws = mkdtempSync(join(tmpdir(), 'noesar-phase5-ws-'));
const shadows = mkdtempSync(join(tmpdir(), 'noesar-phase5-shadows-'));
const sha = (text) => createHash('sha256').update(text).digest('hex').slice(0, 16);

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

const endpoint = process.env.NOESAR_AUTHORING_ENDPOINT ?? 'http://127.0.0.1:8420';
// The chain, when ATOM is reachable: any model below, ATOM above, ATOM is what answers.
// Falling back to the model directly is a DECLARED choice made here, at assembly, and never
// inside the port — the router rule is "never fall back in silence", not "never fall back".
const atomEndpoint = process.env.NOESAR_ATOM_ENDPOINT ?? null;
const atomToken = process.env.NOESAR_ATOM_TOKEN ?? '';
const generate = atomEndpoint
  ? atomAuthoringGenerator({ endpoint: atomEndpoint, token: atomToken })
  : openAiChatGenerator({ endpoint });
const events = new EventLedger();
const orch = new WorkspaceActionOrchestrator({
  workspaceRoot: ws, shadowsRoot: shadows,
  minter: new TokenMinter(randomBytes(32)), events,
  author: new Author({ generate, model: atomEndpoint ? `atom ${atomEndpoint}` : endpoint }),
});
const NOW = Math.floor(Date.now() / 1000);
const REQUEST = 'add rate limiting to the login route';

console.log('PHASE 5 — MISURA DOPO (Author wired to a live model)\n');
console.log(`request:  "${REQUEST}"   (files named by the caller: NONE)`);
console.log(`chain:    ${atomEndpoint ? `model ${endpoint} -> ATOM ${atomEndpoint} -> the answer` : `model ${endpoint} DIRECTLY (no ATOM in the chain)`}\n`);

const before = new Map(['src/login.js', 'src/rate-limit.js', 'README.md']
  .map((path) => [path, sha(readFileSync(join(ws, path), 'utf8'))]));

const started = Date.now();
const planned = await orch.plan({ request: REQUEST, files: [], actor: 'owner', nowUnix: NOW });
console.log(`planned in ${((Date.now() - started) / 1000).toFixed(1)}s\n`);
console.log('authoring, as the run reports it:');
console.log(`  available        ${planned.authoring.available}`);
console.log(`  reason           ${planned.authoring.reason ?? '(none — it ran)'}`);
console.log(`  authored         ${planned.authoring.authored}`);
console.log(`  unchanged        ${planned.authoring.unchanged ?? 0}   ${JSON.stringify(planned.authoring.unchangedPaths ?? [])}`);
console.log(`  refused          ${planned.authoring.refused ?? 0}   ${JSON.stringify((planned.authoring.refusals ?? []).map((item) => `${item.path}: ${item.code}`))}`);
console.log(`  paths discarded  ${planned.authoring.discardedPaths ?? 0}   ${JSON.stringify(planned.authoring.discarded ?? [])}`);
console.log(`  novelty          ${planned.authoring.novelty}`);
console.log(`  bytes written    ${planned.authoring.bytes}`);

await orch.approve({ runId: planned.runId, approverId: 'owner', nowUnix: NOW + 1 });

console.log('\nbytes on disk, before -> after approve():');
let changed = 0;
for (const [path, was] of before) {
  const now = sha(readFileSync(join(ws, path), 'utf8'));
  if (was !== now) changed += 1;
  console.log(`  ${path.padEnd(20)} ${was} -> ${now}   ${was === now ? 'unchanged' : '*** CHANGED ***'}`);
}
console.log(`\nverdict: ${changed} of ${before.size} files carry bytes nobody pasted.`);

console.log('\nsrc/login.js as the product wrote it:\n');
console.log(readFileSync(join(ws, 'src/login.js'), 'utf8'));

const authored = events.events();
const fixtureEvents = authored.filter((event) => event.action === 'workspace_action.authored').map((event) => JSON.parse(event.payload));
console.log(`ledger: ${fixtureEvents.length} authoring event(s), carrying ${fixtureEvents[0]?.fixtures?.length ?? 0} replayable fixtures`);
for (const fixture of fixtureEvents[0]?.fixtures ?? []) {
  console.log(`  ${fixture.path.padEnd(20)} ${fixture.outcome.padEnd(9)} checkedBy ${(fixture.provenance?.checkedBy ?? 'nobody').padEnd(6)} regenerated ${String(fixture.provenance?.regenerated ?? 'n/a').padEnd(5)} answer ${fixture.answerDigest.slice(0, 12)}`);
}

rmSync(ws, { recursive: true, force: true });
rmSync(shadows, { recursive: true, force: true });
