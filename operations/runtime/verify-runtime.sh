#!/usr/bin/env sh
set -eu
PORT="${NOESAR_PORT:-8088}"
python3 - "$PORT" <<'PY'
import json, sys, urllib.request
port = int(sys.argv[1])
with urllib.request.urlopen(f"http://127.0.0.1:{port}/healthz", timeout=5) as r:
    value = json.load(r)
if r.status != 200 or value.get("status") != "healthy" or value.get("local") is not True:
    raise SystemExit("health verification failed")
print(json.dumps(value, indent=2))
PY
