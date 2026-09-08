// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Health composition and the watchdog subject registry.
//
// The /livez versus /readyz split is the part that matters operationally: the
// container HEALTHCHECK uses /livez so only a genuinely dead process is
// restarted, while a proxy or the watchdog uses /readyz to stop routing traffic
// to an instance that is alive but not serving. Collapsing both onto /healthz —
// which is what this product did before — means a transient dependency failure
// restarts a perfectly healthy process.
import { existsSync, mkdirSync, rmSync, statfsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { RECOVERY_LEVELS } from './watchdog.mjs';
import { toUtcIso } from './timezone.mjs';

const DISK_WARN_BYTES = 512 * 1024 * 1024;
const DISK_FAIL_BYTES = 64 * 1024 * 1024;

export function probeWorkspaceWritable(workspace) {
  const probeDir = join(workspace, 'state');
  const probeFile = join(probeDir, '.watchdog-probe');
  try {
    mkdirSync(probeDir, { recursive: true, mode: 0o700 });
    writeFileSync(probeFile, toUtcIso(), { mode: 0o600 });
    rmSync(probeFile, { force: true });
    return { healthy: true };
  } catch (error) {
    return { healthy: false, detail: { error: error.message } };
  }
}

export function probeDisk(workspace) {
  try {
    const stats = statfsSync(workspace);
    const free = stats.bavail * stats.bsize;
    const total = stats.blocks * stats.bsize;
    return {
      healthy: free > DISK_FAIL_BYTES,
      detail: { freeBytes: free, totalBytes: total, warn: free < DISK_WARN_BYTES },
    };
  } catch (error) {
    return { healthy: false, detail: { error: error.message } };
  }
}

export function probeMemory() {
  const usage = process.memoryUsage();
  // rss against the heap ceiling is the only limit visible from inside the
  // process; the container cap is enforced by the kernel, not observable here.
  return {
    healthy: true,
    detail: { rssBytes: usage.rss, heapUsedBytes: usage.heapUsed, heapTotalBytes: usage.heapTotal },
  };
}

/**
 * Register every subject the watchdog design names. `maxLevel` is deliberately
 * conservative: only the subjects whose failure genuinely means "this process
 * cannot serve" are allowed to reach level 4.
 */
export function registerWatchdogSubjects(watchdog, {
  workspace, webRoot, dataStore, auditLedger, logger, providerGateway,
  updateManager, agentService, toolExecutor, hardware,
}) {
  watchdog.register({
    name: 'control-plane', essential: true, failureThreshold: 3,
    maxLevel: RECOVERY_LEVELS.REQUEST_CONTAINER_RESTART, idempotentRetry: true,
    probe: () => ({ healthy: true, detail: { pid: process.pid, uptimeSeconds: Math.round(process.uptime()) } }),
  });
  watchdog.register({
    name: 'webui', essential: true, failureThreshold: 3, maxLevel: RECOVERY_LEVELS.OBSERVE,
    probe: () => ({ healthy: existsSync(join(webRoot, 'index.html')), detail: { root: 'apps/webui-static' } }),
  });
  watchdog.register({
    name: 'authority-daemon', essential: false, failureThreshold: 3, maxLevel: RECOVERY_LEVELS.OBSERVE,
    // Not deployed in this installation; reported as absent rather than failing.
    probe: () => ({ healthy: true, detail: { mode: 'reference-node', externalDaemon: false } }),
  });
  watchdog.register({
    name: 'scheduler', essential: false, failureThreshold: 3, maxLevel: RECOVERY_LEVELS.RESTART_COMPONENT,
    probe: () => ({ healthy: true, detail: { implementation: 'in-process' } }),
  });
  watchdog.register({
    name: 'agent-runner', essential: false, failureThreshold: 3, maxLevel: RECOVERY_LEVELS.RESTART_COMPONENT,
    idempotentRetry: false, // an agent step may have side effects; replaying it is worse than failing
    probe: () => ({ healthy: Boolean(agentService), detail: null }),
  });
  watchdog.register({
    name: 'tool-runner', essential: false, failureThreshold: 3, maxLevel: RECOVERY_LEVELS.RESTART_COMPONENT,
    idempotentRetry: false,
    probe: () => ({ healthy: Boolean(toolExecutor), detail: null }),
  });
  watchdog.register({
    name: 'code', essential: false, failureThreshold: 3, maxLevel: RECOVERY_LEVELS.OBSERVE,
    probe: () => ({ healthy: true, detail: { executionEnabled: false } }),
  });
  watchdog.register({
    name: 'storage', essential: true, failureThreshold: 2,
    maxLevel: RECOVERY_LEVELS.REQUEST_CONTAINER_RESTART, idempotentRetry: true,
    probe: () => probeWorkspaceWritable(workspace),
  });
  watchdog.register({
    name: 'data-plane', essential: true, failureThreshold: 2,
    maxLevel: RECOVERY_LEVELS.RESTART_RUNTIME, idempotentRetry: true,
    probe: () => {
      try { dataStore.read(); return { healthy: true, detail: { kind: 'reference-json' } }; }
      catch (error) { return { healthy: false, detail: { error: error.message } }; }
    },
  });
  watchdog.register({
    name: 'audit', essential: true, failureThreshold: 2, maxLevel: RECOVERY_LEVELS.OBSERVE,
    probe: () => {
      try { return { healthy: true, detail: { entries: auditLedger.readAll().length } }; }
      catch (error) { return { healthy: false, detail: { error: error.message } }; }
    },
  });
  watchdog.register({
    name: 'logging', essential: false, failureThreshold: 3, maxLevel: RECOVERY_LEVELS.RESTART_COMPONENT,
    idempotentRetry: true,
    probe: () => {
      try {
        const stats = logger.stats();
        return { healthy: true, detail: { bytes: stats.bytes, quotaBytes: stats.quotaBytes, archives: stats.archiveCount } };
      } catch (error) { return { healthy: false, detail: { error: error.message } }; }
    },
  });
  watchdog.register({
    name: 'cpu', essential: false, failureThreshold: 5, maxLevel: RECOVERY_LEVELS.OBSERVE,
    probe: () => ({ healthy: true, detail: { cores: hardware?.cpu?.logicalCores ?? null } }),
  });
  watchdog.register({
    name: 'memory', essential: false, failureThreshold: 5, maxLevel: RECOVERY_LEVELS.OBSERVE,
    probe: () => probeMemory(),
  });
  watchdog.register({
    name: 'disk', essential: true, failureThreshold: 2, maxLevel: RECOVERY_LEVELS.OBSERVE,
    probe: () => probeDisk(workspace),
  });
  watchdog.register({
    name: 'gpu', essential: false, failureThreshold: 5, maxLevel: RECOVERY_LEVELS.OBSERVE,
    // Present on the host but deliberately not allocated to this container.
    probe: () => ({ healthy: true, detail: { allocated: false, hostAccelerators: hardware?.accelerators?.length ?? 0 } }),
  });
  watchdog.register({
    name: 'providers', essential: false, failureThreshold: 3, maxLevel: RECOVERY_LEVELS.RESTART_COMPONENT,
    idempotentRetry: true,
    // Reads local configuration only: probing a provider would be an outbound
    // call, and external providers are default-deny.
    probe: () => {
      try { return { healthy: true, detail: { configured: providerGateway.list().length, externalCallsMade: 0 } }; }
      catch (error) { return { healthy: false, detail: { error: error.message } }; }
    },
  });
  watchdog.register({
    name: 'update-manager', essential: false, failureThreshold: 3, maxLevel: RECOVERY_LEVELS.OBSERVE,
    probe: () => {
      try { const status = updateManager.status(); return { healthy: true, detail: { channel: status.channel, mode: status.mode } }; }
      catch (error) { return { healthy: false, detail: { error: error.message } }; }
    },
  });
  return watchdog;
}

/** Readiness: can this instance serve? Dependencies count; latency does not. */
export function buildReadiness({ watchdog, auth, dataPlane }) {
  const report = watchdog.report();
  const reasons = [];
  if (report.safeMode.active) reasons.push('safe-mode');
  for (const name of report.essentialFailures) reasons.push(`essential-subject-down:${name}`);
  if (!dataPlane) reasons.push('data-plane-unresolved');
  // A declared PostgreSQL data plane that is not connected is a readiness failure, not a
  // degradation: serving requests against a database the runtime cannot reach would mean
  // answering with an empty workspace and calling it success. /livez is unaffected, so a
  // database still recovering never causes the container to be killed.
  if (dataPlane?.mode === 'postgresql' && dataPlane.connected !== true) {
    reasons.push('data-plane-not-connected');
  }
  return {
    ready: reasons.length === 0,
    status: reasons.length === 0 ? 'ready' : 'not-ready',
    reasons,
    checkedAt: toUtcIso(),
    // Configuration state is informative, not a readiness gate: an installation
    // waiting for first-owner setup is correctly serving the setup flow.
    setupPending: auth ? !auth.status().initialized : null,
  };
}

/** Aggregate health: component detail for humans and dashboards. */
export function buildHealth({ product, watchdog, auth, authority, dataPlane, logger, updateManager, timezone, debug }) {
  const report = watchdog.report();
  const subjects = report.subjects;
  const down = subjects.filter((subject) => subject.healthy === false);
  const essentialDown = down.filter((subject) => subject.essential);
  let status = 'healthy';
  if (report.safeMode.active) status = 'safe-mode';
  else if (essentialDown.length) status = 'unhealthy';
  else if (down.length) status = 'degraded';
  return {
    status,
    product: product.name,
    version: product.version,
    local: true,
    checkedAt: toUtcIso(),
    // Only whether the installation is configured. The setup-flow flags stay on
    // /api/v1/auth/status, which is where the setup UI reads them; health has no
    // reason to restate them.
    authentication: { initialized: auth.status().initialized },
    authority,
    dataPlane,
    safeMode: report.safeMode,
    crashLoop: report.crashLoop,
    components: subjects.map((subject) => ({
      name: subject.name,
      healthy: subject.healthy,
      essential: subject.essential,
      recoveryLevel: subject.levelName,
      detail: subject.detail,
    })),
    degraded: down.map((subject) => subject.name),
    logging: logger.stats(),
    updates: {
      channel: updateManager.status().channel,
      mode: updateManager.status().mode,
      installedVersion: updateManager.status().installedVersion,
    },
    timezone: { effective: timezone.effective, sourceTier: timezone.sourceTier, utcNow: toUtcIso() },
    debug: { enabled: debug.enabled, scopes: debug.scopes },
  };
}

/**
 * The aggregate a prober is entitled to, and nothing else.
 *
 * Three fields survive because three consumers assert them and no more: `status` and
 * `local` are checked by the Windows verifier and by verify-runtime.sh, and
 * `checkedAt` says whether the answer is fresh. Everything else buildHealth produces
 * is reconnaissance and is dropped.
 *
 * What is NOT dropped is the fact that more exists. A block the caller may not read
 * comes back withheld WITH the permission it would need — the same rule the initial
 * screen follows — because a silently trimmed object and a complete one look
 * identical, and only one of them means "this is all there is".
 *
 * The caller decides the HTTP status code from the *full* health, never from this:
 * an unhealthy installation must still answer 503 to a probe that may not be told why.
 */
export function publicHealth(health) {
  return {
    status: health.status,
    local: health.local,
    checkedAt: health.checkedAt,
    detail: {
      disclosed: false,
      requiredRole: 'owner',
      requiredPermission: 'audit.read',
      reason: 'Version, authority, data plane, component, update and debug detail is '
        + 'disclosed to an owner holding audit.read, or on a loopback publish.',
    },
  };
}
