#!/usr/bin/env sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
OUT=${NOESAR_RUST_BUILD_OUTPUT:?NOESAR_RUST_BUILD_OUTPUT is required}
REPORT=${NOESAR_RUST_BUILD_REPORT:?NOESAR_RUST_BUILD_REPORT is required}
: "${NOESAR_RUST_TEST_REPORT:?NOESAR_RUST_TEST_REPORT is required}"
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

umask 077
mkdir -p "$OUT" "$(dirname "$REPORT")"

cd "$ROOT"
# --offline is not a concession to an isolated host: every dependency is vendored under
# rust/vendor and replaced through .cargo/config.toml, so a release build that reaches the
# network is a release build whose inputs were not the ones committed.
cargo test --workspace --locked --offline --all-targets
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
  --report "$REPORT"

echo "RUST_AUTHORITY_RELEASE_BUILD=RECORDED"
