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
import { signModelDescriptor } from '../services/reference-control-plane/src/model-descriptor-authenticity.mjs';

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
const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const publisherKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
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
// D-0521: the two working descriptors are SIGNED by the publisher registered above. The third
// is deliberately left unsigned — an unsigned descriptor must be visible and unacquirable, and
// a suite that only ever feeds signed input would never notice if that stopped being true.
const signed = (d) => signModelDescriptor(d, publisherKeyPem);
writeFileSync(join(catalogDir, 'honest.json'), JSON.stringify(signed(descriptor('e2e/honest-1b', GOOD_SHA, 'honest.bin'))));
writeFileSync(join(catalogDir, 'tampered.json'), JSON.stringify(signed(descriptor('e2e/tampered-1b', TAMPERED_SHA, 'tampered.bin'))));
writeFileSync(join(catalogDir, 'unsigned.json'), JSON.stringify(descriptor('e2e/unsigned-1b', GOOD_SHA, 'honest.bin')));
// A descriptor the publisher signed and an attacker then edited — the same document with one
// field changed, which is exactly what a signature exists to catch.
const forged = { ...signed(descriptor('e2e/forged-1b', GOOD_SHA, 'honest.bin')), source: `http://127.0.0.1:${artefactPort}/tampered.bin` };
// Two more, served rather than placed: the import route's own doors.
const importable = signed(descriptor('e2e/imported-1b', GOOD_SHA, 'honest.bin'));

// The runtime must not be `disabled`, or `planAcquisition` refuses before egress is even asked.
mkdirSync(join(workspace, 'config'), { recursive: true });
writeFileSync(join(workspace, 'config', 'local-model.json'), JSON.stringify({ mode: 'auto' }));

// ── s341: a REAL OpenAI-compatible server, standing in for a local inference runtime ───────
//
// Not a mock of the product: a mock of the MODEL. This host has no inference runtime — no
// ollama, no llama-server, no vLLM, nothing on :11434 (measured) — and the repository may not
// carry a binary (rule 33). What the `/model` chain has to prove is not that a transformer
// decodes tokens; it is that the model an operator CHOSE is the one the chat surface reaches.
// So the runtime is the smallest real thing that answers the surface a real one answers on,
// and it names the model it was asked for, so the assertion cannot pass by accident.
const inference = createServer((req, res) => {
  const chunks = [];
  req.on('data', (chunk) => chunks.push(chunk));
  req.on('end', () => {
    if (req.url.endsWith('/models')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ data: [{ id: 'e2e/honest-1b' }] }));
    }
    const payload = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
    if (payload.stream) {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: `answered by ${payload.model}` } }] })}\n\n`);
      res.write('data: [DONE]\n\n');
      return res.end();
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ model: payload.model, choices: [{ message: { role: 'assistant', content: `answered by ${payload.model}` } }] }));
  });
});
const inferencePort = port + 2;

// ── the publisher's own HTTP server, on loopback, serving bytes and nothing else ───────────
const artefacts = createServer((req, res) => {
  // D-0521: the same loopback publisher also serves descriptors, so the import route's fetch
  // door is exercised over the real transport rather than described.
  if (req.url === '/served-descriptor.json' || req.url === '/served-unsigned.json') {
    const document = req.url === '/served-descriptor.json'
      ? signed(descriptor('e2e/served-1b', GOOD_SHA, 'honest.bin'))
      : descriptor('e2e/served-unsigned-1b', GOOD_SHA, 'honest.bin');
    const payload = JSON.stringify(document);
    res.writeHead(200, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) });
    return res.end(payload);
  }
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
  await new Promise((done) => inference.listen(inferencePort, '127.0.0.1', done));
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

  console.log('\nD-0521 — who says this model is this model');
  const cat = await request('/api/v1/models/catalog');
  const cards = [...(cat.data.foreground ?? []).flatMap((lane) => lane.items), ...(cat.data.available?.items ?? [])];
  const cardFor = (id) => cards.find((item) => item.id === id) ?? null;
  check('a signed descriptor is reported as signed, and names WHO',
    cardFor('e2e/honest-1b')?.authenticity?.verified === true && cardFor('e2e/honest-1b')?.authenticity?.signedBy === 'e2e-publisher',
    JSON.stringify(cardFor('e2e/honest-1b')?.authenticity));
  check('an unsigned descriptor is VISIBLE — it is not hidden, it is explained',
    Boolean(cardFor('e2e/unsigned-1b')),
    'a catalogue that hides what it will not run teaches nobody why');
  check('and it is reported as unsigned, with a reason',
    cardFor('e2e/unsigned-1b')?.authenticity?.verified === false
      && String(cardFor('e2e/unsigned-1b')?.authenticity?.reason ?? '').length > 0,
    JSON.stringify(cardFor('e2e/unsigned-1b')?.authenticity));
  const unsignedAcquire = await request('/api/v1/models/acquire', { method: 'POST', value: { id: 'e2e/unsigned-1b' } });
  check('acquiring an unsigned descriptor is refused as DESCRIPTOR_NOT_VERIFIED',
    unsignedAcquire.status === 403 && unsignedAcquire.data.kind === 'DESCRIPTOR_NOT_VERIFIED',
    `${unsignedAcquire.status} ${JSON.stringify(unsignedAcquire.data)}`);

  console.log('\nimporting a descriptor — the door that needs no network');
  const importedOk = await request('/api/v1/models/descriptors/import', { method: 'POST', value: { descriptor: importable } });
  check('a signed descriptor is accepted', importedOk.status === 201 && importedOk.data.authenticity?.verified === true,
    `${importedOk.status} ${JSON.stringify(importedOk.data)}`);
  check('it is on disk', existsSync(join(catalogDir, 'e2e~2fimported-1b.json')));
  // The round trip is the property, not the write: a stored copy that no longer verifies is a
  // copy that has to be BELIEVED, and re-serialising a document is the easy way to produce one.
  const afterImport = await request('/api/v1/models/catalog');
  const importedCard = [...(afterImport.data.foreground ?? []).flatMap((lane) => lane.items), ...(afterImport.data.available?.items ?? [])]
    .find((item) => item.id === 'e2e/imported-1b') ?? null;
  check('and it still verifies when read back from disk, not only when it arrived',
    importedCard?.authenticity?.verified === true && importedCard?.authenticity?.signedBy === 'e2e-publisher',
    JSON.stringify(importedCard?.authenticity));
  const importedAgain = await request('/api/v1/models/descriptors/import', { method: 'POST', value: { descriptor: importable } });
  check('importing the same id again is refused rather than overwriting (rule 13)',
    importedAgain.status === 409 && importedAgain.data.kind === 'ALREADY_PRESENT', String(importedAgain.status));
  const forgedImport = await request('/api/v1/models/descriptors/import', { method: 'POST', value: { descriptor: forged } });
  check('a descriptor edited after it was signed is refused as SIGNATURE_INVALID',
    forgedImport.status === 403 && forgedImport.data.kind === 'SIGNATURE_INVALID',
    `${forgedImport.status} ${JSON.stringify(forgedImport.data)}`);
  const unsignedImport = await request('/api/v1/models/descriptors/import', { method: 'POST', value: { descriptor: descriptor('e2e/never-1b', GOOD_SHA, 'honest.bin') } });
  check('an unsigned descriptor is never written to the catalogue',
    unsignedImport.status === 403 && unsignedImport.data.kind === 'NO_SIGNATURE' && !existsSync(join(catalogDir, 'e2e~2fnever-1b.json')),
    `${unsignedImport.status} ${JSON.stringify(unsignedImport.data)}`);

  console.log('\nimporting a descriptor — the door that fetches it over the same transport');
  const fetchedImport = await request('/api/v1/models/descriptors/import', { method: 'POST', value: { source: `http://127.0.0.1:${artefactPort}/served-descriptor.json` } });
  check('a signed descriptor fetched over the transport is accepted',
    fetchedImport.status === 201 && fetchedImport.data.authenticity?.signedBy === 'e2e-publisher',
    `${fetchedImport.status} ${JSON.stringify(fetchedImport.data)}`);
  const fetchedUnsigned = await request('/api/v1/models/descriptors/import', { method: 'POST', value: { source: `http://127.0.0.1:${artefactPort}/served-unsigned.json` } });
  check('an unsigned one fetched the same way is refused just the same',
    fetchedUnsigned.status === 403 && fetchedUnsigned.data.kind === 'NO_SIGNATURE', String(fetchedUnsigned.status));
  const badScheme = await request('/api/v1/models/descriptors/import', { method: 'POST', value: { source: 'http://models.example/d.json' } });
  check('and the origin policy applies to descriptors exactly as to artefacts',
    badScheme.status === 422 && badScheme.data.kind === 'SCHEME_NOT_ALLOWED', `${badScheme.status} ${JSON.stringify(badScheme.data)}`);

  console.log('\nD-0535 — the authenticity reaches the surface that STARTS a model');
  const installed = await request('/api/v1/models/installed');
  const entry = (installed.data.models ?? []).find((item) => item.id === 'e2e/honest-1b') ?? null;
  check('a downloaded, signed model is listed as startable', Boolean(entry), JSON.stringify(installed.data));
  check('and it carries WHO signed it, on the listing /model answers from',
    entry?.authenticity?.verified === true && entry?.authenticity?.signedBy === 'e2e-publisher',
    JSON.stringify(entry?.authenticity));
  const unsignedEntry = (installed.data.models ?? []).find((item) => item.id === 'e2e/unsigned-1b') ?? null;
  check('an unsigned descriptor, if it were startable, would say so rather than look identical',
    unsignedEntry === null || unsignedEntry.authenticity?.verified === false,
    JSON.stringify(unsignedEntry?.authenticity));

  console.log('\ns341 — the chain: from the model CHOSEN to the model that ANSWERS');
  const beforeWiring = await request('/api/v1/models/installed');
  check('with nothing serving, the listing says chat does NOT answer from a model, and why',
    beforeWiring.data.chat?.answers === false && String(beforeWiring.data.chat?.reason ?? '').length > 0,
    JSON.stringify(beforeWiring.data.chat));
  const providersBefore = await request('/api/v1/providers');
  check('and no derived provider is offered while nothing is serving',
    !(providersBefore.data.providers ?? []).some((item) => item.id === 'local-runtime'),
    JSON.stringify((providersBefore.data.providers ?? []).map((item) => item.id)));

  const configured = await request('/api/v1/runtime/local-model', {
    method: 'PUT',
    value: { mode: 'manual', profileId: 'cpu', endpoint: `http://127.0.0.1:${inferencePort}`, model: 'e2e/honest-1b' },
  });
  check('the runtime accepts an endpoint and a model', configured.status === 200, `${configured.status} ${JSON.stringify(configured.data)}`);
  const attached = await request('/api/v1/runtime/local-model/attach', { method: 'POST' });
  check('and attaches to the server that is really there', attached.status === 200 && attached.data.attached === true,
    `${attached.status} ${JSON.stringify(attached.data)}`);

  const afterWiring = await request('/api/v1/models/installed');
  check('now the listing /model answers from says chat WILL answer from that model',
    afterWiring.data.chat?.answers === true && afterWiring.data.chat?.model === 'e2e/honest-1b'
      && afterWiring.data.chat?.providerId === 'local-runtime',
    JSON.stringify(afterWiring.data.chat));
  const activeReport = await request('/api/v1/models/active');
  check('and the active-model report finally counts chat among the model\u2019s consumers',
    (activeReport.data.usedBy ?? []).includes('chat'), JSON.stringify(activeReport.data.usedBy));
  const providersAfter = await request('/api/v1/providers');
  check('the running model is listed FIRST among the providers, local and credential-free',
    providersAfter.data.providers?.[0]?.id === 'local-runtime'
      && providersAfter.data.providers?.[0]?.external === false
      && providersAfter.data.providers?.[0]?.credentialRequired === false,
    JSON.stringify(providersAfter.data.providers?.[0] ?? null));
  const editRefused = await request('/api/v1/providers/local-runtime', { method: 'PATCH', value: { enabled: false } });
  check('and it refuses to be edited as if it were a stored profile', editRefused.status === 409, String(editRefused.status));

  // THE claim of this phase, and the only check that can prove it: a chat message comes back
  // in the words of the server the chosen model is served by. Everything above is wiring.
  const conversation = await request('/api/v1/conversations', { method: 'POST', value: { title: 's341' } });
  const conversationId = conversation.data?.conversation?.id ?? null;
  check('a conversation can be opened', conversation.status === 201 && Boolean(conversationId),
    `${conversation.status} ${JSON.stringify(conversation.data)}`);
  const streamed = await fetch(`http://127.0.0.1:${port}/api/v1/chat/stream`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie, 'x-noesar-csrf': csrf },
    body: JSON.stringify({ conversationId, content: 'who is answering me?' }),
  });
  const transcript = await streamed.text();
  check('the chosen model is the model that ANSWERS a chat message',
    transcript.includes('answered by e2e/honest-1b'),
    transcript.slice(0, 400));
  check('and the answer is attributed to the derived provider, not to something else',
    /"providerId":"local-runtime"/.test(transcript), transcript.slice(0, 400));

  const released = await request('/api/v1/runtime/local-model', {
    method: 'PUT', value: { mode: 'disabled' },
  });
  check('switching the runtime off is enough to stop chat claiming that model',
    released.status === 200 && (await request('/api/v1/models/installed')).data.chat?.answers === false,
    String(released.status));

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
  await new Promise((done) => inference.close(done));
  rmSync(workspace, { recursive: true, force: true });
}
