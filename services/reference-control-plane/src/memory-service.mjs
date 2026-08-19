// SPDX-License-Identifier: AGPL-3.0-or-later
//
// MASTER_PROJECT/14_MEMORIA_A_CUBI.md — the application layer over the cube schema (D-0261,
// D-0262). Two things this file deliberately does NOT do:
//
//   * It does not touch `noesar_knowledge.memory_items` (0006) or the JSON store's
//     `state.memories` (manual, user-authored notes — a different, still-valid feature,
//     see §11: this document's cubes are never hand-written). Both are confirmed empty in
//     production (0 rows each) — there is nothing to reconcile FROM, so `B-009`'s
//     "reconciliation" is executed by simply never using the old paths going forward, not
//     by a dual-write migration over data that does not exist.
//   * It does not touch `noesar_core.conversations`/`conversation_messages` — those tables
//     are schema-only, unreferenced by the live chat path (which is JSON, `ContextGraph`),
//     exactly like `memory_items` was before `0017`. Wiring the whole chat system onto
//     PostgreSQL is a separate, much larger migration than "finish Block C" and is not
//     attempted here.
//
// WHAT "PostgreSQL is authoritative for memory" (§10) MEANS CONCRETELY: every NEW memory
// record this file ever writes goes to `noesar_knowledge.memory_records` via the typed
// views from `0018`, and nowhere else. The compaction pipeline (memory-compaction.mjs)
// reads its source events from the workspace-actions EventLedger (already append-only,
// already hash-chained — the literal shape §9.5 step 1 describes), not from chat messages:
// see that file's own header for why.
//
// THE CANONICAL WORKSPACE. The live product has no multi-workspace concept in its request
// path (no `workspace_id` anywhere in server.mjs) even though PostgreSQL's RLS design is
// fully multi-tenant. Rather than build workspace management to satisfy a schema NOT-NULL
// constraint, one fixed workspace is projected — the same "projection, not migration"
// pattern user-directory.mjs already uses for identity ("Identity facts the data plane
// must join against ... are projected into noesar_identity.users so RLS has a subject to
// reason about"). `ensureWorkspace()` is idempotent and safe to call on every boot.

import { randomUUID } from 'node:crypto';

export const CANONICAL_WORKSPACE_ID = '00000000-0000-4000-8000-000000000001';

export const CATEGORIES = Object.freeze([
  'decisione', 'procedura', 'convenzione', 'vincolo',
  'fatto', 'difetto', 'preferenza', 'riferimento', 'lezione',
]);
const CATEGORY_SET = new Set(CATEGORIES);

export const CUBES = Object.freeze(['library', 'workshop', 'corpus', 'experience']);
const CUBE_SET = new Set(CUBES);
const VIEW_BY_CUBE = Object.freeze({
  library: 'library_memories',
  workshop: 'workshop_memories',
  corpus: 'corpus_memories',
  experience: 'experience_memories',
});

// The contamination canary's severity order — lowest first. A derived record's
// contamination floor is the worst of its cited sources, never better (see write()).
const CONTAMINATION_SEVERITY = Object.freeze({ verified: 0, unverified: 1, suspect: 2, revoked: 3 });
const SEVERITY_CONTAMINATION = Object.freeze(['verified', 'unverified', 'suspect', 'revoked']);

const SQL = Object.freeze({
  setActor: `SELECT set_config('noesar.actor_id', $1, true)`,
  setWorkspace: `SELECT set_config('noesar.workspace_id', $1, true)`,
  setProject: `SELECT set_config('noesar.project_id', $1, true)`,
});

const ITEM_COLUMNS = `signature, cube, content, category, provenance, contamination,
  promotion_state, derived, derived_from, observed_at, project_id, owner_user_id,
  confirmations, refutations, refutation_condition`;

/**
 * CE-011. The three things an induced fact must carry, checked here as well as in the schema
 * (migration `0020`), and the schema is the one that decides — see that file's header for why
 * a JS-only guard would not satisfy the criterion's stated method ("schema + test").
 *
 * This layer exists for the error message, not for the guarantee: `23514 check constraint
 * "induced_fact_carries_refutation"` tells a caller nothing about what to do next.
 */
const INDUCED_CUBE = 'experience';
/** Written by `0020` onto rows that predate the rule. A caller may never send it back. */
const UNDECLARED_REFUTATION_PREFIX = 'UNDECLARED:';

function uuidArrayLiteral(ids) {
  // The hand-rolled pg client (pg-client.mjs) does not serialise a JS array into a
  // PostgreSQL array literal the way node-postgres would — passing one directly produced
  // "malformed array literal" (found building the CUBE04 acceptance checks, D-0262).
  // Formatted by hand instead; ids are already validated as uuid-shaped before this runs,
  // so there is no injection surface in the braces.
  const list = Array.isArray(ids) ? ids : [];
  return `{${list.join(',')}}`;
}

function requireUuid(value, field) {
  if (typeof value !== 'string' || !/^[0-9a-f-]{36}$/i.test(value)) {
    throw Object.assign(new Error(`${field} must be a UUID string`), { status: 400 });
  }
  return value;
}

function requireCategory(value) {
  if (!CATEGORY_SET.has(value)) {
    throw Object.assign(
      new Error(`category must be one of: ${CATEGORIES.join(', ')}`),
      { status: 400 },
    );
  }
  return value;
}

function requireCube(value) {
  if (!CUBE_SET.has(value)) {
    throw Object.assign(new Error(`cube must be one of: ${CUBES.join(', ')}`), { status: 400 });
  }
  return value;
}

function requireText(value, field, max = 20_000) {
  const text = String(value ?? '').trim();
  if (!text) throw Object.assign(new Error(`${field} is required`), { status: 400 });
  if (text.length > max) throw Object.assign(new Error(`${field} exceeds ${max} characters`), { status: 413 });
  return text;
}

function rowToItem(row) {
  return {
    signature: row.signature,
    cube: row.cube,
    content: row.content,
    category: row.category,
    provenance: row.provenance,
    contamination: row.contamination,
    promotionState: row.promotion_state,
    derived: row.derived,
    derivedFrom: row.derived_from ?? [],
    observedAt: row.observed_at,
    projectId: row.project_id,
    ownerUserId: row.owner_user_id,
    // CE-011: the three parts of an induced fact travel WITH it. A reader that has to make a
    // second query to learn what would disprove a fact will not make it.
    confirmations: row.confirmations ?? 0,
    refutations: row.refutations ?? 0,
    refutationCondition: row.refutation_condition ?? null,
    score: Object.prototype.hasOwnProperty.call(row, 'score') && row.score !== null
      ? Number(row.score) : undefined,
  };
}

export class MemoryService {
  /** @param {{ dataPlane: () => (import('./postgres-supervisor.mjs').PostgresSupervisor|null) }} deps */
  constructor({ dataPlane }) {
    this.dataPlane = dataPlane;
  }

  #pool() {
    const supervisor = this.dataPlane();
    return supervisor?.pool ?? null;
  }

  /**
   * Idempotent. Projects exactly one workspace, owned by whichever projected identity has
   * role 'owner' — the same actor first-owner setup already created. Safe to call every
   * boot; a second call is a no-op (`ON CONFLICT DO NOTHING`).
   */
  async ensureWorkspace() {
    const supervisor = this.dataPlane();
    if (!supervisor?.pool) return { ensured: false, reason: 'no active postgresql data plane' };
    return supervisor.withAdmin(async (admin) => {
      const owner = await admin.query(
        `SELECT id FROM noesar_identity.users WHERE role = 'owner' ORDER BY created_at ASC LIMIT 1`,
      );
      const ownerId = owner.rows?.[0]?.id;
      if (!ownerId) return { ensured: false, reason: 'no owner projected into noesar_identity.users yet' };
      await admin.query(
        `INSERT INTO noesar_core.workspaces (id, slug, display_name, owner_user_id)
         VALUES ($1, 'default', 'Default Workspace', $2)
         ON CONFLICT (id) DO NOTHING`,
        [CANONICAL_WORKSPACE_ID, ownerId],
      );
      await admin.query(
        `INSERT INTO noesar_core.workspace_members (workspace_id, user_id, role)
         VALUES ($1, $2, 'owner')
         ON CONFLICT (workspace_id, user_id) DO NOTHING`,
        [CANONICAL_WORKSPACE_ID, ownerId],
      );
      return { ensured: true, workspaceId: CANONICAL_WORKSPACE_ID, ownerId };
    });
  }

  async #withContext({ actorId, projectId = null }, operation) {
    const pool = this.#pool();
    if (!pool) throw Object.assign(new Error('memory: no active PostgreSQL data plane'), { status: 503 });
    requireUuid(actorId, 'actorId');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(SQL.setActor, [actorId]);
      await client.query(SQL.setWorkspace, [CANONICAL_WORKSPACE_ID]);
      await client.query(SQL.setProject, [projectId ?? '']);
      const value = await operation(client);
      await client.query('COMMIT');
      return value;
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch { /* connection already broken */ }
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Writes one memory record through the cube-typed view named by `cube` (CUBE-004: this
   * is the only path — there is no direct table access to fall back to even from this
   * file). `derivedFrom` must be non-empty whenever `derived` is true; the schema's own
   * `derived_must_cite` CHECK (0017) is the actual enforcement, this is the same rule
   * stated early so a caller gets a clear 400 instead of a raw constraint-violation error.
   */
  async write({
    actorId, cube, category, content, provenance = {}, signature,
    projectId = null, promotionState = 'session', derived = false, derivedFrom = [],
    contamination = 'unverified', observedAt = null,
    refutationCondition = null, confirmations = 0,
  }) {
    requireCube(cube);
    requireCategory(category);
    requireText(content, 'content');
    requireText(signature, 'signature', 500);
    // CE-011, in the layer that can explain itself. The schema refuses these three anyway
    // (migration 0020) — this is the message a caller can act on, and it names WHICH of the
    // three is missing rather than one merged "check constraint violated".
    if (cube === INDUCED_CUBE) {
      const condition = typeof refutationCondition === 'string' ? refutationCondition.trim() : '';
      if (!condition) {
        throw Object.assign(new Error(
          'an induced fact must state what would disprove it (refutationCondition) — a memory that cannot be falsified is superstition, not knowledge (CE-011)',
        ), { status: 400 });
      }
      if (condition.startsWith(UNDECLARED_REFUTATION_PREFIX)) {
        throw Object.assign(new Error(
          'the UNDECLARED marker belongs to rows written before migration 0020 and may never be supplied by a caller (CE-011)',
        ), { status: 400 });
      }
      const evidence = provenance && typeof provenance === 'object' && !Array.isArray(provenance)
        ? Object.keys(provenance).length : 0;
      if (evidence === 0) {
        throw Object.assign(new Error(
          'an induced fact must carry the evidence that induced it (provenance) — an empty object cites nothing (CE-011)',
        ), { status: 400 });
      }
      if (!Number.isInteger(confirmations) || confirmations < 1) {
        throw Object.assign(new Error(
          'an induced fact must carry how many times it held (confirmations >= 1) — "observed n times" with n = 0 is not an observation (CE-011)',
        ), { status: 400 });
      }
    }
    if (derived && (!Array.isArray(derivedFrom) || derivedFrom.length === 0)) {
      throw Object.assign(
        new Error('a derived record must cite at least one source (derivedFrom)'),
        { status: 400 },
      );
    }
    const view = VIEW_BY_CUBE[cube];
    const id = randomUUID();
    const row = await this.#withContext({ actorId, projectId }, async (client) => {
      // The contamination canary (§5 point 4): a record can never claim to be MORE
      // trustworthy than what it cites. If any cited source is 'suspect' or 'revoked',
      // the new record inherits at least that — silently claiming 'verified' while citing
      // something already flagged would let contamination launder itself through a single
      // derivation step, which is exactly the failure §5 point 4 exists to prevent
      // ("resta marcato per sempre, anche dopo la promozione").
      let effectiveContamination = contamination;
      if (Array.isArray(derivedFrom) && derivedFrom.length > 0) {
        const cited = await client.query(
          `SELECT contamination FROM noesar_knowledge.all_memories WHERE id = ANY($1::uuid[])`,
          [uuidArrayLiteral(derivedFrom)],
        );
        const worst = cited.rows.reduce(
          (max, r) => Math.max(max, CONTAMINATION_SEVERITY[r.contamination] ?? 0), 0,
        );
        if (worst > (CONTAMINATION_SEVERITY[effectiveContamination] ?? 0)) {
          effectiveContamination = SEVERITY_CONTAMINATION[worst];
        }
      }
      return client.query(
        `INSERT INTO noesar_knowledge.${view}
           (id, signature, workspace_id, project_id, owner_user_id, visibility,
            category, content, provenance, contamination, promotion_state,
            derived, derived_from, observed_at, refutation_condition, confirmations)
         VALUES ($1,$2,$3,$4,$5,'private',$6,$7,$8::jsonb,$9,$10,$11,$12::uuid[],$13,$14,$15)
         RETURNING ${ITEM_COLUMNS}`,
        [
          id, signature, CANONICAL_WORKSPACE_ID, projectId, actorId,
          category, content, JSON.stringify(provenance ?? {}), effectiveContamination, promotionState,
          derived, uuidArrayLiteral(derivedFrom), observedAt ?? new Date().toISOString(),
          // Null outside the experience cube, where `counters_only_for_experience` (0017) and
          // `induced_fact_carries_refutation` (0020) both expect nothing.
          cube === INDUCED_CUBE ? String(refutationCondition).trim() : null,
          cube === INDUCED_CUBE ? confirmations : 0,
        ],
      ).then((result) => result.rows[0]);
    });
    return rowToItem(row);
  }

  /**
   * CUBE-006. Three properties, all from §9.4: items are records (never prose), coverage
   * always travels with the result, not_found is explicit rather than a silent zero.
   *
   * No embedding pipeline exists in this product yet (no TEI/model wired into
   * reference-control-plane — verified by grepping the source, not assumed), so the
   * seventh catalogue (similarity) genuinely cannot run. `coverage.vectorIndexComplete` is
   * computed from the real state of `embedding_models`/`memory_vectors`, not hardcoded: if
   * a model is ever configured and backfilled, this starts reporting true without this
   * file changing. Until then it reports false, honestly — "degraded but correct" (§9.3),
   * not a fabricated semantic search.
   */
  async recall({
    query = '', cube = null, project = null, category = null,
    since = null, until = null, limit = 20,
  } = {}, { actorId }) {
    const boundedLimit = Math.min(Math.max(Number.isFinite(Number(limit)) ? Number(limit) : 20, 1), 200);
    if (cube !== null) requireCube(cube);
    if (category !== null) requireCategory(category);
    const source = cube ? VIEW_BY_CUBE[cube] : 'all_memories';
    const text = String(query ?? '').trim();

    return this.#withContext({ actorId, projectId: project }, async (client) => {
      const conditions = [];
      const params = [];
      let n = 0;
      const bind = (value) => { params.push(value); n += 1; return `$${n}`; };

      let scoreSelect = 'NULL::real AS score';
      let orderBy = 'observed_at DESC';
      if (text) {
        const p = bind(text);
        conditions.push(`to_tsvector('simple', content) @@ plainto_tsquery('simple', ${p})`);
        scoreSelect = `ts_rank(to_tsvector('simple', content), plainto_tsquery('simple', ${p})) AS score`;
        orderBy = 'score DESC, observed_at DESC';
      }
      if (project !== null) conditions.push(`project_id = ${bind(project)}`);
      if (category !== null) conditions.push(`category = ${bind(category)}`);
      if (since !== null) conditions.push(`observed_at >= ${bind(since)}`);
      if (until !== null) conditions.push(`observed_at <= ${bind(until)}`);
      const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

      const countResult = await client.query(
        `SELECT count(*)::int AS n FROM noesar_knowledge.${source} ${where}`,
        params,
      );
      const candidates = countResult.rows[0]?.n ?? 0;

      const limitParam = bind(boundedLimit);
      const itemsResult = await client.query(
        `SELECT ${ITEM_COLUMNS}, ${scoreSelect}
         FROM noesar_knowledge.${source}
         ${where}
         ORDER BY ${orderBy}
         LIMIT ${limitParam}`,
        params,
      );
      const items = itemsResult.rows.map(rowToItem);

      // not_found: only computed when the combined query returned nothing, and only for
      // the filters actually supplied — each checked in isolation from the others so the
      // message names the criterion that is genuinely empty, not just "no results".
      const notFound = [];
      if (candidates === 0) {
        const checks = [
          text && ['testo di ricerca', `to_tsvector('simple', content) @@ plainto_tsquery('simple', $1)`, [text]],
          project !== null && ['progetto', 'project_id = $1', [project]],
          category !== null && ['categoria', 'category = $1', [category]],
          cube !== null && ['cubo', 'true', []], // the view itself already scopes this
        ].filter(Boolean);
        for (const [label, clause, args] of checks) {
          if (clause === 'true') continue;
          const check = await client.query(
            `SELECT count(*)::int AS n FROM noesar_knowledge.${source} WHERE ${clause}`,
            args,
          );
          if ((check.rows[0]?.n ?? 0) === 0) notFound.push(label);
        }
        if (notFound.length === 0 && conditions.length > 0) {
          notFound.push('la combinazione dei criteri richiesti');
        }
      }

      const modelResult = await client.query(
        `SELECT id, name FROM noesar_knowledge.embedding_models WHERE is_current LIMIT 1`,
      );
      const currentModel = modelResult.rows[0] ?? null;
      let vectorIndexComplete = false;
      if (currentModel) {
        const coverageResult = await client.query(
          `SELECT
             (SELECT count(*)::int FROM noesar_knowledge.all_memories) AS records,
             (SELECT count(*)::int FROM noesar_knowledge.memory_vectors WHERE model_id = $1) AS indexed`,
          [currentModel.id],
        );
        const row = coverageResult.rows[0] ?? { records: 0, indexed: 0 };
        vectorIndexComplete = row.records > 0 && row.indexed >= row.records;
      }

      return {
        items,
        coverage: {
          candidates,
          examined: candidates,
          returned: items.length,
          model: currentModel?.name ?? null,
          vectorIndexComplete,
        },
        notFound,
      };
    });
  }

  /**
   * Every record whose promotion_state ends in '-candidate', across all cubes.
   *
   * Queries `memory_records` directly, NOT through the four typed views or
   * `all_memories` — found live, not assumed: a plain PostgreSQL view's RLS is enforced
   * using the VIEW OWNER's identity (`noesar_migrator`, non-superuser), regardless of
   * which role is actually connected. An admin connection querying through the view is
   * therefore just as RLS-scoped as any other connection — with no `noesar.actor_id` GUC
   * ever set on an admin connection, `can_read_resource()` returns false for every row and
   * the "admin" query silently sees nothing. Direct access to the base table does not have
   * this problem: `memory_records` is owned by the actual superuser running migrations, so
   * a superuser connection bypasses RLS on it unconditionally, exactly as intended for a
   * privileged, already-audited operator surface — not exposed to `noesar_app` and not a
   * CUBE-004 regression, since noesar_app never reaches this method or this query shape.
   */
  async listCandidates({ project = null } = {}) {
    const supervisor = this.dataPlane();
    if (!supervisor?.pool) return [];
    return supervisor.withAdmin(async (admin) => {
      const result = await admin.query(
        `SELECT ${ITEM_COLUMNS} FROM noesar_knowledge.memory_records
         WHERE promotion_state LIKE '%-candidate'
           AND ($1::uuid IS NULL OR project_id = $1)
         ORDER BY observed_at ASC`,
        [project],
      );
      return result.rows.map(rowToItem);
    });
  }

  /**
   * §4: "nulla viene promosso automaticamente" — this is the ONLY path that moves a
   * record out of a `-candidate` state, and it is called exclusively from the approval
   * queue (server.mjs), never automatically. `project-candidate -> project` and
   * `global-candidate -> global` are the only two accepted transitions; anything else is
   * refused rather than guessed at.
   */
  async promote({ signature, cube, decision, actorId }) {
    requireCube(cube);
    requireUuid(actorId, 'actorId');
    const transitions = {
      approve: {
        'project-candidate': { next: 'project', visibility: 'project' },
        'global-candidate': { next: 'global', visibility: 'workspace' },
      },
      reject: {
        'project-candidate': { next: 'revoked', visibility: null },
        'global-candidate': { next: 'revoked', visibility: null },
      },
    };
    const table = transitions[decision];
    if (!table) throw Object.assign(new Error('decision must be "approve" or "reject"'), { status: 400 });

    // Admin-mediated, not the RLS-scoped path write() uses. A candidate is written
    // visibility:'private' (only its own actor can see it while undecided); the person
    // deciding is very often NOT that same actor (the Owner approving something a
    // background compaction wrote under a service actor, for instance), so
    // can_write_resource's owner-only check would refuse the very operation this method
    // exists to perform. This mirrors how ApprovalQueue already treats every OTHER kind
    // of approval — a privileged operator decision, not a peer-to-peer RLS-gated row
    // edit — which is why the decision is recorded as an explicit `decidedBy` here rather
    // than relied on implicitly via noesar.actor_id.
    //
    // Promotion also widens visibility in the same statement: a project/global record is
    // meant to be read by the rest of the project/workspace, not just its writer, and
    // recall() would otherwise return a promoted record to nobody but the original actor.
    //
    // Targets memory_records directly, NOT the cube-typed view — same reason as
    // listCandidates() above (found live: a view's RLS follows its OWNER's identity, not
    // the connecting role, so an admin connection querying through a noesar_migrator-owned
    // view is just as RLS-blind as any other unauthenticated connection). `cube` is kept
    // as a WHERE condition rather than dropped now that it no longer selects a view: it
    // catches a caller that names the wrong cube for a real signature, refusing instead of
    // silently promoting a record the caller was mistaken about.
    const supervisor = this.dataPlane();
    if (!supervisor?.pool) throw Object.assign(new Error('memory: no active PostgreSQL data plane'), { status: 503 });
    return supervisor.withAdmin(async (admin) => {
      const current = await admin.query(
        `SELECT promotion_state FROM noesar_knowledge.memory_records WHERE signature = $1 AND cube = $2`,
        [signature, cube],
      );
      const state = current.rows[0]?.promotion_state;
      const transition = table[state];
      if (!transition) {
        throw Object.assign(
          new Error(`"${signature}" (cube: ${cube}) is not awaiting promotion (state: ${state ?? 'not found'})`),
          { status: 409 },
        );
      }
      const result = transition.visibility
        ? await admin.query(
          `UPDATE noesar_knowledge.memory_records SET promotion_state = $1, visibility = $2 WHERE signature = $3 AND cube = $4
           RETURNING ${ITEM_COLUMNS}`,
          [transition.next, transition.visibility, signature, cube],
        )
        : await admin.query(
          `UPDATE noesar_knowledge.memory_records SET promotion_state = $1 WHERE signature = $2 AND cube = $3
           RETURNING ${ITEM_COLUMNS}`,
          [transition.next, signature, cube],
        );
      return { ...rowToItem(result.rows[0]), decidedBy: actorId };
    });
  }
}
