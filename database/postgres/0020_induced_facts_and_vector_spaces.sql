-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- CE-011 and CE-012 (MASTER_PROJECT/15_CODEN_EVOLUTION_DA_ZERO.md §11), both enforced HERE
-- rather than in the application layer, because both criteria say so:
--
--   CE-011  "Ogni fatto indotto porta evidenza, conteggio e condizione di smentita"
--           verified by "schema + test: un fatto senza smentita NON È SCRIVIBILE".
--   CE-012  "Un vettore senza il modello che l'ha prodotto non è confrontabile: ERRORE, non
--           numero" — verified by "test di confronto fra due spazi diversi".
--
-- A JS guard would satisfy neither wording. §14 of the same rewrite already settled why:
-- *«PostgreSQL è autoritativo. L'isolamento a livello di riga è ciò che rende i muri fra le
-- semantiche APPLICABILI invece che rispettati per buona condotta.»* An induced fact that is
-- unwritable only when it arrives through `MemoryService.write()` is an induced fact that a
-- second writer — a future importer, a migration, a repair script — writes without a
-- refutation condition and nobody notices.
--
-- ── CE-011 · what "induced" means here, and why the three constraints are three ──────────
--
-- `14_MEMORIA_A_CUBI.md` maps the four cubes to four epistemic kinds, and exactly one of them
-- is induction: *«Esperienza | indotto | è stato osservato n volte in questo repository | un
-- solo controesempio»*. So the induced facts are the `experience` cube's rows, and the row's
-- own table already says as much — `counters_only_for_experience` (0017) forbids the
-- confirm/refute balance on every other cube. The three things the criterion demands map to
-- three columns that must each be non-empty for that cube, and they are separate constraints
-- on purpose: a violation names WHICH of the three is missing, which one merged constraint
-- could not.
--
--   evidence            `provenance`, which was NOT NULL but happily `'{}'` — an induced fact
--                       citing nothing was writable, and `{}` is exactly what a caller that
--                       has no evidence passes.
--   count               `confirmations`, which defaulted to 0 — "observed n times" with n = 0
--                       is not an observation.
--   refutation condition NEW COLUMN. Nothing held it before; there was no place to put it.
--
-- **Legacy rows are marked, never invented.** Any `experience` row written before this
-- migration cannot have a refutation condition, and fabricating one would be worse than the
-- gap: it would make an unfalsifiable claim look falsifiable. They are backfilled with a
-- sentinel that SAYS SO, and the application layer refuses to write that sentinel
-- (`memory-service.mjs`), so it can only ever mean "written before the rule existed".
-- Measured on this installation before writing this migration: `experience` rows = 0, so the
-- backfill is a no-op here and exists for every other installation.
--
-- ── CE-012 · a comparison across spaces, refused by the database itself ──────────────────
--
-- `memory_vectors` is keyed `(record_id, model_id)` and `model_id` is NOT NULL, so the datum
-- has never been missing — half of CE-012 has been structurally true since 0017. The missing
-- half is the one the criterion actually names: nothing could COMPARE two vectors, so nothing
-- could refuse to compare two spaces. Building the comparison is what makes the refusal real.
--
-- `vector_distance()` is that comparison, and it raises `22000` when the two rows belong to
-- different embedding models. It returns a distance only within one space. There is no
-- argument order, no "closest model", no coercion: two spaces produce an ERROR, never a
-- number. `D-0101`/`D-0103` is the rule it enforces — *«ogni vettore registra il modello che
-- l'ha generato — senza, confrontare due spazi diversi restituisce un numero invece di un
-- errore»*.
--
-- This does NOT fabricate an embedding pipeline. `memory-service.mjs` still reports
-- `vectorIndexComplete:false` honestly while no model is current; what this adds is the
-- guarantee that when one IS current, the comparison cannot silently cross spaces.
BEGIN;

-- ── CE-011 ──────────────────────────────────────────────────────────────────────────────
ALTER TABLE noesar_knowledge.memory_records
  ADD COLUMN IF NOT EXISTS refutation_condition text;

COMMENT ON COLUMN noesar_knowledge.memory_records.refutation_condition IS
  'CE-011: what would disprove this induced fact. Mandatory for the experience cube — a memory that cannot be falsified is superstition, not knowledge (14_MEMORIA_A_CUBI.md §5).';

-- Legacy rows: marked as undeclared, never given an invented condition. The sentinel is
-- matched verbatim by memory-service.mjs, which refuses to accept it from a caller.
UPDATE noesar_knowledge.memory_records
   SET refutation_condition = 'UNDECLARED: written before migration 0020; this fact is not falsifiable as recorded and must be re-stated or revoked'
 WHERE cube = 'experience'
   AND (refutation_condition IS NULL OR btrim(refutation_condition) = '');

ALTER TABLE noesar_knowledge.memory_records
  DROP CONSTRAINT IF EXISTS induced_fact_carries_refutation;
ALTER TABLE noesar_knowledge.memory_records
  ADD CONSTRAINT induced_fact_carries_refutation CHECK (
    cube <> 'experience'
    OR (refutation_condition IS NOT NULL AND btrim(refutation_condition) <> '')
  );

ALTER TABLE noesar_knowledge.memory_records
  DROP CONSTRAINT IF EXISTS induced_fact_carries_evidence;
ALTER TABLE noesar_knowledge.memory_records
  ADD CONSTRAINT induced_fact_carries_evidence CHECK (
    cube <> 'experience'
    OR (jsonb_typeof(provenance) = 'object' AND provenance <> '{}'::jsonb)
  );

ALTER TABLE noesar_knowledge.memory_records
  DROP CONSTRAINT IF EXISTS induced_fact_carries_count;
ALTER TABLE noesar_knowledge.memory_records
  ADD CONSTRAINT induced_fact_carries_count CHECK (
    cube <> 'experience' OR confirmations >= 1
  );

-- The four typed views froze their column list at `0018` (a view's `SELECT *` is expanded
-- once, at creation), so without this the new column would be invisible to every write path
-- that goes through them — which is every write path the application has. `CREATE OR REPLACE`
-- may append columns at the end, which is exactly what happened above.
CREATE OR REPLACE VIEW noesar_knowledge.library_memories AS
  SELECT * FROM noesar_knowledge.memory_records WHERE cube = 'library'
  WITH CHECK OPTION;
CREATE OR REPLACE VIEW noesar_knowledge.workshop_memories AS
  SELECT * FROM noesar_knowledge.memory_records WHERE cube = 'workshop'
  WITH CHECK OPTION;
CREATE OR REPLACE VIEW noesar_knowledge.corpus_memories AS
  SELECT * FROM noesar_knowledge.memory_records WHERE cube = 'corpus'
  WITH CHECK OPTION;
CREATE OR REPLACE VIEW noesar_knowledge.experience_memories AS
  SELECT * FROM noesar_knowledge.memory_records WHERE cube = 'experience'
  WITH CHECK OPTION;

-- `CREATE OR REPLACE VIEW` does not preserve column defaults, and 0018's comment explains
-- what they are for: a caller that never mentions `cube` still lands in the right table.
ALTER VIEW noesar_knowledge.library_memories ALTER COLUMN cube SET DEFAULT 'library';
ALTER VIEW noesar_knowledge.workshop_memories ALTER COLUMN cube SET DEFAULT 'workshop';
ALTER VIEW noesar_knowledge.corpus_memories ALTER COLUMN cube SET DEFAULT 'corpus';
ALTER VIEW noesar_knowledge.experience_memories ALTER COLUMN cube SET DEFAULT 'experience';

-- `all_memories` (0019) is a UNION ALL of the four, and froze its own column list the same
-- way. Rebuilt so an unscoped `recall()` can see the new column too. Still read-only: no
-- INSERT grant, and a UNION view is not updatable in PostgreSQL regardless.
DROP VIEW IF EXISTS noesar_knowledge.all_memories;
CREATE VIEW noesar_knowledge.all_memories AS
  SELECT * FROM noesar_knowledge.library_memories
  UNION ALL
  SELECT * FROM noesar_knowledge.workshop_memories
  UNION ALL
  SELECT * FROM noesar_knowledge.corpus_memories
  UNION ALL
  SELECT * FROM noesar_knowledge.experience_memories;

ALTER VIEW noesar_knowledge.all_memories OWNER TO noesar_migrator;
GRANT SELECT ON noesar_knowledge.all_memories TO noesar_app;

-- ── CE-012 ──────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION noesar_knowledge.vector_distance(
  a_record uuid, a_model uuid, b_record uuid, b_model uuid
) RETURNS double precision AS $$
DECLARE
  a_embedding vector(384);
  b_embedding vector(384);
BEGIN
  -- The refusal comes FIRST, before either row is read: a mismatch is not a lookup failure
  -- and must not depend on the rows existing. Two spaces are incomparable whether or not
  -- there is anything in them.
  IF a_model IS NULL OR b_model IS NULL THEN
    RAISE EXCEPTION 'a vector without the model that produced it is not comparable (CE-012)'
      USING ERRCODE = '22000';
  END IF;
  IF a_model <> b_model THEN
    RAISE EXCEPTION 'refusing to compare vectors from two different embedding spaces: % and % (CE-012 — this is an error, never a number)', a_model, b_model
      USING ERRCODE = '22000';
  END IF;

  SELECT embedding INTO a_embedding
    FROM noesar_knowledge.memory_vectors WHERE record_id = a_record AND model_id = a_model;
  SELECT embedding INTO b_embedding
    FROM noesar_knowledge.memory_vectors WHERE record_id = b_record AND model_id = b_model;

  IF a_embedding IS NULL OR b_embedding IS NULL THEN
    RAISE EXCEPTION 'no vector for one of the two records in model % — an absent vector is not a distance of zero', a_model
      USING ERRCODE = '22000';
  END IF;

  RETURN a_embedding <=> b_embedding;
END $$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION noesar_knowledge.vector_distance(uuid, uuid, uuid, uuid) IS
  'CE-012: cosine distance within ONE embedding space. Raises 22000 across two spaces — the record is the memory, the vector is a disposable index (D-0101/D-0103).';

ALTER FUNCTION noesar_knowledge.vector_distance(uuid, uuid, uuid, uuid) OWNER TO noesar_migrator;
GRANT EXECUTE ON FUNCTION noesar_knowledge.vector_distance(uuid, uuid, uuid, uuid) TO noesar_app;

COMMIT;
