#!/usr/bin/env sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$ROOT"
PYTHON=${NOESAR_PYTHON:-python3}

node --test services/reference-control-plane/test/*.test.mjs
node tools/verify-source.mjs
node tools/auth-http-smoke.mjs
"$PYTHON" tools/verify-postgres-migrations.py
"$PYTHON" tools/verify-postgres-contract.py
"$PYTHON" tools/verify-rust-authority-source.py
"$PYTHON" tools/test-rust-build-provenance.py -q
