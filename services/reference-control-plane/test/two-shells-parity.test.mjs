// SPDX-License-Identifier: AGPL-3.0-or-later
//
// CE-021, the half a probe cannot prove by running: not "the two shells reached the same run
// this time", but "the two shells cannot come to offer, or gate, different things".
//
// tools/acceptance/ce-021-two-shells.mjs drives the live proof — start in one shell, kill it,
// finish from the other, both directions, plus a command whose shell dies mid-flight. What it
// measures is a moment. This file guards the shape.
//
// History worth keeping, because it is what these assertions are for: phase 5 (`D-0301`)
// measured that the HTTP bridge checked a permission per method and the unix socket checked
// none, and that the two shells nevertheless agreed — because every role that can authenticate
// holds `workspace.read` and `workspace.write`, the only two permissions the table named. They
// agreed by coincidence. `D-0302` replaced the coincidence with one table, enforced inside the
// dispatch, so the guarantee no longer depends on which transport remembered to check.

import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { RolePermissions, ROLES } from '../src/auth.mjs';
import { SESSION_METHOD_POLICY, bridgedMethodPermissions, createSessionDispatch } from '../src/session-protocol.mjs';

/**
 * The socket methods that cost `coden.plan` rather than the universal workspace permissions.
 *
 * A LIST, not a growing chain of `!==`: every entry must have an HTTP twin asking the same
 * permission, and the test below proves it for each. Adding one here without its route fails.
 */
const CODEN_PLAN_METHODS = ['coden.gitStatus', 'coden.divergence'];

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const protocolSource = readFileSync(join(root, 'src/session-protocol.mjs'), 'utf8');
const serverSource = readFileSync(join(root, 'src/server.mjs'), 'utf8');

/** The methods the dispatch actually implements: the keys of `createSessionDispatch`'s own
 *  `methods` object, read from the source that owns them rather than restated here. */
function implementedMethods() {
  const block = protocolSource.slice(protocolSource.indexOf('const methods = {'), protocolSource.indexOf('  /**\n   * `can(permission)'));
  assert.ok(block.length > 200, 'the dispatch table moved; this test cannot see it');
  return new Set([...block.matchAll(/^\s{4}'?([a-zA-Z.]+)'?:\s/gm)].map((match) => match[1]));
}

/** A dispatch with every dependency stubbed: this file is about the gate in front of the
 *  handlers, not the handlers. Each stub returns something recognisable so a method that runs
 *  when it should have been refused is visible rather than silently empty. */
function gatedDispatch(methodPolicy) {
  const ran = [];
  const mark = (name) => (...args) => { ran.push(name); return { ran: name, args }; };
  const dispatch = createSessionDispatch({
    ...(methodPolicy ? { methodPolicy } : {}),
    workspaceActions: { plan: mark('plan'), simulate: mark('simulate'), approve: mark('approve'), reject: mark('reject'), restore: mark('restore'), get: () => ({ runId: 'r' }) },
    buildRepositoryMap: mark('map'), literalSearch: mark('search'),
    resolveWorkspaceSubpath: (rootPath) => rootPath, workspaceRoot: '/tmp',
    engineEvents: { correlation: () => [] }, workspaceActionsStatus: () => ({}),
    getShadowSnapshot: () => ({}), capabilityStatus: () => ({}), capabilityMinter: {},
    contextGraph: { listSessions: mark('sessions.list'), getConversation: mark('sessions.get'), purgeSession: mark('purge') },
    ledger: { append: () => {} }, invariantEnforcement: [],
    codenAddressBook: () => [],
  });
  return { dispatch, ran };
}

describe('CE-021 — the two shells cannot drift apart unnoticed', () => {
  test('every method the dispatch implements has a declared permission policy', () => {
    // The fallback for "not listed" must be REFUSE, never ALLOW — and the way to keep that
    // true is for an unlisted method to be impossible rather than merely refused.
    for (const method of implementedMethods()) {
      assert.ok(SESSION_METHOD_POLICY[method], `\`${method}\` is implemented with no declared permission policy`);
    }
  });

  test('every declared policy names a method that exists', () => {
    // The other direction: an entry left behind after a method is removed is a rule nobody
    // enforces, and the next reader would take it for a live one.
    const implemented = implementedMethods();
    for (const method of Object.keys(SESSION_METHOD_POLICY)) {
      assert.ok(implemented.has(method), `the policy names \`${method}\`, which the dispatch does not implement`);
    }
  });

  test('the browser bridge derives its table from the same policy, and keeps no second copy', () => {
    assert.match(serverSource, /const TUI_METHOD_PERMISSION = bridgedMethodPermissions\(\);/,
      'server.mjs has gone back to writing out its own method/permission table');
    const bridged = bridgedMethodPermissions();
    assert.deepEqual(
      Object.keys(bridged).sort(),
      Object.entries(SESSION_METHOD_POLICY).filter(([, policy]) => policy.bridged).map(([method]) => method).sort(),
    );
    assert.ok(Object.keys(bridged).length >= 10, 'the bridged surface shrank unexpectedly');
  });

  test('what only the terminal carries is a declared list, and it is gated like its own routes', () => {
    // These are socket-only on purpose: the browser reaches each through a surface of its
    // own, so bridging them would add a second way in rather than a missing one. The
    // permission each one costs is what that surface's own route already asks — measured
    // against server.mjs above: GET /api/v1/sessions asks workspace.read, POST
    // /api/v1/sessions/actions asks workspace.write. A NEW socket-only method fails here until
    // someone decides which it is.
    const socketOnly = Object.entries(SESSION_METHOD_POLICY).filter(([, policy]) => !policy.bridged);
    assert.deepEqual(Object.fromEntries(socketOnly.map(([method, policy]) => [method, policy.permission])), {
      'sessions.list': 'workspace.read',
      'sessions.get': 'workspace.read',
      'sessions.action': 'workspace.write',
      'product.invariants': null,
      'coden.addresses': null,
      // The branch state the browser's own `git` chip already shows. Socket-only for the
      // same reason as the rest: the browser reaches it through `GET /api/v1/coden/git-status`,
      // so bridging it would add a second door onto one room.
      //
      // `coden.plan` is exactly what THAT route asks. Deliberately not `workspace.read`,
      // which reads like the natural permission for reading a repository and is the wrong
      // one here: every AI service account holds `workspace.read` and none holds
      // `coden.plan`, so the wider gate would let such an account read over this socket a
      // fact it cannot read over HTTP. That is the sideways widening `D-0302` closed, and a
      // status-line field is not worth re-opening it for.
      'coden.gitStatus': 'coden.plan',
      // Phase 3b. The seven bench list panels, socket-only for the same reason as the rest:
      // the browser fills all seven from `GET /api/v1/ai/bootstrap`, so bridging this would be
      // a second door onto one room. `workspace.read` is what that route already asks.
      'coden.benchLists': 'workspace.read',
      // The closure register. TWO entries rather than one, and that is the point: `GET
      // /api/v1/closures` asks `workspace.read` and `POST` asks `workspace.write`, so folding
      // them together would hand a reader the power to RECORD a closure over the socket that
      // the browser refuses them — precisely the sideways widening `D-0302` closed.
      'closure.list': 'workspace.read',
      'closure.record': 'workspace.write',
      // Phase 7, and this guard did exactly what it promises: a new socket-only method failed
      // here until somebody decided which it is. The decision, on the record.
      //
      // Socket-only for the reason all of these are: the browser reaches the same profiler
      // through `POST /api/v1/coden/divergence`, so bridging this would be a second door onto
      // one room. `coden.plan` because that is what the HTTP twin asks — NOT `workspace.read`,
      // which reads like the natural permission for reading a repository and is wrong here for
      // the same reason it is wrong for `coden.gitStatus`: every AI service account holds
      // `workspace.read` and none holds `coden.plan`, so the wider gate would let such an
      // account read over this socket what it cannot read over HTTP.
      'coden.divergence': 'coden.plan',
    });
  });

  test('the dispatch refuses a caller that lacks the permission — whichever shell it came from', async () => {
    const { dispatch, ran } = gatedDispatch();
    await assert.rejects(
      dispatch('workspace.plan', { request: 'x', files: [] }, 'someone', () => false),
      (error) => error.kind === 'FORBIDDEN' && /workspace\.write/.test(error.message),
    );
    await assert.rejects(
      dispatch('sessions.action', { action: 'purge', ids: ['1'] }, 'someone', () => false),
      (error) => error.kind === 'FORBIDDEN',
    );
    assert.deepEqual(ran, [], 'a refused method still reached its handler');
  });

  test('a transport that says nothing about the caller is refused, not trusted', async () => {
    // This is the exact shape the socket transport had until D-0302: it passed no authority
    // and the dispatch asked for none. An optional gate is one new transport away from being
    // no gate, so the missing argument fails closed.
    const { dispatch, ran } = gatedDispatch();
    await assert.rejects(
      dispatch('workspace.approve', { runId: 'r' }, 'someone'),
      (error) => error.kind === 'FORBIDDEN' && /did not say what the caller may do/.test(error.message),
    );
    assert.deepEqual(ran, []);
    // Session-only methods stay reachable without one: they ask for a session and nothing more.
    const invariants = await dispatch('product.invariants', {}, 'someone');
    assert.deepEqual(invariants, { invariants: [] });
  });

  test('a method with no policy entry is refused, not run under no permission', async () => {
    // The fail-closed branch that matters most, and the one the real configuration can never
    // reach — every implemented method is listed, so mutating this guard away left every test
    // green. Exercised here through the policy seam, with a caller that would be allowed
    // anything: what refuses it is the missing entry, nothing else.
    const { dispatch, ran } = gatedDispatch({});
    for (const method of ['workspace.approve', 'sessions.action', 'status']) {
      await assert.rejects(
        dispatch(method, {}, 'someone', () => true),
        (error) => error.kind === 'UNKNOWN_METHOD' && /no declared permission policy/.test(error.message),
        `\`${method}\` ran with no declared policy`,
      );
    }
    assert.deepEqual(ran, [], 'an unlisted method still reached its handler');
  });

  test('both transports pass the caller\'s authority into the dispatch', () => {
    assert.match(protocolSource, /dispatch\(method, params, authenticated\.user\.id,\s*\n?\s*\(permission\) => auth\.hasPermission\(authenticated\.user, permission\)\)/,
      'the unix socket transport no longer tells the dispatch what the caller may do');
    assert.match(serverSource, /sessionDispatch\(method, payload\?\.params, authenticated\.user\.id,\s*\n?\s*\(permission\) => auth\.hasPermission\(authenticated\.user, permission\)\)/,
      'the HTTP bridge no longer tells the dispatch what the caller may do');
  });

  test('the socket transport still refuses everything before authentication', () => {
    // The gate in front of the gate. If this line goes, the permission model above starts
    // applying to whoever can reach the socket file rather than to whoever signed in.
    assert.match(protocolSource, /if \(!authenticated\) throw new ProtocolError\('UNAUTHENTICATED'/);
  });

  test('the shell’s universal core is reachable by every role that can authenticate', () => {
    // Not a rule — a measurement, kept because it is the thing that made the old gap
    // invisible: the WORK of this shell (plan, simulate, approve, reject, restore, get, map,
    // search, events, status, sessions) costs `workspace.read`/`workspace.write`, and every
    // role that can authenticate holds both. The D-0302 enforcement refuses nobody there.
    //
    // "Every method" is deliberately NOT what this asserts any more, and the difference was a
    // decision, not an accident. `coden.gitStatus` costs `coden.plan`, which the three AI
    // service-account roles do not hold — and must not, since they cannot read that fact over
    // HTTP either. Nothing was narrowed and no role lost a capability it had: the method is
    // new, and it arrived at the gate its own HTTP route already stands behind. Widening it to
    // `workspace.read` to keep this list at two entries would have made the socket more
    // permissive than the browser for the same fact, which is the exact asymmetry D-0302 shut.
    //
    // Phase 7 makes it two: `coden.divergence` arrived at the same gate, for the same reason,
    // and is excluded the same way. The exclusion is a NAMED LIST rather than a growing chain
    // of `!==`, so adding a third forces the next test to prove its HTTP route agrees.
    const universal = new Set(Object.entries(SESSION_METHOD_POLICY)
      .filter(([method]) => !CODEN_PLAN_METHODS.includes(method))
      .map(([, policy]) => policy.permission).filter(Boolean));
    assert.deepEqual([...universal].sort(), ['workspace.read', 'workspace.write']);
    for (const role of ROLES) {
      for (const permission of universal) {
        assert.ok(RolePermissions[role]?.has(permission), `role \`${role}\` no longer holds \`${permission}\``);
      }
    }
  });

  test('every non-universal method is gated exactly as its own HTTP route is', () => {
    // The claim the comment above rests on, measured rather than asserted: each socket method
    // that costs `coden.plan` has an HTTP twin asking the same permission. If someone changes
    // one side, this fails and the two transports stop agreeing about who may read the
    // repository — which is the whole failure mode `D-0302` closed.
    for (const method of CODEN_PLAN_METHODS) {
      assert.equal(SESSION_METHOD_POLICY[method]?.permission, 'coden.plan',
        `\`${method}\` is listed as a coden.plan method and its policy says otherwise`);
    }
    // Scoped to the route's own BLOCK, not to the line that happens to follow the brace. The
    // first version of this asserted adjacency and broke the moment a comment was written
    // above the guard — an assertion that fails on a comment is one that will be loosened by
    // whoever hits it next, and a loosened guard is worse than an honest one.
    const routeGuard = (pathname) => {
      const start = serverSource.indexOf(`url.pathname === '${pathname}'`);
      assert.ok(start > -1, `there is no HTTP route for ${pathname}`);
      // Up to the next route, so a `requireSession` belonging to a LATER route cannot satisfy
      // this one — the way an over-wide window would quietly let an unguarded route pass.
      const next = serverSource.indexOf('url.pathname ===', start + 20);
      return serverSource.slice(start, next > -1 ? next : start + 2000);
    };
    for (const [method, pathname] of [
      ['coden.gitStatus', '/api/v1/coden/git-status'],
      ['coden.divergence', '/api/v1/coden/divergence'],
    ]) {
      assert.match(routeGuard(pathname), /requireSession\(req, res, 'coden\.plan'\)/,
        `the HTTP twin of \`${method}\` (${pathname}) no longer asks for coden.plan`);
    }

    // And the roles it therefore excludes are named, so the exclusion is visible rather than
    // discovered later by someone whose terminal reports `remote —` for no stated reason.
    const excluded = ROLES.filter((role) => !RolePermissions[role]?.has('coden.plan'));
    assert.deepEqual(excluded.sort(), ['client_restricted', 'service_account', 'user']);
  });

  // ── Phase 1 of `MASTER_PROJECT/17_CODEN_EVOLUTION_PIANO_DI_LAVORO.md` ──────────────────
  //
  // The defect this guards was not a missing feature: it was ONE SHELL WIRED OF TWO, with
  // nothing comparing them. `D-0303` made `files` optional on `workspace.plan` — an empty list
  // is a request to look, and the repository chooses. `apps/webui-static/` and
  // `tools/tui-fullscreen.mjs` were updated; the line shell in `tools/tui-client.mjs` was not,
  // and refused CLIENT-SIDE with a sentence the engine had outgrown. It never reached the
  // engine, so no engine test could have seen it.
  //
  // The line shell is not a corner: `tools/acceptance/ce-021-two-shells.mjs` drives this
  // client with piped stdin, which is exactly the branch that was broken.
  describe('prose reaches the engine from every shell (phase 1)', () => {
    const toolsRoot = join(root, '../../tools');
    const tuiClientSource = readFileSync(join(toolsRoot, 'tui-client.mjs'), 'utf8');
    const tuiFullscreenSource = readFileSync(join(toolsRoot, 'tui-fullscreen.mjs'), 'utf8');
    const appSource = readFileSync(join(root, '../../apps/webui-static/app.js'), 'utf8');

    test('no shell refuses a plan locally for naming no file', () => {
      // The exact sentence, and the shape of any successor: a shell that decides on its own
      // that a fileless request cannot be planned is deciding something that belongs to the
      // engine, and it will be wrong the next time the engine changes.
      for (const [name, source] of [
        ['tools/tui-client.mjs', tuiClientSource],
        ['tools/tui-fullscreen.mjs', tuiFullscreenSource],
        ['apps/webui-static/app.js', appSource],
      ]) {
        assert.ok(!/console\.log\('No files named/.test(source),
          `${name} still refuses to plan when no file is named`);
      }
    });

    test('the line shell passes the typed prose through instead of dropping it', () => {
      // `case 'plan': await runPlanFlow(reader, session);` dropped `arg` on the floor, which is
      // why the verb could only ever start an interrogation. One argument, and the whole gesture.
      assert.match(tuiClientSource, /case 'plan': await runPlanFlow\(reader, session, arg\)/,
        'the line shell no longer forwards the typed request to the plan flow');
      assert.match(tuiClientSource, /session\.call\('workspace\.plan', \{ request: goal, files \}\)/,
        'the line shell no longer sends the goal with its (possibly empty) file list');
    });

    test('the shared model sends an empty file list with the prose, for every shell', () => {
      // The full-screen shell has done this since s319 and was the only shell that did. Phase 2
      // moved the rule into `coden-view-model.js`, so the check follows it: asserting here on
      // `tui-fullscreen.mjs` would now pass for the wrong reason — by finding nothing — which
      // is how a guard becomes decoration.
      const model = readFileSync(join(root, '../../apps/webui-static/coden-view-model.js'), 'utf8');
      assert.match(model, /\['workspace\.plan', \{ request: argument, files: \[\] \}\]/,
        'the shared model no longer sends an empty file list with the prose');
      assert.ok(!/const RUN = \{/.test(tuiFullscreenSource),
        'the full-screen shell has grown a second command→call map');
    });

    test('a derived file list is shown as derived, never as a choice someone made', () => {
      // `grounding` exists so a shell cannot pass off the engine's search as a human's
      // decision — the two deserve different scrutiny. A shell printing the paths without the
      // provenance invites approval under a false premise.
      assert.match(tuiClientSource, /planned\.grounding/,
        'the line shell prints a file list without saying who chose it');
      assert.match(tuiClientSource, /goalRelatedToRequest === false/,
        'the line shell no longer surfaces a goal unrelated to the request');
    });
  });
});
