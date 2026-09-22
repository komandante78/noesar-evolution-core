// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Two small defects measured live on 2026-09-21/22: a byte count redacted as a phone number in
// the log, and a chat answer that used a tool with nothing on screen saying so.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { redactText } from '../src/ai-workspace/privacy-redaction.mjs';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..');

test('a quantity with its unit survives redaction; a phone number does not', () => {
  const measured = 'the workspace exceeds 2147483648 bytes; a partial shadow would be compared as if it were complete';
  assert.equal(redactText(measured).text, measured);
  assert.equal(redactText('model is 9663676416 B, took 1234567890 ms').text, 'model is 9663676416 B, took 1234567890 ms');
  assert.equal(redactText('call 3331234567 now').text, 'call [REDACTED_PHONE] now');
  assert.equal(redactText('call +39 333 123 4567').text, 'call [REDACTED_PHONE]');
  assert.equal(redactText('call 3331234567 bytesize').text, 'call [REDACTED_PHONE] bytesize', 'a unit is a whole word');
});

test('a chat answer says which tools it used, and whether each call worked', () => {
  const source = readFileSync(join(REPO_ROOT, 'apps/webui-static/app.js'), 'utf8');
  const render = source.slice(source.indexOf('function renderMessages('), source.indexOf('function renderMessages(') + 3000);
  assert.match(render, /message\.metadata\?\.toolCalls\?\.length/);
  assert.match(render, /t\('Tools used'\)/);
});
