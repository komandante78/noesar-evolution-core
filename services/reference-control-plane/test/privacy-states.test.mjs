// SPDX-License-Identifier: AGPL-3.0-or-later
//
// WP-2 — the local-first privacy indicator, measured against `01_PRODUCT/12`.
//
// The specification is ten lines long and makes three separable claims:
//
//   1. seven named states,
//   2. an external state that discloses destination, service identity, data categories,
//      purpose, duration, retention information, consent scope and a revoke control,
//   3. telemetry off by default, and user content never in licence/update metadata.
//
// This file tests all three, and it tests them the way the feature-claims suite tests the
// bootstrap list: a named state with no producer is decoration, exactly as an advertised
// feature with no route is a false claim. The producer map lives HERE rather than beside
// the enum, so adding a state and asserting it works cannot be one edit.
//
// What this file deliberately does NOT assert: that the destination honours anything it
// is told. Retention at a third-party service is not observable from this host, and a
// disclosure that invented a number would be worse than one that says it cannot know.
import test, { describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { totpCode } from '../src/auth-crypto.mjs';
// Imported as a namespace on purpose. A missing export is one of the things being
// measured, and a named import would abort the whole file at load time, collapsing
// several independent claims into a single "the module did not load".
import * as privacyModule from '../src/privacy.mjs';

const { PrivacyState, evaluateEgress, privacyBanner } = privacyModule;
const derivePrivacy = (input) => {
  assert.equal(typeof privacyModule.derivePrivacy, 'function',
    'privacy.mjs exports no derivePrivacy — the indicator has no producer to test');
  return privacyModule.derivePrivacy(input);
};
const REQUIRED_DISCLOSURE_FIELDS = privacyModule.REQUIRED_DISCLOSURE_FIELDS ?? [];

const SETUP_TOKEN = 'test-only-setup-token-not-a-real-secret';
const PASSWORD = 'correct horse battery staple 42';

const workspace = mkdtempSync(join(tmpdir(), 'noesar-privacy-states-'));
process.env.NOESAR_WORKSPACE = workspace;
process.env.NOESAR_SETUP_TOKEN = SETUP_TOKEN;
process.env.NOESAR_LOG_LEVEL = 'ERROR';
process.env.NOESAR_DATA_PLANE = 'reference-json';

const { server, watchdog } = await import('../src/server.mjs');

const STEP_MS = 30_000;
const stepStart = (offset = 0) => (Math.floor(Date.now() / STEP_MS) + offset) * STEP_MS;

let base = null;
let cookie = null;
let csrf = null;

async function request(method, path, payload, extraHeaders = {}) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(cookie ? { cookie } : {}),
      ...(csrf ? { 'x-noesar-csrf': csrf } : {}),
      ...extraHeaders,
    },
    ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
  });
  const text = await response.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* non-JSON body */ }
  return { status: response.status, json, text };
}

const get = (path) => request('GET', path);
const post = (path, payload = {}) => request('POST', path, payload);

// The seven states `01_PRODUCT/12` names, verbatim and in the order it names them.
const SPECIFIED_STATES = Object.freeze([
  'LOCAL_ONLY_VERIFIED',
  'EXTERNAL_METADATA_ONLY',
  'EXTERNAL_CONNECTOR_PENDING',
  'EXTERNAL_CONNECTOR_ACTIVE',
  'REMOTE_MODEL_ACTIVE',
  'POLICY_VIOLATION_BLOCKED',
  'STATUS_UNKNOWN',
]);

// One producer per state: an input the real implementation turns into that state. A
// state no input can produce is a name in an enum, not a behaviour of the product.
const STATE_PRODUCERS = Object.freeze({
  STATUS_UNKNOWN: () => derivePrivacy({ observed: false }).state,
  LOCAL_ONLY_VERIFIED: () => derivePrivacy({ observed: true, providers: [], tools: [] }).state,
  EXTERNAL_METADATA_ONLY: () => derivePrivacy({
    observed: true, providers: [], tools: [], updateMetadataEgress: true,
  }).state,
  EXTERNAL_CONNECTOR_PENDING: () => derivePrivacy({
    observed: true,
    providers: [],
    tools: [{ id: 't1', name: 'Ticketing', external: true, endpoint: 'https://api.example.com/v1', disabled: false, consent: { granted: false } }],
  }).state,
  EXTERNAL_CONNECTOR_ACTIVE: () => derivePrivacy({
    observed: true,
    providers: [],
    tools: [{ id: 't1', name: 'Ticketing', external: true, endpoint: 'https://api.example.com/v1', disabled: false, consent: { granted: true, grantedAt: '2026-07-26T00:00:00.000Z', projectIds: [] } }],
  }).state,
  REMOTE_MODEL_ACTIVE: () => derivePrivacy({
    observed: true,
    providers: [{ id: 'p1', name: 'OpenAI', type: 'openai', external: true, enabled: true, baseUrl: 'https://api.openai.com/v1', consent: { granted: true, grantedAt: '2026-07-26T00:00:00.000Z', dataClasses: ['prompt'], projectIds: [] } }],
    tools: [],
  }).state,
  POLICY_VIOLATION_BLOCKED: () => derivePrivacy({
    observed: true, providers: [], tools: [], lastViolation: { reason: 'Unknown egress type', at: '2026-07-26T00:00:00.000Z' },
  }).state,
});

before(async () => {
  await new Promise((resolve_) => server.listen(0, '127.0.0.1', resolve_));
  base = `http://127.0.0.1:${server.address().port}`;

  const begun = await post('/api/v1/auth/setup', { username: 'owner', displayName: 'Owner', password: PASSWORD });
  // The setup token travels in a header, not the body.
  const begunReal = begun.status === 201 ? begun : await request('POST', '/api/v1/auth/setup',
    { username: 'owner', displayName: 'Owner', password: PASSWORD },
    { 'x-noesar-setup-token': SETUP_TOKEN });
  assert.equal(begunReal.status, 201, `setup failed: ${begunReal.text.slice(0, 200)}`);

  const response = await fetch(`${base}/api/v1/auth/setup/confirm`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      challenge: begunReal.json.challenge,
      totpCode: totpCode(begunReal.json.totpSecret, stepStart(-1)),
    }),
  });
  const confirmedText = await response.text();
  assert.equal(response.status, 201, `setup confirm failed: ${confirmedText.slice(0, 200)}`);
  const confirmed = JSON.parse(confirmedText);
  const session = (response.headers.getSetCookie?.() ?? []).find((entry) => entry.startsWith('noesar_session='));
  assert.ok(session, 'the bootstrap must issue a session cookie');
  cookie = session.split(';')[0];
  csrf = confirmed.csrfToken;
});

after(async () => {
  watchdog.stop();
  await new Promise((resolve_) => server.close(resolve_));
});

describe('01_PRODUCT/12 · the seven states exist and every one of them is reachable', () => {
  test('the implementation names exactly the seven specified states', () => {
    assert.deepEqual([...Object.keys(PrivacyState)].sort(), [...SPECIFIED_STATES].sort(),
      'the enum must name the seven states of 01_PRODUCT/12 — no more, no fewer');
  });

  test('every state has a producer defined in this test', () => {
    const unproduced = SPECIFIED_STATES.filter((state) => !(state in STATE_PRODUCERS));
    assert.deepEqual(unproduced, [], `no producer defined for: ${unproduced.join(', ')}`);
  });

  for (const state of SPECIFIED_STATES) {
    test(`"${state}" is produced by real input, not merely named`, () => {
      const produced = STATE_PRODUCERS[state]();
      assert.equal(produced, state,
        `"${state}" is specified but the implementation never produces it — it produced "${produced}"`);
    });
  }
});

describe('01_PRODUCT/12 · the indicator reports what is true, not what was asked about', () => {
  test('a refused egress plan does not leave the installation reporting an active external connection', async () => {
    const before_ = await get('/api/v1/privacy');
    assert.equal(before_.status, 200);

    const planned = await post('/api/v1/privacy/egress-plan', { kind: 'remote-model', data: ['prompt'] });
    assert.equal(planned.status, 200, planned.text.slice(0, 200));
    assert.equal(planned.json.allowed, false, 'the fixture assumes this plan is refused pending approval');

    const after_ = await get('/api/v1/privacy');
    assert.notEqual(after_.json.state, PrivacyState.REMOTE_MODEL_ACTIVE,
      'planning a remote-model call that was REFUSED left the indicator claiming a remote model is active — the indicator reports a question, not a fact');
    assert.equal(after_.json.state, before_.json.state,
      'evaluating a plan changed the reported privacy state of the whole installation');
  });

  test('the state a caller sees is derived from configuration, so a second caller sees the same thing', async () => {
    const first = await get('/api/v1/privacy');
    const second = await get('/api/v1/privacy');
    assert.equal(first.json.state, second.json.state);
    assert.ok(SPECIFIED_STATES.includes(first.json.state), `unknown state reported: ${first.json.state}`);
  });

  test('an unverified installation reports STATUS_UNKNOWN rather than asserting it verified itself', () => {
    const unobserved = derivePrivacy({ observed: false });
    assert.equal(unobserved.state, PrivacyState.STATUS_UNKNOWN);
    assert.equal(privacyBanner(unobserved.state).verified, false,
      'a banner may not report "verified" for a state that means the check has not run');
  });
});

describe('01_PRODUCT/12 · POLICY_VIOLATION_BLOCKED is reachable through the running server', () => {
  // The reachability tests above exercise `derivePrivacy`, a pure function. That is not
  // the same as the product being able to reach the state — the very gap the bootstrap
  // feature-claims suite exists to close. A blocked egress attempt is a real event, so
  // this drives one through the HTTP surface and asserts the indicator reports it.
  test('a blocked external send moves the indicator, and a refused plan still does not', async () => {
    const providers = await get('/api/v1/providers');
    const external = providers.json.providers.find((item) => item.external);
    assert.ok(external);

    // Enable it, but WITHOUT consent, then ask for a health probe. `probe()` runs through
    // the same `#assertAllowed` gate as a completion and then really does reach out, so a
    // refusal here is a stopped attempt rather than a question anyone asked.
    await request('PATCH', `/api/v1/providers/${external.id}`, { enabled: true });
    const attempt = await get(`/api/v1/providers/${external.id}/health`);
    // Asserting 403 specifically, not ">= 400": a 404 from a mistyped route would satisfy
    // the looser check while proving nothing, which is how the first version of this test
    // passed the attempt and still saw no violation.
    assert.equal(attempt.status, 403,
      `the fixture requires policy to refuse the send: ${attempt.text.slice(0, 160)}`);

    const privacy = await get('/api/v1/privacy');
    assert.equal(privacy.json.state, PrivacyState.POLICY_VIOLATION_BLOCKED,
      'a real blocked egress attempt must be visible in the indicator, not only in the ledger');
    assert.ok(privacy.json.violation?.reason, 'the blocked state must say what was refused');
    assert.ok(privacy.json.violation?.destination, 'the blocked state must name the destination it was refused for');

    // Clean up so the later suites see a settled installation.
    await post('/api/v1/privacy/revoke', {});
  });
});

describe('01_PRODUCT/12 · an external state discloses all eight required elements', () => {
  const REQUIRED = Object.freeze([
    'destination', 'serviceIdentity', 'dataCategories', 'purpose',
    'duration', 'retention', 'consentScope', 'revoke',
  ]);

  test('the implementation declares the same eight elements the specification names', () => {
    assert.deepEqual([...REQUIRED_DISCLOSURE_FIELDS].sort(), [...REQUIRED].sort());
  });

  test('an active remote model discloses every element', () => {
    const derived = derivePrivacy({
      observed: true,
      providers: [{ id: 'p1', name: 'OpenAI', type: 'openai', external: true, enabled: true, baseUrl: 'https://api.openai.com/v1', consent: { granted: true, grantedAt: '2026-07-26T00:00:00.000Z', dataClasses: ['prompt'], projectIds: ['proj-1'], allowTools: false, anonymize: true } }],
      tools: [],
      retentionDays: 365,
    });
    assert.equal(derived.state, PrivacyState.REMOTE_MODEL_ACTIVE);
    assert.equal(derived.disclosures.length, 1, 'one external destination, one disclosure');
    const [disclosure] = derived.disclosures;
    for (const field of REQUIRED) {
      assert.ok(disclosure[field] !== undefined && disclosure[field] !== null && disclosure[field] !== '',
        `the external disclosure is missing "${field}", which 01_PRODUCT/12 requires`);
    }
    assert.equal(disclosure.destination, 'api.openai.com');
    assert.deepEqual(disclosure.dataCategories, ['prompt']);
    assert.equal(disclosure.revoke.method, 'POST');
    assert.ok(String(disclosure.revoke.path).startsWith('/api/v1/privacy/'),
      'the revoke control must name a route on this product');
  });

  test('a local-only installation discloses nothing, because there is nothing to disclose', () => {
    const derived = derivePrivacy({ observed: true, providers: [], tools: [] });
    assert.equal(derived.state, PrivacyState.LOCAL_ONLY_VERIFIED);
    assert.deepEqual(derived.disclosures, []);
  });

  test('the seeded provider catalogue alone does not make an installation look external', () => {
    // Regression. ProviderGateway.seed() registers three external providers in every
    // workspace, disabled and unconsented. A first implementation of derivePrivacy counted
    // those as pending, so a fresh installation reported EXTERNAL_CONNECTOR_PENDING for
    // ever and could never say LOCAL_ONLY_VERIFIED — a permanent false alarm.
    const seeded = [
      { id: 'p1', name: 'Local OpenAI-compatible', type: 'local-openai-compatible', external: false, enabled: false, baseUrl: 'http://127.0.0.1:11434/v1', consent: { granted: false } },
      { id: 'p2', name: 'OpenAI', type: 'openai', external: true, enabled: false, baseUrl: 'https://api.openai.com/v1', consent: { granted: false } },
      { id: 'p3', name: 'Anthropic Claude', type: 'anthropic', external: true, enabled: false, baseUrl: 'https://api.anthropic.com/v1', consent: { granted: false } },
      { id: 'p4', name: 'Kimi / Moonshot AI', type: 'kimi', external: true, enabled: false, baseUrl: 'https://api.moonshot.cn/v1', consent: { granted: false } },
    ];
    const derived = derivePrivacy({ observed: true, providers: seeded, tools: [], retentionDays: 365 });
    assert.equal(derived.state, PrivacyState.LOCAL_ONLY_VERIFIED,
      'a catalogue entry nobody has enabled or consented to is a menu item, not a connection');
    assert.deepEqual(derived.disclosures, []);
  });

  test('a half-configured provider is pending — enabled without consent, or consented without being enabled', () => {
    const enabledOnly = derivePrivacy({ observed: true, tools: [], providers: [{ id: 'p2', name: 'OpenAI', type: 'openai', external: true, enabled: true, baseUrl: 'https://api.openai.com/v1', consent: { granted: false } }] });
    assert.equal(enabledOnly.state, PrivacyState.EXTERNAL_CONNECTOR_PENDING);
    const consentedOnly = derivePrivacy({ observed: true, tools: [], providers: [{ id: 'p2', name: 'OpenAI', type: 'openai', external: true, enabled: false, baseUrl: 'https://api.openai.com/v1', consent: { granted: true, grantedAt: '2026-07-26T00:00:00.000Z' } }] });
    assert.equal(consentedOnly.state, PrivacyState.EXTERNAL_CONNECTOR_PENDING);
  });

  test('retention at the destination is declared unknowable rather than invented', () => {
    const derived = derivePrivacy({
      observed: true,
      providers: [{ id: 'p1', name: 'OpenAI', type: 'openai', external: true, enabled: true, baseUrl: 'https://api.openai.com/v1', consent: { granted: true, grantedAt: '2026-07-26T00:00:00.000Z', dataClasses: ['prompt'], projectIds: [] } }],
      tools: [],
      retentionDays: 365,
    });
    const { retention } = derived.disclosures[0];
    assert.equal(retention.atDestination, 'UNKNOWN_AT_DESTINATION',
      'this product cannot observe what a third party retains; claiming a figure would be fabrication');
    assert.equal(retention.localRetentionDays, 365);
  });
});

describe('01_PRODUCT/12 · the revoke control actually revokes', () => {
  test('revoking returns the installation to a local-only state', async () => {
    const providers = await get('/api/v1/providers');
    assert.equal(providers.status, 200, providers.text.slice(0, 200));
    const external = providers.json.providers.find((item) => item.external);
    assert.ok(external, 'the default catalogue seeds at least one external provider');

    // Consent is a PUT on this API, and it must precede enabling: grantConsent(false)
    // force-disables the profile, so the reverse order would silently do nothing.
    const consented = await request('PUT', `/api/v1/providers/${external.id}/consent`, { granted: true, dataClasses: ['prompt'] });
    assert.equal(consented.status, 200, consented.text.slice(0, 200));
    const enabled = await request('PATCH', `/api/v1/providers/${external.id}`, { enabled: true });
    assert.equal(enabled.status, 200, enabled.text.slice(0, 200));

    const active = await get('/api/v1/privacy');
    assert.equal(active.json.state, PrivacyState.REMOTE_MODEL_ACTIVE,
      'an enabled, consented external provider is a remote model in use and the indicator must say so');
    assert.equal(active.json.disclosures.length, 1);

    const revoked = await post('/api/v1/privacy/revoke', {});
    assert.equal(revoked.status, 200, `the revoke control the disclosure advertises must exist: ${revoked.text.slice(0, 200)}`);

    const after_ = await get('/api/v1/privacy');
    assert.equal(after_.json.state, PrivacyState.LOCAL_ONLY_VERIFIED,
      'revoke was advertised in the disclosure but did not return the installation to local-only');
    assert.deepEqual(after_.json.disclosures, []);
  });
});

describe('01_PRODUCT/12 · the revoke control is not advertised to callers who cannot use it', () => {
  // Found by reading the role table, not by any scanner. `user`, `client_restricted` and
  // `service_account` all hold `user.read`, so they can read this indicator, but none of
  // them holds `provider.manage`, so the revoke route answers 403. Showing them a control
  // that refuses them is the same false claim, aimed at the reader instead of the operator.
  test('a caller without provider.manage is told the control is unavailable and why', () => {
    const derived = derivePrivacy({
      observed: true,
      canRevoke: false,
      tools: [],
      providers: [{ id: 'p1', name: 'OpenAI', type: 'openai', external: true, enabled: true, baseUrl: 'https://api.openai.com/v1', consent: { granted: true, grantedAt: '2026-07-26T00:00:00.000Z', dataClasses: ['prompt'], projectIds: [] } }],
    });
    const { revoke } = derived.disclosures[0];
    assert.equal(revoke.available, false);
    assert.equal(revoke.requires, 'provider.manage');
    assert.ok(revoke.unavailableReason, 'an unavailable control must say what is required instead of failing silently');
  });

  test('a caller with provider.manage is offered it', () => {
    const derived = derivePrivacy({
      observed: true,
      canRevoke: true,
      tools: [],
      providers: [{ id: 'p1', name: 'OpenAI', type: 'openai', external: true, enabled: true, baseUrl: 'https://api.openai.com/v1', consent: { granted: true, grantedAt: '2026-07-26T00:00:00.000Z', dataClasses: ['prompt'], projectIds: [] } }],
    });
    assert.equal(derived.disclosures[0].revoke.available, true);
    assert.equal(derived.disclosures[0].revoke.unavailableReason, undefined);
  });

  test('the route enforces the permission the disclosure names', async () => {
    // The advertised `requires` must be the permission actually checked, or the
    // disclosure is documentation of something else.
    const source = readFileSync(resolve(import.meta.dirname, '../src/server.mjs'), 'utf8');
    const route = source.slice(source.indexOf("'/api/v1/privacy/revoke'"));
    const guard = route.slice(0, 400);
    assert.ok(guard.includes("'provider.manage'"),
      'the revoke route must require the permission its own disclosure names');
  });
});

describe('01_PRODUCT/12 · telemetry is off by default, and says so', () => {
  test('the privacy answer declares the telemetry posture instead of leaving it to be assumed', async () => {
    const privacy = await get('/api/v1/privacy');
    assert.equal(privacy.json.telemetry?.enabled, false,
      'the specification requires telemetry off by default; an indicator that never mentions telemetry cannot show it');
  });

  test('no telemetry destination is configured anywhere in the first-party source', () => {
    // The declaration above is only as good as the absence it describes. This is the
    // enforcement: a future commit that adds a telemetry emitter fails here, rather than
    // silently making the declaration false.
    const root = resolve(import.meta.dirname, '../../..');
    const sources = [
      'services/reference-control-plane/src/server.mjs',
      'services/reference-control-plane/src/privacy.mjs',
      'services/reference-control-plane/src/update-manager.mjs',
      'apps/webui-static/app.js',
    ];
    for (const relative of sources) {
      const text = readFileSync(join(root, relative), 'utf8');
      assert.ok(!/telemetry\s*[:=]\s*(true|['"]on['"])/i.test(text),
        `${relative} enables telemetry, contradicting the declared posture`);
    }
  });
});

describe('01_PRODUCT/12 · user content is never in licence or update metadata', () => {
  test('the disclosed metadata fields are the ones the update path actually produces', async () => {
    const plan = await post('/api/v1/privacy/egress-plan', { kind: 'signed-update-metadata' });
    assert.equal(plan.status, 200);
    assert.equal(plan.json.state, PrivacyState.EXTERNAL_METADATA_ONLY);
    assert.ok(Array.isArray(plan.json.data) && plan.json.data.length > 0);
    // The list must come from the producer, not from a second hand-written copy beside it.
    const { updateCheckMetadata } = await import('../src/update-manager.mjs');
    assert.equal(typeof updateCheckMetadata, 'function',
      'privacy.mjs declares what update metadata contains; that claim must be derived from the module that would send it');
    const produced = updateCheckMetadata({ installedVersion: '1.0.0', channel: 'offline' });
    assert.deepEqual(Object.keys(produced).sort(), ['channel', 'platform', 'productVersion']);
  });

  test('user content offered to the metadata producer cannot reach the payload', async () => {
    const { updateCheckMetadata } = await import('../src/update-manager.mjs');
    const produced = updateCheckMetadata({
      installedVersion: '1.0.0',
      channel: 'offline',
      prompt: 'the secret contents of a private document',
      username: 'alessandro',
      documents: ['/projects/private/notes.md'],
    });
    const serialised = JSON.stringify(produced);
    for (const leak of ['secret contents', 'alessandro', 'notes.md']) {
      assert.ok(!serialised.includes(leak),
        `user content reached the update metadata payload: "${leak}" — 01_PRODUCT/12 forbids it`);
    }
  });
});

describe('the egress plan evaluator keeps its conformance behaviour', () => {
  // The four EGRESS vectors in conformance/authority-vectors.json are a published
  // contract. Deriving the indicator from configuration must not change what the plan
  // evaluator answers, so this asserts the two stayed separate.
  const vectors = JSON.parse(readFileSync(resolve(import.meta.dirname, '../../../conformance/authority-vectors.json'), 'utf8'));
  for (const vector of vectors.cases.filter((item) => item.type === 'egress')) {
    test(`${vector.id} still evaluates as published`, () => {
      const actual = evaluateEgress(vector.request);
      for (const [key, value] of Object.entries(vector.expected)) {
        assert.deepEqual(actual[key], value, `${vector.id}: ${key}`);
      }
    });
  }
});
