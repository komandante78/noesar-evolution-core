// SPDX-License-Identifier: AGPL-3.0-or-later
//
// CE-031, CE-032, CE-035 — the access gesture is one word, and it presumes nothing.
//
// Phase 8 of MASTER_PROJECT/17. What it is measuring against, recorded on the live
// installation on 2026-08-07 before a line of the launcher existed: both sockets are
// `srw-------` on the container's own /run tmpfs, so nothing on the host points at them,
// and reaching the session needed three concepts at once — permission to talk to the
// container engine, the container's name, and the client's path inside it.
//
// HOW THIS FILE TESTS. Every rung is EXECUTED, against stub programs on a synthetic PATH.
// It is not read, and it is not asserted from the source text. `sh -n` cannot see a rung
// that resolves the wrong variable, and this repository has already paid for guards that a
// comment could satisfy (s322) and for a suite that asserted a broken literal as though it
// were the requirement (D-0339). A stub records the argv it was invoked with; the argv is
// the assertion.
//
// WHAT IS NOT EXECUTED, said here rather than left to be discovered: `tools/coden-evolution.ps1`.
// There is no PowerShell on this host — measured, and rule 45 forbids installing one — so
// the Windows twin is covered by structural assertions with comments stripped, and is
// reported as STATIC, never as passing. `test-cross-platform-installers.mjs` established
// that split for `deployment/windows/`; this follows it. A Windows installation's declared
// verification level is UNVERIFIED until someone runs it on a real Windows host.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, existsSync, statSync, symlinkSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const launcher = join(repoRoot, 'tools', 'coden-evolution');
const windowsLauncher = join(repoRoot, 'tools', 'coden-evolution.ps1');

// The label the launcher discovers the installation by. Written once here and asserted
// against BOTH launchers and the running product's own image, so a rename cannot leave the
// discovery pointing at a label nothing carries.
const DISCOVERY_LABEL = 'label=org.noesar.authority=reference-node';

let sandbox;
before(() => { sandbox = mkdtempSync(join(tmpdir(), 'noesar-launcher-')); });
after(() => { rmSync(sandbox, { recursive: true, force: true }); });

let caseCounter = 0;

/**
 * A stub program on a synthetic PATH. It appends its own argv, one invocation per line, to
 * a log the test then asserts on — so "what did the launcher actually run" is a fact rather
 * than a reading of the source.
 */
function makeStub(binDir, name, body) {
  const logPath = join(binDir, `${name}.log`);
  writeFileSync(join(binDir, name), `#!/bin/sh\nprintf '%s\\n' "$*" >> '${logPath}'\n${body}\n`);
  chmodSync(join(binDir, name), 0o755);
  return logPath;
}

function readLog(logPath) {
  if (!existsSync(logPath)) return [];
  return readFileSync(logPath, 'utf8').split('\n').filter(Boolean);
}

/**
 * Build an isolated world for one case: its own PATH, its own launcher copy (so the
 * `<launcher dir>/tui-client.mjs` lookup is exercised for real rather than stubbed), and
 * stubs for every command that would modify the host. Those never get to be called.
 */
function world({ engines = {}, withClient = true, withNode = true, conf = null, shipRemoteLauncher = false } = {}) {
  const dir = join(sandbox, `case-${++caseCounter}`);
  const bin = join(dir, 'bin');
  const tools = join(dir, 'tools');
  mkdirSync(bin, { recursive: true });
  mkdirSync(tools, { recursive: true });

  // The launcher is copied, not symlinked: `$0`-relative resolution of the client is part of
  // what is under test, and a symlink would resolve back to the repository and hide a bug.
  writeFileSync(join(tools, 'coden-evolution'), readFileSync(launcher));
  chmodSync(join(tools, 'coden-evolution'), 0o755);
  if (withClient) writeFileSync(join(tools, 'tui-client.mjs'), '// stand-in for the shell\n');

  // A hermetic PATH. The first version of this file put the stub directory in FRONT of
  // /usr/bin, and three cases went green for the wrong reason: the real docker on this host
  // answered, found the real installation, and exec'd into it. A synthetic world that can
  // see the machine it runs on is not a synthetic world. So PATH is the stub directory and
  // nothing else, and the two programs the launcher genuinely needs from the system are
  // linked into it by name — which also pins the dependency list at exactly three, one of
  // which (`readlink`) the launcher only reaches for when its own path is a symlink and
  // degrades without.
  for (const required of ['sh', 'cat', 'readlink']) {
    const found = spawnSync('sh', ['-c', `command -v ${required}`], { encoding: 'utf8' }).stdout.trim();
    assert.ok(found, `this host has no '${required}', which the launcher needs`);
    symlinkSync(found, join(bin, required));
  }

  const logs = {};
  if (withNode) logs.node = makeStub(bin, 'node', 'exit 0');
  for (const [name, spec] of Object.entries(engines)) {
    logs[name] = makeStub(bin, name, [
      'case "$1" in',
      `  version) exit ${spec.answers ? 0 : 1} ;;`,
      `  ps) ${spec.names ? spec.names.map((n) => `printf '${n}\\n'`).join('; ') : 'true'} ;;`,
      '  exec) exit 0 ;;',
      'esac',
    ].join('\n'));
  }
  logs.sudo = makeStub(bin, 'sudo', 'shift; exec "$@"');

  // The host-mutating commands. The launcher must never invoke any of these, in any rung.
  // Asserted behaviourally rather than by grepping the source, because the source
  // legitimately NAMES them in the comment that explains why it must not run them.
  const forbidden = ['usermod', 'groupadd', 'gpasswd', 'systemctl', 'sshd', 'ssh-keygen', 'chown', 'visudo'];
  for (const name of forbidden) logs[name] = makeStub(bin, name, 'exit 0');

  const confPath = join(dir, 'launcher.conf');
  if (conf !== null) writeFileSync(confPath, conf);

  if (shipRemoteLauncher) mkdirSync(join(dir, 'opt'), { recursive: true });

  return { dir, bin, tools, logs, confPath, forbidden };
}

function run(w, { args = [], env = {}, tty = false } = {}) {
  const result = spawnSync(join(w.tools, 'coden-evolution'), args, {
    env: {
      PATH: w.bin,
      NOESAR_EVOLUTION_LAUNCHER_CONF: w.confPath,
      ...env,
    },
    encoding: 'utf8',
    // Never inherit: an inherited stdin here would make `[ -t 0 ]` depend on how the suite
    // was launched, which is exactly the kind of hidden coupling that made the fullscreen
    // views only start when stdin happened to be a pipe (D-0319).
    stdio: ['pipe', 'pipe', 'pipe'],
    input: tty ? undefined : '',
  });
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

function assertHostUntouched(w) {
  for (const name of w.forbidden) {
    assert.deepEqual(readLog(w.logs[name]), [], `the launcher invoked '${name}' — it must never modify the host`);
  }
}

describe('CE-035 — the gesture is one word', () => {
  test('the launcher is executable, so the recipe can put it on PATH unchanged', () => {
    assert.equal(statSync(launcher).mode & 0o111, 0o111, 'tools/coden-evolution must carry the executable bit');
  });

  // The property, not the sentence. This used to assert the literal words "takes no arguments
  // on purpose", and `D-0348` had to add two — `--forget` and `--no-remember`, the undo of
  // being remembered. Asserting the message pinned a design instead of a behaviour, so it went
  // red against a product that was still correct. What must hold is narrower and does not
  // change: the two concepts this launcher exists to remove — a client PATH and a container
  // NAME — are refused, not quietly accepted.
  test('a path or a container name is refused, not ignored', () => {
    const w = world({ engines: { docker: { answers: true, names: ['noesar-evolution'] } } });
    for (const argument of ['/opt/noesar/tools/tui-client.mjs', 'noesar-evolution', '--socket=/run/x.sock']) {
      const refused = run(w, { args: [argument] });
      assert.equal(refused.status, 2, `'${argument}' was not refused`);
      // Refused means refused: it must not have gone on to attach anyway.
      assert.deepEqual(readLog(w.logs.docker), [], `'${argument}' was refused but the engine was called anyway`);
    }
    assertHostUntouched(w);
  });

  test('--help names every word the launcher accepts, and there are no others', () => {
    const w = world();
    const help = run(w, { args: ['--help'] });
    assert.equal(help.status, 0);
    // Derived from the launcher's own argument parser rather than retyped here. A flag added
    // to that `case` without a line in the usage text is a word the product accepts and never
    // tells anyone about — the shape of defect that left `remote-targets` unreachable for
    // three months behind two green guards (s331).
    const accepted = [...readFileSync(launcher, 'utf8').matchAll(/^\s+(--[a-z|-]+)\)/gm)]
      .flatMap((match) => match[1].split('|'))
      .filter((flag) => flag !== '--help');
    assert.ok(accepted.length > 0, 'the parser accepts no flags at all — this guard would be measuring nothing');
    for (const flag of accepted) {
      assert.ok(help.stderr.includes(flag), `${flag} is accepted by the launcher but absent from --help`);
    }
  });

  test('with zero arguments it finds the container by LABEL — the name is never typed', () => {
    const w = world({ engines: { docker: { answers: true, names: ['some-name-nobody-memorised'] } } });
    const attached = run(w);
    assert.equal(attached.status, 0);

    const invocations = readLog(w.logs.docker);
    const ps = invocations.find((line) => line.startsWith('ps '));
    assert.ok(ps, 'the launcher must ask the engine which container is the installation');
    assert.match(ps, new RegExp(DISCOVERY_LABEL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.match(ps, /status=running/);

    // And the name it exec'd into is the one the engine reported, not one baked in.
    const exec = invocations.find((line) => line.startsWith('exec '));
    assert.match(exec, /some-name-nobody-memorised/);
    assert.doesNotMatch(exec, /noesar-evolution\b/, 'the container name must not be hard-coded in the launcher');
    assertHostUntouched(w);
  });
});

describe('CE-031 — reachable without being an administrator of the host', () => {
  test('with no configuration the launcher never elevates by itself', () => {
    const w = world({ engines: { docker: { answers: true, names: ['noesar-evolution'] } } });
    assert.equal(run(w).status, 0);
    assert.deepEqual(readLog(w.logs.sudo), [], 'the launcher elevated without being configured to');
    assertHostUntouched(w);
  });

  test('elevate=sudo produces ONE fixed argv — the shape a sudoers rule can pin with no wildcard', () => {
    // This is the whole answer to trap 2 of `16` §4.3: the dedicated user is not put in the
    // engine's group, so the one narrow elevation is a sudoers rule. A rule can only be
    // written without a wildcard if the argv is fully determined by the installation, which
    // is why engine and container are read from the root-owned configuration here.
    const conf = 'engine=docker\ncontainer=noesar-evolution\nelevate=sudo\n';
    const first = world({ engines: { docker: { answers: true } }, conf });
    const second = world({ engines: { docker: { answers: true } }, conf });

    assert.equal(run(first).status, 0);
    assert.equal(run(second).status, 0);

    const argvOf = (w) => readLog(w.logs.sudo).find((line) => line.includes('exec'));
    const a = argvOf(first);
    const b = argvOf(second);
    assert.ok(a, 'elevate=sudo did not go through sudo');
    assert.equal(
      a.replace(first.bin, ''),
      b.replace(second.bin, ''),
      'two runs of the same configuration produced different argv — a sudoers rule could not pin it',
    );
    assert.match(a, /^-n /, 'sudo must be non-interactive: a forced command has nobody to prompt');
    assert.match(a, /exec -i noesar-evolution \/opt\/noesar\/tools\/coden-evolution$/);
    // No wildcard needed anywhere in that line.
    assert.doesNotMatch(a, /[*?]/);
    assertHostUntouched(first);
  });

  test('elevate=sudo with no sudo present fails clearly instead of silently running unelevated', () => {
    const w = world({ engines: { docker: { answers: true } }, conf: 'elevate=sudo\n' });
    rmSync(join(w.bin, 'sudo'));
    const result = run(w);
    assert.equal(result.status, 3);
    assert.match(result.stderr, /no 'sudo' is on PATH/);
  });

  test('an unknown elevate= value is refused, not treated as none', () => {
    const w = world({ engines: { docker: { answers: true } }, conf: 'elevate=doas\n' });
    const result = run(w);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /unknown elevate='doas'/);
  });

  test('the configuration file is read, never sourced: a command in it does not run', () => {
    // A launcher that dot-sources its config gives the config file the authority of the ssh
    // account. This asserts the opposite by putting a command in the file and proving the
    // stub it would have called was never invoked.
    const w = world({
      engines: { docker: { answers: true, names: ['noesar-evolution'] } },
      conf: 'container=noesar-evolution\nusermod -aG docker coden\n$(groupadd wheel)\n',
    });
    assert.equal(run(w).status, 0);
    assertHostUntouched(w);
  });
});

describe('CE-032 — presumes no operating system, no engine, no daemon, no path', () => {
  test('no engine anywhere: it declares what it tried and exits non-zero, never a stack trace', () => {
    const w = world();
    const result = run(w);
    assert.equal(result.status, 3);
    assert.match(result.stderr, /no session found/);
    assert.match(result.stderr, /socket: none of the candidate paths/);
    for (const engine of ['docker', 'podman', 'nerdctl']) {
      assert.match(result.stderr, new RegExp(`engine: '${engine}' is not on PATH`));
    }
    assert.match(result.stderr, /08_INSTALLAZIONE\.md/);
    assert.doesNotMatch(result.stderr, /line \d+|not found\b/i);
    assertHostUntouched(w);
  });

  test('an engine that is installed but does not answer is skipped, and the next one is used', () => {
    // Being on PATH is not being available: a `docker` shim on a host whose daemon is gone
    // is common, and treating it as present turns a clear failure into a confusing one.
    const w = world({
      engines: {
        docker: { answers: false },
        podman: { answers: true, names: ['noesar-evolution'] },
      },
    });
    const result = run(w);
    assert.equal(result.status, 0);
    assert.deepEqual(readLog(w.logs.docker), ['version'], 'docker should have been asked once and dropped');
    assert.ok(readLog(w.logs.podman).some((line) => line.startsWith('exec ')));
    assert.match(result.stderr, /attaching via .*podman/);
  });

  test('the engine can be named by the installation, and then no other is probed', () => {
    const w = world({
      engines: { docker: { answers: true, names: ['wrong'] }, nerdctl: { answers: true, names: ['right'] } },
      conf: 'engine=nerdctl\n',
    });
    assert.equal(run(w).status, 0);
    assert.deepEqual(readLog(w.logs.docker), [], 'a configured engine must not be second-guessed');
    assert.ok(readLog(w.logs.nerdctl).some((line) => line.includes('right')));
  });

  test('a live socket wins over the engine, and the client is reached with it', async () => {
    const w = world({ engines: { docker: { answers: true, names: ['noesar-evolution'] } } });
    const socketPath = join(w.dir, 'tui.sock');
    const server = createServer(() => {});
    await new Promise((done) => server.listen(socketPath, done));
    try {
      const result = run(w, { env: { NOESAR_TUI_SOCKET_PATH: socketPath } });
      assert.equal(result.status, 0);
      assert.match(result.stderr, /attaching via socket/);
      assert.deepEqual(readLog(w.logs.docker), [], 'the engine must not be touched when the socket is reachable');
      const nodeArgv = readLog(w.logs.node);
      assert.equal(nodeArgv.length, 1);
      assert.equal(nodeArgv[0], `${join(w.tools, 'tui-client.mjs')} ${socketPath}`);
    } finally {
      server.close();
    }
  });

  test('invoked through a symlink, it still finds the client beside the REAL file', async () => {
    // Regression for the defect this phase found by running the launcher inside a container
    // rather than by reading it. The image installs /usr/local/bin/coden_evolution as a
    // symlink so the one word works in there too; resolving `$0` at face value then looked
    // for the client next to the LINK and declared it missing — phase 5's failure again,
    // reached from the opposite direction, and green in every test that invoked the file
    // directly. Which every test here did.
    const w = world();
    const elsewhere = join(w.dir, 'usr-local-bin');
    mkdirSync(elsewhere, { recursive: true });
    symlinkSync(join(w.tools, 'coden-evolution'), join(elsewhere, 'coden_evolution'));

    const socketPath = join(w.dir, 'tui.sock');
    const server = createServer(() => {});
    await new Promise((done) => server.listen(socketPath, done));
    try {
      const result = spawnSync(join(elsewhere, 'coden_evolution'), [], {
        env: { PATH: w.bin, NOESAR_EVOLUTION_LAUNCHER_CONF: w.confPath, NOESAR_TUI_SOCKET_PATH: socketPath },
        encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], input: '',
      });
      assert.equal(result.status, 0, result.stderr);
      assert.equal(readLog(w.logs.node)[0], `${join(w.tools, 'tui-client.mjs')} ${socketPath}`);
    } finally {
      server.close();
    }
  });

  test('a bare argv[0] never reaches the launcher: the kernel substitutes the exec path', async () => {
    // This case exists because a mutation deleting a `command -v "$0"` branch SURVIVED, and
    // the measurement said the branch was unreachable rather than untested: for a `#!` script
    // the kernel discards the caller's argv[0] and hands the interpreter the path it was
    // exec'd with. So the launcher is driven here with argv[0] forced to a bare word, and
    // still resolves itself correctly — which is the proof that the deleted branch could
    // never have run. (A non-shebang binary behaves the opposite way and keeps the forced
    // name; that contrast is what made this conclusive rather than plausible.)
    const w = world();
    const socketPath = join(w.dir, 'tui.sock');
    const server = createServer(() => {});
    await new Promise((done) => server.listen(socketPath, done));
    try {
      const result = spawnSync(join(w.tools, 'coden-evolution'), [], {
        argv0: 'coden_evolution',
        // A working directory that holds no client at all, so a launcher falling back to `.`
        // reports it missing instead of finding it.
        cwd: w.dir,
        env: { PATH: `${w.bin}:${w.tools}`, NOESAR_EVOLUTION_LAUNCHER_CONF: w.confPath, NOESAR_TUI_SOCKET_PATH: socketPath },
        encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], input: '',
      });
      assert.equal(result.status, 0, result.stderr);
      assert.equal(readLog(w.logs.node)[0], `${join(w.tools, 'tui-client.mjs')} ${socketPath}`);
    } finally {
      server.close();
    }
  });

  test('a symlink cycle never reaches the launcher at all — why the hop limit is unreachable', () => {
    // Written after a mutation removing the hop limit SURVIVED, and the honest answer turned
    // out not to be "add a test": the kernel resolves the symlink chain before it execs
    // anything, so a looping path fails with ELOOP and the launcher is never entered. The
    // guard is therefore unreachable by construction on any path that got as far as running.
    // It stays — it costs one comparison and covers a resolution that does not start from an
    // exec'd path, should one ever be added — but it is recorded as unreachable rather than
    // reported as covered. This case pins the REASON, so the next person to see that mutation
    // survive does not spend the afternoon rediscovering it.
    const w = world();
    const a = join(w.dir, 'link-a');
    const b = join(w.dir, 'link-b');
    symlinkSync(b, a);
    symlinkSync(a, b);
    const result = spawnSync(a, [], {
      env: { PATH: w.bin, NOESAR_EVOLUTION_LAUNCHER_CONF: w.confPath },
      encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], input: '', timeout: 10_000,
    });
    assert.notEqual(result.signal, 'SIGTERM', 'a looping path must fail fast, never hang');
    assert.equal(result.status, null, 'the process must not have started at all');
    assert.equal(result.error?.code, 'ELOOP');
  });

  test('with no client beside it, the product\'s own declared runtime root is used', async () => {
    // Not a hard-coded path: NOESAR_RUNTIME_ROOT is the variable the image sets for itself,
    // so an installation that repackages /opt/noesar moves this with it, and one that does
    // not set it never reaches the line.
    const w = world({ withClient: false });
    const runtimeRoot = join(w.dir, 'runtime-root');
    mkdirSync(join(runtimeRoot, 'tools'), { recursive: true });
    writeFileSync(join(runtimeRoot, 'tools', 'tui-client.mjs'), '// stand-in\n');
    const socketPath = join(w.dir, 'tui.sock');
    const server = createServer(() => {});
    await new Promise((done) => server.listen(socketPath, done));
    try {
      const result = run(w, { env: { NOESAR_TUI_SOCKET_PATH: socketPath, NOESAR_RUNTIME_ROOT: runtimeRoot } });
      assert.equal(result.status, 0, result.stderr);
      assert.equal(readLog(w.logs.node)[0], `${join(runtimeRoot, 'tools', 'tui-client.mjs')} ${socketPath}`);
    } finally {
      server.close();
    }
  });

  test('a socket path containing a space still attaches', async () => {
    // Not hypothetical: this repository already carries a cross-platform installer test
    // because the macOS destination path has a space in it. A candidate list split on
    // whitespace would work on every host but that one.
    const w = world();
    const spaced = join(w.dir, 'Application Support');
    mkdirSync(spaced, { recursive: true });
    const socketPath = join(spaced, 'tui.sock');
    const server = createServer(() => {});
    await new Promise((done) => server.listen(socketPath, done));
    try {
      const result = run(w, { env: { NOESAR_TUI_SOCKET_PATH: socketPath } });
      assert.equal(result.status, 0, result.stderr);
      assert.equal(readLog(w.logs.node)[0], `${join(w.tools, 'tui-client.mjs')} ${socketPath}`);
    } finally {
      server.close();
    }
  });

  test('a socket with no client beside it says so — the phase-5 failure, refused loudly', async () => {
    const w = world({ withClient: false });
    const socketPath = join(w.dir, 'tui.sock');
    const server = createServer(() => {});
    await new Promise((done) => server.listen(socketPath, done));
    try {
      const result = run(w, { env: { NOESAR_TUI_SOCKET_PATH: socketPath } });
      assert.equal(result.status, 3);
      assert.match(result.stderr, /the client is missing/);
    } finally {
      server.close();
    }
  });

  test('a socket with no node to reach it says so rather than failing at a shebang', async () => {
    const w = world({ withNode: false });
    const socketPath = join(w.dir, 'tui.sock');
    const server = createServer(() => {});
    await new Promise((done) => server.listen(socketPath, done));
    try {
      const result = run(w, { env: { NOESAR_TUI_SOCKET_PATH: socketPath } });
      assert.equal(result.status, 3);
      assert.match(result.stderr, /no 'node' on PATH/);
    } finally {
      server.close();
    }
  });

  test('a regular file at the socket path is not mistaken for a session', () => {
    const w = world({ engines: { docker: { answers: true, names: ['noesar-evolution'] } } });
    const notASocket = join(w.dir, 'tui.sock');
    writeFileSync(notASocket, '');
    const result = run(w, { env: { NOESAR_TUI_SOCKET_PATH: notASocket } });
    assert.equal(result.status, 0);
    assert.deepEqual(readLog(w.logs.node), [], 'a plain file was handed to the client as if it were a socket');
    assert.ok(readLog(w.logs.docker).some((line) => line.startsWith('exec ')));
  });

  test('two running installations are named, not guessed between', () => {
    const w = world({ engines: { docker: { answers: true, names: ['noesar-evolution', 'noesar-evolution-staging'] } } });
    const result = run(w);
    assert.equal(result.status, 4);
    assert.match(result.stderr, /more than one running installation/);
    assert.match(result.stderr, /- noesar-evolution\n/);
    assert.match(result.stderr, /- noesar-evolution-staging/);
    assert.ok(!readLog(w.logs.docker).some((line) => line.startsWith('exec ')), 'it picked one anyway');
  });

  test('an engine that answers but runs no installation declares that, distinctly', () => {
    const w = world({ engines: { docker: { answers: true, names: [] } } });
    const result = run(w);
    assert.equal(result.status, 3);
    assert.match(result.stderr, /no running container carries label org\.noesar\.authority=reference-node/);
  });
});

describe('the launcher is shipped — the class of defect phase 5 paid for three times', () => {
  const dockerfile = readFileSync(join(repoRoot, 'oci', 'Dockerfile'), 'utf8');
  const instructions = dockerfile
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('#'))
    .join('\n');

  test('the image contains the launcher', () => {
    assert.match(instructions, /^COPY .*tools\/coden-evolution .*\/opt\/noesar\/tools\/coden-evolution$/m);
  });

  test('the one word works inside the container too', () => {
    assert.match(instructions, /ln -sf \/opt\/noesar\/tools\/coden-evolution \/usr\/local\/bin\/coden_evolution/);
  });

  test('the shipped copy is executable regardless of the filesystem it was checked out on', () => {
    assert.match(instructions, /chmod 0755 \/opt\/noesar\/tools\/coden-evolution/);
  });

  // These three exist because the guards above were all green on 2026-08-07 while the image
  // shipped the POSIX launcher ALONE. `coden-evolution.ps1` was absent, so the operating
  // system with the longest section in the installation recipe had nothing to extract and
  // step 1 of that recipe could not be carried out on it at all. The tests above could not
  // see it: every one of them names the POSIX file, and a list that only mentions one
  // dialect cannot report the other one missing.
  //
  // So the path is DERIVED from the file that will go looking for it, never written here a
  // second time. A hand-kept copy of the path in a test proves the test agrees with itself.
  const windowsInstaller = readFileSync(
    join(repoRoot, 'deployment', 'container', 'Install-CodenCli.ps1'),
    'utf8',
  );

  test('the image contains the dialect the Windows installer goes looking for', () => {
    const [, remote] = windowsInstaller.match(/\$RemoteLauncher\s*=\s*'([^']+)'/) ?? [];
    assert.ok(remote, 'the Windows installer must declare the path it extracts');
    assert.match(instructions, new RegExp(`^COPY .*${remote.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'm'));
  });

  test('the image contains both installers, so a machine with no repository can obtain them', () => {
    for (const shipped of [
      '/opt/noesar/tools/install-coden-cli.sh',
      '/opt/noesar/tools/Install-CodenCli.ps1',
    ]) {
      assert.match(instructions, new RegExp(`^COPY .*${shipped}$`, 'm'), `${shipped} must be shipped`);
    }
  });

  test('the shipped POSIX installer is executable', () => {
    assert.match(instructions, /chmod 0755 [^\n]*\/opt\/noesar\/tools\/install-coden-cli\.sh/);
  });

  test('the path the host launcher re-enters is the path the image ships it at', () => {
    // The two halves of rung 2 are written in different files; nothing but this ties them.
    const source = readFileSync(launcher, 'utf8');
    const [, defaultRemote] = source.match(/conf_remote_launcher:-(\S+)\}/) ?? [];
    assert.equal(defaultRemote, '/opt/noesar/tools/coden-evolution');
    assert.ok(instructions.includes(`/opt/noesar/tools/coden-evolution`));
  });
});

describe('the Windows twin — STATIC ONLY, never reported as passing', () => {
  // Recorded plainly: no PowerShell exists on the host this ran on, so nothing below
  // executes anything. These assertions prove the two dialects did not drift apart; they do
  // not prove the Windows launcher works. That needs a real Windows host.
  const strip = (text) => text.split('\n').filter((line) => !line.trimStart().startsWith('#')).join('\n');
  const posix = strip(readFileSync(launcher, 'utf8'));
  const windows = strip(readFileSync(windowsLauncher, 'utf8'));

  test('both discover the installation by the same label', () => {
    assert.ok(posix.includes(DISCOVERY_LABEL), 'the POSIX launcher lost the discovery label');
    assert.ok(windows.includes(DISCOVERY_LABEL), 'the Windows launcher lost the discovery label');
  });

  test('both probe the same engines in the same order', () => {
    assert.match(posix, /docker podman nerdctl/);
    assert.match(windows, /'docker', 'podman', 'nerdctl'/);
  });

  test('both use the same exit codes, so a recipe can document one set', () => {
    for (const [name, value] of [['USAGE', 2], ['NO_SESSION', 3], ['AMBIGUOUS', 4]]) {
      assert.match(posix, new RegExp(`EXIT_${name}=${value}`), `POSIX exit code ${name} drifted`);
      assert.match(windows, new RegExp(`\\$Exit${name.charAt(0)}${name.slice(1).toLowerCase().replace('_s', 'S')}\\s*=\\s*${value}`), `Windows exit code ${name} drifted`);
    }
  });

  test('both read the same five configuration keys, and no sixth', () => {
    const keys = ['socket', 'engine', 'container', 'elevate', 'remote_launcher'];
    for (const key of keys) {
      assert.ok(posix.includes(`${key}=`), `POSIX launcher stopped reading '${key}'`);
      assert.ok(windows.includes(`${key} =`) || windows.includes(`'${key}'`), `Windows launcher stopped reading '${key}'`);
    }
  });

  test('neither dot-sources its configuration file', () => {
    assert.doesNotMatch(posix, /^\s*(\.|source|eval)\s+.*conf/m);
    assert.doesNotMatch(windows, /Invoke-Expression|iex\b|\.\s+\$confFile/);
  });

  test('the twin is declared unverified in its own first lines, where a reader will meet it', () => {
    const header = readFileSync(windowsLauncher, 'utf8').split('\n').slice(0, 12).join('\n');
    assert.match(header, /NOT EXECUTED/);
  });
});
