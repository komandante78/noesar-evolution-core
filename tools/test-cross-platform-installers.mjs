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
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync, existsSync, statSync, symlinkSync, realpathSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// F-TMP-002 (2026-08-15): `sandbox()` below runs once per platform/scenario — tracked here
// and swept on exit, the process-level equivalent of `test/support/workspace.mjs`'s
// `after()` for a plain script.
const ownedDirs = [];
process.on('exit', () => { for (const dir of ownedDirs) rmSync(dir, { recursive: true, force: true }); });

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
  ownedDirs.push(root);
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

  // The session, in one word. This block exists because every check above it was green
  // while a from-source installation had NO `coden_evolution` at all: the word worked on a
  // container installation and simply did not exist here, and nothing said so. Checking
  // "the server was installed" cannot report "the way in was not".
  const sessionLauncher = describe === 'linux'
    ? join(home, 'bin', 'coden_evolution')
    : join(destination, 'coden_evolution');
  check(existsSync(sessionLauncher), `${script}: coden_evolution must be installed`);
  if (existsSync(sessionLauncher)) {
    const sessionMode = statSync(sessionLauncher).mode & 0o777;
    check(sessionMode === 0o755, `${script}: coden_evolution must be 0755, is 0${sessionMode.toString(8)}`);

    let sessionSyntaxOk = true;
    try { execFileSync('sh', ['-n', sessionLauncher], { stdio: 'pipe' }); } catch { sessionSyntaxOk = false; }
    check(sessionSyntaxOk, `${script}: coden_evolution must be valid shell`);

    const sessionBody = readFileSync(sessionLauncher, 'utf8');
    check(/NOESAR_WORKSPACE="/.test(sessionBody),
      `${script}: coden_evolution must quote NOESAR_WORKSPACE`);

    // It must point at a launcher that is really there. A wrapper exec'ing a missing file
    // is the exact shape of phase 5's defect: a word that exists and cannot work.
    const sessionTarget = sessionBody.match(/exec "([^"]+)"/)?.[1];
    check(Boolean(sessionTarget) && existsSync(sessionTarget),
      `${script}: coden_evolution must point at a file that exists (${sessionTarget ?? 'no target parsed'})`);

    // And the terminal client the launcher's first rung needs must have come with it —
    // the file that was missing from the image for the whole of phase 5.
    check(existsSync(join(appRoot, 'tools', 'tui-client.mjs')),
      `${script}: the terminal client must be installed beside the launcher`);

    // Run it for real, against a workspace with no socket in it and a PATH with no
    // container engine on it: it must REPORT no session (the launcher's exit 3), never
    // die as a broken script. `run()` is deliberately not used here — it resolves paths
    // against the repository root, and this file is installed outside it.
    // The PATH is an EMPTY directory, not the host's. Measured the hard way: with
    // /usr/bin on it this probe found the real `docker`, found the real installation by
    // label, attached to it, and sat waiting on stdin until the suite timed out. A test
    // that reaches the live installation is not testing the installer.
    // It holds exactly one program: `sh`, because `#!/usr/bin/env sh` resolves through
    // PATH and a genuinely empty one makes the kernel fail the shebang — which looks like
    // a broken launcher and is really a broken test.
    const enginelessPath = join(root, 'no-engine-here');
    mkdirSync(enginelessPath, { recursive: true });
    symlinkSync(realpathSync('/bin/sh'), join(enginelessPath, 'sh'));

    let probeStatus = 0;
    let probeErr = '';
    try {
      execFileSync(sessionLauncher, [], {
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 20_000,
        env: { PATH: enginelessPath, HOME: home },
      });
    } catch (error) {
      probeStatus = error.status ?? -1;
      probeErr = String(error.stderr ?? '');
    }
    check(probeStatus === 3,
      `${script}: coden_evolution must report "no session" (exit 3), got ${probeStatus}: ${probeErr.trim().slice(0, 160)}`);
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

  // DERIVED, never listed: whatever the control plane imports from outside its own tree must
  // be installed with it. The check below this one runs the other way — it proves every path
  // the installer copies exists — and a check in that direction cannot notice a path the
  // installer never copies. That is how packages/ was missing from every Windows install
  // until someone ran one: ERR_MODULE_NOT_FOUND on
  // packages/verified-acquisition/src/transport.mjs, first start, 2026-08-31.
  //
  // A hand-kept list is what tui-import-closure.test.mjs was written about, and this file
  // cites that test while carrying one. The list below is gone; the imports are followed.
  // The first version of this compared the FIRST SEGMENT of each import ("apps") against the
  // installer text, which mentions apps\webui-static — so "apps" matched while apps/shared was
  // never installed, and the second Windows start died on agent-commands.js. A check that
  // compares a directory name to a path agrees with itself, not with the filesystem.
  //
  // Both sides are paths now: every out-of-tree import as a repo-relative path, and every tree
  // the recipe copies. One must cover the other.
  const planeRoot = 'services/reference-control-plane/src';
  const copies = [...windows.install.matchAll(/Join-Path \$Root "([^"]+)"/g)]
    .map((hit) => hit[1].replace(/\\/g, '/'));
  check(copies.length > 0, 'no copied tree was parsed out of Install-Noesar.ps1 — the parse is broken');
  const needed = new Set();
  for (const name of readdirSync(join(repoRoot, planeRoot), { recursive: true, encoding: 'utf8' })) {
    if (!name.endsWith('.mjs')) continue;
    const here = [planeRoot, dirname(name.replace(/\\/g, '/'))].join('/').replace(/\/\.$/, '');
    for (const hit of readFileSync(join(repoRoot, planeRoot, name), 'utf8')
      .matchAll(/from\s+['"]((?:\.\.\/)+[^'"]+)['"]/g)) {
      const parts = here.split('/');
      let rest = hit[1];
      while (rest.startsWith('../')) { parts.pop(); rest = rest.slice(3); }
      const resolved = [...parts, rest].join('/');
      if (!resolved.startsWith('services/')) needed.add(resolved);
    }
  }
  check(needed.size > 0, 'the out-of-tree import scan found nothing — the scan itself is broken');
  for (const path of [...needed].sort()) {
    check(copies.some((tree) => path === tree || path.startsWith(`${tree}/`)),
      `Install-Noesar.ps1 must carry ${path} — the control plane imports it`);
  }

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

  // This note said the Windows installer had no equivalent of the POSIX installers' pre-copy
  // removal, so a reinstall would nest the tree. It was true when written and FALSE since:
  // `Install-Tree` clears the destination before copying, guarded so it cannot fire outside
  // $NoesarRoot, and its own comment records the nesting bug reproduced on real PowerShell on
  // 2026-07-27 and repaired. The note outlived the repair by more than a month, inside the
  // instrument built to catch exactly that. Asserted now, so the next repair cannot be missed
  // and the next regression cannot be silent.
  check(/Remove-Item -Recurse -Force/.test(windows.install),
    'Install-Noesar.ps1 must clear the destination before copying, or a reinstall nests the tree');
  check(/refusing to install outside/.test(windows.install),
    'that removal must be guarded to a path under the install root');
  note('Uninstall-Noesar.ps1 removes nothing; it prints two advisory lines. Whether that is deliberate caution or an unfinished script is an Owner question.');
  // Was a fixed note, printed on every run whether or not it was still true. It described a
  // real defect (a shipped script citing a report this repository does not carry), the defect
  // was repaired on 2026-08-31, and a note cannot notice that. A check can.
  check(!/BUILD_PREPARATION_V1/.test(windows.start),
    'Start-Noesar.ps1 must not cite a build-preparation report this repository does not contain');
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
