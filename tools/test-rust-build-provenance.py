#!/usr/bin/env python3
from __future__ import annotations

import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def load_module(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot load {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


create = load_module(
    "noesar_create_rust_build_provenance",
    ROOT / "tools/create-rust-build-provenance.py",
)
verify = load_module(
    "noesar_verify_rust_build_provenance",
    ROOT / "tools/verify-rust-build-provenance.py",
)


class RustBuildProvenanceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(
            prefix="noesar-rust-provenance-"
        )
        self.root = Path(self.temp.name)
        self.workspace = self.root / "rust"
        (self.workspace / "src").mkdir(parents=True)
        (self.workspace / "Cargo.toml").write_text(
            '[package]\nname="test"\nversion="0.6.0"\n',
            encoding="utf-8",
        )
        (self.workspace / "Cargo.lock").write_text(
            "# synthetic locked dependency graph for provenance tests\n",
            encoding="utf-8",
        )
        (self.workspace / "src/lib.rs").write_text(
            "pub fn value() -> u8 { 1 }\n",
            encoding="utf-8",
        )
        self.binary = self.root / "noesar-authority-daemon"
        self.binary.write_bytes(b"synthetic test binary\n")
        self.tests = self.root / "tests.json"
        self.tests.write_text(
            '{"verdict":"PASS","summary":{"PASS":10,"FAIL":0}}\n',
            encoding="utf-8",
        )
        self.conformance = self.root / "conformance.txt"
        self.conformance.write_text(
            "AUTHORITY_CONFORMANCE=PASS\n",
            encoding="utf-8",
        )

    def tearDown(self):
        self.temp.cleanup()

    def create_value(self):
        return create.create_provenance(
            binary=self.binary,
            workspace=self.workspace,
            tests_report=self.tests,
            conformance_report=self.conformance,
            rustc_version="rustc 1.85.0 test",
            cargo_version="cargo 1.85.0 test",
            target_triple="x86_64-unknown-linux-gnu",
        )

    def test_01_valid_provenance_is_verified(self):
        value = self.create_value()
        path = self.root / "provenance.json"
        path.write_text(json.dumps(value), encoding="utf-8")
        verified = verify.verify(path)
        self.assertEqual(verified["release"], "0.6.0")
        self.assertEqual(len(verified["sourceTreeSha256"]), 64)

    def test_02_cargo_lock_is_required(self):
        (self.workspace / "Cargo.lock").unlink()
        with self.assertRaisesRegex(ValueError, "Cargo.lock is required"):
            self.create_value()

    def test_03_failed_test_report_is_rejected(self):
        self.tests.write_text('{"verdict":"FAIL"}\n', encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "tests report is not PASS"):
            self.create_value()

    def test_04_failed_conformance_is_rejected(self):
        self.conformance.write_text(
            "AUTHORITY_CONFORMANCE=FAIL\n",
            encoding="utf-8",
        )
        with self.assertRaisesRegex(ValueError, "conformance report is not PASS"):
            self.create_value()

    def test_05_binary_tampering_is_rejected(self):
        value = self.create_value()
        path = self.root / "provenance.json"
        path.write_text(json.dumps(value), encoding="utf-8")
        self.binary.write_bytes(b"tampered\n")
        with self.assertRaisesRegex(ValueError, "binarySha256 mismatch"):
            verify.verify(path)

    def test_06_cargo_lock_tampering_is_rejected(self):
        value = self.create_value()
        path = self.root / "provenance.json"
        path.write_text(json.dumps(value), encoding="utf-8")
        (self.workspace / "Cargo.lock").write_text(
            "tampered\n",
            encoding="utf-8",
        )
        with self.assertRaisesRegex(ValueError, "cargoLockSha256 mismatch"):
            verify.verify(path)

    KEY = bytes(range(32))

    def test_07_a_signed_document_verifies(self):
        signed = create.sign_document(self.create_value(), self.KEY)
        self.assertEqual(signed["signatureAlgorithm"], "HMAC-SHA256")
        # Stated, not implied: this signature is symmetric, so a verifier can forge it.
        self.assertFalse(signed["publiclyVerifiable"])
        verify.verify_signature(signed, self.KEY)

    def test_08_a_tampered_field_breaks_the_signature(self):
        signed = create.sign_document(self.create_value(), self.KEY)
        signed["sourceTreeSha256"] = "f" + signed["sourceTreeSha256"][1:]
        with self.assertRaisesRegex(ValueError, "signature mismatch"):
            verify.verify_signature(signed, self.KEY)

    def test_09_the_wrong_key_is_rejected(self):
        signed = create.sign_document(self.create_value(), self.KEY)
        with self.assertRaisesRegex(ValueError, "signature mismatch"):
            verify.verify_signature(signed, bytes(32))

    def test_10_an_unsigned_document_is_rejected(self):
        value = self.create_value()
        with self.assertRaisesRegex(ValueError, "not signed"):
            verify.verify_signature(value, self.KEY)

    def test_11_a_short_key_is_refused_at_signing_time(self):
        with self.assertRaisesRegex(ValueError, "at least 32 bytes"):
            create.sign_document(self.create_value(), b"short")


if __name__ == "__main__":
    unittest.main(verbosity=2)
