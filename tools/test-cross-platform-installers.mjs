#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// OPS-002 — "cross-platform installation" (acceptance-matrix.yaml, severity blocker).
//
// `tools/test-installer-hardening.mjs` covers four scripts, all of them the Docker/Unraid
// path. `deployment/` also carries linux/, macos/, windows/ and podman/, and none of those
// had ever been executed or tested. This file covers what this host can genuinely execute
// and is explicit about what it cannot.
//
// What this host is: Linux, with docker. There is no macOS, no Windows, no PowerShell and
// no podman here, and CLAUDE10.md rule 45 forbids installing tooling to satisfy a rule. So:
//
//   linux/install-portable.sh    EXECUTED — it is a POSIX sh file-copy installer
//   macos/install-portable.sh    EXECUTED — also POSIX sh; the macOS-specific part is the
//                                destination path, which is exercised (it contains a space)
//   podman/run.sh                EXECUTED against a podman stub, the same technique the
//                                hardening test uses for docker: `bash -n` cannot see a
//                                truncated continuation, and could not see the unbound
//                                variable this found either
//   podman/build.sh              EXECUTED against a stub
//   docker/build.sh              EXECUTED against a stub
//   windows/*.ps1                NOT EXECUTED — no PowerShell on this host. Structural
//                                assertions only, and reported as static, never as passing
//
// Running a script under a stub is not the same as installing on the platform. Nothing
// here should be read as "macOS is verified" or "Podman is verified" — what is verified is
// that the script does what it claims when its external commands are observed.
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

let checks = 0;
let failures = 0;
const staticOnly = [];

function check(condition, message) {
  checks += 1;
  if (condition) return;
  failures += 1;
  console.log(`  FAIL  ${message}`);
}

function note(message) {
  staticOnly.push(message);
}

/**
 * A sandbox with a pinned HOME. The portable installers default BIN_DIR to
 * $HOME/.local/bin and DESTINATION to a path under $HOME, so a test that does not pin
 * HOME writes into the operator's real home directory. That happened once while writing
 * this file, outside PROJECT_ROOT, and had to be cleaned up by hand — the containment is
 * part of the test, not incidental to it.
 */
function sandbox() {
  const root = mkdtempSync(join(tmpdir(), 'noesar-xplat-'));
  const home = join(root, 'home');
  const bin = join(root, 'stubbin');
  mkdirSync(home, { recursive: true });
  mkdirSync(bin, { recursive: true });
  return { root, home, bin };
}

function stubCommand(binDir, name, logPath, body = 'exit 0') {
  const script = `#!/usr/bin/env sh\nprintf '%s\\n' "$*" >> ${logPath}\n${body}\n`;
  writeFileSync(join(binDir, name), script);
  chmodSync(join(binDir, name), 0o755);
}

function run(scriptPath, { args = [], env = {}, home, bin, expectFailure = false }) {
  let stdout = '';
  let stderr = '';
  let exitCode = 0;
  try {
    stdout = execFileSync('sh', [join(repoRoot, scriptPath), ...args], {
      cwd: repoRoot,
      env: {
        ...process.env,
        HOME: home,
        PATH: bin ? `${bin}:${process.env.PATH}` : process.env.PATH,
        XDG_BIN_HOME: join(home, 'bin'),
      },
      stdio: 'pipe',
      timeout: 120_000,
    }).toString();
  } catch (error) {
    exitCode = error.status ?? 1;
    stdout = error.stdout?.toString?.() ?? '';
    stderr = error.stderr?.toString?.() ?? '';
    if (!expectFailure) {
      console.log(`  (${scriptPath} exited ${exitCode}: ${(stderr || stdout).trim().slice(0, 300)})`);
    }
  }
  return { stdout, stderr, exitCode };
}

// ---------------------------------------------------------------------------
console.log('Cross-platform installer regression (OPS-002)\n');
console.log('- deployment/podman/run.sh  [executed against a podman stub]');
// ---------------------------------------------------------------------------
//
// The defect this covers: RELEASE_CHANNEL was referenced as a bare variable and never
// assigned. Under `set -u` the script aborted with "unbound variable" before reaching
// `podman run`, so the Podman installer had never installed anything. It reached
// `podman network inspect` and died, which is why a casual look suggested it "ran".
{
  const { home, bin, root } = sandbox();
  const log = join(root, 'podman.log');
  stubCommand(bin, 'podman', log);
  const result = run('deployment/podman/run.sh', {
    home, bin,
    env: {},
  });

  check(result.exitCode === 0, `podman/run.sh must exit 0, got ${result.exitCode}: ${result.stderr.trim().slice(0, 200)}`);
  check(!/unbound variable/.test(result.stderr), 'podman/run.sh must not abort on an unbound variable');

  const lines = existsSync(log) ? readFileSync(log, 'utf8').split('\n').filter(Boolean) : [];
  const runLine = lines.find((line) => line.startsWith('run '));
  check(Boolean(runLine), 'podman/run.sh must actually reach "podman run"');

  if (runLine) {
    for (const flag of ['--read-only', '--cap-drop', '--security-opt', '--pids-limit', '--memory', '--cpus']) {
      check(runLine.includes(flag), `podman/run.sh: ${flag} must reach podman run`);
    }
    check(/no-new-privileges/.test(runLine), 'podman/run.sh: no-new-privileges must reach podman run');
    check(/--cap-drop ALL/.test(runLine), 'podman/run.sh: capabilities must be dropped');
    check(/127\.0\.0\.1:/.test(runLine), 'podman/run.sh: the port must be published on loopback only');
    check(/NOESAR_RELEASE_CHANNEL=complete|NOESAR_RELEASE_CHANNEL=development/.test(runLine),
      'podman/run.sh: a resolved release channel must reach podman run');
    // The image argument is last: if the command were truncated it would not arrive.
    check(/noesar-evolution/.test(runLine), 'podman/run.sh: the image argument must reach podman run');
  }

  // The channel vocabulary must match deployment/docker/run.sh, or the two platforms
  // disagree about what a valid channel is.
  const rejected = run('deployment/podman/run.sh', {
    home, bin, expectFailure: true,
    env: {},
  });
  void rejected;
}

// An invalid channel must be refused rather than passed through to the container.
{
  const { home, bin, root } = sandbox();
  const log = join(root, 'podman.log');
  stubCommand(bin, 'podman', log);
  let exitCode = 0;
  let stderr = '';
  try {
    execFileSync('sh', [join(repoRoot, 'deployment/podman/run.sh')], {
      cwd: repoRoot,
      env: { ...process.env, HOME: home, PATH: `${bin}:${process.env.PATH}`, NOESAR_RELEASE_CHANNEL: 'not-a-channel' },
      stdio: 'pipe', timeout: 60_000,
    });
  } catch (error) {
    exitCode = error.status ?? 1;
    stderr = error.stderr?.toString?.() ?? '';
  }
  check(exitCode !== 0, 'podman/run.sh must refuse an unsupported release channel');
  check(/Unsupported release channel/.test(stderr), 'podman/run.sh must say why it refused');
  const lines = existsSync(log) ? readFileSync(log, 'utf8').split('\n').filter(Boolean) : [];
  check(!lines.some((line) => line.startsWith('run ')), 'a refused channel must not reach podman run');
}

// ---------------------------------------------------------------------------
console.log('- deployment/{docker,podman}/build.sh  [executed against stubs]');
// ---------------------------------------------------------------------------
for (const [script, engine, containerfile] of [
  ['deployment/docker/build.sh', 'docker', 'oci/Dockerfile'],
  ['deployment/podman/build.sh', 'podman', 'oci/Containerfile'],
]) {
  const { home, bin, root } = sandbox();
  const log = join(root, `${engine}.log`);
  stubCommand(bin, engine, log);
  const result = run(script, { home, bin });
  check(result.exitCode === 0, `${script} must exit 0, got ${result.exitCode}`);
  const lines = existsSync(log) ? readFileSync(log, 'utf8').split('\n').filter(Boolean) : [];
  const buildLine = lines.find((line) => line.startsWith('build '));
  check(Boolean(buildLine), `${script} must reach "${engine} build"`);
  // The build file it names must exist. A build script pointing at a missing file is a
  // platform that cannot be built, and nothing else in the tree would notice.
  check(existsSync(join(repoRoot, containerfile)), `${script}: ${containerfile} must exist`);
  if (buildLine) {
    check(buildLine.includes(containerfile.split('/').at(-1)),
      `${script} must build from ${containerfile}`);
    // Neither engine may reach for the network during a build.
    check(/--pull=false|--pull-never/.test(buildLine), `${script} must not pull during build`);
  }
}

// ---------------------------------------------------------------------------
console.log('- oci/Dockerfile vs oci/Containerfile  [parity of what is enforced]');
// ---------------------------------------------------------------------------
//
// The two build files are maintained separately and had already drifted: the Dockerfile
// healthcheck was corrected to /livez, with a comment explaining that /healthz and
// /readyz report dependency state and would restart a live process whenever a dependency
// was briefly degraded. The Containerfile still used /healthz, so the Podman path carried
// the defect the Docker path had fixed. Parity is asserted rather than assumed.
{
  const dockerfile = readFileSync(join(repoRoot, 'oci/Dockerfile'), 'utf8');
  const containerfile = readFileSync(join(repoRoot, 'oci/Containerfile'), 'utf8');

  const healthEndpoint = (text) => {
    const match = text.match(/HEALTHCHECK[\s\S]*?8088(\/[a-z]+)/);
    return match ? match[1] : null;
  };
  check(healthEndpoint(dockerfile) === '/livez', 'oci/Dockerfile must health-check /livez');
  check(healthEndpoint(containerfile) === '/livez',
    'oci/Containerfile must health-check /livez, not a readiness endpoint');
  check(healthEndpoint(dockerfile) === healthEndpoint(containerfile),
    'the Docker and Podman build files must agree on the healthcheck endpoint');

  for (const directive of ['USER 10001:10001', 'EXPOSE 8088']) {
    check(dockerfile.includes(directive), `oci/Dockerfile must declare ${directive}`);
    check(containerfile.includes(directive), `oci/Containerfile must declare ${directive}`);
  }
}

// ---------------------------------------------------------------------------
console.log('- deployment/linux/install-portable.sh  [executed for real]');
console.log('- deployment/macos/install-portable.sh  [executed for real]');
// ---------------------------------------------------------------------------
for (const [script, describe] of [
  ['deployment/linux/install-portable.sh', 'linux'],
  ['deployment/macos/install-portable.sh', 'macos'],
]) {
  const { home, root } = sandbox();
  const destination = describe === 'linux'
    ? join(root, 'dest')
    // The macOS default lives under "Application Support" — a path with a space in it,
    // which is the thing most likely to break a shell installer. Exercise it explicitly.
    : join(root, 'Library', 'Application Support', 'NOESAR Evolution');

  const first = run(script, { args: [destination], home });
  check(first.exitCode === 0, `${script} must exit 0, got ${first.exitCode}`);

  const appRoot = join(destination, 'noesar');
  const server = join(appRoot, 'services/reference-control-plane/src/server.mjs');
  check(existsSync(server), `${script}: the server entrypoint must be installed`);
  check(existsSync(join(appRoot, 'apps/webui-static/index.html')), `${script}: the WebUI must be installed`);
  check(existsSync(join(appRoot, 'package.json')), `${script}: package.json must be installed`);

  // The destination must not be world-readable: it will hold the workspace.
  const mode = statSync(destination).mode & 0o777;
  check(mode === 0o700, `${script}: the destination must be 0700, is 0${mode.toString(8)}`);

  // The launcher must exist, be executable, and point at something that is really there.
  const launcher = describe === 'linux'
    ? join(home, 'bin', 'noesar-evolution')
    : join(destination, 'portable-start.sh');
  check(existsSync(launcher), `${script}: the launcher must be written`);
  if (existsSync(launcher)) {
    const launcherMode = statSync(launcher).mode & 0o777;
    check(launcherMode === 0o755, `${script}: the launcher must be 0755, is 0${launcherMode.toString(8)}`);
    const body = readFileSync(launcher, 'utf8');
    // A launcher that is not valid shell is a launcher that never starts the product.
    let syntaxOk = true;
    try { execFileSync('sh', ['-n', launcher], { stdio: 'pipe' }); } catch { syntaxOk = false; }
    check(syntaxOk, `${script}: the launcher must be valid shell`);
    // Every path it exports must be quoted, or a destination containing a space — which
    // is the macOS default — silently splits into separate words.
    check(/NOESAR_RUNTIME_ROOT="/.test(body), `${script}: the launcher must quote NOESAR_RUNTIME_ROOT`);
    check(/NOESAR_WORKSPACE="/.test(body), `${script}: the launcher must quote NOESAR_WORKSPACE`);
    const target = body.match(/exec node "([^"]+)"/)?.[1];
    check(Boolean(target) && existsSync(target),
      `${script}: the launcher must point at a file that exists (${target ?? 'no target parsed'})`);
  }

  // Reinstalling over a live installation must not destroy the operator's data. Both
  // scripts rm -rf only the application tree, and the workspace sits beside it.
  const workspace = join(destination, 'workspace');
  mkdirSync(workspace, { recursive: true });
  writeFileSync(join(workspace, 'operator-data.txt'), 'must survive a reinstall');
  const second = run(script, { args: [destination], home });
  check(second.exitCode === 0, `${script}: a reinstall must exit 0, got ${second.exitCode}`);
  check(existsSync(join(workspace, 'operator-data.txt')),
    `${script}: a reinstall must not destroy the workspace`);
  check(existsSync(server), `${script}: a reinstall must leave a complete application tree`);
  // The classic re-copy trap: the tree must not nest itself on the second run.
  check(!existsSync(join(appRoot, 'services/reference-control-plane/reference-control-plane')),
    `${script}: a reinstall must not nest the copied tree inside itself`);
}

// ---------------------------------------------------------------------------
console.log('- deployment/windows/*.ps1  [STATIC ONLY — no PowerShell on this host]');
// ---------------------------------------------------------------------------
//
// These assertions are structural. They cannot prove the scripts run, and this file does
// not claim they do. What they catch is drift between the Windows path and the platforms
// that are executed — a Windows script referring to a file the repository does not ship,
// or disagreeing with every other platform about a value.
{
  const windows = {
    install: readFileSync(join(repoRoot, 'deployment/windows/Install-Noesar.ps1'), 'utf8'),
    start: readFileSync(join(repoRoot, 'deployment/windows/Start-Noesar.ps1'), 'utf8'),
    test: readFileSync(join(repoRoot, 'deployment/windows/Test-Noesar.ps1'), 'utf8'),
  };

  // Every repository path a Windows script copies must actually exist here.
  for (const relative of ['package.json', 'services/reference-control-plane', 'apps/webui-static',
    'deployment/windows/Start-Noesar.ps1']) {
    check(existsSync(join(repoRoot, relative)),
      `Install-Noesar.ps1 copies ${relative}, which must exist in the repository`);
  }

  // The launcher must start the same entrypoint the executed platforms start.
  check(/services\\reference-control-plane\\src\\server\.mjs/.test(windows.start),
    'Start-Noesar.ps1 must start the same server entrypoint as every other platform');

  // Loopback only, like every other platform's default.
  check(/NOESAR_HOST\s*=\s*"127\.0\.0\.1"/.test(windows.start),
    'Start-Noesar.ps1 must bind loopback by default');

  // The channel it sets must be one the Docker/Podman scripts would accept, or the
  // platforms disagree about the product they are running.
  const channel = windows.start.match(/NOESAR_RELEASE_CHANNEL\s*=\s*"([^"]+)"/)?.[1];
  check(['complete', 'development'].includes(channel),
    `Start-Noesar.ps1 sets release channel "${channel}", which must be one the other platforms accept`);
  if (channel !== 'complete') {
    note(`Start-Noesar.ps1 sets NOESAR_RELEASE_CHANNEL="${channel}" while docker/run.sh, install-unraid.sh and unraid/install-complete.sh all use "complete". Valid, but Windows runs a different channel from every other platform.`);
  }

  // Test-Noesar.ps1 asserts on a response shape; the shape must be the one the product
  // actually serves. Verified against the running installation: /healthz carries
  // status:"healthy" and local:true.
  check(/healthz/.test(windows.test), 'Test-Noesar.ps1 must probe a health endpoint');
  check(/\$result\.local/.test(windows.test) && /status -ne "healthy"/.test(windows.test),
    'Test-Noesar.ps1 must assert the fields /healthz really returns');

  note('Install-Noesar.ps1 has no equivalent of the `rm -rf "$DESTINATION/noesar"` that the Linux and macOS installers perform before copying. PowerShell Copy-Item -Recurse into an EXISTING destination directory copies the source INTO it rather than over it, so a reinstall or upgrade is expected to nest the tree. NOT REPRODUCED — there is no PowerShell on this host — and therefore not repaired here rather than repaired blind.');
  note('Uninstall-Noesar.ps1 removes nothing; it prints two advisory lines. Whether that is deliberate caution or an unfinished script is an Owner question.');
  note('Start-Noesar.ps1 carries a NOTE referencing REPORTS/BUILD_PREPARATION_V1/03_PATH_DECISIONS.tsv, which this repository does not contain — a dangling reference in a shipped script.');
  note('No Windows, macOS or Podman installation was performed. OPS-002 cannot be closed from this host: what is verified is script behaviour under observed external commands, not installation on the platform.');
}

// ---------------------------------------------------------------------------
console.log('');
for (const item of staticOnly) console.log(`  NOTE  ${item}`);
console.log('');
console.log(`CROSS_PLATFORM_CHECKS=${checks}`);
console.log(`CROSS_PLATFORM_FAILURES=${failures}`);
console.log(`CROSS_PLATFORM_STATIC_ONLY_NOTES=${staticOnly.length}`);
console.log('CROSS_PLATFORM_PLATFORMS_EXECUTED=linux,macos(sh),podman(stub),docker(stub)');
console.log('CROSS_PLATFORM_PLATFORMS_NOT_EXECUTED=windows');
process.exit(failures === 0 ? 0 : 1);
