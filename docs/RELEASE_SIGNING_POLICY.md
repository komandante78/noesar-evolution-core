# Release signing policy — where the key lives, and why the project does not decide

**Status:** applied (`D-0622`, 2026-08-21). Governed by `CLAUDE10.md` §14 rule 55 (integration
through public interfaces only), §17 rule 68 (the measuring stick is external) and §60-64 (the
host is not the product). Funding criteria re-read on the date below, per
`.claude/skills/noesar-evolution-funding-fit` §6 rule 3.

## 1. The question, and the honest answer

The Owner was asked where the durable release-signing key should live — HSM, secrets manager, or
cold storage — and answered: follow what the funding programmes require.

**They require nothing about key custody.** Re-read 2026-08-21, from the sources named in §2: no
programme names an HSM, a KMS, a key ceremony, or a custody model of any kind. That measured
absence is the first half of the answer, and it is the half that would have been easiest to
paper over. Picking one on their behalf would have been inventing a requirement and attributing
it to a funder — which is the failure `funding-fit` §0 exists to prevent.

## 2. What the sources do say — verified, with dates

| Source | Read | Wording that bears on this |
|---|---|---|
| [Restack](https://nlnet.nl/restack/) | **2026-08-21** `[VERIFIED]` | funds *"middleware **without a vendor lock-in**"* and *"local-first infrastructure"*; *"Project results shall always become available under a recognised free or open source license."* Support services include *"reproducible packaging"* and *"security audits"*. **The call is still not open** — *"This fund is currently being set up"*, "Coming soon". |
| [Sovereign Tech Agency](https://www.sovereign.tech/) | **2026-08-21** `[VERIFIED]` via search; `/programs/fund` returned **403** to direct fetch | *"All code and documentation to be supported must be licensed in a way that allows free reuse, modification, and redistribution."* Funds the **Reproducible Builds** project for 2025, 2026 and 2027. |
| NLnet (dual licensing, closed dependencies) | 2026-08-18 `[VERIFIED]`, not re-read today | copyright holders *"may deal with your project results under additional licenses, even proprietary ones"*; funded work must not itself depend on closed technology. |

`nlnet.nl/restack/eligibility.html` returned **404** on 2026-08-21. The Restack row above comes
from the fund's own page, not from the eligibility page. Stated rather than hidden.

## 3. The inference — labelled, because it is ours and not theirs

`[INFERRED]` from §2, and it is the only step in this document that is not a quotation:

> *"No vendor lock-in"* + *"must not depend on closed technology"* + *"local-first"* do not say
> **where** to keep a key. They say the product must not **impose** a custody model, and that
> **verification must work offline, with no service call to anyone.**

A release that can only be verified by trusting one company's KMS carries a mandatory
proprietary dependency at the most security-critical point a project has. That is
`funding-fit` §4 trait 4 ("no lock-in") failing in the one place where it is least recoverable,
and it would also break §8's offline-by-default rule for every self-hoster.

Reproducibility, not custody, is what this ecosystem actually pays for: the Sovereign Tech
Agency funds Reproducible Builds for three consecutive years. A signature over an artefact
anyone can rebuild is worth more than a signature over one nobody can.

## 4. What the project therefore does — and what it refuses to do

**It does not choose a custody backend. It removes the requirement that there be one.**

The defect this repaired was the opposite of the expected one. `signCompliancePack(pack,
privateKeyPem)` requires the private key **in the signing process's memory** — which is exactly
what an HSM, a smartcard and an offline key exist to prevent. So the project had already chosen
a custody model, *"a file on disk"*, and locked every other one **out**. Nobody had decided
that; it was the shape of a function signature.

`tools/release-signing.mjs` defines the backend contract and ships **two real implementations** —
two, because an interface with one implementation is an interface nobody has tested, and rule 73
forbids extension points that are promises:

| Backend | The key is | Needs a vendor? | Covers |
|---|---|---|---|
| `local-key` | a PEM this process reads | no | the everywhere-baseline §63 requires |
| `detached` | **never in this process** | no | cold storage · smartcard · **any** HSM · `ssh-keygen -Y sign` · an air-gapped machine |

```text
# phase 1 — emits the bytes to sign. No private key is passed. Exit 3 = "bytes awaiting signature".
node tools/sign-build-provenance.mjs --provenance p.json --public-key release.pub.pem \
     --detached-request tosign.bin --output signed.json

# the operator signs tosign.bin wherever the key actually lives — this project has no part in it

# phase 2 — attaches. Still no private key.
node tools/sign-build-provenance.mjs --provenance p.json --public-key release.pub.pem \
     --detached-request tosign.bin --detached-signature tosign.sig --output signed.json
```

**Verification is unchanged by any of this**, and that is the property, not a convenience:

```text
node tools/verify-build-provenance.mjs --provenance signed.json --public-key release.pub.pem
```

The verifier takes a public key and nothing else. It cannot tell which backend signed, and a
test asserts that both produce documents it accepts identically — so no custody choice can ever
become a dependency of the people verifying a release.

**Refused, by name:** naming a specific HSM, KMS or vendor anywhere in the product; any signing
path that requires a network call; any verification path that requires one.

## 5. What is still open, and belongs to the Owner

- **Which custody the Owner uses for the real release key.** Now a deployment decision with no
  code consequence, which is what §4 achieved — not a blocker on the product. Cold storage plus
  the detached path needs no purchase and no vendor, and is the cheapest option that satisfies
  §3; it is a recommendation, not a decision taken here.
- **Publishing the release public key and its fingerprint.** The convention exists —
  `docs/SBOM_REPORT.md` §"Fingerprint" publishes an Ed25519 SPKI PEM — and the release key is
  not generated yet, because generating a durable key is the Owner's act, not a session's.
- **`PKG-001` position 5 is *closeable*, not closed.** It closes when a delivery archive exists
  and is signed. **No delivery archive has ever been produced** (`MASTER_PROJECT/09_PIANO.md`).
  Saying otherwise would be a false PASS (`CLAUDE10.md` rule 38).

## 6. What is NOT verified here

- That any of this would place in a funding round. No submission has been made
  (`funding-fit` §7).
- Restack's application form, timetable and reporting duties — the fund still reads
  "Coming soon" and its eligibility page 404s.
- Any programme not listed in §2. Absence means "not looked at", never "not suitable".
