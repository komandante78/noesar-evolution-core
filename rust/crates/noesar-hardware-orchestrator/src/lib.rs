// SPDX-License-Identifier: AGPL-3.0-or-later
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Accelerator { pub vendor: String, pub backend: String, pub memory_mib: Option<u64> }
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Inventory { pub total_ram_bytes: u64, pub logical_cores: usize, pub accelerators: Vec<Accelerator> }
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Workload { pub model_billions: f64, pub quantization_bits: u8, pub context_tokens: u64, pub profile: String }
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Recommendation { pub backend: String, pub estimated_memory_gib: f64, pub feasible: bool, pub explanation: Vec<String> }

pub fn recommend(inventory: &Inventory, workload: &Workload) -> Recommendation {
    let weights = workload.model_billions * 1_000_000_000.0 * workload.quantization_bits as f64 / 8.0 / 1024f64.powi(3) * 1.12;
    let kv = (workload.model_billions / 7.0 * workload.context_tokens as f64 / 32768.0 * 1.5).max(0.5);
    let required = weights + kv + 2.0;
    let ram = inventory.total_ram_bytes as f64 / 1024f64.powi(3);
    let backend = inventory.accelerators.first().map(|a| a.backend.clone()).unwrap_or_else(|| "CPU".into());
    Recommendation { backend, estimated_memory_gib: required, feasible: required <= ram * 0.82, explanation: vec!["Recommendation is hardware, memory and workload aware; driver installation is never automatic.".into()] }
}
