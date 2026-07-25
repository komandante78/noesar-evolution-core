# NOESAR EVOLUTION — ATOM Boundary Audit (Phase 1)

Audit of the delivered source against the invariants fixed in Phase 0
(`docs/ATOM_PUBLIC_PRIVATE_BOUNDARY.md`).

```text
ATOM_PRIVATE_IMPLEMENTATION_IN_OPEN_REPO=false   -> VERIFIED HOLDS
FOSS_CORE_MUST_REMAIN_AUTONOMOUS=true            -> HOLDS BY DESIGN (build not yet run)
```

**Result: PASS.** No proprietary ATOM implementation is present in any of the five
packages. Nothing had to be quarantined.

---

## 1. Method

1. Case-insensitive content search for `atom` across all five extracted packages.
2. Case-insensitive **path** search for `*atom*`.
3. Manual inspection of every genuine hit.
4. Reading the delivered boundary declarations.

## 2. What was found

**114 files mention "atom"** (excluding `rust/vendor/`). Every one is documentation,
a manifest entry, a public contract, or a false positive. The genuine ATOM artefacts
are exactly two:

| Path | Kind | Assessment |
|---|---|---|
| `private-boundary/atom-provider.schema.json` | JSON Schema, 26 lines | **public contract only** — `providerId`, `apiVersion`, `capabilities[]`, `endpoint`, `additionalProperties: false`. Declares the interface; reveals no implementation. |
| `MASTER_REFERENCE/04_AI_PLATFORM/43_ATOM_PRIVATE_PROVIDER_BOUNDARY.md` (also in `PROJECT_GOVERNANCE/`) | documentation | describes the boundary and what private ATOM *may* implement. Contains no algorithm, heuristic, or dataset. |

**False positives**: `atomic-store.mjs` (4 copies across packages) matched on the
word *atomic*. Verified by inspection — it is a transactional store, unrelated to
ATOM. No other path-level match exists.

## 3. The delivered declarations

`private-boundary/README.md`, shipped with the product, states:

> "No proprietary implementation is included in this archive. […] The public core
> must remain independently useful and buildable without these repositories.
> Integration occurs only through public, versioned contracts."

`43_ATOM_PRIVATE_PROVIDER_BOUNDARY.md` adds the decisive design fact:

> "The public core includes a functional ReferenceReasoningProvider. Private ATOM
> may implement L0–L8 maturity, proprietary causal search, heuristics, evolutionary
> evaluation and protected optimizations. Public builds and funded demonstrations
> cannot require or expose ATOM."

Private scope is declared as: ATOM implementation, Owner Edition entitlement and
recovery, commercial licensing and private signing infrastructure, official
regulated-industry modules, commercial release builder.

## 4. Against the Phase-0 invariants

| Invariant | Verdict | Basis |
|---|---|---|
| No ATOM source, in whole or part | **PASS** | only a JSON Schema contract exists |
| No vendored/bundled ATOM build | **PASS** | no binary or library attributable to ATOM |
| No weights, checkpoints, adapters | **PASS** | no model artefacts anywhere in the tree |
| No training corpora or derived datasets | **PASS** | none present |
| No proprietary internal design documents | **PASS** | boundary docs describe the contract, not the method |
| **No fixtures/golden files derived from proprietary behaviour** | **PASS** | no ATOM fixtures; this was checked explicitly because it is the easiest route to accidental disclosure |
| Interface published, method withheld | **PASS** | schema + docs published; no method disclosed |
| Core does not require ATOM | **HOLDS BY DESIGN** | a functional `ReferenceReasoningProvider` ships in the core; **not yet executed** |

## 5. The one claim that is not yet proven

`FOSS_CORE_MUST_REMAIN_AUTONOMOUS` is satisfied *by design*: the core ships its own
functional reference provider and nothing in the tree imports or links ATOM. But
Phase 1 performed **no build and no execution**, so this is a design-level finding.

Per the Phase-0 obligation, the claim "the core does not depend on ATOM" remains
**`[UNVERIFIED]`** until **Phase 4** runs an explicit ATOM-absent acceptance:
core builds, starts, passes its tests and delivers documented functionality with no
proprietary component present. That is the correct place to close it — it is
already recorded as a Phase-4 obligation.

## 6. Quarantine

None required. The phase instruction to isolate any proprietary ATOM implementation
found in staging **did not trigger**, because none exists. Nothing was deleted and
nothing was withheld from the commit on ATOM grounds.

## 7. Carried into later phases

- **Phase 1 (done)** — boundary visible in the tree: `private-boundary/` holds only
  the public contract.
- **Phase 4** — run the ATOM-absent acceptance and close §5.
- **Phase 5** — pre-publication sweep of the publishable tree for every category in
  §4 before any repository is made public.
