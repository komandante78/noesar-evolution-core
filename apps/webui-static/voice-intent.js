// SPDX-License-Identifier: AGPL-3.0-or-later
//
// From what was heard to the line the prompt already accepts.
//
// Owner, s336: *«il voice deve fare tutto non deve essere statico»*. Stage 1 (`voice-engine.mjs`)
// gave the installation its own ears and voice. This is the other half of "non statico": what
// those ears produce has to be able to reach the whole product, not five words.
//
// # The build that was rejected, and why it was never really a candidate
//
// The obvious shape is a voice vocabulary: a table of spoken phrases mapped to actions, grown
// one row at a time. `voice-control.js` IS that table, at five rows, and the reason it stayed at
// five is structural rather than lazy — every row is a second name for something the product
// already names somewhere else, so the table starts drifting from the product the moment either
// changes. This repository has paid for that shape twice already, both times measured rather
// than argued: `PANEL_NAMES` listing fourteen panels against a markup of twenty-five, and
// `DECLARED_EMPTY_PANELS` re-deriving a list it already had. A voice table would have been the
// third, and the worst placed of the three: nobody reads a voice table to find out what the
// product can do, so its drift is invisible until someone speaks into it.
//
// # What this does instead
//
// It resolves an utterance against the SAME entries the `/` menu resolves typing against —
// thirty-three commands and fifty-four addresses, handed in by the caller, derived from the
// markup the browser renders and served to the terminal over the wire. Not a copy of that list:
// the list. So the answer to "what can I say?" is "whatever you can type", permanently, and a
// panel added to `index.html` tomorrow is speakable the same afternoon with nothing edited here.
//
// Two consequences worth stating, because they are the point rather than side effects:
//
//   1. **Voice cannot mint authority.** This returns a LINE — the same text a person could have
//      typed — and the caller feeds it to the same `planTurn`. There is no path by which speech
//      reaches a capability typing does not, and none by which it skips a confirmation. That is
//      `D-0123`'s rule ("promote a result, not an intention"), kept by construction rather than
//      by a check that has to be remembered.
//   2. **It never guesses.** One candidate resolves; two or more come back as a question naming
//      them. `D-0123` already fixed this posture for the five-word tower — "on anything it did
//      not clearly hear it repeats the question rather than guessing which of two outcomes to
//      run" — and a resolver over eighty-seven entries needs it far more than one over five.
//
// # The only thing written by hand here
//
// `FILLER` — articles, prepositions and the handful of verbs a person puts in front of a
// destination ("apri…", "go to…"). It is worth being precise about what that list can and cannot
// do, because "no hand-written lists" was the whole argument above: it holds no destination and
// no capability, so it cannot make the product reach more or less than the prompt reaches. The
// worst a wrong entry can do is fail to strip a word, and a failure to strip is a failure to
// match, which comes back as `nothing` — the honest answer — and never as the wrong action.

/** Words that carry no destination: articles, prepositions, and the verbs of going and showing.
 *  Both languages in one set on purpose — a person switching languages mid-sentence is common,
 *  and nothing here depends on knowing which language was spoken. */
export const FILLER = Object.freeze(new Set([
  // English
  'the', 'a', 'an', 'to', 'into', 'on', 'in', 'of', 'my', 'me', 'please',
  'go', 'goto', 'open', 'show', 'take', 'bring', 'display', 'jump', 'switch', 'view',
  // Italiano
  'il', 'lo', 'la', 'i', 'gli', 'le', 'un', 'uno', 'una', 'l',
  'a', 'al', 'allo', 'alla', 'ai', 'agli', 'alle', 'su', 'sul', 'sullo', 'sulla', 'sui', 'sugli',
  'sulle', 'nel', 'nello', 'nella', 'nei', 'negli', 'nelle', 'del', 'dello', 'della', 'dei',
  // Single words only: this set is consulted one token at a time, so a two-word entry like
  // "per favore" could never match anything and would read as coverage that is not there.
  'degli', 'delle', 'di', 'per', 'mi', 'favore',
  'apri', 'apre', 'aprire', 'vai', 'vado', 'andare', 'mostra', 'mostrami', 'mostrare',
  'portami', 'porta', 'fammi', 'vedi', 'vedere', 'passa', 'passare',
]));

/** What the resolver decided. Named rather than boolean-shaped so a surface can render each
 *  case in its own words instead of inferring which one it is holding. */
export const VoiceIntent = Object.freeze({
  /** Nothing was said, or nothing but filler. */
  UNHEARD: 'unheard',
  /** Heard clearly, matched nothing this product has. */
  NOTHING: 'nothing',
  /** Heard clearly, matched several. The caller asks; it does not pick. */
  AMBIGUOUS: 'ambiguous',
  /** Exactly one. `line` is what the prompt would have received from a keyboard. */
  INTENT: 'intent',
});

/**
 * What following an intent would actually do.
 *
 * The distinction exists because a microphone has no Enter key, and something has to stand in
 * for the moment a person commits. Going somewhere is reversible by going back; running a
 * command is not, and `/approve` is in the same list as `/home`. So the two are separated HERE,
 * where the entry's own kind is known, rather than left to a surface to work out from the name.
 */
export const VoiceDisposition = Object.freeze({
  /** A place. Safe to act on the moment it is understood. */
  NAVIGATE: 'navigate',
  /** A capability. The surface must put it in front of a person before it is sent. */
  RUN: 'run',
});

/** Letters and digits only, accents folded, case dropped, spacing collapsed.
 *
 *  Accent folding is not cosmetic: transcription models disagree with each other and with
 *  keyboards about `perché` / `perche` / `perchè`, and a resolver that treats those as three
 *  different words would work for one model and not the next — which is exactly the kind of
 *  dependence on a particular engine that stage 1 removed from the layer below. */
export function normalise(text) {
  return String(text ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '') // the Unicode property, so no combining mark is written literally here
    .toLowerCase()
    .replace(/[^a-z0-9/\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The utterance with the filler removed — the words that actually name something.
 *
 *  A phrase that is nothing BUT filler comes back empty, and the caller reports `unheard`
 *  rather than matching everything: "open the" has named nothing. */
export function contentWords(text) {
  return normalise(text).split(' ').filter((word) => word && !FILLER.has(word));
}

/**
 * Everything one entry can be called, normalised.
 *
 * The sources are the entry's own name, its address, and its summary AS THE CATALOGUE RENDERS
 * IT — that last one is what makes speaking Italian work, and it is the same sentence the menu
 * paints on the same row, so what a person reads is what they can say. No second vocabulary and
 * no per-language table. The translator is injected exactly as `hiddenNote`'s is, and for the
 * same two reasons: this file must load without a browser, and the terminal has no `i18n.js`.
 *
 * Every term is offered in TWO forms — as written, and with the filler removed. Measured, not
 * anticipated: the utterance has its filler stripped before matching, so "flussi di lavoro"
 * arrives as `flussi lavoro` and did not match the label `flussi di lavoro`, which contains the
 * preposition the speaker's own words had just lost. Stripping one side and not the other is not
 * a rule at all — it is two different rules, and the second one is invisible.
 */
function expand(values) {
  const terms = new Set();
  for (const value of values) {
    const term = normalise(value);
    if (!term) continue;
    terms.add(term);
    const stripped = contentWords(term).join(' ');
    if (stripped) terms.add(stripped);
  }
  return terms;
}

/**
 * The three kinds of handle an entry has, kept apart because they do not carry equal weight.
 *
 *   `name`    — what the entry IS called: its own name, its full address. The menu paints these.
 *   `segment` — the last part of an address. `coden/bench/diff` is "diff" to the person who
 *               wants it, and asking anyone to say three slash-separated words aloud would make
 *               the address space technically reachable and practically not. A convenience, and
 *               therefore never allowed to tie with a real name.
 *   `prose`   — the description. What the entry is ABOUT, not what it is called.
 */
export function handlesFor(entry, translate = (text) => text) {
  const address = normalise(entry?.address);
  const summary = entry?.summary;
  const localised = summary ? translate(summary) : null;
  return {
    name: expand([entry?.name, entry?.address]),
    segment: address.includes('/') ? expand([address.slice(address.lastIndexOf('/') + 1)]) : new Set(),
    prose: expand([summary, localised && localised !== summary ? localised : null]),
  };
}

/** Every handle at once — what a caller means by "all the things this can be called". */
export function termsFor(entry, translate = (text) => text) {
  const handles = handlesFor(entry, translate);
  return [...new Set([...handles.name, ...handles.segment, ...handles.prose])];
}

/**
 * How well a phrase answered, lowest is best. Exported because the ORDER is the behaviour: it is
 * what decides whether the product acts or asks, and a test that could not name a rank could
 * only assert the outcome of today's arrangement rather than the rule behind it.
 *
 * The order has two dimensions and EXACTNESS is the outer one: every exact match outranks every
 * partial one, whatever handle each was found on. That ordering was not the first attempt, and
 * the case that corrected it is worth keeping: saying "Ricerca" — which is the Italian label of
 * the Research page, printed in the sidebar — resolved to `/search`, because `/search`'s Italian
 * description happens to BEGIN with the word "Ricerca letterale…". A page's whole name lost to
 * the first word of another entry's sentence. Ranking the handle before the exactness says that
 * a description is always worth less than a name, which sounds right and is wrong: being the
 * whole of what someone said is the strongest evidence available here.
 */
export const RANK = Object.freeze({
  /** Exactly the entry's own name or full address. */
  NAME: 0,
  /** Exactly the last segment of an address. Below NAME so a convenience cannot tie with a name. */
  SEGMENT: 1,
  /** Exactly the description — which, for an address, is its LABEL: "Ricerca", "Memoria". */
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

/** Kept as its own export because callers reason about "was this only a group match?". */
export const GROUP_RANK = RANK.GROUP;

/**
 * The entries that answer to a phrase, best first, with how well each answered.
 *
 * Every rank is exact-or-containing and none is fuzzy. There is no edit distance and no
 * partial-word scoring, because a near miss that acts is worse than a miss that asks: the person
 * is not looking at what they said, so a wrong action is discovered after it has happened.
 * `matchVoiceCommand` in the old tower took the same position for the same reason, and it is the
 * one thing about that file worth keeping.
 *
 * # Why NAME must beat SEGMENT, found by running this against the real list
 *
 * With both at rank 0, saying `plan` was AMBIGUOUS — the command `/plan` and the agent panel
 * `coden/agent/plan`, whose last segment is also "plan". Four of the product's most ordinary
 * words behaved that way (`plan`, `diff`, `projects`, `agents`), so the reply to the most direct
 * thing a person can say was a question. Typing `/plan` has never asked: the prompt resolves the
 * first entry, which is the command. Worth being clear that this is not the resolver papering
 * over a real choice — `planTurn` already unifies the two, sending a bare `/diff` to the panel
 * that shows a diff because the command needs a run it was not given. So the command name is the
 * right answer AND it arrives at the panel anyway. A derived convenience must not outvote a name.
 *
 * # Why the group heading is last
 *
 * It exists because of a measured hole rather than a hunch. `/approvals` has no entry in the
 * address book — it is the one destination s328 added without a nav button — so the only Italian
 * it owns is inside its description, and nobody says "tutto ciò che attende una decisione umana"
 * to a microphone. Its GROUP is titled `APPROVAZIONI`, a name the product itself paints. Ranked
 * last, it answers only where nothing else did; where a group holds several things it produces a
 * question rather than a pick, which is right for a word that names a room and not a door.
 */
export function rankEntries(phrase, entries, translate, groupTitles = {}) {
  const wanted = contentWords(phrase).join(' ');
  if (!wanted) return [];
  // `exact` is the rank this handle earns when the phrase IS the term; `prefix` when the term
  // merely starts with it. Word and substring matches are the same wherever they were found —
  // being buried in the middle of something says nothing about which handle it was.
  const scoreOf = (term, exact, prefix) => (term === wanted ? exact
    : term.startsWith(`${wanted} `) || term.startsWith(`${wanted}/`) ? prefix
      : term.includes(` ${wanted} `) || term.includes(`/${wanted}`) ? RANK.WORD
        : term.includes(wanted) ? RANK.SUBSTRING
          : null);
  const hits = [];
  for (const entry of entries ?? []) {
    const handles = handlesFor(entry, translate);
    let best = null;
    const consider = (rank) => { if (rank !== null && (best === null || rank < best)) best = rank; };
    for (const term of handles.name) consider(scoreOf(term, RANK.NAME, RANK.PREFIX));
    for (const term of handles.segment) consider(scoreOf(term, RANK.SEGMENT, RANK.PREFIX));
    for (const term of handles.prose) consider(scoreOf(term, RANK.PROSE, RANK.PROSE_PREFIX));
    if (best === null) {
      const heading = groupTitles[entry?.group];
      if (heading && [normalise(heading), normalise(translate(heading))].includes(wanted)) best = RANK.GROUP;
    }
    if (best !== null) hits.push({ entry, rank: best });
  }
  return hits.sort((a, b) => a.rank - b.rank);
}

function dispositionOf(entry) {
  return entry?.kind === 'address' ? VoiceDisposition.NAVIGATE : VoiceDisposition.RUN;
}

/** The line a keyboard would have produced. `/` because that is the gesture the prompt reads —
 *  `isCommandPrompt` looks at the first character and nothing else. */
function lineFor(entry, argument = '') {
  const said = String(argument ?? '').trim();
  return said ? `/${entry.name} ${said}` : `/${entry.name}`;
}

/**
 * Where an entry actually leads — the thing two entries have to differ in before "several
 * matched" is a real question.
 *
 * Measured, not assumed, and it changed this function: seventeen of the thirty-three commands
 * are `kind: 'address'` carrying the very address the address book also lists, so `menuEntriesFor`
 * legitimately holds `memory` TWICE. Typing is unaffected — the prompt resolves the first — but a
 * resolver that counted candidates would have called every one of the product's main pages
 * ambiguous and asked the person to choose between an entry and its own twin. An identical
 * destination is not a choice.
 */
export function destinationOf(entry) {
  return entry?.kind === 'address' ? `address:${entry.address ?? entry.name}` : `command:${entry?.name}`;
}

function unique(hits) {
  if (!hits.length) return null;
  const best = hits.filter((hit) => hit.rank === hits[0].rank);
  const destinations = new Set(best.map((hit) => destinationOf(hit.entry)));
  return destinations.size === 1 ? best[0].entry : null;
}

/**
 * Resolve one utterance.
 *
 * Two passes, in this order:
 *
 *   1. The whole phrase. "memoria" and "the coding workbench" both land here.
 *   2. A PREFIX of the phrase names a command, and the rest is its argument — "piano sistema il
 *      login rotto" becomes `/plan sistema il login rotto`. Longest prefix first, so a command
 *      whose name is two words is not beaten to it by a one-word command hiding inside it.
 *      Offered only for entries that declare they take an argument, because handing a subject to
 *      something that takes none is how `/diff <prose>` became a server error in a transcript
 *      about a call nobody asked to make (s333 point 2).
 *
 *      Two things about this pass are load-bearing, and both were put there by a defect the
 *      first version had, found by running it against the product's real list rather than by
 *      reading it:
 *
 *      - **The command must be NAMED, not merely mentioned** — the prefix has to match at
 *        `RANK.NAME`, which only a name or a full address can earn. Without that limit, "stato
 *        del motore" resolved to `/closure motore`: the Italian summary of `/closure` contains
 *        "che cosa è stato fatto", so "stato" was found inside it, `/closure` takes an argument,
 *        and the rest of the sentence became one. A command that RUNS, assembled out of a
 *        substring of somebody else's prose, is the worst failure available to this file.
 *
 *        The rank IS the guard, and that is worth writing down because the first version also
 *        passed a flag telling `rankEntries` to ignore descriptions here. Mutation testing found
 *        it: removing the flag killed nothing, because a description can never reach `RANK.NAME`
 *        however it matched. Two mechanisms for one rule, one of them decorative — and the
 *        decorative one is the one a later reader would have trusted.
 *
 *        The cost is real and is stated rather than hidden: to dictate a subject you must say
 *        the command's own name — "plan fix the login", "search getUser", "closure it is done".
 *        Those names are English, and the product has no Italian for them anywhere, because a
 *        command's Italian lives only in its description and a description is exactly what may
 *        not be used here. The alternative was a hand-written table of spoken verbs per command,
 *        which is the drifting second list this whole file exists to avoid — and it would have
 *        bought convenience with the one failure mode that runs something nobody asked for.
 *        Everything that takes NO argument, and every one of the fifty-four destinations, is
 *        reachable in Italian by the words the interface itself paints.
 *      - **The argument keeps the speaker's own words.** It is sliced from the utterance as
 *        spoken, not from the filler-stripped form used for matching — "sistema il login rotto"
 *        must not reach a plan as "sistema login rotto". Matching may throw words away; the
 *        subject handed to a capability may not.
 *
 * `entries` is the caller's own resolved list — `[...menu.entries, ...addressEntries(served)]`,
 * the same array `planTurn` resolves against. Passing a filtered menu therefore filters speech
 * by the same rule, with nothing here knowing that permissions exist.
 */
export function resolveUtterance(
  utterance,
  { entries = [], translate = (text) => text, groupTitles = {} } = {},
) {
  const heard = String(utterance ?? '').trim();
  if (!contentWords(heard).length) return { kind: VoiceIntent.UNHEARD, heard };

  const whole = rankEntries(heard, entries, translate, groupTitles);
  const only = unique(whole);
  if (only) {
    return {
      kind: VoiceIntent.INTENT, heard, entry: only,
      line: lineFor(only), argument: '', disposition: dispositionOf(only),
    };
  }

  // Spoken tokens, kept as spoken — the argument is cut from THIS array. The parallel normalised
  // array is only ever used to decide where the cut goes.
  const spoken = heard.split(/\s+/).filter(Boolean);
  const compared = spoken.map((token) => normalise(token));
  let start = 0;
  while (start < compared.length && (!compared[start] || FILLER.has(compared[start]))) start += 1;

  for (let cut = spoken.length - 1; cut > start; cut -= 1) {
    const named = compared.slice(start, cut).join(' ');
    const hits = rankEntries(named, entries, translate, groupTitles)
      .filter((hit) => hit.rank === RANK.NAME && String(hit.entry?.argument ?? '').trim());
    const entry = unique(hits);
    if (!entry) continue;
    const argument = spoken.slice(cut).join(' ');
    return {
      kind: VoiceIntent.INTENT, heard, entry,
      line: lineFor(entry, argument), argument, disposition: dispositionOf(entry),
    };
  }

  if (whole.length) {
    // Named several. The candidates are returned rather than a count, so the surface can show
    // them and the person can say one — which is the same repair the menu makes for a partial
    // word, reached by a different input device. Collapsed by destination first, for the same
    // reason `unique` collapses: an entry and its twin are one answer wearing two rows.
    const seen = new Set();
    const best = whole.filter((hit) => hit.rank === whole[0].rank)
      .filter((hit) => {
        const where = destinationOf(hit.entry);
        if (seen.has(where)) return false;
        seen.add(where);
        return true;
      })
      .map((hit) => hit.entry);
    return { kind: VoiceIntent.AMBIGUOUS, heard, candidates: best };
  }
  return { kind: VoiceIntent.NOTHING, heard };
}

/**
 * The conjunctions a person uses to ask for two things at once, longest first so "e poi" is tried
 * before the "e" inside it.
 *
 * Deterministic, word-boundary, and closed — not a language model and not a heuristic. The
 * resolver's own rule holds here too: *a near miss that acts is worse than a miss that asks.*
 */
const CONJUNCTIONS = Object.freeze([' e poi ', ' and then ', ' e ', ' and ', ' poi ', ' then ']);

/** The words the conjunctions are built from. A tail made only of these asked for nothing:
 *  *"apri la memoria e poi"* split on the bare " e " leaves "poi", which has a content word and no
 *  meaning. Longest-first ordering alone does not catch it, because " e poi " matches with an
 *  EMPTY tail and is skipped, and then " e " matches with a useless one. */
const CONNECTIVES = Object.freeze(new Set(['e', 'and', 'poi', 'then']));

/**
 * "Do this AND tell me that" — one utterance that is a command and a question.
 *
 * Measured 2026-08-24 against the real 42-entry list with the real Italian translation:
 * *"apri la memoria"* resolves and navigates correctly, but **"apri la memoria e dimmi cosa c'è
 * dentro" resolves to NOTHING** — the whole sentence matches no handle — so the navigation is
 * lost and only the question survives. The person asked for two things and got one.
 *
 * # Why this is additive, and why that matters
 *
 * It runs ONLY where `resolveUtterance` already answered `NOTHING`. Every utterance that resolves
 * today resolves identically tomorrow, so a phrase that navigates cannot start doing something
 * else — the failure mode this project fears most in a resolver, stated in `rankEntries` and
 * honoured here rather than restated.
 *
 * The head must resolve **uniquely** by the same rules as any other utterance. That is what makes
 * splitting on " e " safe in a language that uses it constantly: *"parlami di gatti e cani"* has a
 * head that resolves to nothing, so nothing splits and the whole sentence goes to the
 * conversation, exactly as it does now.
 *
 * @returns {{kind:'compound', intent:object, tail:string}|null} `null` when this is not a
 *   compound — never a partial answer the caller has to re-check.
 */
export function resolveCompound(utterance, options = {}) {
  const heard = String(utterance ?? '').trim();
  if (!heard) return null;
  const lowered = ` ${heard.toLowerCase()} `;
  for (const conjunction of CONJUNCTIONS) {
    let from = 0;
    for (;;) {
      const at = lowered.indexOf(conjunction, from);
      if (at < 0) break;
      from = at + 1;
      // Offsets are into `lowered`, which is the original with one space prepended — so the head
      // ends at `at - 1` in the original and the tail starts after the conjunction.
      const head = heard.slice(0, Math.max(0, at - 1)).trim();
      const tail = heard.slice(at - 1 + conjunction.length).trim();
      if (!head) continue;
      // The tail has to ASK something. Content words alone are not enough — a leftover connective
      // is a content word and means nothing.
      if (!contentWords(tail).some((word) => !CONNECTIVES.has(word))) continue;
      const intent = resolveUtterance(head, options);
      if (intent.kind !== VoiceIntent.INTENT) continue;
      return { kind: 'compound', intent, tail };
    }
  }
  return null;
}

/**
 * What to say back, in the language in effect.
 *
 * Here rather than in each shell for the reason the whole shared model exists: two shells that
 * word a refusal differently disagree about what the product just did, and the disagreement
 * surfaces in whichever one is used less. Composed from translated parts and returned as parts
 * where a name is involved — a finished sentence with a panel name inside it could never be a
 * catalogue key, which is the trap the `/` menu's filter note was already in.
 */
export function utteranceReply(result, translate = (text) => text) {
  switch (result?.kind) {
    case VoiceIntent.UNHEARD:
      return translate('I did not catch that.');
    case VoiceIntent.NOTHING:
      return `${translate('Nothing here is called that:')} ${result.heard}`;
    case VoiceIntent.AMBIGUOUS:
      return `${translate('That matches several — say which:')} ${result.candidates.map((entry) => entry.name).join(', ')}`;
    case VoiceIntent.INTENT:
      // The destination is named by its LABEL, translated — "Vado a Memoria", not "Vado a memory".
      //
      // This sentence changed medium, and that is why the rule changed with it. It used to be a
      // visual note beside a nav item already reading "Memoria", where the slug was merely odd.
      // Since the acknowledgement is SPOKEN, an Italian voice saying an English slug names the
      // destination by a word the person has never seen on their own screen. The slug remains the
      // fallback for any entry that carries no label.
      return result.disposition === VoiceDisposition.NAVIGATE
        ? `${translate('Going to')} ${translate(result.entry?.summary ?? '') || result.entry?.name}`
        : `${translate('Ready to send:')} ${result.line}`;
    default:
      return translate('I did not catch that.');
  }
}
