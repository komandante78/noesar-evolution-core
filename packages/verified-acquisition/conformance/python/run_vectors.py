#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-or-later
"""Run the VA-012 vectors against the Python implementation — `D-0551`.

This is what makes `conformance/vectors.json` a cross-language artefact rather than a claim:
the vectors are read as data, by a program that shares no line of code with the encoder that
produced them, and each case is checked twice — against the exact expected string, and against
the SHA-256 of the encoded bytes, because an implementation that cannot compare strings
byte-for-byte can still compare digests.

Run offline, from the repository root:

    docker run --rm --network none -v "$PWD:/repo:ro" -w /repo python:3-slim \\
        python3 packages/verified-acquisition/conformance/python/run_vectors.py

`scripts/test.sh` does exactly that through `pyrun`, which prefers a real `python3` when the
host has one and declares UNAVAILABLE — never a silent skip — when it has neither.
"""

import hashlib
import json
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from canonical_json import canonical_json, canonical_json_bytes, CanonicalJsonError  # noqa: E402

VECTORS = os.path.join(HERE, os.pardir, "vectors.json")

failures = []
checks = 0


def check(ok, label, detail=""):
    global checks
    checks += 1
    if not ok:
        failures.append(f"{label}: {detail}")


def main():
    with open(VECTORS, "r", encoding="utf-8") as handle:
        vectors = json.load(handle)

    family = vectors.get("canonicalisation")
    if not family or not family.get("cases"):
        print("CANONICAL_JSON_PYTHON: FAIL — no canonicalisation vectors found", flush=True)
        return 1

    print(f"VA-012 vectors, Python implementation — contract {vectors['contractVersion']}\n")

    for case in family["cases"]:
        value = case["value"]
        # Rule 7: for a descriptor the signed pre-image is the document with its `signature`
        # member removed BEFORE encoding, so member order cannot depend on it.
        if case.get("preimage"):
            value = {k: v for k, v in value.items() if k != "signature"}

        try:
            produced = canonical_json(value)
        except CanonicalJsonError as error:
            check(False, case["id"], f"raised {error}")
            continue

        check(produced == case["expected"], case["id"],
              f"expected {case['expected']!r}, produced {produced!r}")
        digest = hashlib.sha256(canonical_json_bytes(value)).hexdigest()
        check(digest == case["expectedSha256"], case["id"] + ":sha256",
              f"expected {case['expectedSha256']}, produced {digest}")

    # The negative-zero case only means something if the sign survived JSON parsing. Python
    # preserves it (`json.loads('-0.0')` is `-0.0`), and this asserts that rather than trusting
    # it — the JavaScript side has the same tripwire, for the same reason.
    zero = next((c for c in family["cases"] if c["id"] == "negative-zero-encodes-as-zero"), None)
    if zero is not None:
        n = zero["value"]["n"]
        check(math.copysign(1.0, float(n)) < 0, "negative-zero-vector-is-really-negative",
              "the vector carries +0 and therefore measures nothing")

    # The refusals, which JSON cannot express and which therefore are not in the vector file.
    # A canonical encoder that invents a representation for a value outside the space signs a
    # document its author never wrote.
    for label, value in [
        ("NaN", float("nan")),
        ("infinity", float("inf")),
        ("a-set-is-not-a-json-value", {1, 2}),
        ("a-class-instance-is-not-a-plain-object", Exception("x")),
        ("an-int-beyond-double-precision", 2 ** 53 + 1),
        ("a-nested-non-value-is-caught-too", {"a": {"b": [1, object()]}}),
    ]:
        rejected = False
        try:
            canonical_json(value)
        except CanonicalJsonError:
            rejected = True
        except TypeError:
            rejected = True
        check(rejected, f"rejects:{label}", "this value must be refused, never coerced")

    # Determinism as an observable property: same members, different insertion order.
    check(canonical_json({"z": 1, "a": {"d": 4, "c": 3}}) == canonical_json({"a": {"c": 3, "d": 4}, "z": 1}),
          "insertion-order-cannot-change-the-bytes", "two equal objects encoded differently")

    for line in failures:
        print(f"  FAIL  {line}")
    print(f"\n{checks - len(failures)}/{checks} checks passed")
    if failures:
        print("CANONICAL_JSON_PYTHON: FAIL")
        return 1
    print("CANONICAL_JSON_PYTHON: PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())
