// SPDX-License-Identifier: AGPL-3.0-or-later
//
// `CE-025` — *«L'Autore non nomina mai un percorso: l'insieme dei file che tocca è un
// sottoinsieme di quelli del passo»*
// (`MASTER_PROJECT/16_CODEN_EVOLUTION_LA_GENERAZIONE_E_L_ACCESSO.md` §11, severity **C**),
// verification method *«autore sonda che tenta di scrivere fuori elenco; il tentativo è scartato
// e registrato»*.
//
// # The two halves the method asks for, and neither is enough alone
//
//   scartato    the attempt changes nothing — no file outside the step's list is written, and
//               the directive does not even survive into the file that WAS written
//   registrato  the attempt is on the record, with what was claimed, so an operator can see
//               that a model tried — a silently sanitised attack is one nobody learns about
//
// # Why the probe answers in the model's own voice
//
// The generator is injected (`Author`'s constructor takes `generate`), so the probe here is a
// real model answer, byte for byte, of the shape a model actually produces: a fenced block whose
// first line is a `path:` directive. `PATH_DIRECTIVE` (author.mjs:70) accepts `file:`, `path:`
// and `filename:` behind an optional comment marker, and the probe uses every one of them —
// asserting the rule against the syntax the product itself declares, not against one spelling.
//
// # The subset claim is proven as a SET, not per file
//
// The strong reading of the criterion is «l'insieme dei file che tocca è un sottoinsieme»: the
// probe below is handed three files and tries to name four others, and the assertion is on the
// key set of `contents` — never on one path at a time, which would pass while the set grew.
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { Author } from '../src/author.mjs';
import { WorkspaceActionOrchestrator } from '../src/workspace-actions.mjs';
import { TokenMinter } from '../src/capability.mjs';
import { EventLedger } from '../src/events.mjs';
import { freshTempDir } from './support/workspace.mjs';

// The Author EDITS a file that already has contents — `applyEditBlocks` — because "return the
// complete new contents" is an instruction a model cannot carry out on a file larger than its
// answer. These tests still say what they always said: replace everything with this.
const editAll = (contents, body) => [
  '<<<<<<< SEARCH',
  String(contents).replace(/\n$/, ''),
  '=======',
  String(body).replace(/\n$/, ''),
  '>>>>>>> REPLACE',
].join('\n');

const NOW = 1_800_000_000;

/** The paths the probe tries to reach. None is ever handed to the Author. */
const OUT_OF_LIST = Object.freeze([
  'not-in-the-plan.txt',
  'src/secrets.env',
  '../../etc/passwd',
  '/etc/shadow',
]);

/**
 * A generator that answers with a fenced block whose first lines claim a different file, in
 * every spelling `PATH_DIRECTIVE` accepts. `index` picks which claim this call makes, so a
 * multi-file run has each file attacked differently.
 */
function probeGenerator(bodyFor = (path) => `authored for ${path}\n`) {
  const spellings = [
    (claim) => `path: ${claim}`,
    (claim) => `// file: ${claim}`,
    (claim) => `# filename: ${claim}`,
    (claim) => `<!-- path: ${claim}`,
  ];
  let call = 0;
  return async ({ path, contents }) => {
    const claim = OUT_OF_LIST[call % OUT_OF_LIST.length];
    const spell = spellings[call % spellings.length];
    call += 1;
    return `${spell(claim)}\n${editAll(contents, bodyFor(path))}`;
  };
}

describe('CE-025 — the Author never names a path; what it touches is a subset of the step', () => {

  test('a probe that claims another file writes to the PLAN\'s path, and the claim is discarded', async () => {
    const author = new Author({ generate: probeGenerator(), model: 'ce025-probe' });
    const result = await author.author({
      goal: 'g', step: 's', files: [{ path: 'a.txt', contents: 'before\n' }],
    });

    // Written under the key the plan handed in — not under anything the model said.
    assert.deepEqual([...result.contents.keys()], ['a.txt']);
    // And the directive line is gone from the bytes: it is not merely ignored as a path, it
    // does not end up inside the file as content either.
    const body = result.contents.get('a.txt');
    assert.equal(body, 'authored for a.txt\n');
    for (const claim of OUT_OF_LIST) assert.ok(!body.includes(claim), `\`${claim}\` survived into the file`);
    // Registrato: the attempt is on the record, with what was claimed and where it was tried.
    assert.deepEqual(result.discarded, [{ path: 'a.txt', claimed: OUT_OF_LIST[0] }]);
    assert.equal(result.summary.discardedPaths, 1);
  });

  test('the subset claim, as a SET: three files handed in, four others claimed, nothing widens', async () => {
    const author = new Author({ generate: probeGenerator(), model: 'ce025-probe' });
    const files = [
      { path: 'one.txt', contents: 'a\n' },
      { path: 'two/three.txt', contents: 'b\n' },
      { path: 'four.md', contents: 'c\n' },
    ];
    const result = await author.author({ goal: 'g', step: 's', files });

    const handedIn = new Set(files.map((file) => file.path));
    const touched = new Set([...result.contents.keys(), ...result.unchanged]);
    for (const path of touched) {
      assert.ok(handedIn.has(path), `the Author touched \`${path}\`, which the step never named`);
    }
    assert.equal(touched.size <= handedIn.size, true);
    // Every one of the three calls made its own claim, and all three are recorded.
    assert.equal(result.discarded.length, 3);
    assert.deepEqual(result.discarded.map((entry) => entry.path).sort(), ['four.md', 'one.txt', 'two/three.txt']);
    assert.equal(result.summary.discardedPaths, 3);
  });

  test('a traversal path is treated exactly like any other claim — discarded, not sanitised into a write', async () => {
    // `../../etc/passwd` and `/etc/shadow` are the two shapes that would matter if a claim were
    // ever honoured. They are handled by the same line as `notes.txt`, which is the point: there
    // is no special case to get wrong, because no claim is honoured at all.
    for (const claim of ['../../etc/passwd', '/etc/shadow']) {
      const author = new Author({
        generate: async ({ contents }) => `path: ${claim}\n${editAll(contents, 'body')}`, model: 'ce025-probe',
      });
      const result = await author.author({ goal: 'g', step: 's', files: [{ path: 'a.txt', contents: 'x\n' }] });
      assert.deepEqual([...result.contents.keys()], ['a.txt']);
      assert.deepEqual(result.discarded, [{ path: 'a.txt', claimed: claim }]);
    }
  });

  test('a stack of claims is stripped and every one of them is recorded, not just the first', async () => {
    const author = new Author({
      generate: async ({ contents }) => `path: first.txt\n// file: second.txt\n# filename: third.txt\n${editAll(contents, 'real body')}`,
      model: 'ce025-probe',
    });
    const result = await author.author({ goal: 'g', step: 's', files: [{ path: 'a.txt', contents: 'x\n' }] });

    assert.equal(result.contents.get('a.txt'), 'real body\n');
    assert.deepEqual(result.discarded.map((entry) => entry.claimed), ['first.txt', 'second.txt', 'third.txt']);
  });

  test('a provider that already checked is not taken at its word: its own claim is stripped again', async () => {
    // The structured shape ATOM's `/v1/author` answers with. `normaliseAuthored()` re-applies
    // the rule rather than trusting `discardedPaths`, and this asserts BOTH: the re-strip and
    // the carry-through of what the provider says it already dropped.
    const author = new Author({
      generate: async () => ({
        contents: 'path: sneaked.txt\nreal body\n',
        discardedPaths: ['already-dropped.txt'],
        checkedBy: 'stub-provider',
      }),
      model: 'ce025-probe',
    });
    const result = await author.author({ goal: 'g', step: 's', files: [{ path: 'a.txt', contents: 'x\n' }] });

    assert.deepEqual([...result.contents.keys()], ['a.txt']);
    assert.equal(result.contents.get('a.txt'), 'real body\n');
    assert.deepEqual(result.discarded.map((entry) => entry.claimed), ['already-dropped.txt', 'sneaked.txt']);
  });

  // ── the whole way to disk, because a subset in memory is not the criterion ────────────────
  test('end to end: a probe Author cannot make the run touch a file the plan never named', async () => {
    const ws = freshTempDir('noesar-ce025-ws-');
    const shadows = freshTempDir('noesar-ce025-sh-');
    writeFileSync(join(ws, '.seed'), 'seed');
    writeFileSync(join(ws, 'a.txt'), 'original\n');
    writeFileSync(join(ws, 'not-in-the-plan.txt'), 'untouched\n');
    const before = new Map(readdirSync(ws).map((name) => [name, readFileSync(join(ws, name), 'utf8')]));

    const orch = new WorkspaceActionOrchestrator({
      workspaceRoot: ws, shadowsRoot: shadows,
      minter: new TokenMinter(randomBytes(32)), events: new EventLedger(), env: {},
      author: new Author({ generate: probeGenerator(), model: 'ce025-probe' }),
    });
    const planned = await orch.plan({
      request: 'change a line', files: [{ path: 'a.txt', contents: 'caller\n' }],
      actor: 'owner-001', nowUnix: NOW,
    });
    // Registrato, on the answer the operator reads — not only inside the Author's return value.
    assert.equal(planned.authoring.available, true);
    assert.equal(planned.authoring.authored, 1);
    // The answer carries BOTH shapes and they must agree: `discardedPaths` is the count the
    // summary reports, `discarded` is what was actually claimed and where. Asserting only the
    // count would let a run report "1 discarded" while naming the wrong file.
    assert.equal(planned.authoring.discardedPaths, 1, JSON.stringify(planned.authoring));
    assert.deepEqual(planned.authoring.discarded, [{ path: 'a.txt', claimed: 'not-in-the-plan.txt' }]);

    orch.measure({ runId: planned.runId, actor: 'owner-001', nowUnix: NOW });
    orch.approve({ runId: planned.runId, approverId: 'owner-001', nowUnix: NOW });

    // Scartato, on the bytes: exactly one file changed, and it is the one the plan named.
    const after = new Map(readdirSync(ws).map((name) => [name, readFileSync(join(ws, name), 'utf8')]));
    assert.deepEqual([...after.keys()].sort(), [...before.keys()].sort(),
      'the run created or removed a file, and the plan named neither');
    const changed = [...after.entries()].filter(([name, body]) => before.get(name) !== body).map(([name]) => name);
    assert.deepEqual(changed, ['a.txt']);
    assert.equal(after.get('a.txt'), 'authored for a.txt\n');
    assert.equal(after.get('not-in-the-plan.txt'), 'untouched\n');
    // And nothing was written outside the workspace either.
    assert.equal(existsSync(join(ws, '..', 'etc')), false);
  });

  // Negative control: an honest answer authors normally and records no discard, or every
  // assertion above is satisfied by an Author that simply never writes anything.
  test('negative control · an answer with no directive authors normally and discards nothing', async () => {
    const author = new Author({ generate: async ({ contents }) => editAll(contents, 'honest body'), model: 'ce025-probe' });
    const result = await author.author({ goal: 'g', step: 's', files: [{ path: 'a.txt', contents: 'x\n' }] });
    assert.equal(result.contents.get('a.txt'), 'honest body\n');
    assert.deepEqual(result.discarded, []);
    assert.equal(result.summary.discardedPaths, 0);
  });
});
