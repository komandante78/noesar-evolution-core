// SPDX-License-Identifier: AGPL-3.0-or-later
//
// `CE-002` — *«Un token esaurito, scaduto o revocato è rifiutato su **ogni** superficie»*
// (`MASTER_PROJECT/15_CODEN_EVOLUTION_DA_ZERO.md` §11, severity **C**), verification method
// *«test per superficie, più un tentativo per ciascuna»*.
//
// # The two halves, because only one of them is a test
//
// «rifiutato» is the easy half: `TokenMinter#spend` refuses all three states and always has.
// **«ogni superficie» is the half that can rot**, and no assertion in this repository held it:
// a sixth surface added tomorrow that spends a token would break the criterion without
// breaking a single test. So this file does two things, and the second is the point:
//
//   1. an ATTEMPT per surface per state — five surfaces × three states, executed, with the
//      byte-level or state-level proof that nothing happened;
//   2. a CLOSURE derived from the source at every run — every `.spend(` call site under
//      `src/` is either a declared capability surface covered below, or is on the declared
//      list of receivers that are not capability engines at all. A new one is a failure here.
//
// # Declared width, not rounded up
//
//   * The **Rust** engine (`rust/crates/noesar-capability`, `rust/crates/noesar-executor`) is a
//     second implementation of the same rule with its own `#[test]`s, run by `cargo test
//     --workspace --offline`. It is **not** covered by this file, which is JavaScript, and the
//     verdict says so rather than implying one suite proves both.
//   * The **revoked** state at the HTTP surface is reached through the branch revocation lands
//     in (`#issued` has no entry for this id) using a token this engine never issued, because
//     **no route revokes a token**: `TokenMinter#revoke` has zero product callers, measured by
//     the closure below. That is recorded as a finding, not smoothed over here.
import test, { describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TokenMinter, authorizePlan, CapabilityError } from '../src/capability.mjs';
import { ShadowWorkspace } from '../src/shadow.mjs';
import { execute } from '../src/executor.mjs';
import { WorkspaceActionOrchestrator } from '../src/workspace-actions.mjs';
import { EventLedger } from '../src/events.mjs';
import { LocalModelRuntime, RuntimeMode } from '../src/local-model-runtime.mjs';
import { AdapterGrantOrchestrator } from '../src/adapter-capability.mjs';
import { installSectorModule, SectorModuleError } from '../src/sector-modules.mjs';
import { freshTempDir } from './support/workspace.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * A line with its trailing `//` comment removed, so a scan counts CODE and not PROSE. Added
 * 2026-08-19 (`D-0573`) after `CE-003`’s twin closure counted a COMMENT mentioning
 * `scopeRequestToTool()` as a call to it. The same flaw was latent here: a comment writing
 * `minter.revoke(` would have raised a false alarm, and a comment writing `x.spend(` would have
 * put a file on the found list that spends nothing. Over-counting is fail-safe — it never grants
 * a false pass — but a false alarm costs a future session an investigation for nothing.
 */
const code = (line) => {
  const comment = line.indexOf("//");
  return comment === -1 ? line : line.slice(0, comment);
};
const SRC = resolve(HERE, '../src');
const REPO_ROOT = resolve(HERE, '../../..');
const NOW = 1_800_000_000;
const SECRET = Buffer.alloc(32, 7);

/** The three states the criterion names, as one list, so no surface below can quietly cover two. */
const STATES = Object.freeze(['exhausted', 'expired', 'revoked']);

/**
 * What `TokenMinter#spend` says for each state. Asserted rather than matched loosely: a refusal
 * whose reason drifts to something else is a different refusal, and «rifiutato» with an
 * unrelated reason is how a surface passes this suite while failing an operator.
 */
const REASON = Object.freeze({
  exhausted: 'the token is spent',
  expired: 'the token has expired',
  revoked: 'this engine did not issue that token',
});

/** Spends a token until the engine says it is spent. Returns the number of uses consumed. */
function exhaust(minter, token, attempt, nowUnix = NOW) {
  for (let spent = 0; spent < 64; spent += 1) {
    try {
      minter.spend(token, attempt, nowUnix);
    } catch (error) {
      assert.ok(error instanceof CapabilityError, `exhausting must end in a CapabilityError, got ${error}`);
      assert.match(error.reason, new RegExp(REASON.exhausted));
      return spent;
    }
  }
  assert.fail('a token with more than 64 uses is not a token this fixture models');
  return -1;
}

// ── the closure ─────────────────────────────────────────────────────────────────────────────

/**
 * Every `.spend(` call site under `src/`, by file. Derived at run time — the list below is what
 * this suite CLAIMS, and the scan is what the code SAYS. They are compared, in both directions.
 */
function spendSitesInSource() {
  const sites = new Map();
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) { walk(path); continue; }
      if (!entry.name.endsWith('.mjs')) continue;
      const lines = readFileSync(path, 'utf8').split('\n');
      lines.forEach((line, index) => {
        const match = /([A-Za-z_$#][\w$#.]*)\.spend\(/.exec(code(line));
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

/** The five product surfaces that spend a capability token, each with the test that attacks it. */
const CAPABILITY_SURFACES = Object.freeze([
  'executor.mjs',
  'workspace-actions.mjs',
  'local-model-runtime.mjs',
  'sector-modules.mjs',
  'server.mjs',
]);

/** `.spend(` sites that are not capability spends at all, named with what they are instead. */
const NOT_CAPABILITY_SPENDS = Object.freeze({
  'coden-bridge.mjs': 'a per-address rate budget (`budget.spend`), not a capability token',
});

describe('CE-002 — an exhausted, expired or revoked token is refused on every surface', () => {

  // ── 0 · the closure. Without this the five tests below are a sample, not a criterion ──────
  test('CE-002 closure: every `.spend(` in src/ is a declared capability surface or a declared non-capability', () => {
    const sites = spendSitesInSource();
    const found = [...sites.keys()].sort();
    const declared = [...CAPABILITY_SURFACES, ...Object.keys(NOT_CAPABILITY_SPENDS)].sort();

    assert.deepEqual(found, declared,
      `the set of files that spend something changed.\nfound:    ${found.join(', ')}\ndeclared: ${declared.join(', ')}\n`
      + 'A new capability surface must be attacked by this file before it is listed in it.');

    // And the discriminator itself is checked, not trusted: every site on a capability surface
    // is on a receiver named for the engine, and the one non-capability site is not.
    for (const file of CAPABILITY_SURFACES) {
      for (const site of sites.get(file)) {
        assert.match(site.receiver, /minter/i,
          `${file}:${site.line} spends through \`${site.receiver}\`, which is not named for the capability engine`);
      }
    }
    for (const file of Object.keys(NOT_CAPABILITY_SPENDS)) {
      for (const site of sites.get(file)) {
        assert.doesNotMatch(site.receiver, /minter/i,
          `${file}:${site.line} spends through \`${site.receiver}\` — if that is a capability engine this file is under-declared`);
      }
    }
  });

  test('CE-002 closure: `revoke()` exists and no product path calls it — the finding this suite refuses to hide', () => {
    let callers = 0;
    const walk = (dir) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) { walk(path); continue; }
        if (!entry.name.endsWith('.mjs')) continue;
        for (const line of readFileSync(path, 'utf8').split('\n')) {
          if (/minter\.revoke\(/i.test(code(line))) callers += 1;
        }
      }
    };
    walk(SRC);
    // Pinned at the measured value, not asserted to be zero forever: the day a route revokes a
    // token this must be re-read, and the verdict's declared width re-earned rather than
    // inherited. `TokenMinter#revoke` itself is still there and still works — proven below.
    assert.equal(callers, 0,
      'a product path now calls minter.revoke(): CE-002\'s verdict declares that none did, so the revoked '
      + 'state must now be attempted through that path rather than through the branch it shares.');
    assert.equal(typeof new TokenMinter(SECRET).revoke, 'function');
  });

  // ── 1 · executor.mjs · WRITE ─────────────────────────────────────────────────────────────
  describe('surface 1/5 · executor.mjs · the WRITE/READ/DELETE path', () => {
    function bench() {
      const source = freshTempDir('noesar-ce002-exec-src-');
      const shadowRoot = freshTempDir('noesar-ce002-exec-dst-');
      writeFileSync(join(source, 'a.txt'), 'before');
      const plan = {
        mode: 'safe', constraints: [],
        steps: [{
          id: 'a', description: 's', files: ['a.txt'], commands: [], dependsOn: [],
          blastRadius: { paths: ['a.txt'], reachesOutsideWorkspace: false, destructive: true },
        }],
      };
      const authorized = authorizePlan(plan, {
        approverId: 'owner-001', grantedAtUnix: NOW - 10, expiresAtUnix: NOW + 3600,
      }, NOW);
      return {
        source, authorized, minter: new TokenMinter(SECRET),
        shadow: ShadowWorkspace.ofWorkspace(source, shadowRoot),
      };
    }
    const ask = (operations, expiresAtUnix = NOW + 600, uses = 1) => ({
      stepId: 'a', paths: ['a.txt'], operations, reason: 'test', uses, expiresAtUnix,
    });

    for (const state of STATES) {
      test(`WRITE with a token that is ${state}: refused, and the shadow byte is untouched`, () => {
        const b = bench();
        // The mint instant is earlier than the attempt only for `expired`, which is what makes
        // that state reachable at all — a token minted and spent at one instant never lapses.
        const mintedAt = state === 'expired' ? NOW - 1_000 : NOW;
        const token = b.minter.mint(b.authorized, ask(['WRITE'], state === 'expired' ? NOW - 500 : NOW + 600), mintedAt);
        if (state === 'exhausted') exhaust(b.minter, token, { path: 'a.txt', operation: 'WRITE' }, mintedAt);
        if (state === 'revoked') assert.equal(b.minter.revoke(token.id), true);

        const report = execute({
          authorized: b.authorized, minter: b.minter, tokens: [token], shadow: b.shadow,
          actions: [{ kind: 'WRITE', path: 'a.txt', contents: 'after' }],
          expectation: { pathsTheDiffMustTouch: ['a.txt'], testsExpectedToPass: [], testsExpectedToFail: [] },
          nowUnix: NOW,
        });

        assert.equal(report.performed, 0, JSON.stringify(report.outcomes));
        assert.equal(report.outcomes[0].performed, false);
        assert.match(report.outcomes[0].reason, new RegExp(REASON[state]));
        // Not only the verdict: the bytes. Refused must mean nothing happened, in the shadow
        // (where the write would have landed) and in the source (where it must never land).
        assert.equal(readFileSync(join(b.shadow.root, 'a.txt'), 'utf8'), 'before');
        assert.equal(readFileSync(join(b.source, 'a.txt'), 'utf8'), 'before');
      });
    }

    // Negative control. A suite that refuses everything proves nothing about refusing these three.
    test('negative control · the same call with a healthy token performs the write', () => {
      const b = bench();
      const token = b.minter.mint(b.authorized, ask(['WRITE']), NOW);
      const report = execute({
        authorized: b.authorized, minter: b.minter, tokens: [token], shadow: b.shadow,
        actions: [{ kind: 'WRITE', path: 'a.txt', contents: 'after' }],
        expectation: { pathsTheDiffMustTouch: ['a.txt'], testsExpectedToPass: [], testsExpectedToFail: [] },
        nowUnix: NOW,
      });
      assert.equal(report.performed, 1, JSON.stringify(report.outcomes));
      assert.equal(readFileSync(join(b.shadow.root, 'a.txt'), 'utf8'), 'after');
      assert.equal(readFileSync(join(b.source, 'a.txt'), 'utf8'), 'before');
    });

    // ── 2 · executor.mjs · EXECUTE, the other spend site in the same file ──────────────────
    for (const state of STATES) {
      test(`EXECUTE with a token that is ${state}: refused before any process is started`, () => {
        const b = bench();
        const mintedAt = state === 'expired' ? NOW - 1_000 : NOW;
        const token = b.minter.mint(b.authorized, {
          ...ask(['EXECUTE'], state === 'expired' ? NOW - 500 : NOW + 600),
          limits: { memoryBytes: 64 * 1024 * 1024, cpuSeconds: 2, processes: 1 },
        }, mintedAt);
        if (state === 'exhausted') exhaust(b.minter, token, { path: 'a.txt', operation: 'EXECUTE' }, mintedAt);
        if (state === 'revoked') assert.equal(b.minter.revoke(token.id), true);

        const report = execute({
          authorized: b.authorized, minter: b.minter, tokens: [token], shadow: b.shadow,
          actions: [{ kind: 'EXECUTE', path: 'a.txt', command: '/bin/echo', args: ['ce-002'] }],
          expectation: { pathsTheDiffMustTouch: [], testsExpectedToPass: [], testsExpectedToFail: [] },
          nowUnix: NOW,
          // Enabled, so the EXECUTE branch reaches its token gate at all. The binary path is
          // deliberately absent: if the spend ever stopped refusing, this test would fail on a
          // missing sandbox binary rather than passing quietly — a refusal that cannot be
          // confused with a sandbox that was never there.
          executeSandbox: { enabled: true, binaryPath: join(REPO_ROOT, 'no-such-sandbox-binary') },
        });

        assert.equal(report.outcomes[0].performed, false);
        assert.match(report.outcomes[0].reason, new RegExp(REASON[state]),
          `EXECUTE was refused for the wrong reason: ${report.outcomes[0].reason}`);
      });
    }
  });

  // ── 3 · workspace-actions.mjs · #promote, the only path that mutates the real workspace ──
  describe('surface 2/5 · workspace-actions.mjs · the promotion that writes the workspace', () => {
    /**
     * A minter that delegates every call to a real `TokenMinter` and applies one state to the
     * token `approve()` mints, between the grant and the write. That is not a contrivance: it
     * is the real sequence — a grant is issued, then the write happens — with the interval
     * made observable. `expired` is produced by minting the CHANGE token at an earlier clock,
     * which is the only way a token can lapse inside a single call.
     */
    function stagedMinter(state) {
      const real = new TokenMinter(SECRET);
      let minted = 0;
      return {
        real,
        ceiling: () => real.ceiling(),
        outstanding: () => real.outstanding(),
        revoke: (id) => real.revoke(id),
        spend: (token, attempt, nowUnix) => real.spend(token, attempt, nowUnix),
        mint(authorized, request, nowUnix) {
          minted += 1;
          // The first mint is the MEASUREMENT token (`CE-008`); the shadow run must succeed or
          // there is nothing to promote. Only the second — the CHANGE token — is staged.
          if (minted === 1) return real.mint(authorized, request, nowUnix);
          if (state === 'expired') {
            const token = real.mint(authorized, { ...request, expiresAtUnix: nowUnix - 500 }, nowUnix - 1_000);
            return token;
          }
          const token = real.mint(authorized, request, nowUnix);
          if (state === 'exhausted') exhaust(real, token, { path: token.paths[0], operation: 'WRITE' }, nowUnix);
          if (state === 'revoked') assert.equal(real.revoke(token.id), true);
          return token;
        },
      };
    }

    for (const state of STATES) {
      test(`promotion with a token that is ${state}: the workspace keeps its original bytes`, async () => {
        const ws = freshTempDir('noesar-ce002-wa-ws-');
        const shadows = freshTempDir('noesar-ce002-wa-sh-');
        writeFileSync(join(ws, '.seed'), 'seed');
        writeFileSync(join(ws, 'a.txt'), 'original\n');
        const orch = new WorkspaceActionOrchestrator({
          workspaceRoot: ws, shadowsRoot: shadows,
          minter: stagedMinter(state), events: new EventLedger(), env: {},
        });

        const planned = await orch.plan({
          request: 'change a line', files: [{ path: 'a.txt', contents: 'changed\n' }],
          actor: 'owner-001', nowUnix: NOW,
        });
        const measured = orch.measure({ runId: planned.runId, actor: 'owner-001', nowUnix: NOW });
        assert.equal(measured.clean, true, 'the shadow run must be clean, or the promotion is skipped for another reason');

        assert.throws(
          () => orch.approve({ runId: planned.runId, approverId: 'owner-001', nowUnix: NOW }),
          (error) => error instanceof CapabilityError && new RegExp(REASON[state]).test(error.reason),
          `the promotion was not refused for being ${state}`,
        );
        // The criterion is about the bytes, not the exception.
        assert.equal(readFileSync(join(ws, 'a.txt'), 'utf8'), 'original\n');
      });
    }

    test('negative control · the same run promotes when the CHANGE token is healthy', async () => {
      const ws = freshTempDir('noesar-ce002-wa-ok-ws-');
      const shadows = freshTempDir('noesar-ce002-wa-ok-sh-');
      writeFileSync(join(ws, '.seed'), 'seed');
      writeFileSync(join(ws, 'a.txt'), 'original\n');
      const orch = new WorkspaceActionOrchestrator({
        workspaceRoot: ws, shadowsRoot: shadows,
        minter: new TokenMinter(SECRET), events: new EventLedger(), env: {},
      });
      const planned = await orch.plan({
        request: 'change a line', files: [{ path: 'a.txt', contents: 'changed\n' }],
        actor: 'owner-001', nowUnix: NOW,
      });
      orch.measure({ runId: planned.runId, actor: 'owner-001', nowUnix: NOW });
      const approved = orch.approve({ runId: planned.runId, approverId: 'owner-001', nowUnix: NOW });
      assert.equal(approved.promoted, true);
      assert.equal(readFileSync(join(ws, 'a.txt'), 'utf8'), 'changed\n');
    });
  });

  // ── 4 · local-model-runtime.mjs · launch(), the one call that starts an OS process ───────
  describe('surface 3/5 · local-model-runtime.mjs · launch()', () => {
    async function bench() {
      const workspace = freshTempDir('noesar-ce002-runtime-');
      const minter = new TokenMinter(SECRET);
      const grants = new AdapterGrantOrchestrator({ minter });
      const runtime = new LocalModelRuntime({ workspace, env: {}, minter });
      // Configured far enough that `launch()` reaches its token gate: a disabled runtime or a
      // runtime with no command refuses earlier, for a reason that is not CE-002's.
      await runtime.configure({
        mode: RuntimeMode.MANUAL, profileId: 'cpu', launchCommand: ['/bin/sleep', '60'],
      });
      return { minter, grants, runtime };
    }
    const ATTEMPT = Object.freeze({ path: 'adapter://local-model-runtime/launch', operation: 'EXECUTE' });

    for (const state of STATES) {
      test(`launch() with a token that is ${state}: refused 403, and nothing was launched`, async () => {
        const b = await bench();
        // `launch()` reads the real clock (it defaults `nowUnix` to `Date.now()`), so this
        // surface — unlike the four above — must be staged against the real clock too. A grant
        // issued at a fixed fictional instant would sit in the future and never lapse, which is
        // exactly how this test failed the first time it was run.
        const realNow = Math.floor(Date.now() / 1000);
        const grantAt = state === 'expired' ? realNow - 100_000 : realNow;
        const { runId } = b.grants.request({
          resource: 'local-model-runtime', operation: 'EXECUTE', actor: 'test-operator', nowUnix: grantAt,
        });
        const { token } = b.grants.approve({ runId, approverId: 'test-owner', nowUnix: grantAt });
        if (state === 'exhausted') exhaust(b.minter, token, ATTEMPT, grantAt);
        if (state === 'revoked') assert.equal(b.minter.revoke(token.id), true);

        await assert.rejects(
          () => b.runtime.launch({ capabilityToken: token }),
          (error) => error.status === 403 && new RegExp(REASON[state]).test(error.message),
          `launch() was not refused for being ${state}`,
        );
        // No process was started: the refusal precedes the spawn, so nothing needs reclaiming.
        assert.equal(b.runtime.status().launched ?? false, false);
      });
    }
  });

  // ── 5 · sector-modules.mjs · the adapter write token ─────────────────────────────────────
  describe('surface 4/5 · sector-modules.mjs · installSectorModule()', () => {
    const CANDIDATE = Object.freeze({
      id: 'ce002-probe', version: '0.1.0', publisher: 'ce002', trust_level: 'community',
      sector: ['other'], intended_use: ['probe'], excluded_use: [], evidence: [],
    });
    const ATTEMPT = Object.freeze({ path: 'adapter://sector-modules/write', operation: 'WRITE' });

    function plan() {
      return {
        mode: 'safe', constraints: [],
        steps: [{
          id: 'a', description: 'adapter write', files: [ATTEMPT.path], commands: [], dependsOn: [],
          blastRadius: { paths: [ATTEMPT.path], reachesOutsideWorkspace: false, destructive: false },
        }],
      };
    }

    for (const state of STATES) {
      test(`installSectorModule() with a token that is ${state}: refused, and nothing is written`, () => {
        const modulesRoot = freshTempDir('noesar-ce002-sector-');
        const minter = new TokenMinter(SECRET);
        const mintedAt = state === 'expired' ? NOW - 1_000 : NOW;
        const authorized = authorizePlan(plan(), {
          approverId: 'owner-001', grantedAtUnix: mintedAt - 10, expiresAtUnix: mintedAt + 3600,
        }, mintedAt);
        const token = minter.mint(authorized, {
          stepId: 'a', paths: [ATTEMPT.path], operations: ['WRITE'], uses: 1,
          expiresAtUnix: state === 'expired' ? mintedAt + 500 : NOW + 600,
        }, mintedAt);
        if (state === 'exhausted') exhaust(minter, token, ATTEMPT, mintedAt);
        if (state === 'revoked') assert.equal(minter.revoke(token.id), true);

        assert.throws(
          () => installSectorModule({
            productRoot: REPO_ROOT, sectorModulesRoot: modulesRoot, id: CANDIDATE.id,
            candidate: CANDIDATE, minter, capabilityToken: token, nowUnix: NOW,
          }),
          (error) => error instanceof SectorModuleError && error.kind === 'NOT_AUTHORIZED'
            && new RegExp(REASON[state]).test(error.reason),
          `the install was not refused for being ${state}`,
        );
        // The refusal precedes the write: no module directory exists afterwards.
        assert.equal(existsSync(join(modulesRoot, CANDIDATE.id)), false);
      });
    }

    test('negative control · the same install succeeds with a healthy token', () => {
      const modulesRoot = freshTempDir('noesar-ce002-sector-ok-');
      const minter = new TokenMinter(SECRET);
      const authorized = authorizePlan(plan(), {
        approverId: 'owner-001', grantedAtUnix: NOW - 10, expiresAtUnix: NOW + 3600,
      }, NOW);
      const token = minter.mint(authorized, {
        stepId: 'a', paths: [ATTEMPT.path], operations: ['WRITE'], uses: 1, expiresAtUnix: NOW + 600,
      }, NOW);
      const installed = installSectorModule({
        productRoot: REPO_ROOT, sectorModulesRoot: modulesRoot, id: CANDIDATE.id,
        candidate: CANDIDATE, minter, capabilityToken: token, nowUnix: NOW,
      });
      assert.equal(installed.id, CANDIDATE.id);
      assert.equal(existsSync(join(modulesRoot, CANDIDATE.id, 'manifest.json')), true);
    });
  });
});

// ── 6 · server.mjs · POST /api/v1/capability/spend, the surface a network reaches ──────────
//
// A real listener, a real owner session, a real CSRF token — the same harness
// `capability-http-adversarial.test.mjs` uses, because a surface tested through its module
// instead of its route is not the surface an attacker has.
const httpWorkspace = freshTempDir('noesar-ce002-http-');
process.env.NOESAR_WORKSPACE = httpWorkspace;
process.env.NOESAR_SETUP_TOKEN = 'test-only-setup-token-not-a-real-secret';
process.env.NOESAR_LOG_LEVEL = 'ERROR';
process.env.NOESAR_DATA_PLANE = 'reference-json';

const { server } = await import('../src/server.mjs');
const { totpCode } = await import('../src/auth-crypto.mjs');

const STEP_MS = 30_000;
let base = null;
let cookie = null;
let csrf = null;
let ownerId = null;

async function raw(path, { method = 'GET', payload, headers = {} } = {}) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });
  const text = await response.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* non-JSON body */ }
  return { status: response.status, json, text };
}
const authed = (path, opts = {}) =>
  raw(path, { ...opts, headers: { cookie, 'x-noesar-csrf': csrf, ...(opts.headers ?? {}) } });

describe('surface 5/5 · server.mjs · POST /api/v1/capability/spend', () => {
  before(async () => {
    await new Promise((done) => server.listen(0, '127.0.0.1', done));
    base = `http://127.0.0.1:${server.address().port}`;
    const begun = await raw('/api/v1/auth/setup', {
      method: 'POST',
      payload: { username: 'owner', displayName: 'Owner', password: 'correct horse battery staple 42' },
      headers: { 'x-noesar-setup-token': process.env.NOESAR_SETUP_TOKEN },
    });
    assert.equal(begun.status, 201, `setup failed: ${begun.text.slice(0, 200)}`);
    const response = await fetch(`${base}/api/v1/auth/setup/confirm`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        challenge: begun.json.challenge,
        totpCode: totpCode(begun.json.totpSecret, Math.floor(Date.now() / STEP_MS) * STEP_MS),
      }),
    });
    assert.equal(response.status, 201, 'setup confirm failed');
    const confirmed = await response.json();
    ownerId = confirmed.user.id;
    cookie = (response.headers.getSetCookie?.() ?? [])
      .find((entry) => entry.startsWith('noesar_session=')).split(';')[0];
    csrf = confirmed.csrfToken;
  });

  after(async () => { await new Promise((done) => server.close(done)); });

  /** A plan the server itself built, so the mint below is not attacking a strawman shape. */
  async function serverToken(path, { ttl = 900, uses = 1 } = {}) {
    const planned = await authed('/api/v1/workspace-actions/plan', {
      method: 'POST', payload: { request: 'ce-002 fixture', files: [{ path, contents: 'x' }] },
    });
    assert.equal(planned.status, 201, `fixture plan must succeed: ${planned.text.slice(0, 200)}`);
    const nowUnix = Math.floor(Date.now() / 1000);
    const plan = planned.json.plan;
    const approval = { approverId: ownerId, grantedAtUnix: nowUnix, expiresAtUnix: nowUnix + ttl };
    const minted = await authed('/api/v1/capability/mint', {
      method: 'POST',
      payload: {
        plan, approval,
        request: {
          stepId: plan.steps[0].id, paths: plan.steps[0].files, operations: ['WRITE'],
          uses, expiresAtUnix: approval.expiresAtUnix,
        },
      },
    });
    assert.equal(minted.status, 201, `legitimate mint must succeed: ${minted.text.slice(0, 200)}`);
    return { token: minted.json.token, attempt: { path: plan.steps[0].files[0], operation: 'WRITE' } };
  }

  test('exhausted · the use after the last one is refused, with the reason named', async () => {
    const { token, attempt } = await serverToken('ce002-http-exhausted.txt', { uses: 1 });
    const first = await authed('/api/v1/capability/spend', { method: 'POST', payload: { token, attempt } });
    assert.equal(first.status, 200, `the granted use must work: ${first.text.slice(0, 200)}`);
    assert.equal(first.json.usesRemaining, 0);

    const second = await authed('/api/v1/capability/spend', { method: 'POST', payload: { token, attempt } });
    assert.equal(second.status, 422, `an exhausted token must be refused: ${second.text.slice(0, 200)}`);
    assert.equal(second.json.error, 'capability_refused');
    assert.match(second.json.reason, new RegExp(REASON.exhausted));
  });

  test('expired · a token whose lifetime has passed is refused, with the reason named', async () => {
    // The shortest lifetime the mint route accepts, then waited out. The server reads its own
    // clock, so this cannot be simulated by passing a number — it is the one state on this
    // surface that costs real seconds, and it is the one that would otherwise go untested.
    const { token, attempt } = await serverToken('ce002-http-expired.txt', { ttl: 1 });
    await new Promise((done) => { setTimeout(done, 1_600); });
    const attemptResponse = await authed('/api/v1/capability/spend', { method: 'POST', payload: { token, attempt } });
    assert.equal(attemptResponse.status, 422, `an expired token must be refused: ${attemptResponse.text.slice(0, 200)}`);
    assert.match(attemptResponse.json.reason, new RegExp(REASON.expired));
  });

  test('revoked · a token this engine holds no grant for is refused, with the reason named', async () => {
    // No route revokes (see the closure test above), so the state is reached the way revocation
    // reaches it: `#issued` has no entry for this id. The token is minted by a DIFFERENT engine
    // with a different secret, so it also proves the MAC check fires before the lookup — the
    // refusal is `the token does not verify against this engine`, one gate earlier than the
    // in-process revocation branch, and strictly stronger.
    const { attempt } = await serverToken('ce002-http-revoked.txt');
    const foreign = new TokenMinter(Buffer.alloc(32, 9));
    const plan = {
      mode: 'safe', constraints: [],
      steps: [{
        id: 'a', description: 's', files: ['ce002-http-revoked.txt'], commands: [], dependsOn: [],
        blastRadius: { paths: ['ce002-http-revoked.txt'], reachesOutsideWorkspace: false, destructive: false },
      }],
    };
    const nowUnix = Math.floor(Date.now() / 1000);
    const authorized = authorizePlan(plan, {
      approverId: ownerId, grantedAtUnix: nowUnix, expiresAtUnix: nowUnix + 900,
    }, nowUnix);
    const token = foreign.mint(authorized, {
      stepId: 'a', paths: ['ce002-http-revoked.txt'], operations: ['WRITE'], uses: 1,
      expiresAtUnix: nowUnix + 900,
    }, nowUnix);
    assert.equal(foreign.revoke(token.id), true, 'the foreign engine must be able to revoke its own grant');

    const response = await authed('/api/v1/capability/spend', {
      method: 'POST', payload: { token, attempt: { ...attempt, path: 'ce002-http-revoked.txt' } },
    });
    assert.equal(response.status, 422, `a grant this engine does not hold must be refused: ${response.text.slice(0, 200)}`);
    assert.equal(response.json.error, 'capability_refused');
    assert.match(response.json.reason, /does not verify against this engine|did not issue that token/);
  });
});
