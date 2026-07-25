// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Supervises a PostgreSQL 18 cluster as a child process of the control plane.
//
// The deployment constraint this satisfies: one container. Not a second PostgreSQL
// container, not an external database the operator has to provide. The cluster lives
// under the persistent workspace, is created on first start, is owned by the same
// unprivileged uid as the runtime, listens on a unix socket only, and is shut down
// cleanly when the runtime stops.
//
// Credentials are generated here, at run time, and never leave the workspace. Nothing
// in this file writes a password to a log line, an environment variable readable by
// `docker inspect`, or a tracked file.

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { PgPool, PgConnection, PostgresError } from './pg-client.mjs';

const DEFAULT_PORT = 5432;
const ADMIN_ROLE = 'noesar_admin';
const APP_ROLE = 'noesar_app';
const DATABASE = 'noesar';

export const SupervisorState = Object.freeze({
  STOPPED: 'stopped',
  INITIALISING: 'initialising',
  STARTING: 'starting',
  MIGRATING: 'migrating',
  READY: 'ready',
  DEGRADED: 'degraded',
  STOPPING: 'stopping',
  FAILED: 'failed',
});

function generatePassword() {
  // 32 bytes of CSPRNG output, base64url so it survives every config file this
  // product writes without escaping. Never logged, never in an env var.
  return crypto.randomBytes(32).toString('base64url');
}

async function writeSecret(file, value) {
  await fsp.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  // Written 0600 from the first byte: creating 0644 and chmod-ing afterwards leaves a
  // window in which any process on the host can read it.
  const handle = await fsp.open(file, 'w', 0o600);
  try {
    await handle.write(value, 0, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
  await fsp.chmod(file, 0o600);
}

async function readSecret(file) {
  const value = await fsp.readFile(file, 'utf8');
  return value.trim();
}

function quoteLiteral(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function quoteIdentifier(value) {
  if (!/^[a-z_][a-z0-9_]*$/.test(value)) {
    throw new Error(`refusing to quote an unexpected identifier: ${value}`);
  }
  return `"${value}"`;
}

export class PostgresSupervisor {
  constructor(options = {}) {
    const root = options.root ?? process.env.NOESAR_POSTGRES_ROOT
      ?? path.join(process.env.NOESAR_WORKSPACE ?? '/workspace', 'postgresql');
    this.root = root;
    this.dataDir = path.join(root, 'data');
    this.socketDir = path.join(root, 'run');
    this.backupDir = path.join(root, 'backups');
    this.secretsDir = options.secretsDir
      ?? path.join(process.env.NOESAR_WORKSPACE ?? '/workspace', 'config', 'postgres');
    this.binDir = options.binDir ?? process.env.NOESAR_POSTGRES_BINDIR
      ?? '/usr/lib/postgresql/18/bin';
    this.port = Number.parseInt(String(options.port ?? process.env.NOESAR_POSTGRES_PORT ?? DEFAULT_PORT), 10);
    this.migrationsDir = options.migrationsDir ?? process.env.NOESAR_MIGRATIONS_DIR
      ?? '/opt/noesar/database/postgres';
    this.logger = options.logger ?? null;
    this.startTimeoutMs = options.startTimeoutMs ?? 60000;
    this.stopTimeoutMs = options.stopTimeoutMs ?? 30000;
    this.maxRestarts = options.maxRestarts ?? 5;

    this.state = SupervisorState.STOPPED;
    this.process = null;
    this.pool = null;
    this.restarts = 0;
    this.lastError = null;
    this.serverVersionNum = null;
    this.pgvectorVersion = null;
    this.appliedMigrations = [];
    this.startedAtUtc = null;
    this.intentionalStop = false;
    this.recentServerLog = [];
  }

  #log(level, event, detail = {}) {
    if (this.logger && typeof this.logger[level] === 'function') {
      this.logger[level](event, detail);
      return;
    }
    const line = JSON.stringify({
      ts: new Date().toISOString(), level, event, component: 'postgres-supervisor', ...detail,
    });
    if (level === 'error' || level === 'warn') process.stderr.write(`${line}\n`);
    else process.stdout.write(`${line}\n`);
  }

  bin(name) {
    return path.join(this.binDir, name);
  }

  get socketFile() {
    return path.join(this.socketDir, `.s.PGSQL.${this.port}`);
  }

  get adminSecretFile() {
    return path.join(this.secretsDir, 'admin.secret');
  }

  get appSecretFile() {
    return path.join(this.secretsDir, 'app.secret');
  }

  isInitialised() {
    return fs.existsSync(path.join(this.dataDir, 'PG_VERSION'));
  }

  async #run(command, args, { input = null, env = {} } = {}) {
    return new Promise((resolve, reject) => {
      const child = spawn(command, args, {
        env: { ...process.env, ...env },
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (d) => { stdout += d.toString('utf8'); });
      child.stderr.on('data', (d) => { stderr += d.toString('utf8'); });
      child.on('error', reject);
      child.on('close', (code) => {
        if (code === 0) resolve({ stdout, stderr });
        else reject(new Error(`${path.basename(command)} exited ${code}: ${stderr.trim() || stdout.trim()}`));
      });
      if (input !== null) child.stdin.end(input);
      else child.stdin.end();
    });
  }

  async initialise() {
    if (this.isInitialised()) return { initialised: false };
    this.state = SupervisorState.INITIALISING;
    this.#log('info', 'postgres.initdb.start', { dataDir: this.dataDir });

    await fsp.mkdir(this.dataDir, { recursive: true, mode: 0o700 });
    await fsp.chmod(this.dataDir, 0o700);
    await fsp.mkdir(this.socketDir, { recursive: true, mode: 0o700 });
    await fsp.mkdir(this.backupDir, { recursive: true, mode: 0o700 });
    await fsp.mkdir(this.secretsDir, { recursive: true, mode: 0o700 });

    const adminPassword = generatePassword();
    // initdb reads the superuser password from a file, never from argv: an argv
    // password is visible in /proc/<pid>/cmdline to anything that can read it.
    const pwFile = path.join(this.secretsDir, `.initdb.${crypto.randomBytes(8).toString('hex')}`);
    await writeSecret(pwFile, adminPassword);
    try {
      await this.#run(this.bin('initdb'), [
        '--pgdata', this.dataDir,
        '--username', ADMIN_ROLE,
        '--pwfile', pwFile,
        '--auth-local=scram-sha-256',
        '--auth-host=scram-sha-256',
        '--encoding=UTF8',
        '--locale=C.UTF-8',
        '--data-checksums',
      ]);
    } finally {
      // Truncate before unlinking: the bytes are gone from the directory entry either
      // way, but truncation is what stops a crash between the two leaving them behind.
      await fsp.writeFile(pwFile, '').catch(() => {});
      await fsp.rm(pwFile, { force: true }).catch(() => {});
    }

    await writeSecret(this.adminSecretFile, adminPassword);
    await writeSecret(this.appSecretFile, generatePassword());
    await this.#writeConfiguration();

    this.#log('info', 'postgres.initdb.complete', { dataDir: this.dataDir });
    return { initialised: true };
  }

  async #writeConfiguration() {
    // A unix socket and nothing else. There is no TCP listener to reach, from the LAN
    // or from another container on the same bridge, because none is opened.
    const conf = [
      "# Managed by NOESAR Evolution. Regenerated on every start.",
      "listen_addresses = ''",
      `port = ${this.port}`,
      `unix_socket_directories = '${this.socketDir}'`,
      'unix_socket_permissions = 0700',
      "password_encryption = 'scram-sha-256'",
      'shared_buffers = 128MB',
      'work_mem = 8MB',
      'maintenance_work_mem = 64MB',
      'max_connections = 40',
      // The container is given 64 MiB of /dev/shm. Parallel query allocates dynamic
      // shared memory segments there, so parallelism is disabled rather than left to
      // fail at an unpredictable moment under load.
      'max_parallel_workers_per_gather = 0',
      'max_parallel_workers = 0',
      'max_parallel_maintenance_workers = 0',
      "dynamic_shared_memory_type = posix",
      'fsync = on',
      'full_page_writes = on',
      "synchronous_commit = on",
      "log_destination = 'stderr'",
      'logging_collector = off',
      "log_min_messages = warning",
      "log_line_prefix = '%m [%p] %q%u@%d '",
      'log_checkpoints = off',
      // Connections are local-only and short-lived; logging every one would drown the
      // audit trail that matters in noise.
      "log_connections = 'off'",
      'log_disconnections = off',
      'log_statement = none',
      'jit = off',
      '',
    ].join('\n');
    await fsp.writeFile(path.join(this.dataDir, 'postgresql.auto.conf'), conf, { mode: 0o600 });

    const hba = [
      '# Managed by NOESAR Evolution. Local socket only, SCRAM-SHA-256 only.',
      '# There is deliberately no host/hostssl line: the cluster has no TCP listener,',
      '# and an unused permissive rule is a rule waiting to become used.',
      'local   all   all   scram-sha-256',
      '',
    ].join('\n');
    await fsp.writeFile(path.join(this.dataDir, 'pg_hba.conf'), hba, { mode: 0o600 });

    await fsp.writeFile(
      path.join(this.dataDir, 'pg_ident.conf'),
      '# Managed by NOESAR Evolution. No identity mapping is used.\n',
      { mode: 0o600 },
    );
  }

  #spawnServer() {
    const child = spawn(this.bin('postgres'), ['-D', this.dataDir], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, PGDATA: this.dataDir },
    });

    // stderr must be consumed. An unread pipe fills at 64 KiB and blocks the writer —
    // which here is the database, so an unread log would eventually freeze the cluster.
    const consume = (stream) => {
      stream.setEncoding('utf8');
      let partial = '';
      stream.on('data', (chunk) => {
        partial += chunk;
        const lines = partial.split('\n');
        partial = lines.pop() ?? '';
        for (const line of lines) {
          if (line.trim() === '') continue;
          this.recentServerLog.push(line);
          if (this.recentServerLog.length > 100) this.recentServerLog.shift();
          this.#log('info', 'postgres.server', { line });
        }
      });
    };
    consume(child.stdout);
    consume(child.stderr);

    child.on('exit', (code, signal) => {
      this.process = null;
      if (this.intentionalStop) return;
      this.state = SupervisorState.DEGRADED;
      this.#log('error', 'postgres.server.exited', { code, signal, restarts: this.restarts });
      this.#attemptRestart();
    });

    this.process = child;
    return child;
  }

  #attemptRestart() {
    if (this.restarts >= this.maxRestarts) {
      this.state = SupervisorState.FAILED;
      this.lastError = new Error(
        `PostgreSQL exited ${this.restarts} times; not restarting again`,
      );
      this.#log('error', 'postgres.restart.exhausted', { restarts: this.restarts });
      return;
    }
    this.restarts += 1;
    const delay = Math.min(1000 * (2 ** (this.restarts - 1)), 15000);
    this.#log('warn', 'postgres.restart.scheduled', { attempt: this.restarts, delayMs: delay });
    setTimeout(() => {
      this.start({ recovering: true }).catch((error) => {
        this.lastError = error;
        this.#log('error', 'postgres.restart.failed', { message: error.message });
      });
      // Deliberately NOT unref'd. An unref'd timer does not hold the event loop open, so
      // if nothing else were pending the process would exit — with status 0, as if all
      // were well — instead of restarting the database it had just watched die. Observed
      // rather than theorised: the integration exercise ended at "restart.scheduled" and
      // reported success.
    }, delay);
  }

  async #waitForSocket(deadline) {
    for (;;) {
      if (fs.existsSync(this.socketFile)) return;
      if (Date.now() > deadline) {
        throw new Error(
          `PostgreSQL did not create its socket within ${this.startTimeoutMs} ms`
          + (this.recentServerLog.length ? `; last log: ${this.recentServerLog.slice(-3).join(' | ')}` : ''),
        );
      }
      await new Promise((r) => { setTimeout(r, 100); });
    }
  }

  async #waitForAcceptingConnections(password, deadline) {
    let lastError = null;
    for (;;) {
      try {
        const probe = new PgConnection({
          socketPath: this.socketFile,
          user: ADMIN_ROLE,
          database: 'postgres',
          password,
          applicationName: 'noesar-supervisor-probe',
          connectTimeoutMs: 5000,
          statementTimeoutMs: 0,
        });
        await probe.connect();
        await probe.query('SELECT 1');
        await probe.end();
        return;
      } catch (error) {
        lastError = error;
        // 57P03 cannot_connect_now is what a cluster still replaying WAL answers with.
        // It is a wait condition, not a failure.
        if (error instanceof PostgresError && error.code && error.code !== '57P03') throw error;
        if (Date.now() > deadline) {
          throw new Error(`PostgreSQL never accepted connections: ${lastError?.message ?? 'unknown'}`);
        }
        await new Promise((r) => { setTimeout(r, 200); });
      }
    }
  }

  async start({ recovering = false } = {}) {
    if (this.state === SupervisorState.READY && this.process) return this.status();
    this.intentionalStop = false;
    await this.initialise();
    // The configuration is rewritten on every start so that an operator editing the
    // generated file cannot silently open a TCP listener that survives a restart.
    await this.#writeConfiguration();
    await fsp.mkdir(this.socketDir, { recursive: true, mode: 0o700 });
    await fsp.chmod(this.socketDir, 0o700).catch(() => {});

    // A postmaster.pid left behind by an unclean stop stops a restart dead. If no
    // process holds it, it is stale and removing it is the documented recovery.
    await this.#clearStalePidFile();

    this.state = SupervisorState.STARTING;
    this.startedAtUtc = new Date().toISOString();
    this.#spawnServer();

    const deadline = Date.now() + this.startTimeoutMs;
    const adminPassword = await readSecret(this.adminSecretFile);
    await this.#waitForSocket(deadline);
    await this.#waitForAcceptingConnections(adminPassword, deadline);

    await this.#ensureDatabaseAndRoles(adminPassword);

    this.state = SupervisorState.MIGRATING;
    const migrationResult = await this.applyMigrations(adminPassword);
    this.appliedMigrations = migrationResult.applied;

    const appPassword = await readSecret(this.appSecretFile);
    this.pool = new PgPool({
      socketPath: this.socketFile,
      user: APP_ROLE,
      database: DATABASE,
      password: appPassword,
      applicationName: 'noesar-control-plane',
      max: 8,
    });

    const health = await this.health();
    this.serverVersionNum = health.serverVersionNumber;
    this.pgvectorVersion = health.pgvectorVersion;
    this.state = SupervisorState.READY;
    this.#log('info', recovering ? 'postgres.recovered' : 'postgres.ready', {
      serverVersion: health.serverVersion,
      pgvector: health.pgvectorVersion,
      migrations: migrationResult.applied.length,
      restarts: this.restarts,
    });
    return this.status();
  }

  async #clearStalePidFile() {
    const pidFile = path.join(this.dataDir, 'postmaster.pid');
    if (!fs.existsSync(pidFile)) return;
    let pid = null;
    try {
      pid = Number.parseInt((await fsp.readFile(pidFile, 'utf8')).split('\n')[0], 10);
    } catch {
      return;
    }
    if (Number.isInteger(pid) && pid > 0) {
      try {
        process.kill(pid, 0);
        // Signal 0 succeeded: a live process holds this pid. Leave the file alone —
        // removing it here would let a second postmaster attach to the same data
        // directory, which corrupts the cluster.
        throw new Error(`a PostgreSQL process (pid ${pid}) already holds ${this.dataDir}`);
      } catch (error) {
        if (error.code !== 'ESRCH') {
          if (error.code === 'EPERM') {
            throw new Error(`a process (pid ${pid}) already holds ${this.dataDir}`);
          }
          if (!error.code) throw error;
        }
      }
    }
    this.#log('warn', 'postgres.stale_pid_removed', { pid });
    await fsp.rm(pidFile, { force: true });
  }

  async #ensureDatabaseAndRoles(adminPassword) {
    const admin = new PgConnection({
      socketPath: this.socketFile,
      user: ADMIN_ROLE,
      database: 'postgres',
      password: adminPassword,
      applicationName: 'noesar-supervisor',
      statementTimeoutMs: 60000,
    });
    await admin.connect();
    try {
      const existing = await admin.query(
        'SELECT 1 AS present FROM pg_database WHERE datname = $1', [DATABASE],
      );
      if (existing.rows.length === 0) {
        await admin.query(`CREATE DATABASE ${quoteIdentifier(DATABASE)} OWNER ${quoteIdentifier(ADMIN_ROLE)}`);
        this.#log('info', 'postgres.database.created', { database: DATABASE });
      }

      const appPassword = await readSecret(this.appSecretFile);
      const role = await admin.query(
        'SELECT rolbypassrls, rolsuper FROM pg_roles WHERE rolname = $1', [APP_ROLE],
      );
      if (role.rows.length === 0) {
        // NOBYPASSRLS is the whole point of a separate application role: the runtime
        // must be a subject of Row Level Security, not exempt from it.
        await admin.query(
          `CREATE ROLE ${quoteIdentifier(APP_ROLE)} LOGIN NOSUPERUSER NOCREATEDB `
          + `NOCREATEROLE NOINHERIT NOBYPASSRLS PASSWORD ${quoteLiteral(appPassword)}`,
        );
        this.#log('info', 'postgres.role.created', { role: APP_ROLE });
      } else {
        await admin.query(
          `ALTER ROLE ${quoteIdentifier(APP_ROLE)} NOSUPERUSER NOBYPASSRLS `
          + `PASSWORD ${quoteLiteral(appPassword)}`,
        );
      }
    } finally {
      await admin.end();
    }
  }

  async listMigrations() {
    const entries = await fsp.readdir(this.migrationsDir);
    return entries
      .filter((name) => /^\d{4}_.*\.sql$/.test(name))
      .sort((a, b) => a.localeCompare(b));
  }

  async applyMigrations(adminPassword) {
    const password = adminPassword ?? await readSecret(this.adminSecretFile);
    const admin = new PgConnection({
      socketPath: this.socketFile,
      user: ADMIN_ROLE,
      database: DATABASE,
      password,
      applicationName: 'noesar-migrator',
      statementTimeoutMs: 300000,
    });
    await admin.connect();
    const applied = [];
    const skipped = [];
    try {
      await admin.query(`
        CREATE SCHEMA IF NOT EXISTS noesar_migration;
        CREATE TABLE IF NOT EXISTS noesar_migration.applied (
          filename    text PRIMARY KEY,
          sha256      text NOT NULL,
          applied_at  timestamptz NOT NULL DEFAULT now()
        );
      `);

      const ledger = await admin.query('SELECT filename, sha256 FROM noesar_migration.applied');
      const known = new Map(ledger.rows.map((row) => [row.filename, row.sha256]));

      for (const filename of await this.listMigrations()) {
        const sql = await fsp.readFile(path.join(this.migrationsDir, filename), 'utf8');
        const digest = crypto.createHash('sha256').update(sql).digest('hex');
        const recorded = known.get(filename);
        if (recorded) {
          if (recorded !== digest) {
            // An applied migration whose file changed is a fork in history. Replaying
            // it would produce a schema that matches neither version.
            throw new Error(
              `migration ${filename} was applied with sha256 ${recorded} but the file on disk is ${digest}`,
            );
          }
          skipped.push(filename);
          continue;
        }
        this.#log('info', 'postgres.migration.apply', { filename, sha256: digest });
        await admin.query(sql);
        await admin.query(
          'INSERT INTO noesar_migration.applied (filename, sha256) VALUES ($1, $2)',
          [filename, digest],
        );
        applied.push(filename);
      }

      await this.#mirrorProductLedger(admin);
    } finally {
      await admin.end();
    }
    return { applied, skipped };
  }

  // Two ledgers exist on purpose, and the reason is worth stating because duplication
  // normally is a defect:
  //
  //   noesar_migration.applied      is the supervisor's own bookkeeping. It is created
  //                                 before migration 0001 runs, so it can record the
  //                                 first migration too. That matters because 0007
  //                                 issues CREATE POLICY, which has no IF NOT EXISTS
  //                                 form: a crash mid-run followed by a blind re-apply
  //                                 would fail, so idempotency needs a ledger that
  //                                 predates the schema.
  //
  //   noesar_runtime.schema_migrations is the product's own contract, created by
  //                                 migration 0008 and made immutable by a trigger. The
  //                                 security_acceptance view counts its rows, so leaving
  //                                 it empty would report migration_count_verified=false
  //                                 on a fully migrated database.
  //
  // The first is the operational truth; the second is mirrored from it once it exists.
  async #mirrorProductLedger(admin) {
    const present = await admin.query(`
      SELECT 1 AS present FROM information_schema.tables
      WHERE table_schema = 'noesar_runtime' AND table_name = 'schema_migrations'
    `);
    if (present.rows.length === 0) return;
    const ours = await admin.query(
      'SELECT filename, sha256 FROM noesar_migration.applied ORDER BY filename',
    );
    for (const row of ours.rows) {
      const version = row.filename.slice(0, 4);
      // The immutability trigger fires on UPDATE and DELETE only, so an insert that
      // collides is skipped rather than upserted: rewriting a recorded migration is
      // exactly what the trigger exists to prevent.
      await admin.query(
        `INSERT INTO noesar_runtime.schema_migrations (version, filename, sha256, applied_by)
         VALUES ($1, $2, $3, 'noesar-postgres-supervisor')
         ON CONFLICT (version) DO NOTHING`,
        [version, row.filename, row.sha256],
      );
    }
  }

  /**
   * Run an operation on an administrative connection.
   *
   * Reserved for work that is administrative by nature — projecting the identity list,
   * applying migrations — and deliberately not exposed to request handling. The
   * application role is the one Row Level Security constrains; anything that routinely
   * used this instead would be a request path with RLS switched off.
   */
  async withAdmin(operation) {
    if (typeof operation !== 'function') throw new TypeError('operation must be a function');
    const password = await readSecret(this.adminSecretFile);
    const admin = new PgConnection({
      socketPath: this.socketFile,
      user: ADMIN_ROLE,
      database: DATABASE,
      password,
      applicationName: 'noesar-admin',
      statementTimeoutMs: 60000,
    });
    await admin.connect();
    try {
      return await operation(admin);
    } finally {
      await admin.end();
    }
  }

  async health() {
    if (!this.pool) {
      return {
        connected: false,
        state: this.state,
        reason: 'the pool is not open',
        serverVersion: null,
        serverVersionNumber: 0,
        pgvectorVersion: null,
        productionReady: false,
      };
    }
    const client = await this.pool.connect();
    try {
      const result = await client.query(`
        SELECT current_setting('server_version')            AS server_version,
               current_setting('server_version_num')::int   AS server_version_num,
               (SELECT extversion FROM pg_extension WHERE extname = 'vector') AS pgvector_version,
               -- The product's ledger, not noesar_migration.applied: this query runs as
               -- the application role, which has no privilege on the supervisor's own
               -- bookkeeping schema and must not be given one.
               (SELECT count(*) FROM noesar_runtime.schema_migrations)        AS migration_count,
               (SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user) AS bypass_rls,
               current_user                                 AS effective_role
      `);
      const row = result.rows[0] ?? {};
      const rls = await client.query(`
        SELECT count(*)::int AS enforced
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname LIKE 'noesar_%' AND c.relkind = 'r' AND c.relrowsecurity
      `);
      const versionNumber = Number(row.server_version_num ?? 0);
      const checks = {
        postgres18: versionNumber >= 180000,
        pgvector: Boolean(row.pgvector_version),
        migrations: Number(row.migration_count ?? 0) > 0,
        rowLevelSecurity: Number(rls.rows[0]?.enforced ?? 0) > 0,
        appRoleNoBypassRls: row.bypass_rls === false,
      };
      return {
        connected: true,
        state: this.state,
        serverVersion: row.server_version ?? null,
        serverVersionNumber: versionNumber,
        pgvectorVersion: row.pgvector_version ?? null,
        effectiveRole: row.effective_role ?? null,
        migrationCount: Number(row.migration_count ?? 0),
        rlsTables: Number(rls.rows[0]?.enforced ?? 0),
        checks,
        productionReady: Object.values(checks).every(Boolean),
      };
    } finally {
      client.release();
    }
  }

  status() {
    return {
      state: this.state,
      initialised: this.isInitialised(),
      dataDir: this.dataDir,
      socketPath: this.socketFile,
      port: this.port,
      pid: this.process?.pid ?? null,
      restarts: this.restarts,
      startedAtUtc: this.startedAtUtc,
      serverVersionNumber: this.serverVersionNum,
      pgvectorVersion: this.pgvectorVersion,
      appliedMigrations: this.appliedMigrations.length,
      lastError: this.lastError ? this.lastError.message : null,
      listensOnTcp: false,
    };
  }

  async backup({ label = null } = {}) {
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
    const name = `noesar-${label ? `${label}-` : ''}${stamp}.dump`;
    const target = path.join(this.backupDir, name);
    await fsp.mkdir(this.backupDir, { recursive: true, mode: 0o700 });
    const password = await readSecret(this.adminSecretFile);
    await this.#run(this.bin('pg_dump'), [
      '--format=custom', '--no-owner', '--no-privileges',
      '--file', target,
      '--dbname', DATABASE,
      '--username', ADMIN_ROLE,
      '--host', this.socketDir,
      '--port', String(this.port),
    ], { env: { PGPASSWORD: password } });
    await fsp.chmod(target, 0o600);
    const bytes = await fsp.readFile(target);
    const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
    await fsp.writeFile(`${target}.sha256`, `${sha256}  ${name}\n`, { mode: 0o600 });
    this.#log('info', 'postgres.backup.created', { file: name, bytes: bytes.length, sha256 });
    return { file: target, name, bytes: bytes.length, sha256 };
  }

  async restore({ file, targetDatabase = null } = {}) {
    if (!file) throw new Error('a backup file is required');
    const checksumFile = `${file}.sha256`;
    if (fs.existsSync(checksumFile)) {
      const expected = (await fsp.readFile(checksumFile, 'utf8')).trim().split(/\s+/)[0];
      const actual = crypto.createHash('sha256').update(await fsp.readFile(file)).digest('hex');
      if (expected !== actual) {
        throw new Error(`backup checksum mismatch: expected ${expected}, got ${actual}`);
      }
    }
    const database = targetDatabase ?? DATABASE;
    const password = await readSecret(this.adminSecretFile);
    const admin = new PgConnection({
      socketPath: this.socketFile, user: ADMIN_ROLE, database: 'postgres',
      password, applicationName: 'noesar-restore', statementTimeoutMs: 300000,
    });
    await admin.connect();
    try {
      if (targetDatabase) {
        await admin.query(`DROP DATABASE IF EXISTS ${quoteIdentifier(targetDatabase)}`);
        await admin.query(`CREATE DATABASE ${quoteIdentifier(targetDatabase)} OWNER ${quoteIdentifier(ADMIN_ROLE)}`);
      }
    } finally {
      await admin.end();
    }
    await this.#run(this.bin('pg_restore'), [
      '--clean', '--if-exists', '--no-owner', '--no-privileges',
      '--dbname', database,
      '--username', ADMIN_ROLE,
      '--host', this.socketDir,
      '--port', String(this.port),
      file,
    ], { env: { PGPASSWORD: password } });
    this.#log('info', 'postgres.restore.complete', { file: path.basename(file), database });
    return { file, database };
  }

  async stop() {
    if (!this.process) {
      this.state = SupervisorState.STOPPED;
      if (this.pool) { await this.pool.end().catch(() => {}); this.pool = null; }
      return { stopped: true, alreadyStopped: true };
    }
    this.intentionalStop = true;
    this.state = SupervisorState.STOPPING;
    if (this.pool) { await this.pool.end().catch(() => {}); this.pool = null; }

    const child = this.process;
    // SIGINT is PostgreSQL's *fast* shutdown: roll back open transactions, checkpoint,
    // exit. SIGTERM is *smart* shutdown, which waits for clients to disconnect and can
    // therefore outlive the container's stop timeout and be SIGKILLed mid-checkpoint.
    child.kill('SIGINT');
    const exited = await new Promise((resolve) => {
      const timer = setTimeout(() => resolve(false), this.stopTimeoutMs);
      child.once('exit', () => { clearTimeout(timer); resolve(true); });
    });
    if (!exited) {
      this.#log('warn', 'postgres.stop.escalating', { timeoutMs: this.stopTimeoutMs });
      child.kill('SIGQUIT');
      await new Promise((resolve) => {
        const timer = setTimeout(resolve, 5000);
        child.once('exit', () => { clearTimeout(timer); resolve(); });
      });
    }
    this.process = null;
    this.state = SupervisorState.STOPPED;
    this.#log('info', 'postgres.stopped', { clean: exited });
    return { stopped: true, clean: exited };
  }
}

export const PostgresSupervisorInternals = Object.freeze({
  generatePassword,
  quoteIdentifier,
  quoteLiteral,
  writeSecret,
  readSecret,
  ADMIN_ROLE,
  APP_ROLE,
  DATABASE,
});
