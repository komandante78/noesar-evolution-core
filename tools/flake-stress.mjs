// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Stress the unit suite to hunt an intermittent failure.
//
// Phase 4 observed one failure in one run of 352 tests and never reproduced it; the output
// was gone before it could be read. This harness exists so that a recurrence is captured
// rather than merely noticed: every run records its seed, its file order, its exit status
// and, on failure, the complete output.
//
//   node tools/flake-stress.mjs --isolated 50 --suite 20 [--out DIR] [--seed N]
//
// --isolated N   run each timing-sensitive file N times on its own
// --suite N      run the whole suite N times, each with a shuffled file order
//
// The file order is shuffled deliberately: a test that only fails after another test has
// run — shared temp directory, leaked global, a clock already advanced — cannot be found
// by repeating a fixed order.

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const testDir = path.join(repoRoot, 'services/reference-control-plane/test');

// The two files Phase 4 named as the likeliest candidates, being the only ones that
// depend on real elapsed time rather than a controlled clock.
const TIMING_SENSITIVE = [
  'totp-replay.test.mjs',
  'provider-gateway-success-paths.test.mjs',
  'auth.test.mjs',
  'watchdog.test.mjs',
  'update-manager.test.mjs',
];

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const isolatedRuns = Number(arg('isolated', 50));
const suiteRuns = Number(arg('suite', 20));
const outDir = arg('out', path.join(
  process.env.ARTIFACT_ROOT ?? '/mnt/cachec/NOESAR_EVOLUTION_ARTIFACTS',
  'flake-stress',
));
let seed = Number(arg('seed', 20260725));

// A named, reproducible PRNG rather than Math.random: an order that cannot be replayed is
// an order that cannot be used to reproduce the failure it found.
function nextRandom() {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
}

function shuffle(items, label) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(nextRandom() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return { order: copy, label };
}

function runNode(args, env = {}) {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(process.execPath, args, {
      cwd: repoRoot,
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d.toString('utf8'); });
    child.stderr.on('data', (d) => { stderr += d.toString('utf8'); });
    child.on('close', (code) => {
      resolve({ code, stdout, stderr, ms: Date.now() - started });
    });
  });
}

function summarise(output) {
  const pass = /^# pass (\d+)$/m.exec(output)?.[1];
  const fail = /^# fail (\d+)$/m.exec(output)?.[1];
  const failures = [...output.matchAll(/^not ok \d+ - (.+)$/gm)].map((m) => m[1]);
  return { pass: Number(pass ?? 0), fail: Number(fail ?? 0), failures };
}

async function main() {
  await fsp.mkdir(outDir, { recursive: true });
  const allFiles = (await fsp.readdir(testDir))
    .filter((name) => name.endsWith('.test.mjs')).sort();

  const log = [];
  let failures = 0;

  process.stdout.write(`FLAKE_STRESS start seed=${seed} isolated=${isolatedRuns} suite=${suiteRuns}\n`);
  process.stdout.write(`files=${allFiles.length} timing_sensitive=${TIMING_SENSITIVE.length}\n\n`);

  // ---- isolated repetitions ------------------------------------------------
  for (const file of TIMING_SENSITIVE) {
    const full = path.join(testDir, file);
    if (!fs.existsSync(full)) {
      process.stdout.write(`SKIP ${file} (not present)\n`);
      continue;
    }
    let fileFailures = 0;
    for (let run = 1; run <= isolatedRuns; run += 1) {
      const result = await runNode(['--test', full]);
      const summary = summarise(result.stdout + result.stderr);
      const ok = result.code === 0 && summary.fail === 0;
      if (!ok) {
        fileFailures += 1;
        failures += 1;
        const record = path.join(outDir, `FAIL-isolated-${file}-run${run}.log`);
        await fsp.writeFile(record, `${result.stdout}\n--- stderr ---\n${result.stderr}`);
        process.stdout.write(`FAIL isolated ${file} run ${run}: ${summary.failures.join(' | ')} -> ${record}\n`);
      }
      log.push({
        kind: 'isolated', file, run, exit: result.code, ms: result.ms,
        pass: summary.pass, fail: summary.fail, failures: summary.failures,
      });
    }
    process.stdout.write(`isolated ${file}: ${isolatedRuns - fileFailures}/${isolatedRuns} clean\n`);
  }

  // ---- full-suite repetitions, shuffled ------------------------------------
  for (let run = 1; run <= suiteRuns; run += 1) {
    const { order } = shuffle(allFiles, `suite-${run}`);
    const result = await runNode(['--test', ...order.map((name) => path.join(testDir, name))]);
    const summary = summarise(result.stdout + result.stderr);
    const ok = result.code === 0 && summary.fail === 0;
    if (!ok) {
      failures += 1;
      const record = path.join(outDir, `FAIL-suite-run${run}.log`);
      await fsp.writeFile(record,
        `order:\n${order.join('\n')}\n\n${result.stdout}\n--- stderr ---\n${result.stderr}`);
      process.stdout.write(`FAIL suite run ${run}: ${summary.failures.join(' | ')} -> ${record}\n`);
    }
    log.push({
      kind: 'suite', run, exit: result.code, ms: result.ms,
      pass: summary.pass, fail: summary.fail, failures: summary.failures,
      order,
    });
    process.stdout.write(`suite run ${run}: ${ok ? 'PASS' : 'FAIL'} ${summary.pass} passed in ${result.ms} ms\n`);
  }

  const totalRuns = log.length;
  const report = {
    generatedUtc: new Date().toISOString(),
    seed: Number(arg('seed', 20260725)),
    isolatedRuns,
    suiteRuns,
    timingSensitiveFiles: TIMING_SENSITIVE,
    totalRuns,
    totalFailures: failures,
    status: failures === 0 ? 'NOT_REPRODUCED' : 'REPRODUCED',
    runs: log,
  };
  await fsp.writeFile(path.join(outDir, 'flake-stress-report.json'), `${JSON.stringify(report, null, 2)}\n`);

  process.stdout.write(`\nFLAKE_STRESS runs=${totalRuns} failures=${failures} status=${report.status}\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  process.stderr.write(`${error.stack}\n`);
  process.exit(2);
});
