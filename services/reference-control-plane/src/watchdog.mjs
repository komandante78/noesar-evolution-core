// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Internal watchdog and safe mode.
//
// There is deliberately no second container. This runtime is a single process,
// so level 4 recovery is "exit non-zero and let Docker's `unless-stopped`
// restart us" — which is why crash-loop detection matters: restarting forever
// against a corrupt data plane destroys more than it repairs. At that point the
// watchdog stops escalating and enters safe mode, which preserves the evidence
// and keeps documents readable.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { toUtcIso } from './timezone.mjs';

export const RECOVERY_LEVELS = Object.freeze({
  OBSERVE: 0,
  RETRY: 1,
  RESTART_COMPONENT: 2,
  RESTART_RUNTIME: 3,
  REQUEST_CONTAINER_RESTART: 4,
  SAFE_MODE: 5,
});

export const LEVEL_NAMES = Object.freeze({
  0: 'observe', 1: 'retry', 2: 'restart-internal-component',
  3: 'restart-runtime', 4: 'request-container-restart', 5: 'safe-mode',
});

export const CRASH_LOOP_RESTARTS = 3;
export const CRASH_LOOP_WINDOW_MS = 10 * 60_000;
const BACKOFF_BASE_MS = 5_000;
const BACKOFF_CAP_MS = 5 * 60_000;

// Operations that remain available while the runtime is degraded. Reading
// documents and audit history is the whole point of safe mode; anything that
// mutates state or reaches a provider is not.
const SAFE_MODE_ALLOWED = Object.freeze(new Set([
  'read', 'document.read', 'audit.read', 'health.read', 'diagnostics.read', 'debug.manage', 'update.rollback',
]));

function fail(message, status = 503) {
  return Object.assign(new Error(message), { status });
}

export class Watchdog {
  /**
   * @param {object} options
   * @param {string|null} options.statePath  persisted restart history and checkpoints
   * @param {() => number} options.clock
   * @param {(code:number) => void} options.exit     injected so tests never kill the runner
   * @param {() => number} options.random            injected jitter source
   */
  constructor({
    logger = null, ledger = null, metrics = null, statePath = null,
    clock = Date.now, exit = null, random = Math.random, notify = null,
  } = {}) {
    this.logger = logger;
    this.ledger = ledger;
    this.metrics = metrics;
    this.statePath = statePath;
    this.clock = clock;
    this.exit = exit ?? ((code) => process.exit(code));
    this.random = random;
    this.notify = notify;
    this.subjects = new Map();
    this.safeMode = { active: false, reason: null, since: null, incidentId: null };
    this.escalations = [];
    this.notifications = [];
    this.timer = null;
    this.state = this.#loadState();
    this.#detectCrashLoopAtBoot();
  }

  // ---------------------------------------------------------------- persistence

  #loadState() {
    const empty = { schemaVersion: 1, restarts: [], checkpoints: [], lastExit: null };
    if (!this.statePath) return empty;
    mkdirSync(dirname(this.statePath), { recursive: true, mode: 0o700 });
    if (!existsSync(this.statePath)) return empty;
    try {
      const parsed = JSON.parse(readFileSync(this.statePath, 'utf8'));
      return { ...empty, ...parsed };
    } catch {
      return empty;
    }
  }

  #saveState() {
    if (!this.statePath) return;
    const temporary = `${this.statePath}.tmp`;
    writeFileSync(temporary, JSON.stringify(this.state, null, 2), { encoding: 'utf8', mode: 0o600 });
    renameSync(temporary, this.statePath);
  }

  /** Called once at construction: a container that keeps restarting must not keep trying. */
  #detectCrashLoopAtBoot() {
    const now = this.clock();
    this.state.restarts = (this.state.restarts ?? []).filter((entry) => now - entry.at <= CRASH_LOOP_WINDOW_MS);
    if (this.state.restarts.length >= CRASH_LOOP_RESTARTS) {
      this.enterSafeMode(`crash loop detected: ${this.state.restarts.length} restarts within ${CRASH_LOOP_WINDOW_MS / 60000} minutes`);
    }
    this.#saveState();
  }

  /** Record that this process is about to exit so the next boot can see the pattern. */
  recordRestartRequest(reason) {
    const now = this.clock();
    this.state.restarts = (this.state.restarts ?? []).filter((entry) => now - entry.at <= CRASH_LOOP_WINDOW_MS);
    this.state.restarts.push({ at: now, atUtc: toUtcIso(now), reason });
    this.state.lastExit = { at: now, atUtc: toUtcIso(now), reason };
    this.#saveState();
    return this.state.restarts.length;
  }

  isCrashLooping() {
    const now = this.clock();
    return (this.state.restarts ?? []).filter((entry) => now - entry.at <= CRASH_LOOP_WINDOW_MS).length >= CRASH_LOOP_RESTARTS;
  }

  // ------------------------------------------------------------------- subjects

  /**
   * @param {object} subject
   * @param {string} subject.name
   * @param {() => Promise<{healthy:boolean, detail?:object}>|{healthy:boolean}} subject.probe
   * @param {number} subject.failureThreshold  consecutive failures before escalating
   * @param {number} subject.maxLevel          highest recovery level this subject may trigger
   * @param {boolean} subject.essential        counted by /readyz
   * @param {boolean} subject.idempotentRetry  level 1 retry is only run when true
   */
  register({
    name, probe, intervalMs = 30_000, failureThreshold = 3,
    maxLevel = RECOVERY_LEVELS.OBSERVE, essential = false,
    idempotentRetry = false, restartComponent = null, restartRuntime = null,
  }) {
    if (!name) throw new Error('A watchdog subject needs a name.');
    if (typeof probe !== 'function') throw new Error(`Watchdog subject ${name} needs a probe function.`);
    this.subjects.set(name, {
      name, probe, intervalMs, failureThreshold, maxLevel, essential,
      idempotentRetry, restartComponent, restartRuntime,
      consecutiveFailures: 0, level: RECOVERY_LEVELS.OBSERVE, lastRunAt: 0,
      lastResult: null, lastError: null, nextAllowedAt: 0, retries: 0, recoveries: 0,
    });
    return this;
  }

  /** Exponential backoff with jitter, capped, so a flapping dependency is not hammered. */
  backoffMs(attempt) {
    const raw = Math.min(BACKOFF_BASE_MS * 2 ** Math.max(0, attempt - 1), BACKOFF_CAP_MS);
    return Math.round(raw * (0.5 + this.random() * 0.5));
  }

  async runOnce({ force = false } = {}) {
    const now = this.clock();
    const results = [];
    for (const subject of this.subjects.values()) {
      if (!force && subject.nextAllowedAt > now) { results.push(this.#snapshot(subject)); continue; }
      if (!force && subject.lastRunAt && now - subject.lastRunAt < subject.intervalMs) { results.push(this.#snapshot(subject)); continue; }
      await this.#runSubject(subject, now);
      results.push(this.#snapshot(subject));
    }
    return results;
  }

  async #runSubject(subject, now) {
    subject.lastRunAt = now;
    let outcome;
    try {
      outcome = await subject.probe();
    } catch (error) {
      outcome = { healthy: false, detail: { error: error.message } };
    }
    const healthy = Boolean(outcome?.healthy);
    subject.lastResult = { healthy, detail: outcome?.detail ?? null, at: toUtcIso(now) };
    if (healthy) {
      if (subject.consecutiveFailures > 0) {
        this.logger?.info('watchdog.recovered', { component: 'watchdog', subject: subject.name, after_failures: subject.consecutiveFailures });
        subject.recoveries += 1;
      }
      subject.consecutiveFailures = 0;
      subject.level = RECOVERY_LEVELS.OBSERVE;
      subject.retries = 0;
      subject.nextAllowedAt = 0;
      return;
    }
    subject.consecutiveFailures += 1;
    subject.lastError = outcome?.detail ?? null;
    this.logger?.warn('watchdog.probe.failed', {
      component: 'watchdog', subject: subject.name,
      consecutive_failures: subject.consecutiveFailures, detail: outcome?.detail ?? null,
    });
    if (subject.consecutiveFailures >= subject.failureThreshold) await this.escalate(subject.name);
  }

  /** One level at a time, never skipping, never above the subject's maximum. */
  async escalate(name) {
    const subject = this.subjects.get(name);
    if (!subject) throw new Error(`Unknown watchdog subject: ${name}`);
    if (this.safeMode.active) return { level: RECOVERY_LEVELS.SAFE_MODE, action: 'already-in-safe-mode' };

    const target = Math.min(subject.level + 1, subject.maxLevel);
    if (target === subject.level) {
      return { level: subject.level, action: 'at-maximum-for-subject' };
    }
    subject.level = target;

    // Anything at or above level 3 loses in-memory context, so the post-mortem is
    // written down before the action, not after it.
    if (target >= RECOVERY_LEVELS.RESTART_RUNTIME) this.checkpoint(subject, target);

    const record = {
      id: randomUUID(), subject: name, level: target, levelName: LEVEL_NAMES[target],
      at: toUtcIso(this.clock()), consecutiveFailures: subject.consecutiveFailures,
    };
    this.escalations.push(record);
    if (this.escalations.length > 200) this.escalations.shift();
    this.metrics?.increment('noesar_watchdog_escalations_total', { level: String(target) });
    this.ledger?.append({ actor: 'system', action: 'watchdog.escalation', result: 'applied', details: record });
    this.logger?.error('watchdog.escalation', { component: 'watchdog', subject: name, level: target, level_name: LEVEL_NAMES[target] });
    if (target >= RECOVERY_LEVELS.RESTART_RUNTIME) this.#notifyOwner(record);

    let action = LEVEL_NAMES[target];
    switch (target) {
      case RECOVERY_LEVELS.RETRY:
        // Only idempotent work may be retried; re-running a mutation is worse than failing.
        if (!subject.idempotentRetry) {
          action = 'retry-skipped-non-idempotent';
          this.logger?.warn('watchdog.retry.skipped', { component: 'watchdog', subject: name, reason: 'operation is not idempotent' });
        } else {
          subject.retries += 1;
          subject.nextAllowedAt = this.clock() + this.backoffMs(subject.retries);
        }
        break;
      case RECOVERY_LEVELS.RESTART_COMPONENT:
        try { await subject.restartComponent?.(); } catch (error) {
          this.logger?.error('watchdog.component-restart.failed', { component: 'watchdog', subject: name, detail: { error: error.message } });
        }
        subject.nextAllowedAt = this.clock() + this.backoffMs(subject.retries + 1);
        break;
      case RECOVERY_LEVELS.RESTART_RUNTIME:
        try { await subject.restartRuntime?.(); } catch (error) {
          this.logger?.error('watchdog.runtime-restart.failed', { component: 'watchdog', subject: name, detail: { error: error.message } });
        }
        break;
      case RECOVERY_LEVELS.REQUEST_CONTAINER_RESTART: {
        const count = this.recordRestartRequest(`watchdog level 4 on ${name}`);
        if (count >= CRASH_LOOP_RESTARTS) {
          // Stop escalating rather than restart forever.
          this.enterSafeMode(`crash loop: ${count} container restarts requested within ${CRASH_LOOP_WINDOW_MS / 60000} minutes`);
          action = 'crash-loop-detected-entered-safe-mode';
          break;
        }
        this.logger?.fatal('watchdog.container-restart.requested', { component: 'watchdog', subject: name, restart_count: count });
        this.exit(70);
        break;
      }
      case RECOVERY_LEVELS.SAFE_MODE:
        this.enterSafeMode(`watchdog escalation on ${name}`);
        break;
      default:
        break;
    }
    return { ...record, action };
  }

  checkpoint(subject, level) {
    const entry = {
      id: randomUUID(),
      at: toUtcIso(this.clock()),
      subject: typeof subject === 'string' ? subject : subject.name,
      level,
      levelName: LEVEL_NAMES[level] ?? String(level),
      health: [...this.subjects.values()].map((item) => ({
        name: item.name, healthy: item.lastResult?.healthy ?? null, failures: item.consecutiveFailures,
      })),
      lastError: typeof subject === 'string' ? null : subject.lastError,
    };
    this.state.checkpoints = [...(this.state.checkpoints ?? []), entry].slice(-25);
    this.#saveState();
    this.logger?.warn('watchdog.checkpoint', { component: 'watchdog', checkpoint_id: entry.id, subject: entry.subject, level });
    return entry;
  }

  // ------------------------------------------------------------------ safe mode

  enterSafeMode(reason) {
    if (this.safeMode.active) return this.safeMode;
    const incidentId = `INC-${randomUUID()}`;
    this.safeMode = { active: true, reason: String(reason), since: toUtcIso(this.clock()), incidentId };
    this.metrics?.setGauge('noesar_safe_mode', 1);
    this.ledger?.append({ actor: 'system', action: 'watchdog.safe-mode.entered', result: 'applied', details: this.safeMode });
    this.logger?.fatal('watchdog.safe-mode.entered', { component: 'watchdog', reason: this.safeMode.reason, incident_id: incidentId });
    this.#notifyOwner({ kind: 'safe-mode', ...this.safeMode });
    return this.safeMode;
  }

  leaveSafeMode({ actorId = 'owner' } = {}) {
    if (!this.safeMode.active) return this.safeMode;
    const previous = { ...this.safeMode };
    this.safeMode = { active: false, reason: null, since: null, incidentId: null };
    this.state.restarts = [];
    this.#saveState();
    for (const subject of this.subjects.values()) {
      subject.consecutiveFailures = 0;
      subject.level = RECOVERY_LEVELS.OBSERVE;
      subject.retries = 0;
      subject.nextAllowedAt = 0;
    }
    this.metrics?.setGauge('noesar_safe_mode', 0);
    this.ledger?.append({ actor: actorId, action: 'watchdog.safe-mode.left', result: 'applied', details: previous });
    this.logger?.warn('watchdog.safe-mode.left', { component: 'watchdog', previous_reason: previous.reason });
    return this.safeMode;
  }

  isOperationAllowed(operation) {
    if (!this.safeMode.active) return true;
    return SAFE_MODE_ALLOWED.has(String(operation));
  }

  /** Throws in safe mode for anything that would mutate state or call outward. */
  assertOperationAllowed(operation) {
    if (this.isOperationAllowed(operation)) return true;
    throw fail(`NOESAR is in safe mode; "${operation}" is disabled. Documents and audit history remain readable.`, 503);
  }

  #notifyOwner(payload) {
    const notification = { at: toUtcIso(this.clock()), ...payload };
    this.notifications.push(notification);
    if (this.notifications.length > 50) this.notifications.shift();
    try { this.notify?.(notification); } catch { /* notification must never break recovery */ }
    return notification;
  }

  // -------------------------------------------------------------------- reports

  #snapshot(subject) {
    return {
      name: subject.name,
      healthy: subject.lastResult?.healthy ?? null,
      essential: subject.essential,
      consecutiveFailures: subject.consecutiveFailures,
      level: subject.level,
      levelName: LEVEL_NAMES[subject.level],
      maxLevel: subject.maxLevel,
      lastRunAt: subject.lastRunAt ? toUtcIso(subject.lastRunAt) : null,
      detail: subject.lastResult?.detail ?? null,
      recoveries: subject.recoveries,
    };
  }

  report() {
    const subjects = [...this.subjects.values()].map((subject) => this.#snapshot(subject));
    const unhealthyEssential = subjects.filter((subject) => subject.essential && subject.healthy === false);
    return {
      safeMode: this.safeMode,
      crashLoop: this.isCrashLooping(),
      restartsInWindow: (this.state.restarts ?? []).length,
      subjects,
      essentialFailures: unhealthyEssential.map((subject) => subject.name),
      escalations: this.escalations.slice(-20),
      checkpoints: (this.state.checkpoints ?? []).slice(-5),
      notifications: this.notifications.slice(-10),
    };
  }

  start(intervalMs = 15_000) {
    if (this.timer) return this.timer;
    this.timer = setInterval(() => { this.runOnce().catch(() => {}); }, intervalMs);
    this.timer.unref?.();
    return this.timer;
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}

export function watchdogStatePath(workspace) { return join(workspace, 'state/watchdog.json'); }
