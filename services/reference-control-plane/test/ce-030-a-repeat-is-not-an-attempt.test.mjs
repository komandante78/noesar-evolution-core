// SPDX-License-Identifier: AGPL-3.0-or-later
//
// `CE-030` — *"Due autorature che producono lo stesso contenuto contano come **un** tentativo"*,
// verified as the row asks: *"compito che induce ripetizione, conteggio del budget di novità"*.
//
// WHAT WAS MEASURED BEFORE `D-0599`. `Author.author()` has accepted `previousAttemptDigests` and
// `attempts` since it was written, and computed `novelty: 'repeat' | 'novel'` from the first.
// `workspace-actions.mjs` is its ONLY call site in the product, and it passed neither. So:
//
//   * `novelty` was `'novel'` on every run the product had ever made — the `'repeat'` branch was
//     reachable from a test and from nowhere else;
//   * the prompt's "Approaches already tried on this step — do not repeat them" section never
//     once appeared in a real prompt;
//   * there was no BUDGET anywhere, so nothing counted anything.
//
// `15` §5 calls this "the only control that works on small models, which do not fail by stopping
// but by repeating themselves with confidence". It was present, wired to nothing, and reported as
// working by a field that had no way to say otherwise.
//
// So these tests drive the PRODUCT — `orchestrator.plan()`, not `Author` directly. A test that
// passed `previousAttemptDigests` by hand would prove the arithmetic and would have gone on
// passing for every one of the runs described above.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

import { Author } from '../src/author.mjs';
import { WorkspaceActionOrchestrator, WorkspaceActionError } from '../src/workspace-actions.mjs';
import { TokenMinter } from '../src/capability.mjs';
import { EventLedger } from '../src/events.mjs';

const NOW = Math.floor(Date.now() / 1000);
const fenced = (body) => `Here you go:\n\n\`\`\`js\n${body}\n\`\`\`\n`;

/** A bench whose model can be told what to answer next, so "the same content twice" is a fact of
 *  the run and not of the assertion. */
function bench({ noveltyBudget = 5 } = {}) {
  const workspace = mkdtempSync(join(tmpdir(), 'noesar-ce030-ws-'));
  const shadows = mkdtempSync(join(tmpdir(), 'noesar-ce030-sh-'));
  const runs = mkdtempSync(join(tmpdir(), 'noesar-ce030-runs-'));
  mkdirSync(join(workspace, 'src'), { recursive: true });
  writeFileSync(join(workspace, 'src/login.js'), 'export function loginRoute() {}\n');

  let answer = fenced('export function loginRoute() { /* first approach */ }\n');
  const promptsSeen = [];
  const author = new Author({
    generate: async ({ prompt }) => { promptsSeen.push(prompt); return answer; },
  });
  const events = new EventLedger();
  const orchestrator = new WorkspaceActionOrchestrator({
    workspaceRoot: workspace, shadowsRoot: shadows, minter: new TokenMinter(randomBytes(32)),
    events, author, runStoreDirectory: runs, noveltyBudget,
  });
  return {
    orchestrator, events, promptsSeen,
    say: (body) => { answer = fenced(body); },
    plan: (conversationId) => orchestrator.plan({
      request: 'rate limit the login route',
      files: [{ path: 'src/login.js', contents: 'export function loginRoute() {}\n' }],
      actor: 'owner', nowUnix: NOW, conversationId,
    }),
    cleanup: () => { for (const d of [workspace, shadows, runs]) rmSync(d, { recursive: true, force: true }); },
  };
}

// --- the criterion ------------------------------------------------------------------------

test('the same content authored twice is ONE attempt, counted by the product', async (t) => {
  const b = bench();
  t.after(b.cleanup);

  const first = await b.plan('conv-1');
  assert.equal(first.authoring.novelty, 'novel');
  assert.deepEqual(first.authoring.budget, { limit: 5, novelUsed: 1, repeatsIgnored: 0, remaining: 4 });

  // Same request, same conversation, and the model repeats itself with confidence — which is the
  // failure `15` §5 names, induced here on purpose.
  const second = await b.plan('conv-1');
  assert.equal(second.authoring.novelty, 'repeat',
    'the product itself must recognise the repeat; before D-0599 this was always `novel`');
  assert.deepEqual(second.authoring.budget, { limit: 5, novelUsed: 1, repeatsIgnored: 1, remaining: 4 },
    'a repeat consumes no budget — that is the whole criterion');

  // And a genuinely different approach does count.
  b.say('export function loginRoute() { /* a different approach entirely */ }\n');
  const third = await b.plan('conv-1');
  assert.equal(third.authoring.novelty, 'novel');
  assert.deepEqual(third.authoring.budget, { limit: 5, novelUsed: 2, repeatsIgnored: 1, remaining: 3 });
});

test('the repeat is judged on what came OUT, not on the request going in', async (t) => {
  const b = bench();
  t.after(b.cleanup);
  await b.plan('conv-2');
  // A different conversation is a different piece of work and starts fresh, even though the
  // request and the answer are identical.
  const other = await b.plan('conv-3');
  assert.equal(other.authoring.novelty, 'novel');
  assert.equal(other.authoring.budget.novelUsed, 1);
  // An unattached run has nothing to be a repeat of, and gets a full budget.
  const unattached = await b.plan(null);
  assert.equal(unattached.authoring.novelty, 'novel');
  assert.equal(unattached.authoring.budget.novelUsed, 1);
});

// --- the budget actually stops something ---------------------------------------------------

test('the novelty budget is spent by novel attempts only, and then the asking stops', async (t) => {
  const b = bench({ noveltyBudget: 2 });
  t.after(b.cleanup);

  b.say('approach one\n');
  const first = await b.plan('conv-4');
  assert.equal(first.authoring.budget.remaining, 1);

  // Two repeats in the middle. If a repeat consumed budget these would exhaust it, and the
  // second novel approach below would never be asked for — which is the bug this ordering is
  // built to catch rather than to describe.
  await b.plan('conv-4');
  await b.plan('conv-4');

  b.say('approach two\n');
  const second = await b.plan('conv-4');
  assert.equal(second.authoring.novelty, 'novel');
  assert.equal(second.authoring.budget.remaining, 0);
  assert.equal(second.authoring.budget.repeatsIgnored, 2);

  b.say('approach three\n');
  const refused = await b.plan('conv-4');
  assert.equal(refused.authoring.exhausted, true);
  assert.equal(refused.authoring.authored, 0);
  assert.match(refused.authoring.reason, /novelty budget for this piece of work is spent/);
  assert.match(refused.authoring.reason, /2 were ignored/, 'the refusal says the repeats did not count against it');
  // Refused BEFORE the model is asked: a budget that spends the call and then discards the
  // answer would cost exactly what it exists to save.
  const promptsBefore = b.promptsSeen.length;
  await b.plan('conv-4');
  assert.equal(b.promptsSeen.length, promptsBefore, 'the model was asked again after the budget was spent');
  // And the run still plans. Running out of novelty is not a reason to lose the plan.
  assert.equal(refused.status, 'PENDING_APPROVAL');
});

test('exhaustion is on the ledger, not only on the answer', async (t) => {
  const b = bench({ noveltyBudget: 1 });
  t.after(b.cleanup);
  await b.plan('conv-5');
  b.say('a second approach\n');
  const refused = await b.plan('conv-5');

  const actions = b.events.correlation(refused.runId).map((event) => event.action);
  assert.ok(actions.includes('workspace_action.authoring_budget_spent'),
    'an operator reading the ledger must be able to see why nothing was authored');
  const spent = b.events.correlation(refused.runId).find((e) => e.action === 'workspace_action.authoring_budget_spent');
  assert.deepEqual(JSON.parse(spent.payload), { limit: 1, novelUsed: 1, repeatsIgnored: 0 });
});

// --- the other half: the model is TOLD, not merely counted ---------------------------------

test('the second attempt carries what the first tried into the prompt', async (t) => {
  const b = bench();
  t.after(b.cleanup);
  await b.plan('conv-6');
  assert.doesNotMatch(b.promptsSeen[0], /Approaches already tried/,
    'the first attempt of a piece of work has nothing to avoid');

  b.say('a different approach\n');
  await b.plan('conv-6');
  const second = b.promptsSeen.at(-1);
  // Counting repeats without telling the model would measure the problem accurately and do
  // nothing about it. This is the half that reduces them.
  assert.match(second, /Approaches already tried on this step — do not repeat them:/);
  assert.match(second, /rate limit the login route → src\/login\.js/);
});

// --- configuration ---------------------------------------------------------------------------

test('a budget that could never stop anything is refused at construction', () => {
  const workspace = mkdtempSync(join(tmpdir(), 'noesar-ce030-cfg-ws-'));
  const shadows = mkdtempSync(join(tmpdir(), 'noesar-ce030-cfg-sh-'));
  const build = (noveltyBudget) => new WorkspaceActionOrchestrator({
    workspaceRoot: workspace, shadowsRoot: shadows,
    minter: new TokenMinter(randomBytes(32)), events: new EventLedger(), noveltyBudget,
  });
  for (const bad of [0, -1, 1.5, '3', null]) {
    // `kind`, not `code`: `WorkspaceActionError` names its discriminator `kind`, and asserting
    // on the wrong one turned "it threw the right refusal" into "it was accepted" — the test
    // reporting a defect the product did not have.
    assert.throws(() => build(bad), (error) => error instanceof WorkspaceActionError
      && error.kind === 'INVALID_NOVELTY_BUDGET', `noveltyBudget=${String(bad)} was accepted`);
  }
  assert.doesNotThrow(() => build(1));
  for (const d of [workspace, shadows]) rmSync(d, { recursive: true, force: true });
});
