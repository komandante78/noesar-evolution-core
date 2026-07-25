# SPDX-License-Identifier: AGPL-3.0-or-later
from __future__ import annotations

import json
import re
from collections import Counter


def text_statistics(payload: dict) -> dict:
    text = str(payload.get("text", ""))
    words = re.findall(r"\b[\w'-]+\b", text.lower(), flags=re.UNICODE)
    counts = Counter(words)
    return {
        "characters": len(text),
        "words": len(words),
        "uniqueWords": len(counts),
        "topWords": counts.most_common(10),
    }


def structured_data_profile(payload: dict) -> dict:
    value = payload.get("value")
    if isinstance(value, dict):
        return {
            "type": "object",
            "keys": sorted(value.keys()),
            "count": len(value),
        }
    if isinstance(value, list):
        return {
            "type": "array",
            "count": len(value),
            "itemTypes": sorted({type(item).__name__ for item in value}),
        }
    return {
        "type": type(value).__name__,
        "valuePreview": json.dumps(value, ensure_ascii=False)[:200],
    }


BUILTINS = {
    "text-statistics": text_statistics,
    "structured-data-profile": structured_data_profile,
}
