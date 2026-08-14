# NOESAR EVOLUTION — License Strategy

> **Status: PROPOSAL — not a final legal determination.**
> Nothing in this document has been reviewed by counsel. It records the intended
> direction so that architecture and packaging decisions stay compatible with it.
> It must never be presented, internally or externally, as a settled legal position.

---

## Proposed parameters

```text
OPEN_CORE_PROPOSED_LICENSE   = AGPL-3.0-or-later
ADDITIONAL_COMMERCIAL_LICENSE = planned
ATOM_IMPLEMENTATION           = proprietary and separate
FOSS_CORE_DEPENDS_ON_ATOM     = false
FUNDED_WORK_MUST_BE_FOSS      = true
```

## 1. Open core

The open core is proposed under **AGPL-3.0-or-later**.

The core must be **complete and independently useful**. A user who takes only the
open core receives a working product with documented functionality — not a
crippled build, not a trial, not a shell that requires a proprietary component to
become useful. This is a hard architectural requirement, not a marketing posture,
and it is what makes the open-core split defensible.

## 2. Additional commercial license

A separate commercial license is **planned** for parties who cannot accept AGPL
terms. Dual licensing requires that the project hold or be granted sufficient rights
over all contributed code; the mechanism (CLA, DCO plus copyright assignment, or
another arrangement) is **undecided** and must be settled before external
contributions are accepted.

## 3. ATOM

ATOM's implementation is **proprietary and separate**. It is not licensed under the
open-core license and its source never enters the public repository. The open core
defines public interfaces; any implementation, proprietary or otherwise, may satisfy
them. See `docs/ATOM_PUBLIC_PRIVATE_BOUNDARY.md`.

## 4. Interaction with funding

Work carried out under public or FOSS-oriented funding must itself be released as
FOSS. This constrains what may be attributed to funded work: anything that cannot be
released as FOSS is, by definition, outside that scope. See
`docs/FUNDING_ALIGNMENT.md`.

## 5. Open questions to resolve before release (Phase 5)

1. ~~AGPL-3.0-or-later confirmed, or a different copyleft/permissive choice.~~ **Partly
   closed, `D-0453` (2026-08-14):** a real `LICENSE` file (verbatim FSF AGPL-3.0-or-later
   text) and a `NOTICE` file now exist at this repository's root and at
   `github.com/komandante78/noesar-sandbox`'s. This confirms the open-core text, not the
   full item — per-file headers already existed (372 `.mjs` files carry
   `SPDX-License-Identifier: AGPL-3.0-or-later`); this closes the root `LICENSE`/`NOTICE`
   half of item 7 too.
2. Contribution mechanism enabling dual licensing (CLA / DCO / assignment). **Still open.**
3. Full dependency license audit — compatibility of every transitive dependency
   with AGPL distribution. **Still open.**
4. Third-party asset and model licensing, where any are bundled. **Still open.**
5. Trademark and naming policy for "NOESAR" and "ATOM". **Still open.**
6. Commercial license terms, scope, and exception language. **Still open — the `NOTICE`
   file states plainly that this is planned and undecided, not that it exists.**
7. `LICENSE`, `NOTICE`, and per-file headers — decided and applied consistently. **Root
   files done (`D-0453`); consistency across every future spun-off repository (WP4/WP5,
   `FUNDING/19_WORK_PLAN_TO_BETA.md`) is not yet a checked, repeatable step.**

Until each is closed and recorded here, the project's licensing status remains
**proposed**.
