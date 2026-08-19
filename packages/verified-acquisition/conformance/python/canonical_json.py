# SPDX-License-Identifier: AGPL-3.0-or-later
"""A second, independent implementation of VA-012 — the canonical encoding.

`D-0551`. This exists for one reason: until it was written, every implementation that had ever
run `conformance/vectors.json` was the JavaScript one that *produced* those vectors. A suite that
has only ever been run by its own author has been shown to agree with itself and nothing more.

**It is written from `SPEC.md` VA-012, not from `src/canonical-json.mjs`.** Translating the
JavaScript line by line would reproduce its assumptions along with its behaviour and prove
nothing; the whole value is in a different language's defaults being *wrong* and the vectors
catching it. They were, in five distinct ways, each measured on `python:3-slim` before this file
was written:

    rule 2  sorted() orders by CODE POINT       -> ['Z','é','Ａ','😀']
            VA-012 requires UTF-16 code units   -> ['Z','é','😀','Ａ']
    rule 4  repr(1e-7)  is '1e-07', not '1e-7'
    rule 4  repr(1.0)   is '1.0',   not '1'
    rule 4  repr(-0.0)  is '-0.0',  not '0'
    rule 5  json.dumps escapes non-ASCII by default (ensure_ascii=True)

This is a conformance oracle, not a product component. It has no dependencies outside the
standard library, touches no network and no filesystem, and is run offline in a disposable
container by `scripts/test.sh`.
"""

import math

__all__ = ["canonical_json", "canonical_json_bytes", "CanonicalJsonError"]


class CanonicalJsonError(TypeError):
    """A value outside the JSON value space VA-012 defines. Never coerced — always refused."""


def _utf16_sort_key(name):
    """The ordering rule of VA-012, and the one Python gets wrong by default.

    Sorting by code point puts an astral character (U+1F600) after U+FF21; sorting by UTF-16
    code units puts it before, because its first unit is the surrogate U+D83D. Encoding to
    UTF-16 big-endian and comparing the resulting bytes reproduces exactly that order without
    needing to reason about surrogates by hand.
    """
    return name.encode("utf-16-be", errors="surrogatepass")


def _number(value):
    """ECMAScript `Number::toString`, which is rule 4 — and which `repr()` is close to but not.

    Python's `repr` already gives the shortest round-tripping decimal, so the digits are right;
    what differs is the *presentation*. ECMAScript uses exponential notation only when the
    decimal exponent is below -6 or at least 21, writes no trailing `.0` for an integral value,
    and pads the exponent with no zeros.
    """
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise CanonicalJsonError(f"canonical JSON rejects {type(value).__name__}")
    if isinstance(value, int):
        # A Python int is unbounded; JSON numbers here are IEEE-754 doubles, and silently
        # encoding an integer no double can hold would produce bytes the other implementation
        # cannot reproduce. Refusing is the only answer that keeps the two in agreement.
        if abs(value) > 2 ** 53:
            raise CanonicalJsonError(f"{value} cannot be represented exactly as a double")
        value = float(value)
    if math.isnan(value) or math.isinf(value):
        raise CanonicalJsonError("canonical JSON rejects non-finite numbers")
    if value == 0:
        return "0"  # covers -0.0, which ECMAScript prints as "0" and repr() prints as "-0.0"

    if float(value).is_integer() and abs(value) < 1e21:
        return str(int(value))

    text = repr(float(value))
    if "e" not in text:
        exponent = 0
        mantissa = text
    else:
        mantissa, _, raw_exponent = text.partition("e")
        exponent = int(raw_exponent)

    digits = mantissa.lstrip("-").replace(".", "").lstrip("0") or "0"
    sign = "-" if value < 0 else ""
    # Decimal exponent of the leading digit, as ECMAScript's `k`/`n` decomposition defines it.
    point = len(mantissa.lstrip("-").partition(".")[0].lstrip("0") or "") + exponent
    if mantissa.lstrip("-").startswith("0."):
        fraction = mantissa.lstrip("-").partition(".")[2]
        point = exponent - (len(fraction) - len(fraction.lstrip("0")))
    digits = digits.rstrip("0") or "0"

    if -6 < point <= 21:
        if point <= 0:
            return f"{sign}0.{'0' * -point}{digits}"
        if point >= len(digits):
            return f"{sign}{digits}{'0' * (point - len(digits))}"
        return f"{sign}{digits[:point]}.{digits[point:]}"
    power = point - 1
    head = digits[0] if len(digits) == 1 else f"{digits[0]}.{digits[1:]}"
    return f"{sign}{head}{'e+' if power >= 0 else 'e-'}{abs(power)}"


_SHORT_ESCAPES = {'"': '\\"', "\\": "\\\\", "\b": "\\b", "\f": "\\f", "\n": "\\n", "\r": "\\r", "\t": "\\t"}


def _string(value):
    """Rule 5, written out rather than delegated — because delegating got it wrong.

    `json.dumps(ensure_ascii=False)` was the first attempt and the vectors refused it: it emits an
    unpaired surrogate **raw**, where VA-012 requires it escaped as `\\ud800`. Raw, it is not
    valid UTF-8 and the byte string cannot even be produced without `surrogatepass`. That failure
    is the whole reason this file exists — a default that looks equivalent and is not.
    """
    out = ["\""]
    for char in value:
        point = ord(char)
        if char in _SHORT_ESCAPES:
            out.append(_SHORT_ESCAPES[char])
        elif point < 0x20 or 0xD800 <= point <= 0xDFFF:
            out.append(f"\\u{point:04x}")
        else:
            out.append(char)
    out.append("\"")
    return "".join(out)


def canonical_json(value):
    """Encode `value` per SPEC.md VA-012. Raises `CanonicalJsonError` outside the value space."""
    if value is None:
        return "null"
    if value is True:
        return "true"
    if value is False:
        return "false"
    if isinstance(value, str):
        return _string(value)
    if isinstance(value, (int, float)):
        return _number(value)
    if isinstance(value, list):
        return "[" + ",".join(canonical_json(item) for item in value) + "]"
    if isinstance(value, dict):
        # Rule 1: no insignificant whitespace. Rule 2: members sorted by UTF-16 code units.
        parts = []
        for key in sorted(value.keys(), key=_utf16_sort_key):
            if not isinstance(key, str):
                raise CanonicalJsonError("an object member name must be a string")
            parts.append(f"{_string(key)}:{canonical_json(value[key])}")
        return "{" + ",".join(parts) + "}"
    raise CanonicalJsonError(f"canonical JSON rejects {type(value).__name__}")


def canonical_json_bytes(value):
    """Rule 6: the signed bytes are the UTF-8 encoding of the canonical string."""
    return canonical_json(value).encode("utf-8", errors="surrogatepass")
