// SPDX-License-Identifier: AGPL-3.0-or-later
//
// `docs/MODEL_CATALOG_DESIGN.md` §8 — the six acceptance criteria, as tests.
//
// Owner, s333 point 5: «su `#/models` deve esserci un menu con i modelli e i modelli scaricati
// e installati devono sempre visualizzarsi per primi». The requirement was recorded in s318 and
// designed in s320; the design carried "nothing here is implemented" at the top and that stayed
// true for thirteen sessions. These tests are what makes the difference measurable rather than
// asserted.

import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  Lane, FOREGROUND_LANES, UNDECLARED, ModelCatalogError,
  declaredType, declaredFunctions, declaredDigest, verifyArtifact,
  laneOf, buildCatalog, groupingOf, acquisitionAvailability, planAcquisition, loadableModels,
} from '../src/model-catalog.mjs';

const DIGEST_A = 'a'.repeat(64);
const DIGEST_B = 'b'.repeat(64);

const model = (id, extra = {}) => ({
  id, version: '1', publisher: 'acme', license: 'apache-2.0',
  hashes: { sha256: DIGEST_A }, formats: ['gguf'], workloads: ['text', 'code'],
  resource_profiles: [], ...extra,
});

/** A registry stub with the shape `publisher-registry.mjs` actually returns from `status()`. */
const registryWith = (publishers) => ({ status: () => ({ publishers }) });
const LIVE_ACME = [{ publisherId: 'acme', keys: [{ fingerprint: 'f1' }] }];

describe('MC-003 — type and function are never inferred', () => {
  test('a declared workload is reported', () => {
    assert.equal(declaredType(model('m')), 'text');
    assert.deepEqual(declaredFunctions(model('m')), ['code']);
  });

  test('a strongly suggestive name with no declaration stays undeclared', () => {
    // The criterion names this case exactly. "coder", "vision" and "embed" in the id are the
    // shape of a guess that would render as a fact on a card.
    const suggestive = model('super-coder-vision-embed-70b', { workloads: [] });
    assert.equal(declaredType(suggestive), UNDECLARED);
    assert.deepEqual(declaredFunctions(suggestive), [UNDECLARED]);
  });

  test('a workload this product has no meaning for is undeclared, not corrected', () => {
    const odd = model('m', { workloads: ['telepathy'] });
    assert.equal(declaredType(odd), UNDECLARED, 'an unknown value must not be mapped onto the nearest known one');
  });

  test('undeclared is a visible category with a count, not a bin', () => {
    const grouping = groupingOf([model('a'), model('b', { workloads: [] })]);
    assert.equal(grouping.byType[UNDECLARED], 1);
    assert.equal(grouping.byType.text, 1);
  });

  test('a context window is reported only when declared', () => {
    const withWindow = buildCatalog({ descriptors: [model('m', { context: { window: 32768 } })] });
    const without = buildCatalog({ descriptors: [model('m')] });
    assert.equal(withWindow.available.items[0].contextWindow, 32768);
    assert.equal(without.available.items[0].contextWindow, null,
      'null says "not declared"; a number here would be a guess wearing the shape of a fact');
  });
});

describe('the Owner\'s requirement — what I have comes first, and never paginates', () => {
  const descriptors = [
    model('in-use'), model('local-1'), model('local-2'), model('broken'),
    ...Array.from({ length: 60 }, (_, i) => model(`remote-${String(i).padStart(3, '0')}`)),
  ];
  const present = new Map([
    ['local-1', { verified: true }], ['local-2', { verified: true }],
    ['broken', { verified: false }], ['in-use', { verified: true }],
  ]);

  test('the three foreground lanes come first, whole, in order', () => {
    const catalog = buildCatalog({ descriptors, present, activeModelId: 'in-use', pageSize: 10 });
    assert.deepEqual(catalog.foreground.map((entry) => entry.lane), FOREGROUND_LANES);
    assert.deepEqual(catalog.foreground[0].items.map((i) => i.id), ['in-use']);
    assert.deepEqual(catalog.foreground[1].items.map((i) => i.id), ['local-1', 'local-2']);
    assert.deepEqual(catalog.foreground[2].items.map((i) => i.id), ['broken']);
  });

  test('only the available lane paginates — "what do I have" never costs a search', () => {
    const catalog = buildCatalog({ descriptors, present, activeModelId: 'in-use', pageSize: 10 });
    assert.equal(catalog.available.items.length, 10);
    assert.equal(catalog.available.total, 60);
    assert.equal(catalog.available.pages, 6);
    // The property that matters: the page size governs `available` and NOTHING else. Driven
    // to the smallest page there is, because that is where a lane that silently obeys it would
    // show. (The first draft of this asserted `x.length === x.length`, which is true of every
    // value there has ever been — a green line that asserts nothing is worse than no line, and
    // it survived a passing run.)
    for (const size of [1, 2, 3]) {
      const narrow = buildCatalog({ descriptors, present, activeModelId: 'in-use', pageSize: size });
      assert.equal(narrow.available.items.length, size, 'available must obey the page size');
      assert.equal(narrow.foreground[0].items.length, 1, `page size ${size} cut the in-use lane`);
      assert.equal(narrow.foreground[1].items.length, 2, `page size ${size} cut the downloaded lane`);
      assert.equal(narrow.foreground[2].items.length, 1, `page size ${size} cut the unverified lane`);
    }
  });

  test('a page beyond the end clamps instead of showing an empty catalogue', () => {
    const catalog = buildCatalog({ descriptors, present, activeModelId: 'in-use', pageSize: 10, page: 99 });
    assert.equal(catalog.available.page, 6);
    assert.ok(catalog.available.items.length > 0);
  });
});

describe('MC-002 — the model in use is visible under every filter and every page', () => {
  const descriptors = [
    model('running', { workloads: ['vision'] }),
    ...Array.from({ length: 40 }, (_, i) => model(`text-${String(i).padStart(2, '0')}`)),
  ];
  const present = new Map([['running', { verified: true }]]);

  test('a filter that would exclude it keeps it, and says why', () => {
    // Enumerated rather than sampled: every filter this panel offers, with the active model
    // excluded by each one.
    const filters = [
      { type: 'text' }, { fn: 'code' }, { text: 'text-' }, { publisherId: 'other' },
    ];
    for (const filter of filters) {
      const catalog = buildCatalog({ descriptors, present, activeModelId: 'running', filter, pageSize: 5 });
      const inUse = catalog.foreground.find((entry) => entry.lane === Lane.IN_USE).items;
      assert.equal(inUse.length, 1, `filter ${JSON.stringify(filter)} hid the running model`);
      assert.equal(inUse[0].id, 'running');
      assert.equal(inUse[0].outsideFilter, true,
        'it must say it is outside the filter — otherwise the filter looks broken instead of overridden');
    }
  });

  test('it is not on a page, so no page can be turned past it', () => {
    for (const page of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const catalog = buildCatalog({ descriptors, present, activeModelId: 'running', pageSize: 5, page });
      assert.equal(catalog.foreground.find((e) => e.lane === Lane.IN_USE).items.length, 1,
        `page ${page} lost the running model`);
    }
  });

  test('a model that DOES match the filter is not falsely labelled as outside it', () => {
    const catalog = buildCatalog({ descriptors, present, activeModelId: 'running', filter: { type: 'vision' } });
    assert.equal(catalog.foreground.find((e) => e.lane === Lane.IN_USE).items[0].outsideFilter, false);
  });
});

describe('MC-004 — an artefact whose digest does not match is not startable', () => {
  test('a tampered download does not enter the downloaded lane', () => {
    const present = new Map([['m', { verified: false }]]);
    const catalog = buildCatalog({ descriptors: [model('m')], present });
    assert.equal(catalog.foreground.find((e) => e.lane === Lane.DOWNLOADED).items.length, 0);
    assert.equal(catalog.foreground.find((e) => e.lane === Lane.UNVERIFIED).items.length, 1,
      'present but unverified is its own lane — it is on disk, and it is not usable');
  });

  test('verification compares against what the publisher declared', () => {
    assert.equal(verifyArtifact({ expected: DIGEST_A, actualDigest: DIGEST_A }).verified, true);
    assert.equal(verifyArtifact({ expected: DIGEST_A, actualDigest: DIGEST_B }).verified, false);
    assert.equal(verifyArtifact({ expected: DIGEST_A.toUpperCase(), actualDigest: DIGEST_A }).verified, true,
      'upper-case hex from a publisher is not a tampered download');
  });

  test('bytes are hashed when no digest is supplied, so the check cannot be skipped by omission', () => {
    const bytes = Buffer.from('the artefact');
    const digest = verifyArtifact({ expected: DIGEST_A, actualBytes: bytes });
    assert.equal(digest.verified, false);
    assert.match(digest.digest, /^[0-9a-f]{64}$/);
  });

  test('no declared digest is a refusal, never a pass', () => {
    assert.equal(verifyArtifact({ expected: null, actualDigest: DIGEST_A }).verified, false,
      'nothing to compare against must not be read as nothing wrong');
  });
});

describe('MC-001 — no download from an unregistered origin, nor one revoked since', () => {
  const ok = { descriptor: model('m'), registry: registryWith(LIVE_ACME), runtime: { mode: 'auto' }, egressAllowed: true };

  test('the happy path is authorised, with the ceiling written into the grant', () => {
    const plan = planAcquisition({ ...ok, maxBytes: 8_000_000_000 });
    assert.equal(plan.allowed, true);
    assert.equal(plan.grant.expectedSha256, DIGEST_A);
    assert.equal(plan.grant.maxBytes, 8_000_000_000);
    assert.equal(plan.grant.operation, 'model.acquire');
  });

  test('an unregistered publisher is refused', () => {
    const plan = planAcquisition({ ...ok, registry: registryWith([]) });
    assert.equal(plan.allowed, false);
    assert.equal(plan.kind, 'PUBLISHER_NOT_REGISTERED');
  });

  test('revoked AFTER registration is refused — the criterion\'s exact case', () => {
    // The registry is consulted at download time and not cached upstream, precisely so that a
    // revocation applies to a download decided after it. A revocation that only affects future
    // registrations is not a revocation.
    const revoked = registryWith([{ publisherId: 'acme', keys: [{ fingerprint: 'f1', revokedAtUnix: 1 }] }]);
    const plan = planAcquisition({ ...ok, registry: revoked });
    assert.equal(plan.allowed, false);
    assert.equal(plan.kind, 'PUBLISHER_REVOKED');
  });

  test('one revoked key among live ones does not revoke the publisher', () => {
    const partly = registryWith([{ publisherId: 'acme', keys: [{ fingerprint: 'old', revokedAtUnix: 1 }, { fingerprint: 'new' }] }]);
    assert.equal(planAcquisition({ ...ok, registry: partly }).allowed, true);
  });

  test('egress consent comes first, and its absence is not overridden by a good publisher', () => {
    const plan = planAcquisition({ ...ok, egressAllowed: false });
    assert.equal(plan.allowed, false);
    assert.equal(plan.kind, 'EGRESS_NOT_CONSENTED');
  });

  test('a publisher who committed to no digest is refused before any byte moves', () => {
    const plan = planAcquisition({ ...ok, descriptor: model('m', { hashes: {} }) });
    assert.equal(plan.allowed, false);
    assert.equal(plan.kind, 'NO_DIGEST',
      'without a commitment there is nothing to verify against, and no care afterwards can supply one');
  });

  test('a disabled runtime refuses before the download, not after', () => {
    const plan = planAcquisition({ ...ok, runtime: { mode: 'disabled' } });
    assert.equal(plan.allowed, false);
    assert.equal(plan.kind, 'RUNTIME_DISABLED');
  });

  test('planning never mints authority for itself', () => {
    const plan = planAcquisition({ ...ok });
    assert.ok(!('token' in plan), 'a module that grants itself a capability is what ARCH-005 exists to prevent');
    assert.ok(plan.grant, 'it states the ceiling; the caller spends the token');
  });
});

describe('MC-006 — a disabled runtime is declared, never hidden', () => {
  test('the gesture is offered as OFF, with the reason', () => {
    const stored = acquisitionAvailability({ mode: 'disabled', overriddenByEnvironment: false });
    assert.equal(stored.offered, false);
    assert.match(stored.reason, /Settings/, 'a stopped button with its reason teaches where it starts');
  });

  test('the environment override says it is the environment', () => {
    const env = acquisitionAvailability({ mode: 'disabled', overriddenByEnvironment: true });
    assert.match(env.reason, /NOESAR_LOCAL_MODEL_RUNTIME/,
      'the operator must be told WHICH switch is off, or they will look in the wrong place');
  });

  test('the lanes are still drawn — a catalogue with the runtime off is still a catalogue', () => {
    const catalog = buildCatalog({ descriptors: [model('m')], runtime: { mode: 'disabled' } });
    assert.equal(catalog.acquisition.offered, false);
    assert.equal(catalog.available.total, 1, 'nothing was hidden to make the panel look tidy');
  });
});

describe('MC-005 — the catalogue at rest reaches no network', () => {
  test('building it touches no filesystem and no socket', () => {
    // Asserted structurally: this module imports `node:crypto` and nothing else. A dependency
    // on `node:fs`, `node:http` or `node:net` would be the way a request could appear here, so
    // the import list is the thing to hold, not a count taken at one moment.
    const source = readSource();
    for (const forbidden of ['node:fs', 'node:http', 'node:https', 'node:net', 'fetch(']) {
      assert.ok(!source.includes(forbidden),
        `model-catalog.mjs reaches for ${forbidden}; the catalogue is metadata and must stay so`);
    }
  });

  test('it declares the measurement rather than leaving it implied', () => {
    assert.equal(buildCatalog({ descriptors: [model('m')] }).networkRequestsAtRest, 0);
  });
});

describe('refusals are refusals, not empty results', () => {
  test('a bad page is refused by kind', () => {
    assert.throws(() => buildCatalog({ descriptors: [], page: 0 }), (error) => {
      assert.ok(error instanceof ModelCatalogError);
      assert.equal(error.kind, 'INVALID_PAGE');
      return true;
    });
  });

  test('a descriptor with no id is skipped rather than rendered as a blank card', () => {
    const catalog = buildCatalog({ descriptors: [{ version: '1' }, model('real')] });
    assert.deepEqual(catalog.available.items.map((i) => i.id), ['real']);
  });

  test('laneOf places an unknown model in available, never in a lane it is not in', () => {
    assert.equal(laneOf(model('x'), {}), Lane.AVAILABLE);
    assert.equal(laneOf(model('x'), { activeModelId: 'x' }), Lane.IN_USE);
  });

  test('a declared digest that is not a sha256 is treated as absent', () => {
    assert.equal(declaredDigest(model('m', { hashes: { sha256: 'not-a-digest' } })), null);
  });
});

// Owner, 2026-08-15: `/model` with no id used to demand an id and name none. What it answers
// now is this — and it must be the SAME catalogue `#/models` renders, never a second listing.
describe('loadableModels — what `/model` with no id can offer', () => {
  const catalogOf = (descriptors, present, activeModelId = null) =>
    buildCatalog({ descriptors, present: new Map(present), activeModelId });

  test('offers the model in use and the verified ones on disk, with their lane', () => {
    const catalog = catalogOf(
      [model('running'), model('ready')],
      [['running', { verified: true }], ['ready', { verified: true }]],
      'running',
    );
    assert.deepEqual(loadableModels(catalog), [
      { id: 'running', lane: Lane.IN_USE },
      { id: 'ready', lane: Lane.DOWNLOADED },
    ]);
  });

  // MC-004: nothing starts from `unverified`. Offering it would be offering a choice that
  // refuses the moment it is picked — the page still SHOWS it, with its reason, which is a
  // different job from this one.
  test('never offers an unverified artefact, which cannot be started', () => {
    const catalog = catalogOf([model('tampered')], [['tampered', { verified: false }]]);
    assert.equal(catalog.foreground.find((l) => l.lane === Lane.UNVERIFIED).items.length, 1,
      'the fixture must actually land in the unverified lane, or this proves nothing');
    assert.deepEqual(loadableModels(catalog), []);
  });

  // `available` is "what exists elsewhere", not "what I can load now" — and it is the one
  // paginated lane, so including it would also make the answer depend on the page.
  test('never offers the acquire-from-elsewhere lane', () => {
    const catalog = catalogOf([model('somewhere-else')], []);
    assert.equal(catalog.available.items.length, 1, 'the fixture must land in available');
    assert.deepEqual(loadableModels(catalog), []);
  });

  test('an installation with nothing present answers an empty list, not an error', () => {
    assert.deepEqual(loadableModels(catalogOf([], [])), []);
    assert.deepEqual(loadableModels(undefined), []);
  });
});

function readSource() {
  return readFileSync(new URL('../src/model-catalog.mjs', import.meta.url), 'utf8');
}
