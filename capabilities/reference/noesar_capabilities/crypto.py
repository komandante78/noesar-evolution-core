# SPDX-License-Identifier: AGPL-3.0-or-later
from __future__ import annotations

import subprocess
import tempfile
from pathlib import Path


def verify_ed25519(
    public_key: Path,
    message: bytes,
    signature: bytes,
) -> bool:
    with tempfile.TemporaryDirectory(prefix="noesar-signature-") as directory:
        root = Path(directory)
        message_path = root / "message.bin"
        signature_path = root / "signature.bin"
        message_path.write_bytes(message)
        signature_path.write_bytes(signature)
        result = subprocess.run(
            [
                "openssl", "pkeyutl", "-verify", "-pubin",
                "-inkey", str(public_key), "-rawin",
                "-in", str(message_path),
                "-sigfile", str(signature_path),
            ],
            capture_output=True,
            text=True,
            check=False,
        )
        return result.returncode == 0
