// SPDX-License-Identifier: AGPL-3.0-or-later
//
// `D-0520` — the acquisition path, end to end, against the REAL control plane.
//
// The unit suites prove the transport and the job manager in isolation. This proves the thing
// neither of them can: that a person pressing Acquire in a browser reaches a verified artefact
// on disk, through the actual routes, the actual session, the actual CSRF gate, the actual
// publisher registry and the actual catalogue lanes.
//
// **Nothing here reaches the network and nothing here touches the installation.** The publisher
// is served by a throwaway HTTP server on 127.0.0.1, which is exactly the loopback case the
// transport's origin policy allows on purpose — an air-gapped mirror is the deployment this
// product is built for. The workspace is a temp directory, removed at the end.
//
// It asserts the refusals as hard as the success. A transport whose consent gate can never open
// (which is what this project had until `D-0520`: `privacy.state === 'external'`, compared
// against a value that is not one of the seven `PrivacyState`s) passes every "it downloads"
// test there is, because such a test never asks whether the gate was ever shut.

import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { createHash, generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import os from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { PublisherRegistry } from '../services/reference-control-plane/src/publisher-registry.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const workspace = mkdtempSync(join(os.tmpdir(), 'noesar-acquire-e2e-'));
const port = Number(process.env.NOESAR_ACQUIRE_E2E_PORT ?? 18991);
const artefactPort = port + 1;
const setupToken = 'acquisition-e2e-setup-token';

const GOOD = 'the weights of a very small model\n';
const GOOD_SHA = createHash('sha256').update(GOOD).digest('hex');
const TAMPERED_SHA = createHash('sha256').update('what the publisher promised\n').digest('hex');

const failures = [];
const check = (label, condition, detail = '') => {
  if (condition) { console.log(`  ok   ${label}`); return true; }
  failures.push(`${label}${detail ? ` — ${detail}` : ''}`);
  console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`);
  return false;
};

// ── the publisher, registered through the real registry, before the server starts ──────────
const registry = new PublisherRegistry({ root: join(workspace, 'publishers') });
const { publicKey } = generateKeyPairSync('ed25519');
registry.registerKey({
  publisherId: 'e2e-publisher',
  trustLevel: 'community',
  publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
  actorId: 'e2e',
  nowUnix: Math.floor(Date.now() / 1000),
});

// ── two descriptors: one honest, one whose declared digest will not match what is served ───
const catalogDir = join(workspace, 'models', 'catalog');
mkdirSync(catalogDir, { recursive: true });
const descriptor = (id, sha, file) => ({
  id, version: '1', publisher: 'e2e-publisher', license: 'apache-2.0',
  source: `http://127.0.0.1:${artefactPort}/${file}`,
  hashes: { sha256: sha }, formats: ['gguf'], workloads: ['text', 'code'], resource_profiles: [],
});
writeFileSync(join(catalogDir, 'honest.json'), JSON.stringify(descriptor('e2e/honest-1b', GOOD_SHA, 'honest.bin')));
writeFileSync(join(catalogDir, 'tampered.json'), JSON.stringify(descriptor('e2e/tampered-1b', TAMPERED_SHA, 'tampered.bin')));

// The runtime must not be `disabled`, or `planAcquisition` refuses before egress is even asked.
mkdirSync(join(workspace, 'config'), { recursive: true });
writeFileSync(join(workspace, 'config', 'local-model.json'), JSON.stringify({ mode: 'auto' }));

// ── the publisher's own HTTP server, on loopback, serving bytes and nothing else ───────────
const artefacts = createServer((req, res) => {
  const body = req.url === '/tampered.bin' ? 'these are not the bytes that were declared\n' : GOOD;
  res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': Buffer.byteLength(body) });
  res.end(body);
});

const child = spawn(process.execPath, ['services/reference-control-plane/src/server.mjs'], {
  cwd: root,
  env: {
    ...process.env,
    NOESAR_WORKSPACE: workspace, NOESAR_HOST: '127.0.0.1', NOESAR_PORT: String(port),
    NOESAR_SETUP_TOKEN: setupToken, NOESAR_ALLOWED_HOSTS: '127.0.0.1,localhost',
    NOESAR_CODEV_PEER_SOCKET_PATH: join(workspace, 'codev-peer.sock'),
    // Named explicitly rather than left to the ambient environment: this suite must not silently
    // become a no-op on a host where the runtime happens to be switched off.
    NOESAR_LOCAL_MODEL_RUNTIME: 'auto',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverLog = '';
child.stdout.on('data', (chunk) => { serverLog += chunk.toString('utf8'); });
child.stderr.on('data', (chunk) => { serverLog += chunk.toString('utf8'); });

let cookie = '';
let csrf = '';
async function request(path, { method = 'GET', value, headers = {} } = {}) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    method,
    headers: {
      ...(value ? { 'content-type': 'application/json' } : {}),
      ...(cookie ? { cookie } : {}), ...(csrf ? { 'x-noesar-csrf': csrf } : {}), ...headers,
    },
    body: value ? JSON.stringify(value) : undefined,
  });
  for (const pair of (response.headers.getSetCookie?.() ?? []).map((entry) => entry.split(';')[0])) {
    cookie = cookie ? `${cookie}; ${pair}` : pair;
    if (pair.startsWith('noesar_csrf=')) csrf = pair.slice('noesar_csrf='.length);
  }
  const text = await response.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  return { status: response.status, data };
}

/** Poll a job until it stops moving. A bound, so a hang fails loudly instead of hanging. */
async function settle(jobId, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const { data } = await request(`/api/v1/models/acquisitions/${encodeURIComponent(jobId)}`);
    if (['completed', 'failed', 'cancelled'].includes(data.job?.state)) return data.job;
    if (Date.now() > deadline) throw new Error(`job ${jobId} never settled (state: ${data.job?.state})`);
    await sleep(120);
  }
}

try {
  await new Promise((done) => artefacts.listen(artefactPort, '127.0.0.1', done));
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try { const probe = await fetch(`http://127.0.0.1:${port}/livez`); if (probe.ok) break; } catch { /* not up yet */ }
    await sleep(120);
  }

  const begin = await request('/api/v1/auth/setup', {
    method: 'POST',
    headers: { 'x-noesar-setup-token': setupToken },
    value: { username: 'owner', displayName: 'Owner', password: 'correct horse battery staple' },
  });
  if (begin.status !== 201) throw new Error(`owner setup failed: ${begin.status} ${JSON.stringify(begin.data)}`);
  const { totpCode } = await import('../services/reference-control-plane/src/auth-crypto.mjs');
  const confirm = await request('/api/v1/auth/setup/confirm', {
    method: 'POST',
    value: { challenge: begin.data.challenge, totpCode: totpCode(begin.data.totpSecret) },
  });
  if (confirm.status !== 201) throw new Error(`owner bootstrap failed: ${confirm.status} ${JSON.stringify(confirm.data)}`);
  csrf = confirm.data.csrfToken;

  console.log('\nthe consent gate — it must be SHUT before it can mean anything');
  const shut = await request('/api/v1/settings/model-egress');
  check('model egress ships off', shut.data.consented === false, JSON.stringify(shut.data));
  const refusedWhileShut = await request('/api/v1/models/acquire', { method: 'POST', value: { id: 'e2e/honest-1b' } });
  check('acquiring without consent is refused as EGRESS_NOT_CONSENTED',
    refusedWhileShut.status === 403 && refusedWhileShut.data.kind === 'EGRESS_NOT_CONSENTED',
    `${refusedWhileShut.status} ${JSON.stringify(refusedWhileShut.data)}`);
  check('nothing was written while consent was off',
    !existsSync(join(workspace, 'models', 'artefacts')) || readdirSync(join(workspace, 'models', 'artefacts')).length === 0);

  console.log('\nthe consent gate — and it must be able to OPEN');
  const granted = await request('/api/v1/settings/model-egress', { method: 'PUT', value: { consented: true } });
  check('consent can be granted', granted.status === 200 && granted.data.consented === true, JSON.stringify(granted.data));
  check('the privacy indicator reports the egress rather than hiding it',
    granted.data.privacyState === 'EXTERNAL_METADATA_ONLY', String(granted.data.privacyState));

  console.log('\nan artefact that is what the publisher declared');
  const accepted = await request('/api/v1/models/acquire', { method: 'POST', value: { id: 'e2e/honest-1b' } });
  check('acquire answers 202 with a job', accepted.status === 202 && Boolean(accepted.data.job?.id),
    `${accepted.status} ${JSON.stringify(accepted.data)}`);
  const honest = await settle(accepted.data.job.id);
  check('the job completes', honest.state === 'completed', JSON.stringify(honest));
  check('the digest computed is the digest declared', honest.digest === GOOD_SHA, String(honest.digest));
  const landed = join(workspace, 'models', 'artefacts', 'e2e~2fhonest-1b.bin');
  check('the artefact is on disk under an escaped name, not in a directory named after the id', existsSync(landed));
  check('the bytes on disk are the bytes served', existsSync(landed) && readFileSync(landed, 'utf8') === GOOD);
  const catalog = await request('/api/v1/models/catalog');
  const lanes = Object.fromEntries((catalog.data.foreground ?? []).map((lane) => [lane.lane, lane.items.map((item) => item.id)]));
  check('the catalogue now shows it in the downloaded lane', (lanes.downloaded ?? []).includes('e2e/honest-1b'), JSON.stringify(lanes));

  console.log('\nan artefact that is NOT what the publisher declared');
  const tampered = await request('/api/v1/models/acquire', { method: 'POST', value: { id: 'e2e/tampered-1b' } });
  check('acquire starts', tampered.status === 202, `${tampered.status} ${JSON.stringify(tampered.data)}`);
  const rejected = await settle(tampered.data.job.id);
  check('the job fails on the digest', rejected.state === 'failed' && rejected.kind === 'DIGEST_MISMATCH', JSON.stringify(rejected));
  check('nothing startable was produced',
    !existsSync(join(workspace, 'models', 'artefacts', 'e2e~2ftampered-1b.bin')));
  const quarantine = existsSync(join(workspace, 'models', 'quarantine')) ? readdirSync(join(workspace, 'models', 'quarantine')) : [];
  check('what arrived was kept aside rather than deleted', quarantine.length === 1, JSON.stringify(quarantine));
  const afterMismatch = await request('/api/v1/models/catalog');
  const mismatchLanes = Object.fromEntries((afterMismatch.data.foreground ?? []).map((lane) => [lane.lane, lane.items.map((item) => item.id)]));
  check('the failed model is in no foreground lane at all',
    !Object.values(mismatchLanes).flat().includes('e2e/tampered-1b'), JSON.stringify(mismatchLanes));

  console.log('\nthe gate closes again, and acquiring stops');
  const withdrawn = await request('/api/v1/settings/model-egress', { method: 'PUT', value: { consented: false } });
  check('consent can be withdrawn', withdrawn.status === 200 && withdrawn.data.consented === false);
  const refusedAgain = await request('/api/v1/models/acquire', { method: 'POST', value: { id: 'e2e/tampered-1b' } });
  check('and acquiring is refused again', refusedAgain.status === 403 && refusedAgain.data.kind === 'EGRESS_NOT_CONSENTED',
    `${refusedAgain.status} ${JSON.stringify(refusedAgain.data)}`);

  console.log('\nwriting is guarded like every other write on this surface');
  const keep = csrf; csrf = '';
  const noCsrf = await request('/api/v1/models/acquire', { method: 'POST', value: { id: 'e2e/honest-1b' } });
  check('acquire without CSRF is refused', noCsrf.status === 403, String(noCsrf.status));
  const noCsrfSetting = await request('/api/v1/settings/model-egress', { method: 'PUT', value: { consented: true } });
  check('the consent setting without CSRF is refused', noCsrfSetting.status === 403, String(noCsrfSetting.status));
  csrf = keep;

  console.log(failures.length === 0 ? '\nMODEL_ACQUISITION_E2E=PASS' : `\nMODEL_ACQUISITION_E2E=FAIL (${failures.length})`);
  if (failures.length > 0) {
    for (const failure of failures) console.log(`  - ${failure}`);
    console.log(serverLog.split('\n').filter((line) => /error|refus/i.test(line)).slice(-8).join('\n'));
    process.exitCode = 1;
  }
} finally {
  child.kill('SIGTERM');
  await new Promise((done) => child.once('exit', done));
  await new Promise((done) => artefacts.close(done));
  rmSync(workspace, { recursive: true, force: true });
}
