// SPDX-License-Identifier: AGPL-3.0-or-later
//
// voiceReadiness() can answer READY truthfully while the browser asking has no microphone at
// all, because a microphone is gated by the browser's secure-context rule and not by anything
// on this side of the wire. What is asserted here is the other half: whether the person asking
// can use one, and the cheapest way for them to get there.
//
// The browser rule underneath — that `localhost` and `127.0.0.1` are trustworthy origins over
// plain HTTP — was measured rather than assumed: a plain HTTP server reported
// `isSecureContext: true` with `getUserMedia` present on both names, and `false`/absent on its
// LAN address, same server and same browser.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { voiceAccess } from '../src/voice-access.mjs';

const ANCHOR = { available: true, fingerprintSha256: 'AA:BB:CC', subject: 'CN=NOESAR EVOLUTION local CA' };
const SECURE = 'https://192.168.178.100:8443';
const ask = (extra = {}) => voiceAccess({
  encrypted: false, host: '192.168.178.100:8100', trustAnchor: ANCHOR, secureAddress: SECURE, ...extra,
});

describe('when the microphone is already available', () => {
  test('an encrypted connection needs nothing further', () => {
    const plan = ask({ encrypted: true });
    assert.equal(plan.microphoneUsableHere, true);
    assert.equal(plan.reason, 'encrypted-connection');
    assert.deepEqual(plan.alternatives, [], 'offering steps to somebody who needs none is the noise being removed');
  });

  for (const host of ['localhost:8100', '127.0.0.1:8100', 'LOCALHOST:8100', '[::1]:8100']) {
    test(`plain HTTP on ${host} is a trustworthy origin, so voice works with nothing installed`, () => {
      const plan = ask({ host });
      assert.equal(plan.microphoneUsableHere, true, 'this is the free answer the product never mentioned');
      assert.equal(plan.reason, 'loopback-address');
    });
  }
});

describe('when it is not, the free answer comes before the expensive one', () => {
  test('the order is: same machine, then install a certificate', () => {
    const plan = ask();
    assert.equal(plan.microphoneUsableHere, false);
    assert.equal(plan.reason, 'insecure-context');
    assert.deepEqual(plan.alternatives.map((a) => a.kind), ['SAME_MACHINE', 'INSTALL_CERTIFICATE']);
  });

  test('the same-machine address carries the port the client actually reached us on', () => {
    // Never a port this process merely listens on: an installation published as 9000 must not
    // be told to open 8088, which is what guessing from the listener would produce.
    assert.equal(ask({ host: '192.168.178.100:9000' }).alternatives[0].url, 'http://localhost:9000');
  });

  test('the certificate step carries the fingerprint, on an authenticated channel', () => {
    // /ca can only ask the reader to compare against the server's log, because it is fetched
    // over a connection nothing authenticated. Here the person is already signed in, which is
    // what makes handing them the number worth anything.
    const step = ask().alternatives[1];
    assert.equal(step.fingerprintSha256, 'AA:BB:CC');
    assert.equal(step.certificateUrl, 'http://192.168.178.100:8100/ca');
    assert.equal(step.secureUrl, SECURE);
  });

  test('with no certificate to install, that step is not offered at all', () => {
    // An installation with no TLS cannot give voice to another device, and saying so beats
    // offering a step that leads nowhere.
    const plan = ask({ trustAnchor: { available: false }, secureAddress: null });
    assert.equal(plan.microphoneUsableHere, false);
    assert.deepEqual(plan.alternatives.map((a) => a.kind), ['SAME_MACHINE']);
  });

  test('a declared certificate with no declared https address is not offered either', () => {
    // Half the instruction is worse than none: the person installs a certificate and still has
    // nowhere to go.
    assert.deepEqual(ask({ secureAddress: null }).alternatives.map((a) => a.kind), ['SAME_MACHINE']);
  });

  test('a Host with no port offers no same-machine address rather than a wrong one', () => {
    assert.deepEqual(ask({ host: 'noesar.local' }).alternatives.map((a) => a.kind), ['INSTALL_CERTIFICATE']);
  });
});
