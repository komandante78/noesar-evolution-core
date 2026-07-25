#!/usr/bin/env node
/**
 * Regression test for the packaging/ignore filters that caused blocker B-003.
 *
 * B-003: an un-anchored `target/` rule matches ANY directory named `target` at any
 * depth. It removed rust/vendor/cc-1.3.0/src/target/{apple,generated,llvm,parser}.rs
 * -- real upstream crate source -- from the delivered archives, leaving a vendor tree
 * that could not build offline.
 *
 * This test builds a throwaway fixture and asserts, against the REAL .gitignore:
 *
 *   rust/target/build-output.bin              -> EXCLUDED
 *   rust/vendor/example/src/target/source.rs  -> PRESERVED
 *
 * plus the concrete paths from the incident and a few neighbours.
 *
 * Usage: node tools/test-packaging-filters.mjs        (exit 0 = PASS, 1 = FAIL)
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

// path -> expected disposition
const CASES = [
  // --- the incident itself ---
  ['rust/vendor/cc-1.3.0/src/target/apple.rs', 'PRESERVED'],
  ['rust/vendor/cc-1.3.0/src/target/generated.rs', 'PRESERVED'],
  ['rust/vendor/cc-1.3.0/src/target/llvm.rs', 'PRESERVED'],
  ['rust/vendor/cc-1.3.0/src/target/parser.rs', 'PRESERVED'],
  // --- the two cases the phase specification names explicitly ---
  ['rust/target/build-output.bin', 'EXCLUDED'],
  ['rust/vendor/example/src/target/source.rs', 'PRESERVED'],
  // --- genuine build output must still be excluded ---
  ['target/debug/binary', 'EXCLUDED'],
  ['rust/target/release/noesar-control-plane', 'EXCLUDED'],
  // --- other vendored source that merely looks like build output ---
  ['rust/vendor/example/target/helper.rs', 'PRESERVED'],
  ['rust/vendor/rustversion-1.0.23/build/build.rs', 'PRESERVED'],
  ['rust/vendor/wasm-bindgen-0.2.126/src/cache/intern.rs', 'PRESERVED'],
  ['rust/.cargo/config.toml', 'PRESERVED'],
];

function run() {
  const dir = mkdtempSync(join(tmpdir(), 'noesar-filter-test-'));
  try {
    execFileSync('git', ['-C', dir, 'init', '-q'], { stdio: 'pipe' });
    copyFileSync(join(repoRoot, '.gitignore'), join(dir, '.gitignore'));

    for (const [rel] of CASES) {
      const abs = join(dir, rel);
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, 'fixture\n');
    }

    // git check-ignore exits 1 when the path is NOT ignored
    const isIgnored = (rel) => {
      try {
        execFileSync('git', ['-C', dir, 'check-ignore', '-q', '--', rel], { stdio: 'pipe' });
        return true;
      } catch {
        return false;
      }
    };

    let failures = 0;
    console.log('packaging filter regression test\n');
    for (const [rel, expected] of CASES) {
      const actual = isIgnored(rel) ? 'EXCLUDED' : 'PRESERVED';
      const ok = actual === expected;
      if (!ok) failures++;
      console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${expected.padEnd(9)} ${rel}${ok ? '' : `   <-- got ${actual}`}`);
    }

    // --- second filter: tools/create-rust-build-provenance.py::is_build_output ---
    // Same defect class, same rules. Verified through the real Python implementation
    // rather than a reimplementation, so the test fails if that code regresses.
    const PY_CASES = [
      ['rust/target/build-output.bin', true],
      ['target/debug/binary', true],
      ['rust/target/release/noesar-control-plane', true],
      ['rust/vendor/cc-1.3.0/src/target/apple.rs', false],
      ['rust/vendor/example/src/target/source.rs', false],
      ['rust/vendor/example/target/helper.rs', false],
      ['rust/crates/noesar-auth/src/lib.rs', false],
    ];
    let pyFailures = 0;
    const py = [
      'import sys, importlib.util',
      `spec = importlib.util.spec_from_file_location("p", ${JSON.stringify(join(repoRoot, 'tools/create-rust-build-provenance.py'))})`,
      'm = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)',
      `cases = ${JSON.stringify(PY_CASES)}`,
      'bad = 0',
      'for rel, expected in cases:',
      '    got = m.is_build_output(tuple(rel.split("/")))',
      '    ok = (got == expected)',
      '    if not ok: bad += 1',
      '    print(("  PASS  " if ok else "  FAIL  ") + ("EXCLUDED " if expected else "PRESERVED") + " " + rel + ("" if ok else "   <-- got " + ("EXCLUDED" if got else "PRESERVED")))',
      'sys.exit(1 if bad else 0)',
    ].join('\n');

    console.log('\nprovenance filter (tools/create-rust-build-provenance.py)\n');
    let pySkipped = false;
    try {
      const out = execFileSync('python3', ['-c', py], { encoding: 'utf8', stdio: 'pipe' });
      process.stdout.write(out);
    } catch (e) {
      if (e.stdout) process.stdout.write(e.stdout);
      if (e.code === 'ENOENT') {
        pySkipped = true;
        console.log('  SKIPPED — python3 not available on this host');
      } else {
        pyFailures = 1;
      }
    }

    const total = CASES.length + (pySkipped ? 0 : PY_CASES.length);
    const passed = total - failures - (pyFailures ? PY_CASES.length : 0);
    console.log(`\n${passed}/${total} cases passed${pySkipped ? ' (python filter not verified: python3 missing)' : ''}`);
    if (failures || pyFailures) {
      console.error(`\nPACKAGING_FILTER_REGRESSION: FAIL`);
      return 1;
    }
    if (pySkipped) {
      console.error('\nPACKAGING_FILTER_REGRESSION: PARTIAL — gitignore rules PASS, python filter UNVERIFIED');
      return 2;
    }
    console.log('\nPACKAGING_FILTER_REGRESSION: PASS');
    return 0;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

process.exit(run());
