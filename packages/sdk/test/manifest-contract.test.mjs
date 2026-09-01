// SPDX-License-Identifier: Apache-2.0
//
// The SDK is a typed mirror of a contract that lives elsewhere as JSON: the manifest template
// and the permission catalogue under `capabilities/`. A mirror nothing checks stops being one
// quietly — this package sat unchanged from 2026-07-25 while `capabilities/` moved until
// 2026-08-21, and lost `compatibility` and `rollback` without any gate noticing (2026-09-01).
//
// The assertion is one-directional on purpose: the SDK may declare OPTIONAL fields the template
// does not show (`industry`), but it may never omit something the live contract declares.

import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const at = (path) => new URL(`../../../${path}`, import.meta.url);
const json = (path) => JSON.parse(readFileSync(at(path), 'utf8'));

const sdkSource = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8');

// Top-level field names of a TypeScript interface, ignoring everything nested inside it.
function interfaceFields(source, name) {
  const start = source.indexOf(`export interface ${name} {`);
  assert.notEqual(start, -1, `interface ${name} not found in the SDK source`);
  const fields = [];
  let depth = 0;
  for (const line of source.slice(start).split('\n')) {
    const opens = (line.match(/\{/g) ?? []).length;
    const closes = (line.match(/\}/g) ?? []).length;
    if (depth === 1) {
      const field = line.match(/^\s*(\w+)\??\s*:/);
      if (field) fields.push(field[1]);
    }
    depth += opens - closes;
    if (depth === 0 && fields.length > 0) break;
  }
  return fields;
}

// The `Permission` union, as the string literals it is written from.
function permissionUnion(source) {
  const block = source.split('export type Permission =')[1].split(';')[0];
  return [...block.matchAll(/"([a-z.]+)"/g)].map((m) => m[1]);
}

describe('the SDK still mirrors the live capability contract', () => {
  test('CapabilityManifest declares every field the live manifest template carries', () => {
    const declared = interfaceFields(sdkSource, 'CapabilityManifest');
    const live = Object.keys(json('capabilities/templates/capability/manifest.template.json'));
    const missing = live.filter((key) => !declared.includes(key));
    assert.deepEqual(missing, [], `the template declares fields the SDK type omits: ${missing.join(', ')}`);
  });

  test('Permission covers every permission the live catalogue brokers', () => {
    const declared = permissionUnion(sdkSource);
    const live = Object.keys(json('capabilities/security/permission-catalog.json').permissions);
    const missing = live.filter((p) => !declared.includes(p));
    assert.deepEqual(missing, [], `the catalogue brokers permissions the SDK omits: ${missing.join(', ')}`);
  });

  test('the extractors themselves fail when the thing they read is absent', () => {
    assert.throws(() => interfaceFields('export interface Other { a: string; }', 'CapabilityManifest'));
    assert.deepEqual(interfaceFields('export interface X {\n  a: string;\n  b: { c: string };\n}', 'X'), ['a', 'b']);
  });
});
