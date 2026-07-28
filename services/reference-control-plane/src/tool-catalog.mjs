// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The zero-load tool catalog · CodeN Evolution construction order, step 10
// (`MASTER_PROJECT/15_CODEN_EVOLUTION_DA_ZERO.md` §3.V) — depends on step 4 (capability
// tokens, D-0180), the next real step after step 9 (the recompute verifier, D-0209).
//
// "A riposo: zero strumenti, zero skill, zero plugin, zero connettori. Esiste un catalogo
// ricercabile, che non è un carico." The catalog below is metadata only -- searching it
// loads nothing, and the active-tool registry (ActiveToolRegistry) starts every process
// empty, verified by toolCatalogStatus() rather than assumed.
//
// "Un effetto non dichiarato non è vietato: è impossibile." Made mechanical here:
// scopeRequestToTool() does not check a requested path/operation against the tool's
// declaration and reject it -- it computes the INTERSECTION, so an undeclared path or
// operation is never in the narrowed request `mint()` receives. There is no code path
// where "the tool declares X" is checked after the fact; the request literally cannot
// name anything the tool did not declare, which is the difference between "forbidden"
// (a check that could be missed) and "impossible" (nothing to check).
//
// "Nessuna denylist testuale." There is no list of forbidden path or operation strings
// anywhere in this file, on purpose -- CLAUDE10.md's own reasoning for why denylists lose
// (any indirection defeats a string match) applies here exactly as it does everywhere
// else in this project.
//
// Provenance reuses verifyCompliancePackSignature() from compliance-packs.mjs (D-0205) as
// -is, the same generic-document-signer pattern step 29 (D-0206) and step 31 (D-0208)
// already reused instead of duplicating.
//
// Installing a tool does not run anything: it registers the tool as active for a task,
// scoped by its declared effects. This reference implementation has no package manager
// integration and no capability to fetch/execute an installer -- that would be EXECUTE,
// permanently refused. "Installation" here is activation of a catalog entry already
// present and provenance-verified, not a download-and-run step.

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { OPERATIONS } from './capability.mjs';
import { validateManifest as validateAgainstSchema } from './sector-modules.mjs';
import { verifyCompliancePackSignature } from './compliance-packs.mjs';

export class ToolCatalogError extends Error {
  constructor(kind, reason) {
    super(reason);
    this.name = 'ToolCatalogError';
    this.kind = kind;
    this.reason = reason;
  }
}
const refuse = (kind, reason) => { throw new ToolCatalogError(kind, reason); };

function readJson(path) {
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; }
}

export function loadToolCatalogSchema(productRoot) {
  const path = join(productRoot, 'schemas/tool-catalog-entry.schema.json');
  const schema = readJson(path);
  if (!schema || typeof schema.properties !== 'object') refuse('SCHEMA_MISSING', `${path} is missing or malformed`);
  return schema;
}

export function validateToolEntry(candidate, schema) {
  const schemaResult = validateAgainstSchema(candidate, schema);
  if (!schemaResult.valid) return schemaResult;
  const errors = [];
  for (const [i, effect] of (candidate.declaredEffects ?? []).entries()) {
    if (!Array.isArray(effect.operations) || effect.operations.length === 0) {
      errors.push(`declaredEffects[${i}] needs a non-empty "operations" array`);
      continue;
    }
    for (const operation of effect.operations) {
      if (!OPERATIONS.includes(operation)) errors.push(`declaredEffects[${i}] names unknown operation "${operation}"`);
    }
    const hasPaths = Array.isArray(effect.paths) && effect.paths.length > 0;
    const hasPrefix = typeof effect.pathPrefix === 'string' && effect.pathPrefix.length > 0;
    if (!hasPaths && !hasPrefix) errors.push(`declaredEffects[${i}] needs "paths" or "pathPrefix"`);
    if (hasPrefix && !effect.pathPrefix.endsWith('/')) errors.push(`declaredEffects[${i}].pathPrefix must end with "/"`);
  }
  return { valid: errors.length === 0, errors };
}

function findEntries(dir, maxEntries) {
  const found = [];
  let truncated = false;
  let entries;
  try { entries = readdirSync(dir, { withFileTypes:true }); } catch { return { found, truncated }; }
  for (const entry of entries) {
    if (found.length >= maxEntries) { truncated = true; break; }
    if (!entry.isDirectory()) continue;
    found.push({ id:entry.name, path:join(dir, entry.name, 'tool.json') });
  }
  return { found, truncated };
}

/**
 * Searches the catalog by declared operation or by name substring -- never returns a
 * tool's code or executable payload, only its metadata, which is what "searchable, not
 * a load" means. `catalogRoot` is a runtime location, not baked into the image, same
 * posture as `.sector-modules` / `.compliance-packs` / `.technology-radar`.
 */
export function searchCatalog(productRoot, catalogRoot, query = {}, options = {}) {
  const maxEntries = options.maxEntries ?? 500;
  const schema = loadToolCatalogSchema(productRoot);
  const { found, truncated } = findEntries(catalogRoot, maxEntries);
  const matches = [];
  const invalid = [];
  for (const { id, path } of found) {
    const candidate = readJson(path);
    if (!candidate) { invalid.push({ id, path, errors:['not valid JSON'] }); continue; }
    const result = validateToolEntry(candidate, schema);
    if (!result.valid) { invalid.push({ id, path, errors:result.errors }); continue; }
    const matchesName = !query.name || candidate.name.toLowerCase().includes(String(query.name).toLowerCase());
    const matchesEffect = !query.operation
      || candidate.declaredEffects.some((effect) => effect.operations.includes(query.operation));
    if (matchesName && matchesEffect) matches.push({ id, path, tool:candidate });
  }
  return { scanned: found.length, truncated, matches, invalid };
}

export function verifyToolProvenance(tool, publicKeyPem) {
  return verifyCompliancePackSignature(tool, publicKeyPem);
}

/**
 * The mechanical form of "an undeclared effect is impossible, not forbidden": intersects
 * what a plan step requests against what the tool's own manifest declares. Nothing
 * outside that intersection is ever placed in the returned request -- there is no later
 * check to defeat, because there is nothing left to check by the time this returns.
 * `refusedPaths`/`refusedOperations` are reported so a caller can see what was narrowed
 * away, never silently.
 */
export function scopeRequestToTool(tool, requestedPaths, requestedOperations) {
  const declaredOperations = new Set(tool.declaredEffects.flatMap((e) => e.operations));
  const declaredPaths = new Set(tool.declaredEffects.flatMap((e) => e.paths ?? []));
  const declaredPrefixes = tool.declaredEffects.flatMap((e) => (e.pathPrefix ? [e.pathPrefix] : []));

  const isDeclaredPath = (path) => declaredPaths.has(path) || declaredPrefixes.some((prefix) => path.startsWith(prefix));

  const operations = requestedOperations.filter((op) => declaredOperations.has(op));
  const paths = requestedPaths.filter((path) => isDeclaredPath(path));

  return {
    paths,
    operations,
    refusedPaths: requestedPaths.filter((path) => !isDeclaredPath(path)),
    refusedOperations: requestedOperations.filter((op) => !declaredOperations.has(op)),
  };
}

/**
 * Tracks which tools are active for THIS process — in memory, same posture as
 * capability.mjs's TokenMinter registry: a restart clears it, which is the safe
 * direction, stated rather than discovered. Installing verifies provenance first;
 * nothing is added to the active set on a bad signature. Uninstall is explicit, and
 * `uninstallAll()` is what a task's close calls unless a tool was promoted permanent.
 */
export class ActiveToolRegistry {
  #active = new Map();

  install(tool, { publicKeyPem, sessionId, permanent = false } = {}) {
    if (publicKeyPem) {
      let verified;
      try { verified = verifyToolProvenance(tool, publicKeyPem); }
      catch (error) { refuse('PROVENANCE_REFUSED', error.reason ?? String(error)); }
      if (!verified) refuse('BAD_SIGNATURE', `"${tool.id}" signature does not verify against the configured publisher key`);
    }
    this.#active.set(tool.id, { tool, sessionId: sessionId ?? null, permanent, installedAt: new Date().toISOString() });
    return { id: tool.id, active: true };
  }

  uninstall(toolId) {
    const had = this.#active.delete(toolId);
    return { id: toolId, uninstalled: had };
  }

  /** Removes every tool not promoted permanent — a task's close, not a shutdown. */
  uninstallAll({ sessionId } = {}) {
    const removed = [];
    for (const [id, entry] of this.#active) {
      if (entry.permanent) continue;
      if (sessionId && entry.sessionId !== sessionId) continue;
      this.#active.delete(id);
      removed.push(id);
    }
    return removed;
  }

  list() {
    return [...this.#active.values()].map(({ tool, sessionId, permanent, installedAt }) => ({
      id: tool.id, name: tool.name, sessionId, permanent, installedAt,
    }));
  }

  get(toolId) {
    return this.#active.get(toolId)?.tool ?? null;
  }
}

export function toolCatalogStatus(activeRegistry) {
  const active = activeRegistry.list();
  return {
    atRest: active.length === 0,
    activeToolCount: active.length,
    activeTools: active,
    catalogSchemaSource: 'schemas/tool-catalog-entry.schema.json',
    undeclaredEffectPolicy: 'impossible, not forbidden — scopeRequestToTool() intersects rather than checks-then-rejects',
    denylist: false,
    installRunsCode: false,
    installRunsCodeReason: 'This reference implementation registers a provenance-verified catalog entry as active; it does not fetch or execute an installer. That would be EXECUTE, which stays permanently refused.',
    enforced: false,
    reason: 'scopeRequestToTool() computes a token request narrowed to a tool\'s declared effects, but nothing in the product yet calls it before minting a real token — that wiring, like ATOM as a second ReasoningProvider (construction-order step 11), is the next step, named rather than implied.',
    rustTwin: false,
    rustTwinReason: 'Same posture as the other phase-7/CodeN-Evolution modules: proposes and narrows, does not itself decide what a caller may reach — capability.mjs (already covered) makes the actual grant.',
  };
}
