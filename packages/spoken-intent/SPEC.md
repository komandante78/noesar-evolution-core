# Spoken Intent Resolution — specification v1.0.0

What an implementation must do to turn something a person **said** into one thing a product can
**do**, written so it can be implemented in any language **from this document alone**, and then
**measured** by [`conformance/`](./conformance/index.mjs) rather than by reading the reference
code.

Each requirement carries the id of the conformance case family that measures it. That mapping is
enforced in both directions: `test/conformance.test.mjs` fails if a requirement here has no case,
or a case names a requirement that is not here. A specification and a suite that can drift apart
are a specification nobody can trust.

**Language.** MUST / MUST NOT / MAY are used in the RFC 2119 sense.

**What this document is not.** It does not say what an entry looks like, what a destination is,
what sentence is said back to the person, which words are filler in which language, or what
happens after an intent is resolved. All of those are injected by the caller, because all of them
are facts about a product or a language rather than about resolution. The reference
implementation ships a Latin-script filler set for English and Italian as a **default**, not as a
requirement — see `SI-008`.

---

## SI-001 · Surface and outcomes

An implementation MUST expose: `normalise(text)`, `contentWords(text, filler)`,
`rankEntries(phrase, entries, options)`, `uniqueHit(hits, destinationOf)`,
`resolve(utterance, options)`, `splitCompound(utterance, options)`, a frozen `RANK` of exactly 8
entries, and a frozen `Outcome` of exactly 4 values. *(cases: `surface:*`)*

`resolve` MUST return exactly one of four outcomes, and the caller MUST be able to tell them
apart without inspecting any other field:

| Outcome | Means |
|---|---|
| `unheard` | nothing was said, or nothing but filler |
| `nothing` | heard clearly, matched no entry |
| `ambiguous` | matched several entries that lead to **different** destinations |
| `intent` | matched exactly one |

An implementation MUST NOT collapse `unheard` into `nothing`. They send a person to different
places: one is "say it again", the other is "this product has no such thing".

## SI-002 · Normalisation

`normalise` MUST, in this order: decompose to NFD, remove combining marks, lowercase, replace
every character that is not `a-z`, `0-9`, `/`, `-` or whitespace with a single space, collapse
runs of whitespace to one space, and trim. *(cases: `normalise:*`)*

Accent folding is **normative, not cosmetic**. Speech-to-text engines disagree with each other
and with keyboards about `perché` / `perche` / `perchè`. An implementation that treated those as
three different words would resolve correctly with one transcription engine and incorrectly with
the next — a dependence on a particular vendor hidden inside a string function.

`/` and `-` MUST survive normalisation: they are structural in an address (`coden/agent/plan`)
and in a hyphenated name, and `SI-004`'s prefix and word rules read them.

## SI-003 · Content words and filler

`contentWords` MUST return the normalised tokens with every token present in the supplied
`filler` set removed. With no filler set supplied it MUST return every token. *(cases:
`content:*`)*

An utterance whose content words are empty MUST resolve to `unheard`, never to a match. "open
the" has named nothing, and a resolver that matched everything on it would act on a sentence that
selected nothing.

The filler set MUST be consulted **one token at a time**. A multi-word phrase in the set can
therefore never match, and an implementation MUST NOT silently accept one as if it did — it is
coverage that is not there.

An implementation **MAY bind a default filler set** for the product it ships in, and doing so is
not a deviation: what carries no intent is a fact about a language, and a library that forced
every caller to supply one would be useless out of the box. What is normative is that an
**explicitly empty** set strips nothing — an implementation that ignored the parameter would
silently impose its own language on every caller. Found by this suite: the shipped browser
resolver had the set hardcoded and took no parameter at all, so the language it assumed was
invisible and unoverridable.

## SI-004 · The rank ladder — exact-or-containing, never fuzzy

An implementation MUST rank a phrase against each entry's handles and MUST use exactly these
eight ranks, in this order, lowest number winning: *(cases: `rank:*`)*

| Rank | Value | Earned when |
|---|---|---|
| `NAME` | 0 | a **name** handle IS the phrase |
| `SEGMENT` | 1 | a **segment** handle IS the phrase |
| `PROSE` | 2 | a **prose** handle IS the phrase |
| `PREFIX` | 3 | a name or segment handle starts with the phrase, followed by a space or `/` |
| `PROSE_PREFIX` | 4 | a prose handle starts with the phrase, followed by a space or `/` |
| `WORD` | 5 | the phrase occurs inside any handle delimited by a space or `/` |
| `SUBSTRING` | 6 | the phrase occurs inside any handle at all |
| `GROUP` | 7 | nothing above matched, and the phrase IS the title of the entry's group |

An implementation **MUST NOT** use edit distance, phonetic matching, stemming, embeddings or any
other approximate comparison. Every rank above is a containment relation and nothing else.

The reason is not purity. **A near miss that acts is worse than a miss that asks**: the person is
not looking at what they said, so a wrong action is discovered only after it has happened. An
implementation that added fuzzy matching would pass every case in this suite that is about
matching and would still be a different, more dangerous product.

`NAME` MUST beat `SEGMENT`. A derived convenience must not outvote a name: where a command
`plan` and an address ending `/plan` both exist, the bare word is the command, exactly as typing
it resolves.

`GROUP` MUST be considered **only** when no other handle matched. It names a room, not a door.

Ranks 5 and 6 MUST NOT vary by which handle they were found in: being buried in the middle of
something says nothing about whether it was a name or a description.

**A caller MUST supply each handle in both forms — as written, and with the filler removed.**
Found by this suite rather than by design: the utterance has its filler stripped before matching
(`SI-003`), so *"flussi di lavoro"* arrives as `flussi lavoro` and never matches the label
`flussi di lavoro`, whose preposition the speaker's own words had just lost. Stripping one side
and not the other is not one rule with an exception — it is **two different rules**, and the
second one is invisible until somebody says a phrase with a preposition in it. An implementation
MAY expand the handles itself; what it MUST NOT do is match a stripped utterance against
unstripped handles only.

## SI-005 · Uniqueness is by destination, not by count

Among the hits sharing the best rank, an implementation MUST resolve to a single `intent` when
they all share one destination, and MUST report `ambiguous` otherwise. *(cases: `unique:*`)*

Counting rows instead of destinations is a real defect and not a refinement: a registry
legitimately holds one destination twice — a command and the address it resolves to are two rows
and one place — so a count would ask a person to choose between an entry and its own twin.

When reporting `ambiguous`, an implementation MUST return the candidates themselves, collapsed to
one per destination, and MUST NOT pick one. Picking is the caller's decision to offer, never the
resolver's to make.

## SI-006 · Trailing-argument capture

When the whole utterance names nothing unique, an implementation MUST attempt to read it as an
entry name followed by an argument, and MUST do so **after** trying the whole phrase, never
before. *(cases: `argument:*`)*

The cut MUST walk from the **end** inwards, and a candidate head is accepted only when it matches
at `RANK.NAME` on an entry that accepts an argument. Both conditions are load-bearing: a
substring match with a trailing word attached is a guess, and an entry that takes no argument
cannot have been given one.

Leading filler MUST be skipped before the head begins, and the argument MUST be returned in the
person's **own words** — cut from the spoken tokens, not from the normalised ones. Returning a
normalised argument would hand the caller a stripped, lowercased version of what someone dictated.

## SI-007 · Compound utterances

An implementation MAY support "do this AND tell me that". Where it does, it MUST be **additive**:
`splitCompound` MUST return `null` for any utterance that `resolve` does not already answer
`nothing`. *(cases: `compound:*`)*

This is the requirement that makes the feature safe to add to a working product. Every utterance
that resolves today resolves identically afterwards, so a phrase that navigates cannot begin
doing something else.

The head MUST resolve to a single `intent` by the ordinary rules of `SI-004` and `SI-005`. This
is what makes splitting on a very common conjunction safe: in Italian, *"parlami di gatti e
cani"* has a head that resolves to nothing, so nothing splits.

Conjunctions MUST be tried longest first, so `" e poi "` is reached before the `" e "` inside it.
The tail MUST contain at least one content word that is not itself a connective — otherwise
*"apri la memoria e poi"* would split on the bare `" e "` and produce the meaningless tail
`"poi"`.

## SI-008 · Non-goals, stated so nobody implements them by accident

An implementation MUST NOT: carry a vocabulary of phrases separate from the registry it is given;
require a language model to resolve an utterance; consult a network; or hold a per-language
translation table of its own. *(cases: `nongoals:*`)*

There is no voice vocabulary, and that is a design commitment rather than an omission. What can be
said is whatever the registry contains, so an entry added to a product is speakable the same day
with nothing edited anywhere else. The translator that renders an entry's description is
**injected**, because a resolver that owned translations would need editing every time a product
gained a page.

A caller MAY use a model as a **fallback** after this returns `nothing`, and doing so is outside
this specification. If it does, the model's answer MUST be re-resolved through this contract by
name: the model points, the product decides. That keeps the output space finite and known before
the question is asked, so a wrong answer can only ever be the wrong door of the product's own
doors — never a door that does not exist.
