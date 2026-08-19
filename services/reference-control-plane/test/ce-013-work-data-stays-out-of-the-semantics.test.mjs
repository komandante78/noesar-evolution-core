// SPDX-License-Identifier: AGPL-3.0-or-later
//
// `CE-013` — *«I dati di lavoro non escono e non entrano nella semantica del prodotto»*
// (`MASTER_PROJECT/15_CODEN_EVOLUTION_DA_ZERO.md` §11, severity **C**), verification method
// *«canary per semantica, verificato dallo schema»*.
//
// # The method is the interesting part: *verificato dallo schema*, not "verified by a check"
//
// A check beside the write is a filter — it can be forgotten, ordered wrongly, or applied to one
// caller and not the next. The criterion asks for the canary to be refused **by the schema
// itself**, which is a different and stronger claim: there is no shape in which the work data
// could be written, so no filter is being relied on.
//
// So the canaries below are not merely "rejected". Each one is refused by
// `ContextSchemaViolation`, raised inside `validateFact()`, naming the section and the field —
// and the refusal is asserted to come from the *schema's* vocabulary (no such section, not a
// field of this section, wrong type, over the cap), never from an ad-hoc string match on the
// canary. A test that passed because something recognised the word `CANARY` would be testing a
// denylist, which is exactly what this criterion is not about.
//
// # "Non escono" and "non entrano" are two directions and both are asserted
//
//   non entrano  work data has no shape in which it can be written into the projected state
//   non escono   what `renderProjection()` emits contains only declared fields, so nothing that
//                did get stored under a declared name can drag work data out with it
//
// # The closure: no section is free-form
//
// Every field of every section is derived from `CONTEXT_SECTIONS` at run time and must be one of
// the four bounded kinds. A tenth section added tomorrow with a `notes: str(100000)` field would
// fail here rather than quietly becoming the place work data lives.
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  CONTEXT_SECTIONS, CONTEXT_SECTION_NAMES, ContextSchemaViolation,
  validateFact, projectContext, renderProjection, projectionByteCeiling,
} from '../src/context-projector.mjs';
import { CATEGORIES, CUBES } from '../src/memory-service.mjs';

/** Work data, in the shapes it actually takes: a secret, a source file, a stack trace, a blob. */
const CANARY = Object.freeze({
  secret: 'CE013CANARY-credential-8f2a1c',
  source: 'CE013CANARY-source-4b7d9e',
  trace: 'CE013CANARY-stacktrace-1a2b3c',
  blob: 'CE013CANARY-blob-c0ffee',
});

/** A minimal valid fact per section, so a canary can be added to a shape that otherwise works. */
const VALID = Object.freeze({
  goal: { text: 'ship the thing' },
  plan: { step: 1, verb: 'edit', status: 'active' },
  evidence: { claim: 'the file exists', recomputed: true },
  questions: { question: 'which host?', blocking: false },
  diff: { path: 'a.txt', added: 1, removed: 0 },
  failures: { signature: 'TypeError at f', occurrences: 2 },
  tokens: { tokenId: 'abc', scope: 'a.txt:WRITE' },
  attempts: { approach: 'rename it', outcome: 'novel' },
  repository: { signal: 'tests', level: 'high' },
});

const violates = (error) => error instanceof ContextSchemaViolation;

describe('CE-013 — work data does not enter, and does not leave with, the product\'s semantics', () => {

  // ── the closure: there is nowhere free-form for work data to live ─────────────────────────
  test('every field of every section is one of the four bounded kinds — no section is free-form', () => {
    assert.equal(CONTEXT_SECTIONS.length, CONTEXT_SECTION_NAMES.length);
    let fields = 0;
    for (const section of CONTEXT_SECTIONS) {
      assert.ok(Object.keys(section.fields).length > 0, `${section.name} declares no fields`);
      for (const [name, spec] of Object.entries(section.fields)) {
        fields += 1;
        assert.ok(['string', 'integer', 'boolean', 'enum', 'list'].includes(spec.kind),
          `${section.name}.${name} is of kind \`${spec.kind}\` — a kind this closure does not know is a kind nobody bounded`);
        // Every string-ish kind carries a cap. An uncapped string is a place work data fits.
        if (spec.kind === 'string') assert.ok(Number.isInteger(spec.max) && spec.max <= 400, `${section.name}.${name} caps at ${spec.max}`);
        if (spec.kind === 'list') {
          assert.ok(Number.isInteger(spec.max) && spec.max <= 8, `${section.name}.${name} holds ${spec.max} entries`);
          assert.ok(Number.isInteger(spec.itemMax) && spec.itemMax <= 200, `${section.name}.${name} items cap at ${spec.itemMax}`);
        }
      }
    }
    assert.ok(fields >= 20, `only ${fields} fields were inspected — the closure is not reaching the schema`);
  });

  test('the projection has a byte ceiling, so even declared facts cannot grow into a data dump', () => {
    const ceiling = projectionByteCeiling();
    assert.ok(Number.isInteger(ceiling) && ceiling > 0);
    // A ceiling that would fit a source tree is not a ceiling. This is the order of magnitude
    // a context window is, not the order of magnitude a workspace is.
    assert.ok(ceiling < 200_000, `the projection may reach ${ceiling} bytes`);
  });

  // ── non entrano · the canary, refused BY THE SCHEMA ────────────────────────────────────────
  describe('non entrano · a canary has no shape in which it can be written', () => {
    test('a section nobody declared is refused, and the refusal names the sections that exist', () => {
      for (const invented of ['notes', 'workspace', 'files', 'scratch', 'raw']) {
        assert.throws(
          () => validateFact(invented, { text: CANARY.source }),
          (error) => violates(error) && /no such section/.test(error.message),
          `\`${invented}\` was accepted as a section`,
        );
      }
    });

    test('an undeclared FIELD carrying the canary is refused on every one of the nine sections', () => {
      let checked = 0;
      for (const section of CONTEXT_SECTION_NAMES) {
        assert.throws(
          () => validateFact(section, { ...VALID[section], andAlso: CANARY.secret }),
          (error) => violates(error) && /is not a field of this section/.test(error.message),
          `${section} accepted an undeclared field`,
        );
        checked += 1;
      }
      assert.equal(checked, CONTEXT_SECTIONS.length, 'a section was skipped — the sweep is not closed');
    });

    test('a declared field of the wrong SHAPE is refused — an object or an array cannot smuggle a blob in', () => {
      for (const smuggled of [
        { file: CANARY.source }, [CANARY.blob], { toString: () => CANARY.blob }, 42, true, null,
      ]) {
        assert.throws(
          () => validateFact('goal', { text: smuggled }),
          violates,
          `goal.text accepted ${JSON.stringify(smuggled)}`,
        );
      }
      // And the fact itself must be an object of the declared fields, not an array or a string.
      for (const wrong of [[CANARY.blob], CANARY.blob, 7, null]) {
        assert.throws(() => validateFact('goal', wrong), violates);
      }
    });

    test('an over-length value is REJECTED, not clipped — the writer is told, not silently truncated', () => {
      // Clipping would be the quiet failure: work data would enter, minus its tail, and nobody
      // would learn that a component tried. The schema refuses instead, and this pins that.
      const long = `${CANARY.source} ${'x'.repeat(1000)}`;
      assert.throws(
        () => validateFact('goal', { text: long }),
        (error) => violates(error) && /over the 400 this field holds/.test(error.message),
      );
      assert.throws(
        () => validateFact('goal', { text: 'ok', criteria: [`${CANARY.trace} ${'y'.repeat(400)}`] }),
        (error) => violates(error) && /over the 160 this field holds/.test(error.message),
      );
    });

    test('the refusal comes from the SCHEMA, not from anything recognising the canary', () => {
      // The same shapes, with an innocuous value instead of a canary, must be refused identically.
      // If they were accepted, this suite would be measuring a denylist rather than a schema.
      assert.throws(() => validateFact('notes', { text: 'hello' }), violates);
      assert.throws(() => validateFact('goal', { text: 'hello', andAlso: 'world' }), violates);
      assert.throws(() => validateFact('goal', { text: { any: 'object' } }), violates);
      // And a canary that DOES fit a declared field is accepted — the schema is a shape, not a
      // filter on content, and saying so plainly is more honest than implying it screens words.
      assert.deepEqual(validateFact('goal', { text: CANARY.secret }), { text: CANARY.secret });
    });

    test('a poisoned batch: the bad fact is EXCLUDED from the view and COUNTED, never rendered', () => {
      // The read path deliberately does not throw — `projectContext()`'s own comment argues it,
      // and the argument is right: one tampered row must not brick every model call of a
      // session. What matters for this criterion is the pair of properties it keeps instead,
      // and both are asserted here rather than the exception I first expected.
      const projection = projectContext([
        { section: 'goal', value: { text: 'ship the thing' } },
        { section: 'scratch', value: { dump: CANARY.blob } },              // no such section
        { section: 'diff', value: { path: 'a.txt', added: 1, removed: 0, contents: CANARY.source } }, // extra field
      ]);
      assert.equal(projection.unknownSectionFacts, 1, 'the invented section was not counted');
      assert.equal(projection.rejectedFacts, 1, 'the fact with an extra field was not counted');
      // Excluded: neither canary is anywhere in the projected state or in what a model reads.
      const rendered = renderProjection(projection);
      for (const canary of [CANARY.blob, CANARY.source]) {
        assert.ok(!JSON.stringify(projection).includes(canary), `\`${canary}\` is in the projection`);
        assert.ok(!rendered.includes(canary), `\`${canary}\` is in the rendered context`);
      }
      // And the good fact still made it: exclusion is per fact, not per batch.
      assert.ok(rendered.includes('ship the thing'));
    });
  });

  // ── non escono · what is rendered carries only declared fields ────────────────────────────
  describe('non escono · the rendered projection cannot drag work data out', () => {
    test('rendering emits the declared fields and nothing a caller attached beside them', () => {
      const projection = projectContext([
        { section: 'goal', value: { text: 'ship the thing' } },
        { section: 'diff', value: { path: 'a.txt', added: 3, removed: 1 } },
      ]);
      const rendered = renderProjection(projection);
      assert.ok(rendered.includes('ship the thing'));
      assert.ok(rendered.includes('a.txt'));
      for (const canary of Object.values(CANARY)) {
        assert.ok(!rendered.includes(canary), `\`${canary}\` reached the rendered projection`);
      }
    });

    test('the WRITE gate refuses the extra key outright — the read path is the second line, not the first', () => {
      // Two doors, and the criterion needs both: `validateFact()` is what `recordContextFact()`
      // calls before the transaction opens, so work data cannot be stored at all; the read path
      // excludes-and-counts so a row that arrived some other way still never reaches a model.
      assert.throws(
        () => validateFact('diff', { path: 'a.txt', added: 1, removed: 0, contents: CANARY.source }),
        (error) => violates(error) && /is not a field of this section/.test(error.message),
      );
      const projection = projectContext([{ section: 'diff', value: { path: 'a.txt', added: 1, removed: 0, contents: CANARY.source } }]);
      assert.equal(projection.rejectedFacts, 1);
      assert.ok(!renderProjection(projection).includes(CANARY.source));
    });
  });

  // ── the memory side: cubes and categories are enums, not names work data can invent ───────
  test('memory cubes and categories are closed sets — work data cannot name a new one', () => {
    assert.ok(Array.isArray(CUBES) && CUBES.length > 0);
    assert.ok(Array.isArray(CATEGORIES) && CATEGORIES.length > 0);
    assert.ok(Object.isFrozen(CUBES) && Object.isFrozen(CATEGORIES));
    for (const canary of Object.values(CANARY)) {
      assert.ok(!CUBES.includes(canary));
      assert.ok(!CATEGORIES.includes(canary));
    }
  });

  // Negative control: a legitimate fact projects and renders, or every refusal above is
  // satisfied by a projector that refuses everything.
  test('negative control · a legitimate fact for every section validates, projects and renders', () => {
    const facts = CONTEXT_SECTION_NAMES.map((section) => ({ section, value: VALID[section] }));
    for (const fact of facts) assert.ok(validateFact(fact.section, fact.value));
    const rendered = renderProjection(projectContext(facts));
    assert.ok(rendered.includes('ship the thing'));
    assert.ok(rendered.length > 0);
    assert.ok(Buffer.byteLength(rendered, 'utf8') <= projectionByteCeiling());
  });
});
