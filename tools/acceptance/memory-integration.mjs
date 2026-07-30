// SPDX-License-Identifier: AGPL-3.0-or-later
//
// In-container integration exercise for the memory-cube application layer (D-0263):
// MemoryService.write/recall/promote/ensureWorkspace and compactRun, against a REAL
// PostgreSQL cluster booted from nothing. Mirrors tools/acceptance/postgres-integration.mjs
// exactly (same supervisor, same pattern) — that file proves the SCHEMA and RLS; this one
// proves the CODE that sits on top of it actually works against real Postgres, not just the
// mocked FakeClient the unit tests use.
//
// Usage (inside the container):
//   node tools/acceptance/memory-integration.mjs

import fsp from 'node:fs/promises';
import { PostgresSupervisor, PostgresSupervisorInternals } from '../../services/reference-control-plane/src/postgres-supervisor.mjs';
import { PgConnection } from '../../services/reference-control-plane/src/pg-client.mjs';
import { MemoryService } from '../../services/reference-control-plane/src/memory-service.mjs';
import { compactRun } from '../../services/reference-control-plane/src/memory-compaction.mjs';
import { EventLedger } from '../../services/reference-control-plane/src/events.mjs';

const results = [];
let failures = 0;

function check(id, description, condition, evidence = '') {
  const ok = Boolean(condition);
  if (!ok) failures += 1;
  results.push({ id, description, status: ok ? 'PASS' : 'FAIL', evidence: String(evidence).slice(0, 400) });
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'} ${id} ${description}${evidence ? ` :: ${String(evidence).slice(0, 200)}` : ''}\n`);
}

async function expectRejects(id, description, fn) {
  try {
    const value = await fn();
    check(id, description, false, `expected a rejection, got ${JSON.stringify(value).slice(0, 160)}`);
  } catch (error) {
    check(id, description, true, error.message);
  }
}

const root = process.env.NOESAR_POSTGRES_ROOT ?? '/workspace/postgresql';

const supervisor = new PostgresSupervisor({
  root,
  secretsDir: '/workspace/config/postgres',
  migrationsDir: process.env.NOESAR_MIGRATIONS_DIR ?? '/opt/noesar/database/postgres',
});

async function main() {
  await supervisor.start();
  const health = await supervisor.health();
  check('MEM-01', 'cluster starts and every migration applies, including 0019', supervisor.state === 'ready' && health.migrationCount >= 19, `migrations=${health.migrationCount}`);

  const adminPassword = (await fsp.readFile(supervisor.adminSecretFile, 'utf8')).trim();
  const admin = new PgConnection({
    socketPath: supervisor.socketFile, user: PostgresSupervisorInternals.ADMIN_ROLE,
    database: PostgresSupervisorInternals.DATABASE, password: adminPassword,
  });
  await admin.connect();

  // ---- MEM-02..03 : ensureWorkspace() before any owner exists, then after -----------
  const memoryService = new MemoryService({ dataPlane: () => supervisor });
  const beforeOwner = await memoryService.ensureWorkspace();
  check('MEM-02', 'ensureWorkspace() refuses gracefully with no owner projected yet', beforeOwner.ensured === false, JSON.stringify(beforeOwner));

  const ownerId = '49d45b59-4b7a-4088-a6bf-5067253acfb1';
  await admin.query(
    `INSERT INTO noesar_identity.users
       (id, username, display_name, role, password_scheme, password_salt, password_hash, password_parameters, status, mfa_required)
     VALUES ($1,'owner-test','Owner','owner','argon2id','\\x00'::bytea,'\\x00'::bytea,'{}'::jsonb,'active',true)`,
    [ownerId],
  );
  const afterOwner = await memoryService.ensureWorkspace();
  check('MEM-03', 'ensureWorkspace() provisions the canonical workspace once an owner exists', afterOwner.ensured === true, JSON.stringify(afterOwner));

  const secondCall = await memoryService.ensureWorkspace();
  check('MEM-04', 'ensureWorkspace() is idempotent on a second call', secondCall.ensured === true, JSON.stringify(secondCall));

  // ---- MEM-05..09 : write() through the real views, real RLS ------------------------
  const libItem = await memoryService.write({
    actorId: ownerId, cube: 'library', category: 'decisione', content: 'PostgreSQL è autoritativo per la memoria.',
    signature: `library/mem-integration/${Date.now()}-01-decisione`, promotionState: 'global',
  });
  check('MEM-05', 'write() inserts through library_memories and returns the row', libItem.cube === 'library' && libItem.content.includes('PostgreSQL'), JSON.stringify(libItem));

  const wsItem = await memoryService.write({
    actorId: ownerId, cube: 'workshop', category: 'fatto', content: 'Migrazione 0019 verificata dal vivo.',
    signature: `workshop/mem-integration/${Date.now()}-02-fatto`, promotionState: 'project-candidate',
  });
  check('MEM-06', 'write() inserts through workshop_memories with project-candidate state', wsItem.promotionState === 'project-candidate', JSON.stringify(wsItem));

  await expectRejects('MEM-07', 'write() derived:true with no derivedFrom is refused before it reaches SQL',
    () => memoryService.write({
      actorId: ownerId, cube: 'workshop', category: 'lezione', content: 'x',
      signature: `workshop/x/${Date.now()}-03-lezione`, derived: true,
    }));

  // Contamination canary, against REAL rows: a source marked 'suspect', then a derived
  // record citing it that CLAIMS 'verified' — the write must not honour that claim.
  // write()'s own return value carries no `id` (ITEM_COLUMNS never exposes it, since
  // application code addresses records by their citable signature, not the internal
  // uuid) — fetched back via the admin connection, the same way any caller assembling a
  // derivedFrom list from prior recall() results would need to resolve one anyway.
  const suspectSource = await memoryService.write({
    actorId: ownerId, cube: 'workshop', category: 'fatto', content: 'Fonte sospetta, per il test del canary.',
    signature: `workshop/canary/${Date.now()}-04-fatto`, contamination: 'suspect',
  });
  const suspectRow = await admin.query('SELECT id FROM noesar_knowledge.memory_records WHERE signature = $1', [suspectSource.signature]);
  const suspectId = suspectRow.rows[0]?.id;

  const canaryItem = suspectId ? await memoryService.write({
    actorId: ownerId, cube: 'workshop', category: 'lezione', content: 'Derivato dalla fonte sospetta sopra.',
    signature: `workshop/canary/${Date.now()}-05-lezione`, derived: true, derivedFrom: [suspectId], contamination: 'verified',
  }) : null;
  check('MEM-08', 'the contamination canary escalates a derived record that cites a suspect source, overriding a "verified" claim',
    canaryItem?.contamination === 'suspect', JSON.stringify(canaryItem));

  await expectRejects('MEM-09', 'CUBE-004 still holds through the service layer: no bypass of the typed views exists here either',
    () => memoryService.write({ actorId: ownerId, cube: 'not-a-cube', category: 'fatto', content: 'x', signature: 'x' }));

  // ---- MEM-10..14 : recall() end-to-end, real coverage/not_found --------------------
  const recallAll = await memoryService.recall({}, { actorId: ownerId });
  check('MEM-10', 'recall() with no filters returns items across cubes via all_memories', recallAll.items.some((i) => i.cube === 'library') && recallAll.items.some((i) => i.cube === 'workshop'), `cubes: ${[...new Set(recallAll.items.map((i) => i.cube))].join(',')}`);
  check('MEM-11', 'recall() coverage always travels with the result', typeof recallAll.coverage.candidates === 'number' && typeof recallAll.coverage.vectorIndexComplete === 'boolean', JSON.stringify(recallAll.coverage));
  check('MEM-12', 'recall() coverage.vectorIndexComplete is honestly false with no embedding model configured', recallAll.coverage.vectorIndexComplete === false && recallAll.coverage.model === null, JSON.stringify(recallAll.coverage));

  const recallScoped = await memoryService.recall({ cube: 'library' }, { actorId: ownerId });
  check('MEM-13', 'recall() with a cube filter never returns a row from another cube (CUBE-004, at the recall layer too)', recallScoped.items.every((i) => i.cube === 'library'), `cubes: ${[...new Set(recallScoped.items.map((i) => i.cube))].join(',')}`);

  const recallEmpty = await memoryService.recall({ query: 'una frase che sicuramente non esiste da nessuna parte 9x7z' }, { actorId: ownerId });
  check('MEM-14', 'recall() reports not_found explicitly instead of a silent empty list', recallEmpty.items.length === 0 && recallEmpty.notFound.includes('testo di ricerca'), JSON.stringify(recallEmpty));

  // ---- MEM-15..18 : promote(), real state machine, real visibility widening ---------
  const candidatesBefore = await memoryService.listCandidates();
  check('MEM-15', 'listCandidates() sees the project-candidate written above', candidatesBefore.some((c) => c.signature === wsItem.signature), `${candidatesBefore.length} candidates`);

  const promoted = await memoryService.promote({ signature: wsItem.signature, cube: 'workshop', decision: 'approve', actorId: ownerId });
  check('MEM-16', 'promote(approve) moves project-candidate -> project and widens visibility', promoted.promotionState === 'project', JSON.stringify(promoted));

  const visibilityRow = await admin.query('SELECT visibility FROM noesar_knowledge.memory_records WHERE signature = $1', [wsItem.signature]);
  check('MEM-17', 'promote() actually wrote visibility=project on the row, not just the return value', visibilityRow.rows[0]?.visibility === 'project', JSON.stringify(visibilityRow.rows[0]));

  await expectRejects('MEM-18', 'promote() refuses a record that is not awaiting promotion (already project)',
    () => memoryService.promote({ signature: wsItem.signature, cube: 'workshop', decision: 'approve', actorId: ownerId }));

  const rejectCandidate = await memoryService.write({
    actorId: ownerId, cube: 'library', category: 'fatto', content: 'Candidato che verrà rifiutato.',
    signature: `library/reject-test/${Date.now()}-07-fatto`, promotionState: 'global-candidate',
  });
  const rejected = await memoryService.promote({ signature: rejectCandidate.signature, cube: 'library', decision: 'reject', actorId: ownerId });
  check('MEM-19', 'promote(reject) moves a candidate to revoked', rejected.promotionState === 'revoked', JSON.stringify(rejected));

  // ---- MEM-20..23 : compactRun(), a real workspace-actions-shaped EventLedger -------
  const ledger = new EventLedger();
  const runId = 'mem-integration-run';
  ledger.append({ id: 'ev1', correlationId: runId, actor: ownerId, action: 'workspace_action.planned', payload: JSON.stringify({ goal: 'verify compaction end-to-end', risk: 'low', files: ['x.mjs'] }), recordedAtUnix: Math.floor(Date.now() / 1000) });
  ledger.append({ id: 'ev2', correlationId: runId, causationId: 'ev1', actor: ownerId, action: 'workspace_action.simulated', payload: JSON.stringify({ supported: false }), recordedAtUnix: Math.floor(Date.now() / 1000) });
  ledger.append({ id: 'ev3', correlationId: runId, causationId: 'ev1', actor: ownerId, action: 'workspace_action.approved', payload: JSON.stringify({ approverId: ownerId }), recordedAtUnix: Math.floor(Date.now() / 1000) });

  const compaction = await compactRun({ ledger, memoryService }, { runId });
  check('MEM-20', 'compactRun() writes real memory_records rows for recognised events', compaction.written.length === 2, JSON.stringify({ written: compaction.written.length, skipped: compaction.skipped }));
  check('MEM-21', 'compactRun() skips the unrecognised event (simulated is noise, not a decision/fact)', compaction.skipped === 1, `skipped=${compaction.skipped}`);

  const compactedRows = await admin.query(
    `SELECT cube, category, promotion_state FROM noesar_knowledge.memory_records WHERE provenance->>'runId' = $1 ORDER BY observed_at ASC`,
    [runId],
  );
  check('MEM-22', 'the compacted rows landed in workshop, project-candidate, with the run id in provenance', compactedRows.rows.length === 2 && compactedRows.rows.every((r) => r.cube === 'workshop' && r.promotion_state === 'project-candidate'), JSON.stringify(compactedRows.rows));
  check('MEM-23', 'the two compacted categories match the event mapping (decisione for planned, decisione for approved)', compactedRows.rows.every((r) => r.category === 'decisione'), JSON.stringify(compactedRows.rows));

  await admin.end();
  const stopped = await supervisor.stop();
  check('MEM-24', 'clean shutdown after the full memory-service exercise', stopped.clean === true, JSON.stringify(stopped));
}

main()
  .then(async () => {
    const passed = results.filter((r) => r.status === 'PASS').length;
    process.stdout.write(`\nMEMORY_INTEGRATION ${passed}/${results.length} PASS, ${failures} FAIL\n`);
    process.exit(failures === 0 ? 0 : 1);
  })
  .catch(async (error) => {
    process.stdout.write(`\nFATAL ${error?.stack ?? error}\n`);
    try { await supervisor.stop(); } catch { /* already down */ }
    process.exit(2);
  });
