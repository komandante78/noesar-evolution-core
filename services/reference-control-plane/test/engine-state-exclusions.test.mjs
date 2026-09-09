// SPDX-License-Identifier: AGPL-3.0-or-later
//
// `D-0347` — everything the engine writes into the workspace is hidden from the scanner.
//
// `D-0338` excluded `state/runs` and `state/engine-events.jsonl` because their absence had
// produced a visible symptom: two shells derived different file sets and disagreed. It
// stopped there, and the other five paths the engine writes into the same tree stayed
// readable for four sessions — including `state/auth.json` and the audit chain.
//
// A hand-kept list is exactly what let that happen, so this file does not keep one. It reads
// the source, finds every `join(workspace, '<literal>')` the engine performs, and requires
// each to be excluded. A path added beside the others fails here instead of quietly becoming
// readable to a search.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ENGINE_STATE_PATHS, DELIBERATELY_SCANNED_PATHS, resolveExclusions, buildRepositoryMap,
  literalSearch,
} from '../src/repo-map.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');

/**
 * Every `join(workspace, '<literal>')` in the engine's source.
 *
 * Read with `readFileSync` rather than a shell tool on purpose: in this environment `grep`
 * has been measured returning nothing for a file that plainly contains the text, and a guard
 * that silently matches zero files is a guard that passes for the wrong reason.
 */
function workspaceWrites() {
  const found = new Set();
  for (const name of readdirSync(srcDir)) {
    if (!name.endsWith('.mjs')) continue;
    // COMMENTS ARE STRIPPED FIRST, and this project has been bitten by not doing it: a
    // guard that scans source text reads the prose too, and the very comment in repo-map.mjs
    // that explains this derivation contains an example of the pattern it derives. The
    // first run of this file failed on a path called `<literal>`.
    const source = readFileSync(join(srcDir, name), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    for (const match of source.matchAll(/join\(\s*workspace\s*,\s*'([^']+)'(?:\s*,\s*'([^']+)')?\s*\)/g)) {
      found.add(match[2] ? `${match[1]}/${match[2]}` : match[1]);
    }
  }
  return [...found].sort();
}

/** The first path segment — what the two lists are keyed on. */
const topSegment = (path) => path.split('/')[0];

describe('the engine hides its own state from its own scanner', () => {
  test('the derivation finds something — a guard that matches nothing proves nothing', () => {
    const writes = workspaceWrites();
    assert.ok(writes.length >= 3, `expected several workspace writes, found ${writes.length}: ${writes.join(', ')}`);
  });

  test('every path the engine writes is either excluded or declared visible on purpose', () => {
    // The escape hatch is a DECLARATION, not silence: a new engine-written path fails here
    // until somebody says which of the two it is and why. That is the whole mechanism.
    // Matched on the FULL path against the exclusions — `state/` is excluded file by file
    // on purpose, so a match on its first segment would call a brand new `state/secrets.json`
    // covered when nothing covers it. The visible list is keyed by top segment, which is
    // what those entries actually are.
    for (const path of workspaceWrites()) {
      const hidden = ENGINE_STATE_PATHS.some((e) => path === e || path.startsWith(`${e}/`));
      // `state` is declared visible as a CONTAINER only — its own reason string in
      // `DELIBERATELY_SCANNED_PATHS` says every engine file inside it is excluded by name —
      // so that declaration must not be allowed to cover its children. Without this line the
      // guard read `state/research-reports.json` (written at `server.mjs:412`) as covered
      // while nothing covered it: the same hole this file exists to close, one level deeper.
      const container = topSegment(path);
      const declaredVisible = container in DELIBERATELY_SCANNED_PATHS
        && !(container === 'state' && path !== 'state');
      const byName = ['shadows', '.workspace'].includes(container);
      assert.ok(hidden || declaredVisible || byName,
        `the engine writes \`${path}\` into the workspace and neither list covers it — `
        + 'add it to ENGINE_STATE_PATHS (hidden) or DELIBERATELY_SCANNED_PATHS (visible, with the reason)');
    }
  });

  test('nothing is in both lists', () => {
    for (const path of ENGINE_STATE_PATHS) {
      assert.ok(!(path in DELIBERATELY_SCANNED_PATHS), `\`${path}\` cannot be both hidden and visible`);
    }
  });

  test('every deliberately visible path carries a real reason, not a placeholder', () => {
    for (const [path, reason] of Object.entries(DELIBERATELY_SCANNED_PATHS)) {
      assert.equal(typeof reason, 'string');
      assert.ok(reason.length > 30, `\`${path}\` needs a reason a reader can weigh, got: ${reason}`);
    }
  });

  test('the two paths D-0338 named are still covered', () => {
    // Regression on the original fix: completing a list must not undo it. Asserted as
    // COVERAGE and not as membership, because `state/runs` is now covered by excluding
    // `state` outright — a test that demanded the literal entry would be asserting the
    // shape of yesterday's fix rather than the property it was for.
    const covered = (path) => ENGINE_STATE_PATHS.some((e) => path === e || path.startsWith(`${e}/`));
    assert.ok(covered('state/runs'));
    assert.ok(covered('state/engine-events.jsonl'));
  });

  test('the authentication state and the audit chain are both covered', () => {
    // Named rather than left to the derivation, because these two are the reason the gap
    // mattered: a search that reaches them hands them to whoever asked.
    const covered = (path) => ENGINE_STATE_PATHS.some((e) => path === e || path.startsWith(`${e}/`));
    assert.ok(covered('state/auth.json'), 'the authentication state must be excluded');
    assert.ok(covered('audit/events.jsonl'), 'the audit chain must be excluded');
  });

  test('exclusions resolve to absolute paths under the scanned root', () => {
    const resolved = resolveExclusions('/some/root');
    assert.ok(resolved.has('/some/root/state/auth.json'));
    assert.ok(resolved.has('/some/root/audit'));
    assert.ok(resolved.has('/some/root/config'));
  });
});

describe('and the scanner really cannot see them', () => {
  // The exclusions above are a list. This drives the actual walk, because a list the walker
  // does not consult is the same defect one level up.
  test('a real scan returns the operator\'s files and none of the engine\'s', () => {
    const root = mkdtempSync(join(tmpdir(), 'noesar-exclusion-scan-'));
    try {
      writeFileSync(join(root, 'app.mjs'), 'export const a = 1;\n');
      mkdirSync(join(root, 'src', 'state'), { recursive: true });
      writeFileSync(join(root, 'src/state/reducer.mjs'), 'export const b = 2;\n');
      mkdirSync(join(root, 'state'), { recursive: true });
      writeFileSync(join(root, 'state/auth.json'), '{"secret":"CANARY_AUTH"}\n');
      mkdirSync(join(root, 'audit'), { recursive: true });
      writeFileSync(join(root, 'audit/events.jsonl'), '{"e":"CANARY_AUDIT"}\n');

      const map = buildRepositoryMap(root);
      const paths = JSON.stringify(map);

      assert.ok(paths.includes('app.mjs'), 'the operator\'s own files must still be scanned');
      // An operator's repository is allowed to contain a directory called `state`, and
      // `src/state/` must stay fully visible — the whole reason exclusion is by relative
      // path and not by bare name.
      assert.ok(paths.includes('reducer.mjs'), 'src/state/ must remain visible');
      assert.ok(!paths.includes('CANARY_AUTH'), 'the authentication state must not be scanned');
      assert.ok(!paths.includes('CANARY_AUDIT'), 'the audit chain must not be scanned');
      assert.ok(!/"path":"state\/auth\.json"/.test(paths), 'state/auth.json must not appear as a path');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('a copy of an excluded file is still the excluded file', () => {
  // `D-0347` derives the list from what the engine WRITES, which is exactly why it could not
  // see these: `state/auth.json.bak_pre_mfa_off_20260906T095916Z` was made by an operator
  // with `cp`, not by any `join(workspace, …)` in the source. Measured on 2026-09-09, both
  // readers of `literalSearch` handed that copy over — `GET /api/v1/repo-map/search?q=scrypt`
  // returned it to a session holding only `workspace.read`, and `groundRequest()` read it
  // whole into a plan, where `GET /api/v1/workspace-actions/:id` shows it to whoever can read
  // the run. `state/auth.json` beside it was hidden correctly the whole time: the list was
  // right, the matching was too literal.
  //
  // One oracle, not two: `buildRepositoryMap` reaches the tree through the same `walk` and
  // the same exclusions, so a second test there passes before the fix as well as after — a
  // test never seen failing proves nothing.
  const fixture = () => {
    const root = mkdtempSync(join(tmpdir(), 'noesar-exclusion-copy-'));
    mkdirSync(join(root, 'state'), { recursive: true });
    writeFileSync(join(root, 'state/auth.json'), '{"scheme":"scrypt","hash":"CANARY_LIVE"}\n');
    writeFileSync(join(root, 'state/auth.json.bak_pre_mfa_off_20260906T095916Z'), '{"scheme":"scrypt","hash":"CANARY_COPY"}\n');
    // The operator's own file, in the same directory and deliberately NOT matching: the rule
    // attaches to `<excluded file>.`, and hiding this one would be the opposite failure —
    // the one `DELIBERATELY_SCANNED_PATHS` and `durability.test.mjs` exist to prevent.
    writeFileSync(join(root, 'state/machine.mjs'), 'export const CANARY_OPERATOR = 1;\n');
    return root;
  };

  test('a search cannot reach the copy, and still reaches the operator\'s own file', () => {
    const root = fixture();
    try {
      assert.equal(literalSearch(root, 'CANARY_COPY').matches.length, 0,
        'a `.bak_` copy of state/auth.json carries the same credential material and must not be searchable');
      assert.equal(literalSearch(root, 'CANARY_LIVE').matches.length, 0,
        'state/auth.json itself must not be searchable');
      assert.ok(literalSearch(root, 'CANARY_OPERATOR').matches.length > 0,
        'the operator\'s own state/machine.mjs must stay searchable');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
