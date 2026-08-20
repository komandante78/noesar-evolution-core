#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// "The five archives" named two different things, and the project could not tell which — `D-0588`.
//
// # The defect this exists to make impossible
//
// Eight places in the authoritative tree said *cinque archivi* / *five ZIPs*. They meant TWO
// different artifacts: the sealed V4 package RECEIVED at `/mnt/user/downloads/NOESAR_EVOLUTION_FINAL`
// (forbidden from the repository by `CLAUDE10.md` rule 34), and the delivery package this project
// must PRODUCE before it can say "done" (`09_PIANO.md` §4). Neither was enumerated anywhere in
// `MASTER_PROJECT/`, the reference project: the only enumeration lived in the V4 documentation,
// removed from the working tree by `D-0097`. So the final acceptance criterion of the whole
// product — *"cinque archivi finali passano un audit indipendente"* — had no content that could be
// checked, and its two readings could not be told apart by reading.
//
// It is the `L0-L8` collision of `02_ATOM.md` again: one vocabulary, two referents, no document
// citing the other. That one produced a real incident. This is the same shape, caught earlier.
//
// # What this checks, and what it deliberately does not
//
//   1. CANON      `MASTER_PROJECT/09_PIANO.md` carries the canonical enumeration, and it names
//                 exactly FIVE positions. A sixth position, or four, fails here.
//   2. IDENTITY   those five names equal the five encoded in the sealed archives' own filenames,
//                 read from the frozen evidence file. This is the check that carries the weight:
//                 it proves the two instances are the SAME five positions rather than two invented
//                 lists, and it fails if anyone renames a position or invents one.
//   3. POINTERS   every other mention in the tree that GOVERNS — `MASTER_PROJECT/`, `CLAUDE10.md`,
//                 `.claude/skills/` — says which instance it means, or points at the canonical
//                 section. It never has to repeat the list.
//
// **Not checked, on purpose: the 80 reports under `docs/`.** A rule that grepped every report for
// an approved wording would police prose, not substance — the reason `D-0531` refused a hook for
// the funding line. Reports describe what was true when they were written; the documents that
// GOVERN are the ones that must be unambiguous today.
//
// **Not touched, and it is a real open finding, not an oversight:** `docs/progetto-italiano/`
// carries three of the same lines. It is a stale mirror of `MASTER_PROJECT/` — 7 of 14 files
// diverge — and `docs/DECISION_LOG.md` records that WHICH of the two is canonical is not settled.
// Aligning it here would take that decision silently, in a phase that was not asked to take it.
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** The document that owns "when can the product be called done", and therefore owns this list. */
const CANON = 'MASTER_PROJECT/09_PIANO.md';
/** Where the sealed archives' SHA-256 were frozen before the V4 removal — `D-0097`. */
const EVIDENCE_DIR = 'EVIDENCE';
const EVIDENCE_PREFIX = 'v4_removal_recovery_';

/** Files that GOVERN. Reports under `docs/` are excluded by design — see the header. */
const GOVERNING = [
  'CLAUDE10.md',
  ...readdirSync(join(ROOT, 'MASTER_PROJECT'))
    .filter((name) => name.endsWith('.md'))
    .map((name) => `MASTER_PROJECT/${name}`),
  ...readdirSync(join(ROOT, '.claude/skills'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => `.claude/skills/${entry.name}/SKILL.md`),
];

/** A sentence that names the set by its count. Both languages, because the tree is both. */
const MENTION = /\b(cinque|five)[\s-]+(archiv\w+|zip\w*|pacchett\w+|package\w*)/i;
/**
 * A mention is unambiguous when it says which instance it means, or points at the canonical
 * section. `finale`/`final` is deliberately NOT a marker: it appears in both instances' names
 * (`FINAL_RELEASE_AND_OPERATIONS`, `V4_FINAL`) and would make every line pass vacuously — the
 * exact failure `readStatus` in `acceptance-matrix.mjs` was repaired for on 2026-08-19.
 */
const QUALIFIED = /(sorgent|source|sigillat|sealed|ricevut|received|NOESAR_EVOLUTION_FINAL|consegna|delivery|prodott|produce|PKG-001|§\s?4a)/i;

let failures = 0;
const fail = (message) => { failures += 1; process.stdout.write(`  FAIL  ${message}\n`); };
const read = (file) => readFileSync(join(ROOT, file), 'utf8');
const normalise = (name) => name.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '');

process.stdout.write('Five archives — one list, two instances\n\n');

// ── 1 · canon ───────────────────────────────────────────────────────────────────────────────────
const canonText = read(CANON);
// The BEGIN marker is allowed to carry prose after its name — it explains itself to whoever opens
// the file next, which is the point of putting the canon in a document rather than in a constant.
const canonBlock = canonText.match(/<!-- FIVE-ARCHIVES:BEGIN[\s\S]*?-->([\s\S]*?)<!-- FIVE-ARCHIVES:END -->/);
let canonNames = [];
if (!canonBlock) {
  fail(`${CANON} carries no canonical enumeration — the block between <!-- FIVE-ARCHIVES:BEGIN --> and <!-- FIVE-ARCHIVES:END --> is absent, so the product's final acceptance criterion has no content`);
} else {
  canonNames = [...canonBlock[1].matchAll(/^\s*(\d)\.\s+\*\*([^*]+)\*\*/gm)].map((match) => ({
    position: Number(match[1]),
    name: match[2].trim(),
  }));
  if (canonNames.length !== 5) {
    fail(`${CANON} enumerates ${canonNames.length} positions, not 5 — "no ZIP 6 is created" is a rule of this delivery, and four is not the delivery either`);
  }
  canonNames.forEach((entry, index) => {
    if (entry.position !== index + 1) fail(`${CANON}: position ${index + 1} is numbered ${entry.position} — the positions are ordered and the order is part of the identity`);
  });
}

// ── 2 · identity with the sealed instance ───────────────────────────────────────────────────────
const evidenceFile = readdirSync(join(ROOT, EVIDENCE_DIR))
  .filter((name) => name.startsWith(EVIDENCE_PREFIX))
  .sort()
  .at(-1);
if (!evidenceFile) {
  fail(`no ${EVIDENCE_DIR}/${EVIDENCE_PREFIX}*.txt — the sealed archives' names were frozen there by D-0097, and without it the two instances cannot be proven to be the same five positions`);
} else {
  const sealed = [...read(`${EVIDENCE_DIR}/${evidenceFile}`)
    .matchAll(/NOESAR_EVOLUTION_(\d{2})_([A-Z0-9_]+?)_V4_FINAL/g)]
    .map((match) => ({ position: Number(match[1]), name: match[2] }))
    .sort((a, b) => a.position - b.position);
  const unique = [...new Map(sealed.map((entry) => [entry.position, entry])).values()];
  if (unique.length !== 5) {
    fail(`${EVIDENCE_DIR}/${evidenceFile} names ${unique.length} sealed archives, not 5`);
  } else if (canonNames.length === 5) {
    unique.forEach((entry, index) => {
      const declared = normalise(canonNames[index].name);
      if (declared !== entry.name) {
        fail(`position ${entry.position}: ${CANON} calls it "${canonNames[index].name}" (${declared}), the sealed archive calls it ${entry.name} — the two instances must occupy the same five positions, or "the five archives" is two lists again`);
      }
    });
  }
  process.stdout.write(`  sealed instance   ${unique.length} positions, from ${evidenceFile}\n`);
}

// ── 3 · pointers ────────────────────────────────────────────────────────────────────────────────
//
// **The unit is the paragraph, not the line** — repaired before this tool was ever committed,
// because its first run failed on its own fix. Markdown prose wraps wherever the column runs out:
// `10_DECISIONI.md` said *"i cinque archivi"* at the end of one line and *"di consegna (09 §4a)"*
// at the start of the next, and a line-based check called the corrected sentence ambiguous. A rule
// that a reflow can break is a rule that will be worked around instead of obeyed.
//
// The canonical section is exempt whole. It is the one place allowed to discuss the ambiguity by
// name, and it cannot point at itself.
const CANON_SECTION = /^##\s*4a\./;
const NEXT_SECTION = /^##\s/;

const canonSectionLines = (() => {
  const lines = canonText.split('\n');
  const start = lines.findIndex((line) => CANON_SECTION.test(line));
  if (start === -1) return new Set();
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (NEXT_SECTION.test(lines[i])) { end = i; break; }
  }
  return new Set(Array.from({ length: end - start }, (_, offset) => start + offset));
})();

let mentions = 0;
let ambiguous = 0;
for (const file of GOVERNING) {
  let text;
  try { text = read(file); } catch { continue; }
  const lines = text.split('\n');
  // Paragraph = maximal run of non-blank lines. Its first line is what gets reported.
  let paragraph = [];
  let start = 0;
  const judge = () => {
    if (!paragraph.length) return;
    const block = paragraph.join('\n');
    const at = paragraph.findIndex((line) => MENTION.test(line));
    if (at !== -1) {
      mentions += 1;
      const exempt = file === CANON && canonSectionLines.has(start + at);
      if (!exempt && !QUALIFIED.test(block)) {
        ambiguous += 1;
        fail(`${file}:${start + at + 1} names the set by its count without saying which instance, and without pointing at ${CANON} §4a — "${paragraph[at].trim().slice(0, 78)}"`);
      }
    }
    paragraph = [];
  };
  lines.forEach((line, index) => {
    if (line.trim() === '') { judge(); return; }
    if (!paragraph.length) start = index;
    paragraph.push(line);
  });
  judge();
}

process.stdout.write(`  canonical list    ${canonNames.length} positions, in ${relative('.', CANON)}\n`);
process.stdout.write(`  governing files   ${GOVERNING.length} scanned, ${mentions} mention(s), ${ambiguous} ambiguous\n\n`);
process.stdout.write(failures === 0 ? 'FIVE_ARCHIVES: PASS\n' : `FIVE_ARCHIVES: FAIL (${failures})\n`);
process.exit(failures === 0 ? 0 : 1);
