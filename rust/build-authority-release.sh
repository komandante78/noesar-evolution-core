#!/usr/bin/env sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
OUT=${NOESAR_RUST_BUILD_OUTPUT:?NOESAR_RUST_BUILD_OUTPUT is required}
REPORT=${NOESAR_RUST_BUILD_REPORT:?NOESAR_RUST_BUILD_REPORT is required}
# NOESAR_RUST_TEST_REPORT is an OUTPUT of this script, not an input. It used to be supplied
# by the caller, which meant the verdict on the tests came from whoever wanted the build to
# pass rather than from running them. This script is the thing that runs them, so it is the
# thing that records the result.
: "${NOESAR_RUST_TEST_REPORT:?NOESAR_RUST_TEST_REPORT is required}"
# The conformance report stays an input: the authority vectors are executed by the
# reference control plane's Node test suite, not by cargo. `tools/emit-conformance-report.mjs`
# is what produces it -- it did not exist before 2026-07-27, so nothing ever produced this
# file and the release path could not complete.
: "${NOESAR_AUTHORITY_CONFORMANCE_REPORT:?NOESAR_AUTHORITY_CONFORMANCE_REPORT is required}"

command -v rustc >/dev/null 2>&1 || {
  echo "rustc is required" >&2
  exit 1
}
command -v cargo >/dev/null 2>&1 || {
  echo "cargo is required" >&2
  exit 1
}
test -f "$ROOT/Cargo.lock" || {
  echo "Cargo.lock is required for a locked release build" >&2
  exit 1
}

# rust-toolchain.toml requests `channel = "stable"`. rustup treats that as a toolchain
# name distinct from a version-named installed toolchain, so it tries to sync the channel
# over the network BEFORE cargo ever runs, and the build dies on an isolated host. The pin
# belongs here and not in the manifest: `stable` stays correct for a networked developer
# machine. An explicit RUSTUP_TOOLCHAIN from the caller always wins.
if [ -z "${RUSTUP_TOOLCHAIN:-}" ] && command -v rustup >/dev/null 2>&1; then
  RUSTUP_TOOLCHAIN=$(rustup toolchain list 2>/dev/null | awk '/\(default\)/ {print $1; exit}')
  if [ -n "$RUSTUP_TOOLCHAIN" ]; then
    export RUSTUP_TOOLCHAIN
  else
    unset RUSTUP_TOOLCHAIN
  fi
fi

SIGNING_KEY=${NOESAR_PROVENANCE_SIGNING_KEY_FILE:?NOESAR_PROVENANCE_SIGNING_KEY_FILE is required}
test -f "$SIGNING_KEY" || {
  echo "provenance signing key not found at $SIGNING_KEY" >&2
  exit 1
}
test -f "$NOESAR_AUTHORITY_CONFORMANCE_REPORT" || {
  echo "conformance report not found at $NOESAR_AUTHORITY_CONFORMANCE_REPORT" >&2
  echo "produce it first: node tools/emit-conformance-report.mjs <path>" >&2
  exit 1
}

umask 077
mkdir -p "$OUT" "$(dirname "$REPORT")" "$(dirname "$NOESAR_RUST_TEST_REPORT")"

cd "$ROOT"
# --offline is not a concession to an isolated host: every dependency is vendored under
# rust/vendor and replaced through .cargo/config.toml, so a release build that reaches the
# network is a release build whose inputs were not the ones committed.
# The report records what happened, so it is written from the exit status and never before
# it is known. A failing suite writes RUST_TESTS=FAIL and stops the release.
if cargo test --workspace --locked --offline --all-targets; then
  printf 'RUST_TESTS=PASS\n' > "$NOESAR_RUST_TEST_REPORT"
else
  printf 'RUST_TESTS=FAIL\n' > "$NOESAR_RUST_TEST_REPORT"
  echo "rust tests failed; release refused" >&2
  exit 1
fi

cargo build \
  --release \
  --locked \
  --offline \
  --package noesar-authority-daemon \
  --bin noesar-authority-daemon

BINARY="$ROOT/target/release/noesar-authority-daemon"
test -f "$BINARY"
cp "$BINARY" "$OUT/noesar-authority-daemon"

python3 "$ROOT/../tools/create-rust-build-provenance.py" \
  --binary "$OUT/noesar-authority-daemon" \
  --workspace "$ROOT" \
  --tests-report "$NOESAR_RUST_TEST_REPORT" \
  --conformance-report "$NOESAR_AUTHORITY_CONFORMANCE_REPORT" \
  --report "$REPORT" \
  --signing-key-file "$SIGNING_KEY"

echo "RUST_AUTHORITY_RELEASE_BUILD=RECORDED"
