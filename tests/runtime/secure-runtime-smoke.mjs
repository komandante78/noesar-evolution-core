import { spawn } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
} from 'node:fs';
import os from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { totpCode } from '../../services/reference-control-plane/src/auth-crypto.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const workspace = mkdtempSync(join(os.tmpdir(), 'noesar-runtime-secure-'));
const port = Number(process.env.NOESAR_SMOKE_PORT ?? 18992);
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
  for (let attempt=0; attempt<80; attempt+=1) {
    try {
      const health = await request('/healthz');
      if (health.status === 200) break;
    } catch {}
    await sleep(100);
  }

  if (!existsSync(tokenFile)) throw new Error('setup token was not generated');
  if ((statSync(tokenFile).mode & 0o077) !== 0) throw new Error('setup token permissions are unsafe');
  const setupToken = readFileSync(tokenFile, 'utf8').trim();
  if (setupToken.length < 32) throw new Error('setup token is too short');

  const notReady = await request('/readyz');
  if (notReady.status !== 503 || notReady.data.status !== 'setup-required') {
    throw new Error(`expected setup-required readiness: ${JSON.stringify(notReady)}`);
  }

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

  if (existsSync(tokenFile)) throw new Error('setup token was not deleted');

  const ready = await request('/readyz');
  if (ready.status !== 200 || ready.data.status !== 'ready') {
    throw new Error(`runtime did not become ready: ${JSON.stringify(ready)}`);
  }

  const bootstrap = await request('/api/v1/bootstrap');
  if (bootstrap.status !== 200 || bootstrap.data.user.role !== 'owner') {
    throw new Error('authenticated bootstrap failed');
  }

  const audit = await request('/api/v1/audit');
  if (audit.status !== 200 || audit.data.valid !== true) throw new Error('audit invalid');
  if (!audit.data.events.some((item) => item.action === 'auth.setup-token-destroyed')) {
    throw new Error('setup token destruction was not audited');
  }

  const authState = readFileSync(join(workspace, 'state/auth.json'), 'utf8');
  if (authState.includes(setupToken)) throw new Error('setup token leaked to auth state');

  console.log('SECURE_RUNTIME_SMOKE=PASS');
} finally {
  child.kill('SIGTERM');
  await new Promise((resolve) => child.once('exit', resolve));
  rmSync(workspace, { recursive:true, force:true });
}
