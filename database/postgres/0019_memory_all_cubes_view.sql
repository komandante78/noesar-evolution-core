-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- MASTER_PROJECT/14_MEMORIA_A_CUBI.md, CUBE-006 -- the recall() contract's `cube` filter is
-- OPTIONAL (14 §9.4: `recall(query, { cube, project, category, since, until, limit })`), so
-- a search that does not name a cube must still be able to look across all four. `0018`'s
-- four typed views each show exactly one cube by design -- correct for writes (that is the
-- whole point of CUBE-004), too narrow for an unscoped read.
--
-- WHY A UNION VIEW DOES NOT REOPEN CUBE-004. What CUBE-004 forbids is a row's cube being
-- MISREPORTED or a WRITE landing in the wrong cube. `all_memories` is read-only (no `INSERT`
-- grant below, and a `UNION ALL` of four single-table `SELECT`s is not an updatable view in
-- PostgreSQL regardless), and every row keeps the literal `cube` value the row already had in
-- the view it came from -- nothing here can make a Corpus row report itself as Library. A
-- reader that wants the CUBE-004 guarantee back for writes still goes through the one-cube
-- views; this view exists only so `recall()` can search "everywhere" honestly, the same way
-- the six non-vector catalogues in `0017`'s indexes already search across categories.
BEGIN;

CREATE OR REPLACE VIEW noesar_knowledge.all_memories AS
  SELECT * FROM noesar_knowledge.library_memories
  UNION ALL
  SELECT * FROM noesar_knowledge.workshop_memories
  UNION ALL
  SELECT * FROM noesar_knowledge.corpus_memories
  UNION ALL
  SELECT * FROM noesar_knowledge.experience_memories;

ALTER VIEW noesar_knowledge.all_memories OWNER TO noesar_migrator;

GRANT SELECT ON noesar_knowledge.all_memories TO noesar_app;

COMMIT;
