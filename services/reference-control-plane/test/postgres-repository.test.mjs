import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PostgresRepository,
  PostgresSqlCatalog,
} from '../src/postgres-repository.mjs';

const context = {
  actorId:'11111111-1111-4111-8111-111111111111',
  workspaceId:'22222222-2222-4222-8222-222222222222',
  projectId:'33333333-3333-4333-8333-333333333333',
};

class FakeClient {
  constructor(handler = () => ({ rows:[] })) {
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

function pool(client) {
  return { connect:async () => client };
}

test('repository requires a compatible pool', () => {
  assert.throws(() => new PostgresRepository({}), /pool is required/);
});

test('health is production ready only with PostgreSQL and pgvector versions', async () => {
  const client = new FakeClient(() => ({
    rows:[{
      server_version:'18.0',
      server_version_num:180000,
      pgvector_version:'0.8.0',
      postgres_18_or_newer:true,
      migration_count_verified:true,
      row_level_security_verified:true,
      audit_ledger_immutable:true,
      migration_ledger_immutable:true,
      application_role_no_bypassrls:true,
      audit_hash_chain_guard:true,
      production_attestation_ledger_immutable:true,
    }],
  }));
  const value = await new PostgresRepository(pool(client)).health();
  assert.equal(value.connected, true);
  assert.equal(value.productionReady, true);
  assert.equal(client.released, true);
});

test('health is not production ready without pgvector', async () => {
  const client = new FakeClient(() => ({
    rows:[{
      server_version:'18.0',
      server_version_num:180000,
      pgvector_version:null,
      postgres_18_or_newer:true,
      migration_count_verified:true,
      row_level_security_verified:true,
      audit_ledger_immutable:true,
      migration_ledger_immutable:true,
      application_role_no_bypassrls:true,
      audit_hash_chain_guard:true,
      production_attestation_ledger_immutable:true,
    }],
  }));
  const value = await new PostgresRepository(pool(client)).health();
  assert.equal(value.productionReady, false);
});

test('withContext sets transaction-local actor workspace and project', async () => {
  const client = new FakeClient();
  const repository = new PostgresRepository(pool(client));
  const value = await repository.withContext(context, async () => 'ok');
  assert.equal(value, 'ok');
  assert.deepEqual(
    client.calls.map(({ sql }) => sql.trim()),
    [
      'BEGIN',
      PostgresSqlCatalog.setActor.trim(),
      PostgresSqlCatalog.setWorkspace.trim(),
      PostgresSqlCatalog.setProject.trim(),
      PostgresSqlCatalog.assertContext.trim(),
      'COMMIT',
    ]
  );
  assert.deepEqual(client.calls[1].params, [context.actorId]);
  assert.deepEqual(client.calls[2].params, [context.workspaceId]);
  assert.deepEqual(client.calls[3].params, [context.projectId]);
  assert.equal(client.released, true);
});

test('withContext rolls back and releases on failure', async () => {
  const client = new FakeClient();
  const repository = new PostgresRepository(pool(client));
  await assert.rejects(
    repository.withContext(context, async () => {
      throw new Error('operation failed');
    }),
    /operation failed/
  );
  assert.equal(client.calls.at(-1).sql, 'ROLLBACK');
  assert.equal(client.released, true);
});

test('withContext requires actor and workspace', async () => {
  const repository = new PostgresRepository(pool(new FakeClient()));
  await assert.rejects(
    repository.withContext({ actorId:'owner' }, async () => null),
    /actorId and workspaceId/
  );
});

test('appendAuditEvent uses parameterized SQL', async () => {
  const client = new FakeClient((sql) => ({
    rows:sql === PostgresSqlCatalog.appendAudit
      ? [{ id:'44444444-4444-4444-8444-444444444444' }]
      : [],
  }));
  const repository = new PostgresRepository(pool(client));
  await repository.appendAuditEvent(context, {
    id:'44444444-4444-4444-8444-444444444444',
    sessionId:'55555555-5555-4555-8555-555555555555',
    action:"audit'; DROP TABLE users; --",
    result:'denied',
    details:{ reason:'test' },
    previousHash:'a'.repeat(64),
    eventHash:'b'.repeat(64),
  });
  const insert = client.calls.find(({ sql }) => sql === PostgresSqlCatalog.appendAudit);
  assert.ok(insert);
  assert.ok(!insert.sql.includes('DROP TABLE'));
  assert.equal(insert.params[5], "audit'; DROP TABLE users; --");
});

test('document list validates limit', async () => {
  const repository = new PostgresRepository(pool(new FakeClient()));
  await assert.rejects(
    repository.listDocuments(context, { limit:1001 }),
    /between 1 and 1000/
  );
});

test('document list returns scoped rows', async () => {
  const rows = [{ logical_path:'a.txt' }, { logical_path:'b.txt' }];
  const client = new FakeClient((sql) => ({
    rows:sql === PostgresSqlCatalog.listDocuments ? rows : [],
  }));
  const value = await new PostgresRepository(pool(client))
    .listDocuments(context, { limit:2 });
  assert.deepEqual(value, rows);
  const query = client.calls.find(({ sql }) => sql === PostgresSqlCatalog.listDocuments);
  assert.deepEqual(query.params, [context.workspaceId, context.projectId, 2]);
});

test('memory insert rejects the wrong vector dimension', async () => {
  const repository = new PostgresRepository(pool(new FakeClient()));
  await assert.rejects(
    repository.insertMemoryItem(context, {
      id:'66666666-6666-4666-8666-666666666666',
      content:'memory',
      promotionState:'project',
      createdBy:context.actorId,
      embedding:[1, 2],
    }),
    /exactly 384/
  );
});

test('memory insert rejects non-finite vector values', async () => {
  const repository = new PostgresRepository(pool(new FakeClient()));
  const embedding = Array(384).fill(0);
  embedding[10] = Number.NaN;
  await assert.rejects(
    repository.insertMemoryItem(context, {
      id:'66666666-6666-4666-8666-666666666666',
      content:'memory',
      promotionState:'project',
      createdBy:context.actorId,
      embedding,
    }),
    /non-finite/
  );
});

test('memory insert serializes a valid 384-dimensional vector', async () => {
  const client = new FakeClient((sql) => ({
    rows:sql === PostgresSqlCatalog.insertMemory
      ? [{ id:'66666666-6666-4666-8666-666666666666' }]
      : [],
  }));
  const repository = new PostgresRepository(pool(client));
  const value = await repository.insertMemoryItem(context, {
    id:'66666666-6666-4666-8666-666666666666',
    content:'memory',
    promotionState:'project',
    createdBy:context.actorId,
    provenance:{ source:'test' },
    embedding:Array(384).fill(0.5),
  });
  assert.equal(value.id, '66666666-6666-4666-8666-666666666666');
  const query = client.calls.find(({ sql }) => sql === PostgresSqlCatalog.insertMemory);
  assert.ok(query.params[5].startsWith('[0.5,0.5'));
  assert.ok(query.params[5].endsWith(']'));
});


test('health is not production ready when RLS evidence is false', async () => {
  const client = new FakeClient(() => ({
    rows:[{
      server_version:'18.0',
      server_version_num:180000,
      pgvector_version:'0.8.0',
      postgres_18_or_newer:true,
      migration_count_verified:true,
      row_level_security_verified:false,
      audit_ledger_immutable:true,
      migration_ledger_immutable:true,
      application_role_no_bypassrls:true,
      audit_hash_chain_guard:true,
      production_attestation_ledger_immutable:true,
    }],
  }));
  const value = await new PostgresRepository(pool(client)).health();
  assert.equal(value.productionReady, false);
  assert.equal(value.checks.rowLevelSecurity, false);
});

test('health is not production ready when app role can bypass RLS', async () => {
  const client = new FakeClient(() => ({
    rows:[{
      server_version:'18.0',
      server_version_num:180000,
      pgvector_version:'0.8.0',
      postgres_18_or_newer:true,
      migration_count_verified:true,
      row_level_security_verified:true,
      audit_ledger_immutable:true,
      migration_ledger_immutable:true,
      application_role_no_bypassrls:false,
      audit_hash_chain_guard:true,
      production_attestation_ledger_immutable:true,
    }],
  }));
  const value = await new PostgresRepository(pool(client)).health();
  assert.equal(value.productionReady, false);
  assert.equal(value.checks.appRoleNoBypassRls, false);
});


test('health is not production ready without audit chain guard', async () => {
  const client = new FakeClient(() => ({
    rows:[{
      server_version:'18.0',
      server_version_num:180000,
      pgvector_version:'0.8.0',
      postgres_18_or_newer:true,
      migration_count_verified:true,
      row_level_security_verified:true,
      audit_ledger_immutable:true,
      migration_ledger_immutable:true,
      application_role_no_bypassrls:true,
      audit_hash_chain_guard:false,
      production_attestation_ledger_immutable:true,
    }],
  }));
  const value = await new PostgresRepository(pool(client)).health();
  assert.equal(value.productionReady, false);
  assert.equal(value.checks.auditHashChainGuard, false);
});

test('health is not production ready without immutable production attestations', async () => {
  const client = new FakeClient(() => ({
    rows:[{
      server_version:'18.0',
      server_version_num:180000,
      pgvector_version:'0.8.0',
      postgres_18_or_newer:true,
      migration_count_verified:true,
      row_level_security_verified:true,
      audit_ledger_immutable:true,
      migration_ledger_immutable:true,
      application_role_no_bypassrls:true,
      audit_hash_chain_guard:true,
      production_attestation_ledger_immutable:false,
    }],
  }));
  const value = await new PostgresRepository(pool(client)).health();
  assert.equal(value.productionReady, false);
  assert.equal(value.checks.productionAttestationLedger, false);
});

test('production gate requires V0.6.0 and exact manifest hash', async () => {
  const repository = new PostgresRepository(pool(new FakeClient()));
  await assert.rejects(
    repository.productionGate({
      release:'0.5.0',
      migrationManifestSha256:'a'.repeat(64),
    }),
    /release must equal 0.6.0/
  );
  await assert.rejects(
    repository.productionGate({
      release:'0.6.0',
      migrationManifestSha256:'not-a-hash',
    }),
    /lowercase SHA-256/
  );
});

test('production gate reports all seven evidence domains', async () => {
  const client = new FakeClient((sql) => ({
    rows:sql === PostgresSqlCatalog.productionGate
      ? [{
          rust_authority:true,
          postgresql_data_plane:true,
          migration_manifest:true,
          sandbox:true,
          platform_matrix:true,
          update_trust:true,
          penetration_test:true,
          production_ready:true,
        }]
      : [],
  }));
  const manifest = 'a'.repeat(64);
  const value = await new PostgresRepository(pool(client)).productionGate({
    migrationManifestSha256:manifest,
  });
  assert.equal(value.productionReady, true);
  assert.equal(value.release, '0.6.0');
  assert.deepEqual(
    client.calls.find(({ sql }) => sql === PostgresSqlCatalog.productionGate).params,
    ['0.6.0', manifest]
  );
  assert.equal(client.released, true);
});

test('production gate remains false when one evidence domain is absent', async () => {
  const client = new FakeClient((sql) => ({
    rows:sql === PostgresSqlCatalog.productionGate
      ? [{
          rust_authority:true,
          postgresql_data_plane:true,
          migration_manifest:true,
          sandbox:true,
          platform_matrix:true,
          update_trust:false,
          penetration_test:true,
          production_ready:false,
        }]
      : [],
  }));
  const value = await new PostgresRepository(pool(client)).productionGate({
    migrationManifestSha256:'a'.repeat(64),
  });
  assert.equal(value.productionReady, false);
  assert.equal(value.checks.updateTrust, false);
});

test('audit hashes must be lowercase SHA-256 and distinct', async () => {
  const repository = new PostgresRepository(pool(new FakeClient()));
  const base = {
    id:'44444444-4444-4444-8444-444444444444',
    sessionId:'55555555-5555-4555-8555-555555555555',
    action:'test',
    result:'denied',
    details:{},
  };
  await assert.rejects(
    repository.appendAuditEvent(context, {
      ...base,
      previousHash:'A'.repeat(64),
      eventHash:'b'.repeat(64),
    }),
    /lowercase SHA-256/
  );
  await assert.rejects(
    repository.appendAuditEvent(context, {
      ...base,
      previousHash:'a'.repeat(64),
      eventHash:'a'.repeat(64),
    }),
    /must not equal/
  );
});
