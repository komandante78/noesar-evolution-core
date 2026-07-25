// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Owner-only, time-boxed debug tracing.
//
// A debug switch left on becomes a permanent verbose-logging vulnerability and,
// on a host with no swap and a shared workspace filesystem, an availability
// problem too. There is therefore no indefinite mode: activation always carries
// a scope and a deadline, and expiry is enforced both lazily (on every check)
// and actively (by the watchdog sweep).
import { randomUUID } from 'node:crypto';
import { toUtcIso } from './timezone.mjs';

export const DEBUG_SCOPES = Object.freeze([
  'api', 'provider', 'rag', 'memory', 'agents', 'tools', 'mcp', 'workflow',
]);

export const MAX_TTL_MINUTES = 60;
export const DEFAULT_TTL_MINUTES = 15;

function fail(message, status = 400) {
  return Object.assign(new Error(message), { status });
}

export class DebugMode {
  constructor({ logger = null, ledger = null, clock = Date.now } = {}) {
    this.logger = logger;
    this.ledger = ledger;
    this.clock = clock;
    this.active = null;
    this.history = [];
  }

  /** Expire an elapsed session. Called on every read and by the watchdog. */
  sweep() {
    if (!this.active) return false;
    if (this.clock() < this.active.expiresAtMs) return false;
    this.#deactivate('expired', 'system');
    return true;
  }

  status() {
    this.sweep();
    if (!this.active) {
      return {
        enabled: false, scopes: [], incidentId: null, expiresAt: null,
        remainingSeconds: 0, maxTtlMinutes: MAX_TTL_MINUTES, availableScopes: [...DEBUG_SCOPES],
      };
    }
    return {
      enabled: true,
      scopes: [...this.active.scopes],
      incidentId: this.active.incidentId,
      enabledAt: this.active.enabledAt,
      expiresAt: this.active.expiresAt,
      remainingSeconds: Math.max(0, Math.round((this.active.expiresAtMs - this.clock()) / 1000)),
      maxTtlMinutes: MAX_TTL_MINUTES,
      availableScopes: [...DEBUG_SCOPES],
      actorId: this.active.actorId,
    };
  }

  enable({ scopes, ttlMinutes = DEFAULT_TTL_MINUTES, actorId = 'owner', reason = null } = {}) {
    this.sweep();
    if (!Array.isArray(scopes) || scopes.length === 0) throw fail('At least one debug scope is required.');
    const requested = [...new Set(scopes.map((value) => String(value).toLowerCase().trim()))];
    const unknown = requested.filter((scope) => !DEBUG_SCOPES.includes(scope));
    if (unknown.length) throw fail(`Unknown debug scope(s): ${unknown.join(', ')}.`);
    const ttl = Number(ttlMinutes);
    if (!Number.isFinite(ttl) || ttl <= 0) throw fail('ttlMinutes must be a positive number.');
    if (ttl > MAX_TTL_MINUTES) throw fail(`Debug mode cannot exceed ${MAX_TTL_MINUTES} minutes.`);

    const now = this.clock();
    this.active = {
      incidentId: `INC-${randomUUID()}`,
      scopes: requested,
      actorId,
      reason: reason ? String(reason).slice(0, 200) : null,
      enabledAt: toUtcIso(now),
      expiresAt: toUtcIso(now + ttl * 60_000),
      expiresAtMs: now + ttl * 60_000,
      ttlMinutes: ttl,
      traceCount: 0,
    };
    this.logger?.setLevelOverride('DEBUG');
    this.ledger?.append({
      actor: actorId, action: 'debug.enabled', result: 'success',
      details: {
        incidentId: this.active.incidentId, scopes: requested, ttlMinutes: ttl,
        expiresAt: this.active.expiresAt,
      },
    });
    this.logger?.warn('debug.enabled', {
      component: 'debug', incident_id: this.active.incidentId,
      scopes: requested, ttl_minutes: ttl, expires_at: this.active.expiresAt,
    });
    return this.status();
  }

  disable({ actorId = 'owner' } = {}) {
    if (!this.active) return this.status();
    this.#deactivate('manual', actorId);
    return this.status();
  }

  #deactivate(cause, actorId) {
    const session = this.active;
    this.active = null;
    this.logger?.setLevelOverride(null);
    const record = {
      incidentId: session.incidentId, scopes: session.scopes, cause,
      enabledAt: session.enabledAt, disabledAt: toUtcIso(this.clock()),
      traceCount: session.traceCount, actorId: session.actorId,
    };
    this.history.push(record);
    if (this.history.length > 50) this.history.shift();
    this.ledger?.append({ actor: actorId, action: 'debug.disabled', result: 'success', details: record });
    this.logger?.info('debug.disabled', { component: 'debug', incident_id: record.incidentId, cause });
  }

  isActive(scope = null) {
    this.sweep();
    if (!this.active) return false;
    if (scope === null) return true;
    return this.active.scopes.includes(String(scope).toLowerCase());
  }

  /**
   * Emit a trace record for one subsystem. Payload fields still pass through the
   * logger's sink redaction; nothing here can opt out of it.
   */
  trace(scope, event, fields = {}) {
    if (!this.isActive(scope)) return null;
    this.active.traceCount += 1;
    return this.logger?.debug(event, {
      ...fields,
      component: fields.component ?? scope,
      debug_scope: scope,
      incident_id: this.active.incidentId,
    }) ?? null;
  }

  /**
   * Redacted support bundle. Carries versions, posture, recent operational logs
   * and subsystem snapshots — never secrets, conversation content or documents.
   */
  bundle({ product = {}, health = null, watchdog = null, updates = null, host = null, timezone = null, logs = null } = {}) {
    this.sweep();
    return {
      kind: 'noesar-diagnostic-bundle',
      schemaVersion: 1,
      generatedAt: toUtcIso(this.clock()),
      redaction: 'on',
      contains: {
        secrets: false, conversationContent: false, documents: false,
        prompts: false, credentials: false, userIdentifiers: false,
      },
      product,
      host,
      timezone,
      debug: this.status(),
      debugHistory: this.history.slice(-10),
      health,
      watchdog,
      updates,
      logs: logs ?? { entries: [], note: 'log excerpt not requested' },
    };
  }
}
