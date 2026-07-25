// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import { mkdtempSync, mkdirSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { createPathPlan } from '../src/path-auth.mjs';
import { PrivacyState, evaluateEgress, privacyBanner } from '../src/privacy.mjs';

 test('local privacy banner is exact and verified', () => {
  const banner = privacyBanner(PrivacyState.LOCAL_ONLY_VERIFIED);
  assert.equal(banner.headline, 'NOESAR runs locally on your device.');
  assert.equal(banner.detail, 'No data is sent to external servers.');
  assert.equal(banner.verified, true);
});

test('external egress always requires approval', () => {
  const plan = evaluateEgress({ kind:'remote-model', data:['prompt'] });
  assert.equal(plan.allowed, false);
  assert.equal(plan.requiresApproval, true);
});

test('workspace path is planned without implicit execution', () => {
  const root = mkdtempSync(join(os.tmpdir(), 'noesar-path-'));
  mkdirSync(join(root, 'project'));
  const plan = createPathPlan({ path:'project', operation:'write', mode:'NORMAL' }, root);
  assert.equal(plan.insideWorkspace, true);
  assert.equal(plan.blocked, false);
  assert.equal(plan.backup.required, true);
});

test('symlink path becomes critical risk', () => {
  const root = mkdtempSync(join(os.tmpdir(), 'noesar-link-'));
  symlinkSync(os.tmpdir(), join(root, 'linked'));
  const plan = createPathPlan({ path:'linked/file', operation:'write' }, root);
  assert.equal(plan.risk, 'CRITICAL');
  assert.ok(plan.symlinkFindings.length > 0);
});
