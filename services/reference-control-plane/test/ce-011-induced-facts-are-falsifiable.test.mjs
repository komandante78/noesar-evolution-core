// SPDX-License-Identifier: AGPL-3.0-or-later
//
// CE-011 · "Ogni fatto indotto porta evidenza, conteggio e condizione di smentita",
// verified by the method the matrix states: **schema + test, un fatto senza smentita non è
// scrivibile**.
//
// This file is the TEST half at the application layer, and it is deliberately not the whole
// verdict: the criterion says *schema*, so the guarantee lives in migration `0020` and is
// exercised against a real PostgreSQL cluster by `tools/acceptance/memory-integration.mjs`
// (`MEM-37`…`MEM-42`), where the constraints are hit **directly**, bypassing this layer.
//
// Why both, rather than only the schema: `23514 check constraint "induced_fact_carries_
// refutation"` is a true refusal and a useless message. A caller told that has no idea which
// of the three parts is missing. So the application layer refuses first, by name — and the
// schema refuses regardless of who is writing, which is the part a second writer (an importer,
// a repair script, a future migration) cannot walk around.
//
// The induced cube is `experience`, and that is not a choice made here: `14_MEMORIA_A_CUBI.md`
// maps it — *«Esperienza | indotto | è stato osservato n volte in questo repository | un solo
// controesempio»* — and `0017`'s `counters_only_for_experience` already forbids the
// confirm/refute balance on every other cube.
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryService } from '../src/memory-service.mjs';

const ACTOR = '11111111-1111-4111-8111-111111111111';

class FakeClient {
  constructor(handler = () => ({ rows: [{}] })) { this.handler = handler; this.calls = []; }
  async query(sql, params = []) { this.calls.push({ sql, params }); return this.handler(sql, params); }
  release() {}
}

const serviceWith = (client) => new MemoryService({
  dataPlane: () => ({ pool: { connect: async () => client } }),
});

/** A well-formed induced fact: evidence, a count, and what would disprove it. */
const INDUCED = {
  actorId: ACTOR, cube: 'experience', category: 'lezione', content: 'i test accompagnano il codice',
  signature: 'exp-1',
  provenance: { commits: 42, repository: 'this one' },
  confirmations: 42,
  refutationCondition: 'un solo commit accettato che tocchi src senza toccare test',
};

describe('CE-011 · a fact that cannot be disproved is not writable', () => {
  test('an induced fact with no refutation condition is refused, and the message says which part', async () => {
    const client = new FakeClient();
    await assert.rejects(
      () => serviceWith(client).write({ ...INDUCED, refutationCondition: null }),
      /must state what would disprove it/,
    );
    assert.equal(client.calls.length, 0, 'the refusal must come before the database is touched');
  });

  test('a blank or whitespace condition is the same as none', async () => {
    for (const blank of ['', '   ', '\n\t']) {
      await assert.rejects(
        () => serviceWith(new FakeClient()).write({ ...INDUCED, refutationCondition: blank }),
        /must state what would disprove it/,
        `"${blank}" was accepted as a refutation condition`);
    }
  });

  test('the UNDECLARED marker cannot be supplied by a caller', async () => {
    // `0020` writes it onto rows that predate the rule, precisely so those rows are visibly
    // not falsifiable. A caller able to send it back would turn an honest marker into a way
    // of satisfying the constraint while stating nothing.
    await assert.rejects(
      () => serviceWith(new FakeClient()).write({
        ...INDUCED,
        refutationCondition: 'UNDECLARED: written before migration 0020; this fact is not falsifiable as recorded',
      }),
      /belongs to rows written before migration 0020/,
    );
  });

  test('an induced fact citing nothing is refused — evidence is not optional', async () => {
    for (const empty of [{}, null, undefined]) {
      await assert.rejects(
        () => serviceWith(new FakeClient()).write({ ...INDUCED, provenance: empty }),
        /must carry the evidence that induced it/,
        `provenance ${JSON.stringify(empty)} was accepted as evidence`);
    }
  });

  test('an induced fact observed zero times is refused — the count is not optional', async () => {
    for (const count of [0, -1, 1.5, '42', null]) {
      await assert.rejects(
        () => serviceWith(new FakeClient()).write({ ...INDUCED, confirmations: count }),
        /must carry how many times it held/,
        `confirmations=${JSON.stringify(count)} was accepted as a count`);
    }
  });

  test('a complete induced fact IS written, and all three parts reach the INSERT', async () => {
    let insert = null;
    const client = new FakeClient((sql, params) => {
      if (/INSERT INTO/.test(sql)) { insert = { sql, params }; return { rows: [{ signature: 'exp-1', cube: 'experience' }] }; }
      return { rows: [] };
    });
    const item = await serviceWith(client).write(INDUCED);
    assert.equal(item.signature, 'exp-1');
    assert.ok(insert, 'a well-formed induced fact must actually be written — the guard must not refuse everything');
    assert.match(insert.sql, /refutation_condition/);
    assert.match(insert.sql, /confirmations/);
    assert.ok(insert.params.includes(INDUCED.refutationCondition),
      'the condition must reach the row, not merely pass validation');
    assert.ok(insert.params.includes(42), 'the count must reach the row');
    assert.ok(insert.params.some((p) => typeof p === 'string' && p.includes('"commits":42')),
      'the evidence must reach the row');
  });

  test('the other three cubes are untouched — this rule is about induction, not about memory', async () => {
    // If this failed, the rule would have quietly become "every memory must be falsifiable",
    // which is a different and wrong claim: a Library record is a citation, not an induction.
    for (const cube of ['library', 'workshop', 'corpus']) {
      let insert = null;
      const client = new FakeClient((sql, params) => {
        if (/INSERT INTO/.test(sql)) { insert = params; return { rows: [{ signature: 's', cube }] }; }
        return { rows: [] };
      });
      await serviceWith(client).write({
        actorId: ACTOR, cube, category: 'fatto', content: 'x', signature: `s-${cube}`,
      });
      assert.ok(insert, `${cube} refused a perfectly ordinary write`);
      assert.ok(insert.includes(null), `${cube} must store no refutation condition`);
    }
  });

  test('the three parts travel WITH a recalled item, not one query away', async () => {
    const client = new FakeClient((sql) => {
      if (/INSERT INTO/.test(sql)) {
        return { rows: [{
          signature: 'exp-1', cube: 'experience', confirmations: 42, refutations: 0,
          refutation_condition: INDUCED.refutationCondition, provenance: { commits: 42 },
        }] };
      }
      return { rows: [] };
    });
    const item = await serviceWith(client).write(INDUCED);
    assert.equal(item.confirmations, 42);
    assert.equal(item.refutations, 0);
    assert.equal(item.refutationCondition, INDUCED.refutationCondition);
  });
});
