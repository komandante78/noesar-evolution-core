// SPDX-License-Identifier: AGPL-3.0-or-later
//
// @noesar/spoken-intent — resolving what a person said against a registry of things a product
// can do, deterministically, in any language, with a refusal instead of a guess.
//
// Extracted from NOESAR EVOLUTION's voice layer (`apps/webui-static/voice-intent.js`). What is
// extracted is the ALGORITHM; what stays in the product is everything that knows about the
// product — how an entry is shaped, what a destination is, which sentences are said back, and
// which words are filler in which language. Those are injected, so this module has no opinion
// about any of them and no dependency on a browser, a DOM, a translator or a clock.
//
// # The one property this exists to preserve
//
// **Exact-or-containing, never fuzzy.** There is no edit distance and no partial-word scoring,
// because *a near miss that acts is worse than a miss that asks*: the person is not looking at
// what they said, so a wrong action is discovered only after it has happened. Every rank below
// is a containment relation. That is the whole design, and it is why this is worth specifying
// rather than describing.
//
// See `../SPEC.md`. Requirement ids are cited on the functions that satisfy them.

/** `SI-004` · The ladder, best first. Frozen and exactly eight, because a caller comparing
 *  `hit.rank` to a number needs the numbers to be part of the contract, not an implementation
 *  detail that can be reordered. */
export const RANK = Object.freeze({
  /** Exactly the entry's own name or full address. */
  NAME: 0,
  /** Exactly the last segment of an address. Below NAME so a convenience cannot tie with a name. */
  SEGMENT: 1,
  /** Exactly the entry's rendered description — for an address, its label. */
  PROSE: 2,
  /** A name or segment that begins with what was said. */
  PREFIX: 3,
  /** A description that begins with what was said. */
  PROSE_PREFIX: 4,
  /** What was said appears as a whole word inside some handle. */
  WORD: 5,
  /** What was said appears inside some handle at all. */
  SUBSTRING: 6,
  /** The heading of the group the entry sits in. Last, always. */
  GROUP: 7,
});

/** `SI-001` · What the resolver decided. Named rather than boolean-shaped so a surface renders
 *  each case in its own words instead of inferring which one it is holding. */
export const Outcome = Object.freeze({
  /** Nothing was said, or nothing but filler. */
  UNHEARD: 'unheard',
  /** Heard clearly, matched nothing this registry has. */
  NOTHING: 'nothing',
  /** Heard clearly, matched several that lead somewhere different. The caller asks; it never picks. */
  AMBIGUOUS: 'ambiguous',
  /** Exactly one. */
  INTENT: 'intent',
});

/**
 * `SI-002` · Letters, digits, `/` and `-` only; accents folded; case dropped; spacing collapsed.
 *
 * Accent folding is not cosmetic and it is not a nicety for typists. Transcription models
 * disagree with each other and with keyboards about `perché` / `perche` / `perchè`, so a
 * resolver that treated those as three different words would work with one speech engine and
 * fail with the next — a dependence on a particular vendor hidden inside a string function.
 */
export function normalise(text) {
  return String(text ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '') // the Unicode property, so no combining mark is written literally here
    .toLowerCase()
    .replace(/[^a-z0-9/\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * `SI-003` · The utterance with the filler removed — the words that actually name something.
 *
 * `filler` is injected, and that is the whole reason this is portable: which words carry no
 * intent is a fact about a language, not about an algorithm. A caller with no filler set gets
 * every word back, which is correct rather than degraded.
 *
 * A phrase that is nothing BUT filler comes back empty, and the caller reports `UNHEARD` rather
 * than matching everything: "open the" has named nothing.
 */
export function contentWords(text, filler = EMPTY) {
  return normalise(text).split(' ').filter((word) => word && !filler.has(word));
}

const EMPTY = Object.freeze(new Set());

/**
 * `SI-004` · The entries that answer to a phrase, best first, with how well each answered.
 *
 * Each entry supplies its own handles — `{ name, segment, prose }`, each an iterable of already
 * normalised strings. Producing them is the product's job: it is where an entry's shape, its
 * translations and its aliases live, none of which this module can know.
 *
 * A term matches at `exact` when it IS the phrase, at `prefix` when it starts with the phrase
 * followed by a separator, at `WORD` when the phrase sits inside it delimited, and at
 * `SUBSTRING` when it merely occurs. Being buried in the middle of something says nothing about
 * which handle it was, so the last two ranks do not vary by source.
 */
export function rankEntries(phrase, entries = [], { filler = EMPTY, groupTitles = {} } = {}) {
  const wanted = contentWords(phrase, filler).join(' ');
  if (!wanted) return [];
  const scoreOf = (term, exact, prefix) => (term === wanted ? exact
    : term.startsWith(`${wanted} `) || term.startsWith(`${wanted}/`) ? prefix
      : term.includes(` ${wanted} `) || term.includes(`/${wanted}`) ? RANK.WORD
        : term.includes(wanted) ? RANK.SUBSTRING
          : null);
  const hits = [];
  for (const entry of entries) {
    const handles = entry?.handles ?? {};
    let best = null;
    const consider = (rank) => { if (rank !== null && (best === null || rank < best)) best = rank; };
    for (const term of handles.name ?? []) consider(scoreOf(term, RANK.NAME, RANK.PREFIX));
    for (const term of handles.segment ?? []) consider(scoreOf(term, RANK.SEGMENT, RANK.PREFIX));
    for (const term of handles.prose ?? []) consider(scoreOf(term, RANK.PROSE, RANK.PROSE_PREFIX));
    // A group heading answers only where nothing else did. It names a room, not a door.
    if (best === null) {
      const heading = groupTitles[entry?.group];
      if (heading && normalise(heading) === wanted) best = RANK.GROUP;
    }
    if (best !== null) hits.push({ entry, rank: best });
  }
  return hits.sort((a, b) => a.rank - b.rank);
}

/**
 * `SI-005` · One answer, or none — collapsing by DESTINATION rather than by count.
 *
 * Two entries that lead to the same place are not a choice, and counting them as one would be
 * the difference between a product that answers and a product that asks a question with one
 * real answer in it. A registry legitimately holds the same destination twice: a command and the
 * address it resolves to are two rows and one place.
 */
export function uniqueHit(hits, destinationOf) {
  if (!hits.length) return null;
  const best = hits.filter((hit) => hit.rank === hits[0].rank);
  const destinations = new Set(best.map((hit) => destinationOf(hit.entry)));
  return destinations.size === 1 ? best[0].entry : null;
}

/**
 * `SI-001`, `SI-006` · Resolve one utterance.
 *
 * Order matters and is normative: the WHOLE phrase is tried first, and only if that names
 * nothing unique is a trailing argument considered. Trying the argument split first would let
 * "plan" be read as the command "p" with the argument "lan" long before the entry actually
 * called "plan" was reached.
 *
 * `SI-006`: the argument cut walks from the END inwards, and the head must match at `RANK.NAME`
 * on an entry that ACCEPTS an argument. Both conditions are load-bearing — a substring match
 * with a trailing word attached is a guess, and an entry that takes no argument cannot have been
 * given one.
 */
export function resolve(utterance, {
  entries = [], destinationOf = (entry) => entry?.id ?? entry?.name,
  filler = EMPTY, groupTitles = {}, acceptsArgument = (entry) => Boolean(entry?.argument),
} = {}) {
  const heard = String(utterance ?? '').trim();
  if (!contentWords(heard, filler).length) return { kind: Outcome.UNHEARD, heard };

  const whole = rankEntries(heard, entries, { filler, groupTitles });
  const only = uniqueHit(whole, destinationOf);
  if (only) return { kind: Outcome.INTENT, heard, entry: only, argument: '' };

  // Spoken tokens, kept as spoken — the argument is cut from THIS array, so the person's own
  // words survive. The normalised copy only decides where the cut goes.
  const spoken = heard.split(/\s+/).filter(Boolean);
  const compared = spoken.map((token) => normalise(token));
  let start = 0;
  while (start < compared.length && (!compared[start] || filler.has(compared[start]))) start += 1;

  for (let cut = spoken.length - 1; cut > start; cut -= 1) {
    const named = compared.slice(start, cut).join(' ');
    const hits = rankEntries(named, entries, { filler, groupTitles })
      .filter((hit) => hit.rank === RANK.NAME && acceptsArgument(hit.entry));
    const entry = uniqueHit(hits, destinationOf);
    if (!entry) continue;
    return { kind: Outcome.INTENT, heard, entry, argument: spoken.slice(cut).join(' ') };
  }

  if (whole.length) {
    // Named several that genuinely differ. The candidates are returned rather than a count, so
    // the surface can show them and the person can say one.
    const seen = new Set();
    const candidates = whole.filter((hit) => hit.rank === whole[0].rank)
      .filter((hit) => { const where = destinationOf(hit.entry); if (seen.has(where)) return false; seen.add(where); return true; })
      .map((hit) => hit.entry);
    return { kind: Outcome.AMBIGUOUS, heard, candidates };
  }
  return { kind: Outcome.NOTHING, heard };
}

/** `SI-007` · The default conjunctions, longest first so "e poi" is tried before the "e" in it. */
export const CONJUNCTIONS = Object.freeze([' e poi ', ' and then ', ' e ', ' and ', ' poi ', ' then ']);
/** `SI-007` · The words the conjunctions are built from. A tail made only of these asked nothing. */
export const CONNECTIVES = Object.freeze(new Set(['e', 'and', 'poi', 'then']));

/**
 * `SI-007` · "Do this AND tell me that" — one utterance that is a command and a question.
 *
 * **Additive by construction, and this is normative.** It runs only where `resolve` already
 * answered `NOTHING`, so every utterance that resolves today resolves identically tomorrow. A
 * phrase that navigates cannot start doing something else — the failure this whole module is
 * shaped to avoid.
 *
 * The head must resolve to a single `INTENT` by the ordinary rules. That is what makes splitting
 * on " e " safe in a language that uses it constantly: *"parlami di gatti e cani"* has a head
 * that resolves to nothing, so nothing splits and the whole sentence stays one turn.
 *
 * @returns `{head, tail, intent}` or `null` — never a partial answer the caller must re-check.
 */
export function splitCompound(utterance, options = {}) {
  const { conjunctions = CONJUNCTIONS, connectives = CONNECTIVES, filler = EMPTY } = options;
  const heard = String(utterance ?? '').trim();
  if (!heard) return null;
  if (resolve(heard, options).kind !== Outcome.NOTHING) return null;
  const lowered = ` ${heard.toLowerCase()} `;
  for (const conjunction of conjunctions) {
    let from = 0;
    for (;;) {
      const at = lowered.indexOf(conjunction, from);
      if (at < 0) break;
      from = at + 1;
      // Offsets index `lowered`, which is the original with one space prepended.
      const head = heard.slice(0, Math.max(0, at - 1)).trim();
      const tail = heard.slice(at - 1 + conjunction.length).trim();
      if (!head) continue;
      // The tail has to ASK something. Content words alone are not enough: a leftover connective
      // is a content word and means nothing — "apri la memoria e poi" split on the bare " e "
      // leaves "poi".
      if (!contentWords(tail, filler).some((word) => !connectives.has(word))) continue;
      const intent = resolve(head, options);
      if (intent.kind !== Outcome.INTENT) continue;
      return { head, tail, intent };
    }
  }
  return null;
}
