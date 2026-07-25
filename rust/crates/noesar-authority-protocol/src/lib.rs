// SPDX-License-Identifier: AGPL-3.0-or-later
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use hmac::{Hmac, Mac};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::Sha256;
use std::collections::HashSet;
use subtle::ConstantTimeEq;

type HmacSha256 = Hmac<Sha256>;

const ACTIONS: &[&str] = &[
    "authority.health",
    "path.evaluate",
    "approval.verify",
    "capability.authorize",
    "data-plane.status",
];

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AuthorityEnvelopeBody {
    pub schema_version: String,
    pub actor_id: String,
    pub session_id: String,
    pub action: String,
    pub payload: Value,
    pub nonce: String,
    pub issued_at: i64,
    pub expires_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AuthorityEnvelope {
    #[serde(flatten)]
    pub body: AuthorityEnvelopeBody,
    pub signature: String,
}

#[derive(Debug, Clone, Default)]
pub struct ExpectedBindings<'a> {
    pub actor_id: Option<&'a str>,
    pub session_id: Option<&'a str>,
    pub action: Option<&'a str>,
}

pub struct AuthorityVerifier {
    secret: Vec<u8>,
    used_nonces: HashSet<String>,
    max_clock_skew_seconds: i64,
}

impl AuthorityVerifier {
    pub fn new(
        secret: Vec<u8>,
        max_clock_skew_seconds: i64,
    ) -> Result<Self, &'static str> {
        if secret.len() < 32 {
            return Err("authority protocol secret must be at least 32 bytes");
        }
        Ok(Self {
            secret,
            used_nonces: HashSet::new(),
            max_clock_skew_seconds,
        })
    }

    pub fn sign(
        &self,
        body: AuthorityEnvelopeBody,
    ) -> Result<AuthorityEnvelope, &'static str> {
        validate_body(&body)?;
        let bytes = canonical_body(&body)?;
        let mut mac = HmacSha256::new_from_slice(&self.secret)
            .map_err(|_| "invalid HMAC secret")?;
        mac.update(&bytes);
        let signature = URL_SAFE_NO_PAD.encode(mac.finalize().into_bytes());
        Ok(AuthorityEnvelope { body, signature })
    }

    pub fn verify(
        &mut self,
        envelope: &AuthorityEnvelope,
        now_seconds: i64,
        bindings: ExpectedBindings<'_>,
    ) -> Result<(), &'static str> {
        validate_body(&envelope.body)?;
        if envelope.body.issued_at > now_seconds + self.max_clock_skew_seconds {
            return Err("authority envelope is from the future");
        }
        if envelope.body.expires_at < now_seconds - self.max_clock_skew_seconds {
            return Err("authority envelope expired");
        }
        if self.used_nonces.contains(&envelope.body.nonce) {
            return Err("authority envelope replay detected");
        }

        let bytes = canonical_body(&envelope.body)?;
        let mut mac = HmacSha256::new_from_slice(&self.secret)
            .map_err(|_| "invalid HMAC secret")?;
        mac.update(&bytes);
        let expected = mac.finalize().into_bytes();
        let supplied = URL_SAFE_NO_PAD
            .decode(&envelope.signature)
            .map_err(|_| "invalid signature encoding")?;
        if expected.as_slice().ct_eq(&supplied).unwrap_u8() != 1 {
            return Err("authority envelope signature mismatch");
        }

        if bindings.actor_id.is_some_and(|value| value != envelope.body.actor_id) {
            return Err("authority envelope actor binding mismatch");
        }
        if bindings
            .session_id
            .is_some_and(|value| value != envelope.body.session_id)
        {
            return Err("authority envelope session binding mismatch");
        }
        if bindings.action.is_some_and(|value| value != envelope.body.action) {
            return Err("authority envelope action binding mismatch");
        }

        self.used_nonces.insert(envelope.body.nonce.clone());
        Ok(())
    }
}

fn canonical_body(body: &AuthorityEnvelopeBody) -> Result<Vec<u8>, &'static str> {
    let value = json!({
        "schemaVersion": body.schema_version,
        "actorId": body.actor_id,
        "sessionId": body.session_id,
        "action": body.action,
        "payload": body.payload,
        "nonce": body.nonce,
        "issuedAt": body.issued_at,
        "expiresAt": body.expires_at,
    });
    noesar_canonical_json::to_vec(&value)
}

pub fn validate_body(body: &AuthorityEnvelopeBody) -> Result<(), &'static str> {
    if body.schema_version != "1.1" {
        return Err("unsupported schema version");
    }
    if body.actor_id.is_empty() || body.session_id.is_empty() {
        return Err("actor and session are required");
    }
    if !ACTIONS.contains(&body.action.as_str()) {
        return Err("unsupported authority action");
    }
    if body.nonce.len() < 16 {
        return Err("nonce is too short");
    }
    let lifetime = body.expires_at - body.issued_at;
    if !(1..=30).contains(&lifetime) {
        return Err("invalid authority envelope lifetime");
    }
    Ok(())
}
