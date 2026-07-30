import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryService, CANONICAL_WORKSPACE_ID } from '../src/memory-service.mjs';

const ACTOR = '11111111-1111-4111-8111-111111111111';

class FakeClient {
  constructor(handler = () => ({ rows: [] })) {
    this.handler = handler;
    this.calls = [];
    this.released = false;
  }
  async query(sql, params = []) {
    this.calls.push({ sql, params });
    return this.handler(sql, params, this.calls);
  }
  release() { this.released = true; }
}

function poolFor(client) {
  return { connect: async () => client };
}

function dataPlaneWith({ pool = null, withAdmin = null } = {}) {
  // .pool is the real supervisor's readiness signal (non-null only once postgres.start()
  // has actually succeeded) — user-directory.mjs's projectToDataPlane() gates on it the
  // same way even for its own admin-mediated write, and memory-service.mjs matches that
  // convention. A fixture that supplies withAdmin without a truthy pool would test a state
  // real production code never reaches.
  if (!pool && !withAdmin) return () => null;
  return () => ({ pool: pool ?? {}, withAdmin });
}

test('write() rejects an unknown cube', async () => {
  const service = new MemoryService({ dataPlane: dataPlaneWith({ pool: poolFor(new FakeClient()) }) });
  await assert.rejects(
    () => service.write({
      actorId: ACTOR, cube: 'attic', category: 'fatto', content: 'x', signature: 's1',
    }),
    /cube must be one of/,
  );
});

test('write() rejects an unknown category', async () => {
  const service = new MemoryService({ dataPlane: dataPlaneWith({ pool: poolFor(new FakeClient()) }) });
  await assert.rejects(
    () => service.write({
      actorId: ACTOR, cube: 'workshop', category: 'opinione', content: 'x', signature: 's1',
    }),
    /category must be one of/,
  );
});

test('write() refuses derived:true with an empty derivedFrom (CUBE-002, restated early)', async () => {
  const service = new MemoryService({ dataPlane: dataPlaneWith({ pool: poolFor(new FakeClient()) }) });
  await assert.rejects(
    () => service.write({
      actorId: ACTOR, cube: 'workshop', category: 'fatto', content: 'x', signature: 's1', derived: true,
    }),
    /must cite at least one source/,
  );
});

test('write() with no active data plane throws a 503, not a silent fallback', async () => {
  const service = new MemoryService({ dataPlane: () => null });
  await assert.rejects(
    () => service.write({
      actorId: ACTOR, cube: 'workshop', category: 'fatto', content: 'x', signature: 's1',
    }),
    (error) => error.status === 503,
  );
});

test('write() inserts through the correct cube-typed view and sets session GUCs first', async () => {
  const client = new FakeClient((sql) => {
    if (sql.includes('INSERT INTO noesar_knowledge.library_memories')) {
      return { rows: [{ signature: 's1', cube: 'library', content: 'x', category: 'fatto', provenance: {}, contamination: 'unverified', promotion_state: 'session', derived: false, derived_from: [], observed_at: '2026-07-30T00:00:00.000Z', project_id: null, owner_user_id: ACTOR }] };
    }
    return { rows: [] };
  });
  const service = new MemoryService({ dataPlane: dataPlaneWith({ pool: poolFor(client) }) });
  const item = await service.write({
    actorId: ACTOR, cube: 'library', category: 'fatto', content: 'x', signature: 's1',
  });
  assert.equal(item.signature, 's1');
  const actions = client.calls.map((c) => c.sql);
  assert.ok(actions[0].includes('BEGIN'));
  assert.ok(actions.some((sql) => sql.includes("set_config('noesar.actor_id'")));
  assert.ok(actions.some((sql) => sql.includes("set_config('noesar.workspace_id'")));
  assert.ok(actions.some((sql) => sql.includes('library_memories')));
  assert.ok(actions.at(-1).includes('COMMIT'));
  // The workspace GUC is always the one canonical workspace, never caller-supplied.
  const wsCall = client.calls.find((c) => c.sql.includes('workspace_id'));
  assert.equal(wsCall.params[0], CANONICAL_WORKSPACE_ID);
});

test('write() rolls back on a query failure and still releases the client', async () => {
  const client = new FakeClient((sql) => {
    if (sql.includes('INSERT')) throw new Error('constraint violation');
    return { rows: [] };
  });
  const service = new MemoryService({ dataPlane: dataPlaneWith({ pool: poolFor(client) }) });
  await assert.rejects(
    () => service.write({ actorId: ACTOR, cube: 'workshop', category: 'fatto', content: 'x', signature: 's1' }),
    /constraint violation/,
  );
  assert.ok(client.calls.some((c) => c.sql === 'ROLLBACK'));
  assert.equal(client.released, true);
});

test('write() contamination canary: a derived record cannot be less contaminated than what it cites', async () => {
  const client = new FakeClient((sql) => {
    if (sql.includes('SELECT contamination FROM')) {
      return { rows: [{ contamination: 'suspect' }, { contamination: 'verified' }] };
    }
    if (sql.includes('INSERT INTO')) {
      // Returns whatever contamination was actually inserted, so the test can see it.
      return { rows: [{ signature: 's2', cube: 'workshop', content: 'y', category: 'lezione', provenance: {}, contamination: 'suspect', promotion_state: 'session', derived: true, derived_from: ['a'], observed_at: 'now', project_id: null, owner_user_id: ACTOR }] };
    }
    return { rows: [] };
  });
  const service = new MemoryService({ dataPlane: dataPlaneWith({ pool: poolFor(client) }) });
  const item = await service.write({
    actorId: ACTOR, cube: 'workshop', category: 'lezione', content: 'y', signature: 's2',
    derived: true, derivedFrom: ['a', 'b'], contamination: 'verified', // caller claims verified...
  });
  // ...but a cited source is 'suspect', so the insert must have used 'suspect', not 'verified'.
  const insertCall = client.calls.find((c) => c.sql.includes('INSERT INTO'));
  assert.equal(insertCall.params[8], 'suspect');
  assert.equal(item.contamination, 'suspect');
});

test('write() contamination canary does not downgrade when all sources are clean', async () => {
  const client = new FakeClient((sql) => {
    if (sql.includes('SELECT contamination FROM')) return { rows: [{ contamination: 'verified' }] };
    if (sql.includes('INSERT INTO')) return { rows: [{ signature: 's3', cube: 'workshop', content: 'y', category: 'fatto', provenance: {}, contamination: 'unverified', promotion_state: 'session', derived: true, derived_from: ['a'], observed_at: 'now', project_id: null, owner_user_id: ACTOR }] };
    return { rows: [] };
  });
  const service = new MemoryService({ dataPlane: dataPlaneWith({ pool: poolFor(client) }) });
  await service.write({
    actorId: ACTOR, cube: 'workshop', category: 'fatto', content: 'y', signature: 's3',
    derived: true, derivedFrom: ['a'], contamination: 'unverified',
  });
  const insertCall = client.calls.find((c) => c.sql.includes('INSERT INTO'));
  assert.equal(insertCall.params[8], 'unverified');
});

test('recall() rejects an unknown category filter', async () => {
  const service = new MemoryService({ dataPlane: dataPlaneWith({ pool: poolFor(new FakeClient()) }) });
  await assert.rejects(
    () => service.recall({ category: 'opinione' }, { actorId: ACTOR }),
    /category must be one of/,
  );
});

test('recall() queries all_memories when no cube is given, and the named view when one is', async () => {
  const client = new FakeClient((sql) => {
    if (sql.includes('count(*)')) return { rows: [{ n: 0 }] };
    if (sql.includes('embedding_models')) return { rows: [] };
    return { rows: [] };
  });
  const service = new MemoryService({ dataPlane: dataPlaneWith({ pool: poolFor(client) }) });
  await service.recall({}, { actorId: ACTOR });
  assert.ok(client.calls.some((c) => c.sql.includes('noesar_knowledge.all_memories')));

  const client2 = new FakeClient((sql) => {
    if (sql.includes('count(*)')) return { rows: [{ n: 0 }] };
    if (sql.includes('embedding_models')) return { rows: [] };
    return { rows: [] };
  });
  const service2 = new MemoryService({ dataPlane: dataPlaneWith({ pool: poolFor(client2) }) });
  await service2.recall({ cube: 'library' }, { actorId: ACTOR });
  assert.ok(client2.calls.some((c) => c.sql.includes('noesar_knowledge.library_memories')));
  assert.ok(!client2.calls.some((c) => c.sql.includes('all_memories')));
});

test('recall() coverage.vectorIndexComplete is false with no current embedding model', async () => {
  const client = new FakeClient((sql) => {
    if (sql.includes('count(*)') && sql.includes('all_memories') && !sql.includes('memory_vectors')) return { rows: [{ n: 0 }] };
    if (sql.includes('embedding_models')) return { rows: [] };
    return { rows: [] };
  });
  const service = new MemoryService({ dataPlane: dataPlaneWith({ pool: poolFor(client) }) });
  const result = await service.recall({}, { actorId: ACTOR });
  assert.equal(result.coverage.vectorIndexComplete, false);
  assert.equal(result.coverage.model, null);
});

test('recall() reports not_found for a criterion with zero matches, when the whole query is empty', async () => {
  let call = 0;
  const client = new FakeClient((sql) => {
    if (sql.includes('embedding_models')) return { rows: [] };
    if (sql.includes('count(*)')) {
      call += 1;
      // First count() is the overall query -> 0. Diagnostic counts also 0.
      return { rows: [{ n: 0 }] };
    }
    return { rows: [] };
  });
  const service = new MemoryService({ dataPlane: dataPlaneWith({ pool: poolFor(client) }) });
  const result = await service.recall({ category: 'difetto' }, { actorId: ACTOR });
  assert.ok(result.notFound.includes('categoria'));
  assert.ok(call > 1);
});

test('promote() refuses an unrecognised decision', async () => {
  const service = new MemoryService({ dataPlane: dataPlaneWith({ withAdmin: async (fn) => fn(new FakeClient()) }) });
  await assert.rejects(
    () => service.promote({ signature: 's', cube: 'workshop', decision: 'maybe', actorId: ACTOR }),
    (error) => error.status === 400,
  );
});

test('promote() refuses a record not actually awaiting promotion', async () => {
  const admin = new FakeClient((sql) => {
    if (sql.includes('SELECT promotion_state')) return { rows: [{ promotion_state: 'session' }] };
    return { rows: [] };
  });
  const service = new MemoryService({ dataPlane: dataPlaneWith({ withAdmin: async (fn) => fn(admin) }) });
  await assert.rejects(
    () => service.promote({ signature: 's', cube: 'workshop', decision: 'approve', actorId: ACTOR }),
    (error) => error.status === 409,
  );
});

test('promote() refuses when the caller names the wrong cube for a real signature', async () => {
  // The SELECT WHERE clause filters by signature AND cube — a mismatch means no row
  // comes back at all, so this is indistinguishable from "not found" to the caller,
  // which is the honest answer (never silently promote a record the caller was
  // mistaken about).
  const admin = new FakeClient((sql) => (sql.includes('SELECT promotion_state') ? { rows: [] } : { rows: [] }));
  const service = new MemoryService({ dataPlane: dataPlaneWith({ withAdmin: async (fn) => fn(admin) }) });
  await assert.rejects(
    () => service.promote({ signature: 's', cube: 'library', decision: 'approve', actorId: ACTOR }),
    (error) => error.status === 409,
  );
  const selectCall = admin.calls.find((c) => c.sql.includes('SELECT promotion_state'));
  assert.deepEqual(selectCall.params, ['s', 'library']);
});

test('listCandidates() queries memory_records directly, not through a cube-typed view', async () => {
  // Regression test for the live-verified bug (D-0263): a view's RLS follows the view
  // OWNER's identity, not the connecting role, so an admin connection querying through
  // all_memories/the typed views sees nothing (no noesar.actor_id GUC is ever set on an
  // admin connection). listCandidates() must target the base table directly.
  const admin = new FakeClient((sql) => {
    if (sql.includes('memory_records')) return { rows: [{ signature: 's', cube: 'workshop', content: 'x', category: 'fatto', provenance: {}, contamination: 'unverified', promotion_state: 'project-candidate', derived: false, derived_from: [], observed_at: 'now', project_id: null, owner_user_id: ACTOR }] };
    return { rows: [] };
  });
  const service = new MemoryService({ dataPlane: dataPlaneWith({ withAdmin: async (fn) => fn(admin) }) });
  const result = await service.listCandidates();
  assert.equal(result.length, 1);
  const call = admin.calls[0];
  assert.ok(call.sql.includes('FROM noesar_knowledge.memory_records'));
  assert.ok(!call.sql.includes('all_memories'));
  assert.ok(!/library_memories|workshop_memories|corpus_memories|experience_memories/.test(call.sql));
});

test('promote() approve widens visibility to project for project-candidate -> project', async () => {
  const admin = new FakeClient((sql) => {
    if (sql.includes('SELECT promotion_state')) return { rows: [{ promotion_state: 'project-candidate' }] };
    if (sql.includes('UPDATE')) return { rows: [{ signature: 's', cube: 'workshop', content: 'x', category: 'fatto', provenance: {}, contamination: 'unverified', promotion_state: 'project', derived: false, derived_from: [], observed_at: 'now', project_id: null, owner_user_id: ACTOR }] };
    return { rows: [] };
  });
  const service = new MemoryService({ dataPlane: dataPlaneWith({ withAdmin: async (fn) => fn(admin) }) });
  const result = await service.promote({ signature: 's', cube: 'workshop', decision: 'approve', actorId: ACTOR });
  assert.equal(result.promotionState, 'project');
  assert.equal(result.decidedBy, ACTOR);
  const updateCall = admin.calls.find((c) => c.sql.includes('UPDATE'));
  assert.ok(updateCall.sql.includes('visibility'));
  assert.equal(updateCall.params[1], 'project');
});

test('promote() reject moves a candidate to revoked without touching visibility', async () => {
  const admin = new FakeClient((sql) => {
    if (sql.includes('SELECT promotion_state')) return { rows: [{ promotion_state: 'global-candidate' }] };
    if (sql.includes('UPDATE')) return { rows: [{ signature: 's', cube: 'library', content: 'x', category: 'fatto', provenance: {}, contamination: 'unverified', promotion_state: 'revoked', derived: false, derived_from: [], observed_at: 'now', project_id: null, owner_user_id: ACTOR }] };
    return { rows: [] };
  });
  const service = new MemoryService({ dataPlane: dataPlaneWith({ withAdmin: async (fn) => fn(admin) }) });
  const result = await service.promote({ signature: 's', cube: 'library', decision: 'reject', actorId: ACTOR });
  assert.equal(result.promotionState, 'revoked');
  const updateCall = admin.calls.find((c) => c.sql.includes('UPDATE'));
  assert.ok(!updateCall.sql.includes('visibility'));
});

test('ensureWorkspace() reports not-ensured when there is no data plane', async () => {
  const service = new MemoryService({ dataPlane: () => null });
  const result = await service.ensureWorkspace();
  assert.equal(result.ensured, false);
});

test('ensureWorkspace() reports not-ensured when no owner is projected yet', async () => {
  const admin = new FakeClient(() => ({ rows: [] }));
  const service = new MemoryService({ dataPlane: dataPlaneWith({ withAdmin: async (fn) => fn(admin) }) });
  const result = await service.ensureWorkspace();
  assert.equal(result.ensured, false);
  assert.match(result.reason, /no owner projected/);
});

test('ensureWorkspace() provisions the canonical workspace idempotently once an owner exists', async () => {
  const admin = new FakeClient((sql) => {
    if (sql.includes('role')) return { rows: [{ id: ACTOR }] };
    return { rows: [] };
  });
  const service = new MemoryService({ dataPlane: dataPlaneWith({ withAdmin: async (fn) => fn(admin) }) });
  const result = await service.ensureWorkspace();
  assert.equal(result.ensured, true);
  assert.equal(result.workspaceId, CANONICAL_WORKSPACE_ID);
  assert.ok(admin.calls.some((c) => c.sql.includes('ON CONFLICT (id) DO NOTHING')));
  assert.ok(admin.calls.some((c) => c.sql.includes('workspace_members')));
});

test('listCandidates() returns an empty array with no data plane rather than throwing', async () => {
  const service = new MemoryService({ dataPlane: () => null });
  const result = await service.listCandidates();
  assert.deepEqual(result, []);
});
