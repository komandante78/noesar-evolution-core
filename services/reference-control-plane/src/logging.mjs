// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Structured operational logging.
//
// Two properties are structural rather than conventional:
//   1. Redaction runs on the WRITE PATH, not at call sites, so a new call site
//      cannot forget it.
//   2. Operational logs and the audit ledger are different stores. Rotation and
//      quota enforcement delete operational logs; they can never reach audit
//      history, because this logger refuses to be pointed at an audit directory.
import {
  appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync,
  statSync, unlinkSync, writeFileSync,
} from 'node:fs';
import { gzipSync, gunzipSync } from 'node:zlib';
import { basename, join, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { redactText } from './ai-workspace/privacy-redaction.mjs';

export const LEVELS = Object.freeze({ TRACE: 10, DEBUG: 20, INFO: 30, WARN: 40, ERROR: 50, FATAL: 60 });
export const LEVEL_NAMES = Object.freeze(Object.keys(LEVELS));

const ACTIVE_FILE = 'noesar.log';
const ROTATED_PREFIX = 'noesar-';
const ROTATED_SUFFIX = '.log.gz';

// Keys whose value is replaced wholesale. Pattern matching a secret's *shape* is
// unreliable; matching the field that carries it is not.
const SECRET_KEY = /(pass(word|phrase)?|secret|token|cookie|authorization|auth[-_]?header|api[-_]?key|apikey|credential|private[-_]?key|session[-_]?id|csrf|totp|otp|bearer|signature)/i;

// Content that must never reach an operational log even unredacted, because
// redaction cannot make a prompt or a document safe — only absence can.
const CONTENT_KEY = /^(prompt|prompts|content|messages|document|documents|text|body|payload|completion|answer|excerpt)$/i;

const MAX_DEPTH = 6;
const MAX_ARRAY = 64;
const MAX_STRING = 4096;

function levelValue(name) {
  const value = LEVELS[String(name ?? '').toUpperCase()];
  return value ?? LEVELS.INFO;
}

/** Redact one value. Strings go through the shared privacy rules; numbers do not,
 *  so a 13-digit epoch is not mistaken for a payment number. */
function redactValue(key, value, depth) {
  if (value === null || value === undefined) return value;
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return String(value);
  if (key && SECRET_KEY.test(key)) return '[REDACTED]';
  if (key && CONTENT_KEY.test(key)) return '[OMITTED_CONTENT]';
  if (typeof value === 'string') {
    const clipped = value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…[truncated]` : value;
    return redactText(clipped).text;
  }
  if (depth >= MAX_DEPTH) return '[DEPTH_LIMIT]';
  if (Array.isArray(value)) {
    const items = value.slice(0, MAX_ARRAY).map((item) => redactValue(null, item, depth + 1));
    if (value.length > MAX_ARRAY) items.push(`[${value.length - MAX_ARRAY} more]`);
    return items;
  }
  if (value instanceof Error) {
    return { name: value.name, message: redactText(String(value.message)).text };
  }
  if (typeof value === 'object') {
    const out = {};
    for (const [name, item] of Object.entries(value)) out[name] = redactValue(name, item, depth + 1);
    return out;
  }
  return String(value);
}

export function redactRecord(record) {
  return redactValue(null, record, 0);
}

export function newCorrelationId() { return randomUUID(); }

function utcDay(ms) { return new Date(ms).toISOString().slice(0, 10); }

export class Logger {
  /**
   * @param {object} options
   * @param {string|null} options.dir            directory for rotated log files; null = stdout only
   * @param {string} options.level               minimum level name
   * @param {string} options.component           default component id
   * @param {boolean} options.stdout             also emit to stdout (Docker log capture)
   * @param {number} options.maxFileBytes        rotate the active file above this size
   * @param {number} options.keepFiles           number of rotated archives to keep
   * @param {number} options.quotaBytes          hard cap for the whole log directory
   * @param {() => number} options.clock         injectable clock (tests)
   */
  constructor({
    dir = null,
    level = process.env.NOESAR_LOG_LEVEL ?? 'INFO',
    component = 'control-plane',
    stdout = true,
    maxFileBytes = 64 * 1024 * 1024,
    keepFiles = 14,
    quotaBytes = 2 * 1024 * 1024 * 1024,
    quotaCheckEvery = 256,
    clock = Date.now,
    bindings = {},
  } = {}) {
    this.dir = dir ? resolve(dir) : null;
    if (this.dir) {
      // Structural guarantee: rotation must never be able to touch audit history.
      const segments = this.dir.split(sep);
      if (segments.includes('audit')) throw new Error('The operational log directory must not live under an audit path.');
      mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    }
    this.minLevel = levelValue(level);
    this.component = component;
    this.stdout = stdout;
    this.maxFileBytes = maxFileBytes;
    this.keepFiles = keepFiles;
    this.quotaBytes = quotaBytes;
    this.quotaCheckEvery = Math.max(1, quotaCheckEvery);
    this.sinceQuotaCheck = 0;
    this.clock = clock;
    this.bindings = bindings;
    this.dropped = 0;
    this.written = 0;
    this.bytesWritten = 0;
    this.activeDay = null;
    this.levelOverride = null;
  }

  /** Returns a logger that shares this sink but carries extra fixed fields.
   *  Delegation is explicit rather than prototypal: private methods are not
   *  reachable through a prototype-linked object. */
  child(bindings) {
    return new BoundLogger(this, { ...this.bindings, ...bindings });
  }

  /** Debug mode raises verbosity temporarily without mutating configuration. */
  setLevelOverride(levelName) {
    this.levelOverride = levelName ? levelValue(levelName) : null;
  }

  effectiveLevel() {
    if (this.levelOverride !== null) return Math.min(this.levelOverride, this.minLevel);
    return this.minLevel;
  }

  isEnabled(levelName) { return levelValue(levelName) >= this.effectiveLevel(); }

  get activePath() { return this.dir ? join(this.dir, ACTIVE_FILE) : null; }

  log(levelName, event, fields = {}) {
    const level = String(levelName).toUpperCase();
    if (!this.isEnabled(level)) return null;
    const now = this.clock();
    const record = {
      ts: new Date(now).toISOString(),
      level,
      event: String(event),
      component: fields.component ?? this.bindings.component ?? this.component,
      ...this.bindings,
      ...fields,
    };
    record.ts = new Date(now).toISOString();
    record.level = level;
    record.event = String(event);
    const safe = redactRecord(record);
    const line = JSON.stringify(safe);
    if (this.stdout) process.stdout.write(`${line}\n`);
    if (this.dir) this.#write(line, now);
    this.written += 1;
    return safe;
  }

  trace(event, fields) { return this.log('TRACE', event, fields); }
  debug(event, fields) { return this.log('DEBUG', event, fields); }
  info(event, fields) { return this.log('INFO', event, fields); }
  warn(event, fields) { return this.log('WARN', event, fields); }
  error(event, fields) { return this.log('ERROR', event, fields); }
  fatal(event, fields) { return this.log('FATAL', event, fields); }

  #write(line, now) {
    const path = this.activePath;
    const bytes = Buffer.byteLength(line) + 1;
    let size = 0;
    try { size = statSync(path).size; } catch { size = 0; }
    if (this.activeDay === null) this.activeDay = size > 0 ? this.#firstDay(path) : utcDay(now);
    const dayRolled = this.activeDay !== utcDay(now);
    if (size > 0 && (size + bytes > this.maxFileBytes || dayRolled)) this.rotate(now);
    appendFileSync(path, `${line}\n`, { encoding: 'utf8', mode: 0o600 });
    this.bytesWritten += bytes;
    this.activeDay = utcDay(now);
    // Quota accounting walks the directory, so it is checked on rotation and
    // periodically — not on every line, which would make logging O(files) per call.
    this.sinceQuotaCheck = (this.sinceQuotaCheck ?? 0) + 1;
    if (this.sinceQuotaCheck >= this.quotaCheckEvery) {
      this.sinceQuotaCheck = 0;
      this.#enforceQuota(now);
    }
  }

  #firstDay(path) {
    try {
      const head = readFileSync(path, 'utf8').split('\n', 1)[0];
      return JSON.parse(head).ts.slice(0, 10);
    } catch { return utcDay(this.clock()); }
  }

  /** Compress the active file into a timestamped archive and start a fresh one. */
  rotate(now = this.clock()) {
    if (!this.dir) return null;
    const path = this.activePath;
    if (!existsSync(path) || statSync(path).size === 0) return null;
    // Two rotations inside the same millisecond must not produce the same
    // filename: the second would silently overwrite the first and destroy logs.
    // Every archive therefore carries a sequence suffix, in a fixed shape so
    // lexicographic order stays chronological.
    const stamp = new Date(now).toISOString().replace(/[:.]/g, '-');
    let sequence = 0;
    let archive = join(this.dir, `${ROTATED_PREFIX}${stamp}-${String(sequence).padStart(4, '0')}${ROTATED_SUFFIX}`);
    while (existsSync(archive)) {
      sequence += 1;
      if (sequence > 9999) throw new Error('Log rotation exhausted the per-millisecond archive sequence.');
      archive = join(this.dir, `${ROTATED_PREFIX}${stamp}-${String(sequence).padStart(4, '0')}${ROTATED_SUFFIX}`);
    }
    writeFileSync(archive, gzipSync(readFileSync(path)), { mode: 0o600 });
    writeFileSync(path, '', { mode: 0o600 });
    this.activeDay = utcDay(now);
    this.#enforceRetention();
    this.#enforceQuota(now);
    this.sinceQuotaCheck = 0;
    return archive;
  }

  archives() {
    if (!this.dir) return [];
    return readdirSync(this.dir)
      .filter((name) => name.startsWith(ROTATED_PREFIX) && name.endsWith(ROTATED_SUFFIX))
      .sort();
  }

  #enforceRetention() {
    const archives = this.archives();
    const excess = archives.length - this.keepFiles;
    for (let index = 0; index < excess; index += 1) {
      unlinkSync(join(this.dir, archives[index]));
      this.dropped += 1;
    }
  }

  directoryBytes() {
    if (!this.dir) return 0;
    let total = 0;
    for (const name of readdirSync(this.dir)) {
      try { total += statSync(join(this.dir, name)).size; } catch { /* removed concurrently */ }
    }
    return total;
  }

  #enforceQuota(now) {
    if (!this.dir) return;
    let total = this.directoryBytes();
    if (total <= this.quotaBytes) return;
    for (const name of this.archives()) {
      if (total <= this.quotaBytes) break;
      const target = join(this.dir, name);
      let size = 0;
      try { size = statSync(target).size; } catch { continue; }
      unlinkSync(target);
      total -= size;
      this.dropped += 1;
      const warning = JSON.stringify({
        ts: new Date(now).toISOString(), level: 'WARN', event: 'log.quota.enforced',
        component: 'logging', msg: 'log archive dropped to stay within quota',
        file: name, bytes: size, quotaBytes: this.quotaBytes,
      });
      appendFileSync(this.activePath, `${warning}\n`, { encoding: 'utf8', mode: 0o600 });
      if (this.stdout) process.stdout.write(`${warning}\n`);
    }
  }

  /** Owner-facing log search. Newest first. */
  search({ level = null, component = null, correlationId = null, event = null, text = null, since = null, until = null, limit = 200 } = {}) {
    if (!this.dir) return { entries: [], scannedFiles: 0, truncated: false };
    const minLevel = level ? levelValue(level) : 0;
    const sinceMs = since ? Date.parse(since) : null;
    const untilMs = until ? Date.parse(until) : null;
    const needle = text ? String(text).toLowerCase() : null;
    const files = [ACTIVE_FILE, ...this.archives().reverse()];
    const entries = [];
    let scanned = 0;
    for (const name of files) {
      if (entries.length >= limit) break;
      const path = join(this.dir, name);
      if (!existsSync(path)) continue;
      scanned += 1;
      let content;
      try {
        content = name.endsWith(ROTATED_SUFFIX) ? gunzipSync(readFileSync(path)).toString('utf8') : readFileSync(path, 'utf8');
      } catch { continue; }
      const lines = content.split('\n').filter(Boolean);
      for (let index = lines.length - 1; index >= 0 && entries.length < limit; index -= 1) {
        let record;
        try { record = JSON.parse(lines[index]); } catch { continue; }
        if (levelValue(record.level) < minLevel) continue;
        if (component && record.component !== component) continue;
        if (correlationId && record.correlation_id !== correlationId) continue;
        if (event && record.event !== event) continue;
        const ts = Date.parse(record.ts);
        if (sinceMs !== null && !(ts >= sinceMs)) continue;
        if (untilMs !== null && !(ts <= untilMs)) continue;
        if (needle && !lines[index].toLowerCase().includes(needle)) continue;
        entries.push(record);
      }
    }
    return { entries, scannedFiles: scanned, truncated: entries.length >= limit };
  }

  stats() {
    const archives = this.archives();
    return {
      dir: this.dir ? basename(this.dir) : null,
      level: LEVEL_NAMES.find((name) => LEVELS[name] === this.effectiveLevel()) ?? 'INFO',
      written: this.written,
      droppedArchives: this.dropped,
      archiveCount: archives.length,
      bytes: this.directoryBytes(),
      quotaBytes: this.quotaBytes,
      maxFileBytes: this.maxFileBytes,
      keepFiles: this.keepFiles,
      redaction: 'on',
    };
  }
}

/** A view over a Logger that adds fixed fields to every record it emits. */
export class BoundLogger {
  constructor(parent, bindings) {
    this.parent = parent;
    this.bindings = bindings;
  }

  child(bindings) { return new BoundLogger(this.parent, { ...this.bindings, ...bindings }); }
  isEnabled(levelName) { return this.parent.isEnabled(levelName); }
  log(levelName, event, fields = {}) { return this.parent.log(levelName, event, { ...this.bindings, ...fields }); }
  trace(event, fields) { return this.log('TRACE', event, fields); }
  debug(event, fields) { return this.log('DEBUG', event, fields); }
  info(event, fields) { return this.log('INFO', event, fields); }
  warn(event, fields) { return this.log('WARN', event, fields); }
  error(event, fields) { return this.log('ERROR', event, fields); }
  fatal(event, fields) { return this.log('FATAL', event, fields); }
  search(query) { return this.parent.search(query); }
  stats() { return this.parent.stats(); }
  get activePath() { return this.parent.activePath; }
}

export function createLogger(options) { return new Logger(options); }
