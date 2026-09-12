// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Grounding a request in the repository — the step that was missing between a shell and a
// Plan.
//
// THE DEFECT THIS CLOSES. `workspace-actions.mjs` refused every plan whose caller did not
// name the files to touch:
//
//     refuse('NO_FILES', 'this reference wiring takes the files to touch as part of the
//     request; the reference provider has no model and cannot invent a target from prose
//     alone')
//
// unconditionally — including when the router had put ATOM, which does have a model, on the
// other end. So both shells could hold a conversation and neither could turn a sentence into
// work: s319's terminal sent `workspace.plan` with `files: []` on every `/plan`, which this
// line refused every time. The engine had a Plan, an expectation, a token, a shadow and a
// ledger; the shells had a prompt and fourteen commands; and there was no step between them.
//
// WHAT THE REFUSAL WAS PROTECTING, AND WHY IT IS KEPT. Its sentence is true and worth
// keeping: a model must not invent a file target out of prose. A path that arrives because a
// model wrote it is a path nobody checked, and "the plan still needs authorisation" is not an
// answer — an operator approving a plan reads what it says it will touch, so a fabricated
// path is a fabricated thing to approve.
//
// So the property is kept and the refusal is removed, which is possible because they were
// never the same thing. Here the model NEVER EMITS A PATH. Candidates come out of the
// repository, by literal search over terms taken from the request AND from the interpreted
// goal; the model's influence on the selection is the goal it returned, and nothing else.
// Every path in the result was read off a real file this workspace contains. That is the
// same guarantee the refusal gave, obtained by construction instead of by refusing to act.
//
// THE MODEL IS NOT TRUSTED TO BE ABOUT THE REQUEST EITHER. Measured against the live engine
// with ATOM answering: `interpret` given `zzqqxx unobtainium flux` returned a fluent,
// confident and entirely unrelated goal. Searching only the goal would have searched that.
// The request's own words are therefore always in the search, and the overlap between the
// two is reported. See `groundRequest` for why it is reported rather than enforced.
//
// It also makes the repository the oracle for the first step of the cycle, which is what
// `MASTER_PROJECT/15_CODEN_EVOLUTION_DA_ZERO.md` §10 puts at build order 8 and calls a
// prerequisite of planning rather than a feature beside it.
//
// DETERMINISM IS A REQUIREMENT, NOT A STYLE. `CE-006` asks that every model call be
// replayable in isolation from recorded state. A grounding step that ranked by anything
// time-dependent, random or filesystem-order-dependent would make the same request produce a
// different plan on replay, and the replay machinery (`session-replay.mjs`) would report
// drift that came from this file rather than from the model. Every ordering below is total
// and derived from content.

import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { literalSearchMany as defaultLiteralSearchMany } from './repo-map.mjs';
import { contained } from './shadow.mjs';

export class GroundingRefused extends Error {
  constructor(code, reason, detail = {}) {
    super(reason);
    this.name = 'GroundingRefused';
    this.code = code;
    this.reason = reason;
    this.detail = detail;
  }
}

/** Words that carry no location. Two languages, because requests arrive in both and a
 *  stop-word list that only knows English quietly turns every Italian request into a search
 *  for "per" and "che" — which matches everything, which is the same as matching nothing. */
const STOP_WORDS = new Set([
  // English
  'the', 'and', 'for', 'that', 'this', 'with', 'from', 'into', 'over', 'when', 'what', 'which',
  'have', 'has', 'had', 'been', 'was', 'were', 'are', 'not', 'but', 'all', 'any', 'can', 'should',
  'would', 'could', 'must', 'make', 'made', 'add', 'use', 'using', 'get', 'set', 'let', 'its',
  'it', 'is', 'to', 'of', 'in', 'on', 'at', 'by', 'as', 'or', 'do', 'does', 'did', 'be', 'we',
  'you', 'they', 'them', 'their', 'there', 'here', 'then', 'than', 'also', 'please', 'need',
  'needs', 'want', 'wants', 'fix', 'change', 'update', 'new', 'old',
  // Issue-tracker template chrome, not content — measured on django-10097: the whole
  // MAX_TERMS budget was spent on "Description ... (last modified by Tim Bell) ... Since
  // #20003" before a single real word from the report's body was ever extracted.
  'description', 'last', 'modified', 'since',
  // Italian
  'che', 'per', 'con', 'del', 'della', 'delle', 'dei', 'degli', 'dal', 'dalla', 'nel', 'nella',
  'sul', 'sulla', 'una', 'uno', 'gli', 'le', 'la', 'il', 'lo', 'un', 'di', 'da', 'in', 'su',
  'non', 'sono', 'essere', 'come', 'quando', 'dove', 'perche', 'perché', 'questo', 'questa',
  'quello', 'quella', 'tutto', 'tutti', 'anche', 'più', 'piu', 'deve', 'devono', 'fare', 'fatto',
  'aggiungi', 'cambia', 'correggi', 'nuovo', 'vecchio', 'si', 'no', 'ma', 'se', 'ed', 'al', 'ai',
]);

const MAX_TERMS = 12;

/** The searchable terms of a sentence, in first-appearance order.
 *
 *  Applied to the request and to the interpreted goal alike. With the reference provider the
 *  goal is the request's first sentence quoted verbatim, so the two term sets largely
 *  coincide — a weaker grounding, honestly weaker, and the same code path, so `CE-022` (the
 *  suite passes with ATOM uninstalled) does not depend on which provider answered. */
export function searchTermsOf(goal) {
  const seen = new Set();
  const terms = [];
  for (const raw of String(goal ?? '').split(/[^A-Za-z0-9_]+/)) {
    const term = raw.toLowerCase();
    if (term.length < 3) continue;
    if (STOP_WORDS.has(term)) continue;
    if (seen.has(term)) continue;
    seen.add(term);
    terms.push(term);
    if (terms.length >= MAX_TERMS) break;
  }
  return terms;
}

/**
 * Turns an interpreted goal into the files a plan should touch.
 *
 * Ranking: BM25 over the terms, with prose and configuration files at half weight, then the
 * path alphabetically. The last one exists so the result cannot depend on the order the
 * filesystem handed back — see the note on determinism above.
 *
 * WHAT IT REPLACED, AND WHY. The ranking was "distinct terms, then match count". Counting
 * matches rewards a file for being an aggregate: on astropy `CHANGES.rst` ranked FIRST with
 * 797 matches over 11 terms, and only the 64 KiB readability ceiling below kept it out of the
 * answer — the top of the list was being spent on files no plan could use.
 *
 * MEASURED, on 155 SWE-bench Verified issues replayed against the terms the live engine
 * actually grounded on (`BENCH_SWE/rank-lab.mjs`, which reproduces this function's own result
 * exactly — 13/155, the same 13 instances — before it is allowed to compare anything):
 *
 *     distinct terms, then matches   13/155 @5   median rank of the gold file  53
 *     IDF alone                      10/155      (the repair tried on 09/09 — worse, twice measured)
 *     BM25 alone                     16/155      but WORSE on sphinx: 1/25 against 4/25
 *     BM25 + prose at half weight    25/155      median 18, and no repository loses
 *
 * The two knobs are priors, not truths, and they are the honest cost of this change:
 *   - k1/b are BM25's usual constants;
 *   - the "document length" is the file's TOTAL match count, not its size in bytes. Measured
 *     both: bytes scored 21/155, matches 25/155. Length here means "how much of a magnet this
 *     file is", which is the thing that was hurting;
 *   - prose and configuration count half. A file the request really is about still wins — this
 *     is a penalty, not a partition (a partition scored the same 26/155 and is a rule about
 *     what a benchmark counts as correct, which is not a thing to put in a product).
 *     A request that IS about documentation pays for this: its targets must beat code by 2x.
 *     ponytail: one constant, one place. Move it if a real request is ever ranked wrongly.
 */
// BM25's usual constants, and the one prior this file adds: a file whose extension says prose
// or configuration scores half, so it has to be twice as good to outrank source. Measured, not
// guessed — see the ranking note on `groundRequest`. A file with no extension (AUTHORS,
// LICENSE, Makefile) counts as prose: that is where pure IDF went to lose in the 09/09 attempt.
export const BM25_K1 = 1.5;
export const BM25_B = 0.75;
export const PROSE_WEIGHT = 0.5;
export const PROSE_EXTENSIONS = new Set(['', '.md', '.rst', '.txt', '.cfg', '.toml', '.ini', '.yml', '.yaml']);
// Exported so a debugging or lab tool (e.g. BENCH_SWE/rank-*.mjs, outside this repo) can
// import the real constants instead of hand-copying them. A hand copy is exactly how
// rank-django-10097.mjs ended up scoring against a 3-extension PROSE_EXT instead of these
// real 9 — found 2026-09-12 while investigating why localization misses files it should not.
const extensionOf = (path) => {
  const name = path.slice(path.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  return dot <= 0 ? '' : name.slice(dot);
};

// Two more families at the SAME half weight, measured 2026-09-12 on the 155-instance capture:
// `bm25Doc50` (prose only) localises 42, with tests at half weight 62, with changelog-by-name as
// well 63. Same walk, same terms, only the weights differ — `BENCH_SWE/rank-lab.mjs`, whose
// control agrees with the live run on the instances it shares.
//
// # Why a TEST file is not where a change goes — as a prior, not as a benchmark rule
//
// The file that DEFINES a behaviour is a likelier place to change it than a file that EXERCISES
// it. That holds outside any benchmark: it is the difference between the thing and its witness.
// What made it visible here was a regression — the per-file match cap (`repo-map.mjs`,
// 2026-09-12) took away the advantage of the file that names a term fifty times and left
// untouched the file that names it five, so on `django-10999` and `sphinx-10323` the gold file
// fell out of the top five and five test files took the places.
//
// # Why a changelog needs its own rule
//
// The prose prior reads the EXTENSION, and `sphinx/CHANGES.old` is not one of the nine. It
// ranked FIRST on `sphinx-10323` regardless. A file called `CHANGES` is a changelog whatever is
// after the dot, and its name is the honest way to say so.
//
// # Half, and not less
//
// `testQuarter` also measures 62-63. Half is kept because this is a PENALTY and not a partition,
// the same decision taken for prose on 2026-09-10: at half weight a request that really is
// about a test file pays double and can still win, and both ceilings are covered by a test
// below. A quarter buys no localisation and costs that request twice as much.
export const TEST_DIRECTORIES = new Set(['test', 'tests', 'testing']);
export const TEST_FILENAMES = /^test_|_test\.|\.test\.|^conftest\.py$|^tests?\.py$/;
// Only the changelog-and-credits family. `Makefile`, `Dockerfile` and `setup.py` are code, and a
// prior that swept up every shouting filename would take source with it.
export const SUPPORTING_STEMS = new Set([
  'CHANGES', 'CHANGELOG', 'HISTORY', 'NEWS', 'CREDITS', 'THANKS', 'TODO',
  'AUTHORS', 'CONTRIBUTORS', 'COPYING', 'LICENSE', 'LICENCE', 'NOTICE', 'INSTALL', 'README',
]);

/**
 * `PROSE_WEIGHT` for a file that documents or exercises the code, `1` for one that defines it.
 *
 * Exported for the same reason the constants above it are: the lab tool that chose these weights
 * lives outside this repository, and a hand copy of this rule would drift from it. That already
 * happened once — `rank-django-10097.mjs` scored against three prose extensions instead of nine.
 */
// 12/09 pomeriggio, terza famiglia, misurata prima di essere scelta: il codice che non e' di
// QUESTO progetto. Una delle istanze che ha riparato nel posto sbagliato ha scritto in
// `cextern/wcslib/C/spc.h` — una libreria C vendorizzata dentro astropy. Un bug di astropy non si
// ripara nel codice di terzi che astropy trasporta, un esempio non e' il prodotto, e una pagina di
// documentazione non lo e' nemmeno quando e' scritta in Python (`docs/conf.py` sfuggiva alla
// penalita' sulla prosa, che guarda l'estensione).
//
// Misurato su `rank-lab.mjs`, 155 istanze, stessa camminata: @5 da 63 a 64, @1 da 34 a 38,
// mediana da 4 a 3. Il guadagno vero e' il RANGO, non il totale.
//
// `scripts` e `tools` sono stati PROVATI e scartati: danno gli stessi numeri esatti (64 / 38 / 3),
// quindi non comprano nulla — e in questo stesso prodotto `tools/tui-client.mjs` e
// `tools/generate-manifest.mjs` sono codice vero, che avrebbe pagato il doppio per niente.
export const OUTSIDE_PROJECT_DIRECTORIES = new Set([
  'vendor', 'vendored', 'third_party', 'thirdparty', 'cextern', 'extern', 'node_modules',
  'examples', 'example', 'docs', 'doc', 'benchmarks', 'benchmark',
]);

export function rankingWeight(path) {
  if (PROSE_EXTENSIONS.has(extensionOf(path))) return PROSE_WEIGHT;
  const parts = String(path).split('/');
  const name = parts.at(-1) ?? '';
  if (parts.slice(0, -1).some((part) => TEST_DIRECTORIES.has(part))) return PROSE_WEIGHT;
  if (TEST_FILENAMES.test(name)) return PROSE_WEIGHT;
  if (SUPPORTING_STEMS.has(name.replace(/\.[^.]*$/, '').toUpperCase())) return PROSE_WEIGHT;
  if (parts.slice(0, -1).some((part) => OUTSIDE_PROJECT_DIRECTORIES.has(part))) return PROSE_WEIGHT;
  return 1;
}

export function groundRequest({
  workspaceRoot,
  goal,
  request = '',
  limit = 5,
  maxFileBytes = 64 * 1024,
  // The seam is the BATCH form, so production and the adversarial tests below exercise one
  // path. A second path kept only for the tests is a branch nobody has checked.
  literalSearchMany = defaultLiteralSearchMany,
} = {}) {
  // BOTH, and the request's words first. Found by running this against the live engine with
  // ATOM answering: given `zzqqxx unobtainium flux`, `interpret` did not refuse and did not
  // echo — it returned "Create a program that generates a random string of characters from a
  // given set", a fluent goal with no relation to anything asked. Searching only the goal
  // meant searching a hallucination, and the `NO_CANDIDATES` refusal never fired because the
  // invented sentence had ordinary words in it that matched ordinary files.
  //
  // So the goal is not trusted to be about the request. The user's own words are always in
  // the search, which makes grounding robust to a bad `interpret` instead of dependent on a
  // good one, and the overlap between the two is REPORTED rather than enforced: a legitimate
  // paraphrase ("make login faster" -> "improve authentication performance") shares no term
  // either, so refusing on an empty overlap would refuse the good case and the bad one alike.
  // Nothing executes without an approval, and the approval can now be given knowing this.
  const requestTerms = searchTermsOf(request);
  const goalTerms = searchTermsOf(goal);
  const terms = [...requestTerms];
  for (const term of goalTerms) if (!terms.includes(term)) terms.push(term);
  const goalOverlap = goalTerms.filter((term) => requestTerms.includes(term));
  if (terms.length === 0) {
    throw new GroundingRefused(
      'NO_TERMS',
      'neither the request nor the interpreted goal carries a term specific enough to look for in this repository; name a file, a symbol or a message',
      { goal: String(goal ?? ''), request: String(request ?? '') },
    );
  }

  /** path -> { terms:Map<term, howManyTimes>, matches:number } */
  const byPath = new Map();
  /** term -> in how many files it appears at all, BM25's document frequency. */
  const documentFrequency = new Map();
  // ONE walk for every term. This used to be one walk PER term, which on a real repository was
  // most of the time a plan took: same tree, same files, read and lowercased `terms.length`
  // times over. The answers are the same ones — see `literalSearchMany`.
  const { results } = literalSearchMany(workspaceRoot, terms, { caseSensitive: false, maxMatches: 200 });
  for (const result of results) {
    const filesForTerm = new Set();
    for (const match of result.matches) {
      const entry = byPath.get(match.path) ?? { terms: new Map(), matches: 0 };
      entry.terms.set(result.query, (entry.terms.get(result.query) ?? 0) + 1);
      entry.matches += 1;
      byPath.set(match.path, entry);
      filesForTerm.add(match.path);
    }
    documentFrequency.set(result.query, filesForTerm.size);
  }

  const candidateCount = byPath.size || 1;
  const averageMatches = [...byPath.values()].reduce((total, entry) => total + entry.matches, 0) / candidateCount;
  const ranked = [...byPath.entries()]
    .map(([path, entry]) => {
      let score = 0;
      for (const [term, howManyTimes] of entry.terms) {
        const rarity = Math.log(1 + candidateCount / Math.max(1, documentFrequency.get(term) ?? 1));
        const saturation = (howManyTimes * (BM25_K1 + 1))
          / (howManyTimes + BM25_K1 * (1 - BM25_B + BM25_B * (entry.matches / (averageMatches || 1))));
        score += rarity * saturation;
      }
      score *= rankingWeight(path);
      return { path, score, distinctTerms: entry.terms.size, matches: entry.matches, terms: [...entry.terms.keys()].sort() };
    })
    .sort((a, b) => (
      b.score - a.score
      || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)
    ));

  if (ranked.length === 0) {
    throw new GroundingRefused(
      'NO_CANDIDATES',
      `nothing in this workspace mentions ${terms.map((t) => `\`${t}\``).join(', ')} — the request may be about something this project does not contain, or may need a file named explicitly`,
      { terms },
    );
  }

  const files = [];
  const skipped = [];
  for (const candidate of ranked) {
    if (files.length >= limit) break;
    // Defence in depth. `literalSearch` walks the root and reports paths relative to it, so
    // a candidate is inside by construction — but "by construction" is a property of another
    // module, and this one is about to read whatever it is handed.
    try {
      contained(workspaceRoot, candidate.path);
    } catch {
      skipped.push({ path: candidate.path, reason: 'OUTSIDE_WORKSPACE' });
      continue;
    }
    const absolute = join(workspaceRoot, candidate.path);
    let size;
    try { size = statSync(absolute).size; } catch { skipped.push({ path: candidate.path, reason: 'UNREADABLE' }); continue; }
    if (size > maxFileBytes) {
      // Not truncated. A plan reasoning over half a file, with nothing saying so, is worse
      // than a plan that never saw it: the missing half is invisible to whoever approves.
      skipped.push({ path: candidate.path, reason: 'TOO_LARGE', bytes: size });
      continue;
    }
    let contents;
    try {
      contents = readFileSync(absolute, 'utf8');
    } catch {
      skipped.push({ path: candidate.path, reason: 'UNREADABLE' });
      continue;
    }
    // Found by running this against the live installation, where the workspace root is the
    // runtime directory: literal search matched byte coincidences INSIDE PostgreSQL heap
    // files, and the top candidates for "fix the session protocol refusal" came back as
    // `postgresql/data/base/16384/2664`. A plan proposing to edit a database's storage is
    // not a weak plan, it is a dangerous one, and it looked exactly as plausible as a good
    // one in the approval screen.
    //
    // A NUL byte is the cheap, standard test for "this is not text", and it is the right one
    // here: the question is not what format a file is, it is whether editing it as text is a
    // coherent thing to propose. Skipped and SAID to be skipped, like every other exclusion.
    if (contents.includes('\u0000')) {
      skipped.push({ path: candidate.path, reason: 'NOT_TEXT' });
      continue;
    }
    files.push({ path: candidate.path, contents });
  }

  if (files.length === 0) {
    throw new GroundingRefused(
      'NO_READABLE_CANDIDATES',
      'every file this request points at was skipped before it could be read',
      { terms, skipped },
    );
  }

  return {
    files,
    // Declared, and carried into the run's record. Whoever approves this plan must be able to
    // tell that the engine chose these files from a search rather than that a human named
    // them — the two deserve different scrutiny, and a result that hides which one happened
    // is asking for a decision under a false premise.
    grounding: {
      derived: true,
      terms,
      requestTerms,
      goalTerms,
      // Empty means the provider's goal shares no searchable word with what was asked. That
      // is true of a hallucination and also of a good paraphrase, so it is a signal for
      // whoever approves, not a verdict this module is entitled to reach.
      goalOverlap,
      goalRelatedToRequest: goalOverlap.length > 0,
      considered: ranked.length,
      selected: files.map((file) => file.path),
      ranking: ranked.slice(0, limit).map(({ path, distinctTerms, matches, terms: hit }) => ({ path, distinctTerms, matches, terms: hit })),
      skipped,
    },
  };
}
