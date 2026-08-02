// SPDX-License-Identifier: AGPL-3.0-or-later
//
// D-0292, the half that leaves this process. Two kinds of assertion here, and the second is
// the one that matters:
//
//   * the spec builder puts the Owner's per-target grants where `remote-api.pyz` expects
//     them, unchanged — a probe must be bound by what was ticked at registration;
//   * the credential goes to exactly ONE place and to nowhere else. That is asserted
//     against a real upstream that echoes what it actually received, not against a mock
//     that reports what it was told to report, for the same reason
//     module-console-proxy.test.mjs uses echoing upstreams: a test that trusts the thing
//     under test to describe itself proves nothing.

import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { buildProbeSpec, describeProbeSpec, PROBE_BUDGET } from '../src/api-target-probe.mjs';
import { probeApiTarget } from '../src/debug-evolution-bridge.mjs';

const SECRET = 'sk-live-do-not-leak-me-0123456789';

const TARGET = {
  id: 'target-1', name: 'billing', baseUrl: 'https://api.example.test/v1',
  protectedPath: '/account',
  allowPrivateTargets: true, allowMutation: false, allowIntrusive: false, allowBillable: false,
};

/** An upstream standing in for Debug Evolution that records the request it really got. */
async function echoingModule(status = 201, payload = { project: { id: 'p-1' }, finding_count: 2, steps: [], findings: [] }) {
  const received = [];
  const server = createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => {
      received.push({ method: req.method, url: req.url, headers: req.headers, body: raw });
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(payload));
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return { server, received, url: `http://127.0.0.1:${server.address().port}` };
}

describe('D-0292 — buildProbeSpec: the Owner s per-target decisions, passed through unchanged', () => {
  test('allow_remote_testing is forced on and the other four come from the target record', () => {
    const spec = buildProbeSpec(TARGET, {});
    assert.deepEqual(spec.authorization, {
      allow_remote_testing: true,
      allow_private_targets: true,
      allow_mutation: false,
      allow_intrusive: false,
      allow_billable_request: false,
    });
  });

  test('a grant absent from the record becomes false, never undefined — the toolpack reads a missing key as "not permitted" and so must this', () => {
    const spec = buildProbeSpec({ baseUrl: 'https://api.example.test/' }, {});
    for (const [key, value] of Object.entries(spec.authorization)) {
      if (key === 'allow_remote_testing') continue;
      assert.equal(value, false, `${key} must be exactly false`);
    }
  });

  test('the budget is the fixed observation budget, redirects included — a redirect must not carry the credential to an unlisted host', () => {
    assert.deepEqual(buildProbeSpec(TARGET, {}).budget, { ...PROBE_BUDGET });
    assert.equal(PROBE_BUDGET.max_redirects, 0);
  });

  test('a target with no base URL is refused rather than probed as an empty string', () => {
    assert.throws(() => buildProbeSpec({ name: 'nothing' }, {}), (error) => error.status === 400);
  });
});

describe('D-0292 — describeProbeSpec: the loggable shape', () => {
  test('it names the credential headers and carries none of their values', () => {
    const spec = buildProbeSpec(TARGET, { Authorization: `Bearer ${SECRET}` });
    const described = describeProbeSpec(spec);
    assert.deepEqual(described.credential_headers, ['Authorization']);
    assert.equal(JSON.stringify(described).includes(SECRET), false, 'the loggable shape must not contain the secret');
    assert.equal(described.base_url, TARGET.baseUrl);
  });
});

describe('D-0292 — probeApiTarget: where the credential actually goes', () => {
  test('the credential reaches Debug Evolution in the request BODY, and appears in no other part of the request', async () => {
    const upstream = await echoingModule();
    const previousUrl = process.env.NOESAR_DEBUG_EVOLUTION_URL;
    const previousToken = process.env.NOESAR_DEBUG_EVOLUTION_TOKEN;
    process.env.NOESAR_DEBUG_EVOLUTION_URL = upstream.url;
    process.env.NOESAR_DEBUG_EVOLUTION_TOKEN = 'module-service-token';
    try {
      const result = await probeApiTarget(TARGET, { Authorization: `Bearer ${SECRET}` });
      assert.equal(result.projectId, 'p-1');
      assert.equal(result.findingCount, 2);

      assert.equal(upstream.received.length, 1);
      const [request] = upstream.received;
      assert.equal(request.method, 'POST');
      assert.equal(request.url, '/api/v2/api-probe');
      // Where it must be: the body's `headers` field, which is what the module hands to the
      // toolpack over stdin.
      assert.equal(JSON.parse(request.body).headers.Authorization, `Bearer ${SECRET}`);
      // Where it must NOT be: the URL, or any header of the request itself. The module's own
      // service token is what authenticates this call — the target's credential is cargo.
      assert.equal(request.url.includes(SECRET), false);
      assert.equal(request.headers.authorization, 'Bearer module-service-token');
      assert.equal(JSON.stringify(request.headers).includes(SECRET), false,
        'the target credential must never ride in a header of the call to the module');
    } finally {
      upstream.server.close();
      if (previousUrl === undefined) delete process.env.NOESAR_DEBUG_EVOLUTION_URL; else process.env.NOESAR_DEBUG_EVOLUTION_URL = previousUrl;
      if (previousToken === undefined) delete process.env.NOESAR_DEBUG_EVOLUTION_TOKEN; else process.env.NOESAR_DEBUG_EVOLUTION_TOKEN = previousToken;
    }
  });

  test('a target with no credential sends an empty headers object — not a missing field the far end has to guess about', async () => {
    const upstream = await echoingModule();
    const previousUrl = process.env.NOESAR_DEBUG_EVOLUTION_URL;
    const previousToken = process.env.NOESAR_DEBUG_EVOLUTION_TOKEN;
    process.env.NOESAR_DEBUG_EVOLUTION_URL = upstream.url;
    process.env.NOESAR_DEBUG_EVOLUTION_TOKEN = 'module-service-token';
    try {
      await probeApiTarget(TARGET, {});
      assert.deepEqual(JSON.parse(upstream.received[0].body).headers, {});
    } finally {
      upstream.server.close();
      if (previousUrl === undefined) delete process.env.NOESAR_DEBUG_EVOLUTION_URL; else process.env.NOESAR_DEBUG_EVOLUTION_URL = previousUrl;
      if (previousToken === undefined) delete process.env.NOESAR_DEBUG_EVOLUTION_TOKEN; else process.env.NOESAR_DEBUG_EVOLUTION_TOKEN = previousToken;
    }
  });

  test('a failure from the module produces an error that carries the loggable spec and not the secret', async () => {
    const upstream = await echoingModule(502, { error: 'target host is not allowlisted' });
    const previousUrl = process.env.NOESAR_DEBUG_EVOLUTION_URL;
    const previousToken = process.env.NOESAR_DEBUG_EVOLUTION_TOKEN;
    process.env.NOESAR_DEBUG_EVOLUTION_URL = upstream.url;
    process.env.NOESAR_DEBUG_EVOLUTION_TOKEN = 'module-service-token';
    try {
      await assert.rejects(
        () => probeApiTarget(TARGET, { Authorization: `Bearer ${SECRET}` }),
        (error) => {
          assert.equal(error.status, 502);
          assert.equal(error.message.includes(SECRET), false, 'the error message must not contain the secret');
          assert.equal(JSON.stringify(error.probe).includes(SECRET), false, 'nor the attached spec description');
          assert.deepEqual(error.probe.credential_headers, ['Authorization']);
          return true;
        },
      );
    } finally {
      upstream.server.close();
      if (previousUrl === undefined) delete process.env.NOESAR_DEBUG_EVOLUTION_URL; else process.env.NOESAR_DEBUG_EVOLUTION_URL = previousUrl;
      if (previousToken === undefined) delete process.env.NOESAR_DEBUG_EVOLUTION_TOKEN; else process.env.NOESAR_DEBUG_EVOLUTION_TOKEN = previousToken;
    }
  });

  test('a deployment with no module service token refuses before any request is made', async () => {
    const upstream = await echoingModule();
    const previousUrl = process.env.NOESAR_DEBUG_EVOLUTION_URL;
    const previousToken = process.env.NOESAR_DEBUG_EVOLUTION_TOKEN;
    process.env.NOESAR_DEBUG_EVOLUTION_URL = upstream.url;
    delete process.env.NOESAR_DEBUG_EVOLUTION_TOKEN;
    try {
      await assert.rejects(() => probeApiTarget(TARGET, { Authorization: `Bearer ${SECRET}` }), (error) => error.status === 503);
      assert.equal(upstream.received.length, 0, 'nothing may have been sent');
    } finally {
      upstream.server.close();
      if (previousUrl === undefined) delete process.env.NOESAR_DEBUG_EVOLUTION_URL; else process.env.NOESAR_DEBUG_EVOLUTION_URL = previousUrl;
      if (previousToken === undefined) delete process.env.NOESAR_DEBUG_EVOLUTION_TOKEN; else process.env.NOESAR_DEBUG_EVOLUTION_TOKEN = previousToken;
    }
  });
});
