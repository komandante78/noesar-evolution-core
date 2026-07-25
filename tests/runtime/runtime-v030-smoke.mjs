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
import { totpCode } from '../../services/reference-control-plane/src/auth-crypto.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const workspace = mkdtempSync(join(os.tmpdir(), 'noesar-runtime-v030-'));

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
  for (let attempt=0; attempt<100; attempt+=1) {
    try {
      if ((await request('/healthz')).status === 200) break;
    } catch {}
    await sleep(100);
  }

  const health = await request('/healthz');
  if (health.data.authority.mode !== 'reference-node') throw new Error('authority mode mismatch');
  if (health.data.authority.productionReady !== false) throw new Error('authority falsely production ready');
  if (health.data.dataPlane.mode !== 'reference-json') throw new Error('data plane mismatch');
  if (health.data.dataPlane.productionReady !== false) throw new Error('data plane falsely production ready');

  const before = await request('/readyz');
  if (before.status !== 503 || before.data.status !== 'setup-required') {
    throw new Error(`unexpected pre-setup readiness: ${JSON.stringify(before)}`);
  }

  if (!existsSync(tokenFile)) throw new Error('setup token missing');
  if ((statSync(tokenFile).mode & 0o077) !== 0) throw new Error('setup token not private');
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
  if (begin.status !== 201) throw new Error(`setup begin failed: ${JSON.stringify(begin)}`);

  const confirm = await request('/api/v1/auth/setup/confirm', {
    method:'POST',
    value:{
      challenge:begin.data.challenge,
      totpCode:totpCode(begin.data.totpSecret),
    },
  });
  if (confirm.status !== 201) throw new Error(`setup confirm failed: ${JSON.stringify(confirm)}`);
  csrf = confirm.data.csrfToken;

  if (existsSync(tokenFile)) throw new Error('setup token not destroyed');

  const after = await request('/readyz');
  if (after.status !== 200 || after.data.status !== 'development-ready') {
    throw new Error(`unexpected post-setup readiness: ${JSON.stringify(after)}`);
  }
  if (after.data.productionReady !== false) throw new Error('readiness falsely production-ready');

  const bootstrap = await request('/api/v1/bootstrap');
  if (bootstrap.status !== 200) throw new Error('authenticated bootstrap failed');
  if (bootstrap.data.authority.mode !== 'reference-node') throw new Error('bootstrap authority mismatch');
  if (bootstrap.data.dataPlane.mode !== 'reference-json') throw new Error('bootstrap data plane mismatch');

  console.log('RUNTIME_V030_SMOKE=PASS');
} finally {
  child.kill('SIGTERM');
  await new Promise((resolveExit) => child.once('exit', resolveExit));
  rmSync(workspace, { recursive:true, force:true });
}
