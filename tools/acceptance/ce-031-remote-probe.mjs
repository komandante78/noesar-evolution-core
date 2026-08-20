// SPDX-License-Identifier: AGPL-3.0-or-later
//
// CE-031, the half that can only be measured from somewhere else — what runs ON the second
// machine.
//
//   node ce-031-remote-probe.mjs <base-url> <setup-token>
//
// This file is deliberately the ONLY thing mounted into the second machine. Everything else
// it uses — `node`, `coden_evolution`, the product's own TOTP implementation — is what an
// installation of the product already puts on a machine, which is the point: a person on
// another machine has the product's CLI and a network, and nothing of this host.
//
// WHAT IT MAY NOT DO, because doing it would answer a different question than CE-031 asks:
//
//   * It never talks to a container engine. There is no engine socket in this container and
//     check 1 PROVES there is none rather than trusting the run flags — a probe that assumed
//     its own isolation would be asserting the very thing under test.
//   * It never reads a path of the machine running the installation. The setup token arrives
//     as an argument because that is how a first-owner token really travels: the administrator
//     who installed the product hands it to the person who registers. Reading it off a shared
//     filesystem would quietly make the two machines one.
//   * It never runs as root. The caller starts it under an unprivileged uid and check 0
//     measures that, for the same reason as check 1.
//
// Exit 0 = every check passed · 1 = at least one failed. The caller decides what that means;
// this file only ever reports what it measured.
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const base = process.argv[2];
const setupToken = process.argv[3];
if (!base || !setupToken) {
  process.stderr.write('usage: ce-031-remote-probe.mjs <base-url> <setup-token>\n');
  process.exit(2);
}

// The product's own TOTP, from where the product installed it. Resolved through the runtime
// root the image declares for itself rather than a literal /opt/noesar: an installation that
// repackages the product moves this with it, and one that does not set the variable never
// reaches this line — it fails loudly at import instead of silently skipping MFA.
const runtimeRoot = process.env.NOESAR_RUNTIME_ROOT ?? '/opt/noesar';
const { totpCode } = await import(`${runtimeRoot}/services/reference-control-plane/src/auth-crypto.mjs`);

let failed = 0;
const check = (id, name, ok, evidence) => {
  if (!ok) failed += 1;
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'}  ${id.padEnd(9)} ${name}\n            ${evidence}\n`);
};

// --- a cookie jar, because a session IS cookies ------------------------------------------
// Hand-rolled rather than imported from ./client.mjs on purpose: that file is not on this
// machine and mounting it would mean the second machine needs a piece of this repository to
// reach the product. It needs a URL.
const jar = new Map();
function absorb(res) {
  for (const line of res.headers.getSetCookie?.() ?? []) {
    const [pair] = line.split(';');
    const index = pair.indexOf('=');
    if (index < 0) continue;
    const name = pair.slice(0, index).trim();
    const value = pair.slice(index + 1).trim();
    if (value === '') jar.delete(name); else jar.set(name, value);
  }
}
async function call(method, path, { body, headers = {}, withCookies = true } = {}) {
  const out = { ...headers };
  if (withCookies && jar.size) out.cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
  // The same CSRF discipline the browser follows. A write that omitted it would be refused
  // by the product and would look like an authorization failure, which is not what is
  // being measured here.
  if (withCookies && jar.has('noesar_csrf') && method !== 'GET') out['x-noesar-csrf'] = jar.get('noesar_csrf');
  if (body !== undefined) out['content-type'] = 'application/json';
  // A transport failure is a MEASUREMENT — "the installation did not answer this machine" —
  // and is recorded as one. Found by running the oracle rather than by reading: pointed at an
  // address with nothing behind it, the first version of this function threw, node printed a
  // stack trace, and checks 3 through 9 never reported at all. The caller still saw a non-zero
  // exit, so it looked like it worked; what it had actually done was replace nine pieces of
  // evidence with an undici backtrace. The whole point of a probe on another machine is that
  // "unreachable" is the answer it exists to be able to give.
  let res;
  try {
    res = await fetch(new URL(path, base), {
      method, headers: out, body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (error) {
    return { status: 0, text: `unreachable: ${error.cause?.message ?? error.message}`, json: null };
  }
  absorb(res);
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not json, and that is a fact not an error */ }
  return { status: res.status, text, json };
}

// --- 0 · who this is ----------------------------------------------------------------------
const uid = process.getuid?.() ?? -1;
check('CE031-0', 'this machine is a non-administrator: not uid 0',
  uid > 0, `getuid() = ${uid}`);

// --- 1 · and it has no privileges on any container engine ---------------------------------
// Both halves are measured. A socket that is absent is not the same claim as an engine that
// is absent, and an engine binary present-but-unreachable is the case the launcher itself
// singles out (`a docker shim that cannot reach a daemon`).
const engineSockets = ['/var/run/docker.sock', '/run/docker.sock', '/run/podman/podman.sock']
  .filter((path) => existsSync(path));
const engineBinaries = ['docker', 'podman', 'nerdctl'].filter((binary) => {
  const found = spawnSync('sh', ['-c', `command -v ${binary}`], { encoding: 'utf8' });
  return found.status === 0 && String(found.stdout).trim() !== '';
});
check('CE031-1', 'no container-engine socket and no engine that answers',
  engineSockets.length === 0 && engineBinaries.length === 0,
  `engine sockets present: ${engineSockets.length ? engineSockets.join(',') : 'none'}; engine binaries on PATH: ${engineBinaries.length ? engineBinaries.join(',') : 'none'}`);

// --- 2 · the one word, run for real, with nothing for it to attach to ---------------------
// This is the negative half of the criterion and it is executed, not reasoned about: on a
// machine with no engine and no socket the launcher must DECLARE that, exit 3, and point at
// the entrance that does work from here — the browser. A launcher that died at its shebang,
// hung waiting for sudo, or printed a shell error would all look identical to a person who
// typed one word, and all three are what this catches.
const launcher = spawnSync('coden_evolution', [], { encoding: 'utf8', timeout: 30_000, env: { ...process.env, HOME: '/tmp' } });
const said = `${launcher.stdout ?? ''}${launcher.stderr ?? ''}`;
check('CE031-2', '`coden_evolution` declares there is no session here and names the browser',
  launcher.status === 3 && /no session found/.test(said) && /:8100\/|in a browser/.test(said) && !/line [0-9]+/.test(said),
  `exit ${launcher.status}; says-no-session ${/no session found/.test(said)}; names-browser ${/in a browser/.test(said)}; shell-trace ${/line [0-9]+/.test(said)}`);

// --- 3 · the session's own surface answers over TCP, from here ----------------------------
const livez = await call('GET', '/livez');
check('CE031-3', 'the installation answers this machine over TCP alone',
  livez.status === 200, `GET /livez -> ${livez.status} ${livez.text.slice(0, 60)}`);

// --- 4 · and it is a door, not an open one ------------------------------------------------
const ungated = await call('POST', '/api/v1/tui/command', { body: { method: 'status' }, withCookies: false });
check('CE031-4', 'the session refuses this machine until it says who it is',
  ungated.status === 401, `POST /api/v1/tui/command unauthenticated -> ${ungated.status}`);

// --- 5 · registration, from here, with no other channel -----------------------------------
// §8 point 10 of the engineering-depth skill: access control is REGISTRATION. This is that
// mechanism exercised from the machine that is not the host — the whole of it, including the
// second factor, because a first factor alone would be a different product than the one built.
const owner = {
  username: 'ce031-second-machine',
  displayName: 'CE-031 Second Machine',
  password: `ce031-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`,
};
const setup = await call('POST', '/api/v1/auth/setup', {
  body: owner, headers: { 'x-noesar-setup-token': setupToken },
});
const totpSecret = setup.json?.totpSecret;
check('CE031-5', 'this machine can register the first owner over the network',
  setup.status === 201 && Boolean(setup.json?.challenge) && Boolean(totpSecret),
  `POST /api/v1/auth/setup -> ${setup.status}; challenge ${Boolean(setup.json?.challenge)}; enrolment secret ${totpSecret ? `${totpSecret.length} chars` : 'absent'}`);

const confirm = totpSecret
  ? await call('POST', '/api/v1/auth/setup/confirm', { body: { challenge: setup.json.challenge, totpCode: totpCode(totpSecret) } })
  : { status: 0, json: null, text: 'no enrolment secret to confirm with' };
check('CE031-6', 'the second factor completes and a session is issued to this machine',
  confirm.status === 201 && confirm.json?.user?.role === 'owner' && jar.has('noesar_session'),
  `POST /api/v1/auth/setup/confirm -> ${confirm.status}; role ${confirm.json?.user?.role ?? 'none'}; session cookie held ${jar.has('noesar_session')}`);

// --- 7 · THE session, driven from here ----------------------------------------------------
// Reaching an authentication prompt is not reaching a session — that conflation is what the
// 2026-08-07 record left open. `/api/v1/tui/command` is the browser terminal's transport over
// the SAME dispatch and the SAME running instances as the unix socket (server.mjs), so a real
// method answering here is the session answering, not a health endpoint being polite.
//
// `status` is the session's own handshake — the first thing the terminal asks — and it is the
// same method over the same dispatch the unix socket serves. A method needing PARAMETERS was
// tried first and rejected as the wrong instrument: `workspace.get` without a run id answers
// 422, which is the protocol working correctly and would have been recorded as the session
// failing to answer.
const driven = await call('POST', '/api/v1/tui/command', { body: { method: 'status' } });
check('CE031-7', "the session's own handshake answers this machine",
  driven.status === 200 && driven.json?.ok === true && Boolean(driven.json?.result?.protocol),
  `POST /api/v1/tui/command {status} -> ${driven.status}; ok ${driven.json?.ok}; protocol ${driven.json?.result?.protocol ?? 'none'}`);

// --- 8 · and the permission gate travels with it ------------------------------------------
// A method that needs `workspace.read`, answered for an account that has it. This is the half
// that says the transport did not become a weaker door than the socket: the bridge looks the
// permission up per method (server.mjs), and an account reaching it from another machine is
// judged by the same table as one on the unix socket.
const permissioned = await call('POST', '/api/v1/tui/command', { body: { method: 'capability.grants' } });
check('CE031-8', 'a permission-gated session method answers the registered owner',
  permissioned.status === 200 && permissioned.json?.ok === true && Array.isArray(permissioned.json?.result?.grants),
  `POST /api/v1/tui/command {capability.grants, needs workspace.read} -> ${permissioned.status}; ok ${permissioned.json?.ok}; grants ${permissioned.json?.result?.grants?.length ?? 'none'}`);

// --- 9 · and the rendering the launcher points a remote person at is really served ---------
// The launcher's own no-session message names the browser FIRST and unconditionally, so the
// entrance it advertises to someone on another machine has to be there. This is that document,
// asked for from that machine: served, holding its mount point, loading its module.
const shell = await call('GET', '/coden-terminal.html');
const loadsModule = /coden-terminal-frame\.js/.test(shell.text) && /terminalHost/.test(shell.text);
check('CE031-9', 'the browser rendering of the same session is served to this machine',
  shell.status === 200 && loadsModule,
  `GET /coden-terminal.html -> ${shell.status}; ${shell.text.length} bytes; mounts its emulator and loads its module ${loadsModule}`);

process.stdout.write(`\nCE031_REMOTE_FAIL=${failed}\n`);
// Nothing to clean up here: this process holds a cookie in memory, on a container the caller
// removes. Said rather than left silent, because "the probe cleaned up" is a claim.
process.exit(failed === 0 ? 0 : 1);
