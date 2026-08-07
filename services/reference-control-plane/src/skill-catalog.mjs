// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The zero-load skill catalogue · `/skills`.
//
// WHY THIS FILE EXISTS, measured rather than assumed. `16` §4b.4 draws `/skills` in the one
// menu, under CONFIGURE, beside `/models` and `/settings`. It was never built:
// `17` line 158 records it, `agent-commands.js` carried a comment saying the entry is
// deliberately absent because "this product has no skills surface", and three sessions
// (s322, s326, s328) re-measured zero skill surfaces in `src/`. Drawing the menu entry
// without this file would be the failure rule 3 of §4b.4 names — a line that appears and has
// nowhere to go.
//
// WHAT A SKILL IS HERE, and why it is not a second tool catalogue. `15` §3.V puts both under
// one rule — "a riposo: zero strumenti, zero skill, zero plugin, zero connettori" — and states
// the reason in the sentence above it: tool schemas consume up to 72% of the context before
// the work begins. So the two share a discipline and differ in what they carry:
//
//   a TOOL  *does* something — its danger is effect, and `scopeRequestToTool()` makes an
//           undeclared effect impossible rather than forbidden.
//   a SKILL *tells the agent how* to do something — its payload is instructions, so its
//           danger is CONTEXT LOAD, which is precisely the cost `15` opens by naming.
//
// That difference is the whole design of this file, and it is mechanical, not stated:
// `searchCatalog()` never returns the `instructions` field. Not "should not" — the projection
// is built by naming the fields it keeps, so the body cannot travel with a search result even
// if a caller asks for it. Loading a skill's instructions requires `adopt()`, which is a
// deliberate act against a session. "Searchable, not a load" is therefore a property of the
// code path rather than a habit of its callers.
//
// Everything else deliberately mirrors `tool-catalog.mjs` rather than inventing a second
// posture: metadata-only search, provenance through the same generic document signer,
// a registry that starts EMPTY in every process, an at-rest status computed from the real
// registry instead of asserted, and NO textual denylist anywhere — a denylist of strings is
// beaten by any indirection, and passing one off as protection is worse than not having it.
//
// Adopting a skill runs nothing. It records that a set of instructions is in scope for a
// session; it does not fetch, unpack or execute anything. That would be EXECUTE, which stays
// permanently refused.

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { OPERATIONS } from './capability.mjs';
import { validateManifest as validateAgainstSchema } from './sector-modules.mjs';
import { verifyCompliancePackSignature } from './compliance-packs.mjs';

export class SkillCatalogError extends Error {
  constructor(kind, reason) {
    super(reason);
    this.name = 'SkillCatalogError';
    this.kind = kind;
    this.reason = reason;
  }
}

function refuse(kind, reason) {
  throw new SkillCatalogError(kind, reason);
}

function readJson(path) {
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; }
}

export function loadSkillCatalogSchema(productRoot) {
  const path = join(productRoot, 'schemas/skill-catalog-entry.schema.json');
  const schema = readJson(path);
  if (!schema || typeof schema.properties !== 'object') refuse('SCHEMA_MISSING', `${path} is missing or malformed`);
  return schema;
}

export function validateSkillEntry(candidate, schema) {
  const schemaResult = validateAgainstSchema(candidate, schema);
  if (!schemaResult.valid) return schemaResult;
  const errors = [];
  if (typeof candidate.instructions !== 'string' || candidate.instructions.trim().length === 0) {
    errors.push('"instructions" must be a non-empty string — a skill with no body is a menu entry with nothing behind it');
  }
  // Effects are OPTIONAL for a skill (many only change how the agent reasons), but a declared
  // one is held to exactly the tool catalogue's standard: same operation vocabulary, same
  // requirement to name where it applies. Two vocabularies for one concept is how `PANEL_NAMES`
  // came to say 14 against 25.
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
    found.push({ id:entry.name, path:join(dir, entry.name, 'skill.json') });
  }
  return { found, truncated };
}

/**
 * The metadata projection. Written as an explicit field list rather than as a delete of
 * `instructions`, because the two are not equivalent under change: a delete leaves every
 * future field exposed by default and this leaves them hidden by default. A skill's body is
 * the thing this whole file exists to keep out of the context until someone asks for it.
 */
function summarise(id, path, skill) {
  return {
    id,
    path,
    skill: {
      id: skill.id,
      name: skill.name,
      version: skill.version,
      publisher: skill.publisher,
      summary: skill.summary ?? '',
      declaredEffects: skill.declaredEffects ?? [],
      instructionBytes: Buffer.byteLength(skill.instructions, 'utf8'),
    },
  };
}

/**
 * Searches the catalogue by name substring or by declared operation, and returns METADATA
 * ONLY — never a skill's instructions. `instructionBytes` is deliberately present: it is the
 * one honest thing to say about a body you are refusing to hand over, and it lets a caller
 * see what adopting would cost before it costs it.
 *
 * `catalogRoot` is a runtime location, never baked into the image — the same posture as
 * `.tool-catalog` / `.sector-modules` / `.compliance-packs`.
 */
export function searchCatalog(productRoot, catalogRoot, query = {}, options = {}) {
  const maxEntries = options.maxEntries ?? 500;
  const schema = loadSkillCatalogSchema(productRoot);
  const { found, truncated } = findEntries(catalogRoot, maxEntries);
  const matches = [];
  const invalid = [];
  for (const { id, path } of found) {
    const candidate = readJson(path);
    if (!candidate) { invalid.push({ id, path, errors:['not valid JSON'] }); continue; }
    const result = validateSkillEntry(candidate, schema);
    if (!result.valid) { invalid.push({ id, path, errors:result.errors }); continue; }
    const haystack = `${candidate.name} ${candidate.summary ?? ''}`.toLowerCase();
    const matchesName = !query.name || haystack.includes(String(query.name).toLowerCase());
    const matchesEffect = !query.operation
      || (candidate.declaredEffects ?? []).some((effect) => effect.operations.includes(query.operation));
    if (matchesName && matchesEffect) matches.push(summarise(id, path, candidate));
  }
  return { scanned: found.length, truncated, matches, invalid };
}

export function verifySkillProvenance(skill, publicKeyPem) {
  return verifyCompliancePackSignature(skill, publicKeyPem);
}

/**
 * The skills in scope for a session. Starts EMPTY in every process — that is the at-rest rule,
 * and `skillCatalogStatus()` computes it from this registry rather than asserting it.
 */
export class AdoptedSkillRegistry {
  #adopted = new Map();

  /**
   * Brings a skill's instructions into scope for a session. Runs nothing: no fetch, no
   * unpack, no execution. Provenance is checked BEFORE anything is recorded, so a refusal
   * leaves the registry exactly as it was.
   */
  adopt(skill, { publicKeyPem, sessionId, permanent = false } = {}) {
    if (publicKeyPem) {
      let verified;
      try { verified = verifySkillProvenance(skill, publicKeyPem); }
      catch (error) { refuse('PROVENANCE_REFUSED', error.reason ?? String(error)); }
      if (!verified) refuse('BAD_SIGNATURE', `"${skill.id}" signature does not verify against the configured publisher key`);
    }
    this.#adopted.set(skill.id, { skill, sessionId: sessionId ?? null, permanent, adoptedAt: new Date().toISOString() });
    return { id: skill.id, adopted: true, instructionBytes: Buffer.byteLength(skill.instructions, 'utf8') };
  }

  drop(skillId) {
    const had = this.#adopted.delete(skillId);
    return { id: skillId, dropped: had };
  }

  /** A task's close, not a shutdown: everything not promoted permanent goes. */
  dropAll({ sessionId } = {}) {
    const dropped = [];
    for (const [id, entry] of this.#adopted) {
      if (entry.permanent) continue;
      if (sessionId && entry.sessionId !== sessionId) continue;
      this.#adopted.delete(id);
      dropped.push(id);
    }
    return dropped;
  }

  /** Metadata of what is in scope — again without the bodies. */
  list() {
    return [...this.#adopted.values()].map(({ skill, sessionId, permanent, adoptedAt }) => ({
      id: skill.id,
      name: skill.name,
      sessionId,
      permanent,
      adoptedAt,
      instructionBytes: Buffer.byteLength(skill.instructions, 'utf8'),
    }));
  }

  /** The body, to the one caller that has asked for it by id. */
  instructionsFor(skillId) {
    return this.#adopted.get(skillId)?.skill.instructions ?? null;
  }

  /** What a session actually costs in context right now — the number `15` §3.V is about. */
  contextBytes({ sessionId } = {}) {
    let total = 0;
    for (const entry of this.#adopted.values()) {
      if (sessionId && entry.sessionId !== sessionId && !entry.permanent) continue;
      total += Buffer.byteLength(entry.skill.instructions, 'utf8');
    }
    return total;
  }
}

export function skillCatalogStatus(adoptedRegistry) {
  const adopted = adoptedRegistry.list();
  return {
    atRest: adopted.length === 0,
    adoptedSkillCount: adopted.length,
    adoptedSkills: adopted,
    contextBytes: adoptedRegistry.contextBytes(),
    catalogSchemaSource: 'schemas/skill-catalog-entry.schema.json',
    searchReturnsInstructions: false,
    searchReturnsInstructionsReason: 'searchCatalog() builds its result from a named field list that has no "instructions" member, so a body cannot travel with a search result at all — the difference between a rule callers follow and one they cannot break.',
    denylist: false,
    adoptRunsCode: false,
    adoptRunsCodeReason: 'Adopting records that a set of instructions is in scope for a session. It does not fetch, unpack or execute anything — that would be EXECUTE, which stays permanently refused.',
    enforced: false,
    reason: 'The registry and its projection are real and measured, but nothing in the product yet composes an adopted skill into a Plan before the Author writes — that wiring is the next step, named here rather than implied.',
    rustTwin: false,
    rustTwinReason: 'Same posture as the tool catalogue: proposes and narrows, and never itself decides what a caller may reach — capability.mjs makes the actual grant.',
  };
}
