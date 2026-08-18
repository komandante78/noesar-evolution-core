# SESSION HANDOFF

**Last updated:** 2026-08-18 · **Phase:** `s337` — `D-0520`…`D-0522` · **INSTALLED**
**Plan of record:** `MASTER_PROJECT/` · **Head:** `98ac312` · **Live:** `noesar-evolution:d0520-model-transport-20260818T023243Z`

---

## ➜ LA PROSSIMA AZIONE

**Nothing is pending and nothing is half-built.** The Owner authorised commit, push and deploy
(«autorizzo») and all three were performed: `98ac312` on `origin/main`, then deployed and verified
live as `noesar-evolution:d0520-model-transport-20260818T023243Z` (`D-0522`).

**A model of a registered publisher is now fetched, verified against the digest its publisher
declared, and made startable — on the installation the Owner actually uses.** Egress ships **off**,
so nothing is fetched until an operator turns the consent on.

**The next phase is scoped and NOT started**, in dependency order:

| Next | What | Blocked by |
|---|---|---|
| `s338` | **Delete** on `#/models`: a real button with a confirmation | nothing — but **no delete route exists at all** and must be built. Deleting is a different authority from acquiring. |
| `s339` | **Automatic discovery** of models from curated sources | egress, so **off by default** (rules 30-32) — a design decision, not a switch |
| `D-0521` | Publisher-**signed descriptors** over the same transport | an Owner decision; it is what makes `s339` better than "trust a URL" |

---

## WHAT IS TRUE NOW THAT WAS NOT — measured this session

`POST /api/v1/models/acquire` answered `501 NO_TRANSPORT` for thirteen sessions. It now runs a
real acquisition, and **two defects in the surface it depends on were found and repaired**:

| Repaired | What was wrong |
|---|---|
| the egress gate | `egressAllowed: privacy.state === 'external'` — `'external'` is **not** one of the seven `PrivacyState` values, so the gate was a constant `false` written in the shape of a check. Every acquisition was refused as unconsented before the missing transport was ever reached. |
| the artefact path | `readPresentModels` built `${descriptor.id}.bin` — an id like `acme/tiny-1b` is a **path** when interpolated (never found on disk), and an id containing `..` pointed outside the artefact directory. Reader and writer now share `artefactName()`. |

**Evidence, produced this session:**

- `node tools/model-acquisition-e2e.mjs` → **`MODEL_ACQUISITION_E2E=PASS`, 22/22** against the real
  control plane, real session, real CSRF, real publisher registry, publisher served on loopback.
  It asserts the refusals as hard as the success: consent ships **off**, acquiring is refused
  `EGRESS_NOT_CONSENTED`, **nothing is written while it is off**, consent opens and the privacy
  state becomes `EXTERNAL_METADATA_ONLY`, the honest artefact lands verified and moves to the
  `downloaded` lane, the tampered one fails `DIGEST_MISMATCH` + is quarantined + appears in **no**
  foreground lane, withdrawing consent refuses again, and both writes are CSRF-guarded.
- `node --test services/reference-control-plane/test/*.test.mjs` → **2600 tests, 2599 pass, 0 fail,
  1 skipped** (29 new).
- `bash tools/run-eslint.sh` → **0 errors, 0 warnings, 416 files**.
- `node tools/verify-source.mjs` → `SOURCE_VERIFY=PASS migrations=19 baseline=12/12 intact`.
- `node tools/measure-ui-language-coverage.mjs` → `VERDICT=COVERED`.
- `bash tools/run-browser-e2e.sh` → **504 PASS / 1 FAIL of 505**. The single FAIL is the declared
  gap `F-I18N-002`, and its +3 this phase were **identified rather than assumed**: they are the
  *Italian* renderings of three strings this phase did translate, recorded in their rendered form
  because the harness keys on the text a JS renderer wrote after a language switch. No
  untranslated English reaches the user from this phase. `route models` is green — the panel
  renders, populated, with **no console error and no failed request**.

---

## WHAT WAS **NOT** DONE — deliberately, and what is `[UNVERIFIED]`

- **`tools/accessibility-audit.mjs` was not run** — the browser suite was, and is green on `route models`. The audit is the remaining T2 instrument and is named rather than skipped silently.
- **`MANIFEST.sha256` not regenerated** — `F-MANIFEST-001`, already tracked, still its own phase.
- **Delete (`s337` original scope) was NOT built.** No delete route exists. Acquiring and deleting
  are separate authorities and separate gestures; this phase is the one the Owner authorised.
- **Discovery (`s339`) untouched**, and correctly so: it is egress and off by default.
- **Resume of an interrupted download is deliberately absent.** Range requests need their own
  integrity story; an unverified prefix under a verified name is exactly what `MC-004` forbids.
- **Quarantine has no retention.** Failed and cancelled downloads accumulate under
  `models/quarantine/` because rule 12 forbids deleting them. This is a **stated cost**, not an
  oversight — a sweep needs its own named exception, like the e2e run directories got.
- **Starting a real model end to end is still `[UNVERIFIED]`** — unchanged from `s336`: no local
  runtime and no real model exist on this host.
- **`gitleaks` is absent** (`command -v` finds nothing). The secret scan was **heuristic** and
  declared as such: no credential-bearing string in the diff. `tools/model-acquisition-e2e.mjs`
  carries the same throwaway test literals `tools/auth-http-smoke.mjs` already carries — a temp
  workspace's own setup token and password, valid for nothing.

---

## FILES THIS PHASE CHANGED

| File | What |
|---|---|
| `services/…/src/model-transport.mjs` | **new** — https-only (loopback http excepted), redirects re-checked per hop, byte cap counted while streaming, incremental sha256, stall deadline, `AbortSignal`. No `node:fs`. |
| `services/…/src/model-acquisition.mjs` | **new** — the job registry and the disk: `.part` → verified → rename, quarantine on mismatch, never an overwrite, never a delete, `artefactName()` shared with the reader |
| `services/…/src/server.mjs` | acquire → 202 + job; `GET /models/acquisitions[/:id]`, `POST /:id/cancel`; `GET/PUT /settings/model-egress`; the egress gate and the artefact path repaired |
| `services/…/src/privacy.mjs` | `modelAcquisitionEgress` colours the indicator `EXTERNAL_METADATA_ONLY` |
| `apps/webui-static/{app.js,index.html,styles.css}` | the consent switch, the Acquire button per card, the acquisitions panel with progress/cancel/refusals, the two digests side by side on a mismatch |
| `apps/webui-static/i18n-catalog.js` | 6 markup + 24 runtime strings, in Italian |
| `services/…/test/model-{transport,acquisition}.test.mjs` | **new** — 29 tests |
| `tools/model-acquisition-e2e.mjs` | **new** — the end-to-end proof, 22 checks, no network, no container |
| `oci/Dockerfile.phase4-model-transport` | **new** — the deployment overlay, with its rollback cost stated in the file itself (§3a 11d) |
| `docs/DECISION_LOG.md` | `D-0520`, `D-0521` |

---

## OPEN BLOCKERS

- `B-002` **stale premise** (`D-0257`): its text says neither `gitleaks` nor `trufflehog` is
  installed. Re-measured today: **`gitleaks` is genuinely absent**, so the heuristic scan stands.
- `B-011` low, deferred (`D-0258`): history rewritten on the Owner's explicit authorisation.

---

## THE ONE IMPROVEMENT PROPOSAL — `D-0521`, awaiting the Owner

Carry **publisher-signed descriptors** over the same verified transport, checking the ed25519
signature against `publisher-registry.mjs` before a descriptor is written to `models/catalog/`.
Today the artefact is guarded by a registered, revocable key while the metadata declaring *which*
bytes to fetch — including the sha256 everything depends on — arrives unsigned. It is the
precondition for `s339` discovery being anything better than "trust a URL".
