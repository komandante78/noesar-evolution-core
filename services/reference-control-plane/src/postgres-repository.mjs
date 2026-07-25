// SPDX-License-Identifier: AGPL-3.0-or-later

const SQL = Object.freeze({
  setActor: `SELECT set_config('noesar.actor_id', $1, true)`,
  setWorkspace: `SELECT set_config('noesar.workspace_id', $1, true)`,
  setProject: `SELECT set_config('noesar.project_id', $1, true)`,
  assertContext: `SELECT noesar_runtime.assert_context()`,
  productionGate: `
    SELECT *
    FROM noesar_runtime.production_gate($1, $2)
  `,
  health: `
    SELECT
      current_setting('server_version') AS server_version,
      current_setting('server_version_num')::integer AS server_version_num,
      (
        SELECT extversion
        FROM pg_extension
        WHERE extname = 'vector'
      ) AS pgvector_version,
      postgres_18_or_newer,
      migration_count_verified,
      row_level_security_verified,
      audit_ledger_immutable,
      migration_ledger_immutable,
      application_role_no_bypassrls,
      audit_hash_chain_guard,
      production_attestation_ledger_immutable
    FROM noesar_runtime.security_acceptance
  `,
  appendAudit: `
    INSERT INTO noesar_audit.events (
      id,
      actor_user_id,
      session_id,
      workspace_id,
      project_id,
      action,
      result,
      details,
      previous_hash,
      event_hash
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10)
    RETURNING id, occurred_at
  `,
  listDocuments: `
    SELECT
      id,
      workspace_id,
      project_id,
      logical_path,
      media_type,
      content_sha256,
      classification,
      created_by,
      created_at
    FROM noesar_knowledge.documents
    WHERE workspace_id = $1
      AND ($2::uuid IS NULL OR project_id = $2)
    ORDER BY logical_path
    LIMIT $3
  `,
  insertMemory: `
    INSERT INTO noesar_knowledge.memory_items (
      id,
      workspace_id,
      project_id,
      provenance,
      content,
      embedding,
      promotion_state,
      created_by
    )
    VALUES ($1,$2,$3,$4::jsonb,$5,$6::vector,$7,$8)
    RETURNING id, created_at
  `,
});

function requireContext(context) {
  if (!context?.actorId || !context?.workspaceId) {
    throw new Error('actorId and workspaceId are required');
  }
  return {
    actorId:String(context.actorId),
    workspaceId:String(context.workspaceId),
    projectId:context.projectId ? String(context.projectId) : '',
  };
}

function requireUuidLike(value, field) {
  if (typeof value !== 'string' || !/^[0-9a-f-]{36}$/i.test(value)) {
    throw new Error(`${field} must be a UUID string`);
  }
}

function requireSha256(value, field) {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/.test(value)) {
    throw new Error(`${field} must be lowercase SHA-256 hex`);
  }
}

export class PostgresRepository {
  constructor(pool) {
    if (!pool || typeof pool.connect !== 'function') {
      throw new TypeError('a PostgreSQL-compatible pool is required');
    }
    this.pool = pool;
  }

  async health() {
    const client = await this.pool.connect();
    try {
      const result = await client.query(SQL.health);
      const row = result.rows?.[0] ?? {};
      const checks = {
        postgres18:Boolean(row.postgres_18_or_newer),
        pgvector:Boolean(row.pgvector_version),
        migrations:Boolean(row.migration_count_verified),
        rowLevelSecurity:Boolean(row.row_level_security_verified),
        auditLedger:Boolean(row.audit_ledger_immutable),
        migrationLedger:Boolean(row.migration_ledger_immutable),
        appRoleNoBypassRls:Boolean(row.application_role_no_bypassrls),
        auditHashChainGuard:Boolean(row.audit_hash_chain_guard),
        productionAttestationLedger:Boolean(
          row.production_attestation_ledger_immutable
        ),
      };
      return {
        connected:true,
        serverVersion:row.server_version ?? null,
        serverVersionNumber:Number(row.server_version_num ?? 0),
        pgvectorVersion:row.pgvector_version ?? null,
        checks,
        productionReady:Object.values(checks).every(Boolean),
      };
    } finally {
      client.release();
    }
  }

  async withContext(context, operation) {
    const scoped = requireContext(context);
    if (typeof operation !== 'function') {
      throw new TypeError('operation must be a function');
    }

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(SQL.setActor, [scoped.actorId]);
      await client.query(SQL.setWorkspace, [scoped.workspaceId]);
      await client.query(SQL.setProject, [scoped.projectId]);
      await client.query(SQL.assertContext);
      const value = await operation(client);
      await client.query('COMMIT');
      return value;
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch {}
      throw error;
    } finally {
      client.release();
    }
  }

  async productionGate({
    release = '0.6.0',
    migrationManifestSha256,
  } = {}) {
    if (release !== '0.6.0') {
      throw new Error('production gate release must equal 0.6.0');
    }
    requireSha256(
      migrationManifestSha256,
      'migrationManifestSha256'
    );
    const client = await this.pool.connect();
    try {
      const result = await client.query(SQL.productionGate, [
        release,
        migrationManifestSha256,
      ]);
      const row = result.rows?.[0] ?? {};
      const checks = {
        rustAuthority:Boolean(row.rust_authority),
        postgresqlDataPlane:Boolean(row.postgresql_data_plane),
        migrationManifest:Boolean(row.migration_manifest),
        sandbox:Boolean(row.sandbox),
        platformMatrix:Boolean(row.platform_matrix),
        updateTrust:Boolean(row.update_trust),
        penetrationTest:Boolean(row.penetration_test),
      };
      return {
        release,
        migrationManifestSha256,
        checks,
        productionReady:Boolean(row.production_ready)
          && Object.values(checks).every(Boolean),
      };
    } finally {
      client.release();
    }
  }

  async appendAuditEvent(context, event) {
    const required = [
      'id', 'sessionId', 'action', 'result',
      'previousHash', 'eventHash',
    ];
    for (const field of required) {
      if (!event?.[field]) throw new Error(`event.${field} is required`);
    }
    requireUuidLike(event.id, 'event.id');
    requireUuidLike(event.sessionId, 'event.sessionId');
    requireSha256(event.previousHash, 'event.previousHash');
    requireSha256(event.eventHash, 'event.eventHash');
    if (event.previousHash === event.eventHash) {
      throw new Error('event hash must not equal previous hash');
    }

    return this.withContext(context, async (client) => {
      const result = await client.query(SQL.appendAudit, [
        event.id,
        context.actorId,
        event.sessionId,
        context.workspaceId,
        context.projectId ?? null,
        event.action,
        event.result,
        JSON.stringify(event.details ?? {}),
        event.previousHash,
        event.eventHash,
      ]);
      return result.rows?.[0] ?? null;
    });
  }

  async listDocuments(context, { limit = 100 } = {}) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 1000) {
      throw new Error('limit must be an integer between 1 and 1000');
    }
    return this.withContext(context, async (client) => {
      const result = await client.query(SQL.listDocuments, [
        context.workspaceId,
        context.projectId ?? null,
        limit,
      ]);
      return result.rows ?? [];
    });
  }

  async insertMemoryItem(context, item) {
    const required = [
      'id', 'content', 'promotionState', 'createdBy',
    ];
    for (const field of required) {
      if (!item?.[field]) throw new Error(`item.${field} is required`);
    }
    requireUuidLike(item.id, 'item.id');
    requireUuidLike(item.createdBy, 'item.createdBy');
    if (item.embedding != null) {
      if (!Array.isArray(item.embedding) || item.embedding.length !== 384) {
        throw new Error('embedding must contain exactly 384 numbers');
      }
      if (!item.embedding.every(Number.isFinite)) {
        throw new Error('embedding contains a non-finite number');
      }
    }

    return this.withContext(context, async (client) => {
      const result = await client.query(SQL.insertMemory, [
        item.id,
        context.workspaceId,
        context.projectId ?? null,
        JSON.stringify(item.provenance ?? {}),
        item.content,
        item.embedding == null
          ? null
          : `[${item.embedding.join(',')}]`,
        item.promotionState,
        item.createdBy,
      ]);
      return result.rows?.[0] ?? null;
    });
  }
}

export const PostgresSqlCatalog = SQL;
