#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// CE-036 — the one-command access, executed against the live installation.
//
// WHAT THIS HARNESS IS FOR. `deployment/container/install-coden-cli.sh` claims four things
// that no unit test can check, because all four are about a real host: that it finds a real
// installation without being told its name, that what it installs actually opens a session,
// that it needs no root, and that it changes nothing outside the account that ran it. The
// last of those is the one worth having a harness for — "it does not touch the host" is a
// sentence, and a sentence is not a measurement.
//
// WHAT IT DELIBERATELY DOES NOT CLAIM. On this reference host a non-root account cannot talk
// to the container engine at all (measured: `su nobody -c 'docker version'` fails). That is
// not a defect in the installer — it is the reason 08_INSTALLAZIONE §12.3 exists as an
// OPTIONAL third way in. So this harness proves the installer succeeds for an account that
// can reach the engine, and REFUSES LEGIBLY for one that cannot; it does not pretend to have
// installed as an unprivileged user on a host where that is impossible.

import { execSync } from 'node:child_process';
import { mkdtempSync, existsSync, statSync, readdirSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../..');
const INSTALLER = join(repoRoot, 'deployment/container/install-coden-cli.sh');
const CONTAINER = process.env.CE036_CONTAINER ?? 'noesar-evolution';

let checks = 0;
let failures = 0;
function check(condition, message) {
  checks += 1;
  if (condition) return;
  failures += 1;
  console.log(`  FAIL  ${message}`);
}

function sh(command, options = {}) {
  try {
    return { ok: true, out: execSync(command, { encoding: 'utf8', stdio: 'pipe', ...options }), status: 0 };
  } catch (error) {
    return {
      ok: false,
      out: `${String(error.stdout ?? '')}${String(error.stderr ?? '')}`,
      status: error.status ?? -1,
    };
  }
}

console.log('CE-036 — portable one-command access, against the live installation\n');

// A snapshot of everything the recipe in §12.3 touches. Taken BEFORE anything runs, so the
// claim "this installer changes nothing outside your account" is compared against the host
// rather than against the comment that asserts it.
function hostSnapshot() {
  const listing = (path) => (existsSync(path) ? readdirSync(path).sort().join(',') : '<absent>');
  const digest = (path) => (existsSync(path)
    ? createHash('sha256').update(readFileSync(path)).digest('hex')
    : '<absent>');
  return {
    sudoersD: listing('/etc/sudoers.d'),
    usrLocalBin: listing('/usr/local/bin'),
    etcNoesar: listing('/etc/noesar-evolution'),
    sshdConfig: digest('/etc/ssh/sshd_config'),
    passwd: digest('/etc/passwd'),
  };
}

// Discovery by label is the thing under test, so this harness cannot run while anything
// else on the host wears the product label. That is not hypothetical: the browser E2E probe
// container carries it, and a run overlapping one made the installer refuse with exit 4 and
// name both — correct behaviour, meaningless as a measurement. Said up front rather than
// diagnosed from six confusing failures further down.
const running = sh("docker ps --filter 'label=org.noesar.authority=reference-node' --filter 'status=running' --format '{{.Names}}'");
const installations = running.out.split('\n').map((s) => s.trim()).filter(Boolean);
if (installations.length !== 1) {
  console.log(`  SKIP  this host is running ${installations.length} labelled installations: ${installations.join(', ')}`);
  console.log('        discovery by label cannot be measured against more than one. Re-run when only one is up.');
  console.log('\nCE036_CHECKS=0\nCE036_FAILURES=0\nCE036_SKIPPED=1');
  process.exit(0);
}

const before = hostSnapshot();
const home = mkdtempSync(join(tmpdir(), 'ce036-home-'));
const binDir = join(home, '.local', 'bin');
const installed = join(binDir, 'coden_evolution');

// --- 1. it finds the installation without being told its name ---------------------------
const first = sh(`sh ${JSON.stringify(INSTALLER)} --bin-dir ${JSON.stringify(binDir)} --no-path`, {
  env: { ...process.env, HOME: home },
});
check(first.ok, `the installer must succeed, exit ${first.status}: ${first.out.trim().slice(0, 200)}`);
check(existsSync(installed), 'coden_evolution must be installed');
check(/found by label, not by name/.test(first.out), 'it must say it found the installation by label');

// The address it prints must be the one the engine actually publishes, not a guess.
check(/http:\/\/\S+:\d+\//.test(first.out), 'it must print a real browser address for this installation');

if (existsSync(installed)) {
  check((statSync(installed).mode & 0o777) === 0o755, 'the installed launcher must be 0755');

  // The bytes must be the image's bytes. An installer that ships its own copy would drift
  // from the container it re-enters -- the class of defect phase 5 paid for.
  const installedDigest = createHash('sha256').update(readFileSync(installed)).digest('hex');
  const inImage = sh(`docker exec ${CONTAINER} sha256sum /opt/noesar/tools/coden-evolution`);
  const imageDigest = inImage.out.trim().split(/\s+/)[0];
  check(installedDigest === imageDigest,
    `the installed launcher must be the image's own bytes (${installedDigest.slice(0, 12)} vs ${String(imageDigest).slice(0, 12)})`);
}

// --- 2. what it installed actually opens a session --------------------------------------
// stdin is closed on purpose: the session prompts, and a harness must not sit on that
// prompt. Reaching the prompt is the whole assertion.
const opened = sh(`timeout 25 ${JSON.stringify(installed)} < /dev/null 2>&1`, {
  env: { ...process.env, HOME: home },
});
check(/attaching via/.test(opened.out), 'the installed word must declare which rung it used');
check(/protocol noesar-tui/.test(opened.out) || /Attach code/.test(opened.out),
  `the installed word must reach the session, got: ${opened.out.trim().slice(0, 200)}`);

// --- 3. running it again is not a second installation -----------------------------------
const second = sh(`sh ${JSON.stringify(INSTALLER)} --bin-dir ${JSON.stringify(binDir)} --no-path`, {
  env: { ...process.env, HOME: home },
});
check(second.ok, `a reinstall must succeed, exit ${second.status}`);
// Guarded: if the install never happened, this must report that, not throw a stack trace
// on top of the failures that already explained why.
const leftBehind = existsSync(binDir) ? readdirSync(binDir) : [];
check(leftBehind.length === 1, `only one file must be left in the bin dir, found [${leftBehind.join(',')}]`);

// --- 4. it refuses a default destination outside the home -------------------------------
const outside = sh(`sh ${JSON.stringify(INSTALLER)} --no-path`, {
  env: { ...process.env, HOME: '/', XDG_BIN_HOME: '/usr/local/bin' },
});
check(!outside.ok, 'a destination outside the home must be refused by default');
check(/refusing to install/.test(outside.out) || outside.status === 2,
  `the refusal must say why, got: ${outside.out.trim().slice(0, 160)}`);

// --- 5. an account that cannot reach the engine is told so, and told about the browser ---
// This is the case the reference host actually produces for every non-root account, and the
// message it gets is the only thing standing between a person and giving up.
const unprivileged = sh(
  `su -s /bin/sh nobody -c ${JSON.stringify(`HOME=${home}/nobody sh ${INSTALLER} --bin-dir ${home}/nobody/bin --no-path`)} 2>&1`,
);
check(!unprivileged.ok, 'an account that cannot reach the engine must not report success');
check(/did not answer|not on PATH/.test(unprivileged.out),
  `it must say the engine did not answer, got: ${unprivileged.out.trim().slice(0, 200)}`);
check(/browser/.test(unprivileged.out),
  'a refusal must name the browser, which needs nothing installed');

// --- 6. it can be undone --------------------------------------------------------------
// `2>&1` because everything this installer SAYS goes to stderr and only what it REPORTS
// goes to stdout — a split that matters when the output is piped, and that a harness
// reading only stdout would silently miss.
const undone = sh(`sh ${JSON.stringify(INSTALLER)} --bin-dir ${JSON.stringify(binDir)} --uninstall 2>&1`, {
  env: { ...process.env, HOME: home },
});
check(undone.ok, `--uninstall must succeed, exit ${undone.status}`);
check(!existsSync(installed), 'after --uninstall the launcher must be gone');
check(/left alone/.test(undone.out), 'the uninstaller must name what it did NOT undo');

// --- 7. the host is untouched ----------------------------------------------------------
// Everything §12.3 creates, compared before and after. This is the measurement behind the
// sentence "the product does not own the host it runs on".
const after = hostSnapshot();
for (const key of Object.keys(before)) {
  check(before[key] === after[key], `the installer must not change ${key}`);
}

rmSync(home, { recursive: true, force: true });

console.log(`\nCE036_CHECKS=${checks}`);
console.log(`CE036_FAILURES=${failures}`);
process.exit(failures === 0 ? 0 : 1);
