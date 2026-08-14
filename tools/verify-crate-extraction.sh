#!/usr/bin/env sh
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# Proves a Rust crate under rust/crates/ is genuinely standalone-extractable: copies ONLY that
# crate plus the workspace's vendored dependencies to a directory OUTSIDE the repository, with
# no parent [workspace] in scope, and builds + tests it inside a disposable, --network none
# rust:1-bookworm container. Generalizes the manual steps D-0450 ran by hand for
# `noesar-sandbox` (docs/DECISION_LOG.md), so WP4/WP5's crates (Phases D-E,
# FUNDING/19_WORK_PLAN_TO_BETA.md) can reuse this instead of repeating it.
#
# rustc/cargo are not assumed present on the host (verified absent on the reference
# development host, 2026-08-14) -- this is the same "tool absent from the host runs in a
# disposable container instead" pattern tools/run-eslint.sh and scripts/test.sh's Python
# verifiers already use. The whole vendor/ tree is copied rather than resolving each crate's
# transitive dependency set by hand: correct for any crate in the workspace, at the cost of a
# few hundred MB of copy the container discards when it exits.
#
#   tools/verify-crate-extraction.sh <crate-name>
#
# Exit status: 0 if the crate built and its own test suite passed standalone. Non-zero
# otherwise, with the failing command's output on stderr -- this script never reports PASS
# without having run the build and the tests in this invocation.

set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
IMAGE="${NOESAR_RUST_IMAGE:-rust:1-bookworm}"
RUSTUP_TOOLCHAIN="${NOESAR_RUST_TOOLCHAIN:-1.97.1-x86_64-unknown-linux-gnu}"

CRATE="${1:?usage: verify-crate-extraction.sh <crate-name> (e.g. noesar-sandbox)}"
CRATE_DIR="$ROOT/rust/crates/$CRATE"
test -d "$CRATE_DIR" || {
  echo "no such crate: rust/crates/$CRATE" >&2
  exit 2
}

WORK=$(mktemp -d "${TMPDIR:-/tmp}/verify-crate-extraction.XXXXXX")
trap 'rm -rf "$WORK"' EXIT

echo "== copying $CRATE (crate files + vendor/) to $WORK, outside $ROOT ==" >&2
mkdir -p "$WORK/crate" "$WORK/vendor" "$WORK/crate/.cargo"
cp -r "$CRATE_DIR"/. "$WORK/crate/"
rm -rf "$WORK/crate/target"
cp -r "$ROOT/rust/vendor/." "$WORK/vendor/"
cat > "$WORK/crate/.cargo/config.toml" <<CFG
[source.crates-io]
replace-with = "vendored-sources"

[source.vendored-sources]
directory = "../vendor"
CFG

echo "== confirming the copy has no reference back to this repository ==" >&2
if grep -rl "services/reference-control-plane\|/apps/\|NOESAR_EVOLUTION" "$WORK/crate" >/dev/null 2>&1; then
  echo "FAIL: copied crate still references the monorepo -- not actually independent" >&2
  grep -rl "services/reference-control-plane\|/apps/\|NOESAR_EVOLUTION" "$WORK/crate" >&2
  exit 1
fi

echo "== building + testing standalone, --network none, no parent [workspace] ==" >&2
docker run --rm --network none \
  -v "$WORK/crate:/crate" \
  -v "$WORK/vendor:/vendor" \
  -e RUSTUP_TOOLCHAIN="$RUSTUP_TOOLCHAIN" \
  -w /crate \
  "$IMAGE" \
  sh -c "cargo build --release --offline && cargo test --offline --all-targets"

echo "PASS: $CRATE builds and tests standalone, outside the repository, offline" >&2
