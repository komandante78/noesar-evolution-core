// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The voice chain, driven end to end.
//
//   node tools/acceptance/voice-chain.mjs [port]
//
// Owner, s336: «voglio voce reale non robotica quindi fai un motore reale interno con voce
// naturale». Stage 4 of that requirement is choosing and installing the two models, which is
// the Owner's decision and touches the runtime. This probe is what makes that decision cheap:
// it proves the whole chain works BEFORE any model is downloaded, so what remains is
// configuration rather than construction — and the difference between those two is the
// difference between an afternoon and a session.
//
// What is real here, and why each piece had to be:
//
//   - The model server is a real HTTP listener on a real port speaking the OpenAI audio shape.
//     Not a stubbed `fetch`: the parts that break on this path are wire parts — multipart
//     assembly, a body that is bytes and not JSON, a response that is audio and not a document.
//     A stub agrees with whatever the caller believes it is sending.
//   - The product is the real `server.mjs`, bootstrapped through the real Owner flow, driven
//     over HTTP with real cookies and a real CSRF token. The routes are permissioned, and a
//     probe that skipped authentication would prove the engine works for nobody in particular.
//   - The last link is `resolveUtterance` over the product's OWN command registry, because a
//     transcript that reaches nothing is not a voice feature. Hearing is not the deliverable;
//     hearing and then DOING is.
//
// The probe also drives the two failures that matter, because a chain that only works is not
// yet trustworthy: a model server that refuses, and an installation with nothing configured.
// The second one is what every installation looks like today, and it must say so rather than
// appear broken.

import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { request } from 'node:http';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { totpCode } from '../../services/reference-control-plane/src/auth-crypto.mjs';
import { AGENT_COMMANDS, MENU_GROUPS } from '../../apps/webui-static/agent-commands.js';
import { CATALOGS } from '../../apps/webui-static/i18n-catalog.js';
import { addressEntries } from '../../apps/webui-static/coden-view-model.js';
import { buildCodenAddressBook } from '../../services/reference-control-plane/src/coden-address-book.mjs';
import { resolveUtterance } from '../../apps/webui-static/voice-intent.js';

const repoRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const port = Number(process.argv[2] ?? 8199);
const workspace = mkdtempSync(join(tmpdir(), 'voice-chain-'));
const setupTokenFile = join(workspace, 'setup.token');
const setupToken = `voice-${randomBytes(24).toString('base64url')}`;
const PASSWORD = `voice-${randomBytes(18).toString('base64url')}`;

const HEARD = 'apri la memoria';
const SPOKEN_AUDIO = Buffer.from('RIFFnatural-voice-bytesWAVE', 'utf8');

let failures = 0;
let checks = 0;
function check(ok, name, detail) {
  checks += 1;
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}\n`);
  if (!ok) failures += 1;
}

// ——— the model server: what whisper.cpp and a self-hosted synthesis server look like ———
//
// It records what it was ACTUALLY sent, so the probe can assert the product spoke the protocol
// rather than merely getting an answer back. A model server that ignored the request entirely
// would still return text, and the check would still pass — which is how a wire test becomes
// decoration.
const received = { transcriptions: null, speech: null };
let refuseNext = false;

const modelServer = createServer((req, res) => {
  const chunks = [];
  req.on('data', (chunk) => chunks.push(chunk));
  req.on('end', () => {
    const body = Buffer.concat(chunks);
    if (req.url === '/v1/models') {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ data: [{ id: 'probe-voice-model' }] }));
    }
    if (refuseNext) {
      refuseNext = false;
      res.writeHead(503, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ error: 'the model is loading' }));
    }
    if (req.url === '/v1/audio/transcriptions') {
      received.transcriptions = { contentType: String(req.headers['content-type'] ?? ''), body: body.toString('latin1') };
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ text: HEARD }));
    }
    if (req.url === '/v1/audio/speech') {
      received.speech = JSON.parse(body.toString('utf8') || '{}');
      res.writeHead(200, { 'content-type': 'audio/wav' });
      return res.end(SPOKEN_AUDIO);
    }
    res.writeHead(404).end();
  });
});

const cookies = new Map();
function http(method, path, body, extraHeaders = {}, raw = false) {
  return new Promise((resolvePromise, reject) => {
    const payload = body === undefined ? null : (Buffer.isBuffer(body) ? body : Buffer.from(JSON.stringify(body)));
    const headers = { host: `127.0.0.1:${port}`, ...extraHeaders };
    if (payload) {
      headers['content-type'] = headers['content-type'] ?? 'application/json';
      headers['content-length'] = payload.length;
    }
    if (cookies.size) headers.cookie = [...cookies].map(([name, value]) => `${name}=${value}`).join('; ');
    if (cookies.has('noesar_csrf') && method !== 'GET') headers['x-noesar-csrf'] = cookies.get('noesar_csrf');
    const req = request({ host: '127.0.0.1', port, path, method, headers }, (res) => {
      const parts = [];
      res.on('data', (chunk) => parts.push(chunk));
      res.on('end', () => {
        for (const line of res.headers['set-cookie'] ?? []) {
          const [pair] = String(line).split(';');
          const index = pair.indexOf('=');
          if (index > 0) cookies.set(pair.slice(0, index).trim(), pair.slice(index + 1).trim());
        }
        const bytes = Buffer.concat(parts);
        let json = null;
        if (!raw) { try { json = JSON.parse(bytes.toString('utf8')); } catch { /* not every response is JSON */ } }
        resolvePromise({ status: res.statusCode, json, bytes, headers: res.headers, text: raw ? '' : bytes.toString('utf8') });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

const STEP_MS = 30_000;
const usedSteps = new Set();
async function freshTotp(secret) {
  for (;;) {
    const now = Date.now();
    for (const offset of [-1, 0, 1]) {
      const step = (Math.floor(now / STEP_MS) + offset) * STEP_MS;
      if (usedSteps.has(step)) continue;
      usedSteps.add(step);
      return totpCode(secret, step);
    }
    await new Promise((r) => setTimeout(r, STEP_MS - (now % STEP_MS) + 250));
  }
}

writeFileSync(setupTokenFile, setupToken);
await new Promise((ready) => modelServer.listen(0, '127.0.0.1', ready));
const modelBase = `http://127.0.0.1:${modelServer.address().port}`;

const server = spawn('node', [join(repoRoot, 'services/reference-control-plane/src/server.mjs')], {
  env: {
    ...process.env,
    NOESAR_WORKSPACE: workspace,
    NOESAR_PORT: String(port),
    NOESAR_HOST: '127.0.0.1',
    NOESAR_SETUP_TOKEN_FILE: setupTokenFile,
    NOESAR_LOCAL_MODEL_RUNTIME: 'disabled',
    // Isolated, and not as tidiness: without it this probe binds the PRODUCTION terminal socket
    // path while it runs, and tears it down on exit. That is `D-0328` exactly — `npm test` once
    // stole the live socket the same way. The guard in `production-readiness.test.mjs` caught
    // the omission here before it could ever be run against a live machine.
    NOESAR_CODEV_PEER_SOCKET_PATH: join(workspace, 'tui.sock'),
    // THE CONFIGURATION STAGE 4 IS ABOUT. Five variables, and the two endpoints are separate
    // because hearing and speaking are ordinarily two different servers — an installation that
    // serves both from one address writes the same value twice, which is a fact about that
    // installation rather than something the product should assume.
    NOESAR_VOICE_TRANSCRIBE_ENDPOINT: modelBase,
    NOESAR_VOICE_TRANSCRIBE_MODEL: 'whisper-large-v3',
    NOESAR_VOICE_LANGUAGE: 'it',
    NOESAR_VOICE_SPEAK_ENDPOINT: modelBase,
    NOESAR_VOICE_SPEAK_MODEL: 'natural-voice',
    NOESAR_VOICE_SPEAK_VOICE: 'chiara',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverLog = '';
server.stdout.on('data', (chunk) => { serverLog += chunk; });
server.stderr.on('data', (chunk) => { serverLog += chunk; });

async function waitForServer() {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const alive = await http('GET', '/livez');
      if (alive.status === 200) return true;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
}

function stop() {
  server.kill('SIGTERM');
  modelServer.close();
  rmSync(workspace, { recursive: true, force: true });
}

try {
  if (!await waitForServer()) {
    process.stdout.write(`the product did not come up:\n${serverLog}\n`);
    stop();
    process.exit(2);
  }

  // --- the routes are permissioned, and that is checked before anything else. A probe that
  // signed in first would never notice a microphone open to the internet.
  const anonymous = await http('GET', '/api/v1/voice/state');
  check(anonymous.status === 401, 'an unauthenticated caller cannot even ask what voice can do',
    `status ${anonymous.status}`);

  const begun = await http('POST', '/api/v1/auth/setup',
    { username: 'owner', displayName: 'Owner', password: PASSWORD },
    { 'x-noesar-setup-token': setupToken });
  const confirmed = await http('POST', '/api/v1/auth/setup/confirm',
    { challenge: begun.json?.challenge, totpCode: await freshTotp(begun.json?.totpSecret) });
  if (confirmed.status !== 201) {
    process.stdout.write(`owner bootstrap failed: ${begun.status}/${confirmed.status}\n${serverLog}\n`);
    stop();
    process.exit(2);
  }

  // --- 1. the installation reports what it can do, having ASKED the model server ------------
  const state = await http('GET', '/api/v1/voice/state');
  check(state.status === 200 && state.json?.canHear === true && state.json?.canSpeak === true,
    'with both endpoints configured, the installation reports it can hear and speak',
    JSON.stringify(state.json));
  check(state.json?.transcribe?.model === 'whisper-large-v3',
    'the configured model name wins over whatever the server calls itself',
    JSON.stringify(state.json?.transcribe));

  // --- 2. audio in, text out ----------------------------------------------------------------
  const audio = Buffer.from('probe-webm-bytes-not-real-audio', 'utf8');
  const heard = await http('POST', '/api/v1/voice/transcribe', audio, { 'content-type': 'audio/webm' });
  check(heard.status === 200 && heard.json?.text === HEARD && heard.json?.heardSomething === true,
    'the product hears: raw audio in, text out', JSON.stringify(heard.json));
  check(/^multipart\/form-data;\s*boundary=/.test(received.transcriptions?.contentType ?? ''),
    'and it spoke the protocol — a real multipart body, assembled once, server-side',
    received.transcriptions?.contentType ?? 'nothing arrived');
  const sent = received.transcriptions?.body ?? '';
  check(sent.includes('whisper-large-v3') && sent.includes('name="file"') && sent.includes(audio.toString('latin1')),
    'the model, the file part and the actual bytes all arrived',
    JSON.stringify({ model: sent.includes('whisper-large-v3'), file: sent.includes('name="file"'), bytes: sent.includes(audio.toString('latin1')) }));
  check(sent.includes('response_format') && sent.includes('json'),
    'the response format was asked for, not left to the server\'s default');

  // --- 3. text in, audio out ----------------------------------------------------------------
  const spoken = await http('POST', '/api/v1/voice/speak', { text: 'La memoria è aperta.' }, {}, true);
  check(spoken.status === 200 && spoken.bytes.equals(SPOKEN_AUDIO),
    'the product speaks: text in, the AUDIO BYTES out — never a URL that outlives the request',
    `status ${spoken.status}, ${spoken.bytes.length} bytes`);
  check(String(spoken.headers['content-type'] ?? '').startsWith('audio/'),
    'and it is served as audio', String(spoken.headers['content-type']));
  check(String(spoken.headers['cache-control'] ?? '').includes('no-store'),
    'a spoken answer is never cached — yesterday\'s answer read aloud in today\'s voice',
    String(spoken.headers['cache-control']));
  check(received.speech?.voice === 'chiara' && received.speech?.model === 'natural-voice',
    'the configured voice and model reached the synthesis server',
    JSON.stringify(received.speech));

  // --- 4. THE LAST LINK: what was heard has to reach something ------------------------------
  //
  // Without this the probe would prove a transcription service, not a voice feature.
  // The translator is passed because the utterance is ITALIAN, and the Italian names of the
  // product's destinations live in one place: the catalogue the menu already paints. The first
  // version of this probe forgot it and went red on "apri la memoria" — which is the dependency
  // working exactly as designed, seen from the wrong side. Nothing about Italian is written into
  // the resolver, so a resolver with no catalogue understands no Italian.
  // BOTH halves of the list, as `codenOffered()` assembles them in the browser. The address book
  // is not optional here and the first version of this probe left it out: a command's Italian is
  // a SENTENCE describing it, while a destination's Italian is its LABEL — "Memoria" — and the
  // labels only exist in the address book. Drop it and Italian navigation stops working while
  // Italian dictation still does, which is the confusing half-failure worth pinning down.
  const entries = [...AGENT_COMMANDS, ...addressEntries(buildCodenAddressBook(join(repoRoot, 'apps/webui-static')))];
  const groupTitles = Object.fromEntries(MENU_GROUPS.map((group) => [group.id, group.title]));
  const italian = (text) => CATALOGS.it[text] ?? text;
  const intent = resolveUtterance(heard.json?.text ?? '', { entries, groupTitles, translate: italian });
  check(intent.kind === 'intent' && intent.line === '/memory' && intent.disposition === 'navigate',
    'what was heard resolves, on the product\'s own list, to a line the prompt accepts',
    JSON.stringify({ heard: heard.json?.text, line: intent.line, disposition: intent.disposition }));

  // And the negative that gives the positive its meaning: without the catalogue there is no
  // Italian, because there is no Italian in this resolver to find.
  const withoutCatalogue = resolveUtterance(heard.json?.text ?? '', { entries, groupTitles });
  check(withoutCatalogue.kind === 'nothing',
    'take the catalogue away and the Italian goes with it — it was never written into the resolver',
    JSON.stringify({ kind: withoutCatalogue.kind }));

  // --- 5. the failures that matter -----------------------------------------------------------
  refuseNext = true;
  const refused = await http('POST', '/api/v1/voice/transcribe', audio, { 'content-type': 'audio/webm' });
  check(refused.status === 502 && /answered 503/.test(refused.json?.error ?? ''),
    'a model server that refuses is reported as the upstream refusing, with its status',
    JSON.stringify(refused.json));

  const empty = await http('POST', '/api/v1/voice/speak', { text: '   ' });
  check(empty.status === 400, 'there is nothing to say is a request error, not a crash',
    JSON.stringify(empty.json));

  process.stdout.write(`\nVOICE_CHAIN_TOTAL=${checks}\nVOICE_CHAIN_FAIL=${failures}\n`);
  stop();
  process.exit(failures === 0 ? 0 : 1);
} catch (error) {
  process.stdout.write(`probe crashed: ${error.stack}\n${serverLog}\n`);
  stop();
  process.exit(2);
}
