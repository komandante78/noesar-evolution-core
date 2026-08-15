// SPDX-License-Identifier: AGPL-3.0-or-later
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DebugMode, DEBUG_SCOPES, MAX_TTL_MINUTES } from '../src/debug-mode.mjs';
import { Logger } from '../src/logging.mjs';
import { AuditLedger } from '../src/audit.mjs';
import { freshTempDir } from './support/workspace.mjs';

function harness() {
  const root = freshTempDir('noesar-debug-');
  const logger = new Logger({ dir: join(root, 'logs'), stdout: false, level: 'INFO' });
  const ledger = new AuditLedger(join(root, 'audit/events.jsonl'));
  let now = Date.parse('2026-07-25T06:00:00Z');
  const debug = new DebugMode({ logger, ledger, clock: () => now });
  return { root, logger, ledger, debug, advance: (ms) => { now += ms; }, at: () => now };
}

test('debug mode is off by default', () => {
  const { debug } = harness();
  const status = debug.status();
  assert.equal(status.enabled, false);
  assert.deepEqual(status.scopes, []);
  assert.equal(status.incidentId, null);
  assert.equal(debug.isActive(), false);
  assert.equal(debug.isActive('provider'), false);
});

test('a scope is mandatory', () => {
  const { debug } = harness();
  assert.throws(() => debug.enable({ scopes: [] }), /At least one debug scope/);
  assert.throws(() => debug.enable({}), /At least one debug scope/);
  assert.throws(() => debug.enable({ scopes: ['not-a-scope'] }), /Unknown debug scope/);
  assert.equal(debug.status().enabled, false);
});

test('every documented subsystem can be traced', () => {
  assert.deepEqual(DEBUG_SCOPES, ['api', 'provider', 'rag', 'memory', 'agents', 'tools', 'mcp', 'workflow']);
  const { debug } = harness();
  const status = debug.enable({ scopes: [...DEBUG_SCOPES], ttlMinutes: 5 });
  for (const scope of DEBUG_SCOPES) assert.equal(debug.isActive(scope), true, `${scope} must be traceable`);
  assert.equal(status.scopes.length, DEBUG_SCOPES.length);
});

test('only the selected scopes are traced', () => {
  const { debug } = harness();
  debug.enable({ scopes: ['provider', 'rag'], ttlMinutes: 5 });
  assert.equal(debug.isActive('provider'), true);
  assert.equal(debug.isActive('rag'), true);
  assert.equal(debug.isActive('tools'), false);
  assert.equal(debug.trace('tools', 'tool.call'), null);
  assert.ok(debug.trace('provider', 'provider.call'));
});

test('the duration is bounded and cannot be made indefinite', () => {
  const { debug } = harness();
  assert.equal(MAX_TTL_MINUTES, 60);
  assert.throws(() => debug.enable({ scopes: ['api'], ttlMinutes: 61 }), /cannot exceed 60 minutes/);
  assert.throws(() => debug.enable({ scopes: ['api'], ttlMinutes: 0 }), /positive number/);
  assert.throws(() => debug.enable({ scopes: ['api'], ttlMinutes: Infinity }), /positive number/);
  assert.throws(() => debug.enable({ scopes: ['api'], ttlMinutes: -5 }), /positive number/);
});

test('debug mode expires automatically without any operator action', () => {
  const { debug, advance } = harness();
  debug.enable({ scopes: ['api'], ttlMinutes: 10 });
  assert.equal(debug.status().enabled, true);
  advance(9 * 60_000);
  assert.equal(debug.status().enabled, true);
  advance(2 * 60_000);
  assert.equal(debug.status().enabled, false, 'the session must expire on its own');
  assert.equal(debug.isActive('api'), false);
});

test('the sweep expires a session even when nothing else is called', () => {
  const { debug, advance } = harness();
  debug.enable({ scopes: ['api'], ttlMinutes: 1 });
  advance(2 * 60_000);
  assert.equal(debug.sweep(), true);
  assert.equal(debug.status().enabled, false);
});

test('expiry restores the logger level so verbose logging cannot persist', () => {
  const { debug, logger, advance } = harness();
  assert.equal(logger.isEnabled('DEBUG'), false);
  debug.enable({ scopes: ['api'], ttlMinutes: 5 });
  assert.equal(logger.isEnabled('DEBUG'), true);
  advance(6 * 60_000);
  debug.sweep();
  assert.equal(logger.isEnabled('DEBUG'), false, 'verbose logging must not outlive the debug session');
});

test('each activation carries a unique incident id', () => {
  const { debug } = harness();
  const first = debug.enable({ scopes: ['api'], ttlMinutes: 5 }).incidentId;
  debug.disable({});
  const second = debug.enable({ scopes: ['api'], ttlMinutes: 5 }).incidentId;
  assert.match(first, /^INC-/);
  assert.notEqual(first, second);
});

test('activation, scope, duration and deactivation are all audited', () => {
  const { debug, ledger, advance } = harness();
  debug.enable({ scopes: ['provider'], ttlMinutes: 5, actorId: 'owner-1' });
  advance(6 * 60_000);
  debug.sweep();
  const events = ledger.readAll();
  const enabled = events.find((event) => event.action === 'debug.enabled');
  const disabled = events.find((event) => event.action === 'debug.disabled');
  assert.equal(enabled.actor, 'owner-1');
  assert.deepEqual(enabled.details.scopes, ['provider']);
  assert.equal(enabled.details.ttlMinutes, 5);
  assert.equal(disabled.details.cause, 'expired');
  assert.equal(ledger.verify(), true);
});

test('traced payloads still pass through sink redaction', () => {
  const { debug, logger } = harness();
  debug.enable({ scopes: ['provider'], ttlMinutes: 5 });
  debug.trace('provider', 'provider.request', {
    apiKey: 'sk-must-not-leak-0123456789abcdef',
    prompt: 'a private user question',
    endpoint: 'https://example.invalid/v1',
  });
  const raw = readFileSync(logger.activePath, 'utf8');
  assert.ok(!raw.includes('must-not-leak'));
  assert.ok(!raw.includes('a private user question'));
  assert.ok(raw.includes('provider.request'));
});

test('a trace record carries its incident id and scope', () => {
  const { debug } = harness();
  const incidentId = debug.enable({ scopes: ['agents'], ttlMinutes: 5 }).incidentId;
  const record = debug.trace('agents', 'agent.step', { agent_id: 'a1' });
  assert.equal(record.incident_id, incidentId);
  assert.equal(record.debug_scope, 'agents');
  assert.equal(record.level, 'DEBUG');
});

test('the support bundle declares its redaction posture and carries no content', () => {
  const { debug } = harness();
  debug.enable({ scopes: ['api'], ttlMinutes: 5 });
  const bundle = debug.bundle({
    product: { name: 'NOESAR Evolution', version: '0.6.0' },
    health: { status: 'healthy' },
    watchdog: { safeMode: { active: false } },
  });
  assert.equal(bundle.redaction, 'on');
  assert.equal(bundle.contains.secrets, false);
  assert.equal(bundle.contains.conversationContent, false);
  assert.equal(bundle.contains.documents, false);
  assert.ok(bundle.generatedAt.endsWith('Z'));
  assert.equal(bundle.debug.enabled, true);
  const serialized = JSON.stringify(bundle);
  assert.ok(!serialized.includes('password'));
  assert.ok(!serialized.includes('token'));
});

test('the bundle records recent debug history for the post-mortem', () => {
  const { debug, advance } = harness();
  debug.enable({ scopes: ['api'], ttlMinutes: 1, actorId: 'owner-1' });
  advance(2 * 60_000);
  debug.sweep();
  const bundle = debug.bundle({});
  assert.equal(bundle.debug.enabled, false);
  assert.equal(bundle.debugHistory.length, 1);
  assert.equal(bundle.debugHistory[0].cause, 'expired');
});

test('manual disable is recorded with its cause', () => {
  const { debug, ledger } = harness();
  debug.enable({ scopes: ['api'], ttlMinutes: 30 });
  debug.disable({ actorId: 'owner-1' });
  const disabled = ledger.readAll().find((event) => event.action === 'debug.disabled');
  assert.equal(disabled.details.cause, 'manual');
  assert.equal(debug.status().enabled, false);
});
