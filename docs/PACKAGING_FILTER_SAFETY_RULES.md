# Packaging Filter Safety Rules

Binding rules for any filter that decides which files leave this project — ignore
files, packaging scripts, provenance digests, archive builders, sync tools.

They exist because a single un-anchored pattern silently deleted real upstream source
and shipped an unbuildable vendor snapshot (blocker **B-003**).

---

## 1. The incident

The packaging pipeline excluded "Rust build output" by removing anything named
`target`. Cargo build output *is* called `target/`, so the intent was right. But the
rule matched **any** directory named `target` at **any** depth, and
`cc-1.3.0/src/target/` is genuine upstream crate source:

```text
rust/vendor/cc-1.3.0/src/target.rs        <- declares mod apple/generated/llvm/parser
rust/vendor/cc-1.3.0/src/target/apple.rs      DELETED by the filter
rust/vendor/cc-1.3.0/src/target/generated.rs  DELETED
rust/vendor/cc-1.3.0/src/target/llvm.rs       DELETED
rust/vendor/cc-1.3.0/src/target/parser.rs     DELETED
```

Result: zero `/target/` paths anywhere in the five delivered archives, a vendor tree
that failed its own `.cargo-checksum.json`, and a delivery whose provenance claimed a
"complete vendor snapshot" that was not complete.

**The failure was silent.** Nothing errored. The archives looked complete, the file
counts looked plausible, and the defect only surfaced by recomputing checksums.

## 2. The rules

### R1 — Anchor build-output patterns to where build output actually is
Cargo build output only ever appears at a workspace root. Match it there:

```gitignore
/target/          # repository root
/rust/target/     # the Rust workspace
/rust/*/target/   # nested workspace members
```

Never write a bare `target/`, which matches at every depth.

### R2 — Vendored trees are source, never build output
Anything under a `vendor/` directory is third-party **source** that must survive every
filter, whatever it is named. Directories called `target/`, `build/`, `bin/`,
`cache/`, `test/`, `examples/` inside a vendored crate are part of that crate.

### R3 — Match on structure, not on a name fragment
When code decides, ask *where* the component sits, not merely whether the name occurs:

```python
def is_build_output(relative_parts: tuple[str, ...]) -> bool:
    for index, part in enumerate(relative_parts):
        if part == "target" and "vendor" not in relative_parts[:index]:
            return True
    return False
```

### R4 — Compare against paths relative to the tree root
Testing components of an **absolute** path lets the host layout change the result: a
checkout under `/srv/target/…` would exclude the entire tree. Always
`path.relative_to(root)` first. The pre-repair provenance script had this bug too.

### R5 — Deletion filters need a regression test
Any filter that removes files ships with a test proving both directions —
what must go, and what must stay. `tools/test-packaging-filters.mjs` is that test:

```text
rust/target/build-output.bin              -> EXCLUDED
rust/vendor/example/src/target/source.rs  -> PRESERVED
```

Run it before packaging, and in any pipeline that produces an archive.

### R6 — Verify the output, not the intent
After producing an archive or vendor tree, verify what actually came out:

- every vendored crate against its `.cargo-checksum.json`;
- the file count against the previous known-good count;
- an offline `cargo metadata` / `build` from an **empty** `CARGO_HOME`.

A filter you cannot verify is a filter you do not trust.

### R7 — A recorded hash is only useful if it is reproducible
The delivery recorded a `vendorManifestAggregate` and described the method. That
value cannot be reproduced by the documented method — not even from the delivery's
own build staging (seven path conventions tried). Publish the exact command, and
verify it reproduces before recording it, or the number provides false assurance.

## 3. Where these rules are enforced

| Location | Rule | Status |
|---|---|---|
| `.gitignore` build-output section | R1, R2 | fixed and tested |
| `tools/create-rust-build-provenance.py::is_build_output` | R3, R4 | fixed and tested |
| `tools/test-packaging-filters.mjs` | R5 | 19 cases, PASS |

The regression test covers both enforcement points: the ignore rules are checked with
real `git check-ignore` against a throwaway fixture, and the Python predicate is
imported and called directly, so a regression in either fails the test.

> `python3` is not installed on the current host, so the Python half is executed
> inside the pinned `rust:1-bookworm` container (which carries Python 3.11.2). The
> test reports `PARTIAL` rather than `PASS` if it cannot verify that half — it never
> silently skips.

## 4. If a filter has already caused damage

1. **Do not recreate the missing files by hand.** Fabricated content is worse than a
   known gap.
2. Recover from an authoritative source and **prove** it: hash every recovered file
   against the upstream manifest (`.cargo-checksum.json`, package checksum in
   `Cargo.lock`).
3. Diff the whole component against the authoritative copy — confirm the damage is
   exactly what you think it is and nothing else moved.
4. Fix the filter and add the regression test **before** re-packaging.
5. Re-verify end to end offline, then record what was recovered, from where, and how
   it was proven.
