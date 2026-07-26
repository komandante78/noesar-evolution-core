# NOESAR Evolution — Gap Analysis and the Original Position

**Date:** 2026-07-26
**Method:** all 64 documents of `MASTER_REFERENCE/` read in full, then compared against the
code actually in this repository. Every count below comes from the tree, not from memory.
**Status:** analysis. Nothing was changed.

---

## Part 1 — What was actually built, measured

```text
first-party code, excluding vendor/, BACKUPS/, provenance/

  .mjs   140 files   24,563 lines      the entire product
  .py     59 files    7,839 lines      tooling and workers
  .sql    43 files    2,640 lines      schema and migrations
  .sh     44 files    2,003 lines      installers and scripts
  .rs     13 files    1,145 lines      the "authority" layer
  .js       3 files    1,359 lines     the shipped WebUI
  .ts       3 files      316 lines
  .tsx      0 files          0 lines
```

The parts that exist are built to an unusually high standard: 507 unit tests, PostgreSQL
with `RESTRICTIVE` row-level security proven against a same-project adversary, a
hand-written wire-protocol client so no value is ever interpolated into SQL, SSRF and
metadata-endpoint guards in the tool executor, prompt-injection containment with zero
bypasses across ten committed regression tests. This analysis is not about quality. It is
about **which specified thing is missing entirely**.

---

## Part 2 — The gaps

### GAP-A · The Security Kernel does not exist as specified — **critical**

`30_SECURITY_KERNEL` defines it as *"an independent Rust authority outside the model"*
containing twelve named components. The measured reality:

| Specified component | In code |
|---|---|
| Policy Decision Point | — |
| Capability Token Broker | **0 files** |
| Path Authorization Broker | 2 files |
| Network Egress Broker | 14 files |
| Secret Broker | **0 files** |
| Model Trust Registry | **0 files** |
| Update Trust Verifier | partial (update manager exists) |
| Sandbox Manager | 5 files |
| Resource Governor | **0 files** |
| Audit Ledger | 15 lines of Rust; a JS ledger is used |
| Emergency Stop | **0 files** |
| Identity Guard | folded into `auth.mjs` |

`noesar-security-kernel` is **37 lines of Rust** performing string checks on a path. The
component that actually decides things at runtime is a single Node process whose directory
name states its own status: `services/reference-control-plane`. It is the *reference*
implementation, and nothing was ever built behind it.

The spec's central security diagram —

```text
AI_PROPOSES → POLICY_DECIDES → USER_OR_POLICY_AUTHORIZES →
SANDBOX_EXECUTES → VERIFIER_CHECKS → AUDIT_RECORDS
```

— appears **nowhere in the code**. Not as a module, not as a function, not as a comment.
There is no policy decision point, and nothing verifies a result after execution.

### GAP-B · `ReasoningProvider` does not exist — **critical, and it is the strategic one**

**Zero files** in the entire repository mention it. It is named in five master documents,
in decision `V4-D009` (Approved), in Gate 5, and in risk `R-001` — *"Public core unusable
without ATOM"*, severity **Critical**, whose stated treatment is *"independent build and
reference provider gate"*.

The contract that ATOM attaches to has never been written. Neither has the reference
provider it is supposed to sit behind. What stands in for planning today is a **string in a
system prompt**:

```js
if (mode === 'ACT') return 'You are in ACT mode. Plan actions first. Never execute
  mutative tools without an explicit approval token. …';
```

The plan is advice given to a model, not an object the engine can inspect, constrain,
simulate, classify or replay. "Never execute without an approval token" is a *request* — no
approval token type exists in the code.

**This is the most important finding in the analysis.** The product's declared strength has
no seam to attach to, and the risk register's most severe entry is untreated because the
mitigation was never implemented.

### GAP-C · Isolation is container-level, not capability-level — **high**

`34_AGENT_TOOL_CAPABILITY_SANDBOX` requires unprivileged processes, namespaces, **Landlock**,
**seccomp** profiles, AppArmor/SELinux, **cgroups v2** and **Wasmtime/WASI** for portable
modules. Measured: **0** Landlock, seccomp present only as Docker's builtin profile (plus a
regression guard that forbids weakening it), **1** incidental WASM mention, no resource
governor.

`R-015` — *"One-container requirement weakens isolation"*, severity High — names exactly
this treatment and it is untreated. Today the container is the only boundary: everything
inside it shares one blast radius.

### GAP-D · MEVCM does not exist — **high**

**0 files.** `44_MEVCM_MEMORY_AND_CONTAMINATION` specifies memory layers with provenance,
actor, source class, confidence, retention, tenant, legal hold, **contamination state** and
causal links, plus a promotion pipeline gated by validation, conflict detection and a
**contamination canary**. What exists is retrieval. The memory *architecture* — the part
that makes retrieval trustworthy — was never built. It is also funding work package **#8**.

### GAP-E · No Industry Module Framework, no compliance packs — **high**

`V4-D017` (Approved) states the framework **ships in core**. One file mentions it; one file
mentions compliance packs. Sections 60–66 and 70–77 — thirteen documents, the entire
regulated-sector and jurisdiction strategy — have no implementation. The sector boundary
documents are the product's *refusal* surface, and refusals that exist only in prose are not
enforced.

### GAP-F · The stack contradicts the frozen decision log — **medium, but it is a governance problem**

`V4-D001` (Approved): *Rust is the primary authority language for privileged core services.*
`V4-D002` (Approved): *TypeScript/React is the canonical WebUI stack.*

Measured: 24,563 lines of JavaScript carry the product; 1,145 lines of Rust sit beside it.
`apps/webui-react` contains three files and no component; the shipped interface is
`apps/webui-static` — five files of plain JS and CSS.

This is not automatically wrong. It may be the right pragmatic call. But the decision log
says **Approved**, so at this moment the governing documents and the product disagree, and
nothing records which one is meant to move. That is the gap: not the choice, the silence.

### GAP-G · Identity is narrower than specified — **medium**

`14_IDENTITY_COLLABORATION` requires passkeys, **OIDC**, Enterprise **SAML/SCIM**, service
accounts, workload identities. Measured: OIDC/SAML/SCIM **0 files**; passkeys 3 files.
Local accounts, MFA, roles and service accounts are real and verified.

### GAP-H · Nothing verifies a result after it happens — **medium**

The specified pipeline ends `VERIFIER_CHECKS → AUDIT_RECORDS`. There is no post-execution
verifier anywhere. The audit ledger records that something happened; nothing checks whether
what happened was what was authorized.

### GAP-I · The Definition of Done is far away, and the product says so itself — **factual**

`06_DEFINITION_OF_DONE` requires SBOM, **ML-BOM**, provenance, signatures and five archives
passing an independent audit. `rust/BUILD_STATUS.md` states, in its own words:
`RUST_BINARY_INCLUDED=false`, `PROVENANCE_SIGNED=false`, `PRODUCTION_READY=false`. There is
no ML-BOM, no CBOM, and no reproducible-build evidence.

### GAP-J · The Technology Radar is the "tomorrow" mechanism, and it is not built — **the forward-looking gap**

`48_TECHNOLOGY_RADAR` is the machinery by which the product absorbs hardware and standards
that do not exist yet — rings, signed compatibility metadata, advisories, migration and
rollback impact. It has no implementation. Neither does anything touching **NPUs**, **CXL
memory** or **confidential computing**, all three named in that document.

This matters more than its severity suggests. Without the Radar, every new accelerator is a
**release**. With it, a new accelerator is a **signed pack**. That difference is the whole
distance between a product that ages and a product that is called *Evolution*.

---

## Part 3 — The original position

> The Owner's question: what does this have that no comparable program has?

### What every product in this category shares

Local chat wrappers, agentic coding tools, workflow builders, private RAG systems and
enterprise assistants differ in surface and overlap almost completely underneath:

1. **The model drives.** It emits tool calls; a guard tries to catch the dangerous ones.
2. **Privacy is asserted.** "Runs locally" is static text nothing verifies at runtime.
3. **Memory is one pool.** Your documents, the assistant's notes and retrieved web content
   land in the same index with the same trust.
4. **Audit is a transcript.** It records that something happened, never why, under what
   authority, or whether it would happen the same way again.
5. **Extensions inherit the application's authority.**
6. **Compliance is a marketing page.**

Every one of those is a *claim*. Not one is *provable* by the machine making it.

### The thing that is genuinely different

The V4 specification already demands, separately and without connecting them: a privacy
state derived from a broker that mediates real egress; contamination state as a field on
memory; typed events carrying correlation, causation and payload digests; capability tokens;
non-bypassable invariants the Owner cannot switch off; and — through ATOM — deterministic
replay fixtures.

Assembled, those are not six features. They are one property:

> **NOESAR Evolution can prove its claims about itself, mechanically, instead of asserting
> them. Every other product in this category can only assert.**

The artifact that makes the property real, sellable and impossible to fake:

### Proof of Session

Every piece of work emits a signed, self-contained bundle:

```text
  intent            what was asked, and how it was interpreted
  hypotheses        what was considered, ranked, with contradicting evidence
  plan              the object that was authorized — not a transcript
  expectation       what the plan said would happen
  reality           what actually happened, from the shadow run and the real run
  authority         every capability token minted, spent, denied, revoked
  egress            the privacy state, sampled throughout — not claimed once
  provenance        every source read, with its contamination state at the time
  outcome           the diff, the tests, what was not done, the residual risk
  fixtures          enough to re-execute this session deterministically
```

Hand it to an auditor, a regulator, a client, a colleague — or to yourself in six months.
Anyone holding the bundle and the same release can **re-run it and get the same decisions**.

**Why competitors cannot copy it quickly.** Not because it is clever, but because it is
*downstream of architecture*. A product whose plan is a system-prompt string has nothing to
put in the `plan` field. A product without an egress broker cannot fill `egress` with
anything but a promise. A product with one memory pool has no `contamination state` to
record. A product where the model emits tool calls has no `authority` trail, because there
were no tokens. Proof of Session is not a feature to add — it is what falls out of having
built the six things underneath, and each of those is a rewrite for them.

**Why ATOM is the centre of it, not an accessory.** Without a reasoning provider producing a
plan object, there is nothing to prove. The bundle's value is exactly the quality of the
reasoning it records: ATOM makes the plans richer, the hypotheses genuinely competing, the
expectation sharper, and the replay meaningful. This inverts the usual awkwardness of a
proprietary component in an open product — ATOM stops being *the part you must buy* and
becomes *the part that makes the evidence worth reading*, on a public core that already
produces valid, if plainer, evidence on its own.

**Why it gets more valuable with time, which is what "Evolution" should mean.** Models are
getting smaller, cheaper and more numerous, and more work will be done unattended. As that
happens, the scarce thing stops being the ability to generate work and becomes **the ability
to trust work nobody watched**. A chat interface is worth less every year. A verifiable
record of autonomous work is worth more every year — and it is the artifact the regulated
sectors in documents 70–77 will require before they can adopt anything at all.

### The forward extension, so the position does not age

Today the egress broker can prove *nothing left the machine*. Confidential computing —
already named in the Technology Radar and absent from the code — would let the same
mechanism one day prove something harder: *it left, and the machine that received it could
not read it.* That is not a different product; it is the same sentence with a stronger verb.
Which is the test any "tomorrow" feature should pass: it must extend the spine, not bolt on
beside it.

---

## Part 4 — What this implies for sequencing

Stated as consequence, not as a plan to execute — no work is authorized by this document.

1. **`ReasoningProvider` is the first thing to build.** It is a critical gap, it is the seam
   ATOM needs, it is the `plan` field of Proof of Session, and until it exists the product's
   differentiator is prose. The reference implementation ships with it, by `R-001`.
2. **Capability tokens are the second**, because they are the `authority` field and because
   six specified components collapse into one mechanism once they exist.
3. **The egress broker is already the furthest along** (14 files) and is closest to
   delivering a claim nobody else can make. It is also funding work package #2.
4. **MEVCM contamination state is the third**, and it is work package #8.
5. **Proof of Session is then assembly, not invention** — every field has a source by that
   point, which is the strongest argument for this ordering.
6. **GAP-F needs a decision, not code.** Either the decision log moves or the stack does.
   Leaving the two in contradiction is the only genuinely unacceptable option.
