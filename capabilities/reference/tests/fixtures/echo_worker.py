#!/usr/bin/env python3
import json
import os
import sys

print(json.dumps({
    "argv": sys.argv[1:],
    "cwd": os.getcwd(),
    "home": os.environ.get("HOME"),
    "network": os.environ.get("NOESAR_NETWORK_ACCESS"),
    "secretPresent": "NOESAR_TEST_SECRET" in os.environ,
}))
