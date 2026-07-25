#!/usr/bin/env python3
import hashlib
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
MANIFEST=ROOT/'MANIFEST.sha256'
def digest(p):
    h=hashlib.sha256()
    with p.open('rb') as f:
        for c in iter(lambda:f.read(1024*1024),b''): h.update(c)
    return h.hexdigest()
def main():
    failures=[]
    lines=MANIFEST.read_text(encoding='utf-8').splitlines()
    for line in lines:
        expected,rel=line.split('  ',1); p=ROOT/rel
        if not p.is_file(): failures.append('missing: '+rel)
        elif digest(p)!=expected: failures.append('mismatch: '+rel)
    if failures:
        print('VERDICT=FAIL'); [print(x) for x in failures]; return 1
    print('VERDICT=PASS'); print(f'FILES_VERIFIED={len(lines)}'); return 0
if __name__=='__main__': raise SystemExit(main())
