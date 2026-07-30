// SPDX-License-Identifier: AGPL-3.0-or-later
//
// MASTER_PROJECT/14_MEMORIA_A_CUBI.md §9.3/CUBE-008 — changing the embedding model must not
// lose records, only re-index, and the old index keeps serving until the new one's coverage
// reaches 100%:
//
//   1. INSERT embedding_models (is_current=false)   the new model exists, not used yet
//   2. incremental backfill of memory_vectors        the old index keeps serving
//   3. at 100% coverage: is_current=true              one transaction, no downtime
//   4. DELETE the old model's rows                    space freed, records untouched
//
// "E se il passo 2 non finisce mai... il sistema resta al punto 1: degradato ma corretto" —
// nothing here can leave the system in a state where recall() has NO working index: the old
// model stays `is_current` until `activate()` succeeds, and `activate()` refuses outright
// below 100% coverage rather than cutting over partially.
//
// ADMIN-MEDIATED THROUGHOUT, LIKE listCandidates()/promote() (D-0263). Same reason: this
// reads and writes `memory_vectors`/`embedding_models` system-wide, across every workspace
// and every cube, which is not a `noesar_app`-scoped operation and was never meant to be one
// — it is server maintenance, not a user action. Reading `memory_records` directly here
// (rather than through the four typed cube views) does not reopen CUBE-004: the index rows
// this writes never carry or interpret a `cube` value themselves, they only key on
// `(record_id, model_id)`, so there is no cube to mislabel.
//
// NO REAL EMBEDDING MODEL IS WIRED INTO THIS PRODUCT (verified by grepping the source, same
// check `recall()`'s own header makes — no TEI/model client exists anywhere in
// reference-control-plane). `embed` is therefore an INJECTED function, never a default this
// file supplies silently: the caller must say what actually produces the numbers. This keeps
// the swap MECHANISM (atomicity, no-downtime, no-data-loss) buildable and testable today
// without fabricating a semantic embedding capability that does not exist yet.

const EMBEDDING_DIMENSIONS = 384;

function requireUuid(value, field) {
  if (typeof value !== 'string' || !/^[0-9a-f-]{36}$/i.test(value)) {
    throw Object.assign(new Error(`${field} must be a UUID string`), { status: 400 });
  }
  return value;
}

function vectorLiteral(values) {
  if (!Array.isArray(values) || values.length !== EMBEDDING_DIMENSIONS) {
    throw Object.assign(
      new Error(`embed() must return exactly ${EMBEDDING_DIMENSIONS} numbers, got ${values?.length ?? 'non-array'}`),
      { status: 500 },
    );
  }
  if (!values.every(Number.isFinite)) {
    throw Object.assign(new Error('embed() returned a non-finite number'), { status: 500 });
  }
  return `[${values.join(',')}]`;
}

export class ModelSwapService {
  /** @param {{ dataPlane: () => (import('./postgres-supervisor.mjs').PostgresSupervisor|null) }} deps */
  constructor({ dataPlane }) {
    this.dataPlane = dataPlane;
  }

  async #admin(operation) {
    const supervisor = this.dataPlane();
    if (!supervisor?.pool) throw Object.assign(new Error('memory: no active PostgreSQL data plane'), { status: 503 });
    return supervisor.withAdmin(operation);
  }

  /** Step 1: the new model exists, `is_current:false` — not used by recall() yet. */
  async registerModel({ id, name, dimensions = EMBEDDING_DIMENSIONS }) {
    requireUuid(id, 'id');
    if (!String(name ?? '').trim()) throw Object.assign(new Error('name is required'), { status: 400 });
    return this.#admin((admin) => admin.query(
      `INSERT INTO noesar_knowledge.embedding_models (id, name, dimensions, is_current)
       VALUES ($1,$2,$3,false)
       RETURNING id, name, dimensions, is_current`,
      [id, name, dimensions],
    ).then((r) => r.rows[0]));
  }

  /** How much of the corpus a given model has indexed — the number activate() checks. */
  async coverage(modelId) {
    requireUuid(modelId, 'modelId');
    return this.#admin((admin) => admin.query(
      `SELECT
         (SELECT count(*)::int FROM noesar_knowledge.memory_records) AS total,
         (SELECT count(*)::int FROM noesar_knowledge.memory_vectors WHERE model_id = $1) AS indexed`,
      [modelId],
    ).then((r) => {
      const row = r.rows[0] ?? { total: 0, indexed: 0 };
      return { total: row.total, indexed: row.indexed, complete: row.total > 0 && row.indexed >= row.total };
    }));
  }

  /**
   * Step 2, one batch. Finds records this model has not indexed yet and embeds them.
   * `embed(record)` may be async; called once per record IN THIS BATCH (never for the
   * whole corpus at once — a swap over a large library runs as many small batches, so a
   * crash mid-backfill loses at most one batch of progress, not the whole procedure).
   */
  async backfillBatch({ modelId, embed, batchSize = 100 }) {
    requireUuid(modelId, 'modelId');
    if (typeof embed !== 'function') throw Object.assign(new Error('embed must be a function'), { status: 400 });
    const bounded = Math.min(Math.max(Number.isFinite(Number(batchSize)) ? Number(batchSize) : 100, 1), 1000);

    const pending = await this.#admin((admin) => admin.query(
      `SELECT r.id, r.content FROM noesar_knowledge.memory_records r
       WHERE NOT EXISTS (
         SELECT 1 FROM noesar_knowledge.memory_vectors v
         WHERE v.record_id = r.id AND v.model_id = $1
       )
       ORDER BY r.observed_at ASC
       LIMIT $2`,
      [modelId, bounded],
    ).then((r) => r.rows));

    // Each record embedded and inserted in sequence, deliberately: a failure partway
    // through a batch must leave the ALREADY embedded records indexed, not roll all of
    // them back together.
    let processed = 0;
    for (const record of pending) {
      const values = await embed(record);
      const literal = vectorLiteral(values);
      await this.#admin((admin) => admin.query(
        `INSERT INTO noesar_knowledge.memory_vectors (record_id, model_id, embedding)
         VALUES ($1,$2,$3::vector)
         ON CONFLICT (record_id, model_id) DO NOTHING`,
        [record.id, modelId, literal],
      ));
      processed += 1;
    }

    const after = await this.coverage(modelId);
    return { processed, remaining: after.total - after.indexed, coverage: after };
  }

  /**
   * Step 3. Refuses below 100% coverage — no partial cutover, ever (§9.3: "il sistema
   * resta al punto 1: degradato ma corretto" is the fallback, not a code path this method
   * takes on its own). The flip is one statement pair inside one transaction: recall()
   * never observes a moment with zero or two `is_current` models.
   */
  async activate(modelId) {
    requireUuid(modelId, 'modelId');
    const status = await this.coverage(modelId);
    if (!status.complete) {
      throw Object.assign(
        new Error(`model ${modelId} is not fully indexed yet (${status.indexed}/${status.total}) — refusing to activate`),
        { status: 409 },
      );
    }
    return this.#admin(async (admin) => {
      await admin.query('BEGIN');
      try {
        await admin.query(`UPDATE noesar_knowledge.embedding_models SET is_current = false WHERE is_current`);
        const result = await admin.query(
          `UPDATE noesar_knowledge.embedding_models SET is_current = true WHERE id = $1 RETURNING id, name, is_current`,
          [modelId],
        );
        await admin.query('COMMIT');
        return result.rows[0];
      } catch (error) {
        await admin.query('ROLLBACK').catch(() => {});
        throw error;
      }
    });
  }

  /**
   * Step 4. Deletes the SUPERSEDED model's index rows — never the current one, whether or
   * not the caller asks for it, because that would silently blind recall()'s similarity
   * catalogue with no model left `is_current`.
   */
  async purgeSuperseded(modelId) {
    requireUuid(modelId, 'modelId');
    return this.#admin(async (admin) => {
      const model = await admin.query(
        `SELECT is_current FROM noesar_knowledge.embedding_models WHERE id = $1`,
        [modelId],
      );
      if (model.rows[0]?.is_current) {
        throw Object.assign(new Error('refusing to purge the current model\'s index'), { status: 409 });
      }
      // RETURNING is required for an accurate count with this project's hand-rolled pg
      // client: it computes rowCount from the returned row set, not from PostgreSQL's own
      // CommandComplete tag, so a DELETE with no RETURNING always reports rowCount 0
      // regardless of how many rows actually went away (found live: MEM-33 reported
      // "deleted":0 against a real, verified 7-row corpus). Same convention
      // tools/acceptance/postgres-integration.mjs already uses for exactly this reason.
      const result = await admin.query(
        `DELETE FROM noesar_knowledge.memory_vectors WHERE model_id = $1 RETURNING record_id`,
        [modelId],
      );
      return { deleted: result.rowCount ?? 0 };
    });
  }
}
