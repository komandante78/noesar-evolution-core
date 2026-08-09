// SPDX-License-Identifier: AGPL-3.0-or-later
//
// `F4-010`, closed. The register carried it as OPEN and ACCEPTED since phase 4:
//
//   > provider and tool URL validation checks the hostname STRING, not the address reached
//   > SEC-15: registering https://internal.example.test/v1 as an external tool succeeds
//
// The evidence line is the first test below, run against the real guard rather than described.
//
// What makes this suite worth reading is the SECOND property. Resolving and checking is the
// obvious half and it is not enough: between the check and the connection the socket layer
// resolves the name again, so a resolver that answers publicly to the checker and privately to
// the connection walks straight past it. That is the failure the finding warned about when it
// said a partial mitigation becomes a false sense of safety, and the rebinding test below is the
// only one here that would still fail against a guard that merely checks.

import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import {
  isInternalAddress, resolvePublicAddresses, pinnedLookup, guardedFetch,
  BlockedAddressError, METADATA_ADDRESSES,
} from '../src/ai-workspace/address-guard.mjs';

const resolvesTo = (map) => async (hostname) => {
  const answers = map[hostname];
  if (!answers) throw Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' });
  return answers;
};

describe('what counts as inside this installation', () => {
  test('every private, loopback, link-local and metadata address is refused', () => {
    const inward = [
      '10.0.0.5', '10.255.255.255', '172.16.0.1', '172.31.255.254', '192.168.178.100',
      '127.0.0.1', '127.1.2.3', '0.0.0.0', '169.254.169.254', '100.100.100.200',
      '100.64.0.1', '198.18.0.1', '192.0.0.1', '224.0.0.1', '255.255.255.255',
      '::1', '::', 'fc00::1', 'fd12:3456::1', 'fe80::1', 'ff02::1',
    ];
    for (const address of inward) assert.equal(isInternalAddress(address), true, address);
  });

  test('an IPv4 address wearing an IPv6 coat is still that address', () => {
    // `::ffff:10.0.0.1` is RFC1918 in a mapped form. Reading it as v6 — which every "starts with
    // fc/fd/fe80" check does — walks every private range through the front door.
    assert.equal(isInternalAddress('::ffff:10.0.0.1'), true);
    assert.equal(isInternalAddress('::ffff:127.0.0.1'), true);
    assert.equal(isInternalAddress('::ffff:93.184.216.34'), false);
  });

  test('ordinary public addresses are allowed', () => {
    for (const address of ['93.184.216.34', '1.1.1.1', '8.8.8.8', '2606:2800:220:1::', '172.32.0.1', '172.15.0.1']) {
      assert.equal(isInternalAddress(address), false, address);
    }
  });

  test('anything that is not an address at all fails CLOSED', () => {
    // A guard whose unknown case is "allow" is not a guard. `''`, a hostname that slipped
    // through, a number — every one of them means something upstream is not what was assumed.
    for (const value of ['', null, undefined, 'not-an-address', 'example.com', '10.0.0', '999.1.1.1']) {
      assert.equal(isInternalAddress(value), true, JSON.stringify(value));
    }
  });

  test('the metadata addresses are named, so a reader can check the list', () => {
    assert.ok(METADATA_ADDRESSES.includes('169.254.169.254'));
    for (const address of METADATA_ADDRESSES) assert.equal(isInternalAddress(address), true, address);
  });
});

describe('a name is judged by where it goes', () => {
  test('THE FINDING: a public-looking name that resolves inward is refused', async () => {
    // SEC-15, verbatim. This is the case that "succeeds" in the register.
    await assert.rejects(
      () => resolvePublicAddresses('internal.example.test', {
        lookup: resolvesTo({ 'internal.example.test': [{ address: '10.0.0.5', family: 4 }] }),
      }),
      (error) => {
        assert.ok(error instanceof BlockedAddressError);
        assert.equal(error.status, 403);
        // The reason names the ADDRESS. "Blocked" alone sends an operator to read firewall rules.
        assert.match(error.message, /10\.0\.0\.5/);
        return true;
      },
    );
  });

  test('a name that resolves to one public AND one private address is refused', async () => {
    // Not a name with a public address — the shape of the attack. Accepting it would make the
    // product safe or not depending on which address it happened to try first.
    await assert.rejects(() => resolvePublicAddresses('split.example.test', {
      lookup: resolvesTo({ 'split.example.test': [
        { address: '93.184.216.34', family: 4 }, { address: '10.0.0.5', family: 4 },
      ] }),
    }), BlockedAddressError);
  });

  test('a genuinely public name resolves and is returned', async () => {
    const addresses = await resolvePublicAddresses('example.test', {
      lookup: resolvesTo({ 'example.test': [{ address: '93.184.216.34', family: 4 }] }),
    });
    assert.deepEqual(addresses, [{ address: '93.184.216.34', family: 4 }]);
  });

  test('a literal is judged without asking a resolver at all', async () => {
    let asked = false;
    const lookup = async () => { asked = true; return []; };
    assert.deepEqual(await resolvePublicAddresses('93.184.216.34', { lookup }), [{ address: '93.184.216.34', family: 4 }]);
    await assert.rejects(() => resolvePublicAddresses('10.0.0.5', { lookup }), BlockedAddressError);
    assert.equal(asked, false, 'a round trip to be told what was already known');
  });

  test('a name that does not resolve is refused here, not left to fail at connect time', async () => {
    await assert.rejects(() => resolvePublicAddresses('nowhere.example.test', { lookup: resolvesTo({}) }),
      (error) => { assert.equal(error.status, 502); return true; });
  });

  test('a name that resolves to nothing is refused', async () => {
    await assert.rejects(() => resolvePublicAddresses('empty.example.test', {
      lookup: resolvesTo({ 'empty.example.test': [] }),
    }), BlockedAddressError);
  });
});

describe('the check is BINDING — the address is pinned', () => {
  test('the pinned lookup can only ever answer with what was vetted', () => {
    const lookup = pinnedLookup([{ address: '93.184.216.34', family: 4 }]);
    let seen = null;
    lookup('anything.at.all', {}, (error, address, family) => { seen = { error, address, family }; });
    assert.equal(seen.error, null);
    assert.equal(seen.address, '93.184.216.34');
    assert.equal(seen.family, 4);
  });

  test('it honours the `all` form, which is the one node actually calls', () => {
    const lookup = pinnedLookup([{ address: '93.184.216.34', family: 4 }]);
    let seen = null;
    lookup('anything', { all: true }, (error, answers) => { seen = answers; });
    assert.deepEqual(seen, [{ address: '93.184.216.34', family: 4 }]);
  });

  test('with nothing vetted it refuses rather than falling back to the system resolver', () => {
    let seen = null;
    pinnedLookup([])('anything', {}, (error) => { seen = error; });
    assert.ok(seen instanceof Error);
  });

  test('DNS REBINDING: a resolver that changes its mind cannot move the connection', async () => {
    // The test that separates this from a guard that merely checks. The stub answers PUBLIC the
    // first time — the check — and PRIVATE every time after, which is what a rebinding resolver
    // does. The connection must still land on the address that was vetted.
    const server = createServer((req, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"reached":"the vetted host"}'); });
    await new Promise((ready) => server.listen(0, '127.0.0.1', ready));
    const { port } = server.address();
    let calls = 0;
    const flipflop = async () => {
      calls += 1;
      // 127.0.0.1 is where the test server really is; the guard is handed it as the "public"
      // answer so the request can actually complete, and the second answer is the attack.
      return calls === 1 ? [{ address: '127.0.0.1', family: 4 }] : [{ address: '10.0.0.5', family: 4 }];
    };
    try {
      const response = await guardedFetch(`http://rebind.example.test:${port}/`, {}, { lookup: flipflop, isBlocked: () => false });
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { reached: 'the vetted host' });
      // ONE resolution. If the socket layer had been allowed to resolve again, `calls` would be
      // 2 and the second answer — 10.0.0.5 — is where the connection would have gone.
      assert.equal(calls, 1, 'the name was resolved a second time; the pin is not in force');
    } finally {
      await new Promise((done) => server.close(done));
    }
  });
});

describe('guardedFetch behaves like the fetch it replaces', () => {
  test('it carries method, headers and body, and reads the answer back', async () => {
    const seen = {};
    const server = createServer((req, res) => {
      seen.method = req.method;
      seen.header = req.headers['x-probe'];
      const chunks = [];
      req.on('data', (chunk) => chunks.push(chunk));
      req.on('end', () => {
        seen.body = Buffer.concat(chunks).toString('utf8');
        res.writeHead(201, { 'content-type': 'application/json' });
        res.end('{"ok":true}');
      });
    });
    await new Promise((ready) => server.listen(0, '127.0.0.1', ready));
    const { port } = server.address();
    try {
      const response = await guardedFetch(`http://public.example.test:${port}/x`, {
        method: 'POST', headers: { 'x-probe': 'yes', 'content-type': 'application/json' }, body: '{"a":1}',
      }, { lookup: async () => [{ address: '127.0.0.1', family: 4 }], isBlocked: () => false });
      assert.equal(response.status, 201);
      assert.equal(response.ok, true);
      assert.equal(response.headers.get('content-type'), 'application/json');
      assert.deepEqual(await response.json(), { ok: true });
      assert.deepEqual(seen, { method: 'POST', header: 'yes', body: '{"a":1}' });
    } finally {
      await new Promise((done) => server.close(done));
    }
  });

  test('a non-2xx answer is returned, not thrown — the caller decides', async () => {
    const server = createServer((req, res) => { res.writeHead(503); res.end('busy'); });
    await new Promise((ready) => server.listen(0, '127.0.0.1', ready));
    const { port } = server.address();
    try {
      const response = await guardedFetch(`http://public.example.test:${port}/`, {}, { lookup: async () => [{ address: '127.0.0.1', family: 4 }], isBlocked: () => false });
      assert.equal(response.ok, false);
      assert.equal(response.status, 503);
      assert.equal(await response.text(), 'busy');
    } finally {
      await new Promise((done) => server.close(done));
    }
  });

  test('an oversized answer is cut off rather than read into memory', async () => {
    const server = createServer((req, res) => { res.writeHead(200); res.end('x'.repeat(4096)); });
    await new Promise((ready) => server.listen(0, '127.0.0.1', ready));
    const { port } = server.address();
    try {
      await assert.rejects(() => guardedFetch(`http://public.example.test:${port}/`, {}, {
        lookup: async () => [{ address: '127.0.0.1', family: 4 }], maxBytes: 512,
      }));
    } finally {
      await new Promise((done) => server.close(done));
    }
  });

  test('the guard refuses before any connection is attempted', async () => {
    // Nothing is listening on this port. If the request were made and the address checked
    // afterwards, the error would be ECONNREFUSED; it is the refusal instead.
    await assert.rejects(
      () => guardedFetch('http://inward.example.test:1/', {}, {
        lookup: async () => [{ address: '10.0.0.5', family: 4 }],
      }),
      BlockedAddressError,
    );
  });
});

describe('the test seam cannot become the product', () => {
  // `isBlocked` is injectable so the transport tests above can talk to a loopback stub — the
  // codebase's usual shape (`fetchImpl`, `readFile`, `translate`). A seam in security code is
  // only acceptable if its DEFAULT is proved, because the failure it invites is silent: somebody
  // passes `() => false` in production and every test still passes.
  test('with no predicate supplied, loopback is still refused', async () => {
    await assert.rejects(
      () => resolvePublicAddresses('rebind.example.test', {
        lookup: async () => [{ address: '127.0.0.1', family: 4 }],
      }),
      BlockedAddressError,
      'the default predicate is not the strict one',
    );
    await assert.rejects(
      () => guardedFetch('http://rebind.example.test/', {}, {
        lookup: async () => [{ address: '10.0.0.5', family: 4 }],
      }),
      BlockedAddressError,
    );
  });

  test('the two callers do not pass a predicate of their own', () => {
    // The seam exists for tests. If a caller ever supplies one, this is where that shows up.
    for (const file of [
      'src/ai-workspace/tool-executor.mjs',
      'src/ai-workspace/provider-gateway.mjs',
    ]) {
      const source = readFileSync(new URL(file, import.meta.url.replace(/test\/[^/]+$/, '')), 'utf8');
      assert.ok(!/isBlocked/.test(source), `${file} passes its own address predicate`);
    }
  });
});
