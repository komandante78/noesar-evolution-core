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
// repository, by literal search, over terms taken from the interpreted goal; the model's
// influence on the selection is the goal it returned, and nothing else. Every path in the
// result was read off a real file this workspace contains. That is the same guarantee the
// refusal gave, obtained by construction instead of by refusing to act.
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
import { literalSearch as defaultLiteralSearch } from './repo-map.mjs';
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
  // Italian
  'che', 'per', 'con', 'del', 'della', 'delle', 'dei', 'degli', 'dal', 'dalla', 'nel', 'nella',
  'sul', 'sulla', 'una', 'uno', 'gli', 'le', 'la', 'il', 'lo', 'un', 'di', 'da', 'in', 'su',
  'non', 'sono', 'essere', 'come', 'quando', 'dove', 'perche', 'perché', 'questo', 'questa',
  'quello', 'quella', 'tutto', 'tutti', 'anche', 'più', 'piu', 'deve', 'devono', 'fare', 'fatto',
  'aggiungi', 'cambia', 'correggi', 'nuovo', 'vecchio', 'si', 'no', 'ma', 'se', 'ed', 'al', 'ai',
]);

const MAX_TERMS = 12;

/** The searchable terms of an interpreted goal, in first-appearance order.
 *
 *  Taken from the goal the provider returned rather than from the raw request, deliberately:
 *  it is the one place a real model's understanding is allowed to steer this step. With the
 *  reference provider the goal is the request's first sentence quoted verbatim — a weaker
 *  grounding, honestly weaker, and the same code path, so `CE-022` (the suite passes with
 *  ATOM uninstalled) does not depend on which provider answered. */
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
 * Ranking, in order and all of it total: how many DISTINCT terms a file matched (a file the
 * whole goal points at beats one that happens to contain a common word many times), then the
 * match count, then the path alphabetically. The last one exists so the result cannot depend
 * on the order the filesystem handed back — see the note on determinism above.
 */
export function groundRequest({
  workspaceRoot,
  goal,
  limit = 5,
  maxFileBytes = 64 * 1024,
  literalSearch = defaultLiteralSearch,
} = {}) {
  const terms = searchTermsOf(goal);
  if (terms.length === 0) {
    throw new GroundingRefused(
      'NO_TERMS',
      'the interpreted goal carries no term specific enough to look for in this repository; name a file, a symbol or a message',
      { goal: String(goal ?? '') },
    );
  }

  /** path -> { terms:Set, matches:number } */
  const byPath = new Map();
  for (const term of terms) {
    const result = literalSearch(workspaceRoot, term, { caseSensitive: false, maxMatches: 200 });
    for (const match of result.matches) {
      const entry = byPath.get(match.path) ?? { terms: new Set(), matches: 0 };
      entry.terms.add(term);
      entry.matches += 1;
      byPath.set(match.path, entry);
    }
  }

  const ranked = [...byPath.entries()]
    .map(([path, entry]) => ({ path, distinctTerms: entry.terms.size, matches: entry.matches, terms: [...entry.terms].sort() }))
    .sort((a, b) => (
      b.distinctTerms - a.distinctTerms
      || b.matches - a.matches
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
    try {
      files.push({ path: candidate.path, contents: readFileSync(absolute, 'utf8') });
    } catch {
      skipped.push({ path: candidate.path, reason: 'UNREADABLE' });
    }
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
      considered: ranked.length,
      selected: files.map((file) => file.path),
      ranking: ranked.slice(0, limit).map(({ path, distinctTerms, matches, terms: hit }) => ({ path, distinctTerms, matches, terms: hit })),
      skipped,
    },
  };
}
