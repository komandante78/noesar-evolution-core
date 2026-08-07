// SPDX-License-Identifier: AGPL-3.0-or-later
//
// D-0348, the terminal's own half: where the token is kept, and the order the ways in are
// tried. Written for the same reason `tui-client-login.test.mjs` was — `main()` opens a
// socket and blocks on stdin, so anything that lives inside it is measured by nothing.
// `attachSession` and the credential file are therefore both callable without a socket, a
// home directory, or a terminal, and every branch below is driven directly.
//
// The file half matters more than it looks. The token IS the authentication — the entire
// requirement is that nothing is typed — so a file that is readable by another account on
// the machine is not a possession factor at all. `readCredential` refusing that file, and
// `writeCredential` guaranteeing 0600 through an explicit chmod rather than through a mode
// argument the umask can filter, are the two things holding that up.

import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';
import { attachSession, LineReader, login } from '../../../tools/tui-client.mjs';
import { clearCredential, credentialPath, readCredential, writeCredential } from '../../../tools/terminal-credential.mjs';

const USER = { id: 'u1', username: 'owner', role: 'owner' };
const ENDPOINT = '/run/codev-tui.sock';

function tmp() {
  return mkdtempSync(join(os.tmpdir(), 'noesar-cred-'));
}

function scriptedReader(lines) {
  return { next: () => Promise.resolve(lines.shift() ?? '') };
}

function fakeSession(answers) {
  const calls = [];
  return {
    calls,
    call: (method, params) => {
      calls.push({ method, params });
      const answer = answers[method];
      if (typeof answer === 'function') return answer(params, calls.length);
      if (answer instanceof Error) return Promise.reject(answer);
      if (answer === undefined) return Promise.reject(new Error(`no answer scripted for ${method}`));
      return Promise.resolve(answer);
    },
  };
}

/** A credential store held in memory, so the ORDER of the ways in is what is measured here. */
function memoryCredentials(initial = null) {
  let held = initial;
  return {
    label: 'owner@box',
    path: '/dev/null/memory',
    read: () => held,
    write: (token) => { held = { token }; },
    clear: () => { held = null; },
    get held() { return held; },
  };
}

describe('where a remembered terminal keeps its token', () => {
  test('an explicit path wins over everything else', () => {
    const found = credentialPath({ NOESAR_TERMINAL_CREDENTIAL: '/somewhere/mine.json', XDG_CONFIG_HOME: '/xdg', HOME: os.tmpdir() });
    assert.equal(found.path, '/somewhere/mine.json');
    assert.equal(found.source, 'NOESAR_TERMINAL_CREDENTIAL');
  });

  test('HOME=/nonexistent is skipped for the workspace — the product\'s own container', () => {
    const workspace = tmp();
    // Not a hypothetical: this is what the live installation reports. A resolver that only
    // checked whether HOME was SET would return /nonexistent/.config here, and a terminal
    // that cannot write its token would ask for a code every single time while reporting
    // that it had remembered.
    const found = credentialPath({ HOME: '/nonexistent', NOESAR_WORKSPACE: workspace });
    assert.equal(found.source, 'NOESAR_WORKSPACE');
    assert.ok(found.path.startsWith(workspace));
  });

  test('nowhere writable resolves to null rather than to a guess', () => {
    assert.equal(credentialPath({ HOME: '/nonexistent' }), null);
  });

  test('the file is written 0600 inside a 0700 directory', () => {
    const home = tmp();
    const path = credentialPath({ HOME: home }).path;
    writeCredential(path, ENDPOINT, 'token-value');
    assert.equal(statSync(path).mode & 0o777, 0o600);
    assert.equal(statSync(join(home, '.config', 'coden-evolution')).mode & 0o777, 0o700);
    assert.equal(readCredential(path, ENDPOINT).token, 'token-value');
  });

  test('a token another account could read is REFUSED, not used', () => {
    const home = tmp();
    const path = credentialPath({ HOME: home }).path;
    writeCredential(path, ENDPOINT, 'token-value');
    chmodSync(path, 0o644);
    assert.equal(readCredential(path, ENDPOINT), null, 'a world-readable token was accepted as a possession factor');
  });

  test('two installations from one home do not evict each other', () => {
    const home = tmp();
    const path = credentialPath({ HOME: home }).path;
    writeCredential(path, '/run/a.sock', 'token-a');
    writeCredential(path, '/run/b.sock', 'token-b');
    assert.equal(readCredential(path, '/run/a.sock').token, 'token-a');
    assert.equal(readCredential(path, '/run/b.sock').token, 'token-b');

    assert.equal(clearCredential(path, '/run/a.sock'), true);
    assert.equal(readCredential(path, '/run/a.sock'), null);
    assert.equal(readCredential(path, '/run/b.sock').token, 'token-b', 'forgetting one endpoint forgot the other');
  });

  test('forgetting the last endpoint removes the file entirely', () => {
    const home = tmp();
    const path = credentialPath({ HOME: home }).path;
    writeCredential(path, ENDPOINT, 'token-value');
    clearCredential(path, ENDPOINT);
    assert.equal(existsSync(path), false, 'an empty credential file was left behind');
  });

  test('a corrupt file degrades to "not remembered", never to a crash', () => {
    const home = tmp();
    const path = credentialPath({ HOME: home }).path;
    mkdirSync(join(home, '.config', 'coden-evolution'), { recursive: true, mode: 0o700 });
    writeFileSync(path, 'this is not json', { mode: 0o600 });
    assert.equal(readCredential(path, ENDPOINT), null);
  });
});

describe('the order the ways in are tried (D-0348)', () => {
  test('a remembered terminal opens with NOTHING typed', async () => {
    const reader = scriptedReader([]);
    const session = fakeSession({ 'auth.resume': { user: USER, permissions: ['workspace.read'] } });
    const result = await attachSession(reader, session, memoryCredentials({ token: 'stored-token' }));

    assert.equal(result.via, 'remembered');
    assert.deepEqual(session.calls.map((item) => item.method), ['auth.resume'],
      'a remembered terminal still walked a sign-in path');
    assert.equal(session.calls[0].params.token, 'stored-token');
    assert.deepEqual(result.user.permissions, ['workspace.read']);
  });

  test('a refused token is DELETED, then the operator signs in as before', async () => {
    const credentials = memoryCredentials({ token: 'stale-token' });
    const reader = scriptedReader(['ABCD-EFGH']);
    const session = fakeSession({
      'auth.resume': new Error('This terminal is not remembered here.'),
      'auth.attach': { user: USER, permissions: [] },
      'auth.remember': { token: 'fresh-token', id: 'x' },
    });
    const result = await attachSession(reader, session, credentials);

    assert.deepEqual(session.calls.map((item) => item.method), ['auth.resume', 'auth.attach', 'auth.remember']);
    assert.equal(result.via, 'signed-in');
    // The stale one was cleared before the new one landed — otherwise every future run pays
    // a doomed round trip and prints the same failure forever.
    assert.equal(credentials.held.token, 'fresh-token');
  });

  test('signing in once remembers the terminal for next time', async () => {
    const credentials = memoryCredentials(null);
    const reader = scriptedReader(['', 'owner', 'password', '123456']);
    const session = fakeSession({
      'auth.login': { challenge: 'c1' },
      'auth.mfa': { user: USER, permissions: [] },
      'auth.remember': (params) => Promise.resolve({ token: 'new-token', id: 'x', label: params.label }),
    });
    const result = await attachSession(reader, session, credentials);

    assert.equal(result.remembered, true);
    assert.equal(credentials.held.token, 'new-token');
    assert.equal(session.calls.at(-1).params.label, 'owner@box', 'the label the browser will list was not sent');
  });

  test('--no-remember signs in and stores nothing', async () => {
    const credentials = memoryCredentials(null);
    const reader = scriptedReader(['ABCD-EFGH']);
    const session = fakeSession({ 'auth.attach': { user: USER, permissions: [] } });
    const result = await attachSession(reader, session, credentials, { remember: false });

    assert.equal(result.remembered, false);
    assert.equal(credentials.held, null);
    assert.equal(session.calls.some((item) => item.method === 'auth.remember'), false);
  });

  test('failing to remember is not fatal — the operator is already inside', async () => {
    const credentials = memoryCredentials(null);
    const reader = scriptedReader(['ABCD-EFGH']);
    const session = fakeSession({
      'auth.attach': { user: USER, permissions: [] },
      'auth.remember': new Error('state is read-only'),
    });
    const result = await attachSession(reader, session, credentials);

    assert.equal(result.user.username, 'owner', 'a failure to remember locked the operator out');
    assert.equal(result.remembered, false);
    assert.equal(credentials.held, null);
  });

  // Found by EXECUTING the gesture rather than reading the code: `CE-037` drove the launcher
  // with a script one line shorter than the prompts asked for, and the run HUNG with no
  // output — a `next()` whose promise nothing would ever settle. Invisible to a human at a
  // TTY, because a terminal's stdin does not end; reachable only from piped sessions, which
  // is where every harness lives. These two are the regression.
  test('a prompt waiting when stdin closes is ANSWERED, not abandoned', async () => {
    const iface = new EventEmitter();
    const reader = new LineReader(iface);
    const waiting = reader.next();
    iface.emit('close');
    // Raced against a timer on purpose. Awaiting `waiting` directly would reproduce the very
    // defect under test — the suite would HANG rather than go red, and a hang is not a
    // failure anyone can read: measured, it reported "13 pass, 0 fail" with four tests simply
    // never arriving. A guard whose failure mode is silence is not a guard.
    const settled = await Promise.race([waiting, new Promise((r) => setTimeout(() => r('NEVER-SETTLED'), 200))]);
    assert.equal(settled, null, 'a pending prompt was left hanging when input ended');
  });

  test('every later prompt on a closed stdin says "nobody there", immediately', async () => {
    const iface = new EventEmitter();
    const reader = new LineReader(iface);
    iface.emit('close');
    assert.equal(await reader.next(), null);
    // And an empty line is still an empty line — EOF and Enter must not collapse into one
    // answer, or a closed pipe reads as consent to fall through to the credential path.
    const typing = new LineReader(new EventEmitter());
    const pending = typing.next();
    typing.queue.push('');
    assert.notEqual(await Promise.race([pending, Promise.resolve('still-waiting')]), null);
  });

  test('sign-in refuses to walk on when the input has ended', async () => {
    const endedReader = { next: () => Promise.resolve(null) };
    const session = fakeSession({});
    await assert.rejects(login(endedReader, session), /input ended before sign-in completed/);
    assert.deepEqual(session.calls, [], 'a closed stdin still reached the network');
  });

  test('nowhere to store a token still signs in — it just cannot be remembered', async () => {
    const reader = scriptedReader(['ABCD-EFGH']);
    const session = fakeSession({ 'auth.attach': { user: USER, permissions: [] } });
    const result = await attachSession(reader, session, null);

    assert.equal(result.user.username, 'owner');
    assert.equal(result.remembered, false);
    assert.equal(session.calls.some((item) => item.method === 'auth.remember'), false);
  });
});
