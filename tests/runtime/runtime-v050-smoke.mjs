import { spawn } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import os from 'node:os';
import net from 'node:net';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import {
  totpCode,
} from '../../services/reference-control-plane/src/auth-crypto.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const workspace = mkdtempSync(join(os.tmpdir(), 'noesar-runtime-v050-'));

const port = await new Promise((resolvePort, reject) => {
  const server = net.createServer();
  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => {
    const address = server.address();
    server.close(() => resolvePort(address.port));
  });
});
const tokenFile = join(workspace, 'config/first-owner-setup.token');

// BLOCKED: runtime/bin/entrypoint.sh and the runtime/noesar/ payload layout were
// not carried into this consolidated PRODUCT tree. This smoke test cannot execute
// until an equivalent launcher is provided. See REPORTS/CODE_CONSOLIDATION_V1/11_OPEN_BLOCKERS.txt.
const child = spawn(join(root, 'runtime/bin/entrypoint.sh'), [], {
  cwd:root,
  env:{
    ...process.env,
    NOESAR_RUNTIME_ROOT:join(root, 'runtime/noesar'),
    NOESAR_WORKSPACE:workspace,
    NOESAR_HOST:'127.0.0.1',
    NOESAR_PORT:String(port),
    NOESAR_RELEASE_CHANNEL:'development',
    NOESAR_AUTHORITY_MODE:'reference-node',
    NOESAR_DATA_PLANE:'reference-json',
    NOESAR_ALLOWED_HOSTS:'localhost,127.0.0.1,::1',
    NOESAR_SETUP_TOKEN_FILE:tokenFile,
  },
  stdio:['ignore','pipe','pipe'],
});

let cookie = '';
let csrf = '';
function captureCookies(response) {
  const values = response.headers.getSetCookie?.() ?? [];
  const pairs = values.map((value) => value.split(';')[0]);
  if (pairs.length) cookie = pairs.join('; ');
}
async function request(path, { method='GET', value, headers={} }={}) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    method,
    headers:{
      ...(value ? {'content-type':'application/json'} : {}),
      ...(cookie ? {cookie} : {}),
      ...(csrf ? {'x-noesar-csrf':csrf} : {}),
      ...headers,
    },
    body:value ? JSON.stringify(value) : undefined,
  });
  captureCookies(response);
  return { status:response.status, data:await response.json() };
}

try {
  let started = false;
  for (let attempt=0; attempt<100; attempt+=1) {
    try {
      if ((await request('/healthz')).status === 200) {
        started = true;
        break;
      }
    } catch {}
    await sleep(100);
  }
  if (!started) throw new Error('runtime did not start');

  const preflight = JSON.parse(
    readFileSync(join(workspace, 'state/runtime-preflight.json'), 'utf8')
  );
  if (preflight.version !== '0.5.0') throw new Error('preflight version mismatch');
  if (preflight.migrationBaseline !== '0.5.0') {
    throw new Error('migration baseline mismatch');
  }
  if (preflight.migrationCount !== 10) throw new Error('migration count mismatch');
  if (preflight.authorityProtocolVersion !== '1.1') {
    throw new Error('authority protocol mismatch');
  }
  if (preflight.authorityFrameMaxBytes !== 1048576) {
    throw new Error('authority frame maximum mismatch');
  }
  if (preflight.authenticatedPeerCredentialsActive !== false) {
    throw new Error('peer credentials falsely active');
  }
  if (preflight.productionReady !== false) {
    throw new Error('preflight falsely production-ready');
  }

  const health = await request('/healthz');
  if (health.data.version !== '0.5.0-runtime-implementation') {
    throw new Error('runtime version mismatch');
  }
  if (health.data.runtime?.migrationBaseline !== '0.5.0') {
    throw new Error('runtime migration baseline mismatch');
  }
  if (health.data.runtime?.migrationCount !== 10) {
    throw new Error('runtime migration count mismatch');
  }
  if (health.data.authority.protocolVersion !== '1.1') {
    throw new Error('authority protocol status mismatch');
  }
  if (health.data.authority.authenticatedTransportActive !== false) {
    throw new Error('authority transport falsely active');
  }
  if (health.data.dataPlane.securityAcceptanceViewImplemented !== true) {
    throw new Error('security acceptance view not reported');
  }
  if (health.data.dataPlane.repositoryAdapterActive !== false) {
    throw new Error('repository adapter falsely active');
  }

  const before = await request('/readyz');
  if (before.status !== 503 || before.data.status !== 'setup-required') {
    throw new Error(`unexpected pre-setup readiness: ${JSON.stringify(before)}`);
  }

  if (!existsSync(tokenFile)) throw new Error('setup token missing');
  if ((statSync(tokenFile).mode & 0o077) !== 0) {
    throw new Error('setup token is not private');
  }
  const setupToken = readFileSync(tokenFile, 'utf8').trim();

  const begin = await request('/api/v1/auth/setup', {
    method:'POST',
    headers:{'x-noesar-setup-token':setupToken},
    value:{
      username:'owner',
      displayName:'Owner',
      password:'correct horse battery staple',
    },
  });
  if (begin.status !== 201) {
    throw new Error(`setup begin failed: ${JSON.stringify(begin)}`);
  }

  const confirm = await request('/api/v1/auth/setup/confirm', {
    method:'POST',
    value:{
      challenge:begin.data.challenge,
      totpCode:totpCode(begin.data.totpSecret),
    },
  });
  if (confirm.status !== 201) {
    throw new Error(`setup confirm failed: ${JSON.stringify(confirm)}`);
  }
  csrf = confirm.data.csrfToken;

  if (existsSync(tokenFile)) throw new Error('setup token was not destroyed');

  const after = await request('/readyz');
  if (after.status !== 200 || after.data.status !== 'development-ready') {
    throw new Error(`unexpected post-setup readiness: ${JSON.stringify(after)}`);
  }
  if (after.data.productionReady !== false) {
    throw new Error('readiness falsely production-ready');
  }

  const bootstrap = await request('/api/v1/bootstrap');
  if (bootstrap.status !== 200) throw new Error('bootstrap failed');
  if (bootstrap.data.product.version !== '0.5.0') {
    throw new Error('bootstrap version mismatch');
  }
  if (bootstrap.data.authority.mode !== 'reference-node') {
    throw new Error('bootstrap authority mismatch');
  }
  if (bootstrap.data.dataPlane.mode !== 'reference-json') {
    throw new Error('bootstrap data plane mismatch');
  }

  console.log('RUNTIME_V050_SMOKE=PASS');
} finally {
  if (child.exitCode === null && child.signalCode === null) {
    child.kill('SIGTERM');
    await Promise.race([
      new Promise((resolveExit) => child.once('exit', resolveExit)),
      sleep(3000),
    ]);
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL');
    }
  }
  rmSync(workspace, { recursive:true, force:true });
}
