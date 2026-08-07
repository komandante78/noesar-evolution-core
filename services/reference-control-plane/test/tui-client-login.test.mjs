// SPDX-License-Identifier: AGPL-3.0-or-later
//
// D-0337 — the terminal half of "one authentication, not two".
//
// This file exists because of a gap found while closing that point: `login()` in
// tools/tui-client.mjs was exercised by NOTHING. The unit suites import `dispatchCommand`
// and its neighbours; `ce-020` and `ce-021` speak to the unix socket directly and never
// drive the client's own prompts. So the sign-in flow — the first thing a real operator
// touches — was the one part of the client with no measurement at all, and a new prompt was
// about to be added in front of it.
//
// That is the exact shape of a defect this project has already paid for once: a page that
// told operators to run a client which was not in the image (`D-0301`). A claim about the
// terminal that nothing executes is a claim, not a behaviour.

import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { login } from '../../../tools/tui-client.mjs';

/** A reader that answers a scripted list of lines and records what it was asked. */
function scriptedReader(lines) {
  const asked = [];
  return {
    asked,
    next: () => Promise.resolve(lines.shift() ?? ''),
    // `question()` writes the prompt to stdout, which is not what is being measured here;
    // the sequence of ANSWERS is. Prompts are captured through the session calls instead.
    remaining: () => lines.length,
  };
}

/** A session that records every call and answers from a table. */
function fakeSession(answers) {
  const calls = [];
  return {
    calls,
    call: (method, params) => {
      calls.push({ method, params });
      const answer = answers[method];
      if (typeof answer === 'function') return answer(params, calls.length);
      if (answer instanceof Error) return Promise.reject(answer);
      return Promise.resolve(answer);
    },
  };
}

const USER = { id:'u1', username:'owner', role:'owner' };

describe('the terminal signs in — two paths, one account (D-0337)', () => {
  test('a code typed at the first prompt signs in with no credentials asked', async () => {
    const reader = scriptedReader(['ABCD-EFGH']);
    const session = fakeSession({ 'auth.attach': { user:USER, permissions:['workspace.read'] } });
    const user = await login(reader, session);

    assert.equal(user.username, 'owner');
    assert.deepEqual(user.permissions, ['workspace.read']);
    assert.deepEqual(session.calls.map((item) => item.method), ['auth.attach'],
      'the credential path was walked even though a code was accepted');
    assert.equal(session.calls[0].params.code, 'ABCD-EFGH');
  });

  test('an empty line falls through to username, password and second factor', async () => {
    // The path that must never be removed: an installation with no browser open, a fresh
    // machine, or an operator who prefers it. Offering the code first is a convenience,
    // not a replacement.
    const reader = scriptedReader(['', 'owner', 'a password', '123456']);
    const session = fakeSession({
      'auth.login': { challenge:'ch-1' },
      'auth.mfa': { user:USER, permissions:['workspace.write'] },
    });
    const user = await login(reader, session);

    assert.equal(user.username, 'owner');
    assert.deepEqual(session.calls.map((item) => item.method), ['auth.login', 'auth.mfa']);
    assert.deepEqual(session.calls[0].params, { username:'owner', password:'a password' });
    assert.equal(session.calls[1].params.challenge, 'ch-1', 'the MFA call did not carry the challenge it was given');
  });

  test('a mistyped code can be retried, because a miss does not burn the real one', async () => {
    // Server-side, a code that does not match is never found and nothing is consumed — so
    // the code still on the operator's screen is still live. Retrying is therefore worth
    // something here, which is NOT true of the password path.
    const reader = scriptedReader(['WRONG-ONE', 'ABCD-EFGH']);
    const session = fakeSession({
      'auth.attach': (params) => (params.code === 'ABCD-EFGH'
        ? Promise.resolve({ user:USER, permissions:[] })
        : Promise.reject(new Error('Invalid or expired attach code.'))),
    });
    const user = await login(reader, session);

    assert.equal(user.username, 'owner');
    assert.equal(session.calls.length, 2, 'the second attempt was never made');
  });

  test('after three failed codes it falls through to credentials rather than giving up', async () => {
    // A terminal must never be left with no way in because a code expired mid-typing.
    // Before this, a single bad code exited the client with status 1.
    const reader = scriptedReader(['BAD1-BAD1', 'BAD2-BAD2', 'BAD3-BAD3', 'owner', 'a password', '123456']);
    const session = fakeSession({
      'auth.attach': new Error('Invalid or expired attach code.'),
      'auth.login': { challenge:'ch-2' },
      'auth.mfa': { user:USER, permissions:[] },
    });
    const user = await login(reader, session);

    assert.equal(user.username, 'owner');
    assert.deepEqual(session.calls.map((item) => item.method),
      ['auth.attach', 'auth.attach', 'auth.attach', 'auth.login', 'auth.mfa']);
  });

  test('a deployment that predates the permission field declares the menu UNFILTERED', async () => {
    // Both paths, and for the same reason: `menuFor(null)` says the list was not filtered
    // rather than quietly showing everything as though it had been checked. This is the
    // `CE-036` disclosure rule, and the attach path must not become the hole in it.
    for (const [first, answers] of [
      ['ABCD-EFGH', { 'auth.attach': { user:USER } }],
      ['', { 'auth.login': { challenge:'c' }, 'auth.mfa': { user:USER } }],
    ]) {
      const reader = scriptedReader([first, 'owner', 'a password', '123456']);
      const user = await login(reader, fakeSession(answers));
      assert.equal(user.permissions, null, `permissions should be null, not undefined (first=${first || 'empty'})`);
    }
  });
});
