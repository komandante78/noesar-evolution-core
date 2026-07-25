# Multi-GPU and Memory Planner

Calculate weights, quantization/runtime overhead, KV cache, context, batch,
concurrency, adapter memory, GPU/OS reserve, safety margin and topology.
Strategies include CPU-only, full GPU, layer offload, weight streaming, memory
mapping, quantized KV cache, tensor/pipeline/expert/data parallelism,
task-per-device and model-per-device.

Large RAM (128–512 GB+) can enable larger models and offload but is not VRAM
performance. Mixed vendors are supported for separate workloads; a mixed-vendor
single tensor-parallel group is not promised without tested runtime support.
