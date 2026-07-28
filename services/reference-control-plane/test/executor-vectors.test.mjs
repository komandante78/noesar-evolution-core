// SPDX-License-Identifier: AGPL-3.0-or-later
// Runs conformance/executor-vectors.json through the Node executor. The Rust crate runs the
// same file (rust/crates/noesar-executor/tests/conformance.rs) — neither is the oracle for
// the other. execute() has real side effects (files, a signed token minter, a shadow), so
// unlike shadow's compare() a vector describes a scenario to build, not pure input/output.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { TokenMinter, authorizePlan } from '../src/capability.mjs';
import { ShadowWorkspace } from '../src/shadow.mjs';
import { execute } from '../src/executor.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const vectors = JSON.parse(readFileSync(resolve(root, 'conformance/executor-vectors.json'), 'utf8'));

const NOW = 1800000000;
const SECRET = Buffer.alloc(32, 7);

function authorized(files, destructive, extraFile = null) {
  const declared = extraFile ? [...files, extraFile] : files;
  const plan = {
    mode: 'safe', constraints: [],
    steps: [{ id: 'a', description: 's', files: declared, commands: [], dependsOn: [],
      blastRadius: { paths: declared, reachesOutsideWorkspace: false, destructive } }],
  };
  return authorizePlan(plan, {
    approverId: 'owner-001', grantedAtUnix: NOW, expiresAtUnix: NOW + 3600, scopeNote: 'test',
  }, NOW);
}

for (const vector of vectors.cases) {
  test(`executor ${vector.id} — ${vector.why}`, () => {
    const fileNames = Object.keys(vector.bench.files);
    const source = mkdtempSync(join(tmpdir(), 'noesar-execv-src-'));
    const shadowRoot = mkdtempSync(join(tmpdir(), 'noesar-execv-dst-'));
    try {
      for (const [name, contents] of Object.entries(vector.bench.files)) {
        writeFileSync(join(source, name), contents);
      }
      const plan = authorized(fileNames, vector.bench.destructive);
      const otherPlan = authorized(fileNames, vector.bench.destructive, 'extra.txt');
      const minter = new TokenMinter(SECRET);
      const shadow = vector.bench.shadowCoverage === 'DECLARED_PATHS_ONLY'
        ? new ShadowWorkspace(source, shadowRoot, vector.bench.declaredPaths)
        : ShadowWorkspace.ofWorkspace(source, shadowRoot);

      const tokens = vector.mints.map((mint) => minter.mint(
        mint.plan === 'other' ? otherPlan : plan,
        { stepId: 'a', paths: mint.paths, operations: mint.operations, uses: mint.uses,
          reason: 'test', expiresAtUnix: NOW + 600 },
        NOW,
      ));

      const actions = vector.actions.map((action) => (action.kind === 'EXECUTE'
        ? { kind: 'EXECUTE', command: action.command }
        : { kind: action.kind, path: action.path, contents: action.contents }));

      let report = null;
      let refusalKind = null;
      try {
        report = execute({
          authorized: plan, minter, tokens, shadow, actions,
          expectation: vector.expectation, nowUnix: NOW,
        });
      } catch (error) {
        refusalKind = error.kind ?? error.constructor.name;
      }

      const expected = vector.expected;
      if (expected.wholeCallRefused) {
        assert.ok(refusalKind, `${vector.id}: expected the whole call to be refused`);
        if (expected.errorKind) assert.equal(refusalKind, expected.errorKind);
      } else {
        assert.ok(report, `${vector.id}: expected a report, call was refused: ${refusalKind}`);
        assert.equal(report.performed, expected.performed, `${vector.id} performed`);
        assert.equal(report.refused, expected.refused, `${vector.id} refused`);
        assert.equal(report.ok, expected.ok, `${vector.id} ok: ${JSON.stringify(report)}`);
        if (expected.surpriseUnexpected) {
          assert.deepEqual(report.surprise?.unexpected, expected.surpriseUnexpected, `${vector.id} surprise.unexpected`);
        }
        if (expected.outcomeReason) {
          assert.ok(
            report.outcomes.some((outcome) => outcome.reason === expected.outcomeReason),
            `${vector.id}: no outcome carried the expected reason — got ${JSON.stringify(report.outcomes)}`,
          );
        }
      }

      for (const [name, contents] of Object.entries(expected.shadowFiles ?? {})) {
        assert.equal(readFileSync(join(shadow.root, name), 'utf8'), contents, `${vector.id} shadow file ${name}`);
      }
      for (const name of expected.shadowFilesAbsent ?? []) {
        assert.ok(!existsSync(join(shadow.root, name)), `${vector.id}: ${name} must be absent from the shadow`);
      }
      for (const [name, contents] of Object.entries(expected.sourceFiles ?? {})) {
        assert.equal(readFileSync(join(source, name), 'utf8'), contents, `${vector.id} source file ${name}`);
      }
    } finally {
      rmSync(source, { recursive: true, force: true });
      rmSync(shadowRoot, { recursive: true, force: true });
    }
  });
}

test('the executor vector file has not shrunk unnoticed', () => {
  assert.equal(vectors.cases.length, 10);
});
