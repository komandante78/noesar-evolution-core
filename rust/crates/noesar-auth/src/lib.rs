// SPDX-License-Identifier: AGPL-3.0-or-later
use argon2::{Argon2, PasswordHash, PasswordHasher, PasswordVerifier};
use argon2::password_hash::{rand_core::OsRng, SaltString};
use chrono::{DateTime, Duration, Utc};
use hmac::{Hmac, Mac};
use serde::{Deserialize, Serialize};
use sha1::Sha1;
use sha2::{Digest, Sha256};
use subtle::ConstantTimeEq;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum Role { Owner, Admin, Developer, User }

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserIdentity {
    pub id: Uuid,
    pub username: String,
    pub display_name: String,
    pub role: Role,
    pub password_phc: String,
    pub totp_secret_envelope: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionRecord {
    pub id: Uuid,
    pub token_digest: String,
    pub csrf_digest: String,
    pub user_id: Uuid,
    pub created_at: DateTime<Utc>,
    pub expires_at: DateTime<Utc>,
    pub idle_expires_at: DateTime<Utc>,
    pub elevated_until: Option<DateTime<Utc>>,
}

pub fn hash_password(password: &[u8]) -> anyhow::Result<String> {
    let salt = SaltString::generate(&mut OsRng);
    Ok(Argon2::default().hash_password(password, &salt)?.to_string())
}

pub fn verify_password(password: &[u8], phc: &str) -> bool {
    let Ok(parsed) = PasswordHash::new(phc) else { return false; };
    Argon2::default().verify_password(password, &parsed).is_ok()
}

pub fn token_digest(token: &[u8]) -> String {
    hex::encode(Sha256::digest(token))
}

pub fn verify_totp(secret: &[u8], code: &str, unix_seconds: i64) -> bool {
    if code.len() != 6 || !code.bytes().all(|b| b.is_ascii_digit()) { return false; }
    for window in -1_i64..=1 {
        let counter = ((unix_seconds / 30) + window) as u64;
        let mut mac = Hmac::<Sha1>::new_from_slice(secret).expect("HMAC accepts arbitrary key length");
        mac.update(&counter.to_be_bytes());
        let digest = mac.finalize().into_bytes();
        let offset = (digest[19] & 0x0f) as usize;
        let binary = ((digest[offset] as u32 & 0x7f) << 24)
            | ((digest[offset + 1] as u32) << 16)
            | ((digest[offset + 2] as u32) << 8)
            | digest[offset + 3] as u32;
        let expected = format!("{:06}", binary % 1_000_000);
        if expected.as_bytes().ct_eq(code.as_bytes()).into() { return true; }
    }
    false
}

impl SessionRecord {
    pub fn owner_elevated(&self, now: DateTime<Utc>) -> bool {
        self.elevated_until.is_some_and(|until| until > now)
    }
    pub fn elevate(&mut self, now: DateTime<Utc>) {
        self.elevated_until = Some(now + Duration::minutes(5));
    }
}

// D-0658. Nothing in the workspace calls this crate yet (F-RUST-001, D-0497) — it is a
// workspace member, compiled by `cargo build --workspace`, with no dependent and, until this
// phase, zero tests. That combination is exactly the one this project's own governance warns
// against: code nobody exercises is code nobody has actually shown to work, and this one holds
// real security primitives (Argon2 password hashing, RFC 6238 TOTP, constant-time comparison).
// These tests prove the crate's own logic independently of whether anything calls it yet.
#[cfg(test)]
mod tests {
    use super::*;

    fn session(elevated_until: Option<DateTime<Utc>>) -> SessionRecord {
        let now = Utc::now();
        SessionRecord {
            id: Uuid::nil(),
            token_digest: String::new(),
            csrf_digest: String::new(),
            user_id: Uuid::nil(),
            created_at: now,
            expires_at: now + Duration::hours(1),
            idle_expires_at: now + Duration::minutes(30),
            elevated_until,
        }
    }

    #[test]
    fn a_correct_password_verifies_against_its_own_hash() {
        let phc = hash_password(b"correct horse battery staple").expect("hash");
        assert!(verify_password(b"correct horse battery staple", &phc));
    }

    #[test]
    fn a_wrong_password_does_not_verify() {
        let phc = hash_password(b"correct horse battery staple").expect("hash");
        assert!(!verify_password(b"wrong password entirely", &phc));
    }

    #[test]
    fn a_malformed_phc_string_is_refused_not_panicked_on() {
        assert!(!verify_password(b"anything", "not a phc string"));
        assert!(!verify_password(b"anything", ""));
    }

    #[test]
    fn two_hashes_of_the_same_password_differ_because_the_salt_is_random() {
        let a = hash_password(b"same password").expect("hash a");
        let b = hash_password(b"same password").expect("hash b");
        assert_ne!(a, b, "a fixed salt would make every stored hash of the same password identical");
        assert!(verify_password(b"same password", &a));
        assert!(verify_password(b"same password", &b));
    }

    #[test]
    fn token_digest_is_deterministic_and_matches_the_known_sha256_hex() {
        // sha256("") — a fixed, independently checkable vector, not merely self-consistency.
        assert_eq!(
            token_digest(b""),
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        );
        assert_eq!(token_digest(b"same input"), token_digest(b"same input"));
    }

    #[test]
    fn token_digest_differs_for_different_inputs() {
        assert_ne!(token_digest(b"token-a"), token_digest(b"token-b"));
    }

    #[test]
    fn totp_matches_the_rfc_6238_appendix_b_test_vector_truncated_to_6_digits() {
        // RFC 6238 Appendix B, SHA-1 row: secret is the ASCII string "12345678901234567890",
        // Time = 59 (T = 0000000000000001, i.e. counter 1), 8-digit TOTP = "94287082". This
        // implementation emits 6 digits (`% 1_000_000`), so the expected code is the last six:
        // "287082". An independent, published vector — not merely proof the code agrees with
        // itself.
        let secret = b"12345678901234567890";
        assert!(verify_totp(secret, "287082", 59));
    }

    #[test]
    fn totp_accepts_the_adjacent_thirty_second_windows_and_nothing_further() {
        let secret = b"a shared totp secret, arbitrary length";
        let now = 1_800_000_000_i64;
        let counter = now / 30;
        let code_at = |c: i64| -> String {
            // Recompute independently of verify_totp's own internals, using the same
            // algorithm, so this is a same-window round trip rather than a tautology about
            // verify_totp's internal loop.
            let mut mac = Hmac::<Sha1>::new_from_slice(secret).unwrap();
            mac.update(&(c as u64).to_be_bytes());
            let digest = mac.finalize().into_bytes();
            let offset = (digest[19] & 0x0f) as usize;
            let binary = ((digest[offset] as u32 & 0x7f) << 24)
                | ((digest[offset + 1] as u32) << 16)
                | ((digest[offset + 2] as u32) << 8)
                | digest[offset + 3] as u32;
            format!("{:06}", binary % 1_000_000)
        };
        assert!(verify_totp(secret, &code_at(counter), now), "the current window must verify");
        assert!(verify_totp(secret, &code_at(counter - 1), now), "one window earlier must verify (clock skew)");
        assert!(verify_totp(secret, &code_at(counter + 1), now), "one window later must verify (clock skew)");
        assert!(!verify_totp(secret, &code_at(counter - 2), now), "two windows earlier must NOT verify");
        assert!(!verify_totp(secret, &code_at(counter + 2), now), "two windows later must NOT verify");
    }

    #[test]
    fn totp_refuses_malformed_codes_without_computing_anything_useful() {
        assert!(!verify_totp(b"secret", "12345", 0), "5 digits must be refused");
        assert!(!verify_totp(b"secret", "1234567", 0), "7 digits must be refused");
        assert!(!verify_totp(b"secret", "12a456", 0), "a non-digit character must be refused");
        assert!(!verify_totp(b"secret", "", 0), "an empty code must be refused");
    }

    #[test]
    fn totp_a_code_from_one_secret_does_not_verify_against_another() {
        let now = 1_800_000_000_i64;
        // Mint a real code for secret-one; it must not verify under secret-two.
        let counter = now / 30;
        let mut mac = Hmac::<Sha1>::new_from_slice(b"secret-one").unwrap();
        mac.update(&(counter as u64).to_be_bytes());
        let digest = mac.finalize().into_bytes();
        let offset = (digest[19] & 0x0f) as usize;
        let binary = ((digest[offset] as u32 & 0x7f) << 24)
            | ((digest[offset + 1] as u32) << 16)
            | ((digest[offset + 2] as u32) << 8)
            | digest[offset + 3] as u32;
        let code = format!("{:06}", binary % 1_000_000);
        assert!(!verify_totp(b"secret-two", &code, now));
    }

    #[test]
    fn a_session_is_not_owner_elevated_by_default() {
        assert!(!session(None).owner_elevated(Utc::now()));
    }

    #[test]
    fn elevate_grants_owner_elevation_for_five_minutes() {
        let now = Utc::now();
        let mut record = session(None);
        record.elevate(now);
        assert!(record.owner_elevated(now), "immediately after elevate(), the session must be elevated");
        assert!(record.owner_elevated(now + Duration::minutes(4)), "still elevated inside the 5-minute window");
        assert!(!record.owner_elevated(now + Duration::minutes(6)), "no longer elevated past the 5-minute window");
    }

    #[test]
    fn a_session_elevated_exactly_until_now_is_not_elevated() {
        let now = Utc::now();
        let record = session(Some(now));
        assert!(!record.owner_elevated(now), "elevated_until must be strictly greater than now, not equal");
    }
}
