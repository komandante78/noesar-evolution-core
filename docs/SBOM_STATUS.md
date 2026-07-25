# Phase 4 — SBOM status

## Verdict

```text
SBOM_CONFORMANCE=PARTIAL
SPDX=false
CYCLONEDX=false
INVENTORY=PRODUCED
```

No SPDX or CycloneDX document was produced, and none is claimed. `syft`,
`cyclonedx-cli` and `spdx-tools` are all absent from this host, and CLAUDE10 rule 45
forbids installing tooling to satisfy a rule. Emitting a file with an SPDX header that no
SPDX tool had ever validated would be a conformance claim with nothing behind it — the
precise failure mode this project's rules exist to prevent.

What was produced instead is an honest, machine-readable component inventory:
`tools/generate-inventory.mjs`, output at
`$ARTIFACT_ROOT/phase4_evidence/inventory/component-inventory.json`, with
`conformance: "PARTIAL"` and its gaps enumerated in the document itself.

## What the inventory does contain

| Section | Content |
|---|---|
| Image | tag, id `sha256:1cf0ada8…`, created, architecture, os, size, all OCI labels |
| Base image | `node:22-bookworm-slim` with repo digest `sha256:6c74791e557ce11fc957704f6d4fe134a7bc8d6f5ca4403205b2966bd488f6b3` |
| Build provenance | dockerfile, lineage, `network: none`, `reproducible: false` stated rather than implied |
| OS packages | **311** entries read from the image's own `dpkg` database, name / version / arch |
| Node | **0** third-party dependencies in the image; 3 repository-only manifests declaring 6 packages, chiefly the unbuilt `apps/webui-react` |
| Rust | 13 first-party crates, 113 vendored, with a licence histogram of the vendored set |
| Shipped first-party files | all **42** files the Dockerfile copies, each with its sha256 |
| Licences | inventory row count, first-party declared vs undeclared |

## The distinction that matters

Phase 3 recorded "zero third-party npm dependencies". That is true **of the image** and it
would have been false of the repository, so the inventory reports both separately. The
`apps/webui-react` app declares six dependencies (`vite`, `react`, `react-dom`,
`typescript`, `@vitejs/plugin-react`, `lucide-react`), has no lockfile, is never installed,
never built and never served — the Dockerfile copies `apps/webui-static/` instead.
Collapsing the two numbers would produce a false statement in one direction or the other.

## Gaps, named

- No relationship or dependency graph: the inventory is a set of lists, not a DAG.
- No package URLs (`purl`) or CPE identifiers, so it cannot be fed to a vulnerability
  matcher without a mapping step.
- No supplier or originator fields.
- No file-level "licence declared" versus "licence concluded" distinction, which is the
  part of SPDX that carries legal weight.
- No signature over the document.
- The Rust inventory is parsed from `Cargo.toml` fields with fixed patterns, not resolved
  through `cargo metadata`, so it reflects declarations rather than a resolved graph.
- The build is not bit-for-bit reproducible, and the document says so.

## How to close it

Run `syft noesar-evolution:phase4 -o spdx-json` (or CycloneDX) on a host that has the tool,
compare its OS-package section against the 311 entries recorded here as a cross-check, and
keep the inventory generator as the offline fallback. That is a Phase 5 packaging task; the
gap is recorded, not papered over.
