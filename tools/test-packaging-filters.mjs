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
  // --- the default runtime workspace ---
  // server.mjs falls back to <repoRoot>/.workspace when NOESAR_WORKSPACE is unset, so
  // running the service or any tool from the repository root materialises a runtime
  // workspace in it. The keys and the log were already caught by *.key and *.log; the
  // state was not, and was one `git add -A` away from being committed.
  ['.workspace/state/ai-workspace.json', 'EXCLUDED'],
  ['.workspace/state/watchdog.json', 'EXCLUDED'],
  ['.workspace/audit/events.jsonl', 'EXCLUDED'],
  ['.workspace/config/auth-master.key', 'EXCLUDED'],
  // Anchored, so a real source directory somebody later names .workspace deeper in the
  // tree is NOT swallowed — the exact mistake the target/ rules above were written for.
  ['services/example/.workspace/src/real-source.mjs', 'PRESERVED'],
  // --- D-0655: the §5a host-wide docker evidence, and the three-way split B-003's own
  // pattern never anticipated. `docker_inventory_*` was covered; the later split into three
  // separate captures (ps/network/volume) was not, and six such files had been accumulating
  // as untracked-but-not-ignored across two sessions before this was noticed. ---
  ['EVIDENCE/docker_inventory_pre_cleanup_D0655.txt', 'EXCLUDED'],
  ['EVIDENCE/docker_ps_post_cleanup_20260823T042836Z.txt', 'EXCLUDED'],
  ['EVIDENCE/docker_network_post_cleanup_20260823T042836Z.txt', 'EXCLUDED'],
  ['EVIDENCE/docker_volume_post_cleanup_20260823T042836Z.txt', 'EXCLUDED'],
  // The boundary the other direction: a docker-images capture pre-filtered to this project's
  // own tag is a real, already-committed evidence format (D-0442) and must not be swallowed
  // by broadening the pattern past the three leaking prefixes above.
  ['EVIDENCE/docker_images_pre_hygiene_20260814T092746Z.txt', 'PRESERVED'],
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
    // Real bug found running this container fallback for the first time (D-0225): `cases
    // = ${JSON.stringify(PY_CASES)}` embeds JSON `true`/`false`, which is not Python —
    // Python spells them `True`/`False`. It has been silently broken since it was
    // written (7b6290e), because no python3 on this host ever actually ran it. Built
    // as a Python tuple literal directly instead of trusting JSON's booleans to double
    // as Python's.
    const casesLiteral = `[${PY_CASES.map(([rel, expected]) => `(${JSON.stringify(rel)}, ${expected ? 'True' : 'False'})`).join(', ')}]`;
    // Built twice: the native run needs the real host path, the container run needs the
    // path as it appears inside the mount. `is_build_output` itself is unaffected either
    // way — only the location of the module being imported changes.
    const pySource = (scriptPath) => [
      'import sys, importlib.util',
      `spec = importlib.util.spec_from_file_location("p", ${JSON.stringify(scriptPath)})`,
      'm = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)',
      `cases = ${casesLiteral}`,
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
      let out;
      try {
        out = execFileSync('python3', ['-c', pySource(join(repoRoot, 'tools/create-rust-build-provenance.py'))], { encoding: 'utf8', stdio: 'pipe' });
      } catch (native) {
        if (native.code !== 'ENOENT') throw native;
        // No python3 on the host: the same offline, throwaway container already used for
        // Rust (`tools/test.sh`) and ESLint (`tools/run-eslint.sh`) carries it instead.
        // CLAUDE10.md rule 20 forbids installing anything on the host, even
        // temporarily; rule 21a names a transient container as the sanctioned
        // alternative. Read-only mount: this only ever reads the tree.
        out = execFileSync('docker', [
          'run', '--rm', '--network', 'none',
          '-v', `${repoRoot}:/repo:ro`, '-w', '/repo',
          'python:3-slim', 'python3', '-c', pySource('/repo/tools/create-rust-build-provenance.py'),
        ], { encoding: 'utf8', stdio: 'pipe' });
      }
      process.stdout.write(out);
    } catch (e) {
      if (e.stdout) process.stdout.write(e.stdout);
      if (e.code === 'ENOENT') {
        pySkipped = true;
        console.log('  SKIPPED — neither python3 nor docker is available on this host');
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
