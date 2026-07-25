// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Post-installation verification, run INSIDE the installed container.
//
// Deliberately read-only with respect to product data. The installation has no Owner
// account by design, and creating one — or seeding rows to prove a query works — would
// make an installation that is meant to be handed over untouched. Vector operations are
// therefore proved with expression-only queries that create no table and store no row.
//
//   docker exec noesar-evolution node tools/acceptance/post-install-checks.mjs

import fs from 'node:fs';
import { PostgresSupervisor, PostgresSupervisorInternals } from '../../services/reference-control-plane/src/postgres-supervisor.mjs';
import { PgConnection } from '../../services/reference-control-plane/src/pg-client.mjs';

const results = [];
let failures = 0;

function check(id, description, condition, evidence = '') {
  const ok = Boolean(condition);
  if (!ok) failures += 1;
  results.push({ id, description, status: ok ? 'PASS' : 'FAIL', evidence: String(evidence).slice(0, 300) });
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'} ${id} ${description}${evidence ? ` :: ${String(evidence).slice(0, 200)}` : ''}\n`);
}

const supervisor = new PostgresSupervisor({
  root: process.env.NOESAR_POSTGRES_ROOT ?? '/workspace/postgresql',
  secretsDir: '/workspace/config/postgres',
});

async function main() {
  const password = fs.readFileSync(supervisor.adminSecretFile, 'utf8').trim();
  const client = new PgConnection({
    socketPath: supervisor.socketFile,
    user: PostgresSupervisorInternals.APP_ROLE,
    database: PostgresSupervisorInternals.DATABASE,
    password: fs.readFileSync(supervisor.appSecretFile, 'utf8').trim(),
    applicationName: 'noesar-post-install',
  });
  await client.connect();

  const version = await client.query('SELECT current_setting($1)::int AS n', ['server_version_num']);
  check('PI-01', 'the installed data plane is PostgreSQL 18 or newer',
    version.rows[0].n >= 180000, `server_version_num=${version.rows[0].n}`);

  const vector = await client.query("SELECT extversion FROM pg_extension WHERE extname = 'vector'");
  check('PI-02', 'pgvector is installed in the live database',
    Boolean(vector.rows[0]?.extversion), `pgvector ${vector.rows[0]?.extversion}`);

  // Expression-only: proves the operators work without creating a table or storing a row.
  const distance = await client.query(
    `SELECT ('[1,2,3]'::vector <-> '[1,2,3]'::vector) AS l2,
            ('[1,0,0]'::vector <=> '[0,1,0]'::vector) AS cosine,
            ('[1,2,3]'::vector <#> '[1,2,3]'::vector) AS inner_product`,
  );
  const row = distance.rows[0];
  check('PI-03', 'vector distance operators evaluate correctly on the live database',
    Number(row.l2) === 0 && Number(row.cosine) === 1 && Number(row.inner_product) === -14,
    `l2=${row.l2} cosine=${row.cosine} inner=${row.inner_product}`);

  const rls = await client.query(`
    SELECT count(*)::int AS enforced
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname LIKE 'noesar_%' AND c.relkind = 'r'
      AND c.relrowsecurity AND c.relforcerowsecurity`);
  check('PI-04', 'row level security is enabled and forced on the live tables',
    rls.rows[0].enforced >= 15, `${rls.rows[0].enforced} tables`);

  const bypass = await client.query('SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user');
  check('PI-05', 'the live application role cannot bypass row level security',
    bypass.rows[0].rolbypassrls === false, `rolbypassrls=${bypass.rows[0].rolbypassrls}`);

  const acceptance = await client.query('SELECT * FROM noesar_runtime.security_acceptance');
  const a = acceptance.rows[0] ?? {};
  check('PI-06', 'the security acceptance view reports every check satisfied',
    Object.values(a).every((value) => value === true), JSON.stringify(a));

  const ledger = await client.query('SELECT count(*)::int AS n FROM noesar_runtime.schema_migrations');
  check('PI-07', 'every migration is recorded in the immutable ledger',
    ledger.rows[0].n === 16, `${ledger.rows[0].n} migrations`);

  // With no session context set, RLS must reveal nothing at all.
  const leak = await client.query('SELECT count(*)::int AS n FROM noesar_core.workspaces');
  check('PI-08', 'a context-free read reveals nothing', leak.rows[0].n === 0,
    `${leak.rows[0].n} rows visible`);

  const listening = await client.query(
    "SELECT current_setting('listen_addresses') AS listen, current_setting('port') AS port");
  check('PI-09', 'the database opens no TCP listener',
    (listening.rows[0].listen ?? '') === '', `listen_addresses='${listening.rows[0].listen}'`);

  const hba = fs.readFileSync(`${supervisor.dataDir}/pg_hba.conf`, 'utf8');
  check('PI-10', 'pg_hba.conf permits local scram-sha-256 only',
    !/^\s*host/m.test(hba) && /scram-sha-256/.test(hba),
    hba.split('\n').filter((l) => l && !l.startsWith('#')).join(' / '));

  await client.end();

  // Backup against the real data plane. Restore is exercised end to end by
  // tools/acceptance/postgres-integration.mjs; here the point is that pg_dump works
  // against the installed cluster and produces a checksummed archive.
  const backup = await supervisor.backup({ label: 'post-install' });
  check('PI-11', 'a checksummed backup can be taken from the installed database',
    backup.bytes > 0 && /^[0-9a-f]{64}$/.test(backup.sha256),
    `${backup.bytes} bytes sha256=${backup.sha256.slice(0, 16)}…`);

  const restored = await supervisor.restore({
    file: backup.file, targetDatabase: 'noesar_restore_check',
  });
  const verify = new PgConnection({
    socketPath: supervisor.socketFile,
    user: PostgresSupervisorInternals.ADMIN_ROLE,
    database: 'noesar_restore_check', password,
    applicationName: 'noesar-restore-check',
  });
  await verify.connect();
  const restoredLedger = await verify.query(
    'SELECT count(*)::int AS n FROM noesar_runtime.schema_migrations');
  const restoredVector = await verify.query(
    "SELECT extversion FROM pg_extension WHERE extname = 'vector'");
  await verify.end();
  check('PI-12', 'the backup restores into a working database with schema and pgvector',
    restoredLedger.rows[0].n === 16 && Boolean(restoredVector.rows[0]?.extversion),
    `${restoredLedger.rows[0].n} migrations, pgvector ${restoredVector.rows[0]?.extversion} in ${restored.database}`);

  const secretModes = ['admin.secret', 'app.secret'].map((name) => {
    const mode = fs.statSync(`/workspace/config/postgres/${name}`).mode & 0o777;
    return `${name}=0${mode.toString(8)}`;
  });
  check('PI-13', 'the generated database credentials are stored 0600',
    secretModes.every((entry) => entry.endsWith('=0600')), secretModes.join(' '));

  const envLeak = Object.entries(process.env).filter(([, value]) => typeof value === 'string'
    && value.length > 20
    && (value === fs.readFileSync(supervisor.adminSecretFile, 'utf8').trim()
      || value === fs.readFileSync(supervisor.appSecretFile, 'utf8').trim()));
  check('PI-14', 'no database password is present in the container environment',
    envLeak.length === 0, `${envLeak.length} matches`);

  // The auth store writes its file only once it holds something, so an absent file is the
  // strongest form of "no Owner exists" — not an error.
  const authPath = '/workspace/state/auth.json';
  const initialized = fs.existsSync(authPath)
    && JSON.parse(fs.readFileSync(authPath, 'utf8')).initialized === true;
  check('PI-15', 'the installation still has no Owner account', !initialized,
    fs.existsSync(authPath) ? 'auth.json present, initialized=false' : 'no auth store written yet');
}

main()
  .then(() => {
    const passed = results.filter((r) => r.status === 'PASS').length;
    process.stdout.write(`\nPOST_INSTALL ${passed}/${results.length} PASS, ${failures} FAIL\n`);
    process.exit(failures === 0 ? 0 : 1);
  })
  .catch((error) => {
    process.stdout.write(`\nFATAL ${error?.stack ?? error}\n`);
    process.exit(2);
  });
