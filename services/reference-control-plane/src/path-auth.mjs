// SPDX-License-Identifier: AGPL-3.0-or-later
import { existsSync, lstatSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, normalize, parse, resolve, sep } from 'node:path';

const protectedRoots = process.platform === 'win32'
  ? ['C:\\Windows', 'C:\\Program Files', 'C:\\Program Files (x86)']
  : ['/boot', '/dev', '/etc', '/proc', '/root', '/sys', '/usr'];

function within(child, parent) {
  const c = normalize(resolve(child));
  const p = normalize(resolve(parent));
  return c === p || c.startsWith(`${p}${sep}`);
}

function inspectExistingSegments(target) {
  const findings = [];
  let current = parse(target).root;
  for (const part of target.slice(current.length).split(sep).filter(Boolean)) {
    current = resolve(current, part);
    if (!existsSync(current)) continue;
    const stat = lstatSync(current);
    if (stat.isSymbolicLink()) findings.push({ type: 'symlink', path: current });
  }
  return findings;
}

export function createPathPlan(request, workspaceRoot) {
  const rawPath = String(request.path ?? '').trim();
  if (!rawPath) throw new Error('Path is required');
  const candidate = isAbsolute(rawPath) ? normalize(rawPath) : resolve(workspaceRoot, rawPath);
  const canonical = existsSync(candidate) ? realpathSync.native(candidate) : resolve(candidate);
  const operation = request.operation ?? 'write';
  const findings = inspectExistingSegments(candidate);
  const protectedMatch = protectedRoots.find((root) => within(canonical, root));
  const ownerHomeSecrets = within(canonical, resolve(homedir(), '.ssh')) || within(canonical, resolve(homedir(), '.config'));
  const insideWorkspace = within(canonical, workspaceRoot);
  let risk = 'LOW';
  if (!insideWorkspace) risk = 'HIGH';
  if (operation === 'delete' || request.recursive) risk = 'HIGH';
  if (protectedMatch || ownerHomeSecrets || findings.length) risk = 'CRITICAL';

  const blocked = Boolean(protectedMatch || ownerHomeSecrets);
  return {
    mode: request.mode ?? 'NORMAL',
    requestedPath: rawPath,
    canonicalPath: canonical,
    workspaceRoot: resolve(workspaceRoot),
    insideWorkspace,
    operation,
    recursive: Boolean(request.recursive),
    commands: Array.isArray(request.commands) ? request.commands : [],
    dependencies: Array.isArray(request.dependencies) ? request.dependencies : [],
    networkRequested: Boolean(request.networkRequested),
    secretsRequested: Boolean(request.secretsRequested),
    symlinkFindings: findings,
    protectedMatch: protectedMatch ?? null,
    risk,
    blocked,
    requiresStrongReauthentication: risk === 'CRITICAL' || request.mode === 'OWNER_BYPASS',
    consentOptions: ['ONE_OPERATION', 'LISTED_FILES', 'FOLDER_FOR_SESSION', 'PERSISTENT_FOLDER', 'DENY'],
    backup: { required: operation !== 'read', strategy: 'content-addressed safety copy before mutation' },
    verification: ['confirm expected files', 'run bounded tests', 'review diff', 'append audit event'],
    rollback: ['restore safety copy', 'remove only newly-created listed files', 'verify integrity'],
    nonBypassableInvariants: [
      'credential_theft_prevention',
      'malware_prevention',
      'illegal_cyberattack_prevention',
      'physical_harm_prevention',
      'signed_update_verification',
      'audit_integrity',
      'destructive_action_confirmation',
    ],
  };
}
