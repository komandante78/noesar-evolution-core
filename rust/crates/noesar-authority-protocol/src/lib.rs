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

// D-0662 (F-RUST-001). The last of the three remaining zero-test crates, and the one carrying
// the most security-relevant logic in the group: HMAC-signed request envelopes with replay
// protection, clock-skew tolerance and per-field binding checks. Every refusal branch gets its
// own test, since an authority boundary that "mostly" checks nonce reuse or "mostly" checks the
// signature is not a boundary anyone can rely on.
#[cfg(test)]
mod tests {
    use super::*;

    const SECRET: [u8; 32] = [7_u8; 32];
    const NOW: i64 = 1_800_000_000;

    fn verifier() -> AuthorityVerifier {
        AuthorityVerifier::new(SECRET.to_vec(), 5).unwrap()
    }

    fn body() -> AuthorityEnvelopeBody {
        AuthorityEnvelopeBody {
            schema_version: "1.1".into(),
            actor_id: "actor-1".into(),
            session_id: "session-1".into(),
            action: "authority.health".into(),
            payload: serde_json::json!({"k": "v"}),
            nonce: "0123456789abcdef".into(),
            issued_at: NOW,
            expires_at: NOW + 10,
        }
    }

    #[test]
    fn a_correctly_signed_envelope_verifies_with_no_bindings() {
        let v = verifier();
        let envelope = v.sign(body()).expect("sign");
        let mut v = v;
        assert_eq!(v.verify(&envelope, NOW, ExpectedBindings::default()), Ok(()));
    }

    #[test]
    fn a_correctly_signed_envelope_verifies_when_every_binding_matches() {
        let v = verifier();
        let envelope = v.sign(body()).expect("sign");
        let mut v = v;
        let bindings = ExpectedBindings {
            actor_id: Some("actor-1"),
            session_id: Some("session-1"),
            action: Some("authority.health"),
        };
        assert_eq!(v.verify(&envelope, NOW, bindings), Ok(()));
    }

    #[test]
    fn a_mismatched_actor_binding_is_refused() {
        let v = verifier();
        let envelope = v.sign(body()).expect("sign");
        let mut v = v;
        let bindings = ExpectedBindings { actor_id: Some("someone-else"), ..Default::default() };
        assert_eq!(v.verify(&envelope, NOW, bindings), Err("authority envelope actor binding mismatch"));
    }

    #[test]
    fn a_mismatched_session_binding_is_refused() {
        let v = verifier();
        let envelope = v.sign(body()).expect("sign");
        let mut v = v;
        let bindings = ExpectedBindings { session_id: Some("someone-else"), ..Default::default() };
        assert_eq!(v.verify(&envelope, NOW, bindings), Err("authority envelope session binding mismatch"));
    }

    #[test]
    fn a_mismatched_action_binding_is_refused() {
        let v = verifier();
        let envelope = v.sign(body()).expect("sign");
        let mut v = v;
        let bindings = ExpectedBindings { action: Some("path.evaluate"), ..Default::default() };
        assert_eq!(v.verify(&envelope, NOW, bindings), Err("authority envelope action binding mismatch"));
    }

    #[test]
    fn a_tampered_payload_fails_the_signature_check_without_resigning() {
        let v = verifier();
        let mut envelope = v.sign(body()).expect("sign");
        envelope.body.payload = serde_json::json!({"k": "tampered"});
        let mut v = v;
        assert_eq!(v.verify(&envelope, NOW, ExpectedBindings::default()), Err("authority envelope signature mismatch"));
    }

    #[test]
    fn a_signature_from_a_different_secret_is_refused() {
        let signer = AuthorityVerifier::new(vec![9_u8; 32], 5).unwrap();
        let envelope = signer.sign(body()).expect("sign");
        let mut checker = verifier();
        assert_eq!(checker.verify(&envelope, NOW, ExpectedBindings::default()), Err("authority envelope signature mismatch"));
    }

    #[test]
    fn a_garbled_signature_encoding_is_refused_not_panicked_on() {
        let v = verifier();
        let mut envelope = v.sign(body()).expect("sign");
        envelope.signature = "not valid base64url!!".into();
        let mut v = v;
        assert_eq!(v.verify(&envelope, NOW, ExpectedBindings::default()), Err("invalid signature encoding"));
    }

    #[test]
    fn the_same_nonce_cannot_verify_twice_replay_is_refused() {
        let v = verifier();
        let envelope = v.sign(body()).expect("sign");
        let mut v = v;
        assert_eq!(v.verify(&envelope, NOW, ExpectedBindings::default()), Ok(()));
        assert_eq!(v.verify(&envelope, NOW, ExpectedBindings::default()), Err("authority envelope replay detected"));
    }

    #[test]
    fn an_envelope_issued_beyond_the_clock_skew_tolerance_in_the_future_is_refused() {
        let v = verifier();
        let mut b = body();
        b.issued_at = NOW + 6; // tolerance is 5
        b.expires_at = b.issued_at + 10;
        let envelope = v.sign(b).expect("sign");
        let mut v = v;
        assert_eq!(v.verify(&envelope, NOW, ExpectedBindings::default()), Err("authority envelope is from the future"));
    }

    #[test]
    fn an_envelope_issued_exactly_at_the_clock_skew_boundary_still_verifies() {
        let v = verifier();
        let mut b = body();
        b.issued_at = NOW + 5; // exactly the tolerance, not beyond it
        b.expires_at = b.issued_at + 10;
        let envelope = v.sign(b).expect("sign");
        let mut v = v;
        assert_eq!(v.verify(&envelope, NOW, ExpectedBindings::default()), Ok(()));
    }

    #[test]
    fn an_envelope_expired_beyond_the_clock_skew_tolerance_is_refused() {
        let v = verifier();
        let mut b = body();
        b.issued_at = NOW - 20;
        b.expires_at = NOW - 6; // tolerance is 5, so this is expired
        let envelope = v.sign(b).expect("sign");
        let mut v = v;
        assert_eq!(v.verify(&envelope, NOW, ExpectedBindings::default()), Err("authority envelope expired"));
    }

    #[test]
    fn constructing_a_verifier_with_a_short_secret_is_refused() {
        assert_eq!(AuthorityVerifier::new(vec![1_u8; 31], 5).err(), Some("authority protocol secret must be at least 32 bytes"));
    }

    #[test]
    fn validate_body_refuses_an_unsupported_schema_version() {
        let mut b = body();
        b.schema_version = "2.0".into();
        assert_eq!(validate_body(&b), Err("unsupported schema version"));
    }

    #[test]
    fn validate_body_refuses_an_empty_actor_or_session() {
        let mut b = body();
        b.actor_id = "".into();
        assert_eq!(validate_body(&b), Err("actor and session are required"));
        let mut b = body();
        b.session_id = "".into();
        assert_eq!(validate_body(&b), Err("actor and session are required"));
    }

    #[test]
    fn validate_body_refuses_an_action_not_on_the_allow_list() {
        let mut b = body();
        b.action = "not.a.real.action".into();
        assert_eq!(validate_body(&b), Err("unsupported authority action"));
    }

    #[test]
    fn validate_body_accepts_every_action_on_the_allow_list() {
        for action in ACTIONS {
            let mut b = body();
            b.action = (*action).into();
            assert_eq!(validate_body(&b), Ok(()), "{action} must be accepted");
        }
    }

    #[test]
    fn validate_body_refuses_a_nonce_shorter_than_16_bytes() {
        let mut b = body();
        b.nonce = "0123456789abcde".into(); // 15 chars
        assert_eq!(validate_body(&b), Err("nonce is too short"));
    }

    #[test]
    fn validate_body_refuses_a_lifetime_outside_one_to_thirty_seconds() {
        let mut zero_lifetime = body();
        zero_lifetime.expires_at = zero_lifetime.issued_at;
        assert_eq!(validate_body(&zero_lifetime), Err("invalid authority envelope lifetime"));

        let mut too_long = body();
        too_long.expires_at = too_long.issued_at + 31;
        assert_eq!(validate_body(&too_long), Err("invalid authority envelope lifetime"));

        let mut at_the_boundary = body();
        at_the_boundary.expires_at = at_the_boundary.issued_at + 30;
        assert_eq!(validate_body(&at_the_boundary), Ok(()));
    }
}
