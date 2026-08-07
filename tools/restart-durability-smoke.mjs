// SPDX-License-Identifier: AGPL-3.0-or-later
//
// D-0338 — prove durability the only way it can honestly be proved: KILL THE PROCESS.
//
// Every other check in this repository asks the product to describe itself. A status field
// saying `persistsAcrossRestart: true` is a claim, and a unit test that builds two
// orchestrators over one directory is a good model of a restart but still a model — it shares
// a process, a module registry and a filesystem cache with the thing it is testing.
//
// This spawns the real server, plans real work over real HTTP, sends SIGTERM, waits for the
// process to be gone, starts a NEW server over the SAME workspace, and asks it for the run.
// Nothing carries over but the disk, which is the entire proposition.
//
// Run: node tools/restart-durability-smoke.mjs

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { totpCode } from '../services/reference-control-plane/src/auth-crypto.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const workspace = mkdtempSync(join(os.tmpdir(), 'noesar-restart-'));
const shadows = mkdtempSync(join(os.tmpdir(), 'noesar-restart-shadows-'));
const port = Number(process.env.NOESAR_RESTART_SMOKE_PORT ?? 18986);
const setupToken = 'test-setup-token-value';

let cookie = '';
let csrf = '';

function start() {
  return spawn(process.execPath, ['services/reference-control-plane/src/server.mjs'], {
    cwd: root,
    env: {
      ...process.env,
      NOESAR_WORKSPACE: workspace,
      NOESAR_SHADOWS_ROOT: shadows,
      NOESAR_HOST: '127.0.0.1',
      NOESAR_PORT: String(port),
      NOESAR_SETUP_TOKEN: setupToken,
      NOESAR_ALLOWED_HOSTS: '127.0.0.1,localhost',
      // Never the production default: this test starts and stops servers, and the socket
      // path is the one thing a careless run can steal from a live installation (D-0328).
      NOESAR_CODEV_PEER_SOCKET_PATH: join(workspace, 'codev-peer.sock'),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

async function request(path, { method = 'GET', value, headers = {} } = {}) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    method,
    headers: {
      ...(value ? { 'content-type': 'application/json' } : {}),
      ...(cookie ? { cookie } : {}),
      ...(csrf ? { 'x-noesar-csrf': csrf } : {}),
      ...headers,
    },
    body: value ? JSON.stringify(value) : undefined,
  });
  const values = response.headers.getSetCookie?.() ?? [];
  if (values.length) cookie = values.map((item) => item.split(';')[0]).join('; ');
  const text = await response.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { error: text }; }
  return { status: response.status, data };
}

async function waitForReady() {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const health = await request('/healthz');
      if (health.status === 200) return;
    } catch { /* not up yet */ }
    await sleep(150);
  }
  throw new Error('the server never became healthy');
}

/** SIGTERM, then wait for the process to actually be gone — not for it to be asked to go. */
async function stop(child) {
  child.kill('SIGTERM');
  const exited = await Promise.race([
    new Promise((resolve_) => child.once('exit', () => resolve_(true))),
    sleep(15_000).then(() => false),
  ]);
  if (!exited) {
    child.kill('SIGKILL');
    throw new Error('the server did not exit on SIGTERM within 15s');
  }
  // The port must be free before the successor binds it, or the "restarted" server is
  // actually the old one still answering and this whole test proves nothing.
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      await fetch(`http://127.0.0.1:${port}/healthz`);
    } catch {
      return;
    }
    await sleep(100);
  }
  throw new Error('something is still answering on the port after the server exited');
}

let child = start();
let succeeded = false;
try {
  await waitForReady();

  // --- an owner, and a plan ------------------------------------------------
  const begin = await request('/api/v1/auth/setup', {
    method: 'POST',
    headers: { 'x-noesar-setup-token': setupToken },
    value: { username: 'owner', displayName: 'Owner', password: 'correct horse battery staple' },
  });
  if (begin.status !== 201) throw new Error(JSON.stringify(begin));
  const confirm = await request('/api/v1/auth/setup/confirm', {
    method: 'POST', value: { challenge: begin.data.challenge, totpCode: totpCode(begin.data.totpSecret) },
  });
  if (confirm.status !== 201) throw new Error(JSON.stringify(confirm));
  csrf = confirm.data.csrfToken;

  const conversation = await request('/api/v1/conversations', { method: 'POST', value: { title: 'work that must survive' } });
  if (conversation.status !== 201) throw new Error(JSON.stringify(conversation));
  const conversationId = conversation.data.conversation.id;

  const planned = await request('/api/v1/workspace-actions/plan', {
    method: 'POST',
    value: { request: 'work that must survive a restart', files: [{ path: 'survivor.txt', contents: 'after\n' }], conversationId },
  });
  if (planned.status !== 201) throw new Error(JSON.stringify(planned));
  const { runId } = planned.data;
  if (!runId) throw new Error('the plan returned no runId');

  const eventsBefore = await request('/api/v1/events');
  if (eventsBefore.status !== 200) throw new Error(JSON.stringify(eventsBefore));
  if (eventsBefore.data.persistsAcrossRestart !== true) throw new Error('the ledger does not claim durability');
  const countBefore = eventsBefore.data.events;
  if (!(countBefore > 0)) throw new Error('the plan recorded no events, so this proves nothing about the ledger');

  // --- the restart ---------------------------------------------------------
  await stop(child);
  child = start();
  await waitForReady();

  // --- what came back ------------------------------------------------------
  // The session cookie is reused deliberately: sessions live in state/auth.json, so an
  // operator who was signed in before a restart is still signed in after one. If that were
  // not true this request would 401 and say so.
  const after = await request(`/api/v1/workspace-actions/${runId}`);
  if (after.status !== 200) throw new Error(`the run did not survive the restart: ${after.status} ${JSON.stringify(after.data).slice(0, 200)}`);
  if (after.data.status !== 'PENDING_APPROVAL') throw new Error(`the reloaded run has status ${after.data.status}`);

  const listing = await request('/api/v1/workspace-actions/runs');
  if (listing.status !== 200) throw new Error(JSON.stringify(listing));
  if (listing.data.persistence?.durable !== true) throw new Error('the restarted server does not report a durable store');
  if (!listing.data.persistence?.rebuiltFromDisk) throw new Error('the restarted server did not say it rebuilt from disk');
  if (listing.data.persistence.damaged?.length) throw new Error(`runs were damaged: ${JSON.stringify(listing.data.persistence.damaged)}`);
  const found = (listing.data.runs ?? []).find((item) => item.runId === runId);
  if (!found) throw new Error('the run is missing from the listing after the restart');
  // Point 4b's link, which is the field most easily lost in a round trip and the one whose
  // loss is least visible: the run would still be listed, just attributed to nobody.
  if (found.conversationId !== conversationId) throw new Error(`the chat link was lost: ${found.conversationId}`);

  const eventsAfter = await request('/api/v1/events');
  if (eventsAfter.status !== 200) throw new Error(JSON.stringify(eventsAfter));
  if (eventsAfter.data.events !== countBefore) throw new Error(`the ledger came back with ${eventsAfter.data.events} events, not ${countBefore}`);
  // Recomputed from GENESIS over the reloaded records, not read off the file.
  const verified = await request('/api/v1/events/verify');
  if (verified.status !== 200 || verified.data.valid !== true) throw new Error(`the reloaded chain does not verify: ${JSON.stringify(verified.data)}`);
  if (eventsAfter.data.recoveredOnLoad !== null) throw new Error(`the ledger dropped a line on reload: ${JSON.stringify(eventsAfter.data.recoveredOnLoad)}`);

  // --- and the reloaded run is still usable, not just visible ---------------
  const approved = await request(`/api/v1/workspace-actions/${runId}/approve`, { method: 'POST', value: {} });
  if (approved.status !== 200) throw new Error(`the reloaded run could not be approved: ${JSON.stringify(approved.data).slice(0, 300)}`);
  if (approved.data.promoted !== true) throw new Error(`the reloaded run did not promote: ${JSON.stringify(approved.data).slice(0, 300)}`);

  console.log(`RESTART_DURABILITY_SMOKE=PASS runId=${runId} events=${countBefore}`);
  succeeded = true;
} finally {
  child.kill('SIGTERM');
  await new Promise((resolve_) => child.once('exit', resolve_)).catch(() => {});
  rmSync(workspace, { recursive: true, force: true });
  rmSync(shadows, { recursive: true, force: true });
  if (!succeeded) process.exitCode = 1;
}
