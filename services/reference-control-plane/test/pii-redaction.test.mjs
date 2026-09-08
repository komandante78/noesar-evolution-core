// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { redactIdentifiers } from '../src/ai-workspace/pii-redaction.mjs';

describe('redactIdentifiers', () => {
  test('redacts a codice fiscale — the exact shape that motivated this module', () => {
    const result = redactIdentifiers('Paziente: BRCLSN78A07D086Y, esito allegato.');
    assert.equal(result.redacted, 'Paziente: [CODICE_FISCALE], esito allegato.');
    assert.deepEqual(result.types, ['CODICE_FISCALE']);
    assert.equal(result.piiFound, true);
  });

  test('redacts an IBAN', () => {
    const result = redactIdentifiers('IBAN: IT60X0542811101000000123456');
    assert.match(result.redacted, /\[IBAN\]/);
    assert.ok(result.types.includes('IBAN'));
  });

  test('redacts an email and a phone number in the same pass', () => {
    const result = redactIdentifiers('Contattami a mario.rossi@example.com o al 333 1234567.');
    assert.match(result.redacted, /\[EMAIL\]/);
    assert.match(result.redacted, /\[TELEFONO\]/);
    assert.equal(result.count, 2);
  });

  test('leaves names and plain text untouched — coverage is identifiers only, by design', () => {
    const result = redactIdentifiers('Mario Rossi ha consegnato il documento in Via Roma 12.');
    assert.equal(result.redacted, 'Mario Rossi ha consegnato il documento in Via Roma 12.');
    assert.equal(result.piiFound, false);
  });

  test('text with nothing to redact is returned unchanged', () => {
    const result = redactIdentifiers('Nessun dato sensibile qui.');
    assert.equal(result.piiFound, false);
    assert.equal(result.count, 0);
  });
});
