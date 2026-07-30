// SPDX-License-Identifier: AGPL-3.0-or-later
//! Runs `conformance/capability-vectors.json` through the Rust minter. The Node minter runs
//! the same file; neither is the oracle for the other.

use noesar_capability::{
    Approval, Attempt, AuthorizedPlan, CapabilityError,
    CapabilityRequest, Operation, TokenMinter,
};
use noesar_reasoning::{BlastRadius, Plan, PlanStep};
use serde_json::Value;

fn vectors() -> Value {
    let path = concat!(env!("CARGO_MANIFEST_DIR"), "/../../../conformance/capability-vectors.json");
    let text = std::fs::read_to_string(path)
        .unwrap_or_else(|error| panic!("capability vectors unreadable at {path}: {error}"));
    serde_json::from_str(&text).expect("capability vectors are not valid JSON")
}

fn operation(name: &str) -> Operation {
    match name {
        "READ" => Operation::Read,
        "WRITE" => Operation::Write,
        "DELETE" => Operation::Delete,
        "EXECUTE" => Operation::Execute,
        other => panic!("unknown operation `{other}` in the vectors"),
    }
}

fn kind(error: &CapabilityError) -> &'static str {
    match error {
        CapabilityError::NotAuthorized { .. } => "NOT_AUTHORIZED",
        CapabilityError::OutOfScope { .. } => "OUT_OF_SCOPE",
        CapabilityError::Refused { .. } => "REFUSED",
        CapabilityError::Invalid { .. } => "INVALID",
    }
}

fn steps_from(value: &Value) -> Vec<PlanStep> {
    value
        .as_array()
        .unwrap()
        .iter()
        .map(|step| {
            let files: Vec<String> = step["files"]
                .as_array()
                .unwrap()
                .iter()
                .map(|f| f.as_str().unwrap().to_string())
                .collect();
            PlanStep {
                id: step["id"].as_str().unwrap().to_string(),
                description: "s".into(),
                files: files.clone(),
                commands: Vec::new(),
                depends_on: Vec::new(),
                blast_radius: BlastRadius {
                    paths: files,
                    reaches_outside_workspace: step["outside"].as_bool().unwrap(),
                    destructive: step["destructive"].as_bool().unwrap(),
                },
            }
        })
        .collect()
}

fn request_from(value: &Value) -> CapabilityRequest {
    CapabilityRequest {
        step_id: value["stepId"].as_str().unwrap().to_string(),
        paths: value["paths"]
            .as_array()
            .unwrap()
            .iter()
            .map(|p| p.as_str().unwrap().to_string())
            .collect(),
        operations: value["operations"]
            .as_array()
            .unwrap()
            .iter()
            .map(|o| operation(o.as_str().unwrap()))
            .collect(),
        reason: "vector".into(),
        uses: value["uses"].as_u64().unwrap() as u32,
        expires_at_unix: value["expiresAtUnix"].as_i64().unwrap(),
        limits: None,
    }
}

#[test]
fn every_capability_vector_passes() {
    let data = vectors();
    let now = data["now"].as_i64().unwrap();
    let approval = Approval {
        approver_id: data["approval"]["approverId"].as_str().unwrap().to_string(),
        granted_at_unix: data["approval"]["grantedAtUnix"].as_i64().unwrap(),
        expires_at_unix: data["approval"]["expiresAtUnix"].as_i64().unwrap(),
        scope_note: data["approval"]["scopeNote"].as_str().unwrap().to_string(),
    };
    let mut checked = 0_usize;

    for vector in data["cases"].as_array().unwrap() {
        let id = vector["id"].as_str().unwrap();
        let plan = Plan::try_new(steps_from(&vector["steps"]), Vec::new(), "safe".into()).unwrap();
        let authorized = AuthorizedPlan::try_authorize(plan, approval.clone(), now).unwrap();
        let mut engine = TokenMinter::new(vec![7_u8; 32]).unwrap();
        let outcome = engine.mint(&authorized, &request_from(&vector["request"]), now);
        if vector["expected"]["minted"].as_bool().unwrap() {
            let token = outcome.unwrap_or_else(|error| panic!("{id}: {error}"));
            assert_eq!(token.plan_digest, authorized.digest(), "{id} plan digest");
            assert_eq!(token.mac().len(), 64, "{id} mac");
        } else {
            let error = outcome.expect_err(id);
            assert_eq!(kind(&error), vector["expected"]["kind"].as_str().unwrap(), "{id}: {error}");
        }
        checked += 1;
    }

    let grant_steps = vec![PlanStep {
        id: "a".into(),
        description: "s".into(),
        files: vec!["src/a.rs".into(), "src/other.rs".into()],
        commands: Vec::new(),
        depends_on: Vec::new(),
        blast_radius: BlastRadius {
            paths: vec!["src/a.rs".into(), "src/other.rs".into()],
            reaches_outside_workspace: false,
            destructive: false,
        },
    }];
    let grant_request = CapabilityRequest {
        step_id: "a".into(),
        paths: vec!["src/a.rs".into()],
        operations: vec![Operation::Write],
        reason: "vector".into(),
        uses: 1,
        expires_at_unix: 1_800_000_600,
        limits: None,
    };

    for vector in data["spend"].as_array().unwrap() {
        let id = vector["id"].as_str().unwrap();
        let plan = Plan::try_new(grant_steps.clone(), Vec::new(), "safe".into()).unwrap();
        let authorized = AuthorizedPlan::try_authorize(plan, approval.clone(), now).unwrap();
        let mut engine = TokenMinter::new(vec![7_u8; 32]).unwrap();
        let token = engine.mint(&authorized, &grant_request, now).unwrap();
        let attempt = Attempt {
            path: vector["attempt"]["path"].as_str().unwrap().to_string(),
            operation: operation(vector["attempt"]["operation"].as_str().unwrap()),
        };
        let at = vector["at"].as_i64().unwrap();
        if vector["twice"].as_bool().unwrap_or(false) {
            engine.spend(&token, &attempt, at).expect("the first spend must succeed");
        }
        let outcome = engine.spend(&token, &attempt, at);
        if vector["expected"]["allowed"].as_bool().unwrap() {
            outcome.unwrap_or_else(|error| panic!("{id}: {error}"));
        } else {
            let error = outcome.expect_err(id);
            assert_eq!(kind(&error), vector["expected"]["kind"].as_str().unwrap(), "{id}: {error}");
        }
        checked += 1;
    }

    // A vector file that silently emptied would make every loop above pass by running zero
    // times, and the suite would report green for having checked nothing.
    assert_eq!(checked, 17, "the vector file must not shrink unnoticed");
}
