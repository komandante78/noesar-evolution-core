// SPDX-License-Identifier: AGPL-3.0-or-later
//! Capability tokens, and the engine that mints them from an authorised Plan.
//!
//! Step 3 of phase 1 (`09_PIANO.md`). This is the mechanism behind the rule the phase
//! exists for: **the engine changes nothing except by executing an authorised Plan.**
//!
//! `03_ARCHITETTURA.md` §4 states the non-negotiable form: *no adapter may grant itself a
//! permission; a manifest is a request; the engine issues the tokens.* That is enforced by
//! types here rather than by convention:
//!
//! - a [`CapabilityRequest`] is inert — there is no method on it that yields a token;
//! - a [`CapabilityToken`] can only come out of [`TokenMinter::mint`];
//! - `mint` only accepts an [`AuthorizedPlan`], which cannot be built from a `Plan` alone;
//! - every token is bound to one step and cannot widen beyond that step's own files;
//! - a token carries a MAC over its scope, so a token edited after issue stops verifying,
//!   and a registry, so a token from another engine is unknown rather than merely invalid.
//!
//! Time is a parameter, never read from a clock: an expiry that depends on the ambient
//! clock cannot be tested for the moment it lapses, and this crate must be replayable.

use hmac::{Hmac, Mac};
use noesar_reasoning::Plan;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use subtle::ConstantTimeEq;

type HmacSha256 = Hmac<Sha256>;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum CapabilityError {
    /// The approval that would authorise the plan is missing, empty or already lapsed.
    NotAuthorized { reason: String },
    /// The request asks for something the plan's step does not contain.
    OutOfScope { reason: String },
    /// The token is unknown to this engine, altered, expired or spent.
    Refused { reason: String },
    Invalid { field: String, reason: String },
}

impl std::fmt::Display for CapabilityError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::NotAuthorized { reason } => write!(f, "not authorized: {reason}"),
            Self::OutOfScope { reason } => write!(f, "out of scope: {reason}"),
            Self::Refused { reason } => write!(f, "refused: {reason}"),
            Self::Invalid { field, reason } => write!(f, "invalid `{field}`: {reason}"),
        }
    }
}

impl std::error::Error for CapabilityError {}

pub type Outcome<T> = Result<T, CapabilityError>;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum Operation {
    Read,
    Write,
    Delete,
    Execute,
}

impl Operation {
    /// Delete and execute change or run things; a plan step that did not declare itself
    /// destructive must not be able to mint one.
    pub fn is_destructive(self) -> bool {
        matches!(self, Self::Delete | Self::Execute)
    }
}

/// A person's approval of a plan. Carries who approved and until when, because an approval
/// with no expiry is a standing licence, and this project has already refused one of those.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Approval {
    pub approver_id: String,
    pub granted_at_unix: i64,
    pub expires_at_unix: i64,
    pub scope_note: String,
}

/// A plan that a person has approved. There is no other constructor: holding a `Plan` is not
/// holding permission to act on it, and this type is what makes that difference exist in the
/// type system instead of in a comment.
#[derive(Debug, Clone)]
pub struct AuthorizedPlan {
    plan: Plan,
    approval: Approval,
    digest: String,
}

impl AuthorizedPlan {
    pub fn try_authorize(plan: Plan, approval: Approval, now_unix: i64) -> Outcome<Self> {
        if approval.approver_id.trim().is_empty() {
            return Err(CapabilityError::NotAuthorized {
                reason: "an approval with no approver names nobody accountable".into(),
            });
        }
        if approval.expires_at_unix <= approval.granted_at_unix {
            return Err(CapabilityError::NotAuthorized {
                reason: "an approval that expires before it is granted authorises nothing".into(),
            });
        }
        if now_unix >= approval.expires_at_unix {
            return Err(CapabilityError::NotAuthorized {
                reason: "the approval has lapsed".into(),
            });
        }
        let digest = plan_digest(&plan);
        Ok(Self { plan, approval, digest })
    }

    pub fn plan(&self) -> &Plan {
        &self.plan
    }

    pub fn approval(&self) -> &Approval {
        &self.approval
    }

    /// Identifies *which* plan was approved. A token carries it so that approving one plan
    /// and executing another is a mismatch the engine can see.
    pub fn digest(&self) -> &str {
        &self.digest
    }
}

/// Length-delimited over every field that changes what the plan would do.
fn plan_digest(plan: &Plan) -> String {
    let mut hasher = Sha256::new();
    let mut feed = |value: &str| {
        hasher.update(value.as_bytes());
        hasher.update(value.len().to_le_bytes());
    };
    feed(&plan.mode);
    for constraint in &plan.constraints {
        feed(constraint);
    }
    for step in plan.steps() {
        feed(&step.id);
        feed(&step.description);
        for file in &step.files {
            feed(file);
        }
        for command in &step.commands {
            feed(command);
        }
        for dependency in &step.depends_on {
            feed(dependency);
        }
        feed(if step.blast_radius.destructive { "destructive" } else { "non-destructive" });
    }
    hex::encode(hasher.finalize())
}

/// What an adapter asks for. Inert by construction: nothing on this type produces a token.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CapabilityRequest {
    pub step_id: String,
    pub paths: Vec<String>,
    pub operations: Vec<Operation>,
    pub reason: String,
    pub uses: u32,
    pub expires_at_unix: i64,
}

/// Issued by the engine, and only by the engine.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CapabilityToken {
    pub id: String,
    pub plan_digest: String,
    pub step_id: String,
    pub paths: Vec<String>,
    pub operations: Vec<Operation>,
    pub expires_at_unix: i64,
    pub uses_granted: u32,
    mac: String,
}

impl CapabilityToken {
    pub fn mac(&self) -> &str {
        &self.mac
    }
}

/// One attempted action, checked against a token before it happens.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Attempt {
    pub path: String,
    pub operation: Operation,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct Issued {
    uses_remaining: u32,
}

pub struct TokenMinter {
    secret: Vec<u8>,
    issued: HashMap<String, Issued>,
    counter: u64,
}

impl TokenMinter {
    pub fn new(secret: Vec<u8>) -> Outcome<Self> {
        if secret.len() < 32 {
            return Err(CapabilityError::Invalid {
                field: "secret".into(),
                reason: "a capability signing secret must be at least 32 bytes".into(),
            });
        }
        Ok(Self { secret, issued: HashMap::new(), counter: 0 })
    }

    fn sign(&self, token: &CapabilityToken) -> String {
        let mut mac = HmacSha256::new_from_slice(&self.secret).expect("hmac accepts any key");
        let mut feed = |value: &str| {
            mac.update(value.as_bytes());
            mac.update(&value.len().to_le_bytes());
        };
        feed(&token.id);
        feed(&token.plan_digest);
        feed(&token.step_id);
        for path in &token.paths {
            feed(path);
        }
        for operation in &token.operations {
            feed(match operation {
                Operation::Read => "read",
                Operation::Write => "write",
                Operation::Delete => "delete",
                Operation::Execute => "execute",
            });
        }
        feed(&token.expires_at_unix.to_string());
        feed(&token.uses_granted.to_string());
        hex::encode(mac.finalize().into_bytes())
    }

    /// The only way a `CapabilityToken` comes into existence.
    pub fn mint(
        &mut self,
        authorized: &AuthorizedPlan,
        request: &CapabilityRequest,
        now_unix: i64,
    ) -> Outcome<CapabilityToken> {
        let step = authorized
            .plan()
            .steps()
            .iter()
            .find(|step| step.id == request.step_id)
            .ok_or_else(|| CapabilityError::OutOfScope {
                reason: format!("step `{}` is not in the approved plan", request.step_id),
            })?;

        if request.paths.is_empty() || request.operations.is_empty() {
            return Err(CapabilityError::Invalid {
                field: "CapabilityRequest".into(),
                reason: "a capability granting no path or no operation is not a capability".into(),
            });
        }
        if request.uses == 0 {
            return Err(CapabilityError::Invalid {
                field: "CapabilityRequest.uses".into(),
                reason: "a token that can never be spent is a token that should not be issued"
                    .into(),
            });
        }
        // Widening is the whole attack. A step's own files are the ceiling, and a path the
        // step never named cannot be reached by asking nicely.
        for path in &request.paths {
            if !step.files.contains(path) {
                return Err(CapabilityError::OutOfScope {
                    reason: format!(
                        "path `{path}` is not among the files of step `{}`",
                        step.id
                    ),
                });
            }
        }
        // A step that did not declare itself destructive cannot mint a destructive token:
        // the declaration is what a person approved.
        if !step.blast_radius.destructive
            && request.operations.iter().any(|operation| operation.is_destructive())
        {
            return Err(CapabilityError::OutOfScope {
                reason: format!(
                    "step `{}` is not declared destructive and cannot grant delete or execute",
                    step.id
                ),
            });
        }
        if step.blast_radius.reaches_outside_workspace {
            return Err(CapabilityError::OutOfScope {
                reason: format!("step `{}` reaches outside the workspace", step.id),
            });
        }
        if request.expires_at_unix <= now_unix {
            return Err(CapabilityError::Invalid {
                field: "CapabilityRequest.expires_at_unix".into(),
                reason: "a token already expired at issue is a token nobody can use or audit"
                    .into(),
            });
        }
        // A capability may not outlive the approval it descends from. Otherwise revoking the
        // approval would leave live grants behind it.
        if request.expires_at_unix > authorized.approval().expires_at_unix {
            return Err(CapabilityError::OutOfScope {
                reason: "a capability may not outlive the approval it descends from".into(),
            });
        }

        self.counter += 1;
        let id = {
            let mut hasher = Sha256::new();
            hasher.update(authorized.digest().as_bytes());
            hasher.update(request.step_id.as_bytes());
            hasher.update(self.counter.to_le_bytes());
            hex::encode(hasher.finalize())[..32].to_string()
        };
        let mut token = CapabilityToken {
            id,
            plan_digest: authorized.digest().to_string(),
            step_id: request.step_id.clone(),
            paths: request.paths.clone(),
            operations: request.operations.clone(),
            expires_at_unix: request.expires_at_unix,
            uses_granted: request.uses,
            mac: String::new(),
        };
        token.mac = self.sign(&token);
        self.issued.insert(token.id.clone(), Issued { uses_remaining: request.uses });
        Ok(token)
    }

    /// Checks a token against one attempted action and consumes a use. Every refusal names
    /// its reason, because "denied" without a reason is what makes an audit log useless.
    pub fn spend(
        &mut self,
        token: &CapabilityToken,
        attempt: &Attempt,
        now_unix: i64,
    ) -> Outcome<()> {
        let expected = self.sign(token);
        // Constant time: a byte-at-a-time comparison tells a forger where it stopped.
        if expected.as_bytes().ct_eq(token.mac.as_bytes()).unwrap_u8() != 1 {
            return Err(CapabilityError::Refused {
                reason: "the token does not verify against this engine".into(),
            });
        }
        let state = self.issued.get(&token.id).copied().ok_or(CapabilityError::Refused {
            reason: "this engine did not issue that token".into(),
        })?;
        if now_unix >= token.expires_at_unix {
            return Err(CapabilityError::Refused { reason: "the token has expired".into() });
        }
        if state.uses_remaining == 0 {
            return Err(CapabilityError::Refused { reason: "the token is spent".into() });
        }
        if !token.paths.contains(&attempt.path) {
            return Err(CapabilityError::Refused {
                reason: format!("path `{}` is not granted by this token", attempt.path),
            });
        }
        if !token.operations.contains(&attempt.operation) {
            return Err(CapabilityError::Refused {
                reason: format!("operation `{:?}` is not granted by this token", attempt.operation),
            });
        }
        self.issued
            .insert(token.id.clone(), Issued { uses_remaining: state.uses_remaining - 1 });
        Ok(())
    }

    /// Revocation is a first-class act, not the absence of a renewal.
    pub fn revoke(&mut self, token_id: &str) -> bool {
        self.issued.remove(token_id).is_some()
    }

    pub fn outstanding(&self) -> usize {
        self.issued.values().filter(|state| state.uses_remaining > 0).count()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use noesar_reasoning::{BlastRadius, PlanStep};

    const NOW: i64 = 1_800_000_000;

    fn step(id: &str, files: &[&str], destructive: bool, outside: bool) -> PlanStep {
        let files: Vec<String> = files.iter().map(|f| f.to_string()).collect();
        PlanStep {
            id: id.into(),
            description: "s".into(),
            files: files.clone(),
            commands: Vec::new(),
            depends_on: Vec::new(),
            blast_radius: BlastRadius {
                paths: files,
                reaches_outside_workspace: outside,
                destructive,
            },
        }
    }

    fn approval() -> Approval {
        Approval {
            approver_id: "owner-001".into(),
            granted_at_unix: NOW,
            expires_at_unix: NOW + 3600,
            scope_note: "one repair".into(),
        }
    }

    fn authorized(steps: Vec<PlanStep>) -> AuthorizedPlan {
        let plan = Plan::try_new(steps, Vec::new(), "safe".into()).unwrap();
        AuthorizedPlan::try_authorize(plan, approval(), NOW).unwrap()
    }

    fn minter() -> TokenMinter {
        TokenMinter::new(vec![7_u8; 32]).unwrap()
    }

    fn request(step_id: &str, paths: &[&str], operations: &[Operation]) -> CapabilityRequest {
        CapabilityRequest {
            step_id: step_id.into(),
            paths: paths.iter().map(|p| p.to_string()).collect(),
            operations: operations.to_vec(),
            reason: "because".into(),
            uses: 1,
            expires_at_unix: NOW + 600,
        }
    }

    #[test]
    fn a_token_is_minted_and_spent_once() {
        let plan = authorized(vec![step("a", &["src/a.rs"], false, false)]);
        let mut engine = minter();
        let token = engine
            .mint(&plan, &request("a", &["src/a.rs"], &[Operation::Write]), NOW)
            .expect("mint");
        let attempt = Attempt { path: "src/a.rs".into(), operation: Operation::Write };
        assert!(engine.spend(&token, &attempt, NOW).is_ok());
        assert_eq!(
            engine.spend(&token, &attempt, NOW),
            Err(CapabilityError::Refused { reason: "the token is spent".into() })
        );
    }

    #[test]
    fn a_plan_alone_is_not_permission_to_act_on_it() {
        // The only route from Plan to AuthorizedPlan is an approval, and an expired or
        // unattributed one does not open it.
        let plan = Plan::try_new(vec![step("a", &["src/a.rs"], false, false)], vec![], "safe".into())
            .unwrap();
        let mut lapsed = approval();
        lapsed.expires_at_unix = NOW - 1;
        lapsed.granted_at_unix = NOW - 100;
        assert!(AuthorizedPlan::try_authorize(plan.clone(), lapsed, NOW).is_err());
        let mut anonymous = approval();
        anonymous.approver_id = "  ".into();
        assert!(AuthorizedPlan::try_authorize(plan, anonymous, NOW).is_err());
    }

    #[test]
    fn a_path_the_step_never_named_cannot_be_granted() {
        let plan = authorized(vec![step("a", &["src/a.rs"], false, false)]);
        let mut engine = minter();
        let refusal = engine
            .mint(&plan, &request("a", &["src/secret.rs"], &[Operation::Read]), NOW)
            .unwrap_err();
        assert!(matches!(refusal, CapabilityError::OutOfScope { .. }));
    }

    #[test]
    fn a_step_not_declared_destructive_cannot_grant_delete_or_execute() {
        let plan = authorized(vec![step("a", &["src/a.rs"], false, false)]);
        let mut engine = minter();
        for operation in [Operation::Delete, Operation::Execute] {
            assert!(matches!(
                engine.mint(&plan, &request("a", &["src/a.rs"], &[operation]), NOW).unwrap_err(),
                CapabilityError::OutOfScope { .. }
            ));
        }
        let destructive = authorized(vec![step("b", &["src/b.rs"], true, false)]);
        assert!(engine
            .mint(&destructive, &request("b", &["src/b.rs"], &[Operation::Delete]), NOW)
            .is_ok());
    }

    #[test]
    fn a_step_reaching_outside_the_workspace_mints_nothing() {
        let plan = authorized(vec![step("a", &["../etc/passwd"], false, true)]);
        let mut engine = minter();
        assert!(matches!(
            engine.mint(&plan, &request("a", &["../etc/passwd"], &[Operation::Read]), NOW).unwrap_err(),
            CapabilityError::OutOfScope { .. }
        ));
    }

    #[test]
    fn a_capability_may_not_outlive_its_approval() {
        let plan = authorized(vec![step("a", &["src/a.rs"], false, false)]);
        let mut engine = minter();
        let mut ask = request("a", &["src/a.rs"], &[Operation::Read]);
        ask.expires_at_unix = plan.approval().expires_at_unix + 1;
        assert!(matches!(
            engine.mint(&plan, &ask, NOW).unwrap_err(),
            CapabilityError::OutOfScope { .. }
        ));
    }

    #[test]
    fn a_token_edited_after_issue_stops_verifying() {
        let plan = authorized(vec![step("a", &["src/a.rs"], false, false)]);
        let mut engine = minter();
        let token = engine
            .mint(&plan, &request("a", &["src/a.rs"], &[Operation::Read]), NOW)
            .unwrap();
        // Widening the token by hand is the obvious attack, and the MAC is what answers it.
        let mut widened = token.clone();
        widened.paths.push("src/secret.rs".into());
        let attempt = Attempt { path: "src/secret.rs".into(), operation: Operation::Read };
        assert_eq!(
            engine.spend(&widened, &attempt, NOW),
            Err(CapabilityError::Refused {
                reason: "the token does not verify against this engine".into()
            })
        );
        let mut extended = token.clone();
        extended.expires_at_unix += 100_000;
        assert!(engine
            .spend(&extended, &Attempt { path: "src/a.rs".into(), operation: Operation::Read }, NOW)
            .is_err());
    }

    #[test]
    fn a_token_from_another_engine_is_unknown_not_merely_invalid() {
        let plan = authorized(vec![step("a", &["src/a.rs"], false, false)]);
        let mut first = minter();
        let token = first
            .mint(&plan, &request("a", &["src/a.rs"], &[Operation::Read]), NOW)
            .unwrap();
        let mut second = TokenMinter::new(vec![9_u8; 32]).unwrap();
        assert!(second
            .spend(&token, &Attempt { path: "src/a.rs".into(), operation: Operation::Read }, NOW)
            .is_err());
    }

    #[test]
    fn an_expired_token_is_refused_at_the_moment_it_lapses() {
        let plan = authorized(vec![step("a", &["src/a.rs"], false, false)]);
        let mut engine = minter();
        let token = engine
            .mint(&plan, &request("a", &["src/a.rs"], &[Operation::Read]), NOW)
            .unwrap();
        let attempt = Attempt { path: "src/a.rs".into(), operation: Operation::Read };
        // The boundary itself, not a second past it: `>=`, so the expiry instant is already out.
        assert!(engine.spend(&token, &attempt, token.expires_at_unix - 1).is_ok());
        let token2 = engine
            .mint(&plan, &request("a", &["src/a.rs"], &[Operation::Read]), NOW)
            .unwrap();
        assert!(engine.spend(&token2, &attempt, token2.expires_at_unix).is_err());
    }

    #[test]
    fn an_operation_or_path_outside_the_token_is_refused_at_spend_time() {
        let plan = authorized(vec![step("a", &["src/a.rs", "src/b.rs"], false, false)]);
        let mut engine = minter();
        let token = engine
            .mint(&plan, &request("a", &["src/a.rs"], &[Operation::Read]), NOW)
            .unwrap();
        assert!(engine
            .spend(&token, &Attempt { path: "src/b.rs".into(), operation: Operation::Read }, NOW)
            .is_err());
        assert!(engine
            .spend(&token, &Attempt { path: "src/a.rs".into(), operation: Operation::Write }, NOW)
            .is_err());
    }

    #[test]
    fn revocation_takes_a_live_token_out_of_service() {
        let plan = authorized(vec![step("a", &["src/a.rs"], false, false)]);
        let mut engine = minter();
        let mut ask = request("a", &["src/a.rs"], &[Operation::Read]);
        ask.uses = 5;
        let token = engine.mint(&plan, &ask, NOW).unwrap();
        assert_eq!(engine.outstanding(), 1);
        assert!(engine.revoke(&token.id));
        assert_eq!(engine.outstanding(), 0);
        assert!(engine
            .spend(&token, &Attempt { path: "src/a.rs".into(), operation: Operation::Read }, NOW)
            .is_err());
    }

    #[test]
    fn approving_one_plan_does_not_authorise_another() {
        let first = authorized(vec![step("a", &["src/a.rs"], false, false)]);
        let second = authorized(vec![step("a", &["src/other.rs"], false, false)]);
        assert_ne!(first.digest(), second.digest());
    }

    #[test]
    fn a_token_granting_nothing_is_not_issued() {
        let plan = authorized(vec![step("a", &["src/a.rs"], false, false)]);
        let mut engine = minter();
        let mut empty = request("a", &[], &[Operation::Read]);
        assert!(engine.mint(&plan, &empty, NOW).is_err());
        empty = request("a", &["src/a.rs"], &[]);
        assert!(engine.mint(&plan, &empty, NOW).is_err());
        let mut unusable = request("a", &["src/a.rs"], &[Operation::Read]);
        unusable.uses = 0;
        assert!(engine.mint(&plan, &unusable, NOW).is_err());
    }

    #[test]
    fn a_short_secret_is_refused_at_construction() {
        assert!(TokenMinter::new(vec![1_u8; 31]).is_err());
    }
}
