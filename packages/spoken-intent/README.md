# @noesar/spoken-intent

Turning what a person **said** into one thing a product can **do** — deterministically, in any
language, with a refusal instead of a guess.

Extracted from NOESAR EVOLUTION's voice layer. The normative contract is [`SPEC.md`](./SPEC.md);
the executable one is [`conformance/`](./conformance/index.mjs).

## The one property worth extracting

**Exact-or-containing, never fuzzy.** No edit distance, no phonetic matching, no stemming, no
embeddings. Eight ranks, every one of them a containment relation.

That is a safety property, not a purity one. *A near miss that acts is worse than a miss that
asks*: the person is not looking at what they said, so a wrong action is discovered only **after**
it has happened. A resolver that "helpfully" matched approximately would pass every matching test
in this suite and be a more dangerous product — which is why `SI-008` measures the absence of
fuzzy matching as a case (`nongoals:no-fuzzy`), and why `test/conformance.test.mjs` builds a
deliberately fuzzy implementation and proves the suite rejects it.

## What is in, and what is deliberately out

| In this package | Left to the caller, and why |
|---|---|
| normalisation with accent folding | the **entry shape** — every product's is different |
| filler removal, filler **injected** | the **translator** — a resolver that owned translations would need editing every time a product gained a page |
| the eight-rank ladder | what a **destination** is |
| uniqueness by destination | what is **said back** to the person |
| trailing-argument capture | what happens **after** an intent resolves |
| additive compound splitting | which words are **filler** in which language |

The boundary is the same one `@noesar/capability-token` draws between a wire format and an
authorization policy: the mechanism is portable, the meaning is the product's.

## Two implementations, one contract

A specification with one implementation is a description of that implementation. This one is held
to its contract by two:

- **`src/index.mjs`** — the reference implementation, dependency-free and DOM-free.
- **`apps/webui-static/voice-intent.js`** — the code NOESAR EVOLUTION actually ships to the
  browser, measured by the *same* `conformance/index.mjs` in
  `services/reference-control-plane/test/spoken-intent-browser-conformance.test.mjs`.

Both answer all 60 cases, and a third test drives the same utterances through both and fails on
any disagreement. Writing the second binding is what found two real defects in the first draft of
this specification — a handle-expansion rule that was never written down, and a filler set the
shipped resolver had hardcoded so the language it assumed could not be overridden.

## Why it exists beyond this product

Any local-first product with a command palette, a slash-command registry or an address book has
the same problem: someone says a sentence, and something has to decide *which of these, or none*,
without a language model and without a network. `resolve()` answers exactly that, over a registry
the caller owns, in whatever languages the caller's labels are already written in — so there is no
second vocabulary to maintain and an entry added to a product is speakable the same day.

A model MAY be used as a fallback **after** this returns `nothing`. If it is, its answer is
re-resolved through this contract by name: the model points, the product decides. The output space
stays finite and known before the question is asked, so a wrong answer can only ever be the wrong
door of the product's own doors — never a door that does not exist.

## Running it

```sh
node --test packages/spoken-intent/test/*.test.mjs
```

## Licence

AGPL-3.0-or-later. See [`LICENSE`](./LICENSE).
