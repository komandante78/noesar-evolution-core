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
