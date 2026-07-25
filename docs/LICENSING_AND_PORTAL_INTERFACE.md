# Licensing Plan and noesar.com Portal Interface

Two things that must stay separate: what the licensing work will be, and what contract
the product expects from a future portal. **Nothing here relicenses anything, and
nothing here connects to any VPS.**

```text
LICENSE_RELICENSING=false     VPS_ACCESS=false
```

---

## Part A — Licensing

### A1. Gaps, still open and unchanged

Deliberately **not** closed in this phase; each needs a decision by the rights holder,
not an engineering change:

```text
12 first-party Rust crates without a declared license
2  first-party Node packages without a declared license
root LICENSE file missing
86 first-party source files without an SPDX header
```

### A2. ATOM boundary — re-verified in this phase

```text
FOSS_CORE_DEPENDS_ON_ATOM=false            CONFIRMED
PRIVATE_ATOM_IMPLEMENTATION_PRESENT=false  CONFIRMED
```

Evidence: the only ATOM artefacts in the tree remain the public contract
`private-boundary/atom-provider.schema.json` and boundary documentation. The delivered
container is Node-only and its entrypoint has no ATOM dependency; the Rust workspace
builds and passes offline with no ATOM component present. `atomic-store.mjs` and the
vendored `atomic-*` crates are substring false positives on "atom", re-confirmed here
so they are not re-flagged every phase.

Still **`[UNVERIFIED]`** in the strict sense: no ATOM-absent *runtime* acceptance has
been executed. That is Phase 4, and it is already in the acceptance plan.

### A3. Plan (execution is Phase 5)

1. **Ownership audit** — establish that every first-party file is owned by the rights
   holder or covered by a contributor agreement. This must precede any licence choice:
   you cannot dual-license what you do not own. Includes reviewing whether any
   delivered third-party-authored file sits inside the first-party tree.
2. **Open core: `AGPL-3.0-or-later` (proposal).** Matches the product's own
   `LICENSES/README.md` and `docs/governance/licensing-matrix.csv`. Adopt their
   three-way split rather than a single licence:
   - core → `AGPL-3.0-or-later`
   - SDK, schemas, public contracts → `Apache-2.0`
   - public documentation → `CC-BY-SA-4.0`
3. **Additional commercial licence** for parties who cannot accept AGPL. Requires the
   inbound mechanism from step 1 (CLA, or DCO plus assignment) to be settled first.
4. **Separate ATOM repository** — private, never mirrored into the public one, no
   shared history. The public core keeps only the versioned contract.
5. **Separate keys and channels** — the `stable`/`security`/`beta` channels of the open
   core, the commercial channel and the private ATOM channel each have their **own
   signing key**, so a key compromise in one cannot sign artefacts for another
   (`docs/UPDATE_MANAGER_DESIGN.md` §1).
6. **FOSS funding compatibility** — the open question from
   `docs/FUNDING_ALIGNMENT.md` is unchanged: programmes requiring the funded work to be
   open source *in its entirety* may not accept an open-core model with a permanently
   reserved component. A strategic decision for the owner; recorded, not decided here.

### A4. Dependency position (evidence-backed)

All 113 vendored Rust crates are permissive, **zero copyleft-only**, and every one now
passes its own `.cargo-checksum.json` (5,094 files, 0 missing, 0 corrupt) after the
B-003 repair. Nothing in the dependency tree blocks the proposed AGPL core. The Node
side has **no third-party dependencies at all**, which removes an entire class of
licence risk.

---

## Part B — noesar.com interface contract

**No connection was made and no VPS was touched.** This defines only what the product
would expect. The portal itself is not implemented, and the product must remain fully
functional without it — the `offline` update channel exists precisely so the portal is
never load-bearing.

### B1. Identity objects

| Object | Shape | Notes |
|---|---|---|
| `account_id` | opaque string | a person or company |
| `organization_id` | opaque string | optional; groups accounts |
| `license_id` | opaque string | what was purchased |
| `installation_id` | random UUID **generated locally** | **not** derived from hardware — no fingerprinting |
| `device_id` | optional, per-host | only if multi-host licensing is ever needed |

`installation_id` is deliberately random and locally generated: a hardware-derived ID
is a covert fingerprint and breaks legitimate migrations.

### B2. Signed entitlement

```json
{
  "entitlement_id": "...", "license_id": "...", "account_id": "...",
  "installation_id": "...", "channels": ["stable","security"],
  "features": ["..."], "seats": 1,
  "issued_utc": "...", "expires_utc": "...", "revocation_url": "...",
  "signature": "ed25519:..."
}
```

- **Offline-verifiable** against a pinned public key — no call-home required to run.
- **Grace period**: expiry alone must never hard-stop a running installation; it
  degrades to the open-core feature set with a clear warning.
- Revocation is checked opportunistically, never as a startup gate.

### B3. Endpoints the product would call

```text
GET  /api/v1/entitlement/{installation_id}    signed entitlement
GET  /api/v1/updates/{channel}/metadata       signed channel metadata
GET  /api/v1/updates/{channel}/artifact/{v}   signed artefact
GET  /api/v1/revocations                      signed revocation list
POST /api/v1/license/offline/request          produces an offline activation request
```

All responses signed; all verification identical to the online path.

### B4. Offline licensing

Owner exports a request blob (contains `installation_id` and `license_id` only),
obtains a signed entitlement out of band, imports it. No network at any point.

### B5. Data minimisation — normative

**Sent:** `installation_id`, `product_version`, `channel`, `os/arch`, and
`entitlement_id` only for licensed channels.

**Never sent:** conversations, prompts, documents, memory, embeddings, file names,
credentials, provider keys, user identities, email addresses, IP-derived location,
usage statistics, telemetry.

Every call is a **pull**, initiated by the product, disableable entirely.

### B6. Administrative audit

Portal-side actions (issue, renew, revoke) are audited **on the portal**. The product
records only what it can verify locally: entitlement received, verified, applied, or
rejected — with the reason. The product never trusts an unsigned portal statement.

### B7. Portal rebuild constraint

The future portal keeps its visual identity, but **code and content are rewritten from
scratch in staging, after a verified backup**, and only then promoted. Not in scope for
Phase 3 or Phase 4.
