import test from 'node:test';
import assert from 'node:assert/strict';
import { ModelSwapService } from '../src/memory-model-swap.mjs';

const MODEL_ID = '22222222-2222-4222-8222-222222222222';
const VEC384 = Array.from({ length: 384 }, (_, i) => i / 384);

class FakeAdmin {
  constructor(handler = () => ({ rows: [] })) {
    this.handler = handler;
    this.calls = [];
  }
  async query(sql, params = []) {
    this.calls.push({ sql, params });
    return this.handler(sql, params, this.calls);
  }
}

function dataPlaneWith(admin) {
  return () => ({ pool: {}, withAdmin: async (fn) => fn(admin) });
}

test('registerModel() inserts is_current:false, never true', async () => {
  const admin = new FakeAdmin((sql) => {
    if (sql.includes('INSERT INTO')) return { rows: [{ id: MODEL_ID, name: 'bge-small', dimensions: 384, is_current: false }] };
    return { rows: [] };
  });
  const service = new ModelSwapService({ dataPlane: dataPlaneWith(admin) });
  const result = await service.registerModel({ id: MODEL_ID, name: 'bge-small', dimensions: 384 });
  assert.equal(result.is_current, false);
  const insertCall = admin.calls[0];
  assert.match(insertCall.sql, /VALUES \(\$1,\$2,\$3,false\)/);
});

test('coverage() reports complete:false with zero total records, not a division by zero surprise', async () => {
  const admin = new FakeAdmin(() => ({ rows: [{ total: 0, indexed: 0 }] }));
  const service = new ModelSwapService({ dataPlane: dataPlaneWith(admin) });
  const result = await service.coverage(MODEL_ID);
  assert.equal(result.complete, false);
});

test('coverage() reports complete:true only once indexed reaches total', async () => {
  const admin = new FakeAdmin(() => ({ rows: [{ total: 5, indexed: 5 }] }));
  const service = new ModelSwapService({ dataPlane: dataPlaneWith(admin) });
  const result = await service.coverage(MODEL_ID);
  assert.equal(result.complete, true);
});

test('backfillBatch() embeds only records the model has not indexed yet, one at a time', async () => {
  let embedCalls = 0;
  const admin = new FakeAdmin((sql) => {
    if (sql.includes('SELECT r.id, r.content')) {
      return { rows: [{ id: 'rec-1', content: 'a' }, { id: 'rec-2', content: 'b' }] };
    }
    if (sql.includes('INSERT INTO noesar_knowledge.memory_vectors')) return { rows: [] };
    if (sql.includes('total')) return { rows: [{ total: 2, indexed: 2 }] };
    return { rows: [] };
  });
  const service = new ModelSwapService({ dataPlane: dataPlaneWith(admin) });
  const result = await service.backfillBatch({
    modelId: MODEL_ID, embed: async () => { embedCalls += 1; return VEC384; },
  });
  assert.equal(embedCalls, 2);
  assert.equal(result.processed, 2);
  assert.equal(result.coverage.complete, true);
});

test('backfillBatch() rejects an embed() that returns the wrong dimensionality', async () => {
  const admin = new FakeAdmin((sql) => {
    if (sql.includes('SELECT r.id, r.content')) return { rows: [{ id: 'rec-1', content: 'a' }] };
    return { rows: [] };
  });
  const service = new ModelSwapService({ dataPlane: dataPlaneWith(admin) });
  await assert.rejects(
    () => service.backfillBatch({ modelId: MODEL_ID, embed: async () => [1, 2, 3] }),
    /must return exactly 384 numbers/,
  );
});

test('activate() refuses below 100% coverage — no partial cutover, ever', async () => {
  const admin = new FakeAdmin(() => ({ rows: [{ total: 10, indexed: 7 }] }));
  const service = new ModelSwapService({ dataPlane: dataPlaneWith(admin) });
  await assert.rejects(
    () => service.activate(MODEL_ID),
    (error) => error.status === 409 && /not fully indexed/.test(error.message),
  );
});

test('activate() flips is_current inside one BEGIN/COMMIT once coverage is complete', async () => {
  const admin = new FakeAdmin((sql) => {
    if (sql.includes('total')) return { rows: [{ total: 3, indexed: 3 }] };
    if (sql.includes("SET is_current = true")) return { rows: [{ id: MODEL_ID, name: 'new', is_current: true }] };
    return { rows: [] };
  });
  const service = new ModelSwapService({ dataPlane: dataPlaneWith(admin) });
  const result = await service.activate(MODEL_ID);
  assert.equal(result.is_current, true);
  const sqlSequence = admin.calls.map((c) => c.sql.trim().split('\n')[0].trim());
  assert.ok(sqlSequence.includes('BEGIN'));
  assert.ok(sqlSequence.includes('COMMIT'));
  const beginIndex = sqlSequence.indexOf('BEGIN');
  const commitIndex = sqlSequence.indexOf('COMMIT');
  assert.ok(sqlSequence.slice(beginIndex, commitIndex).some((s) => s.includes('is_current = false')));
  assert.ok(sqlSequence.slice(beginIndex, commitIndex).some((s) => s.includes('is_current = true')));
});

test('activate() rolls back if the second statement fails, leaving no model uncurrent', async () => {
  const admin = new FakeAdmin((sql) => {
    if (sql.includes('total')) return { rows: [{ total: 1, indexed: 1 }] };
    if (sql.trim() === 'BEGIN' || sql.trim() === 'ROLLBACK') return { rows: [] };
    if (sql.includes('is_current = false')) return { rows: [] };
    if (sql.includes('is_current = true')) throw new Error('simulated failure');
    return { rows: [] };
  });
  const service = new ModelSwapService({ dataPlane: dataPlaneWith(admin) });
  await assert.rejects(() => service.activate(MODEL_ID), /simulated failure/);
  assert.ok(admin.calls.some((c) => c.sql.trim() === 'ROLLBACK'));
});

test('purgeSuperseded() refuses to delete the current model\'s index', async () => {
  const admin = new FakeAdmin((sql) => {
    if (sql.includes('SELECT is_current')) return { rows: [{ is_current: true }] };
    return { rows: [] };
  });
  const service = new ModelSwapService({ dataPlane: dataPlaneWith(admin) });
  await assert.rejects(
    () => service.purgeSuperseded(MODEL_ID),
    (error) => error.status === 409 && /refusing to purge the current model/.test(error.message),
  );
});

test('purgeSuperseded() deletes a superseded model\'s vectors, records untouched', async () => {
  const admin = new FakeAdmin((sql) => {
    if (sql.includes('SELECT is_current')) return { rows: [{ is_current: false }] };
    if (sql.includes('DELETE FROM noesar_knowledge.memory_vectors')) return { rowCount: 42, rows: [] };
    return { rows: [] };
  });
  const service = new ModelSwapService({ dataPlane: dataPlaneWith(admin) });
  const result = await service.purgeSuperseded(MODEL_ID);
  assert.equal(result.deleted, 42);
  assert.ok(!admin.calls.some((c) => c.sql.includes('memory_records') && c.sql.includes('DELETE')));
});

test('all methods throw a 503 with no active data plane, never silently no-op', async () => {
  const service = new ModelSwapService({ dataPlane: () => null });
  await assert.rejects(() => service.registerModel({ id: MODEL_ID, name: 'x' }), (e) => e.status === 503);
  await assert.rejects(() => service.coverage(MODEL_ID), (e) => e.status === 503);
  await assert.rejects(() => service.activate(MODEL_ID), (e) => e.status === 503);
});
