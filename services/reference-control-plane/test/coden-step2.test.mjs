// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Passo 2, measured live on 2026-09-22: a file named only as a reference became a file to rewrite;
// `status` without a slash was answered "no model wired for prose" in one terminal and run in the
// next; and the app panel's terminal had no `plan` and printed raw JSON.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { groundRequest } from '../src/request-grounding.mjs';
import { WorkspaceActionOrchestrator } from '../src/workspace-actions.mjs';
import { TokenMinter } from '../src/capability.mjs';
import { EventLedger } from '../src/events.mjs';
import { planTurn } from '../../../apps/webui-static/coden-view-model.js';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const roots = [];
test.after(() => { for (const root of roots) rmSync(root, { recursive: true, force: true }); });
const scratch = (label) => { const dir = mkdtempSync(join(tmpdir(), `noesar-step2-${label}-`)); roots.push(dir); return dir; };

function workspaceWithProgram() {
  const root = scratch('ws');
  mkdirSync(join(root, 'programmi'));
  writeFileSync(join(root, 'programmi/somma.mjs'), 'console.log(Number(process.argv[2]) + Number(process.argv[3]));\n');
  return root;
}
const REQUEST = 'Create a new file programmi/LEGGIMI.md that explains in Italian how to run programmi/somma.mjs';

test('a file named beside a NEW one is read for the author, never planned as a target', () => {
  const ground = groundRequest({ workspaceRoot: workspaceWithProgram(), goal: 'x', request: REQUEST });
  assert.deepEqual(ground.files, [{ path: 'programmi/LEGGIMI.md', contents: '' }]);
  assert.deepEqual(ground.context.map((file) => file.path), ['programmi/somma.mjs']);
  assert.deepEqual(ground.grounding.context, ['programmi/somma.mjs'], 'whoever approves sees what was read');
});

test('with no new file named, a named existing file is still the target — repairing is unchanged', () => {
  const ground = groundRequest({ workspaceRoot: workspaceWithProgram(), goal: 'x', request: 'fix programmi/somma.mjs' });
  assert.deepEqual(ground.files.map((file) => file.path), ['programmi/somma.mjs']);
  assert.deepEqual(ground.grounding.context, []);
});

test('the author is shown the referenced file\'s contents, and is asked to write only the new one', async () => {
  const seen = [];
  const author = {
    available: true,
    async author({ files, background }) {
      seen.push({ paths: files.map((file) => file.path), background });
      return { contents: new Map(files.map((file) => [file.path, '# LEGGIMI\n'])), unchanged: [], refusals: [],
        fixtures: [], calls: [], discarded: [], summary: { authored: files.length, digest: 'd' }, novelty: 'novel' };
    },
  };
  const orch = new WorkspaceActionOrchestrator({
    workspaceRoot: workspaceWithProgram(), shadowsRoot: scratch('sh'),
    minter: new TokenMinter(randomBytes(32)), events: new EventLedger(), author,
  });
  await orch.plan({ request: REQUEST, actor: 't', nowUnix: Math.floor(Date.now() / 1000) });
  assert.deepEqual(seen[0].paths, ['programmi/LEGGIMI.md']);
  assert.ok(seen[0].background.startsWith(REQUEST));
  assert.ok(seen[0].background.includes('--- programmi/somma.mjs\nconsole.log('), 'the program the new file is about is in front of the model');
});

test('a bare command word is named with its slash, and not run', () => {
  const commands = [{ name: 'status', argument: '', summary: 's' }, { name: 'plan', argument: '<goal>', summary: 'p' }];
  const turn = planTurn('status', { resolve: () => null, parse: () => ({}), commands });
  assert.equal(turn.kind, 'unknown');
  assert.equal(turn.message, 'Commands start with / here — did you mean /status?');
  const prose = planTurn('make it faster', { resolve: () => null, parse: () => ({}), commands });
  assert.match(prose.message, /no model wired for prose/, 'a sentence that is not a command keeps its answer');
});

test('the app panel\'s terminal takes the slash or not, plans, and shapes answers like the others', () => {
  const source = readFileSync(join(REPO_ROOT, 'apps/webui-static/app.js'), 'utf8');
  const body = source.slice(source.indexOf('async function runTerminalCommand'), source.indexOf('function renderTerminals'));
  assert.match(body, /replace\(\/\^\\\/\/,''\)/, 'a leading slash is accepted');
  assert.match(body, /case 'plan':method='workspace\.plan'/);
  assert.match(body, /callResult\(command,response\.result\)/);
  assert.doesNotMatch(body, /JSON\.stringify\(response\.result/, 'no raw dump of its own');
  assert.match(body, /WORKING_NOTE/);
});
