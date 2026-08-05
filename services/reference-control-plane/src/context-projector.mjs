// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Invention I — the context is a projection, not an accumulation (`D-0107`).
//
// Measured on this repository before this file existed (`EVIDENCE/phase4-measure-*.txt`):
// the array handed to the model grew from 8 entries / 1 044 bytes at call 3 to 602 entries /
// 85 190 bytes at call 300 — ×81.6, and not even the same shape, because the run of roles a
// component would have to reconstruct is a different run every time. That is the growth
// `15` §2 blames for coherence breaking after 25–30 calls, and summarising it is not the
// cure: the summary is the corruption vector.
//
// So there is no transcript here. The session's state is a set of typed FACTS, each one
// belonging to a named section with a schema, and every call to the model receives a view
// rebuilt from zero out of those facts — deterministic, ordered, and bounded by construction.
//
// The binding rule, and the one this module exists to make enforceable:
//
//   > No component may append free text. Whoever wants to influence the model WRITES INTO
//   > THE STATE, and the state has a schema.
//
// There is deliberately no `append`, no `note`, no `text` section and no escape hatch. A
// section that is not in `CONTEXT_SECTIONS`, a field that is not in that section's schema,
// a value of the wrong type or past its declared maximum — each is refused at write time,
// with the section and the field named. `CE-004` is the test that proves the refusal fires.
//
// What is bounded, and what is not, said plainly: the STORE may hold as many facts as the
// session produces — it is the record, and a record that forgets is not a record. The
// PROJECTION is capped per section, and what it left out it DECLARES (`held 41, showing 6`).
// Silent truncation would be the same lie as an automatic summary, only cheaper.

import { canonicalJson } from './canonical-json.mjs';

/** Raised when a component tries to write something the state has no schema for. */
export class ContextSchemaViolation extends Error {
  constructor(section, field, detail) {
    super(`context state refuses this write: section \`${section}\`, ${field ? `field \`${field}\`: ` : ''}${detail}`);
    this.name = 'ContextSchemaViolation';
    this.status = 400;
    this.section = section;
    this.field = field ?? null;
    this.detail = detail;
  }
}

const str = (max) => ({ kind: 'string', max });
const int = (min, max) => ({ kind: 'integer', min, max });
const bool = () => ({ kind: 'boolean' });
const oneOf = (...values) => ({ kind: 'enum', values });
const list = (max, itemMax) => ({ kind: 'list', max, itemMax });

/**
 * The sections, in the order the model sees them, and nothing else is a section.
 *
 * They are exactly what invention I names as the state — «Piano, evidenze, domande aperte,
 * diff corrente, firme di fallimento, token attivi» — plus the goal the work serves, the
 * approaches already tried (`15` §5: budget on novelty, not on effort) and the repository's
 * own signals, which is where invention II plugs in when phase 7 connects it.
 *
 * `cardinality: 'one'` means the section holds a single current value and a second write
 * replaces it: there is one goal, not a history of goals. Everything else is a list, capped
 * at `show` entries in the projection.
 */
export const CONTEXT_SECTIONS = Object.freeze([
  {
    name: 'goal', title: 'GOAL', cardinality: 'one', show: 1,
    fields: { text: str(400), nonGoals: list(5, 120), criteria: list(8, 160) },
    required: ['text'],
  },
  {
    // Capped by a WINDOW around the active step rather than by the first eight: at call 300
    // the first eight steps are the ones that stopped mattering, and the current step is the
    // one deviating from requires contradicting rather than merely forgetting.
    name: 'plan', title: 'PLAN', cardinality: 'many', show: 8, window: 'active',
    fields: { step: int(1, 10_000), verb: str(40), target: str(200), status: oneOf('pending', 'active', 'done', 'failed') },
    required: ['step', 'verb', 'status'],
  },
  {
    name: 'evidence', title: 'EVIDENCE', cardinality: 'many', show: 6,
    fields: { claim: str(240), source: str(160), recomputed: bool() },
    required: ['claim', 'recomputed'],
  },
  {
    // Stage 3 of the sixteen, the one `15` calls the cheapest and the most skipped. Blocking
    // questions sort first so a cap can never be the reason one stopped being visible.
    name: 'questions', title: 'OPEN QUESTIONS', cardinality: 'many', show: 4, rank: (value) => (value.blocking ? 1 : 0),
    fields: { question: str(240), blocking: bool() },
    required: ['question', 'blocking'],
  },
  {
    name: 'diff', title: 'CURRENT DIFF', cardinality: 'many', show: 10,
    fields: { path: str(200), added: int(0, 1_000_000), removed: int(0, 1_000_000) },
    required: ['path', 'added', 'removed'],
  },
  {
    // Normalised at the source (`15` §6): a stack trace carries paths and VALUES, and without
    // normalisation "the memory never contains your data" would be false. This section stores
    // what it is given; the normalisation duty sits with the writer and is stated here so the
    // duty has a place to be read.
    name: 'failures', title: 'FAILURE SIGNATURES', cardinality: 'many', show: 4,
    fields: { signature: str(200), occurrences: int(1, 1_000_000) },
    required: ['signature', 'occurrences'],
  },
  {
    name: 'tokens', title: 'ACTIVE AUTHORITY', cardinality: 'many', show: 4,
    fields: { tokenId: str(64), scope: str(120), expiresAtUnix: int(0, 4_102_444_800) },
    required: ['tokenId', 'scope'],
  },
  {
    name: 'attempts', title: 'APPROACHES TRIED', cardinality: 'many', show: 5,
    fields: { approach: str(160), outcome: oneOf('novel', 'repeat', 'abandoned') },
    required: ['approach', 'outcome'],
  },
  {
    // Invention II's landing site. `divergence-profile.mjs` produces four signals with a
    // level and refuses to produce a score; this section accepts exactly that shape and
    // nothing wider, so the day phase 7 connects it there is no numeric back door.
    name: 'repository', title: 'REPOSITORY SIGNALS', cardinality: 'many', show: 4,
    fields: { signal: str(80), level: oneOf('low', 'medium', 'high') },
    required: ['signal', 'level'],
  },
]);

const SECTION_BY_NAME = new Map(CONTEXT_SECTIONS.map((section) => [section.name, section]));

/** The section names, for a caller that wants to check one before attempting a write. */
export const CONTEXT_SECTION_NAMES = Object.freeze(CONTEXT_SECTIONS.map((section) => section.name));

/** Version of the projected shape. It changes when a section is added or removed, which is
 *  the only thing that can change the shape — the whole point being that nothing else can. */
export const CONTEXT_PROJECTION_VERSION = '1.0.0';

function checkScalar(sectionName, field, spec, value) {
  if (spec.kind === 'string') {
    if (typeof value !== 'string') throw new ContextSchemaViolation(sectionName, field, `expected a string, got ${typeof value}`);
    const text = value.trim();
    if (!text) throw new ContextSchemaViolation(sectionName, field, 'expected a non-empty string');
    // Rejected, not clipped. A writer whose text does not fit is a writer who has not said
    // it in the schema's terms yet, and clipping here would hide that from them for good.
    if (text.length > spec.max) throw new ContextSchemaViolation(sectionName, field, `is ${text.length} characters, over the ${spec.max} this field holds`);
    return text;
  }
  if (spec.kind === 'integer') {
    if (typeof value !== 'number' || !Number.isInteger(value)) throw new ContextSchemaViolation(sectionName, field, `expected an integer, got ${typeof value === 'number' ? value : typeof value}`);
    if (value < spec.min || value > spec.max) throw new ContextSchemaViolation(sectionName, field, `must be between ${spec.min} and ${spec.max}, got ${value}`);
    return value;
  }
  if (spec.kind === 'boolean') {
    if (typeof value !== 'boolean') throw new ContextSchemaViolation(sectionName, field, `expected true or false, got ${typeof value}`);
    return value;
  }
  if (spec.kind === 'enum') {
    if (!spec.values.includes(value)) throw new ContextSchemaViolation(sectionName, field, `must be one of ${spec.values.join(', ')}, got ${JSON.stringify(value)}`);
    return value;
  }
  if (spec.kind === 'list') {
    if (!Array.isArray(value)) throw new ContextSchemaViolation(sectionName, field, `expected an array, got ${typeof value}`);
    if (value.length > spec.max) throw new ContextSchemaViolation(sectionName, field, `holds at most ${spec.max} entries, got ${value.length}`);
    return value.map((item, index) => {
      if (typeof item !== 'string') throw new ContextSchemaViolation(sectionName, `${field}[${index}]`, `expected a string, got ${typeof item}`);
      const text = item.trim();
      if (!text) throw new ContextSchemaViolation(sectionName, `${field}[${index}]`, 'expected a non-empty string');
      if (text.length > spec.itemMax) throw new ContextSchemaViolation(sectionName, `${field}[${index}]`, `is ${text.length} characters, over the ${spec.itemMax} this field holds`);
      return text;
    });
  }
  /* c8 ignore next */
  throw new ContextSchemaViolation(sectionName, field, `unknown field kind \`${spec.kind}\``);
}

/**
 * The gate. Returns the normalised value a caller may store; throws `ContextSchemaViolation`
 * otherwise, naming the section and the field.
 *
 * Three refusals matter more than the others, and each one is a way free text has actually
 * got into a context window in products that had a schema on paper:
 *
 *   1. a section nobody declared          — `write('notes', …)`
 *   2. a field the section does not have  — `{claim, source, andAlso: '…'}`
 *   3. a value of the right type and the wrong shape — an unbounded string
 */
export function validateFact(section, value) {
  const spec = SECTION_BY_NAME.get(section);
  if (!spec) {
    throw new ContextSchemaViolation(String(section), null, `no such section; the state has exactly ${CONTEXT_SECTION_NAMES.join(', ')}`);
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ContextSchemaViolation(section, null, `expected an object of {${Object.keys(spec.fields).join(', ')}}`);
  }
  for (const key of Object.keys(value)) {
    if (!(key in spec.fields)) {
      throw new ContextSchemaViolation(section, key, `is not a field of this section; it has ${Object.keys(spec.fields).join(', ')}`);
    }
  }
  for (const key of spec.required) {
    if (value[key] === undefined || value[key] === null) throw new ContextSchemaViolation(section, key, 'is required');
  }
  const normalised = {};
  // Built in the schema's field order, not the caller's: two writers spelling the same fact
  // in a different key order must not produce two different projections of one state.
  for (const [field, fieldSpec] of Object.entries(spec.fields)) {
    if (value[field] === undefined || value[field] === null) continue;
    normalised[field] = checkScalar(section, field, fieldSpec, value[field]);
  }
  return normalised;
}

/**
 * The window a capped section shows.
 *
 * `active` follows the plan's current step, so the step being executed is in view at call 300
 * exactly as it was at call 3. `rank` keeps the entries that matter most rather than the ones
 * that arrived last. Everything else keeps the most recent, because a fact written later is
 * what a fact written earlier became.
 *
 * A ranked section is selected on its rank and then RESTORED to write order for rendering:
 * selection and presentation are two different questions, and answering them with one sort is
 * how the first version of this function dropped every blocking question on the floor —
 * it ordered them to the front and then took the tail. The test found it; the shape of the
 * bug is why the two steps are now separate.
 */
function windowFor(spec, entries) {
  if (entries.length <= spec.show) return { shown: entries };
  if (spec.window === 'active') {
    const activeIndex = entries.findIndex((entry) => entry.value.status === 'active');
    if (activeIndex >= 0) {
      const half = Math.floor(spec.show / 2);
      const from = Math.min(Math.max(activeIndex - half, 0), entries.length - spec.show);
      return { shown: entries.slice(from, from + spec.show) };
    }
  }
  if (spec.rank) {
    const kept = new Set(
      entries
        .map((entry, index) => ({ index, key: spec.rank(entry.value) }))
        // Highest rank first, and within one rank the most recent — a cap must never be the
        // reason a blocking question stopped being asked.
        .sort((left, right) => (right.key - left.key) || (right.index - left.index))
        .slice(0, spec.show)
        .map((entry) => entry.index),
    );
    return { shown: entries.filter((_, index) => kept.has(index)) };
  }
  return { shown: entries.slice(entries.length - spec.show) };
}

/**
 * Rebuilds the model-facing view from state, from zero, every time.
 *
 * `facts` is a flat list of `{section, value}` in the order they were written — the record.
 * Nothing else is read: not a message, not a transcript, not a previous projection. That is
 * what makes the size independent of how many calls have happened, and it is the property
 * `CE-005` measures at n > 300.
 *
 * Every section is present in every projection, including the empty ones, which say they are
 * empty. A section that disappeared when it had nothing to say would change the shape between
 * call 3 and call 300 — the exact defect this module exists to remove.
 */
export function projectContext(facts = []) {
  if (!Array.isArray(facts)) throw new ContextSchemaViolation('(input)', null, 'facts must be an array');
  const bySection = new Map(CONTEXT_SECTIONS.map((spec) => [spec.name, []]));
  let unknown = 0;
  let rejected = 0;
  for (const fact of facts) {
    const spec = SECTION_BY_NAME.get(fact?.section);
    // A fact for a section that does not exist cannot be projected, and is not silently
    // dropped either: it is counted, and the count is reported on the projection.
    if (!spec) { unknown += 1; continue; }
    try {
      bySection.get(spec.name).push({ value: validateFact(spec.name, fact.value) });
    } catch (error) {
      // The write gate throws; the read does NOT. `recordContextFact` is the only door into
      // the state and it validates before the transaction opens, so a fact that fails here
      // arrived some other way: a tampered store, or a schema this build tightened after the
      // fact was written. Throwing would be the worse answer to both — it would brick every
      // model call of a session for one bad row, which is a denial of service purchased with
      // a single edit. It is excluded from the view, so the model never sees an unchecked
      // field, and it is COUNTED, so nothing was dropped in silence.
      if (!(error instanceof ContextSchemaViolation)) throw error;
      rejected += 1;
    }
  }

  const sections = CONTEXT_SECTIONS.map((spec) => {
    const all = bySection.get(spec.name);
    // One goal, not a history of goals: the last write is the current value.
    const entries = spec.cardinality === 'one' ? all.slice(-1) : all;
    const { shown } = windowFor(spec, entries);
    return {
      name: spec.name,
      title: spec.title,
      held: entries.length,
      shown: shown.length,
      capped: entries.length > shown.length,
      entries: shown.map((entry) => entry.value),
    };
  });

  const projection = {
    version: CONTEXT_PROJECTION_VERSION,
    sections,
    unknownSectionFacts: unknown,
    rejectedFacts: rejected,
  };
  // The digest is over the canonical form, so two states that differ only in key order or in
  // how many facts were dropped by a cap produce the same identifier — which is what makes a
  // single decision re-runnable in isolation against another model or another policy.
  projection.digest = digestOf(projection);
  return projection;
}

function digestOf(projection) {
  const canonical = canonicalJson({ version: projection.version, sections: projection.sections });
  let hash = 0x811c9dc5;
  for (let index = 0; index < canonical.length; index += 1) {
    hash ^= canonical.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `ctx-${hash.toString(16).padStart(8, '0')}`;
}

function renderValue(sectionName, value) {
  if (sectionName === 'goal') {
    const lines = [value.text];
    for (const item of value.nonGoals ?? []) lines.push(`  not: ${item}`);
    for (const item of value.criteria ?? []) lines.push(`  done when: ${item}`);
    return lines;
  }
  if (sectionName === 'plan') return [`${value.step}. [${value.status}] ${value.verb}${value.target ? ` ${value.target}` : ''}`];
  if (sectionName === 'evidence') return [`${value.recomputed ? 'recomputed' : 'asserted'}: ${value.claim}${value.source ? ` (${value.source})` : ''}`];
  if (sectionName === 'questions') return [`${value.blocking ? 'blocking' : 'open'}: ${value.question}`];
  if (sectionName === 'diff') return [`${value.path} +${value.added}/-${value.removed}`];
  if (sectionName === 'failures') return [`${value.signature} ×${value.occurrences}`];
  if (sectionName === 'tokens') return [`${value.tokenId} → ${value.scope}${value.expiresAtUnix ? ` until ${value.expiresAtUnix}` : ''}`];
  if (sectionName === 'attempts') return [`${value.outcome}: ${value.approach}`];
  return [`${value.signal}: ${value.level}`];
}

/**
 * The projection as the text a model call carries. Deterministic: the same state renders
 * byte-for-byte the same string, which is what lets one decision be replayed in isolation.
 *
 * A capped section says so on its own header. `showing 6 of 41` is a fact about the view,
 * and a view that hid the difference would be a summary pretending to be a state.
 */
export function renderProjection(projection) {
  const lines = [`SESSION STATE (projection ${projection.version}, ${projection.digest})`];
  // Only when there is something to say. A view that carried "0 rejected" on every call
  // would be teaching the reader to skip the line on the one call where it is not zero.
  if (projection.rejectedFacts || projection.unknownSectionFacts) {
    lines.push(`  held back: ${projection.rejectedFacts} out of schema, ${projection.unknownSectionFacts} in no section`);
  }
  for (const section of projection.sections) {
    const header = section.capped
      ? `${section.title} — showing ${section.shown} of ${section.held}`
      : `${section.title}${section.held ? '' : ' — none'}`;
    lines.push('', header);
    for (const value of section.entries) for (const line of renderValue(section.name, value)) lines.push(`  ${line}`);
  }
  return `${lines.join('\n')}\n`;
}

/** What a measurement needs to compare two projections without re-deriving either: the
 *  ordered section names with their caps, the byte size of the rendered view, and the
 *  digest. `CE-005` compares the first two between call 3 and call 300. */
export function projectionShape(projection) {
  return {
    version: projection.version,
    shape: projection.sections.map((section) => `${section.name}:${section.shown}`).join('|'),
    sectionNames: projection.sections.map((section) => section.name).join(','),
    bytes: Buffer.byteLength(renderProjection(projection), 'utf8'),
    digest: projection.digest,
  };
}

/** The ceiling the rendered view cannot exceed whatever the state holds, derived from the
 *  schema rather than asserted: every section's cap times its longest possible entry. A test
 *  measures the real render against it, so the number cannot drift away from the schema. */
export function projectionByteCeiling() {
  let total = 128; // header and blank lines
  for (const spec of CONTEXT_SECTIONS) {
    let perEntry = 0;
    for (const field of Object.values(spec.fields)) {
      if (field.kind === 'string') perEntry += field.max;
      else if (field.kind === 'list') perEntry += field.max * (field.itemMax + 16);
      else perEntry += 24;
    }
    total += spec.title.length + 32 + spec.show * (perEntry + 16);
  }
  return total;
}
