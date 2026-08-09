// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The failure this module reports is invisible from anything that is not a browser: the server
// answers 200, the cookie is issued, and the browser silently drops it. Every automated check
// of sign-in in this repository runs in something that is not a browser, which is how it went
// unnoticed from D-0360 until D-0364. These tests therefore assert the ADVICE, and the browser
// behaviour it describes was measured separately, on a real browser, against a throwaway
// installation.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { browserSignIn, normaliseHttpsUrl } from '../src/secure-address.mjs';

const HTTPS = 'https://192.168.178.100:8443';
const overPlaintext = (extra = {}) => browserSignIn({
  encrypted: false, secureCookies: true, tlsListenerExists: true, publicTlsUrl: HTTPS, ...extra,
});

describe('when there is nothing to warn about', () => {
  test('an encrypted request is fine, and carries no address to go to', () => {
    const advice = overPlaintext({ encrypted: true });
    assert.equal(advice.browserSignInPossible, true);
    assert.equal(advice.secureAddress, null);
    assert.equal(advice.reason, null);
  });

  test('an installation with no TLS at all is a supported configuration, not a degraded one', () => {
    // The cookie has no Secure attribute there, so a browser keeps it over plaintext and sign-in
    // works. Reporting this as a problem would tell every plaintext installation it is broken.
    const advice = overPlaintext({ secureCookies: false, tlsListenerExists: false, publicTlsUrl: null });
    assert.equal(advice.browserSignInPossible, true);
    assert.equal(advice.reason, null);
  });
});

describe('when a browser cannot complete a sign-in here', () => {
  test('it is reported, with the address that would work', () => {
    const advice = overPlaintext();
    assert.equal(advice.browserSignInPossible, false);
    assert.equal(advice.secureAddress, HTTPS);
    assert.match(advice.reason, /Secure attribute/);
    // The shape of the failure is the point: "appears to succeed" is what makes it hard to
    // diagnose, so the sentence a person reads has to say that and not just "use https".
    assert.match(advice.reason, /appears to succeed/);
  });

  test('a plaintext request while the main listener is encrypted names a different cause', () => {
    // No second listener means TLS was terminated by something in front of the product. Blaming
    // the plain port there would send an operator to a port that does not exist.
    const advice = overPlaintext({ tlsListenerExists: false });
    assert.equal(advice.browserSignInPossible, false);
    assert.match(advice.reason, /in front of it/);
    assert.match(advice.reason, /NOESAR_SECURE_COOKIES/);
    assert.doesNotMatch(advice.reason, /Use the encrypted address/);
  });

  test('with no address declared, the problem is still stated and no destination is invented', () => {
    const advice = overPlaintext({ publicTlsUrl: null });
    assert.equal(advice.browserSignInPossible, false, 'the failure does not depend on knowing where to go');
    assert.equal(advice.secureAddress, null);
    assert.ok(advice.reason);
  });
});

describe('the declared address is a promise, so a wrong one is refused', () => {
  // This string is put in front of a person as "the address that WILL work". One that does not
  // is worse than silence: it moves the failure somewhere they cannot diagnose.
  const rejected = [
    ['plain http', 'http://192.168.178.100:8443'],
    ['no scheme', '192.168.178.100:8443'],
    ['a bare hostname', 'noesar.local'],
    ['empty', ''],
    ['whitespace', '   '],
    ['not a URL at all', 'yes please'],
    ['undefined', undefined],
    ['null', null],
    ['a number', 8443],
  ];
  for (const [name, value] of rejected) {
    test(`${name} is refused`, () => {
      assert.equal(normaliseHttpsUrl(value), null);
      assert.equal(overPlaintext({ publicTlsUrl: value }).secureAddress, null);
    });
  }

  test('an accepted address is reduced to its origin, so a stray path cannot travel', () => {
    assert.equal(normaliseHttpsUrl('https://192.168.178.100:8443/some/page?q=1#x'), HTTPS);
  });

  test('surrounding whitespace does not make a good address bad', () => {
    assert.equal(normaliseHttpsUrl(`  ${HTTPS}  `), HTTPS);
  });

  test('the default https port is not printed back, because a browser does not need it', () => {
    assert.equal(normaliseHttpsUrl('https://noesar.local:443'), 'https://noesar.local');
  });
});
