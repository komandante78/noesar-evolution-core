// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Pure-function coverage for readModulesSettings — the merge of KNOWN_MODULES onto
// whatever (possibly absent, possibly partial) state.settings.modules a stored AI
// workspace state carries. No server, no HTTP.
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { KNOWN_MODULES, readModulesSettings } from '../src/modules-registry.mjs';

describe('readModulesSettings', () => {
  test('missing_settings · a state with no settings key at all yields disabled defaults', () => {
    const result = readModulesSettings({});
    assert.deepEqual(result, KNOWN_MODULES.map((known) => ({ id: known.id, name: known.name, url: known.defaultUrl, enabled: false })));
  });

  test('missing_modules_key · settings present but modules absent yields disabled defaults', () => {
    const result = readModulesSettings({ settings: { retentionDays: 365 } });
    assert.equal(result.find((item) => item.id === 'debug-evolution').enabled, false);
  });

  test('partial_entry · enabled with no stored url falls back to the known default URL', () => {
    const result = readModulesSettings({ settings: { modules: { 'debug-evolution': { enabled: true } } } });
    const entry = result.find((item) => item.id === 'debug-evolution');
    assert.equal(entry.enabled, true);
    assert.equal(entry.url, KNOWN_MODULES.find((known) => known.id === 'debug-evolution').defaultUrl);
  });

  test('stored_url_used · an explicit stored URL wins over the default', () => {
    const result = readModulesSettings({ settings: { modules: { 'debug-evolution': { enabled: true, url: 'http://example.test' } } } });
    assert.equal(result.find((item) => item.id === 'debug-evolution').url, 'http://example.test');
  });

  test('unknown_stored_ids_ignored · a stale/foreign id in stored state is not surfaced', () => {
    const result = readModulesSettings({ settings: { modules: { 'not-a-real-module': { enabled: true } } } });
    assert.equal(result.length, KNOWN_MODULES.length);
    assert.ok(!result.some((item) => item.id === 'not-a-real-module'));
  });
});
