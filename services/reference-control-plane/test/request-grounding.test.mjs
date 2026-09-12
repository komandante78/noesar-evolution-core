// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The step between a sentence and a Plan.
//
// The adversarial half is the point. `workspace-actions.mjs` used to refuse every plan whose
// caller named no files, and its refusal said why: a model must not invent a file target out
// of prose. Removing that refusal is only safe if the property survives it, so most of this
// file is about the property rather than about the feature: candidates come from the
// repository, paths are checked before they are read, and a search result that tries to point
// outside the workspace is dropped rather than trusted for having come from a trusted module.
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { groundRequest, searchTermsOf, GroundingRefused, rankingWeight, PROSE_WEIGHT } from '../src/request-grounding.mjs';
import { literalSearch, literalSearchMany } from '../src/repo-map.mjs';

function workspace(files) {
  const root = mkdtempSync(join(tmpdir(), 'noesar-grounding-'));
  for (const [path, contents] of Object.entries(files)) {
    const absolute = join(root, path);
    mkdirSync(join(absolute, '..'), { recursive: true });
    writeFileSync(absolute, contents);
  }
  return root;
}

describe('the terms a goal is searched by', () => {
  test('drops what carries no location, in both languages', () => {
    // A stop-word list that only knows English turns an Italian request into a search for
    // "per" and "che", which match everything, which is the same as matching nothing.
    assert.deepEqual(searchTermsOf('correggi il rifiuto della sessione nel protocollo'),
      ['rifiuto', 'sessione', 'protocollo']);
    assert.deepEqual(searchTermsOf('fix the refusal in the session protocol'),
      ['refusal', 'session', 'protocol']);
  });

  test('keeps identifier shapes, drops fragments, dedupes, and preserves order', () => {
    assert.deepEqual(searchTermsOf('the tui_client and the TUI_CLIENT in a b cd'), ['tui_client']);
  });

  test('is a total function of its input — the same goal gives the same terms', () => {
    const goal = 'restore the passkey rotation counter in webauthn';
    assert.deepEqual(searchTermsOf(goal), searchTermsOf(goal));
  });

  test('an empty or purely stop-word goal yields nothing rather than something vague', () => {
    assert.deepEqual(searchTermsOf(''), []);
    assert.deepEqual(searchTermsOf('please do it for the'), []);
  });

  test("issue-tracker chrome does not spend the budget a real word needed", () => {
    // Measured on a real SWE-bench report (django-10097): the sentence carrying the actual
    // bug — "core.validators.URLValidator" — came AFTER this template boilerplate, and
    // MAX_TERMS (12) was spent before reaching it. `validators` never became a search term
    // at all, on a report that names the file by its own module path.
    const report = "Make URLValidator reject invalid characters in the username and password Description (last modified by Tim Bell) Since #20003, core.validators.URLValidator accepts URLs with usernames and passwords";
    const terms = searchTermsOf(report);
    assert.ok(!terms.includes('description'), 'the template label is not a search term');
    assert.ok(!terms.includes('last') && !terms.includes('modified'), 'the timestamp phrase is not a search term');
    assert.ok(!terms.includes('since'), 'the boilerplate transition word is not a search term');
    assert.ok(terms.includes('validators'), 'the actual module name now has a slot to land in');
  });
});

describe('grounding a goal in a real repository', () => {
  test('selects the file the goal points at, and reports what it searched', () => {
    const root = workspace({
      'greeting.mjs': 'export const greeting = "hello";\n',
      'unrelated.mjs': 'export const total = 1;\n',
    });
    try {
      const result = groundRequest({ workspaceRoot: root, goal: 'change the greeting' });
      assert.deepEqual(result.files.map((f) => f.path), ['greeting.mjs']);
      assert.equal(result.files[0].contents, 'export const greeting = "hello";\n');
      assert.equal(result.grounding.derived, true);
      assert.deepEqual(result.grounding.terms, ['greeting']);
      assert.deepEqual(result.grounding.selected, ['greeting.mjs']);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test('a file matching MORE OF the goal outranks one matching a single word many times', () => {
    // The ranking claim, stated as a case where the two orderings disagree — otherwise the
    // rule is untested however green the suite is.
    const root = workspace({
      'both.mjs': 'session\nprotocol\n',
      'one-often.mjs': `${'session\n'.repeat(50)}`,
    });
    try {
      const result = groundRequest({ workspaceRoot: root, goal: 'the session protocol' });
      assert.equal(result.files[0].path, 'both.mjs',
        'a file containing one term fifty times outranked a file containing both — the ranking is counting matches before distinct terms');
      assert.equal(result.grounding.ranking[0].distinctTerms, 2);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test('the order does not depend on the order the filesystem answered in', () => {
    // CE-006 asks that a decision be replayable from recorded state. A ranking that fell
    // back on filesystem order would make the same request plan against different files on
    // replay, and session-replay.mjs would report drift that came from here.
    const root = workspace({ 'b.mjs': 'session\n', 'a.mjs': 'session\n', 'c.mjs': 'session\n' });
    try {
      const first = groundRequest({ workspaceRoot: root, goal: 'the session' });
      const second = groundRequest({ workspaceRoot: root, goal: 'the session' });
      assert.deepEqual(first.grounding.selected, second.grounding.selected);
      assert.deepEqual(first.grounding.selected, ['a.mjs', 'b.mjs', 'c.mjs'],
        'files tied on every content signal must fall back to a total, content-independent order');
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test('a file too large to read whole is skipped and SAID to be skipped, never truncated', () => {
    const root = workspace({ 'big.mjs': `// session\n${'x'.repeat(2000)}`, 'small.mjs': '// session\n' });
    try {
      const result = groundRequest({ workspaceRoot: root, goal: 'the session', maxFileBytes: 500 });
      assert.deepEqual(result.files.map((f) => f.path), ['small.mjs']);
      const skipped = result.grounding.skipped.find((entry) => entry.path === 'big.mjs');
      assert.ok(skipped, 'a skipped file vanished from the report');
      assert.equal(skipped.reason, 'TOO_LARGE');
      // A plan reasoning over half a file, with nothing saying so, is worse than a plan that
      // never saw it: the missing half is invisible to whoever approves.
      assert.ok(result.files.every((f) => f.path !== 'big.mjs'));
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test('the selection is capped, and the cap is visible in what it considered', () => {
    const files = {};
    for (let index = 0; index < 12; index += 1) files[`file-${index}.mjs`] = '// session\n';
    const root = workspace(files);
    try {
      const result = groundRequest({ workspaceRoot: root, goal: 'the session', limit: 3 });
      assert.equal(result.files.length, 3);
      assert.equal(result.grounding.considered, 12, 'the report must say how many it looked at, not only how many it took');
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});

describe('the refusals', () => {
  test('a goal with no searchable term refuses instead of searching for stop words', () => {
    const root = workspace({ 'a.mjs': 'anything\n' });
    try {
      assert.throws(
        () => groundRequest({ workspaceRoot: root, goal: 'please do it for the' }),
        (error) => error instanceof GroundingRefused && error.code === 'NO_TERMS',
      );
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test('a goal matching nothing refuses, and names the terms so the operator knows what to do', () => {
    const root = workspace({ 'a.mjs': 'anything\n' });
    try {
      assert.throws(
        () => groundRequest({ workspaceRoot: root, goal: 'the unobtainium flux' }),
        (error) => {
          assert.ok(error instanceof GroundingRefused);
          assert.equal(error.code, 'NO_CANDIDATES');
          assert.match(error.reason, /unobtainium/);
          assert.deepEqual(error.detail.terms, ['unobtainium', 'flux']);
          return true;
        },
      );
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test('candidates that all fail to be read refuse rather than planning against nothing', () => {
    const root = workspace({ 'big.mjs': `// session\n${'x'.repeat(2000)}` });
    try {
      assert.throws(
        () => groundRequest({ workspaceRoot: root, goal: 'the session', maxFileBytes: 10 }),
        (error) => error instanceof GroundingRefused && error.code === 'NO_READABLE_CANDIDATES',
      );
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});

describe('the adversarial half — a candidate is not trusted for its provenance', () => {
  test('a search result pointing outside the workspace is dropped, not read', () => {
    // `literalSearch` walks the root and reports paths relative to it, so this cannot happen
    // today. That is exactly why it is worth a test: "cannot happen" is a property of ANOTHER
    // module, and this one is about to read whatever it is handed. The seam exists so the
    // containment branch can be reached at all — a branch nobody can exercise is a branch
    // nobody has checked, which is the third time this project has written that sentence.
    const root = workspace({ 'safe.mjs': '// session\n' });
    const hostile = () => ({
      caseSensitive: false,
      results: [{
        query: 'session',
        truncated: false,
        matches: [
          { path: '../../../etc/passwd', line: 1, text: 'session' },
          { path: 'safe.mjs', line: 1, text: '// session' },
        ],
      }],
    });
    try {
      const result = groundRequest({ workspaceRoot: root, goal: 'the session', literalSearchMany: hostile });
      assert.deepEqual(result.files.map((f) => f.path), ['safe.mjs'],
        'a path that leaves the workspace was read because a trusted module returned it');
      const skipped = result.grounding.skipped.find((entry) => entry.path === '../../../etc/passwd');
      assert.ok(skipped, 'the escape attempt vanished instead of being recorded');
      assert.equal(skipped.reason, 'OUTSIDE_WORKSPACE');
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test('an absolute path from a search result is dropped too', () => {
    const root = workspace({ 'safe.mjs': '// session\n' });
    const hostile = () => ({
      caseSensitive: false,
      results: [{
        query: 'session', truncated: false,
        matches: [{ path: '/etc/passwd', line: 1, text: 'session' }, { path: 'safe.mjs', line: 1, text: '// session' }],
      }],
    });
    try {
      const result = groundRequest({ workspaceRoot: root, goal: 'the session', literalSearchMany: hostile });
      assert.deepEqual(result.files.map((f) => f.path), ['safe.mjs']);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test('the real search never produces a path outside the workspace to begin with', () => {
    // The other side of the same claim: not a stub, the real function, over a real tree.
    const root = workspace({ 'a/b/deep.mjs': '// session\n', 'top.mjs': '// session\n' });
    try {
      const result = literalSearch(root, 'session', { caseSensitive: false });
      for (const match of result.matches) {
        assert.ok(!match.path.startsWith('/'), `${match.path} is absolute`);
        assert.ok(!match.path.split(/[\\/]/).includes('..'), `${match.path} climbs out`);
      }
      assert.ok(result.matches.length >= 2);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});

describe('what running it against the live engine found', () => {
  test('a file that is not text is never a candidate, however well its bytes match', () => {
    // Measured, not imagined. With the live installation's workspace root — the runtime
    // directory, not a source tree — literal search matched byte coincidences INSIDE
    // PostgreSQL heap files, and the top candidates for "fix the session protocol refusal"
    // came back as `postgresql/data/base/16384/2664`. A plan proposing to edit a database's
    // storage is not a weak plan, it is a dangerous one, and in an approval screen it looked
    // exactly as plausible as a good one.
    const root = workspace({
      'heap.bin': `session protocol${String.fromCharCode(0)}${'session '.repeat(40)}`,
      'real.mjs': '// session protocol\n',
    });
    try {
      const result = groundRequest({ workspaceRoot: root, goal: 'the session protocol', request: 'the session protocol' });
      assert.deepEqual(result.files.map((f) => f.path), ['real.mjs'],
        'a binary file reached a plan as something to edit');
      const skipped = result.grounding.skipped.find((entry) => entry.path === 'heap.bin');
      assert.ok(skipped, 'the binary candidate vanished instead of being recorded');
      assert.equal(skipped.reason, 'NOT_TEXT');
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test('an interpreted goal unrelated to the request cannot steer the search away from it', () => {
    // The other live finding, and the worse one. ATOM, given `zzqqxx unobtainium flux`,
    // neither refused nor echoed: it returned "Create a program that generates a random
    // string of characters from a given set" — fluent, confident, about nothing that was
    // asked. Searching only the goal meant searching a hallucination, and NO_CANDIDATES
    // never fired because the invented sentence contained ordinary words.
    const root = workspace({
      'asked-about.mjs': '// passkey rotation counter\n',
      'hallucinated.mjs': '// random string characters generator\n',
    });
    try {
      const result = groundRequest({
        workspaceRoot: root,
        request: 'the passkey rotation counter',
        goal: 'Create a program that generates a random string of characters',
      });
      assert.ok(result.grounding.selected.includes('asked-about.mjs'),
        "the file the REQUEST points at was not selected — an unrelated goal steered the search");
      assert.deepEqual(result.grounding.goalOverlap, [],
        'this fixture is only meaningful when the goal and the request share nothing');
      assert.equal(result.grounding.goalRelatedToRequest, false,
        'an unrelated goal must be declared as unrelated, so an approver can see it');
      assert.ok(result.grounding.terms.includes('passkey'), "the request's own words must always be searched");
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test('a related goal is reported as related — the signal is not always-on', () => {
    // Without this the assertion above passes for a module that hardcodes `false`.
    const root = workspace({ 'a.mjs': '// passkey rotation\n' });
    try {
      const result = groundRequest({
        workspaceRoot: root,
        request: 'fix the passkey rotation',
        goal: 'repair passkey rotation handling',
      });
      assert.deepEqual(result.grounding.goalOverlap, ['passkey', 'rotation']);
      assert.equal(result.grounding.goalRelatedToRequest, true);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});

describe('the ranking — a file is not a better answer for being longer', () => {
  test('a prose file that repeats every term does not outrank the source file that carries them once', () => {
    // The old ranking was "distinct terms, then match count". Both files below carry all three
    // terms, so the first key ties and the raw count decided — and the count is exactly what an
    // aggregate file wins by. Measured on the real thing before it was a fixture: on astropy,
    // `CHANGES.rst` ranked FIRST with 797 matches over 11 terms, and only the readability
    // ceiling kept it out of the answer.
    //
    // RUN RED against that ranking, where `docs/guide.rst` came first.
    const repeated = ['session', 'rotation', 'passkey'].map((term) => Array.from({ length: 5 }, () => `the ${term} paragraph`).join('\n')).join('\n');
    const root = workspace({
      'docs/guide.rst': `${repeated}\n`,
      'src/auth.mjs': '// session\n// rotation\n// passkey\n',
    });
    try {
      const result = groundRequest({ workspaceRoot: root, request: 'fix the passkey session rotation', goal: 'repair passkey session rotation' });
      assert.equal(result.grounding.selected[0], 'src/auth.mjs',
        `the prose file outranked the source: ${result.grounding.selected.join(', ')}`);
      // Both are still candidates: this is a penalty, not a partition. A ranking that DROPPED
      // the prose file would pass the assertion above and be a different, worse thing.
      assert.ok(result.grounding.selected.includes('docs/guide.rst'),
        'the prose file was removed rather than ranked below');
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test('prose still wins when the request really is about it', () => {
    // The ceiling of the prior, stated as a test: half weight is a handicap, not a ban.
    const root = workspace({
      'docs/install.rst': 'installation instructions\ninstallation prerequisites\ninstallation troubleshooting\n',
      'src/unrelated.mjs': '// nothing to do with it\n',
    });
    try {
      const result = groundRequest({ workspaceRoot: root, request: 'the installation instructions are wrong', goal: 'fix the installation instructions' });
      assert.equal(result.grounding.selected[0], 'docs/install.rst');
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  // --- 2026-09-12: the same half weight for the two families the per-file match cap exposed.
  // Measured on the 155-instance capture before being chosen: prose only localises 42, with
  // tests at half weight 62, with changelog-by-name too 63.

  test('a test file that exercises the term does not outrank the source file that defines it', () => {
    // The two files say the SAME words the same number of times, so BM25 ties to the last
    // decimal and the tie-break decides — and the tie-break is alphabetical, which put
    // `tests/` first for no reason anybody would defend out loud. That is the shape of the real
    // case: on `django-10999` the five places went to five test files and the gold file,
    // `django/utils/dateparse.py`, fell out of the top five entirely.
    //
    // RUNS RED against the prose-only ranking, where `tests/test_dateparse.py` came first.
    const body = 'parse_duration negative dateparse';
    const root = workspace({
      'tests/test_dateparse.py': body,
      'utils/dateparse.py': body,
    });
    try {
      const result = groundRequest({
        workspaceRoot: root,
        request: 'parse_duration fails on negative durations',
        goal: 'fix parse_duration for negative values in dateparse',
      });
      assert.equal(result.grounding.selected[0], 'utils/dateparse.py',
        `the test outranked the source it exercises: ${result.grounding.selected.join(', ')}`);
      // A penalty, not a partition — exactly as for prose. A ranking that DROPPED the test file
      // would pass the assertion above and be a worse thing: a change often needs its test.
      assert.ok(result.grounding.selected.includes('tests/test_dateparse.py'),
        'the test file was removed rather than ranked below');
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test('a test file still wins when the request really is about the test', () => {
    // The declared cost of the prior, as a test: half weight is a handicap, not a ban. This is
    // the request that pays it — and still gets the right answer.
    const root = workspace({
      'tests/test_flaky.py': 'def test_flaky():\n    assert flaky_helper()\n    # flaky under load\n',
      'src/unrelated.mjs': '// nothing to do with it\n',
    });
    try {
      const result = groundRequest({
        workspaceRoot: root,
        request: 'test_flaky is flaky and should be rewritten',
        goal: 'rewrite the flaky test test_flaky',
      });
      assert.equal(result.grounding.selected[0], 'tests/test_flaky.py');
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test('a changelog is a changelog whatever follows the dot', () => {
    // `.old` is not one of the nine prose extensions, so `CHANGES.old` escaped the prose prior
    // entirely and ranked FIRST on `sphinx-10323` — measured, then fixed by reading the name.
    const repeated = ['literalinclude', 'dedent', 'directive']
      .map((term) => Array.from({ length: 6 }, () => `* fixed ${term} handling`).join('\n')).join('\n');
    const root = workspace({
      'CHANGES.old': `${repeated}\n`,
      'directives/code.py': 'class LiteralInclude:\n    # dedent\n    # directive\n    pass\n',
    });
    try {
      const result = groundRequest({
        workspaceRoot: root,
        request: 'literalinclude dedent is wrong in the code directive',
        goal: 'fix dedent in the literalinclude directive',
      });
      assert.equal(result.grounding.selected[0], 'directives/code.py',
        `the changelog outranked the source: ${result.grounding.selected.join(', ')}`);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test('the prior knows what is NOT a supporting file', () => {
    // The edges, one assertion each, because a prior that swept up source would cost more than
    // it buys. `setup.py` and `Makefile` are how a project builds itself; `latest.py` merely
    // ends in a word that contains "test".
    for (const path of ['tests/test_x.py', 'a/tests/helpers.py', 'x_test.py', 'x.test.js',
      'conftest.py', 'tests.py', 'CHANGES.old', 'CHANGELOG.1', 'testing/support.py']) {
      assert.equal(rankingWeight(path), PROSE_WEIGHT, `${path} must be weighed as supporting`);
    }
    for (const path of ['setup.py', 'Makefile.am', 'src/latest.py', 'src/contest.py',
      'src/protester.js', 'utils/dateparse.py', 'testament/main.py']) {
      assert.equal(rankingWeight(path), 1, `${path} must keep full weight`);
    }
    // And the prose rule it already had, unchanged.
    assert.equal(rankingWeight('docs/guide.rst'), PROSE_WEIGHT);
    assert.equal(rankingWeight('AUTHORS'), PROSE_WEIGHT);
  });

  // --- 12/09 pomeriggio: e il codice che non e' di questo progetto ------------------------------

  test('a vendored library inside the repository is not where a bug in the repository is fixed', () => {
    // The real case: `astropy-13033` was «repaired» in `cextern/wcslib/C/spc.h`, a C library
    // astropy CARRIES. Both files below name every term; the one that belongs to the project wins.
    // The two files say the same words, so BM25 ties and the tie-break decides — and the
    // tie-break is alphabetical, which puts `cextern/` FIRST. That is the whole point of the
    // fixture: only the prior can move the project's own file above the library it carries.
    const body = 'wcs_units spectral_axis conversion';
    const root = workspace({
      'cextern/wcslib/C/spc.h': body,
      'spectral/units.py': body,
    });
    try {
      const result = groundRequest({
        workspaceRoot: root,
        request: 'wcs_units conversion is wrong on the spectral_axis',
        goal: 'fix the wcs_units conversion for spectral_axis',
      });
      assert.equal(result.grounding.selected[0], 'spectral/units.py',
        `vendored code outranked the project: ${result.grounding.selected.join(', ')}`);
      assert.ok(result.grounding.selected.includes('cextern/wcslib/C/spc.h'),
        'a penalty, not a partition — vendored code a request really is about must stay reachable');
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test('the third family knows a project directory from somebody else\'s', () => {
    for (const path of [
      'cextern/wcslib/C/spc.h', 'vendor/lib/x.py', 'third_party/zlib/z.c', 'node_modules/a/b.js',
      'examples/io/plot.py', 'docs/conf.py', 'doc/make.py', 'benchmarks/asv_bench.py',
    ]) {
      assert.equal(rankingWeight(path), PROSE_WEIGHT, `${path} must be weighed as outside the project`);
    }
    // Measured and REFUSED: `scripts` and `tools` buy nothing on the sample (identical 64/38/3) and
    // this product's own `tools/` is real code. A prior that costs and does not pay is not kept.
    for (const path of [
      'tools/tui-client.mjs', 'tools/generate-manifest.mjs', 'scripts/deploy.sh',
      // And a segment that merely CONTAINS one of the words is not one of them.
      'src/documentation.py', 'src/vendors/list.py', 'astropy/exampled.py',
    ]) {
      assert.equal(rankingWeight(path), 1, `${path} must keep full weight`);
    }
  });
});

describe('one walk for many terms — the batch must be the single search, not merely like it', () => {
  test('literalSearchMany returns, per query, exactly what literalSearch returns — cap included', () => {
    // Two terms of very different frequency, in files whose names sort against the order they
    // were written, plus a cap low enough that the common term hits it and the rare one does
    // not. A batch that shares one budget between queries answers differently HERE and nowhere
    // else, which is why the cap is part of the oracle rather than an afterthought.
    const lines = Array.from({ length: 9 }, (_, index) => 'const session = ' + index + ';').join('\n');
    const root = workspace({
      'z-last.mjs': lines + '\n// rotation\n',
      'a-first.mjs': lines + '\n',
      'nested/deep.mjs': '// session and rotation\n',
    });
    try {
      const options = { caseSensitive: false, maxMatches: 10 };
      const terms = ['session', 'rotation'];
      const batched = literalSearchMany(root, terms, options);
      assert.equal(batched.caseSensitive, false);
      assert.deepEqual(
        batched.results,
        terms.map((term) => literalSearch(root, term, options)),
        'a query answered in the batch differs from the same query asked on its own',
      );
      // The fixture has to actually exercise the cap, or the assertion above is vacuous —
      // the same vacuity `compare()` guards with `observationIsEmpty`.
      assert.equal(batched.results[0].truncated, true, 'this fixture no longer reaches the cap');
      assert.equal(batched.results[1].truncated, false);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test('an empty query list, and an empty query among good ones, are both refused', () => {
    const root = workspace({ 'a.mjs': '// session\n' });
    try {
      assert.throws(() => literalSearchMany(root, []), /EMPTY_QUERY|at least one query/);
      assert.throws(() => literalSearchMany(root, ['session', '']), /EMPTY_QUERY|non-empty/);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
