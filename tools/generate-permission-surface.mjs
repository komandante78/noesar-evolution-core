#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// ARCH-007 / INST-008: emits the current codebase's permission surface — every RBAC
// permission server.mjs's routes gate on, plus every adapter capability
// ADAPTER_MANIFESTS declares — as a signable JSON document. Run once per release
// candidate; tools/verify-permission-diff.mjs compares two of these.
//
//   node tools/generate-permission-surface.mjs <output.json> [--label <name>] [--private-key <pem>]
import { parseArgs } from 'node:util';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import {
  extractRbacPermissions, adapterCapabilityList, buildPermissionSurface,
} from '../services/reference-control-plane/src/permission-surface.mjs';
import { ADAPTER_MANIFESTS } from '../services/reference-control-plane/src/adapter-capability.mjs';
import { signCompliancePack } from '../services/reference-control-plane/src/compliance-packs.mjs';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { label: { type: 'string' }, 'private-key': { type: 'string' } },
});
const output = positionals[0] ?? 'permission-surface.json';
const root = process.cwd();

const serverSource = readFileSync(join(root, 'services/reference-control-plane/src/server.mjs'), 'utf8');
const surface = buildPermissionSurface({
  rbacPermissions: extractRbacPermissions(serverSource),
  adapterCapabilities: adapterCapabilityList(ADAPTER_MANIFESTS),
  label: values.label ?? null,
});

const document = values['private-key']
  ? signCompliancePack(surface, readFileSync(resolve(values['private-key']), 'utf8'))
  : surface;

writeFileSync(resolve(output), `${JSON.stringify(document, null, 2)}\n`);
process.stdout.write(`wrote ${output}\n`);
process.stdout.write(`  rbac permissions      ${surface.rbacPermissions.length}\n`);
process.stdout.write(`  adapter capabilities  ${surface.adapterCapabilities.length}\n`);
process.stdout.write(`  signed                ${values['private-key'] ? 'yes' : 'no'}\n`);
