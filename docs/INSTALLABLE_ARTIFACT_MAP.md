# NOESAR EVOLUTION — Installable Artifact Map

Binary and build artifacts are **never** committed (`CLAUDE10.md` §33). They are
preserved outside the repository, byte-identical, with checksums. This document is
the reference the repository keeps in their place.

```text
ARTIFACT_ROOT = /mnt/cachec/NOESAR_EVOLUTION_ARTIFACTS
```

Nothing here has been built, installed, or executed. Phase 1 only relocated and
checksummed what the delivery already contained.

---

## 1. Prebuilt Linux binaries — `$ARTIFACT_ROOT/prebuilt/linux-x86_64/`

Delivered in package 02 (`PREBUILT/linux-x86_64/`), excluded from Git.

| Artifact | Size | SHA-256 |
|---|---|---|
| `noesar-authority-daemon` | 944,488 | `838055e97d960e50a2ad55ad39b32f709907da4b0841922ccba433d00dcf15c1` |
| `noesar-control-plane` | 1,876,960 | `d276076f0fe1a316ecf62ac2656013a6800509e13a8b4b3b3be3c7fd607d69f2` |

Both are `ELF 64-bit LSB pie executable, x86-64, dynamically linked, not stripped`.
Accompanying provenance shipped with them and retained: `PROVENANCE.json`,
`BUILD_ARTIFACTS.tsv`, `README.md`, plus a generated `SHA256SUMS.txt` covering all
five files.

**Recorded build provenance** (from the delivered `PROVENANCE.json`, not re-verified
here — the build was not reproduced):

| Field | Value |
|---|---|
| Phase | `RUST_MANIFEST_REMEDIATION_V1` (2026-07-24) |
| Image | `rust:1-bookworm` @ `sha256:a0635962c16d…` |
| rustc / cargo | `1.97.1 (8bab26f4f 2026-07-14)` / `1.97.1 (c980f4866 2026-06-30)` |
| Build command | `cargo build --workspace --release --locked --offline` |
| `Cargo.lock` hash | `6cbc6d3267b93e00bf83815ac149454f880c5f8db52a98ca8df2c1b9e696514b` — **re-verified in Phase 1, matches** |

### Rebuilding from source instead

The repository contains everything needed to rebuild these binaries offline:

```bash
cd rust
cargo build --workspace --release --locked --offline
```

This requires `rust/.cargo/config.toml` (the vendoring configuration) and the
complete `rust/vendor/` tree — both tracked. See §3 for the two caveats.

## 2. Vendored compiled fragments — `$ARTIFACT_ROOT/vendor-binary-fragments/`

Four compiled files inside `rust/vendor/wit-bindgen-0.57.1/` are listed in that
crate's `.cargo-checksum.json` but are compiled binaries, which the repository
policy forbids. They are excluded from Git and preserved byte-identical:

```text
wit-bindgen-0.57.1/src/rt/libwit_bindgen_cabi.a
wit-bindgen-0.57.1/src/rt/wit_bindgen_cabi_realloc.o
wit-bindgen-0.57.1/src/rt/wit_bindgen_cabi_wasip3.o
wit-bindgen-0.57.1/wasi-cli@0.2.0.wasm
```

`SHA256SUMS.txt` in that directory covers all four.

**Restore before an offline build that needs them:**

```bash
cd "$ARTIFACT_ROOT/vendor-binary-fragments"
sha256sum -c SHA256SUMS.txt
cp -a wit-bindgen-0.57.1/. /path/to/repo/rust/vendor/wit-bindgen-0.57.1/
```

**Practical impact is low:** `wit-bindgen` is reachable only through `wasip2`, a WASI
target crate that is not compiled for `linux-x86_64`. Whether to restore them
permanently, re-vendor, or leave them out is a **Phase 2** decision.

## 3. Known caveats affecting an offline build

1. **`cc-1.3.0` is incomplete in the delivery (blocker B-003).**
   `rust/vendor/cc-1.3.0/src/target.rs` declares `mod apple; mod generated; mod
   llvm; mod parser;` and none of the four files ship. The packaging filter that
   strips `target/` build output removed a legitimate source directory. These files
   were **not** recreated — fabricating upstream source is forbidden. `cc` is
   reachable only via `iana-time-zone-haiku` and is not built on linux-x86_64, so a
   normal Linux build is expected to be unaffected. Phase 2 must decide between
   re-vendoring `cc-1.3.0` from crates.io, obtaining a corrected archive, or
   accepting the gap with the platform restriction documented.

2. **Vendor aggregate hash no longer matches the delivered record.** Recomputing the
   documented method gives `898f6fbb…` against the recorded `fff87295…`; the delta
   is exactly the four `cc-1.3.0` files. Per-crate verification is otherwise clean:
   **5,090 files OK, 0 corrupt**.

## 4. Artifacts that must never be committed

`*.zip`/`*.tar*`/`*.7z`, compiled binaries (`.exe`, `.dll`, `.so`, `.dylib`, `.a`,
`.o`, `.wasm`), OCI images, databases (`*.sqlite*`, `*.db`), model weights, caches,
build logs, `target/`, and any credential material. Enforced by `.gitignore` and
re-checked before every commit. Phase 1 verified the staged set contains **zero**
archives, `.env` files, databases, shared libraries, or ELF executables.
