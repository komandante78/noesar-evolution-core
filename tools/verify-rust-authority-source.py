#!/usr/bin/env python3
from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
required = {
    "rust/Cargo.toml": [
        "noesar-authority-api",
        "noesar-data-plane",
        "noesar-authority-protocol",
        "noesar-canonical-json",
        "noesar-authority-transport",
        "noesar-authority-daemon",
        'version = "0.6.0"',
        'libc = "0.2"',
    ],
    "rust/crates/noesar-authority-protocol/src/lib.rs": [
        "AuthorityEnvelopeBody",
        "AuthorityVerifier",
        "ExpectedBindings",
        '"1.1"',
        "replay detected",
        "signature mismatch",
    ],
    "rust/crates/noesar-authority-transport/src/lib.rs": [
        "MAX_FRAME_BYTES",
        "PeerIdentity",
        "encode_frame",
        "FrameDecoder",
        "partial frame",
    ],
    "rust/crates/noesar-authority-daemon/src/lib.rs": [
        "AuthorityRequest",
        "AuthorityResponse",
        "DaemonPolicy",
        "validate_socket_path",
        "verify_peer",
        "handle_request",
        "SO_PEERCRED",
        "serve_stream",
        "production_ready: false",
    ],
    "rust/crates/noesar-authority-daemon/src/main.rs": [
        "NOESAR_AUTHORITY_SOCKET",
        "NOESAR_AUTHORITY_ALLOWED_UIDS",
        "NOESAR_AUTHORITY_HMAC_SECRET_FILE",
        "secret file must not be a symlink",
        "secret file must have private permissions",
        "UnixListener",
        "from_mode(0o600)",
        "non-Linux peer-credential transports remain unimplemented",
    ],
    "rust/build-authority-release.sh": [
        "cargo test --workspace --locked --offline --all-targets",
        "--package noesar-authority-daemon",
        "Cargo.lock is required",
        "NOESAR_RUST_TEST_REPORT",
        "NOESAR_AUTHORITY_CONFORMANCE_REPORT",
    ],
    "tools/create-rust-build-provenance.py": [
        "source_tree_digest",
        "cargoLockSha256",
        "testsReportSha256",
        "conformanceReportSha256",
        "testsPassed",
        "authorityConformancePassed",
    ],
    "tools/verify-rust-build-provenance.py": [
        "raise ValueError(f\"{hash_field} mismatch\")",
        "cargoLockSha256",
        "Rust tests were not accepted",
        "authority conformance was not accepted",
    ],
}

failures = []
for rel, tokens in required.items():
    path = ROOT / rel
    if not path.is_file():
        failures.append(f"missing:{rel}")
        continue
    text = path.read_text(encoding="utf-8")
    for token in tokens:
        if token not in text:
            failures.append(f"token:{rel}:{token}")

daemon_cargo = (
    ROOT / "rust/crates/noesar-authority-daemon/Cargo.toml"
).read_text(encoding="utf-8")
for dependency in [
    "noesar-authority-api",
    "noesar-authority-protocol",
    "noesar-authority-transport",
    "libc.workspace = true",
]:
    if dependency not in daemon_cargo:
        failures.append(f"daemon-dependency:{dependency}")

if failures:
    print("VERDICT=FAIL")
    for failure in failures:
        print(f"- {failure}")
    raise SystemExit(1)

print("VERDICT=PASS")
print("RUST_AUTHORITY_DAEMON_SOURCE=PASS")
print("RUST_UNIX_SO_PEERCRED_SOURCE=PASS")
print("RUST_SOCKET_PERMISSION_SOURCE=PASS")
print("RUST_LOCKED_BUILD_SCRIPT=PASS")
print("RUST_BUILD_PROVENANCE_TOOLING=PASS")
print("RUST_BUILD=NOT_EXECUTED")
print("RUST_TESTS=NOT_EXECUTED")
