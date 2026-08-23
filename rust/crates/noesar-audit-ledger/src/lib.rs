// SPDX-License-Identifier: AGPL-3.0-or-later
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuditRecord { pub id: Uuid, pub timestamp: DateTime<Utc>, pub actor: String, pub action: String, pub result: String, pub previous_hash: String, pub hash: String }

// D-0658b. Feeds each field length-delimited, the same defense this project already codified
// in noesar-capability's plan_digest/sign and noesar-reasoning-reference's own digest() helper
// (and normatively in packages/capability-token/SPEC.md CT-002). The previous version of this
// function joined fields with a bare `format!("{a}|{b}|...")`, which is ambiguous whenever a
// field's own content contains `|`: actor="a|b",action="c" and actor="a",action="b|c" both
// produce the material string "...|a|b|c|..." and therefore the identical hash — confirmed
// against the pre-fix formula, not assumed. Found while adding this crate's first tests
// (F-RUST-001), fixed before anything in the workspace started depending on the weaker format
// (zero callers, verified: grep -rn noesar_audit_ledger rust/crates/*/src finds none outside
// this crate).
fn feed(hasher: &mut Sha256, value: &str) {
    hasher.update(value.as_bytes());
    hasher.update((value.len() as u64).to_le_bytes());
}

fn compute_hash(
    id: Uuid,
    timestamp: DateTime<Utc>,
    actor: &str,
    action: &str,
    result: &str,
    previous_hash: &str,
) -> String {
    let mut hasher = Sha256::new();
    feed(&mut hasher, &id.to_string());
    feed(&mut hasher, &timestamp.to_rfc3339());
    feed(&mut hasher, actor);
    feed(&mut hasher, action);
    feed(&mut hasher, result);
    feed(&mut hasher, previous_hash);
    hex::encode(hasher.finalize())
}

pub fn build_record(actor: String, action: String, result: String, previous_hash: String) -> AuditRecord {
    let id = Uuid::new_v4();
    let timestamp = Utc::now();
    let hash = compute_hash(id, timestamp, &actor, &action, &result, &previous_hash);
    AuditRecord { id, timestamp, actor, action, result, previous_hash, hash }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixed_id() -> Uuid {
        Uuid::parse_str("00000000-0000-0000-0000-000000000001").unwrap()
    }
    fn fixed_timestamp() -> DateTime<Utc> {
        DateTime::parse_from_rfc3339("2026-08-23T12:00:00Z").unwrap().with_timezone(&Utc)
    }

    #[test]
    fn compute_hash_is_deterministic_for_the_same_inputs() {
        let a = compute_hash(fixed_id(), fixed_timestamp(), "owner-001", "login", "ok", "genesis");
        let b = compute_hash(fixed_id(), fixed_timestamp(), "owner-001", "login", "ok", "genesis");
        assert_eq!(a, b);
    }

    #[test]
    fn a_delimiter_character_inside_a_field_does_not_collide_the_hash() {
        // The exact ambiguity the previous `format!("{a}|{b}|...")` implementation had: when a
        // field's own content contains the separator, two different (actor, action) pairs join
        // to the identical byte string. actor="a|b",action="c" and actor="a",action="b|c" both
        // produced the material "...|a|b|c|..." under the old scheme (verified against the
        // pre-fix formula before writing this test, so this is a confirmed regression case, not
        // a hypothetical one). Length-delimiting must keep them distinct.
        let contains_delimiter = compute_hash(fixed_id(), fixed_timestamp(), "a|b", "c", "ok", "genesis");
        let delimiter_shifted = compute_hash(fixed_id(), fixed_timestamp(), "a", "b|c", "ok", "genesis");
        assert_ne!(contains_delimiter, delimiter_shifted,
            "a length-delimited encoding must not let a field's own content, containing the old separator, produce the same hash as a different field split");
    }

    #[test]
    fn changing_any_single_field_changes_the_hash() {
        let base = compute_hash(fixed_id(), fixed_timestamp(), "owner-001", "login", "ok", "genesis");
        assert_ne!(base, compute_hash(fixed_id(), fixed_timestamp(), "owner-002", "login", "ok", "genesis"), "actor");
        assert_ne!(base, compute_hash(fixed_id(), fixed_timestamp(), "owner-001", "logout", "ok", "genesis"), "action");
        assert_ne!(base, compute_hash(fixed_id(), fixed_timestamp(), "owner-001", "login", "denied", "genesis"), "result");
        assert_ne!(base, compute_hash(fixed_id(), fixed_timestamp(), "owner-001", "login", "ok", "other-hash"), "previous_hash");
    }

    #[test]
    fn the_hash_is_64_lowercase_hex_characters() {
        let hash = compute_hash(fixed_id(), fixed_timestamp(), "owner-001", "login", "ok", "genesis");
        assert_eq!(hash.len(), 64);
        assert!(hash.chars().all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase()));
    }

    #[test]
    fn build_record_echoes_the_chain_link_and_the_supplied_fields_unchanged() {
        let record = build_record("owner-001".into(), "login".into(), "ok".into(), "genesis".into());
        assert_eq!(record.actor, "owner-001");
        assert_eq!(record.action, "login");
        assert_eq!(record.result, "ok");
        assert_eq!(record.previous_hash, "genesis");
        assert_eq!(
            record.hash,
            compute_hash(record.id, record.timestamp, "owner-001", "login", "ok", "genesis"),
            "the stored hash must equal recomputing compute_hash from the record's own fields",
        );
    }

    #[test]
    fn two_records_built_back_to_back_never_collide() {
        let first = build_record("owner-001".into(), "login".into(), "ok".into(), "genesis".into());
        let second = build_record("owner-001".into(), "login".into(), "ok".into(), first.hash.clone());
        assert_ne!(first.id, second.id, "Uuid::new_v4() must not repeat across two calls in the same test");
        assert_ne!(first.hash, second.hash);
        assert_eq!(second.previous_hash, first.hash, "the chain link must be exactly the predecessor's hash");
    }
}
