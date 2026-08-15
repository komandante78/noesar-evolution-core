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
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// F-TMP-002 (2026-08-15): `stubEnvironment()` runs once per installer, and the "persists
// across a reinstall" check below creates one more — tracked here and swept on exit, the
// process-level equivalent of `test/support/workspace.mjs`'s `after()` for a plain script.
const ownedDirs = [];
process.on('exit', () => { for (const dir of ownedDirs) rmSync(dir, { recursive: true, force: true }); });

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
  ownedDirs.push(root);
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
  // A curl stub that succeeds, so the post-start readiness loop returns on its first
  // attempt instead of sleeping through all 30. Without it every installer run costs
  // 30 seconds and the readiness output — which is where the access URL is printed —
  // is never reached at all.
  const curlStub = `#!/usr/bin/env sh
printf 'curl %s\\n' "$*" >> ${join(root, 'curl-args.log')}
exit 0
`;
  writeFileSync(join(bin, 'curl'), curlStub);
  chmodSync(join(bin, 'curl'), 0o755);
  return { root, bin, log, curlLog: join(root, 'curl-args.log') };
}

function runInstaller(relativePath, extraEnv = {}, options = {}) {
  const { root, bin, log, curlLog } = stubEnvironment();
  const workspace = options.workspace ?? join(root, 'workspace');
  mkdirSync(workspace, { recursive: true });
  let stdout = '';
  let stderr = '';
  let exitCode = 0;
  try {
    stdout = execFileSync('sh', [join(repoRoot, relativePath)], {
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
        // Never inherit the operator's own choice into a test run.
        NOESAR_BIND_ADDRESS: '',
        NOESAR_BIND_SCOPE: '',
        NOESAR_ALLOW_PUBLIC_BIND: '',
        ...extraEnv,
      },
      stdio: 'pipe',
      timeout: 60_000,
    }).toString();
  } catch (error) {
    exitCode = error.status ?? 1;
    stdout = error.stdout?.toString?.() ?? '';
    stderr = error.stderr?.toString?.() ?? '';
    // A non-zero exit is only fatal if nothing was recorded at all — unless the
    // caller is deliberately testing a refusal, where no docker call is the point.
    if (!existsSync(log) && !options.expectRefusal) {
      throw new Error(`${relativePath} produced no docker invocation: ${stderr || error.message}`);
    }
  }
  const lines = existsSync(log) ? readFileSync(log, 'utf8').split('\n').filter(Boolean) : [];
  const curlLines = existsSync(curlLog) ? readFileSync(curlLog, 'utf8').split('\n').filter(Boolean) : [];
  return Object.assign(lines, { stdout, stderr, exitCode, workspace, curlLines, lines });
}

function runLineOf(invocations) {
  return invocations.find((line) => line.startsWith('run ') || line.includes(' run '));
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

// ---------------------------------------------------------------------------
// Access mode: where the WebUI is published, and what the installer refuses.
// ---------------------------------------------------------------------------
//
// The rule being protected is that widening access is always an explicit act. An
// installer that publishes on a wider address than the operator asked for — or that
// accepts an address this host does not have, and answers nowhere — is a defect,
// not a preference.

console.log('\nAccess mode selection\n');

// A real address on this host, discovered through the same library the installers
// use. If this machine has no private non-virtual address the LAN scenarios cannot
// be exercised honestly, and they are declared skipped rather than asserted.
function hostLanAddress() {
  try {
    const out = execFileSync('sh', ['-c',
      `. "${join(repoRoot, 'deployment/lib/network-access.sh')}" && noesar_first_lan_candidate`,
    ], { stdio: 'pipe', timeout: 10_000 }).toString().trim();
    return out || null;
  } catch { return null; }
}

const LAN_ADDRESS = hostLanAddress();
const ACCESS_INSTALLERS = INSTALLERS.map((entry) => entry.path);

for (const installer of ACCESS_INSTALLERS) {
  console.log(`- ${installer}`);

  // 1. The default is loopback, with no prompt, on a non-interactive run.
  {
    const result = runInstaller(installer);
    const line = runLineOf(result);
    check(Boolean(line) && /--publish 127\.0\.0\.1:8100:8088/.test(line),
      `${installer}: with nothing configured the publish must be 127.0.0.1`);
    check(Boolean(line) && /NOESAR_BIND_SCOPE=loopback/.test(line),
      `${installer}: the default exposure scope must be declared loopback`);
  }

  // 2. An explicit LAN address is published, declared as LAN scope, and added to
  //    the Host allowlist — the three have to move together or the WebUI answers 421.
  if (LAN_ADDRESS) {
    const result = runInstaller(installer, { NOESAR_BIND_ADDRESS: LAN_ADDRESS });
    const line = runLineOf(result);
    check(Boolean(line) && line.includes(`--publish ${LAN_ADDRESS}:8100:8088`),
      `${installer}: an explicit LAN address must be published verbatim`);
    check(Boolean(line) && /NOESAR_BIND_SCOPE=lan/.test(line),
      `${installer}: a LAN publish must declare the LAN exposure scope`);
    check(Boolean(line) && new RegExp(`NOESAR_ALLOWED_HOSTS=[^ ]*${LAN_ADDRESS.replace(/\./g, '\\.')}`).test(line),
      `${installer}: the published address must be in the Host allowlist`);
    check(Boolean(line) && line.includes(`NOESAR_BIND_ADDRESS=${LAN_ADDRESS}`),
      `${installer}: the published address must be declared to the runtime`);
    check(result.stdout.includes(`http://${LAN_ADDRESS}:8100`),
      `${installer}: the final URL must be printed for the operator`);
  }

  // 3. An address this host does not carry is refused, and nothing is started.
  {
    const result = runInstaller(installer, { NOESAR_BIND_ADDRESS: '10.255.255.254' }, { expectRefusal: true });
    check(result.exitCode !== 0, `${installer}: an address not present on this host must be refused`);
    check(!runLineOf(result), `${installer}: a refused address must not reach docker run`);
  }

  // 4. The wildcard is refused without an explicit override.
  {
    const result = runInstaller(installer, { NOESAR_BIND_ADDRESS: '0.0.0.0' }, { expectRefusal: true });
    check(result.exitCode !== 0, `${installer}: 0.0.0.0 must be refused by default`);
    check(!runLineOf(result), `${installer}: a refused wildcard must not reach docker run`);
  }

  // 5. ...and accepted only when the operator says so in as many words.
  {
    const result = runInstaller(installer, {
      NOESAR_BIND_ADDRESS: '0.0.0.0', NOESAR_ALLOW_PUBLIC_BIND: 'true',
    });
    const line = runLineOf(result);
    check(Boolean(line) && /--publish 0\.0\.0\.0:8100:8088/.test(line),
      `${installer}: 0.0.0.0 must be honoured with NOESAR_ALLOW_PUBLIC_BIND=true`);
    check(Boolean(line) && /NOESAR_BIND_SCOPE=custom/.test(line),
      `${installer}: a wildcard publish must not be declared loopback`);
  }

  // 6. The choice survives a second run with nothing in the environment — which is
  //    what an update or a reinstall looks like.
  if (LAN_ADDRESS) {
    const persistRoot = mkdtempSync(join(tmpdir(), 'noesar-persist-'));
    ownedDirs.push(persistRoot);
    const workspace = join(persistRoot, 'workspace');
    mkdirSync(workspace, { recursive: true });
    runInstaller(installer, { NOESAR_BIND_ADDRESS: LAN_ADDRESS }, { workspace });
    check(existsSync(join(workspace, 'config/network-access.json')),
      `${installer}: the access choice must be persisted in the workspace`);
    const second = runInstaller(installer, {}, { workspace });
    const line = runLineOf(second);
    check(Boolean(line) && line.includes(`--publish ${LAN_ADDRESS}:8100:8088`),
      `${installer}: a reinstall with no environment must keep the remembered address`);
    check(Boolean(line) && /NOESAR_BIND_SCOPE=lan/.test(line),
      `${installer}: a remembered LAN choice must keep the LAN exposure scope`);
  }

  // 7. Readiness must be probed on the address actually published, not on loopback.
  if (LAN_ADDRESS && installer !== 'deployment/docker/run.sh') {
    const result = runInstaller(installer, { NOESAR_BIND_ADDRESS: LAN_ADDRESS });
    check(result.curlLines.some((entry) => entry.includes(`http://${LAN_ADDRESS}:8100/healthz`)),
      `${installer}: the readiness probe must target the published address`);
    check(!result.curlLines.some((entry) => entry.includes('http://127.0.0.1:8100/healthz')),
      `${installer}: the readiness probe must not silently fall back to loopback`);
  }
}

if (!LAN_ADDRESS) {
  console.log('  SKIPPED: no private non-virtual IPv4 address on this host; LAN scenarios not exercised');
}

console.log(`\n${checks - failures}/${checks} checks passed`);
if (failures) {
  console.log('INSTALLER_HARDENING: FAIL');
  process.exit(1);
}
console.log('INSTALLER_HARDENING: PASS');
