#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-or-later
"""Run conformance/vectors.json against the Python reference implementation — the proof that
@noesar/capability-token is a portable wire format and not an artefact of one language's crypto
or number formatting.

Every `mac` vector's token was minted live by the real production TokenMinter
(services/reference-control-plane/src/capability.mjs) when this file's sibling `vectors.json`
was generated, and JavaScript's own @noesar/capability-token reproduced the identical MAC before
the vector was frozen — see vectors.json's own `note` and `provenance` fields. Passing here means
a THIRD, independent implementation reproduces the same bytes, having read only SPEC.md.

Run offline, from the repository root:

    docker run --rm --network none -v "$PWD:/repo:ro" -w /repo python:3-slim \\
        python3 packages/capability-token/conformance/python/run_vectors.py

`scripts/test.sh` runs this through `pyrun`, exactly like
packages/verified-acquisition/conformance/python/run_vectors.py.
"""

import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from capability_token import (  # noqa: E402
    CapabilityTokenFormatError,
    canonical_limits,
    sign,
    verify,
)

VECTORS_PATH = os.path.join(os.path.dirname(HERE), "vectors.json")


def main():
    with open(VECTORS_PATH, "r", encoding="utf-8") as handle:
        vectors = json.load(handle)

    total = 0
    failed = []

    for case in vectors["canonicalLimits"]:
        total += 1
        got = canonical_limits(case["limits"])
        if got != case["expected"]:
            failed.append((case["id"], f"expected {case['expected']!r}, got {got!r}"))

    for case in vectors["mac"]:
        total += 1
        secret = bytes.fromhex(case["secretHex"])
        try:
            got = sign(case["token"], secret)
        except CapabilityTokenFormatError as exc:
            failed.append((case["id"], f"sign raised {exc.kind}: {exc}"))
            continue
        if got != case["expectedMacHex"]:
            failed.append((case["id"], f"expected mac {case['expectedMacHex']}, got {got}"))

    for case in vectors["tamper"]:
        total += 1
        secret = bytes.fromhex(case["secretHex"])
        ok = verify(case["mutatedToken"], secret)
        if ok != case["expectVerify"]:
            failed.append((case["id"], f"expected verify()={case['expectVerify']}, got {ok}"))

    print(f"CT-PYTHON-CONFORMANCE {total - len(failed)}/{total}")
    for case_id, detail in failed:
        print(f"  FAIL {case_id}: {detail}")

    if failed:
        sys.exit(1)
    sys.exit(0)


if __name__ == "__main__":
    main()
