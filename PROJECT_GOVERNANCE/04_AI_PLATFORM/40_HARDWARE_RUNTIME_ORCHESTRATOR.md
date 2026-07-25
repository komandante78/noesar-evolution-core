# Hardware and Runtime Orchestrator

The orchestrator selects execution based on workload, model, hardware, memory,
latency, throughput, energy and user preference. Read-only discovery covers CPU
features, cores, NUMA, RAM/swap, GPU/NPU UUIDs, VRAM, interconnect topology,
drivers, firmware, runtimes, storage and available thermal/power data.

Adapters: CPU, CUDA, TensorRT, ROCm, Metal bridge, OpenVINO, DirectML, ONNX
Runtime, Vulkan and future adapters. User profiles: Automatic, Balanced,
Maximum Performance, Low Latency, Throughput, Context, Low Power, Memory Saver,
Deterministic and Custom.

Recommendations are explainable and overridable. No automatic driver/runtime
installation or host mutation.
