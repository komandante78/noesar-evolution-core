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

// D-0660 (F-RUST-001). No test previously exercised this arithmetic, and it is the only real
// logic in this crate — everything else here is data shapes. A silently wrong memory estimate
// is the kind of defect nobody notices until an installer recommends a backend that then runs
// out of memory.
#[cfg(test)]
mod tests {
    use super::*;

    fn workload(model_billions: f64, quantization_bits: u8, context_tokens: u64) -> Workload {
        Workload { model_billions, quantization_bits, context_tokens, profile: "chat".into() }
    }

    fn inventory(total_ram_bytes: u64, accelerators: Vec<Accelerator>) -> Inventory {
        Inventory { total_ram_bytes, logical_cores: 8, accelerators }
    }

    fn gpu(backend: &str) -> Accelerator {
        Accelerator { vendor: "test-vendor".into(), backend: backend.into(), memory_mib: Some(16384) }
    }

    #[test]
    fn recommend_uses_the_first_accelerators_backend_when_one_is_present() {
        let inv = inventory(64 * 1024_u64.pow(3), vec![gpu("CUDA"), gpu("ROCm")]);
        let out = recommend(&inv, &workload(7.0, 4, 4096));
        assert_eq!(out.backend, "CUDA", "the first accelerator wins, not the last");
    }

    #[test]
    fn recommend_falls_back_to_cpu_when_no_accelerator_is_present() {
        let inv = inventory(64 * 1024_u64.pow(3), vec![]);
        let out = recommend(&inv, &workload(7.0, 4, 4096));
        assert_eq!(out.backend, "CPU");
    }

    #[test]
    fn estimated_memory_matches_the_formula_computed_independently() {
        // 7B model, 4-bit quantization, 4096 context — recomputed by hand here, not by
        // calling recommend()'s own internals, so a change to the formula is caught rather
        // than silently re-validated against itself.
        // weights = 7e9 * 4 / 8 / 1024^3 * 1.12  ~= 3.65078...
        // kv      = max(7.0/7.0 * 4096/32768 * 1.5, 0.5) = max(0.1875, 0.5) = 0.5 (floor hit)
        // required = weights + kv + 2.0 ~= 6.15078...
        let weights = 7.0_f64 * 1_000_000_000.0 * 4.0 / 8.0 / 1024f64.powi(3) * 1.12;
        let kv = 0.5_f64; // the floor, since 7.0/7.0 * 4096.0/32768.0 * 1.5 = 0.1875 < 0.5
        let expected = weights + kv + 2.0;

        let inv = inventory(64 * 1024_u64.pow(3), vec![]);
        let out = recommend(&inv, &workload(7.0, 4, 4096));
        assert!(
            (out.estimated_memory_gib - expected).abs() < 1e-9,
            "expected ~{expected} GiB, got {}", out.estimated_memory_gib,
        );
    }

    #[test]
    fn doubling_quantization_bits_roughly_doubles_the_weight_memory_component() {
        let inv = inventory(256 * 1024_u64.pow(3), vec![]);
        let low = recommend(&inv, &workload(7.0, 4, 4096)).estimated_memory_gib;
        let high = recommend(&inv, &workload(7.0, 8, 4096)).estimated_memory_gib;
        assert!(high > low, "8-bit must require more memory than 4-bit for the same model");
        // The +2.0 GiB fixed overhead and the KV floor mean the ratio is not exactly 2x, but
        // the weights component itself is: assert the difference is close to one 4-bit-worth
        // of weight memory (low - overhead - kv), not merely "greater than".
        let weights_low = 7.0_f64 * 1_000_000_000.0 * 4.0 / 8.0 / 1024f64.powi(3) * 1.12;
        assert!((high - low - weights_low).abs() < 1e-6);
    }

    #[test]
    fn feasible_is_true_when_the_estimate_fits_under_82_percent_of_total_ram() {
        // From the previous test, a 7B/4-bit/4k-context workload needs ~6.15 GiB. 16 GiB * 0.82
        // = 13.12 GiB, comfortably above it.
        let inv = inventory(16 * 1024_u64.pow(3), vec![]);
        let out = recommend(&inv, &workload(7.0, 4, 4096));
        assert!(out.feasible);
    }

    #[test]
    fn feasible_is_false_when_the_estimate_exceeds_82_percent_of_total_ram() {
        // A 70B model at 16-bit needs far more than 82% of an 8 GiB machine's RAM.
        let inv = inventory(8 * 1024_u64.pow(3), vec![]);
        let out = recommend(&inv, &workload(70.0, 16, 4096));
        assert!(!out.feasible);
    }

    #[test]
    fn the_kv_estimate_never_drops_below_its_half_gib_floor_for_a_tiny_context() {
        let inv = inventory(64 * 1024_u64.pow(3), vec![]);
        let tiny_context = recommend(&inv, &workload(7.0, 4, 1)).estimated_memory_gib;
        let weights = 7.0_f64 * 1_000_000_000.0 * 4.0 / 8.0 / 1024f64.powi(3) * 1.12;
        assert!(
            (tiny_context - (weights + 0.5 + 2.0)).abs() < 1e-6,
            "a context of 1 token must still hit the 0.5 GiB KV floor, not round to ~0",
        );
    }
}
