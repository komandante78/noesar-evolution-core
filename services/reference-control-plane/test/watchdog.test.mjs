// SPDX-License-Identifier: AGPL-3.0-or-later
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Watchdog, RECOVERY_LEVELS, CRASH_LOOP_RESTARTS, watchdogStatePath } from '../src/watchdog.mjs';
import { Logger } from '../src/logging.mjs';
import { Metrics } from '../src/metrics.mjs';
import { AuditLedger } from '../src/audit.mjs';

function harness({ root = mkdtempSync(join(tmpdir(), 'noesar-wd-')), clockStart = Date.parse('2026-07-25T06:00:00Z') } = {}) {
  const logger = new Logger({ dir: join(root, 'logs'), stdout: false, level: 'TRACE' });
  const ledger = new AuditLedger(join(root, 'audit/events.jsonl'));
  const metrics = new Metrics();
  let now = clockStart;
  const exits = [];
  const notifications = [];
  const watchdog = new Watchdog({
    logger, ledger, metrics,
    statePath: watchdogStatePath(root),
    clock: () => now,
    exit: (code) => exits.push(code),
    random: () => 0.5,
    notify: (payload) => notifications.push(payload),
  });
  return { root, logger, ledger, metrics, watchdog, exits, notifications, advance: (ms) => { now += ms; } };
}

function failingSubject(name, options = {}) {
  return { name, probe: () => ({ healthy: false, detail: { error: 'down' } }), failureThreshold: 1, ...options };
}

test('all documented subjects can be registered and reported', async () => {
  const { watchdog } = harness();
  const names = ['control-plane', 'webui', 'authority-daemon', 'scheduler', 'agent-runner', 'tool-runner',
    'code', 'storage', 'cpu', 'memory', 'disk', 'gpu', 'providers', 'logging', 'update-manager'];
  for (const name of names) watchdog.register({ name, probe: () => ({ healthy: true }) });
  await watchdog.runOnce({ force: true });
  const report = watchdog.report();
  assert.equal(report.subjects.length, names.length);
  assert.deepEqual(report.subjects.map((s) => s.name).sort(), [...names].sort());
  assert.ok(report.subjects.every((s) => s.healthy === true));
});

test('a healthy probe keeps the level at observe', async () => {
  const { watchdog } = harness();
  watchdog.register({ name: 'storage', probe: () => ({ healthy: true }), maxLevel: RECOVERY_LEVELS.SAFE_MODE });
  await watchdog.runOnce({ force: true });
  assert.equal(watchdog.report().subjects[0].level, RECOVERY_LEVELS.OBSERVE);
});

test('escalation is one level at a time and never skips', async () => {
  const { watchdog } = harness();
  watchdog.register(failingSubject('storage', { maxLevel: RECOVERY_LEVELS.RESTART_RUNTIME, idempotentRetry: true }));
  const levels = [];
  for (let round = 0; round < 5; round += 1) {
    await watchdog.runOnce({ force: true });
    levels.push(watchdog.report().subjects[0].level);
  }
  assert.deepEqual(levels, [1, 2, 3, 3, 3], 'levels must rise one step at a time and stop at the subject maximum');
});

test('a subject cannot escalate above its declared maximum', async () => {
  const { watchdog, exits } = harness();
  watchdog.register(failingSubject('gpu', { maxLevel: RECOVERY_LEVELS.OBSERVE }));
  for (let round = 0; round < 4; round += 1) await watchdog.runOnce({ force: true });
  assert.equal(watchdog.report().subjects[0].level, RECOVERY_LEVELS.OBSERVE);
  assert.equal(exits.length, 0, 'an observe-only subject must never request a container restart');
});

test('failure threshold is honoured before any escalation', async () => {
  const { watchdog } = harness();
  watchdog.register(failingSubject('providers', { failureThreshold: 3, maxLevel: RECOVERY_LEVELS.RETRY, idempotentRetry: true }));
  await watchdog.runOnce({ force: true });
  assert.equal(watchdog.report().subjects[0].level, RECOVERY_LEVELS.OBSERVE);
  await watchdog.runOnce({ force: true });
  assert.equal(watchdog.report().subjects[0].level, RECOVERY_LEVELS.OBSERVE);
  await watchdog.runOnce({ force: true });
  assert.equal(watchdog.report().subjects[0].level, RECOVERY_LEVELS.RETRY);
});

test('a recovered subject resets its failure count and level', async () => {
  const { watchdog } = harness();
  let healthy = false;
  watchdog.register({ name: 'storage', probe: () => ({ healthy }), failureThreshold: 1, maxLevel: RECOVERY_LEVELS.RESTART_COMPONENT });
  await watchdog.runOnce({ force: true });
  assert.equal(watchdog.report().subjects[0].level, RECOVERY_LEVELS.RETRY);
  healthy = true;
  await watchdog.runOnce({ force: true });
  const subject = watchdog.report().subjects[0];
  assert.equal(subject.level, RECOVERY_LEVELS.OBSERVE);
  assert.equal(subject.consecutiveFailures, 0);
  assert.equal(subject.recoveries, 1);
});

test('a non-idempotent operation is not retried', async () => {
  const { watchdog, logger } = harness();
  watchdog.register(failingSubject('agent-runner', { maxLevel: RECOVERY_LEVELS.RETRY, idempotentRetry: false }));
  const outcome = await watchdog.escalate('agent-runner');
  assert.equal(outcome.action, 'retry-skipped-non-idempotent');
  const skipped = logger.search({ event: 'watchdog.retry.skipped' }).entries;
  assert.equal(skipped.length, 1);
});

test('an idempotent operation is retried behind exponential capped backoff with jitter', () => {
  const { watchdog } = harness();
  const delays = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((attempt) => watchdog.backoffMs(attempt));
  assert.equal(delays[0], 3750, '5s base with the injected 0.5 jitter factor');
  for (let index = 1; index < delays.length; index += 1) {
    assert.ok(delays[index] >= delays[index - 1], 'backoff must not decrease');
  }
  assert.ok(delays.at(-1) <= 5 * 60_000, 'backoff must stay under the five-minute cap');
  assert.equal(delays.at(-1), 225_000);
});

test('backoff jitter is actually applied', () => {
  const root = mkdtempSync(join(tmpdir(), 'noesar-wd-j-'));
  const low = new Watchdog({ statePath: watchdogStatePath(root), random: () => 0 });
  const high = new Watchdog({ statePath: join(root, 'other.json'), random: () => 1 });
  assert.equal(low.backoffMs(1), 2500);
  assert.equal(high.backoffMs(1), 5000);
});

test('level 3 writes a checkpoint before the runtime restart', async () => {
  const { watchdog, root } = harness();
  watchdog.register(failingSubject('control-plane', { maxLevel: RECOVERY_LEVELS.RESTART_RUNTIME, idempotentRetry: true }));
  for (let round = 0; round < 3; round += 1) await watchdog.runOnce({ force: true });
  const statePath = watchdogStatePath(root);
  assert.ok(existsSync(statePath));
  const state = JSON.parse(readFileSync(statePath, 'utf8'));
  assert.ok(state.checkpoints.length >= 1, 'a checkpoint must survive the restart');
  assert.equal(state.checkpoints[0].level, RECOVERY_LEVELS.RESTART_RUNTIME);
  assert.ok(Array.isArray(state.checkpoints[0].health));
});

test('level 4 exits non-zero so Docker restarts the container', async () => {
  const { watchdog, exits } = harness();
  watchdog.register(failingSubject('control-plane', { maxLevel: RECOVERY_LEVELS.REQUEST_CONTAINER_RESTART, idempotentRetry: true }));
  for (let round = 0; round < 4; round += 1) await watchdog.runOnce({ force: true });
  assert.deepEqual(exits, [70], 'the process must exit with a non-zero code exactly once');
});

test('three restarts inside the window stop escalation and enter safe mode', async () => {
  const { watchdog, exits } = harness();
  watchdog.register(failingSubject('storage', { maxLevel: RECOVERY_LEVELS.REQUEST_CONTAINER_RESTART, idempotentRetry: true }));
  // Simulate two earlier container restarts inside the ten-minute window.
  watchdog.recordRestartRequest('earlier restart 1');
  watchdog.recordRestartRequest('earlier restart 2');
  for (let round = 0; round < 4; round += 1) await watchdog.runOnce({ force: true });
  assert.equal(watchdog.safeMode.active, true, 'a crash loop must end in safe mode, not another restart');
  assert.match(watchdog.safeMode.reason, /crash loop/i);
  assert.equal(exits.length, 0, 'the process must not exit once a crash loop is recognised');
  assert.equal(CRASH_LOOP_RESTARTS, 3);
});

test('restart history older than the window does not count as a crash loop', async () => {
  const { watchdog, advance, exits } = harness();
  watchdog.register(failingSubject('storage', { maxLevel: RECOVERY_LEVELS.REQUEST_CONTAINER_RESTART, idempotentRetry: true }));
  watchdog.recordRestartRequest('old 1');
  watchdog.recordRestartRequest('old 2');
  advance(11 * 60_000);
  for (let round = 0; round < 4; round += 1) await watchdog.runOnce({ force: true });
  assert.equal(watchdog.safeMode.active, false);
  assert.deepEqual(exits, [70]);
});

test('a crash loop recorded before this boot puts the process straight into safe mode', () => {
  const root = mkdtempSync(join(tmpdir(), 'noesar-wd-boot-'));
  const first = harness({ root });
  first.watchdog.recordRestartRequest('r1');
  first.watchdog.recordRestartRequest('r2');
  first.watchdog.recordRestartRequest('r3');
  const second = harness({ root });
  assert.equal(second.watchdog.safeMode.active, true, 'the next boot must notice the persisted crash loop');
  assert.equal(second.watchdog.report().crashLoop, true);
});

test('safe mode disables providers, agents, tools and every mutation', () => {
  const { watchdog } = harness();
  watchdog.enterSafeMode('unit test');
  for (const operation of ['write', 'provider.call', 'agent.run', 'tool.execute', 'update.apply', 'document.write']) {
    assert.equal(watchdog.isOperationAllowed(operation), false, `${operation} must be blocked`);
    assert.throws(() => watchdog.assertOperationAllowed(operation), /safe mode/);
  }
});

test('safe mode keeps documents, audit and health readable', () => {
  const { watchdog } = harness();
  watchdog.enterSafeMode('unit test');
  for (const operation of ['read', 'document.read', 'audit.read', 'health.read', 'diagnostics.read']) {
    assert.equal(watchdog.isOperationAllowed(operation), true, `${operation} must remain available`);
    assert.doesNotThrow(() => watchdog.assertOperationAllowed(operation));
  }
});

test('rollback stays available in safe mode, because that is how you get out', () => {
  const { watchdog } = harness();
  watchdog.enterSafeMode('failed update');
  assert.equal(watchdog.isOperationAllowed('update.rollback'), true);
  assert.equal(watchdog.isOperationAllowed('update.apply'), false);
});

test('nothing is blocked when safe mode is off', () => {
  const { watchdog } = harness();
  for (const operation of ['write', 'provider.call', 'agent.run']) {
    assert.equal(watchdog.isOperationAllowed(operation), true);
  }
});

test('leaving safe mode clears the restart history and resets subjects', async () => {
  const { watchdog } = harness();
  watchdog.register(failingSubject('storage', { maxLevel: RECOVERY_LEVELS.RESTART_RUNTIME, idempotentRetry: true }));
  await watchdog.runOnce({ force: true });
  watchdog.recordRestartRequest('r1');
  watchdog.enterSafeMode('unit test');
  watchdog.leaveSafeMode({ actorId: 'owner-1' });
  assert.equal(watchdog.safeMode.active, false);
  assert.equal(watchdog.report().restartsInWindow, 0);
  assert.equal(watchdog.report().subjects[0].level, RECOVERY_LEVELS.OBSERVE);
});

test('escalation at level 3 and above notifies the owner', async () => {
  const { watchdog, notifications } = harness();
  watchdog.register(failingSubject('control-plane', { maxLevel: RECOVERY_LEVELS.RESTART_RUNTIME, idempotentRetry: true }));
  await watchdog.runOnce({ force: true });
  await watchdog.runOnce({ force: true });
  assert.equal(notifications.length, 0, 'levels 1 and 2 do not notify');
  await watchdog.runOnce({ force: true });
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].level, RECOVERY_LEVELS.RESTART_RUNTIME);
});

test('entering safe mode notifies the owner', () => {
  const { watchdog, notifications } = harness();
  watchdog.enterSafeMode('unit test');
  assert.equal(notifications.filter((n) => n.kind === 'safe-mode').length, 1);
});

test('a notification sink that throws cannot break recovery', () => {
  const root = mkdtempSync(join(tmpdir(), 'noesar-wd-n-'));
  const watchdog = new Watchdog({
    statePath: watchdogStatePath(root),
    notify: () => { throw new Error('sink is down'); },
  });
  assert.doesNotThrow(() => watchdog.enterSafeMode('unit test'));
  assert.equal(watchdog.safeMode.active, true);
});

test('escalations and safe mode are written to the audit ledger', async () => {
  const { watchdog, ledger } = harness();
  watchdog.register(failingSubject('storage', { maxLevel: RECOVERY_LEVELS.RETRY, idempotentRetry: true }));
  await watchdog.runOnce({ force: true });
  watchdog.enterSafeMode('unit test');
  const actions = ledger.readAll().map((event) => event.action);
  assert.ok(actions.includes('watchdog.escalation'));
  assert.ok(actions.includes('watchdog.safe-mode.entered'));
  assert.equal(ledger.verify(), true);
});

test('escalations are counted as metrics', async () => {
  const { watchdog, metrics } = harness();
  watchdog.register(failingSubject('storage', { maxLevel: RECOVERY_LEVELS.RETRY, idempotentRetry: true }));
  await watchdog.runOnce({ force: true });
  watchdog.enterSafeMode('unit test');
  const rendered = metrics.render();
  assert.match(rendered, /noesar_watchdog_escalations_total\{level="1"\} 1/);
  assert.match(rendered, /noesar_safe_mode 1/);
});

test('a probe that throws is treated as a failure, not as a crash', async () => {
  const { watchdog } = harness();
  watchdog.register({
    name: 'providers', failureThreshold: 1, maxLevel: RECOVERY_LEVELS.RETRY, idempotentRetry: true,
    probe: () => { throw new Error('probe exploded'); },
  });
  await assert.doesNotReject(() => watchdog.runOnce({ force: true }));
  const subject = watchdog.report().subjects[0];
  assert.equal(subject.healthy, false);
  assert.equal(subject.detail.error, 'probe exploded');
});

test('essential subject failures are reported separately for readiness', async () => {
  const { watchdog } = harness();
  watchdog.register({ name: 'storage', probe: () => ({ healthy: false }), essential: true });
  watchdog.register({ name: 'gpu', probe: () => ({ healthy: false }), essential: false });
  await watchdog.runOnce({ force: true });
  assert.deepEqual(watchdog.report().essentialFailures, ['storage']);
});

test('diagnostics are captured before a restart is requested', async () => {
  const { watchdog, root } = harness();
  watchdog.register(failingSubject('control-plane', { maxLevel: RECOVERY_LEVELS.REQUEST_CONTAINER_RESTART, idempotentRetry: true }));
  for (let round = 0; round < 4; round += 1) await watchdog.runOnce({ force: true });
  const state = JSON.parse(readFileSync(watchdogStatePath(root), 'utf8'));
  assert.ok(state.checkpoints.length >= 2, 'levels 3 and 4 must both leave a checkpoint');
  assert.ok(state.lastExit, 'the exit reason must be persisted for the next boot');
  assert.match(state.lastExit.reason, /level 4/);
});
