// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Git branch status for the CodeN top bar (`main ↑2` in the addendum mockup, s313/s317).
// Reads only — never writes, never fetches, never touches the index. Three honest outcomes,
// not one generic failure: a path that isn't a git repo, a repo with no upstream configured,
// and a repo with an upstream to compare against. A field with nothing behind it says so,
// same rule `renderBenchStatus()` already applies in app.js.

import { spawn } from 'node:child_process';

function runGit(cwd, args, timeoutMs = 5000) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (error) {
      resolve({ ok: false, stdout: '', stderr: error.message });
      return;
    }
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => { child.kill('SIGKILL'); }, timeoutMs);
    child.stdout.on('data', (d) => { stdout += d.toString('utf8'); });
    child.stderr.on('data', (d) => { stderr += d.toString('utf8'); });
    child.on('error', (error) => {
      clearTimeout(timer);
      resolve({ ok: false, stdout, stderr: error.message });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ ok: code === 0, stdout: stdout.trim(), stderr: stderr.trim() });
    });
  });
}

/** @returns one of three shapes, never a thrown error for an ordinary "not a repo" case:
 *  - { available:false, reason:'not_a_git_repository' }
 *  - { available:true, branch, detached:false, hasUpstream:false, ahead:null, behind:null }
 *  - { available:true, branch, detached:false, hasUpstream:true, ahead:Number, behind:Number }
 *  A detached HEAD is reported as `detached:true, branch:null` rather than the literal
 *  string "HEAD", which is not a branch name. */
export async function gitStatus(rootDir) {
  const inside = await runGit(rootDir, ['rev-parse', '--is-inside-work-tree']);
  if (!inside.ok || inside.stdout !== 'true') {
    return { available: false, reason: 'not_a_git_repository' };
  }

  const head = await runGit(rootDir, ['rev-parse', '--abbrev-ref', 'HEAD']);
  if (!head.ok) return { available: false, reason: 'head_unreadable' };
  const detached = head.stdout === 'HEAD';
  const branch = detached ? null : head.stdout;

  const upstream = await runGit(rootDir, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']);
  if (!upstream.ok) {
    return { available: true, branch, detached, hasUpstream: false, ahead: null, behind: null };
  }

  const counts = await runGit(rootDir, ['rev-list', '--left-right', '--count', '@{u}...HEAD']);
  if (!counts.ok) {
    return { available: true, branch, detached, hasUpstream: true, ahead: null, behind: null };
  }
  const [behindStr, aheadStr] = counts.stdout.split(/\s+/);
  const behind = Number.parseInt(behindStr, 10);
  const ahead = Number.parseInt(aheadStr, 10);
  return {
    available: true,
    branch,
    detached,
    hasUpstream: true,
    ahead: Number.isFinite(ahead) ? ahead : null,
    behind: Number.isFinite(behind) ? behind : null,
  };
}
