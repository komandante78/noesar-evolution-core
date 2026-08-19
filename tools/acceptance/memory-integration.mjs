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
import { MemoryService, CANONICAL_WORKSPACE_ID } from '../../services/reference-control-plane/src/memory-service.mjs';
import { compactRun } from '../../services/reference-control-plane/src/memory-compaction.mjs';
import { EventLedger } from '../../services/reference-control-plane/src/events.mjs';
import { ModelSwapService } from '../../services/reference-control-plane/src/memory-model-swap.mjs';

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

  // ---- MEM-25..35 : ModelSwapService, CUBE-008's four steps, measured end-to-end -----
  const modelSwap = new ModelSwapService({ dataPlane: () => supervisor });
  const seededTotal = await admin.query('SELECT count(*)::int AS n FROM noesar_knowledge.memory_records');
  const totalRecords = seededTotal.rows[0].n;
  const deterministicEmbed = async (record) => Array.from(
    { length: 384 },
    (_, i) => ((record.id.charCodeAt(i % record.id.length) + i) % 97) / 97,
  );

  const modelA = 'a1000000-0000-4000-8000-000000000001';
  const registered = await modelSwap.registerModel({ id: modelA, name: 'test-model-a', dimensions: 384 });
  check('MEM-25', 'registerModel() (step 1) inserts a model with is_current:false', registered.is_current === false, JSON.stringify(registered));

  const coverageBefore = await modelSwap.coverage(modelA);
  check('MEM-26', 'coverage() before any backfill is 0 indexed, complete:false, real total from the corpus written above', coverageBefore.indexed === 0 && coverageBefore.complete === false && coverageBefore.total === totalRecords, JSON.stringify({ coverageBefore, totalRecords }));

  const backfillA = await modelSwap.backfillBatch({ modelId: modelA, embed: deterministicEmbed, batchSize: 1000 });
  check('MEM-27', 'backfillBatch() (step 2) indexes every pending record in one pass and reports 100% coverage', backfillA.processed === totalRecords && backfillA.coverage.complete === true, JSON.stringify(backfillA));

  await expectRejects('MEM-28', 'activate() refuses a model registered but never backfilled (0% coverage) — no partial cutover', () => {
    const modelUnbackfilled = 'a2000000-0000-4000-8000-000000000002';
    return modelSwap.registerModel({ id: modelUnbackfilled, name: 'test-model-unbackfilled', dimensions: 384 })
      .then(() => modelSwap.activate(modelUnbackfilled));
  });

  const activatedA = await modelSwap.activate(modelA);
  check('MEM-29', 'activate() (step 3) flips is_current to the newly-complete model', activatedA.is_current === true, JSON.stringify(activatedA));

  const onlyOneCurrent = await admin.query('SELECT count(*)::int AS n FROM noesar_knowledge.embedding_models WHERE is_current');
  check('MEM-30', 'exactly one model is is_current after activation, never zero or two', onlyOneCurrent.rows[0].n === 1, JSON.stringify(onlyOneCurrent.rows[0]));

  const recallAfterActivation = await memoryService.recall({}, { actorId: ownerId });
  check('MEM-31', 'recall() coverage.vectorIndexComplete becomes true once a real model is current and fully indexed — no longer the honest false from MEM-12', recallAfterActivation.coverage.vectorIndexComplete === true && recallAfterActivation.coverage.model === 'test-model-a', JSON.stringify(recallAfterActivation.coverage));

  await expectRejects('MEM-32', 'purgeSuperseded() refuses to delete the CURRENT model\'s index', () => modelSwap.purgeSuperseded(modelA));

  // A second model supersedes the first — the full swap lifecycle, not just one cutover.
  const modelB = 'b1000000-0000-4000-8000-000000000001';
  await modelSwap.registerModel({ id: modelB, name: 'test-model-b', dimensions: 384 });
  await modelSwap.backfillBatch({ modelId: modelB, embed: deterministicEmbed, batchSize: 1000 });
  await modelSwap.activate(modelB);
  const modelAVectorsBefore = await admin.query('SELECT count(*)::int AS n FROM noesar_knowledge.memory_vectors WHERE model_id = $1', [modelA]);
  const purged = await modelSwap.purgeSuperseded(modelA);
  check('MEM-33', 'purgeSuperseded() (step 4) deletes exactly the superseded model\'s index rows', purged.deleted === modelAVectorsBefore.rows[0].n && purged.deleted === totalRecords, JSON.stringify({ purged, before: modelAVectorsBefore.rows[0].n }));

  const recordsAfterPurge = await admin.query('SELECT count(*)::int AS n FROM noesar_knowledge.memory_records');
  check('MEM-34', 'purging an old index never touches memory_records — the records are the memory, the vector was only ever an index', recordsAfterPurge.rows[0].n === totalRecords, JSON.stringify(recordsAfterPurge.rows[0]));

  const recallAfterPurge = await memoryService.recall({}, { actorId: ownerId });
  check('MEM-35', 'recall() still reports a complete index after the old model is purged — served by the NEW current model throughout, never a gap', recallAfterPurge.coverage.vectorIndexComplete === true && recallAfterPurge.coverage.model === 'test-model-b', JSON.stringify(recallAfterPurge.coverage));

  // ── CE-011 · an induced fact is UNWRITABLE without its three parts ─────────────────────
  //
  // Hit DIRECTLY through the admin connection, not through MemoryService: the criterion's
  // method says *schema*, and a rule only the application enforces is a rule the next writer
  // walks around. `ce-011-induced-facts-are-falsifiable.test.mjs` covers the application half
  // and its error messages; these six are the guarantee.
  const insertInduced = ({ signature, condition = null, provenance = null, confirmations = 0 }) => admin.query(
    `INSERT INTO noesar_knowledge.memory_records
       (id, signature, workspace_id, owner_user_id, cube, category, content, provenance,
        promotion_state, observed_at, refutation_condition, confirmations)
     VALUES (gen_random_uuid(), $1, $2, $3, 'experience', 'lezione', 'i test accompagnano il codice',
             coalesce($4::jsonb, '{}'::jsonb), 'session', now(), $5, $6)`,
    [signature, CANONICAL_WORKSPACE_ID, ownerId, provenance === null ? null : JSON.stringify(provenance), condition, confirmations],
  );

  await expectRejects('MEM-37', 'the SCHEMA refuses an induced fact with no refutation condition — not the application, the table',
    () => insertInduced({ signature: 'ce011-no-condition', provenance: { commits: 42 }, confirmations: 42 }));

  await expectRejects('MEM-38', 'the SCHEMA refuses an induced fact whose evidence is an empty object — citing nothing is not citing',
    () => insertInduced({ signature: 'ce011-no-evidence', condition: 'un controesempio', confirmations: 42 }));

  await expectRejects('MEM-39', 'the SCHEMA refuses an induced fact observed zero times — "n times" with n = 0 is not an observation',
    () => insertInduced({ signature: 'ce011-no-count', condition: 'un controesempio', provenance: { commits: 42 }, confirmations: 0 }));

  await insertInduced({
    signature: 'ce011-complete', condition: 'un solo commit accettato che tocchi src senza toccare test',
    provenance: { commits: 42 }, confirmations: 42,
  });
  const inducedRow = await admin.query(
    `SELECT refutation_condition, confirmations, refutations, provenance
       FROM noesar_knowledge.memory_records WHERE signature = 'ce011-complete'`);
  check('MEM-40', 'a COMPLETE induced fact is written, and all three parts are on the row — the constraints refuse the missing case, not every case',
    inducedRow.rows[0]?.confirmations === 42 && String(inducedRow.rows[0]?.refutation_condition ?? '').includes('senza toccare test'),
    JSON.stringify(inducedRow.rows[0]));

  const libraryWithoutCondition = await admin.query(
    `SELECT count(*)::int AS n FROM noesar_knowledge.memory_records
      WHERE cube <> 'experience' AND refutation_condition IS NULL`);
  check('MEM-41', 'the rule is scoped to INDUCTION, not to memory: the other cubes carry no refutation condition and are perfectly writable',
    libraryWithoutCondition.rows[0].n > 0, JSON.stringify(libraryWithoutCondition.rows[0]));

  const throughService = await memoryService.write({
    actorId: ownerId, cube: 'experience', category: 'lezione',
    content: 'le due shell non divergono', signature: 'ce011-through-service',
    provenance: { osservazioni: 7 }, confirmations: 7,
    refutationCondition: 'una capacità raggiungibile in una shell e non nell\'altra',
  });
  check('MEM-42', 'end-to-end through MemoryService against real PostgreSQL: the three parts survive the typed view and come back on the item',
    throughService.refutationCondition?.includes('non nell\'altra') && throughService.confirmations === 7 && throughService.refutations === 0,
    JSON.stringify({ condition: throughService.refutationCondition, confirmations: throughService.confirmations }));

  // ── CE-012 · two embedding spaces are incomparable, and the database says so ───────────
  //
  // Model B is current and indexed; model C is registered and backfilled but never activated,
  // so two populated spaces exist at once — which is the only state in which the question can
  // even be asked. `vector_distance()` is the comparison this criterion needs to exist before
  // it can be refused.
  const modelC = 'c1000000-0000-4000-8000-000000000001';
  await modelSwap.registerModel({ id: modelC, name: 'test-model-c', dimensions: 384 });
  await modelSwap.backfillBatch({ modelId: modelC, embed: deterministicEmbed, batchSize: 1000 });
  const twoRecords = await admin.query(
    `SELECT record_id FROM noesar_knowledge.memory_vectors WHERE model_id = $1 ORDER BY record_id LIMIT 2`, [modelB]);
  const [r1, r2] = twoRecords.rows.map((row) => row.record_id);

  const sameSpace = await admin.query('SELECT noesar_knowledge.vector_distance($1,$2,$3,$4) AS d', [r1, modelB, r2, modelB]);
  check('MEM-43', 'within ONE space the comparison returns a number — the guard is a guard, not a refusal of everything',
    typeof Number(sameSpace.rows[0].d) === 'number' && Number.isFinite(Number(sameSpace.rows[0].d)),
    `distance=${sameSpace.rows[0].d}`);

  const selfDistance = await admin.query('SELECT noesar_knowledge.vector_distance($1,$2,$1,$2) AS d', [r1, modelB]);
  check('MEM-44', 'a vector against itself is distance 0 — the comparison is a real one, not a constant',
    Math.abs(Number(selfDistance.rows[0].d)) < 1e-9, `distance=${selfDistance.rows[0].d}`);

  await expectRejects('MEM-45', 'comparing ACROSS two spaces raises — an ERROR, never a number (CE-012)',
    () => admin.query('SELECT noesar_knowledge.vector_distance($1,$2,$3,$4) AS d', [r1, modelB, r2, modelC]));

  await expectRejects('MEM-46', 'a comparison with no model at all raises — a vector without the model that produced it is not comparable',
    () => admin.query('SELECT noesar_knowledge.vector_distance($1,NULL,$2,NULL) AS d', [r1, r2]));

  await expectRejects('MEM-47', 'an absent vector raises rather than reporting a distance of zero — "missing" and "identical" are not the same answer',
    () => admin.query('SELECT noesar_knowledge.vector_distance($1,$2,$3,$2) AS d',
      [r1, modelB, '00000000-0000-4000-8000-000000000000']));

  await admin.end();
  const stopped = await supervisor.stop();
  // Deliberately last in EXECUTION order, and keeps its original id: the ledger's `MEM-25..36`
  // entry refers to it, and renumbering a check to make a list look tidy breaks every reference
  // written before today.
  check('MEM-36', 'clean shutdown after the full memory-service exercise', stopped.clean === true, JSON.stringify(stopped));
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
