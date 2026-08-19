// SPDX-License-Identifier: AGPL-3.0-or-later
//
// `CE-003` — *«Un effetto non dichiarato dallo strumento è impossibile, non vietato»*
// (`MASTER_PROJECT/15_CODEN_EVOLUTION_DA_ZERO.md` §11, severity **C**), verification method
// *«strumento sonda che tenta un effetto non dichiarato»*.
//
// # The distinction the criterion turns on, and why a refusal is not enough to satisfy it
//
// «vietato» is a **check**: the caller supplies an effect, something compares it against a list
// and says no. That is one forgotten call site away from being allowed.
// «impossibile» is a **shape**: there is no input channel through which an undeclared effect can
// be named at all, so no check can be forgotten because none is being relied on.
//
// So this file does not merely prove that the probe is refused. It proves **where the effect set
// comes from**: for every path by which a capability token can be obtained, the paths and
// operations that end up inside the token are read from a **declaration**, and the probe's own
// input is never consulted. A refusal is asserted too, for the one input the caller does control
// (`resource`, `operation`) — but the refusal is the weaker half and is labelled as such.
//
// # The closure, which is what makes "every path" a claim instead of a sample
//
// A capability token exists only if `TokenMinter#mint` was called. Every `.mint(` call site under
// `src/` is derived from the source at each run and must be one of the three declared paths
// below. A fourth appearing tomorrow fails this file rather than quietly widening the surface.
//
// # Declared width, measured this session, not rounded up
//
// `tool-catalog.mjs` exports `scopeRequestToTool()`, an intersection helper whose own module
// comment claims it is the mechanism of this criterion. **It has zero callers in the product**
// (measured below and pinned). That is not a hole in this verdict: it is unwired *and its
// surface mints nothing* — no route grants a catalog tool a token, and `toolCatalogStatus()`
// says so in the product's own words (`enforced: false`). The day a route does, the wiring must
// land with it, and the closure below is what will refuse to let it land silently.
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TokenMinter, CapabilityError } from '../src/capability.mjs';
import {
  AdapterGrantOrchestrator, AdapterCapabilityError, ADAPTER_MANIFESTS,
} from '../src/adapter-capability.mjs';
import { scopeRequestToTool, toolCatalogStatus, ActiveToolRegistry } from '../src/tool-catalog.mjs';
import { EventLedger } from '../src/events.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(HERE, '../src');

/**
 * A line with its trailing `//` comment removed, so a scan counts CODE and not PROSE.
 *
 * Found by running this file, not by foreseeing it: the caller count below came back `1`, and
 * the one hit was `skill-catalog.mjs:18` — a comment explaining what `scopeRequestToTool()` is
 * for. A closure that counts a sentence about a function as a call to it is a closure that will
 * one day hide a real call behind an "expected" one.
 *
 * Deliberately naive about `//` inside a string literal: over-counting is the fail-safe
 * direction for every scan in this file (it raises a false alarm; it never grants a false pass),
 * and a JavaScript parser in a test fixture is a second implementation of something this project
 * already has one of.
 */
const code = (line) => {
  const comment = line.indexOf('//');
  return comment === -1 ? line : line.slice(0, comment);
};
const NOW = 1_800_000_000;
const SECRET = Buffer.alloc(32, 11);

/**
 * The probe. A tool that declares one narrow effect and wants three others: to write a file it
 * never mentioned, to delete, and to execute. It is a plain object because that is all a caller
 * ever gets to be — the point of the criterion is that none of these fields reaches a token.
 */
const PROBE = Object.freeze({
  id: 'ce003-probe',
  name: 'CE-003 probe',
  declaredEffects: Object.freeze([
    Object.freeze({ operations: Object.freeze(['READ']), paths: Object.freeze(['declared/only.txt']) }),
  ]),
  wants: Object.freeze({
    paths: Object.freeze(['declared/only.txt', 'undeclared/secret.txt', '../../etc/passwd']),
    operations: Object.freeze(['READ', 'WRITE', 'DELETE', 'EXECUTE']),
  }),
});

function orchestrator() {
  const minter = new TokenMinter(SECRET);
  const events = new EventLedger();
  return { minter, events, grants: new AdapterGrantOrchestrator({ minter, events }) };
}

/** Every `.mint(` call site under `src/`, by file — the same technique `CE-002`'s closure uses. */
function mintSitesInSource() {
  const sites = new Map();
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) { walk(path); continue; }
      if (!entry.name.endsWith('.mjs')) continue;
      readFileSync(path, 'utf8').split('\n').forEach((line, index) => {
        const match = /([A-Za-z_$#][\w$#.]*)\.mint\(/.exec(code(line));
        if (!match) return;
        const file = relative(SRC, path);
        if (!sites.has(file)) sites.set(file, []);
        sites.get(file).push({ line: index + 1, receiver: match[1] });
      });
    }
  };
  walk(SRC);
  return sites;
}

/**
 * The three paths by which a capability token can be obtained, and where each one reads the
 * effect set FROM. That last column is the criterion.
 */
const MINT_PATHS = Object.freeze({
  'adapter-capability.mjs': 'ADAPTER_MANIFESTS[resource].resourcePaths[operation] — a frozen declaration in this repository; the caller supplies no path at all',
  'workspace-actions.mjs': 'the approved Plan\'s own step.files — and capability.mjs re-checks that every requested path is among them',
  'server.mjs': 'the caller\'s request, but only after authorizePlan() and against a step whose files capability.mjs refuses to exceed',
});

describe('CE-003 — an effect a tool never declared is impossible, not merely refused', () => {

  // ── 0 · the closure ───────────────────────────────────────────────────────────────────────
  test('CE-003 closure: every `.mint(` in src/ is one of the three declared token paths', () => {
    const sites = mintSitesInSource();
    const found = [...sites.keys()].sort();
    assert.deepEqual(found, Object.keys(MINT_PATHS).sort(),
      `a token can now be obtained from a path this file does not attack.\nfound: ${found.join(', ')}`);
    for (const [file, calls] of sites) {
      for (const call of calls) {
        assert.match(call.receiver, /minter/i,
          `${file}:${call.line} mints through \`${call.receiver}\` — if that is a capability engine this file is under-declared`);
      }
    }
  });

  // ── 1 · the probe, at the adapter grant path ──────────────────────────────────────────────
  //
  // This is the path a tool/adapter actually walks, and the strong half of the criterion.
  test('the probe cannot NAME an effect: `request()` accepts no path, so none of its wants is an input', () => {
    const fx = orchestrator();
    // Every field the probe controls is offered. `request()`'s signature has nowhere to put a
    // path — that absence IS the criterion, so it is asserted on the function, not inferred.
    const requested = fx.grants.request({
      resource: 'sector-modules', operation: 'WRITE', actor: 'ce003',
      // Deliberately passed, and deliberately ignored: a caller CAN send these today, and the
      // proof is that they change nothing about what comes out.
      paths: PROBE.wants.paths, files: PROBE.wants.paths, declaredEffects: PROBE.declaredEffects,
    });

    const step = requested.plan.steps[0];
    assert.deepEqual(step.files, [ADAPTER_MANIFESTS['sector-modules'].resourcePaths.WRITE],
      'the plan\'s file set must come from the manifest, not from anything the caller sent');
    for (const want of PROBE.wants.paths) {
      if (want === step.files[0]) continue;
      assert.ok(!step.files.includes(want), `the caller's path \`${want}\` reached the plan`);
    }
  });

  test('the probe cannot OBTAIN an undeclared effect: the minted token carries only the manifest\'s', () => {
    const fx = orchestrator();
    const requested = fx.grants.request({
      resource: 'sector-modules', operation: 'WRITE', actor: 'ce003', paths: PROBE.wants.paths,
    });
    const { token } = fx.grants.approve({ runId: requested.runId, approverId: 'owner-001', nowUnix: NOW });

    assert.deepEqual(token.paths, ['adapter://sector-modules/write']);
    assert.deepEqual(token.operations, ['WRITE']);
    // And the token is not merely narrow — it cannot be widened after the fact, because the
    // limits and the scope are inside the MAC. Spending it for what the probe wanted is refused.
    for (const operation of ['DELETE', 'EXECUTE', 'READ']) {
      assert.throws(
        () => fx.minter.spend(token, { path: 'adapter://sector-modules/write', operation }, NOW),
        (error) => error instanceof CapabilityError && /operation .* is not granted/.test(error.reason),
        `spending the grant as ${operation} was not refused`,
      );
    }
    assert.throws(
      () => fx.minter.spend(token, { path: 'undeclared/secret.txt', operation: 'WRITE' }, NOW),
      (error) => error instanceof CapabilityError && /is not granted by this token/.test(error.reason),
    );
  });

  // The weaker half, asserted because the criterion's own method asks for an attempt.
  test('the one input the probe does control — the operation — is refused against the manifest', () => {
    const fx = orchestrator();
    for (const operation of ['WRITE', 'DELETE', 'READ']) {
      assert.throws(
        () => fx.grants.request({ resource: 'local-model-runtime', operation, actor: 'ce003', nowUnix: NOW }),
        (error) => error instanceof AdapterCapabilityError && error.kind === 'OUT_OF_SCOPE',
        `local-model-runtime accepted \`${operation}\`, which its manifest does not list`,
      );
    }
    assert.throws(
      () => fx.grants.request({ resource: 'ce003-probe', operation: 'WRITE', actor: 'ce003', nowUnix: NOW }),
      (error) => error instanceof AdapterCapabilityError && error.kind === 'UNKNOWN_ADAPTER',
      'an adapter nobody registered must not be able to ask for anything',
    );
  });

  test('an adapter that declares NO operation can obtain nothing at all — the empty manifest is a real one', () => {
    const fx = orchestrator();
    for (const resource of ['hardware-probe', 'compliance-packs']) {
      assert.deepEqual(ADAPTER_MANIFESTS[resource].operations, [],
        `${resource} is expected to declare no privileged operation`);
      for (const operation of ['READ', 'WRITE', 'DELETE', 'EXECUTE']) {
        assert.throws(
          () => fx.grants.request({ resource, operation, actor: 'ce003', nowUnix: NOW }),
          (error) => error instanceof AdapterCapabilityError && error.kind === 'OUT_OF_SCOPE',
          `${resource} accepted \`${operation}\` against an empty manifest`,
        );
      }
    }
  });

  test('the closure over the manifests themselves: no declared operation lacks a declared path', () => {
    // The failure this catches is not hypothetical — a manifest that lists an operation with no
    // resourcePath would mint a token whose `files` is `[undefined]`, i.e. an effect nobody
    // declared, arriving through the declaration itself.
    for (const [resource, manifest] of Object.entries(ADAPTER_MANIFESTS)) {
      for (const operation of manifest.operations) {
        const path = manifest.resourcePaths[operation];
        assert.equal(typeof path, 'string',
          `${resource} declares \`${operation}\` but names no resource path for it`);
        assert.ok(path.startsWith('adapter://'), `${resource}.${operation} names \`${path}\`, which is not an adapter resource`);
      }
    }
  });

  // Negative control: the declared effect really is obtainable, or every test above passes for
  // the trivial reason that nothing works at all.
  test('negative control · the effect the manifest DOES declare is granted and spends once', () => {
    const fx = orchestrator();
    const requested = fx.grants.request({ resource: 'local-model-runtime', operation: 'EXECUTE', actor: 'ce003', nowUnix: NOW });
    const { token } = fx.grants.approve({ runId: requested.runId, approverId: 'owner-001', nowUnix: NOW });
    const spent = fx.minter.spend(token, { path: 'adapter://local-model-runtime/launch', operation: 'EXECUTE' }, NOW);
    assert.equal(spent.spent, true);
  });

  // ── 2 · the catalog helper: real, correct, and unwired — declared, not hidden ─────────────
  describe('the declared width: `scopeRequestToTool()` is the intersection, and nothing calls it', () => {
    test('it intersects rather than checks-then-rejects, which is the shape the criterion asks for', () => {
      const scoped = scopeRequestToTool(PROBE, [...PROBE.wants.paths], [...PROBE.wants.operations]);
      // What survives is the intersection with the declaration — not the request minus a denylist.
      assert.deepEqual(scoped.paths, ['declared/only.txt']);
      assert.deepEqual(scoped.operations, ['READ']);
      // And what did not survive is REPORTED, so a refusal is auditable rather than silent.
      assert.deepEqual(scoped.refusedPaths, ['undeclared/secret.txt', '../../etc/passwd']);
      assert.deepEqual(scoped.refusedOperations, ['WRITE', 'DELETE', 'EXECUTE']);
    });

    test('it has zero callers in the product, and the product says so in its own status', () => {
      let callers = 0;
      const walk = (dir) => {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
          const path = join(dir, entry.name);
          if (entry.isDirectory()) { walk(path); continue; }
          if (!entry.name.endsWith('.mjs')) continue;
          if (entry.name === 'tool-catalog.mjs') continue; // its own definition and comments
          for (const line of readFileSync(path, 'utf8').split('\n')) {
            if (/scopeRequestToTool\s*\(/.test(code(line))) callers += 1;
          }
        }
      };
      walk(SRC);
      assert.equal(callers, 0,
        'scopeRequestToTool() now has a caller: CE-003\'s verdict declares that it had none, so the '
        + 'wiring must be attacked by a probe here before that verdict can stand.');
      // The product's own declaration must agree with the measurement. Two places saying
      // different things about the same fact is the drift this project keeps paying for.
      const status = toolCatalogStatus(new ActiveToolRegistry());
      assert.equal(status.enforced, false);
      assert.match(status.undeclaredEffectPolicy, /impossible, not forbidden/);
    });

    test('and no catalog tool can obtain a token, which is why the gap is a gap and not a hole', () => {
      // The reason the unwired helper does not sink this criterion: a catalog tool is not a
      // registered adapter, so the only path to a token refuses it before any effect is discussed.
      const fx = orchestrator();
      assert.equal(ADAPTER_MANIFESTS[PROBE.id], undefined);
      assert.throws(
        () => fx.grants.request({ resource: PROBE.id, operation: 'READ', actor: 'ce003', nowUnix: NOW }),
        (error) => error instanceof AdapterCapabilityError && error.kind === 'UNKNOWN_ADAPTER',
      );
    });
  });
});
