// SPDX-License-Identifier: AGPL-3.0-or-later
//
// D-0283, the unit half: the module wiring reads the INSTALL STATE, not the environment,
// and it moves in both directions. Owner instruction (s302), verbatim: "disinstallare debug
// evolution deve lasciare noesar intatto" -- before this, the three Debug Evolution tools
// were re-seeded with a live credential on every boot for as long as the container carried
// NOESAR_DEBUG_EVOLUTION_TOKEN, whether or not the module was installed.
//
// Real AgentService, real AtomicJsonStore, real CredentialVault -- the point of the test is
// that the tools a real deployment holds are really disarmed, which a fake store could
// assert about itself without it being true anywhere.

import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { AtomicJsonStore } from '../src/ai-workspace/atomic-store.mjs';
import { CredentialVault } from '../src/ai-workspace/credential-vault.mjs';
import { AgentService } from '../src/ai-workspace/agent-service.mjs';
import { moduleLifecycleStatus, isModuleActive, debugEvolutionToolSeeds, reconcileModuleTools } from '../src/module-wiring.mjs';
import { OWNER_MODULE_CATALOG } from '../src/owner-module-catalog.mjs';

const TOKEN = 'stub-debug-evolution-token';
const URL_A = 'http://debug-evolution:8787';
const URL_B = 'http://debug-evolution-moved:9797';

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'noesar-module-wiring-'));
  const store = new AtomicJsonStore(join(dir, 'ai-workspace.json'));
  const vault = new CredentialVault({ keyPath: join(dir, 'vault.key') });
  const agentService = new AgentService({ store, ledger: null, vault });
  return { dir, store, agentService, sectorModulesRoot: join(dir, 'sector-modules') };
}

function writeModuleState(sectorModulesRoot, status) {
  const moduleRoot = join(sectorModulesRoot, 'debug-evolution');
  mkdirSync(moduleRoot, { recursive: true });
  writeFileSync(join(moduleRoot, 'manifest.json'), JSON.stringify(OWNER_MODULE_CATALOG[0].buildManifest()));
  writeFileSync(join(moduleRoot, 'state.json'), JSON.stringify({
    status, installedAtUnix: 1, activatedAtUnix: status === 'active' ? 2 : null, deactivatedAtUnix: null, history: [],
  }));
}

function toolsByName(store) {
  return Object.fromEntries(store.read().tools.map((tool) => [tool.name, tool]));
}

describe('D-0283 — module lifecycle is what decides whether NOESAR is wired to the module', () => {
  test('moduleLifecycleStatus reports not-installed for a root with nothing in it', () => {
    const { sectorModulesRoot, dir } = fixture();
    assert.equal(moduleLifecycleStatus(sectorModulesRoot, 'debug-evolution'), 'not-installed');
    assert.equal(isModuleActive(sectorModulesRoot, 'debug-evolution'), false);
    rmSync(dir, { recursive: true, force: true });
  });

  test('moduleLifecycleStatus distinguishes installed, active and uninstalled', () => {
    const { sectorModulesRoot, dir } = fixture();
    writeModuleState(sectorModulesRoot, 'installed');
    assert.equal(moduleLifecycleStatus(sectorModulesRoot, 'debug-evolution'), 'installed');
    assert.equal(isModuleActive(sectorModulesRoot, 'debug-evolution'), false, 'installed is not active');
    writeModuleState(sectorModulesRoot, 'active');
    assert.equal(isModuleActive(sectorModulesRoot, 'debug-evolution'), true);
    writeModuleState(sectorModulesRoot, 'uninstalled');
    assert.equal(moduleLifecycleStatus(sectorModulesRoot, 'debug-evolution'), 'uninstalled', 'an uninstalled module keeps its manifest but is not installed');
    assert.equal(isModuleActive(sectorModulesRoot, 'debug-evolution'), false);
    rmSync(dir, { recursive: true, force: true });
  });

  test('active + token: the three tools are registered, enabled, and hold a credential', () => {
    const { store, agentService, dir } = fixture();
    const summary = reconcileModuleTools({ active: true, token: TOKEN, seeds: debugEvolutionToolSeeds(URL_A), store, agentService });
    assert.equal(summary.attached.length, 3);
    const tools = toolsByName(store);
    assert.equal(store.read().tools.length, 3);
    for (const seed of debugEvolutionToolSeeds(URL_A)) {
      assert.equal(tools[seed.name].endpoint, seed.endpoint);
      assert.equal(tools[seed.name].disabled, false);
      assert.ok(tools[seed.name].encryptedCredential, `${seed.name} must hold a credential`);
    }
    rmSync(dir, { recursive: true, force: true });
  });

  test('not active: the same tools are disabled and stripped of their credential, and the rows survive', () => {
    const { store, agentService, dir } = fixture();
    reconcileModuleTools({ active: true, token: TOKEN, seeds: debugEvolutionToolSeeds(URL_A), store, agentService });
    const idsBefore = store.read().tools.map((tool) => tool.id).sort();

    const summary = reconcileModuleTools({ active: false, token: TOKEN, seeds: debugEvolutionToolSeeds(URL_A), store, agentService });
    assert.equal(summary.detached.length, 3);
    const tools = toolsByName(store);
    for (const seed of debugEvolutionToolSeeds(URL_A)) {
      assert.equal(tools[seed.name].disabled, true, `${seed.name} must be disabled — tool-executor.mjs refuses a disabled tool`);
      assert.equal(tools[seed.name].encryptedCredential, null, `${seed.name} must not keep the module credential`);
    }
    // The rows stay so an agent or workflow step that references one still resolves; the
    // capability is what goes away, not the reference.
    assert.deepEqual(store.read().tools.map((tool) => tool.id).sort(), idsBefore);
    rmSync(dir, { recursive: true, force: true });
  });

  test('a second detach is a no-op, not a repeated write', () => {
    const { store, agentService, dir } = fixture();
    reconcileModuleTools({ active: true, token: TOKEN, seeds: debugEvolutionToolSeeds(URL_A), store, agentService });
    reconcileModuleTools({ active: false, token: TOKEN, seeds: debugEvolutionToolSeeds(URL_A), store, agentService });
    const again = reconcileModuleTools({ active: false, token: TOKEN, seeds: debugEvolutionToolSeeds(URL_A), store, agentService });
    assert.equal(again.detached.length, 0);
    assert.equal(again.unchanged.length, 3);
    rmSync(dir, { recursive: true, force: true });
  });

  test('re-installing re-arms the SAME rows: no duplicates, credential back, endpoint current', () => {
    const { store, agentService, dir } = fixture();
    reconcileModuleTools({ active: true, token: TOKEN, seeds: debugEvolutionToolSeeds(URL_A), store, agentService });
    const idsBefore = store.read().tools.map((tool) => tool.id).sort();
    reconcileModuleTools({ active: false, token: TOKEN, seeds: debugEvolutionToolSeeds(URL_A), store, agentService });

    // The module comes back at a different address, the case D-0281 was opened for.
    const summary = reconcileModuleTools({ active: true, token: TOKEN, seeds: debugEvolutionToolSeeds(URL_B), store, agentService });
    assert.equal(summary.reconciled.length, 3);
    assert.equal(summary.attached.length, 0, 'a re-install must not register a second copy of each tool');
    assert.deepEqual(store.read().tools.map((tool) => tool.id).sort(), idsBefore);
    const tools = toolsByName(store);
    for (const seed of debugEvolutionToolSeeds(URL_B)) {
      assert.equal(tools[seed.name].endpoint, seed.endpoint);
      assert.equal(tools[seed.name].disabled, false);
      assert.ok(tools[seed.name].encryptedCredential);
    }
    rmSync(dir, { recursive: true, force: true });
  });

  test('active but no token configured: nothing is registered, and nothing throws', () => {
    const { store, agentService, dir } = fixture();
    const summary = reconcileModuleTools({ active: true, token: null, seeds: debugEvolutionToolSeeds(URL_A), store, agentService });
    assert.equal(summary.attached.length, 0);
    assert.equal(store.read().tools.length, 0);
    rmSync(dir, { recursive: true, force: true });
  });
});
