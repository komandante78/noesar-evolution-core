// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Regression guard for the defect that produced Phase 4's unreproduced flake.
//
// The phone rule matched inside a canonical UUID — "…-2822-4650-…" is nine characters of
// digits and hyphens — and rewrote the middle of it. Measured rate: 6.75% of all UUIDs.
// What that broke was not cosmetic: correlation ids exist so a user-visible failure can be
// found in the log, and incident ids tie a debug bundle to its incident. Roughly one record
// in fifteen carried one that matched nothing.
//
// These tests fail against the pre-fix module.

import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { redactText, redactMessages } from '../src/ai-workspace/privacy-redaction.mjs';
import { Logger } from '../src/logging.mjs';
import { mkdtempSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

test('the known-bad UUID survives redaction unchanged', () => {
  // The exact value that failed: '2822-4650' matched the phone rule.
  const uuid = 'b3a1c78a-2822-4650-ba5d-173000ca98a2';
  assert.equal(redactText(uuid).text, uuid);
  assert.equal(redactText(`INC-${uuid}`).text, `INC-${uuid}`);
});

test('no UUID out of twenty thousand is altered by redaction', () => {
  // Deterministic in outcome even though the inputs are random: the property is that NO
  // UUID is ever altered, so any counterexample is a failure regardless of which one.
  let corrupted = 0;
  const examples = [];
  for (let i = 0; i < 20000; i += 1) {
    const uuid = randomUUID();
    const redacted = redactText(uuid).text;
    if (redacted !== uuid) {
      corrupted += 1;
      if (examples.length < 3) examples.push(`${uuid} -> ${redacted}`);
    }
  }
  assert.equal(corrupted, 0, `redaction altered ${corrupted} UUIDs, e.g. ${examples.join('; ')}`);
});

test('UUIDs embedded in surrounding text survive, and the text around them is still redacted', () => {
  const uuid = '3924acf5-4944-4257-a1ba-35e968c2f48b';
  const result = redactText(`request ${uuid} from user a@b.example called 415 555 0132`);
  assert.ok(result.text.includes(uuid), 'the identifier must be intact');
  assert.ok(result.text.includes('[REDACTED_EMAIL]'));
  assert.ok(result.text.includes('[REDACTED_PHONE]'));
});

test('several UUIDs in one string are each restored to their own value', () => {
  const a = 'b3a1c78a-2822-4650-ba5d-173000ca98a2';
  const b = '2c0ef2a2-9569-4401-95d5-b7e0ed0505f4';
  const c = 'c6a8dde4-0950-4483-91af-59f501908acc';
  const result = redactText(`${a} ${b} ${c}`).text;
  assert.equal(result, `${a} ${b} ${c}`, 'placeholders must map back one-to-one, in order');
});

test('protecting UUIDs does not weaken any redaction rule', () => {
  assert.equal(redactText('a.person@example.com').text, '[REDACTED_EMAIL]');
  assert.equal(redactText('4111 1111 1111 1111').text, '[REDACTED_PAYMENT_NUMBER]');
  assert.equal(redactText('call +1 415 555 0132').text, 'call [REDACTED_PHONE]');
  assert.equal(redactText('Bearer abc.def.ghi').text, '[REDACTED_BEARER_TOKEN]');
  assert.match(redactText('sk-0123456789abcdef0123').text, /REDACTED_API_KEY/);
});

test('an IPv4 address is labelled as an address, not as a phone number', () => {
  // Rule order: the phone rule also matches "192.168.1.7", so with phone first the log
  // said [REDACTED_PHONE] while the documentation said [REDACTED_IP]. The data was
  // protected either way; the label was a lie.
  assert.equal(redactText('192.168.1.7').text, '[REDACTED_IP]');
  assert.equal(redactText('bind 10.0.0.255 ok').text, 'bind [REDACTED_IP] ok');
  // And a phone number written with dots is still a phone number.
  assert.equal(redactText('tel 415.555.0132').text, 'tel [REDACTED_PHONE]');
});

test('a placeholder cannot be forged from user-supplied text', () => {
  // The placeholder is NUL-delimited, and a JSON string may carry a literal NUL — so
  // without stripping them first, hostile text could forge one and be substituted with a
  // UUID lifted from elsewhere in the same value, or with "undefined" when the index is
  // out of range. Both were reproduced before the strip was added.
  //
  // The NUL is built with fromCharCode rather than written literally: a control character
  // in a tracked source file makes that file binary to grep and to diff.
  const nul = String.fromCharCode(0);
  const real = '3924acf5-4944-4257-a1ba-35e968c2f48b';

  const plain = redactText('NOESAR_UUID_PLACEHOLDER0 and NOESAR_UUID_PLACEHOLDER99').text;
  assert.equal(plain, 'NOESAR_UUID_PLACEHOLDER0 and NOESAR_UUID_PLACEHOLDER99');

  const forged = redactText(`${nul}NOESAR_UUID_PLACEHOLDER0${nul} and ${real}`).text;
  assert.ok(!forged.includes('undefined'), `a forged placeholder produced: ${forged}`);
  assert.equal(
    (forged.match(new RegExp(real, 'g')) ?? []).length, 1,
    'a forged placeholder must not be substituted with a real identifier from the same value',
  );

  const outOfRange = redactText(`${nul}NOESAR_UUID_PLACEHOLDER99${nul}`).text;
  assert.ok(!outOfRange.includes('undefined'), `out-of-range index produced: ${outOfRange}`);

  // No control character survives into the log line either way.
  assert.ok(!forged.includes(nul));
  assert.ok(!outOfRange.includes(nul));
});

test('message redaction keeps conversation identifiers intact', () => {
  const uuid = 'b3a1c78a-2822-4650-ba5d-173000ca98a2';
  const { messages } = redactMessages([
    { role: 'user', content: `see conversation ${uuid}` },
  ]);
  assert.ok(messages[0].content.includes(uuid));
});

test('a correlation id written through the real logger comes back readable', () => {
  // The end-to-end property: Phase 3 returns the correlation id to the client in a header
  // so the operator can find that request in the log. If the sink rewrites it, the feature
  // does not work — and that is precisely what was happening for ~7% of requests.
  const dir = mkdtempSync(join(tmpdir(), 'noesar-redaction-log-'));
  const logger = new Logger({ dir, level: 'INFO', component: 'test' });
  const ids = Array.from({ length: 300 }, () => randomUUID());
  for (const id of ids) logger.info('http.request', { correlation_id: id });
  const written = readFileSync(join(dir, 'noesar.log'), 'utf8');
  const missing = ids.filter((id) => !written.includes(id));
  assert.equal(missing.length, 0,
    `${missing.length} of ${ids.length} correlation ids were corrupted in the log sink`);
});
