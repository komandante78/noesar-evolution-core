// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test';
import assert from 'node:assert/strict';
import { recommendRuntime } from '../src/hardware.mjs';

test('CPU fallback is available', () => {
  const inventory = { memory:{ totalBytes:128 * 1024 ** 3 }, accelerators:[] };
  const result = recommendRuntime(inventory, { modelBillions:7, quantizationBits:4 });
  assert.equal(result.backend, 'CPU');
  assert.equal(result.feasible, true);
});

test('multi NVIDIA devices produce explicit multi-GPU recommendation', () => {
  const inventory = { memory:{ totalBytes:256 * 1024 ** 3 }, accelerators:[{vendor:'NVIDIA'},{vendor:'NVIDIA'}] };
  const result = recommendRuntime(inventory, { modelBillions:70, quantizationBits:4 });
  assert.equal(result.multiGpuDetected, true);
  assert.match(result.backend, /NCCL/);
});
