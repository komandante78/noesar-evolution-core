// SPDX-License-Identifier: AGPL-3.0-or-later
//
// In-container integration exercise for the PostgreSQL 18 data plane.
//
// This is not a unit test and deliberately does not live in the unit suite: it needs
// real PostgreSQL binaries, so it can only run inside the product image. It boots a
// cluster from nothing, applies every migration, exercises pgvector, proves Row Level
// Security actually denies, takes and restores a backup, kills the server to prove
// recovery, and shuts down cleanly.
//
// Usage (inside the container):
//   node tools/acceptance/postgres-integration.mjs

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { PostgresSupervisor, PostgresSupervisorInternals } from '../../services/reference-control-plane/src/postgres-supervisor.mjs';
import { PgConnection } from '../../services/reference-control-plane/src/pg-client.mjs';

const results = [];
let failures = 0;

function check(id, description, condition, evidence = '') {
  const ok = Boolean(condition);
  if (!ok) failures += 1;
  results.push({ id, description, status: ok ? 'PASS' : 'FAIL', evidence: String(evidence).slice(0, 400) });
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'} ${id} ${description}${evidence ? ` :: ${String(evidence).slice(0, 200)}` : ''}\n`);
}

async function expectDenied(id, description, fn) {
  try {
    const value = await fn();
    check(id, description, false, `expected a denial, got ${JSON.stringify(value).slice(0, 160)}`);
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
  // ---- DB-01..DB-05 : lifecycle -------------------------------------------------
  const startedAt = Date.now();
  await supervisor.start();
  check('DB-01', 'cluster starts from an empty data directory', supervisor.state === 'ready',
    `state=${supervisor.state} in ${Date.now() - startedAt} ms`);

  const health = await supervisor.health();
  check('DB-02', 'server is PostgreSQL 18 or newer', health.serverVersionNumber >= 180000,
    health.serverVersion);
  check('DB-03', 'pgvector extension is installed', Boolean(health.pgvectorVersion),
    `pgvector ${health.pgvectorVersion}`);
  check('DB-04', 'the application role cannot bypass RLS', health.checks.appRoleNoBypassRls,
    `effective_role=${health.effectiveRole}`);
  check('DB-05', 'row level security is enforced on noesar tables', health.rlsTables > 0,
    `${health.rlsTables} tables with relrowsecurity`);

  // ---- DB-06..DB-08 : migrations -------------------------------------------------
  const files = await supervisor.listMigrations();
  check('DB-06', 'every migration file on disk was applied', supervisor.appliedMigrations.length === files.length,
    `applied=${supervisor.appliedMigrations.length} of ${files.length}`);

  const rerun = await supervisor.applyMigrations();
  check('DB-07', 'a second migration run applies nothing and skips everything',
    rerun.applied.length === 0 && rerun.skipped.length === files.length,
    `applied=${rerun.applied.length} skipped=${rerun.skipped.length}`);

  // Read the product's own immutable ledger, not the supervisor's bookkeeping schema:
  // the application role has no privilege on the latter, which is itself the point.
  const ledger = await supervisor.pool.query(
    'SELECT version, filename, sha256 FROM noesar_runtime.schema_migrations ORDER BY version',
  );
  check('DB-08', 'the product migration ledger records a sha256 for every file',
    ledger.rows.length === files.length && ledger.rows.every((r) => /^[0-9a-f]{64}$/.test(r.sha256)),
    `${ledger.rows.length} ledger rows of ${files.length}`);

  await expectDenied('DB-08b', 'the application role cannot write the migration ledger',
    () => supervisor.pool.query(
      "INSERT INTO noesar_runtime.schema_migrations (version, filename, sha256, applied_by)"
      + " VALUES ('9999','forged.sql', repeat('a',64), 'attacker')",
    ));

  // ---- DB-09..DB-11 : connection surface ----------------------------------------
  const hba = await fsp.readFile(path.join(supervisor.dataDir, 'pg_hba.conf'), 'utf8');
  check('DB-09', 'pg_hba.conf contains no host or hostssl rule',
    !/^\s*host/m.test(hba), hba.split('\n').filter((l) => l && !l.startsWith('#')).join(' / '));
  const conf = await fsp.readFile(path.join(supervisor.dataDir, 'postgresql.auto.conf'), 'utf8');
  check('DB-10', "listen_addresses is empty so no TCP socket is opened",
    /listen_addresses\s*=\s*''/.test(conf), 'listen_addresses = \'\'');
  const socketMode = (await fsp.stat(supervisor.socketDir)).mode & 0o777;
  check('DB-11', 'the socket directory is not group or world accessible', socketMode === 0o700,
    `mode=0${socketMode.toString(8)}`);

  // ---- DB-12..DB-13 : credentials -------------------------------------------------
  const adminMode = (await fsp.stat(supervisor.adminSecretFile)).mode & 0o777;
  const appMode = (await fsp.stat(supervisor.appSecretFile)).mode & 0o777;
  check('DB-12', 'generated credentials are stored 0600', adminMode === 0o600 && appMode === 0o600,
    `admin=0${adminMode.toString(8)} app=0${appMode.toString(8)}`);
  const envLeak = Object.entries(process.env)
    .filter(([, v]) => typeof v === 'string' && v.length > 20
      && (v === fs.readFileSync(supervisor.adminSecretFile, 'utf8').trim()
        || v === fs.readFileSync(supervisor.appSecretFile, 'utf8').trim()));
  check('DB-13', 'no database password is present in the process environment',
    envLeak.length === 0, `${envLeak.length} matching environment entries`);

  // ---- DB-14..DB-19 : pgvector ----------------------------------------------------
  const app = supervisor.pool;
  const wsA = crypto.randomUUID();
  const wsB = crypto.randomUUID();
  const projA = crypto.randomUUID();
  const userA = crypto.randomUUID();
  const userB = crypto.randomUUID();

  await app.query(`
    CREATE TABLE IF NOT EXISTS noesar_knowledge.vector_probe (
      id uuid PRIMARY KEY,
      workspace_id uuid NOT NULL,
      embedding vector(384) NOT NULL
    )`).catch(async (error) => {
    // The application role has no CREATE on the schema by design. Use the admin
    // connection for the probe table, which is exactly what a migration would do.
    const adminPassword = (await fsp.readFile(supervisor.adminSecretFile, 'utf8')).trim();
    const admin = new PgConnection({
      socketPath: supervisor.socketFile, user: PostgresSupervisorInternals.ADMIN_ROLE,
      database: PostgresSupervisorInternals.DATABASE, password: adminPassword,
    });
    await admin.connect();
    await admin.query(`
      CREATE TABLE IF NOT EXISTS noesar_knowledge.vector_probe (
        id uuid PRIMARY KEY,
        workspace_id uuid NOT NULL,
        embedding vector(384) NOT NULL
      );
      GRANT SELECT, INSERT, UPDATE, DELETE ON noesar_knowledge.vector_probe TO noesar_app;
    `);
    await admin.end();
    return { note: `fell back to admin DDL: ${error.message}` };
  });

  const vec = (seed) => `[${Array.from({ length: 384 }, (_, i) => ((i * seed) % 7) / 7).join(',')}]`;
  await app.query('DELETE FROM noesar_knowledge.vector_probe');
  await app.query(
    'INSERT INTO noesar_knowledge.vector_probe (id, workspace_id, embedding) VALUES ($1,$2,$3),($4,$5,$6)',
    [crypto.randomUUID(), wsA, vec(1), crypto.randomUUID(), wsA, vec(5)],
  );
  const inserted = await app.query('SELECT count(*)::int AS n FROM noesar_knowledge.vector_probe');
  check('DB-14', 'vector insert stores 384-dimension embeddings', inserted.rows[0].n === 2,
    `${inserted.rows[0].n} rows`);

  const nearest = await app.query(
    'SELECT id, (embedding <-> $1) AS distance FROM noesar_knowledge.vector_probe ORDER BY embedding <-> $1 LIMIT 1',
    [vec(1)],
  );
  check('DB-15', 'L2 nearest-neighbour search returns the exact match first',
    nearest.rows.length === 1 && Number(nearest.rows[0].distance) === 0,
    `distance=${nearest.rows[0]?.distance}`);

  const cosine = await app.query(
    'SELECT (embedding <=> $1) AS d FROM noesar_knowledge.vector_probe ORDER BY embedding <=> $1 DESC LIMIT 1',
    [vec(1)],
  );
  check('DB-16', 'cosine distance operator works', Number(cosine.rows[0].d) > 0,
    `cosine=${cosine.rows[0]?.d}`);

  const deleted = await app.query(
    'DELETE FROM noesar_knowledge.vector_probe RETURNING id',
  );
  check('DB-17', 'vector delete removes rows', deleted.rowCount === 2, `${deleted.rowCount} deleted`);

  await expectDenied('DB-18', 'a wrong-dimension embedding is rejected by the column type',
    () => app.query(
      'INSERT INTO noesar_knowledge.vector_probe (id, workspace_id, embedding) VALUES ($1,$2,$3)',
      [crypto.randomUUID(), wsA, '[1,2,3]'],
    ));

  // ---- DB-19..DB-24 : Row Level Security ------------------------------------------
  const withContext = async (context, fn) => {
    const client = await app.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('noesar.actor_id', $1, true)", [context.actorId]);
      await client.query("SELECT set_config('noesar.workspace_id', $1, true)", [context.workspaceId]);
      await client.query("SELECT set_config('noesar.project_id', $1, true)", [context.projectId ?? '']);
      const value = await fn(client);
      await client.query('COMMIT');
      return value;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  };

  const adminPassword = (await fsp.readFile(supervisor.adminSecretFile, 'utf8')).trim();
  const admin = new PgConnection({
    socketPath: supervisor.socketFile, user: PostgresSupervisorInternals.ADMIN_ROLE,
    database: PostgresSupervisorInternals.DATABASE, password: adminPassword,
    statementTimeoutMs: 60000,
  });
  await admin.connect();

  const seeded = await seedWorkspaces(admin, { wsA, wsB, projA, userA, userB });
  check('DB-19', 'seed data for two workspaces was created', seeded.ok, seeded.detail);

  if (seeded.ok) {
    const visibleToA = await withContext(
      { actorId: userA, workspaceId: wsA },
      (c) => c.query('SELECT id FROM noesar_core.workspaces'),
    );
    check('DB-20', 'a workspace-scoped read sees exactly its own workspace',
      visibleToA.rows.length === 1 && visibleToA.rows[0].id === wsA,
      `${visibleToA.rows.length} rows`);

    const crossTenant = await withContext(
      { actorId: userA, workspaceId: wsA },
      (c) => c.query('SELECT id FROM noesar_core.workspaces WHERE id = $1', [wsB]),
    );
    check('DB-21', "RLS hides another tenant's workspace even when named directly",
      crossTenant.rows.length === 0, `${crossTenant.rows.length} rows leaked`);

    await expectDenied('DB-22', 'a write into another workspace is refused by the WITH CHECK clause',
      () => withContext({ actorId: userA, workspaceId: wsA }, (c) => c.query(
        `INSERT INTO noesar_knowledge.documents
           (id, workspace_id, project_id, logical_path, media_type, content_sha256, classification, created_by)
         VALUES ($1,$2,NULL,'/x','text/plain',$3,'internal',$4)`,
        [crypto.randomUUID(), wsB, crypto.createHash('sha256').update('x').digest('hex'), userA],
      )));

    // With no session GUC set, current_setting(..., true) is NULL, every policy
    // predicate evaluates to NULL, and NULL is not true — so the default is deny.
    const noContext = await app.query('SELECT id FROM noesar_core.workspaces');
    check('DB-23', 'a read with no workspace context returns nothing at all',
      noContext.rows.length === 0, `${noContext.rows.length} rows visible without context`);
  }

  const bypass = await app.query(
    'SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user',
  );
  check('DB-24', 'the runtime role still cannot bypass RLS at run time',
    bypass.rows[0].rolbypassrls === false, `rolbypassrls=${bypass.rows[0].rolbypassrls}`);

  // ---- DB-34..DB-40 : per-user isolation INSIDE one workspace ----------------------
  //
  // This is the case F4-008 recorded as unenforceable: two people who legitimately share
  // a workspace and a project, where tenancy scoping alone lets each read the other's
  // private data.
  const userC = crypto.randomUUID();
  const privateDoc = crypto.randomUUID();
  const sharedDoc = crypto.randomUUID();
  const privateVector = crypto.randomUUID();
  let userIsolationSeeded = false;
  try {
    await admin.query(
      `INSERT INTO noesar_identity.users
         (id, username, display_name, role, password_scheme, password_salt,
          password_hash, password_parameters, status)
       VALUES ($1,$2,'User C','user','argon2id','\\x00'::bytea,'\\x00'::bytea,'{}'::jsonb,'active')`,
      [userC, `user-c-${userC.slice(0, 8)}`],
    );
    await admin.query(
      `INSERT INTO noesar_core.workspace_members (workspace_id, user_id, role) VALUES ($1,$2,'user')`,
      [wsA, userC],
    );
    await admin.query(
      `INSERT INTO noesar_core.project_members (project_id, user_id, role) VALUES ($1,$2,'user')`,
      [projA, userC],
    );
    const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
    await admin.query(
      `INSERT INTO noesar_knowledge.documents
         (id, workspace_id, project_id, logical_path, media_type, content_sha256,
          classification, created_by, owner_user_id, visibility)
       VALUES ($1,$2,$3,'/c-private.txt','text/plain',$4,'internal',$5,$5,'private'),
              ($6,$2,$3,'/c-shared.txt','text/plain',$7,'internal',$5,$5,'project')`,
      [privateDoc, wsA, projA, sha('private'), userC, sharedDoc, sha('shared')],
    );
    await admin.query(
      `INSERT INTO noesar_knowledge.vector_entries
         (id, workspace_id, project_id, owner_user_id, source_kind, content, embedding, visibility)
       VALUES ($1,$2,$3,$4,'document','C private note',$5,'private')`,
      [privateVector, wsA, projA, userC, vec(3)],
    );
    userIsolationSeeded = true;
  } catch (error) {
    check('DB-34', 'per-user isolation fixtures were created', false, error.message);
  }

  if (userIsolationSeeded) {
    check('DB-34', 'per-user isolation fixtures were created', true,
      'user C in the same workspace and project as user A');

    const aSeesC = await withContext(
      { actorId: userA, workspaceId: wsA, projectId: projA },
      (c) => c.query('SELECT id, logical_path FROM noesar_knowledge.documents ORDER BY logical_path'),
    );
    const paths = aSeesC.rows.map((r) => r.logical_path);
    check('DB-35', "a private document of another user in the SAME project is invisible",
      !paths.includes('/c-private.txt'), `visible: ${paths.join(', ') || 'none'}`);
    check('DB-36', 'a project-visibility document of another user IS visible to a project member',
      paths.includes('/c-shared.txt'), `visible: ${paths.join(', ') || 'none'}`);

    // The row is visible, so the UPDATE selects it and then fails the WITH CHECK: a hard
    // error, not a silent no-op. That is the stronger of the two possible behaviours —
    // a caller cannot mistake "refused" for "nothing matched".
    await expectDenied('DB-37', 'a readable-but-not-owned document cannot be modified',
      () => withContext(
        { actorId: userA, workspaceId: wsA, projectId: projA },
        (c) => c.query(
          "UPDATE noesar_knowledge.documents SET classification = 'tampered' WHERE id = $1 RETURNING id",
          [sharedDoc],
        ),
      ));
    const untouched = await withContext(
      { actorId: userC, workspaceId: wsA, projectId: projA },
      (c) => c.query('SELECT classification FROM noesar_knowledge.documents WHERE id = $1', [sharedDoc]),
    );
    check('DB-37b', 'the refused update left the row unchanged',
      untouched.rows[0]?.classification === 'internal',
      `classification=${untouched.rows[0]?.classification}`);

    const vectorSearch = await withContext(
      { actorId: userA, workspaceId: wsA, projectId: projA },
      (c) => c.query(
        `SELECT id, content FROM noesar_knowledge.vector_entries
          ORDER BY embedding <=> $1 LIMIT 10`,
        [vec(3)],
      ),
    );
    check('DB-38', "vector search never returns another user's private entry",
      vectorSearch.rows.length === 0,
      `${vectorSearch.rows.length} rows: ${vectorSearch.rows.map((r) => r.content).join(' | ')}`);

    const cSeesOwn = await withContext(
      { actorId: userC, workspaceId: wsA, projectId: projA },
      (c) => c.query('SELECT logical_path FROM noesar_knowledge.documents ORDER BY logical_path'),
    );
    check('DB-39', 'the owner still sees their own private document',
      cSeesOwn.rows.map((r) => r.logical_path).includes('/c-private.txt'),
      cSeesOwn.rows.map((r) => r.logical_path).join(', '));

    const selfRow = await withContext(
      { actorId: userA, workspaceId: wsA },
      (c) => c.query('SELECT id FROM noesar_identity.users'),
    );
    check('DB-40', 'the identity table exposes only the acting user',
      selfRow.rows.length === 1 && selfRow.rows[0].id === userA,
      `${selfRow.rows.length} rows`);

    // Migration 0007 enabled RLS on the audit ledger with a SELECT-only policy, so an
    // append had no applicable policy and was denied. 0015 adds the INSERT policy.
    const auditId = crypto.randomUUID();
    // The chain is per workspace (the trigger locks on workspace_id), so the head must be
    // read per workspace too.
    const chainHead = await admin.query(
      `SELECT event_hash FROM noesar_audit.events
        WHERE workspace_id IS NOT DISTINCT FROM $1
        ORDER BY occurred_at DESC, id DESC LIMIT 1`,
      [wsA],
    );
    const previousHash = chainHead.rows[0]?.event_hash
      ?? '0'.repeat(64);
    let auditAppended = false;
    let auditError = '';
    try {
      await withContext({ actorId: userA, workspaceId: wsA }, (c) => c.query(
        `INSERT INTO noesar_audit.events
           (id, actor_user_id, workspace_id, action, result, details, previous_hash, event_hash)
         VALUES ($1,$2,$3,'acceptance.probe','allowed','{}'::jsonb,$4,$5)`,
        [auditId, userA, wsA, previousHash,
          crypto.createHash('sha256').update(auditId + previousHash).digest('hex')],
      ));
      auditAppended = true;
    } catch (error) {
      auditError = error.message;
    }
    check('DB-41', 'an audit event can actually be appended by the application role',
      auditAppended, auditError || 'appended');

    await expectDenied('DB-42', 'an appended audit event cannot be deleted',
      () => admin.query('DELETE FROM noesar_audit.events WHERE id = $1', [auditId]));
  }

  const acceptance = await app.query('SELECT * FROM noesar_runtime.security_acceptance');
  const row = acceptance.rows[0] ?? {};
  check('DB-43', 'the product security_acceptance view reports migrations verified',
    row.migration_count_verified === true, JSON.stringify(row));
  check('DB-44', 'the product security_acceptance view reports user isolation verified',
    row.user_isolation_verified === true && row.user_isolation_restrictive === true,
    `user_isolation_verified=${row.user_isolation_verified} restrictive=${row.user_isolation_restrictive}`);

  // ---- CUBE04-01..CUBE04-08 : CUBE-004, the typed views 0018 puts in front of
  // memory_records --------------------------------------------------------------------
  //
  // 14_MEMORIA_A_CUBI.md's CUBE-004 (Critical) demands "no programming error" can
  // return one cube's row as another's. D-0261 found the concrete schema 0017 builds
  // (14 §9.2, one table + an ENUM column) does not satisfy that by itself; migration
  // 0018 (D-0262, the Owner's chosen fix) puts four typed views in front of
  // memory_records and revokes direct access. These are the "test di tipo/schema che
  // tenta la confusione e verifica il rifiuto strutturale" CUBE-004's own acceptance
  // row asks for -- structural rejection, not an application-level convention.
  await expectDenied('CUBE04-01', 'the application role cannot SELECT memory_records directly',
    () => app.query('SELECT 1 FROM noesar_knowledge.memory_records LIMIT 1'));
  await expectDenied('CUBE04-01b', 'the application role cannot INSERT into memory_records directly',
    () => app.query(
      `INSERT INTO noesar_knowledge.memory_records
         (id, cube, signature, workspace_id, owner_user_id, category, content,
          provenance, promotion_state, observed_at)
       VALUES ($1,'library',$2,$3,$4,'decisione','x','{}'::jsonb,'session',now())`,
      [crypto.randomUUID(), `cube04-direct-${crypto.randomUUID().slice(0, 8)}`, wsA, userA],
    ));

  const libId = crypto.randomUUID();
  const libInsert = await withContext(
    { actorId: userA, workspaceId: wsA, projectId: projA },
    (c) => c.query(
      `INSERT INTO noesar_knowledge.library_memories
         (id, signature, workspace_id, project_id, owner_user_id,
          category, content, provenance, promotion_state, observed_at)
       VALUES ($1,$2,$3,$4,$5,'decisione','library test row','{}'::jsonb,'session',now())
       RETURNING cube`,
      [libId, `cube04-lib-${libId.slice(0, 8)}`, wsA, projA, userA],
    ),
  );
  check('CUBE04-02', 'an INSERT through library_memories with no cube column defaults to library',
    libInsert.rows[0]?.cube === 'library', `cube=${libInsert.rows[0]?.cube}`);

  const wsId = crypto.randomUUID();
  const wsInsert = await withContext(
    { actorId: userA, workspaceId: wsA, projectId: projA },
    (c) => c.query(
      `INSERT INTO noesar_knowledge.workshop_memories
         (id, signature, workspace_id, project_id, owner_user_id,
          category, content, provenance, promotion_state, observed_at)
       VALUES ($1,$2,$3,$4,$5,'procedura','workshop test row','{}'::jsonb,'session',now())
       RETURNING cube`,
      [wsId, `cube04-wk-${wsId.slice(0, 8)}`, wsA, projA, userA],
    ),
  );
  check('CUBE04-03', 'an INSERT through workshop_memories with no cube column defaults to workshop',
    wsInsert.rows[0]?.cube === 'workshop', `cube=${wsInsert.rows[0]?.cube}`);

  await expectDenied('CUBE04-04',
    'inserting a library-cube row through the workshop view is rejected structurally, not conventionally',
    () => withContext({ actorId: userA, workspaceId: wsA, projectId: projA }, (c) => c.query(
      `INSERT INTO noesar_knowledge.workshop_memories
         (id, cube, signature, workspace_id, project_id, owner_user_id,
          category, content, provenance, promotion_state, observed_at)
       VALUES ($1,'library',$2,$3,$4,$5,'decisione','smuggled row','{}'::jsonb,'session',now())`,
      [crypto.randomUUID(), `cube04-smuggle-${crypto.randomUUID().slice(0, 8)}`, wsA, projA, userA],
    )));

  const throughLibrary = await withContext(
    { actorId: userA, workspaceId: wsA, projectId: projA },
    (c) => c.query('SELECT id FROM noesar_knowledge.library_memories WHERE id = $1 OR id = $2', [libId, wsId]),
  );
  const throughLibraryIds = throughLibrary.rows.map((r) => r.id);
  check('CUBE04-05',
    'the library view returns its own row and never the workshop row from the same owner/workspace',
    throughLibraryIds.includes(libId) && !throughLibraryIds.includes(wsId),
    `rows: ${throughLibraryIds.join(', ') || 'none'}`);

  await expectDenied('CUBE04-06', 'an UPDATE through a view that would move a row out of its own cube is refused',
    () => withContext({ actorId: userA, workspaceId: wsA, projectId: projA }, (c) => c.query(
      `UPDATE noesar_knowledge.library_memories SET cube = 'workshop' WHERE id = $1 RETURNING id`,
      [libId],
    )));
  const cubeUnchanged = await withContext(
    { actorId: userA, workspaceId: wsA, projectId: projA },
    (c) => c.query('SELECT cube FROM noesar_knowledge.library_memories WHERE id = $1', [libId]),
  );
  check('CUBE04-06b', 'the refused cube-change left the row in its original cube',
    cubeUnchanged.rows[0]?.cube === 'library', `cube=${cubeUnchanged.rows[0]?.cube}`);

  // memory_vectors' own RLS policy (0017) joined memory_records inline -- a query the
  // application role could only plan while it still had a direct SELECT grant there.
  // 0018 replaces that join with two SECURITY DEFINER functions (can_read/write_memory_
  // record) so revoking the direct grant above does not also break vector indexing.
  // These two checks are the regression test for that: legitimate access still works,
  // cross-tenant access is still denied -- same behaviour as before 0018, reached a
  // different way.
  const modelId = crypto.randomUUID();
  await admin.query(
    `INSERT INTO noesar_knowledge.embedding_models (id, name, dimensions, is_current)
     VALUES ($1,$2,384,true) ON CONFLICT (id) DO NOTHING`,
    [modelId, `cube04-model-${modelId.slice(0, 8)}`],
  );
  const ownVector = await withContext(
    { actorId: userA, workspaceId: wsA, projectId: projA },
    (c) => c.query(
      'INSERT INTO noesar_knowledge.memory_vectors (record_id, model_id, embedding) VALUES ($1,$2,$3) RETURNING record_id',
      [libId, modelId, vec(11)],
    ),
  );
  check('CUBE04-07', 'memory_vectors still accepts an index write for a record the actor owns',
    ownVector.rows[0]?.record_id === libId, JSON.stringify(ownVector.rows[0]));

  const foreignLibId = crypto.randomUUID();
  await withContext(
    { actorId: userB, workspaceId: wsB },
    (c) => c.query(
      `INSERT INTO noesar_knowledge.library_memories
         (id, signature, workspace_id, owner_user_id,
          category, content, provenance, promotion_state, observed_at)
       VALUES ($1,$2,$3,$4,'decisione','user B library row','{}'::jsonb,'session',now())`,
      [foreignLibId, `cube04-foreign-${foreignLibId.slice(0, 8)}`, wsB, userB],
    ),
  );
  await expectDenied('CUBE04-08', "memory_vectors still refuses an index write for another workspace's record",
    () => withContext({ actorId: userA, workspaceId: wsA, projectId: projA }, (c) => c.query(
      'INSERT INTO noesar_knowledge.memory_vectors (record_id, model_id, embedding) VALUES ($1,$2,$3)',
      [foreignLibId, modelId, vec(13)],
    )));

  await admin.end();

  // ---- DB-25..DB-27 : backup and restore -------------------------------------------
  const backup = await supervisor.backup({ label: 'acceptance' });
  check('DB-25', 'pg_dump produced a checksummed custom-format archive',
    backup.bytes > 0 && /^[0-9a-f]{64}$/.test(backup.sha256),
    `${backup.bytes} bytes sha256=${backup.sha256.slice(0, 16)}…`);

  const restoreTarget = 'noesar_restore_probe';
  await supervisor.restore({ file: backup.file, targetDatabase: restoreTarget });
  const restored = new PgConnection({
    socketPath: supervisor.socketFile, user: PostgresSupervisorInternals.ADMIN_ROLE,
    database: restoreTarget, password: adminPassword,
  });
  await restored.connect();
  const restoredLedger = await restored.query('SELECT count(*)::int AS n FROM noesar_migration.applied');
  check('DB-26', 'the restored database contains the migration ledger',
    restoredLedger.rows[0].n === files.length,
    `${restoredLedger.rows[0].n} of ${files.length} rows`);
  const restoredVector = await restored.query(
    "SELECT extversion FROM pg_extension WHERE extname = 'vector'",
  );
  check('DB-27', 'the restored database still has pgvector', restoredVector.rows.length === 1,
    `pgvector ${restoredVector.rows[0]?.extversion}`);
  await restored.end();

  const tampered = `${backup.file}.tampered`;
  await fsp.copyFile(backup.file, tampered);
  await fsp.appendFile(tampered, 'corruption');
  await fsp.copyFile(`${backup.file}.sha256`, `${tampered}.sha256`);
  await expectDenied('DB-28', 'a backup whose checksum does not match is refused',
    () => supervisor.restore({ file: tampered, targetDatabase: 'noesar_should_not_exist' }));

  // ---- DB-29..DB-31 : failure recovery ---------------------------------------------
  const pidBefore = supervisor.process?.pid ?? null;
  check('DB-29', 'the supervised server has a pid', Number.isInteger(pidBefore), `pid=${pidBefore}`);

  // SIGKILL the postmaster: the harshest realistic failure. The supervisor must notice,
  // restart it, and the data must survive because every commit was fsynced.
  process.kill(pidBefore, 'SIGKILL');
  // Waiting for state==='ready' alone would pass instantly: the exit event has not been
  // delivered yet at the moment kill() returns, so the supervisor still believes it is
  // ready. The condition has to be a NEW pid.
  const recovered = await waitFor(
    () => supervisor.state === 'ready'
      && supervisor.process
      && supervisor.process.pid !== pidBefore,
    90000,
  );
  check('DB-30', 'the supervisor restarts the cluster after a SIGKILL', recovered,
    `state=${supervisor.state} pid ${pidBefore} -> ${supervisor.process?.pid} restarts=${supervisor.restarts}`);

  if (recovered) {
    const afterCrash = await supervisor.pool.query(
      'SELECT count(*)::int AS n FROM noesar_runtime.schema_migrations',
    );
    check('DB-31', 'no committed data was lost across the crash',
      afterCrash.rows[0].n === files.length, `${afterCrash.rows[0].n} of ${files.length} rows`);
    const docsAfter = await supervisor.pool.query(
      'SELECT count(*)::int AS n FROM noesar_runtime.security_acceptance',
    );
    check('DB-31b', 'the security acceptance view still answers after recovery',
      docsAfter.rows[0].n === 1, `${docsAfter.rows[0].n} rows`);
  }

  // ---- DB-32 : clean shutdown --------------------------------------------------------
  const stopped = await supervisor.stop();
  check('DB-32', 'the cluster shuts down cleanly on request', stopped.clean === true,
    JSON.stringify(stopped));
  const pidFileGone = !fs.existsSync(path.join(supervisor.dataDir, 'postmaster.pid'));
  check('DB-33', 'postmaster.pid is removed by a clean shutdown', pidFileGone,
    `postmaster.pid present=${!pidFileGone}`);
}

async function seedWorkspaces(admin, { wsA, wsB, projA, userA, userB }) {
  try {
    // The admin role is the cluster superuser, so RLS does not apply to it. Seeding
    // through it is what a migration or a first-run bootstrap does; every assertion
    // below is then made through the application role, which RLS does constrain.
    const userColumns = `(id, username, display_name, role, password_scheme,
       password_salt, password_hash, password_parameters, status)`;
    const userValues = `($1,$2,$3,$4,'argon2id',
       '\\x00'::bytea,'\\x00'::bytea,'{}'::jsonb,'active')`;
    await admin.query(
      `INSERT INTO noesar_identity.users ${userColumns} VALUES ${userValues}
       ON CONFLICT (id) DO NOTHING`,
      [userA, `user-a-${userA.slice(0, 8)}`, 'User A', 'user'],
    );
    await admin.query(
      `INSERT INTO noesar_identity.users ${userColumns} VALUES ${userValues}
       ON CONFLICT (id) DO NOTHING`,
      [userB, `user-b-${userB.slice(0, 8)}`, 'User B', 'user'],
    );
    await admin.query(
      `INSERT INTO noesar_core.workspaces (id, slug, display_name, owner_user_id)
       VALUES ($1,$2,'Workspace A',$3), ($4,$5,'Workspace B',$6)
       ON CONFLICT (id) DO NOTHING`,
      [wsA, `ws-a-${wsA.slice(0, 8)}`, userA, wsB, `ws-b-${wsB.slice(0, 8)}`, userB],
    );
    await admin.query(
      `INSERT INTO noesar_core.projects (id, workspace_id, slug, display_name, owner_user_id)
       VALUES ($1,$2,$3,'Project A',$4) ON CONFLICT (id) DO NOTHING`,
      [projA, wsA, `proj-a-${projA.slice(0, 8)}`, userA],
    );
    await admin.query(
      `INSERT INTO noesar_core.workspace_members (workspace_id, user_id, role)
       VALUES ($1,$2,'user'), ($3,$4,'user')
       ON CONFLICT (workspace_id, user_id) DO NOTHING`,
      [wsA, userA, wsB, userB],
    );
    await admin.query(
      `INSERT INTO noesar_core.project_members (project_id, user_id, role)
       VALUES ($1,$2,'user') ON CONFLICT (project_id, user_id) DO NOTHING`,
      [projA, userA],
    );
    return { ok: true, detail: 'two workspaces, one project, two users, membership rows' };
  } catch (error) {
    return { ok: false, detail: error.message };
  }
}

async function waitFor(predicate, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (predicate()) return true;
    if (Date.now() > deadline) return false;
    await new Promise((r) => { setTimeout(r, 200); });
  }
}

main()
  .then(async () => {
    const passed = results.filter((r) => r.status === 'PASS').length;
    process.stdout.write(`\nPOSTGRES_INTEGRATION ${passed}/${results.length} PASS, ${failures} FAIL\n`);
    const out = process.env.NOESAR_ACCEPTANCE_OUT;
    if (out) await fsp.writeFile(out, JSON.stringify({ results, passed, total: results.length, failures }, null, 2));
    process.exit(failures === 0 ? 0 : 1);
  })
  .catch(async (error) => {
    process.stdout.write(`\nFATAL ${error?.stack ?? error}\n`);
    try { await supervisor.stop(); } catch { /* already down */ }
    process.exit(2);
  });
