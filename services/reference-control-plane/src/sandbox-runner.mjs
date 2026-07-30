// SPDX-License-Identifier: AGPL-3.0-or-later
//
// ARCH-008, second half: the Node-side caller of `noesar-sandbox`. `isolation.mjs` decides
// whether a set of limits is valid and whether it is inside a token's grant and the
// installation's ceiling; this file is the one place that actually spawns the binary that
// enforces them.
//
// UPDATE, D-0250/D-0253: the paragraph this replaced said `executor.mjs`'s EXECUTE stayed
// permanently refused and wiring this runner into it would reverse a cross-language
// contract — that was the Owner decision D-0249 asked for, and D-0250 made it explicitly
// (`NOESAR_EXECUTE_SANDBOX`, per-installation, default disabled): `executor.mjs::execute()`
// now calls `runSandboxedSync` right here when a caller passes an enabled config. D-0253
// built the identical Rust mirror in `rust/crates/noesar-executor` (its own `run_sandboxed`,
// same spec-file format, same three-way outcome) — EXEC-007 (default path, no config at all)
// stays byte-identical on both sides; EXEC-011/012 (the two zero-process decision branches
// this introduced) are now shared conformance vectors satisfied on both sides too.
//
// Following the one convention already established for spawning a process in this codebase
// (local-model-runtime.mjs): `spawn(command, argv)`, never a shell string. A command built as
// text and handed to a shell is a command an operator-supplied value can extend.

import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

import { LIMIT_DIMENSIONS } from './isolation.mjs';

export class SandboxError extends Error {
  constructor(kind, reason) {
    super(reason);
    this.name = 'SandboxError';
    this.kind = kind;
    this.reason = reason;
  }
}

// The sandbox's own pre-exec refusal, chosen in main.rs precisely so it is never confused
// with an exit code the *command* could plausibly return.
const EX_CONFIG = 78;

// Bytes, not lines: an adversarial or merely chatty command must not be able to grow this
// process's own memory unboundedly just because it is being measured.
const DEFAULT_MAX_OUTPUT_BYTES = 1024 * 1024;

function capture(stream, maxBytes) {
  let text = '';
  let bytes = 0;
  let truncated = false;
  stream.on('data', (chunk) => {
    if (truncated) return;
    bytes += chunk.length;
    if (bytes > maxBytes) {
      text += chunk.toString('utf8', 0, Math.max(0, maxBytes - (bytes - chunk.length)));
      truncated = true;
      return;
    }
    text += chunk.toString('utf8');
  });
  return () => ({ text, truncated });
}

/// Splits the sandbox's own report (always the first line of stderr, written before `execvp`)
/// from whatever the command itself later wrote to stderr. `execvp` replaces the process, so
/// everything after that first line belongs to the command, not to `noesar-sandbox`.
function splitSandboxReport(stderrText) {
  const newline = stderrText.indexOf('\n');
  const firstLine = newline === -1 ? stderrText : stderrText.slice(0, newline);
  const rest = newline === -1 ? '' : stderrText.slice(newline + 1);
  try {
    const parsed = JSON.parse(firstLine);
    if (parsed && typeof parsed === 'object' && 'sandbox' in parsed) {
      return { report: parsed, commandStderr: rest };
    }
  } catch { /* not a report line — the whole stream is the command's */ }
  return { report: null, commandStderr: stderrText };
}

/// Probe what this installation's sandbox binary can actually enforce. Returns `null` — not a
/// thrown error — when the binary is absent or unusable, because "not installed here" is a
/// fact about this host, not a defect in the caller. `isolationStatus()` in isolation.mjs
/// reports that absence honestly rather than assuming a tier.
export async function detectSandbox({ binaryPath, timeoutMs = 5000 } = {}) {
  if (!binaryPath) return null;
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(binaryPath, ['--detect'], { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch {
      resolve(null);
      return;
    }
    let stdout = '';
    const timer = setTimeout(() => { child.kill('SIGKILL'); resolve(null); }, timeoutMs);
    child.stdout.on('data', (chunk) => { stdout += chunk.toString('utf8'); });
    child.on('error', () => { clearTimeout(timer); resolve(null); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) { resolve(null); return; }
      try { resolve(JSON.parse(stdout)); } catch { resolve(null); }
    });
  });
}

/// The synchronous twin of `detectSandbox`, for `server.mjs`'s module-scope boot sequence —
/// synchronous throughout, same as `TokenMinter`'s own construction. Used exactly once, at
/// startup, to give the live minter the real ceiling it needs to enforce D-0248's mint-time
/// widening check (`exceedsCeiling`) for EXECUTE grants — without this, a minter constructed
/// with no ceiling silently never runs that check at all, on any installation.
export function detectSandboxSync({ binaryPath, timeoutMs = 5000 } = {}) {
  if (!binaryPath) return null;
  let result;
  try {
    result = spawnSync(binaryPath, ['--detect'], { timeout: timeoutMs, encoding: 'utf8' });
  } catch {
    return null;
  }
  if (result.error || result.status !== 0) return null;
  try { return JSON.parse(String(result.stdout ?? '')); } catch { return null; }
}

/// Run `command` with `argv` under `limits`, via a short-lived `noesar-sandbox` child.
///
/// `limits` must already have passed `parseLimits`/`assertUsable`/the ceiling check in
/// isolation.mjs — this function enforces nothing about the *values*, only about the process:
/// it writes them to a private temp file (never a CLI argument, so they never appear in a
/// process listing), spawns the binary, and reports exactly what came back.
///
/// Distinguishes three outcomes, because collapsing them would hide which one happened:
///   - the sandbox refused before the command ever ran (exit 78; `performed: false`)
///   - the command ran and exited non-zero on its own (`performed: true`, `ok: false`)
///   - the command ran and exited zero (`performed: true`, `ok: true`)
export async function runSandboxed({
  binaryPath, limits, command, argv = [], cwd, env, timeoutMs = 30000,
  maxOutputBytes = DEFAULT_MAX_OUTPUT_BYTES,
}) {
  if (!binaryPath) throw new SandboxError('UNAVAILABLE', 'no sandbox binary configured on this installation');
  if (!limits || LIMIT_DIMENSIONS.every((dimension) => limits[dimension] === null || limits[dimension] === undefined)) {
    // Mirrors assertUsable's floor check conceptually, but this is the last line of defence
    // for a caller that skipped isolation.mjs entirely: an EXECUTE runner with no limits at
    // all is exactly the per-container isolation ARCH-008 exists to replace.
    throw new SandboxError('INVALID', 'runSandboxed refuses to run a command under no limits at all');
  }
  if (!command) throw new SandboxError('INVALID', 'no command given');

  const specDir = await mkdtemp(join(tmpdir(), 'noesar-sandbox-'));
  const specPath = join(specDir, `${randomBytes(8).toString('hex')}.json`);
  try {
    // A flat object of numbers and nulls is exactly what noesar-sandbox's small parser
    // accepts, and JSON.stringify of one produces that shape byte for byte (no nesting, no
    // strings needing escape, no whitespace ambiguity) — see rust/crates/noesar-sandbox/src/
    // main.rs's `parse_limits` for the format this must match.
    await writeFile(specPath, JSON.stringify(limits), { mode: 0o600 });

    return await new Promise((resolve, reject) => {
      let child;
      try {
        child = spawn(binaryPath, ['--spec', specPath, '--', command, ...argv], {
          stdio: ['ignore', 'pipe', 'pipe'],
          cwd,
          env,
        });
      } catch (error) {
        reject(new SandboxError('UNAVAILABLE', `cannot start the sandbox: ${error.message}`));
        return;
      }

      const readStdout = capture(child.stdout, maxOutputBytes);
      const readStderr = capture(child.stderr, maxOutputBytes);
      let timedOut = false;
      const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, timeoutMs);

      child.on('error', (error) => {
        clearTimeout(timer);
        reject(new SandboxError('UNAVAILABLE', `sandbox process error: ${error.message}`));
      });

      child.on('close', (code, signal) => {
        clearTimeout(timer);
        const stdout = readStdout();
        const { report, commandStderr } = splitSandboxReport(readStderr().text);

        if (timedOut) {
          resolve({
            performed: true, ok: false, timedOut: true, exitCode: null, signal,
            stdout: stdout.text, stdoutTruncated: stdout.truncated,
            stderr: commandStderr, report,
          });
          return;
        }
        if (code === EX_CONFIG) {
          resolve({
            performed: false, ok: false, refused: true, exitCode: code,
            reason: report?.reason ?? 'sandbox refused before the command ran',
            stdout: stdout.text, stderr: commandStderr, report,
          });
          return;
        }
        resolve({
          performed: true, ok: code === 0, timedOut: false, exitCode: code, signal,
          stdout: stdout.text, stdoutTruncated: stdout.truncated,
          stderr: commandStderr, stderrTruncated: readStderr().truncated, report,
        });
      });
    });
  } finally {
    // Best-effort: the spec never contains a secret (it is six integers), so a leaked temp
    // file is a cleanliness defect, not a security one — but it is still cleaned up.
    await rm(specDir, { recursive: true, force: true }).catch(() => {});
  }
}

/// The synchronous twin of `runSandboxed`, for callers that must stay synchronous —
/// `executor.mjs`'s `execute()` is one, deliberately: it does its own effects with
/// `readFileSync`/`writeFileSync`/`rmSync` throughout, and "the token is spent before the
/// effect" is a property that is trivially true in synchronous code and a property async
/// code has to work to preserve. Rather than make `execute()` async — which would ripple into
/// `workspace-actions.mjs`'s `approve()` and every caller up to `server.mjs`'s route handler,
/// for a capability nothing calls in production yet — this uses `spawnSync`, the same
/// primitive Node offers for exactly this case.
///
/// Behaviourally identical to `runSandboxed`: same validation, same spec-file format, same
/// three-way outcome (refused-before-running / ran-and-failed / ran-and-succeeded), same
/// report/stderr split. Only the mechanism differs.
export function runSandboxedSync({
  binaryPath, limits, command, argv = [], cwd, env, timeoutMs = 30000,
  maxOutputBytes = DEFAULT_MAX_OUTPUT_BYTES,
}) {
  if (!binaryPath) throw new SandboxError('UNAVAILABLE', 'no sandbox binary configured on this installation');
  if (!limits || LIMIT_DIMENSIONS.every((dimension) => limits[dimension] === null || limits[dimension] === undefined)) {
    throw new SandboxError('INVALID', 'runSandboxedSync refuses to run a command under no limits at all');
  }
  if (!command) throw new SandboxError('INVALID', 'no command given');

  const specDir = mkdtempSync(join(tmpdir(), 'noesar-sandbox-'));
  const specPath = join(specDir, `${randomBytes(8).toString('hex')}.json`);
  try {
    writeFileSync(specPath, JSON.stringify(limits), { mode: 0o600 });

    let result;
    try {
      result = spawnSync(binaryPath, ['--spec', specPath, '--', command, ...argv], {
        cwd, env, timeout: timeoutMs, killSignal: 'SIGKILL',
        maxBuffer: maxOutputBytes, encoding: 'utf8',
      });
    } catch (error) {
      throw new SandboxError('UNAVAILABLE', `cannot start the sandbox: ${error.message}`);
    }

    if (result.error) {
      // ETIMEDOUT is spawnSync's own signal that the timeout fired and the process was
      // killed — a real, distinct outcome, not a launch failure, so it is reported as one
      // rather than thrown.
      if (result.error.code === 'ETIMEDOUT' || result.signal) {
        const { commandStderr } = splitSandboxReport(String(result.stderr ?? ''));
        return {
          performed: true, ok: false, timedOut: result.error.code === 'ETIMEDOUT',
          exitCode: null, signal: result.signal ?? null,
          stdout: String(result.stdout ?? ''), stdoutTruncated: false,
          stderr: commandStderr, report: null,
        };
      }
      throw new SandboxError('UNAVAILABLE', `sandbox process error: ${result.error.message}`);
    }

    const stdoutTruncated = Buffer.byteLength(String(result.stdout ?? ''), 'utf8') >= maxOutputBytes;
    const { report, commandStderr } = splitSandboxReport(String(result.stderr ?? ''));
    const code = result.status;

    if (code === EX_CONFIG) {
      return {
        performed: false, ok: false, refused: true, exitCode: code,
        reason: report?.reason ?? 'sandbox refused before the command ran',
        stdout: String(result.stdout ?? ''), stderr: commandStderr, report,
      };
    }
    return {
      performed: true, ok: code === 0, timedOut: false, exitCode: code, signal: result.signal ?? null,
      stdout: String(result.stdout ?? ''), stdoutTruncated,
      stderr: commandStderr, stderrTruncated: false, report,
    };
  } finally {
    rmSync(specDir, { recursive: true, force: true });
  }
}
