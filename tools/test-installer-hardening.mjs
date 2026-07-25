#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Behavioural regression test for the delivered installers.
//
// `bash -n` is not enough here. A comment placed inside a backslash continuation
// is syntactically valid and silently TRUNCATES the `docker run` command, so every
// flag after it is lost — including the hardening flags. This test therefore runs
// each installer against a stub `docker` on PATH and inspects the arguments that
// actually arrive.
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const INSTALLERS = [
  { path: 'deployment/docker/run.sh', runsContainer: true },
  { path: 'INSTALLATION/install-unraid.sh', runsContainer: true },
  { path: 'deployment/unraid/install-complete.sh', runsContainer: true },
];

// Every flag that must survive to the real `docker run`.
const REQUIRED_FLAGS = [
  '--read-only',
  '--cap-drop',
  '--security-opt',
  '--pids-limit',
  '--memory',
  '--cpus',
];

function stubEnvironment() {
  const root = mkdtempSync(join(tmpdir(), 'noesar-installer-'));
  const bin = join(root, 'bin');
  mkdirSync(bin, { recursive: true });
  const log = join(root, 'docker-args.log');
  // The stub records every invocation, one argv per line, and satisfies the
  // preflight probes the installers make.
  const stub = `#!/usr/bin/env sh
printf '%s\\n' "$*" >> ${log}
case "$1" in
  network)   exit 0 ;;
  image)     exit 0 ;;
  container) exit 1 ;;
  build)     exit 0 ;;
  run)       exit 0 ;;
  *)         exit 0 ;;
esac
`;
  writeFileSync(join(bin, 'docker'), stub);
  chmodSync(join(bin, 'docker'), 0o755);
  return { root, bin, log };
}

function runInstaller(relativePath) {
  const { root, bin, log } = stubEnvironment();
  const workspace = join(root, 'workspace');
  mkdirSync(workspace, { recursive: true });
  try {
    execFileSync('sh', [join(repoRoot, relativePath)], {
      cwd: repoRoot,
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        NOESAR_WORKSPACE: workspace,
        NOESAR_RUNTIME_ROOT: repoRoot,
        NOESAR_IMAGE: 'noesar-evolution:test',
        NOESAR_CONTAINER: 'noesar-evolution-test',
        NOESAR_NETWORK: 'noesar-evolution-test-net',
        NOESAR_PORT: '8100',
      },
      stdio: 'pipe',
      timeout: 60_000,
    });
  } catch (error) {
    // A non-zero exit is only fatal if nothing was recorded at all.
    if (!existsSync(log)) {
      throw new Error(`${relativePath} produced no docker invocation: ${error.stderr?.toString?.() ?? error.message}`);
    }
  }
  const lines = existsSync(log) ? readFileSync(log, 'utf8').split('\n').filter(Boolean) : [];
  return lines;
}

let failures = 0;
let checks = 0;

function check(condition, message) {
  checks += 1;
  if (condition) return;
  failures += 1;
  console.log(`  FAIL  ${message}`);
}

console.log('Installer hardening regression\n');

for (const installer of INSTALLERS) {
  console.log(`- ${installer.path}`);
  const invocations = runInstaller(installer.path);
  const runLine = invocations.find((line) => line.startsWith('run ') || line.includes(' run '));

  check(Boolean(runLine), `${installer.path}: a "docker run" invocation must reach docker`);
  if (!runLine) continue;

  // The weakened profile must not be passed at all.
  check(!/seccomp=/.test(runLine), `${installer.path}: must not pass --security-opt seccomp=`);
  check(!/seccomp-noesar\.json/.test(runLine), `${installer.path}: must not reference the NOT_FOR_USE profile`);

  // Every hardening flag must survive the continuation.
  for (const flag of REQUIRED_FLAGS) {
    check(runLine.includes(flag), `${installer.path}: ${flag} must reach docker run`);
  }
  check(/no-new-privileges/.test(runLine), `${installer.path}: no-new-privileges must reach docker run`);
  check(/--cap-drop ALL/.test(runLine), `${installer.path}: capabilities must be dropped`);

  // The command must not have been truncated: the image argument is last.
  check(/--mount /.test(runLine), `${installer.path}: the workspace mount must reach docker run`);
  // Docker 29 rejects a bare `rw` field in --mount ("must be a key=value pair"),
  // which made every delivered installer fail at run time on this host.
  check(!/dst=\/workspace,rw\b/.test(runLine), `${installer.path}: --mount must not use the bare "rw" field`);
  check(/dst=\/workspace,readonly=false/.test(runLine), `${installer.path}: the workspace mount must be explicitly writable`);
  check(/noesar-evolution:test/.test(runLine), `${installer.path}: the image argument must reach docker run (command not truncated)`);

  // Publishing must stay on loopback.
  check(!/--publish (?!127\.0\.0\.1)/.test(runLine) || /127\.0\.0\.1:/.test(runLine),
    `${installer.path}: the port must be published on loopback only`);
  console.log(`    docker run flags observed: ${runLine.split(' ').filter((token) => token.startsWith('--')).join(' ')}`);
}

console.log(`\n${checks - failures}/${checks} checks passed`);
if (failures) {
  console.log('INSTALLER_HARDENING: FAIL');
  process.exit(1);
}
console.log('INSTALLER_HARDENING: PASS');
