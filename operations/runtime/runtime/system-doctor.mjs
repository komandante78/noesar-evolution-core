import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(new URL('../..', import.meta.url).pathname);
const workspace = resolve(
  process.argv[2] ?? process.env.NOESAR_WORKSPACE ?? '/workspace'
);
const checks = [];

function add(name, pass, evidence = '') {
  checks.push({ name, pass:Boolean(pass), evidence:String(evidence) });
}
function digest(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

add('node>=22', Number(process.versions.node.split('.')[0]) >= 22, process.versions.node);
add('workspace-exists', existsSync(workspace), workspace);

for (const rel of [
  'config/first-owner-setup.token',
  'config/auth-master.key',
  'state/auth.json',
  'state/runtime-preflight.json',
]) {
  const path = join(workspace, rel);
  if (!existsSync(path)) {
    add(`${rel}-absent-or-not-created`, true, 'absent');
    continue;
  }
  const mode = statSync(path).mode & 0o777;
  add(`${rel}-private`, (mode & 0o077) === 0, mode.toString(8));
}

const preflightPath = join(workspace, 'state/runtime-preflight.json');
if (existsSync(preflightPath)) {
  const value = JSON.parse(readFileSync(preflightPath, 'utf8'));
  add('preflight-version', value.version === '0.5.0', value.version);
  add('release-channel-development', value.releaseChannel === 'development', value.releaseChannel);
  add('authority-reference-node', value.authorityMode === 'reference-node', value.authorityMode);
  add('data-plane-reference-json', value.dataPlaneMode === 'reference-json', value.dataPlaneMode);
  add('production-ready-false', value.productionReady === false, value.productionReady);
  add('migration-baseline-v050', value.migrationBaseline === '0.5.0', value.migrationBaseline);
  add('migration-count-ten', value.migrationCount === 10, value.migrationCount);
  add('authority-protocol-v11', value.authorityProtocolVersion === '1.1', value.authorityProtocolVersion);
  add('frame-max-one-mib', value.authorityFrameMaxBytes === 1048576, value.authorityFrameMaxBytes);
  add('peer-credentials-inactive', value.authenticatedPeerCredentialsActive === false, value.authenticatedPeerCredentialsActive);
}

const files = {
  migrations:join(root, 'database/postgres/MIGRATIONS.json'),
  vectors:join(root, 'conformance/authority-vectors.json'),
  envelope:join(root, 'schemas/authority-ipc-envelope.schema.json'),
  frame:join(root, 'schemas/authority-ipc-frame.schema.json'),
  readiness:join(root, 'schemas/production-readiness.schema.json'),
  metadata:join(root, 'PACKAGE_METADATA.json'),
};
for (const [name, path] of Object.entries(files)) {
  add(name, existsSync(path), existsSync(path) ? digest(path) : 'missing');
}

const failed = checks.filter((item) => !item.pass);
console.log(JSON.stringify({
  verdict:failed.length ? 'FAIL' : 'PASS',
  version:'0.5.0',
  profile:'development-reference',
  productionReady:false,
  workspace,
  checks,
}, null, 2));
process.exit(failed.length ? 1 : 0);
