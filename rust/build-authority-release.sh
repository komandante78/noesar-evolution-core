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

umask 077
mkdir -p "$OUT" "$(dirname "$REPORT")"

cd "$ROOT"
cargo test --workspace --locked --all-targets
cargo build \
  --release \
  --locked \
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
