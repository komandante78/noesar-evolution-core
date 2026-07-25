// SPDX-License-Identifier: AGPL-3.0-or-later
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { gunzipSync } from 'node:zlib';
import { Logger, LEVELS, redactRecord } from '../src/logging.mjs';

function workspace() { return mkdtempSync(join(tmpdir(), 'noesar-log-')); }
function logger(dir, options = {}) {
  return new Logger({ dir, stdout: false, quotaCheckEvery: 1, ...options });
}
function readActive(log) {
  return readFileSync(log.activePath, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line));
}

test('timestamps are UTC ISO-8601 with an explicit Z', () => {
  const log = logger(join(workspace(), 'logs'));
  log.info('unit.test', { msg: 'hello' });
  const [record] = readActive(log);
  assert.match(record.ts, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  assert.equal(new Date(record.ts).toISOString(), record.ts);
});

test('all six levels exist and the minimum level filters', () => {
  assert.deepEqual(Object.keys(LEVELS), ['TRACE', 'DEBUG', 'INFO', 'WARN', 'ERROR', 'FATAL']);
  const log = logger(join(workspace(), 'logs'), { level: 'WARN' });
  log.trace('a'); log.debug('b'); log.info('c'); log.warn('d'); log.error('e'); log.fatal('f');
  assert.deepEqual(readActive(log).map((r) => r.level), ['WARN', 'ERROR', 'FATAL']);
});

test('debug-mode level override lowers the threshold without mutating configuration', () => {
  const log = logger(join(workspace(), 'logs'), { level: 'INFO' });
  assert.equal(log.isEnabled('DEBUG'), false);
  log.setLevelOverride('TRACE');
  assert.equal(log.isEnabled('TRACE'), true);
  log.setLevelOverride(null);
  assert.equal(log.isEnabled('DEBUG'), false);
  assert.equal(log.minLevel, LEVELS.INFO);
});

test('redaction runs at the sink: secret-bearing keys never reach the file', () => {
  const log = logger(join(workspace(), 'logs'));
  log.info('provider.call', {
    password: 'correct-horse-battery-staple',
    apiKey: 'sk-must-not-leak-0123456789abcdef',
    authorization: 'Bearer must-not-leak-0123456789',
    nested: { session_id: 'must-not-leak-session', ok: 'visible' },
  });
  const raw = readFileSync(log.activePath, 'utf8');
  assert.ok(!raw.includes('must-not-leak'), 'no secret substring may appear in the log file');
  assert.ok(!raw.includes('correct-horse'), 'no password may appear in the log file');
  const [record] = readActive(log);
  assert.equal(record.password, '[REDACTED]');
  assert.equal(record.apiKey, '[REDACTED]');
  assert.equal(record.authorization, '[REDACTED]');
  assert.equal(record.nested.session_id, '[REDACTED]');
  assert.equal(record.nested.ok, 'visible');
});

test('an unnamed secret in free text is still redacted by shape', () => {
  const log = logger(join(workspace(), 'logs'));
  log.info('tool.call', { msg: 'called with Bearer abcdefghijklmnop0123 and key sk-abcdefghijklmnop0123' });
  const raw = readFileSync(log.activePath, 'utf8');
  assert.ok(!raw.includes('abcdefghijklmnop0123'));
  assert.match(readActive(log)[0].msg, /REDACTED/);
});

test('prompt and document content is omitted, not merely redacted', () => {
  const log = logger(join(workspace(), 'logs'));
  log.info('chat.turn', { prompt: 'private user question', documents: ['a confidential paragraph'] });
  const raw = readFileSync(log.activePath, 'utf8');
  assert.ok(!raw.includes('private user question'));
  assert.ok(!raw.includes('confidential paragraph'));
  assert.equal(readActive(log)[0].prompt, '[OMITTED_CONTENT]');
});

test('numeric fields survive redaction (a 13-digit epoch is not a payment number)', () => {
  const log = logger(join(workspace(), 'logs'));
  const epoch = 1774339200000;
  log.info('http.request', { startedAt: epoch, ms: 142, status: 200 });
  const [record] = readActive(log);
  assert.equal(record.startedAt, epoch);
  assert.equal(record.ms, 142);
  assert.equal(record.status, 200);
});

test('correlation, component, project, conversation and task ids are carried', () => {
  const log = logger(join(workspace(), 'logs'));
  const bound = log.child({ correlation_id: 'corr-1', component: 'chat', project_id: 'p1' });
  bound.info('chat.started', { conversation_id: 'c1', task_id: 't1' });
  const [record] = readActive(log);
  assert.equal(record.correlation_id, 'corr-1');
  assert.equal(record.component, 'chat');
  assert.equal(record.project_id, 'p1');
  assert.equal(record.conversation_id, 'c1');
  assert.equal(record.task_id, 't1');
});

test('rotation compresses the active file and starts a fresh one', () => {
  const dir = join(workspace(), 'logs');
  const log = logger(dir, { maxFileBytes: 1024 });
  for (let index = 0; index < 200; index += 1) log.info('fill', { index, filler: 'x'.repeat(64) });
  const archives = log.archives();
  assert.ok(archives.length >= 1, 'at least one archive must exist');
  const first = gunzipSync(readFileSync(join(dir, archives[0]))).toString('utf8');
  assert.ok(first.split('\n').filter(Boolean).length > 0);
  assert.ok(JSON.parse(first.split('\n')[0]).event === 'fill');
});

test('retention keeps only the configured number of archives', () => {
  const dir = join(workspace(), 'logs');
  const log = logger(dir, { maxFileBytes: 512, keepFiles: 3 });
  for (let index = 0; index < 400; index += 1) log.info('fill', { index, filler: 'y'.repeat(64) });
  assert.ok(log.archives().length <= 3, `expected <=3 archives, saw ${log.archives().length}`);
});

test('the disk quota drops the oldest archive and records a WARN', () => {
  const dir = join(workspace(), 'logs');
  const log = logger(dir, { maxFileBytes: 512, keepFiles: 50, quotaBytes: 3000 });
  for (let index = 0; index < 400; index += 1) log.info('fill', { index, filler: 'z'.repeat(64) });
  assert.ok(log.dropped > 0, 'quota enforcement must have dropped at least one archive');
  assert.ok(log.directoryBytes() <= 3000 + 4096, 'directory must be brought back near the quota');
  // The WARN is written to whichever file is active at the time, which later
  // rotations may archive — so assert across the whole searchable history.
  const warned = log.search({ event: 'log.quota.enforced', limit: 50 }).entries;
  assert.ok(warned.length > 0, 'a WARN must be recorded when an archive is dropped');
  assert.equal(warned[0].level, 'WARN');
});

test('search filters by level, correlation id, event and free text, newest first', () => {
  const dir = join(workspace(), 'logs');
  const log = logger(dir, { level: 'TRACE' });
  log.info('alpha', { correlation_id: 'c-1', msg: 'first entry' });
  log.warn('beta', { correlation_id: 'c-2', msg: 'second entry' });
  log.error('gamma', { correlation_id: 'c-1', msg: 'third entry' });
  assert.deepEqual(log.search({ correlationId: 'c-1' }).entries.map((r) => r.event), ['gamma', 'alpha']);
  assert.deepEqual(log.search({ level: 'WARN' }).entries.map((r) => r.event), ['gamma', 'beta']);
  assert.deepEqual(log.search({ event: 'beta' }).entries.map((r) => r.event), ['beta']);
  assert.deepEqual(log.search({ text: 'second' }).entries.map((r) => r.event), ['beta']);
  assert.equal(log.search({ limit: 2 }).entries.length, 2);
});

test('rotation never overwrites an archive, even within the same millisecond', () => {
  const dir = join(workspace(), 'logs');
  const fixedClock = () => 1774339200000;
  const log = logger(dir, { maxFileBytes: 256, keepFiles: 500, clock: fixedClock });
  const total = 60;
  for (let index = 0; index < total; index += 1) log.info('fill', { index, filler: 'r'.repeat(64) });
  const names = new Set(log.archives());
  assert.equal(names.size, log.archives().length, 'archive names must be unique');
  const recovered = log.search({ limit: 10_000 }).entries.filter((r) => r.event === 'fill');
  assert.equal(recovered.length, total, 'every written record must remain recoverable after rotation');
});

test('search also reads compressed archives', () => {
  const dir = join(workspace(), 'logs');
  const log = logger(dir, { maxFileBytes: 512, keepFiles: 200 });
  log.info('needle', { msg: 'find-me-marker' });
  for (let index = 0; index < 40; index += 1) log.info('fill', { index, filler: 'q'.repeat(64) });
  assert.ok(log.archives().length >= 1);
  const found = log.search({ event: 'needle', limit: 10 }).entries;
  assert.equal(found.length, 1);
  assert.equal(found[0].msg, 'find-me-marker');
});

test('the logger refuses to write into an audit directory', () => {
  const root = workspace();
  assert.throws(() => new Logger({ dir: join(root, 'audit'), stdout: false }), /audit/i);
  assert.throws(() => new Logger({ dir: join(root, 'audit', 'nested'), stdout: false }), /audit/i);
});

test('rotation cannot reach audit history: the two stores are separate directories', () => {
  const root = workspace();
  const auditDir = join(root, 'audit');
  mkdirSync(auditDir, { recursive: true });
  const auditFile = join(auditDir, 'events.jsonl');
  writeFileSync(auditFile, '{"id":"kept"}\n');
  const log = logger(join(root, 'logs'), { maxFileBytes: 256, keepFiles: 1, quotaBytes: 1024 });
  for (let index = 0; index < 300; index += 1) log.info('fill', { index, filler: 'w'.repeat(64) });
  assert.ok(existsSync(auditFile), 'audit file must still exist after aggressive rotation');
  assert.equal(readFileSync(auditFile, 'utf8'), '{"id":"kept"}\n');
  assert.ok(readdirSync(auditDir).length === 1);
});

test('stats report the redaction posture and quota configuration', () => {
  const log = logger(join(workspace(), 'logs'));
  log.info('x');
  const stats = log.stats();
  assert.equal(stats.redaction, 'on');
  assert.equal(stats.written, 1);
  assert.equal(typeof stats.quotaBytes, 'number');
});

test('redactRecord is pure and does not mutate its input', () => {
  const input = { password: 'must-not-leak', keep: 1 };
  const output = redactRecord(input);
  assert.equal(input.password, 'must-not-leak');
  assert.equal(output.password, '[REDACTED]');
  assert.equal(output.keep, 1);
});
