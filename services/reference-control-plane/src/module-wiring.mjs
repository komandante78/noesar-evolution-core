// SPDX-License-Identifier: AGPL-3.0-or-later
//
// D-0283: a module you uninstall has to leave NOESAR intact. Owner instruction (s302),
// verbatim: "disinstallare debug evolution deve lasciare noesar intatto".
//
// It did not. `NOESAR_DEBUG_EVOLUTION_URL`/`_TOKEN` are environment variables on NOESAR's
// OWN container, so every piece of wiring that read them was live whether the module was
// installed, deactivated, or never installed at all: the three Agents/Workflows tools were
// re-seeded with a working credential on every boot, the console proxy listened on 8089,
// and the module's service account kept a valid token. Removing the module meant editing
// Docker, which is exactly what a module system exists to avoid.
//
// The correction is one sentence: the ENVIRONMENT says WHERE the module is, the INSTALL
// STATE (`sector-modules/<id>/state.json`, D-0274) says WHETHER NOESAR talks to it. This
// file is the only place that reads the second question, so the answer cannot drift
// between the tool seeder, the proxy, and the catalog the way it did between
// `modules-registry.mjs` and `owner-module-catalog.mjs`.
//
// Detach disables and strips the credential; it does not delete the tool rows. A tool row
// may be referenced by an agent's `toolIds` or a workflow step, and deleting it would turn
// an uninstall into a 404 inside somebody's saved agent — `disabled` is refused at both
// execution paths that exist (`tool-executor.mjs`'s `execute()` and `workflow-service.mjs`),
// so the capability is really gone while the reference stays resolvable. Re-installing
// re-attaches the same rows rather than growing a second copy.

import { loadModuleState, readInstalledManifest } from './sector-modules.mjs';

/** Lifecycle as the rest of the server should see it. `uninstalled` is reported as itself,
 * not folded into `not-installed`: the catalog maps it to "installable again" for display,
 * but an audit reader must be able to tell "never installed here" from "removed". */
export function moduleLifecycleStatus(sectorModulesRoot, id) {
  const manifest = readInstalledManifest(sectorModulesRoot, id);
  if (!manifest) return 'not-installed';
  const state = loadModuleState(sectorModulesRoot, id);
  return state?.status ?? 'installed';
}

export function isModuleActive(sectorModulesRoot, id) {
  return moduleLifecycleStatus(sectorModulesRoot, id) === 'active';
}

/**
 * The three read-only Debug Evolution tools (D-0278). One list, used by BOTH attach and
 * detach — the previous inline array in server.mjs could only ever add, so nothing knew
 * which rows to take away again.
 */
export function debugEvolutionToolSeeds(baseUrl) {
  const base = String(baseUrl ?? '').replace(/\/$/, '');
  return [
    { name: 'Debug Evolution — List Projects', description: 'The repositories Debug Evolution has registered and scanned.', endpoint: `${base}/api/v2/projects`, config: { method: 'GET' } },
    { name: 'Debug Evolution — All Findings', description: 'Every finding Debug Evolution has recorded, across every registered project.', endpoint: `${base}/api/v2/findings`, config: { method: 'GET' } },
    { name: 'Debug Evolution — SARIF Report', description: 'A SARIF 2.1.0 report of every current finding, for tools that consume that format.', endpoint: `${base}/api/v2/sarif`, config: { method: 'GET' } },
  ];
}

/**
 * Brings the tool rows into line with the module's lifecycle, in both directions.
 *
 * `active && token` -> the rows exist, point at the CURRENT endpoint (D-0281's reconcile,
 * kept: dedup by name alone let a boot with a changed URL keep the old address forever),
 * are enabled, and hold the credential.
 * anything else -> the rows are disabled and hold no credential.
 *
 * Returns a summary instead of logging directly so the caller owns the log line and the
 * tests can assert on the outcome without a logger double.
 */
export function reconcileModuleTools({ active, seeds, token, store, agentService }) {
  const summary = { attached: [], reconciled: [], detached: [], unchanged: [] };
  const shouldAttach = Boolean(active && token);
  for (const seed of seeds) {
    const current = store.read().tools.find((tool) => tool.name === seed.name);
    if (shouldAttach) {
      if (!current) {
        const tool = agentService.registerTool({
          name: seed.name, description: seed.description, transport: 'local-http', endpoint: seed.endpoint,
          config: seed.config, external: false, mutative: false, requiresApproval: false,
        }, 'system');
        agentService.setToolCredential(tool.id, token);
        summary.attached.push(seed.name);
        continue;
      }
      const needsEndpoint = current.endpoint !== seed.endpoint;
      const needsEnable = current.disabled === true;
      const needsCredential = !current.encryptedCredential;
      if (!needsEndpoint && !needsEnable && !needsCredential) { summary.unchanged.push(seed.name); continue; }
      if (needsEndpoint || needsEnable) {
        store.transact((state) => {
          const tool = state.tools.find((item) => item.id === current.id);
          tool.endpoint = seed.endpoint;
          tool.disabled = false;
          tool.updatedAt = new Date().toISOString();
        });
      }
      if (needsCredential) agentService.setToolCredential(current.id, token);
      summary.reconciled.push(seed.name);
      continue;
    }
    if (!current) { summary.unchanged.push(seed.name); continue; }
    if (current.disabled === true && !current.encryptedCredential) { summary.unchanged.push(seed.name); continue; }
    store.transact((state) => {
      const tool = state.tools.find((item) => item.id === current.id);
      tool.disabled = true;
      tool.encryptedCredential = null;
      tool.credentialEphemeral = false;
      tool.updatedAt = new Date().toISOString();
    });
    summary.detached.push(seed.name);
  }
  return summary;
}
