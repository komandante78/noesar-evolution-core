// SPDX-License-Identifier: AGPL-3.0-or-later
import os from 'node:os';
import { spawnSync } from 'node:child_process';

function command(name, args = []) {
  try {
    const result = spawnSync(name, args, { encoding: 'utf8', timeout: 2500, windowsHide: true });
    if (result.status === 0) return result.stdout.trim();
  } catch {}
  return '';
}

export function discoverHardware() {
  const inventory = {
    platform: os.platform(),
    architecture: os.arch(),
    cpu: {
      model: os.cpus()[0]?.model ?? 'unknown',
      logicalCores: os.cpus().length,
    },
    memory: {
      totalBytes: os.totalmem(),
      freeBytes: os.freemem(),
    },
    accelerators: [],
    discoveryMode: 'read-only',
  };

  const nvidia = command('nvidia-smi', ['--query-gpu=index,name,uuid,memory.total,driver_version', '--format=csv,noheader,nounits']);
  if (nvidia) {
    for (const line of nvidia.split('\n')) {
      const [index, name, uuid, memoryMiB, driver] = line.split(',').map((v) => v.trim());
      inventory.accelerators.push({ vendor: 'NVIDIA', backend: 'CUDA', index: Number(index), name, uuid, memoryMiB: Number(memoryMiB), driver });
    }
  }

  const amd = command('rocminfo');
  if (amd) inventory.accelerators.push({ vendor: 'AMD', backend: 'ROCm', name: 'ROCm-compatible accelerator', detailsAvailable: true });

  if (os.platform() === 'darwin') {
    const metal = command('system_profiler', ['SPDisplaysDataType', '-json']);
    if (metal) inventory.accelerators.push({ vendor: 'Apple', backend: 'Metal/Core ML bridge', name: 'Apple graphics/ML accelerator', hostBridgeRequired: true });
  }

  const lspci = command('lspci');
  if (lspci && /Intel.*(VGA|Display|NPU|Neural)/i.test(lspci)) {
    inventory.accelerators.push({ vendor: 'Intel', backend: 'OpenVINO', name: 'Intel accelerator candidate', validationRequired: true });
  }

  return inventory;
}

export function recommendRuntime(inventory, request = {}) {
  const profile = request.profile ?? 'Automatic';
  const modelBillions = Number(request.modelBillions ?? 7);
  const bits = Number(request.quantizationBits ?? 4);
  const contextTokens = Number(request.contextTokens ?? 32768);
  const estimatedWeightsGiB = (modelBillions * 1e9 * bits / 8) / (1024 ** 3) * 1.12;
  const estimatedKvGiB = Math.max(0.5, modelBillions / 7 * contextTokens / 32768 * 1.5);
  const requiredGiB = estimatedWeightsGiB + estimatedKvGiB + 2;
  const ramGiB = inventory.memory.totalBytes / (1024 ** 3);
  const accelerators = inventory.accelerators;
  let backend = 'CPU';
  let strategy = 'cpu-only';
  const notes = [];

  const nvidia = accelerators.filter((a) => a.vendor === 'NVIDIA');
  const amd = accelerators.filter((a) => a.vendor === 'AMD');
  const apple = accelerators.filter((a) => a.vendor === 'Apple');
  const intel = accelerators.filter((a) => a.vendor === 'Intel');

  if (nvidia.length) {
    backend = nvidia.length > 1 ? 'CUDA/NCCL' : 'CUDA';
    strategy = nvidia.length > 1 ? 'task-per-device or validated tensor parallelism' : 'GPU offload';
  } else if (amd.length) {
    backend = 'ROCm/HIP';
    strategy = 'GPU offload after compatibility validation';
  } else if (apple.length) {
    backend = 'Metal/Core ML host bridge';
    strategy = 'host-native bridge';
  } else if (intel.length) {
    backend = 'OpenVINO';
    strategy = 'AUTO device selection';
  } else {
    notes.push('No supported accelerator was detected; CPU fallback selected.');
  }

  if (requiredGiB > ramGiB * 0.82) notes.push('Requested model exceeds the safe memory budget. Choose a smaller or more compressed model.');
  if (profile === 'Deterministic') notes.push('Disable opportunistic backend switching and pin runtime/model hashes.');

  return {
    profile,
    backend,
    strategy,
    estimatedMemoryGiB: Number(requiredGiB.toFixed(2)),
    availableRamGiB: Number(ramGiB.toFixed(2)),
    feasible: requiredGiB <= ramGiB * 0.82,
    multiGpuDetected: nvidia.length > 1,
    explainability: notes.length ? notes : ['Recommendation follows detected hardware, memory budget and workload profile.'],
    hostMutationRequired: false,
  };
}
