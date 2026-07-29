#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// ARCH-001: the OS process noesar-supervisord (rust/crates/noesar-supervisor) supervises
// as the "postgres" peer. Owns exactly what PostgresSupervisor already owned when it ran
// nested inside the api process (initdb, spawn, crash-restart, migrations) — this file
// changes WHO holds the process handle, not what the class does. `server.mjs` no longer
// instantiates PostgresSupervisor in owning mode; see NOESAR_POSTGRES_PEER_MODE there.
import { join } from 'node:path';
import { PostgresSupervisor } from '../src/postgres-supervisor.mjs';

const workspace = process.env.NOESAR_WORKSPACE ?? '/workspace';
const supervisor = new PostgresSupervisor({
  root: process.env.NOESAR_POSTGRES_ROOT ?? join(workspace, 'postgresql'),
  secretsDir: process.env.NOESAR_POSTGRES_SECRETS_DIR ?? join(workspace, 'config/postgres'),
  managesProcess: true,
});

function log(level, event, detail = {}) {
  const line = JSON.stringify({
    ts: new Date().toISOString(), level, event, component: 'postgres-child', ...detail,
  });
  process.stdout.write(`${line}\n`);
}

let stopping = false;
async function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  log('info', 'postgres-child.signal', { signal });
  try {
    await supervisor.stop();
    log('info', 'postgres-child.stopped', {});
    process.exit(0);
  } catch (error) {
    log('error', 'postgres-child.stop_failed', { message: error.message });
    process.exit(1);
  }
}
process.on('SIGTERM', () => { shutdown('SIGTERM'); });
process.on('SIGINT', () => { shutdown('SIGINT'); });

try {
  await supervisor.start();
  log('info', 'postgres-child.ready', {});
} catch (error) {
  log('error', 'postgres-child.start_failed', { message: error.message, stack: error.stack });
  process.exit(1);
}

// Nothing else to do: `supervisor.start()` left a live postgres child process behind
// with its stdout/stderr pipes held open by this process, which is what keeps the event
// loop — and therefore this process, the thing noesar-supervisord actually watches —
// alive. If postgres exits, the supervisor's own restart-with-backoff logic runs inside
// `start()`'s callbacks; if it exhausts its retries this process simply stays up in a
// FAILED state rather than exiting, so noesar-supervisord does not mistake a database
// that gave up on restarting for a wrapper that crashed (the two call for different
// operator responses, and conflating them would make ARCH-002's "the other peer survives"
// promise only accidentally true).
