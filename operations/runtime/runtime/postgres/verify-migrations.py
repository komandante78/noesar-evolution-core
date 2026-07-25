#!/usr/bin/env python3
from pathlib import Path
import runpy

root = Path(__file__).resolve().parents[3]
runpy.run_path(str(root / "tools/verify-postgres-migrations.py"), run_name="__main__")
