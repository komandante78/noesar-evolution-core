// SPDX-License-Identifier: AGPL-3.0-or-later
//
// ARCH-008, second half: the Node-side caller of `noesar-sandbox`. `isolation.mjs` decides
// whether a set of limits is valid and whether it is inside a token's grant and the
// installation's ceiling; this file is the one place that actually spawns the binary that
// enforces them.
//
// WHAT THIS FILE DELIBERATELY DOES NOT DO. `executor.mjs`'s `EXECUTE` action remains
// permanently refused — that refusal is asserted identically on both language sides
// (`rust/crates/noesar-executor`, `services/reference-control-plane/src/executor.mjs`) and the
// exact reason string is part of the shared conformance oracle (`conformance/
// executor-vectors.json`, case `EXEC-007`: "even holding a token that grants it"). Wiring this
// runner into that path would reverse a stated cross-language security contract, and that is a
// decision to name to the Owner explicitly, not one this phase makes by proximity. What this
// file gives instead: real, tested, standalone infrastructure — a command can be run under
// measured per-capability limits — available for whichever future surface is authorised to use
// it, with nothing today calling it in production.
//
// Following the one convention already established for spawning a process in this codebase
// (local-model-runtime.mjs): `spawn(command, argv)`, never a shell string. A command built as
// text and handed to a shell is a command an operator-supplied value can extend.

import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
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
