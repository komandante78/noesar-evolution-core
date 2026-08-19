// SPDX-License-Identifier: AGPL-3.0-or-later
//
// `D-0579`, closing `F-AUTH-UI-001` — **the reason a run wrote nothing reaches the person.**
//
// # The defect, measured before this file existed
//
// `CE-029` proves the engine refuses to author *saying why*: an installation with no model
// answers `authoring.available:false` with a sentence on the response. `D-0571` recorded, beside
// that verdict, that **no file under `apps/` reads `authoring` at all** — so the sentence reached
// the API and stopped there.
//
// Measured 2026-08-19 against the real orchestrator, which turned out to be worse than the
// finding said: the plan answer is **126 lines** of JSON, `authoring` first appears at line
// **88**, and all three shells rendered a call result as `` `${command} — ok` `` plus the first
// **10** lines. A plan that wrote **no file at all** announced itself as *ok*, identically in the
// browser page, the browser terminal and the `ssh` shell — because all three shaped the answer
// at the same place, with the same two words.
//
// # What this file holds
//
//   1. the **shape** of the summary — four states, and the two that both mean "nothing was
//      written" must not collapse, because only the reason separates them;
//   2. the **real** answer — the orchestrator is run with no Author and the summary is asserted
//      against what it actually returns, never against a hand-written fixture of it;
//   3. the **three shells** — each one's render site is read from its own source and asserted to
//      go through the shared shaper, so a fourth shell cannot quietly reintroduce `— ok`.
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { Author } from '../src/author.mjs';
import { WorkspaceActionOrchestrator } from '../src/workspace-actions.mjs';
import { TokenMinter } from '../src/capability.mjs';
import { EventLedger } from '../src/events.mjs';
import { freshTempDir } from './support/workspace.mjs';
import { authoringSummary, callResult, DETAIL_LINES } from '../../../apps/webui-static/coden-view-model.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '../../..');
const NOW = 1_800_000_000;

/** The orchestrator with no Author — `CE-029`'s own fixture shape, for the same reason it uses
 *  it: this is what an installation that configured no model actually is. */
function planWithNoModel() {
  const ws = freshTempDir('noesar-authui-ws-');
  const shadows = freshTempDir('noesar-authui-sh-');
  writeFileSync(join(ws, '.seed'), 'seed');
  writeFileSync(join(ws, 'a.txt'), 'original\n');
  const orch = new WorkspaceActionOrchestrator({
    workspaceRoot: ws, shadowsRoot: shadows,
    minter: new TokenMinter(randomBytes(32)), events: new EventLedger(), env: {}, author: null,
  });
  return orch.plan({
    request: 'change a line', files: [{ path: 'a.txt', contents: 'the caller wrote this\n' }],
    actor: 'owner-001', nowUnix: NOW,
  });
}

describe('the authoring summary — four states, and the two that must not collapse', () => {
  test('no authoring block at all is an em dash, not an invented reassurance', () => {
    assert.equal(authoringSummary(null), '—');
    assert.equal(authoringSummary(undefined), '—');
    assert.equal(authoringSummary('nothing'), '—');
  });

  test('files written are counted, and the count is grammatical in both directions', () => {
    assert.equal(authoringSummary({ available: true, reason: null, authored: 1 }), '1 file written');
    assert.equal(authoringSummary({ available: true, reason: null, authored: 3 }), '3 files written');
  });

  test('an ABSENT model and a model that REFUSED are both "nothing written" — the reason separates them', () => {
    const absent = authoringSummary({ available: false, reason: Author.NO_MODEL_REASON, authored: 0 });
    const refused = authoringSummary({ available: true, reason: null, authored: 0, refusals: [{ code: 'EMPTY' }] });

    assert.match(absent, /^nothing written — /);
    assert.match(refused, /^nothing written — /);
    assert.notEqual(absent, refused, 'two different facts must not print the same sentence');
    // The engine's OWN words, carried whole — the rule `reasoningSummary` states one screen down.
    // Summarising this into "unavailable" would be the shell deciding what the operator may act on.
    assert.ok(absent.includes(Author.NO_MODEL_REASON), `the engine's sentence must survive intact: ${absent}`);
  });

  test('a failed attempt is its own state, and the absence of a reason is reported rather than hidden', () => {
    assert.match(authoringSummary({ available: true, failed: true, reason: 'the endpoint timed out' }),
      /^authoring failed — the endpoint timed out$/);
    assert.match(authoringSummary({ available: true, failed: true, reason: '' }),
      /^authoring failed — no reason given$/);
    assert.match(authoringSummary({ available: false, reason: '  ', authored: 0 }),
      /itself worth reporting/, 'a silent engine is a finding, not a blank');
  });
});

describe('what a shell prints for a real plan on an installation with no model', () => {
  test('the headline says nothing was written, and the reason is the first line under it', async () => {
    const result = await planWithNoModel();
    // The engine's half of the criterion, re-confirmed here rather than assumed from CE-029:
    // if this ever stopped being true the shell assertions below would be testing a fixture.
    assert.equal(result.authoring.available, false);
    assert.equal(result.authoring.reason, Author.NO_MODEL_REASON);

    const shown = callResult('plan', result);
    assert.equal(shown.headline, 'plan — nothing written',
      'a plan that wrote no file must not announce itself as ok — this is the whole defect');
    assert.ok(shown.lines[0].startsWith('authoring: nothing written — '), shown.lines[0]);
    assert.ok(shown.lines[0].includes(Author.NO_MODEL_REASON),
      'the reason must be on the FIRST detail line, not somewhere in the truncated dump');
  });

  test('the old rendering could not have shown it — the measurement that made this a defect', async () => {
    const result = await planWithNoModel();
    const full = JSON.stringify(result, null, 2).split('\n');
    const firstMention = full.findIndex((line) => /"authoring"/.test(line)) + 1;

    assert.ok(firstMention > DETAIL_LINES,
      `if authoring appeared within the first ${DETAIL_LINES} lines (it is at ${firstMention}), the old `
      + 'rendering would have shown it and this whole change would be unnecessary — re-measure before trusting it');
    // And the full answer is genuinely long: the truncation is not an artefact of a toy fixture.
    assert.ok(full.length > 100, `a real plan answer is long (${full.length} lines); that is why ten lines hid this`);
  });

  test('the full result still follows — this adds a reading and removes nothing', async () => {
    const result = await planWithNoModel();
    const shown = callResult('plan', result);
    assert.ok(shown.lines.some((line) => line.trim().startsWith('"runId"')),
      'the truncated JSON an operator could see yesterday must still be there');
    assert.ok(shown.lines.some((line) => /more lines$/.test(line)),
      'and it is still truncated VISIBLY — a reader who cannot see there was more takes this for the whole answer');
  });

  test('a command that only READS a run keeps its `— ok`, and still shows the run\'s authoring', async () => {
    // The browser suite caught this in the first draft: `/diff <run>` reads the stored run, which
    // carries the same `authoring` block, so a headline keyed on shape said `diff — nothing
    // written` — a sentence about the run being inspected, printed as the outcome of inspecting
    // it. A diff wrote nothing because a diff never writes anything.
    const result = await planWithNoModel();
    const read = callResult('diff', result);
    assert.equal(read.headline, 'diff — ok', 'the verb that reports is not the verb that authored');
    assert.ok(read.lines[0].startsWith('authoring: nothing written — '),
      'and the fact is still shown — /diff is a good place to see it, it is just not its outcome');
  });

  test('a result with no authoring block is untouched — the shaper keys on shape, not on the verb', () => {
    const shown = callResult('git', { available: true, branch: 'main' });
    assert.equal(shown.headline, 'git — ok');
    assert.deepEqual(shown.lines, callResult('git', { available: true, branch: 'main' }).lines);
    assert.ok(shown.lines[0].startsWith('{'), 'the generic path is still the truncated dump it always was');
  });

  test('refusals, degradations and discarded paths are named when present, absent when not', () => {
    const rich = callResult('plan', {
      runId: 'r1',
      authoring: {
        available: true, reason: null, authored: 0,
        refusals: [{ code: 'EMPTY', path: 'a.txt' }],
        degradations: [{ reason: 'atom unreachable' }],
        discarded: ['b.txt'],
      },
    });
    const joined = rich.lines.join('\n');
    assert.match(joined, /refused: EMPTY a\.txt/);
    assert.match(joined, /degraded: atom unreachable/, 'D-0312: the product carries on, never quietly');
    assert.match(joined, /discarded: b\.txt/);

    const plain = callResult('plan', { authoring: { available: true, reason: null, authored: 1 } }).lines.join('\n');
    assert.doesNotMatch(plain, /refused:|degraded:|discarded:/,
      'an empty list must print nothing at all — a row that is always there is a row nobody reads');
  });
});

describe('all three shells render through the one shaper — CE-033, checked against the sources', () => {
  /** Read from disk at every run, not asserted about from memory: the failure this guards is a
   *  fourth render site appearing, or one of these three quietly going back to `— ok`. */
  const SHELLS = Object.freeze([
    'apps/webui-static/app.js',
    'apps/webui-static/coden-terminal.js',
    'tools/tui-fullscreen.mjs',
  ]);

  test('each shell calls callResult(), and none of them prints a bare "— ok" for a call result', () => {
    for (const shell of SHELLS) {
      const source = readFileSync(join(REPO_ROOT, shell), 'utf8');
      assert.match(source, /callResult\(turn\.command, ?result\)/,
        `${shell} does not shape its call result through the shared decision`);
      assert.doesNotMatch(source, /`\$\{turn\.command\} — ok`/,
        `${shell} still prints a bare "— ok" for a call result: a run that wrote nothing would say ok`);
    }
  });

  test('the shaper lives in ONE file, and the shells import it rather than reimplementing it', () => {
    for (const shell of SHELLS) {
      const source = readFileSync(join(REPO_ROOT, shell), 'utf8');
      assert.match(source, /callResult/, `${shell} must import callResult`);
      assert.doesNotMatch(source, /function callResult/,
        `${shell} defines its own callResult — two shells that each decide what an answer means will disagree`);
    }
  });
});
