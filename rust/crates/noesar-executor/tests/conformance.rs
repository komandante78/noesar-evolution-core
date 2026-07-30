// SPDX-License-Identifier: AGPL-3.0-or-later
//! Runs `conformance/executor-vectors.json` through the Rust executor. The Node executor runs
//! the same file (services/reference-control-plane/test/executor-vectors.test.mjs); neither
//! is the oracle for the other.
//!
//! F4-014, closed: this file did not exist before, though executor.mjs's own header claimed
//! it did and MANIFEST.sha256 carried an entry for it. `execute()` has real side effects (a
//! signed `TokenMinter`, real files, a real shadow), so unlike shadow's pure `compare()` a
//! vector describes a scenario to build natively on each side, not input/output data alone.

use noesar_capability::{Approval, CapabilityRequest, CapabilityToken, Operation, TokenMinter};
use noesar_executor::{execute, Action};
use noesar_reasoning::{BlastRadius, Expectation, Plan, PlanStep};
use noesar_shadow::{ShadowError, ShadowLimits, ShadowWorkspace};
use serde_json::Value;
use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU32, Ordering};

const NOW: i64 = 1_800_000_000;
static COUNTER: AtomicU32 = AtomicU32::new(0);

fn vectors() -> Value {
    let path = concat!(env!("CARGO_MANIFEST_DIR"), "/../../../conformance/executor-vectors.json");
    let text = std::fs::read_to_string(path)
        .unwrap_or_else(|error| panic!("executor vectors unreadable at {path}: {error}"));
    serde_json::from_str(&text).expect("executor vectors are not valid JSON")
}

fn scratch(label: &str) -> PathBuf {
    let n = COUNTER.fetch_add(1, Ordering::SeqCst);
    let path = std::env::temp_dir().join(format!("noesar-execv-{label}-{n}"));
    let _ = fs::remove_dir_all(&path);
    fs::create_dir_all(&path).unwrap();
    path
}

fn strings(value: &Value) -> Vec<String> {
    value
        .as_array()
        .map(|items| items.iter().map(|item| item.as_str().unwrap().to_string()).collect())
        .unwrap_or_default()
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

fn authorized(files: &[String], destructive: bool, extra_file: Option<&str>) -> noesar_capability::AuthorizedPlan {
    let mut declared = files.to_vec();
    if let Some(extra) = extra_file {
        declared.push(extra.to_string());
    }
    let step = PlanStep {
        id: "a".into(),
        description: "s".into(),
        files: declared.clone(),
        commands: Vec::new(),
        depends_on: Vec::new(),
        blast_radius: BlastRadius {
            paths: declared,
            reaches_outside_workspace: false,
            destructive,
        },
    };
    noesar_capability::AuthorizedPlan::try_authorize(
        Plan::try_new(vec![step], Vec::new(), "safe".into()).unwrap(),
        Approval {
            approver_id: "owner-001".into(),
            granted_at_unix: NOW,
            expires_at_unix: NOW + 3600,
            scope_note: "test".into(),
        },
        NOW,
    )
    .unwrap()
}

#[test]
fn every_executor_vector_passes() {
    let data = vectors();
    let mut checked = 0_usize;

    for vector in data["cases"].as_array().unwrap() {
        let id = vector["id"].as_str().unwrap();
        let bench = &vector["bench"];
        let file_names: Vec<String> = bench["files"]
            .as_object()
            .unwrap()
            .keys()
            .cloned()
            .collect();
        let destructive = bench["destructive"].as_bool().unwrap_or(false);

        let source = scratch("src");
        let shadow_root = scratch("dst");
        for (name, contents) in bench["files"].as_object().unwrap() {
            fs::write(source.join(name), contents.as_str().unwrap()).unwrap_or_else(|error| {
                panic!("{id}: could not write fixture file {name}: {error}")
            });
        }

        let plan = authorized(&file_names, destructive, None);
        let other_plan = authorized(&file_names, destructive, Some("extra.txt"));

        let shadow = if bench["shadowCoverage"].as_str() == Some("DECLARED_PATHS_ONLY") {
            let declared = strings(&bench["declaredPaths"]);
            ShadowWorkspace::create(&source, &shadow_root, &declared)
                .unwrap_or_else(|error| panic!("{id}: targeted shadow setup failed: {error}"))
        } else {
            ShadowWorkspace::materialise(&source, &shadow_root, ShadowLimits::default())
                .unwrap_or_else(|error| panic!("{id}: whole-workspace shadow setup failed: {error}"))
        };

        let mut minter = TokenMinter::new(vec![7_u8; 32]).unwrap();
        let mut tokens: Vec<CapabilityToken> = Vec::new();
        for mint in vector["mints"].as_array().unwrap() {
            let against = if mint["plan"].as_str() == Some("other") { &other_plan } else { &plan };
            let request = CapabilityRequest {
                step_id: "a".into(),
                paths: strings(&mint["paths"]),
                operations: mint["operations"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .map(|value| operation(value.as_str().unwrap()))
                    .collect(),
                reason: "test".into(),
                uses: mint["uses"].as_u64().unwrap() as u32,
                expires_at_unix: NOW + 600,
        limits: None,
            };
            let token = minter
                .mint(against, &request, NOW)
                .unwrap_or_else(|error| panic!("{id}: mint failed: {error}"));
            tokens.push(token);
        }

        let actions: Vec<Action> = vector["actions"]
            .as_array()
            .unwrap()
            .iter()
            .map(|action| match action["kind"].as_str().unwrap() {
                "READ" => Action::Read { path: action["path"].as_str().unwrap().to_string() },
                "WRITE" => Action::Write {
                    path: action["path"].as_str().unwrap().to_string(),
                    contents: action["contents"].as_str().unwrap().to_string(),
                },
                "DELETE" => Action::Delete { path: action["path"].as_str().unwrap().to_string() },
                "EXECUTE" => Action::Execute { command: action["command"].as_str().unwrap().to_string() },
                other => panic!("{id}: unknown action kind `{other}`"),
            })
            .collect();

        let expectation = Expectation::try_new(
            Vec::new(),
            Vec::new(),
            strings(&vector["expectation"]["pathsTheDiffMustTouch"]),
        )
        .unwrap_or_else(|error| panic!("{id}: expectation setup failed: {error}"));

        let outcome = execute(&plan, &mut minter, &tokens, &shadow, &actions, &expectation, Vec::new(), NOW);

        let expected = &vector["expected"];
        if expected["wholeCallRefused"].as_bool().unwrap_or(false) {
            let error = outcome.expect_err(&format!("{id}: expected the whole call to be refused"));
            if let Some(kind) = expected["errorKind"].as_str() {
                let actual_kind = match error {
                    ShadowError::Containment { .. } => "CONTAINMENT",
                    ShadowError::Io { .. } => "IO",
                    ShadowError::Invalid { .. } => "INVALID",
                    ShadowError::Limit { .. } => "LIMIT",
                };
                assert_eq!(actual_kind, kind, "{id}: error kind");
            }
        } else {
            let report = outcome.unwrap_or_else(|error| panic!("{id}: execute failed: {error}"));
            if let Some(performed) = expected["performed"].as_u64() {
                assert_eq!(report.performed() as u64, performed, "{id}: performed");
            }
            if let Some(refused) = expected["refused"].as_u64() {
                assert_eq!(report.refused() as u64, refused, "{id}: refused");
            }
            if let Some(ok) = expected["ok"].as_bool() {
                assert_eq!(report.is_ok(), ok, "{id}: ok — {report:?}");
            }
            if !expected["surpriseUnexpected"].is_null() {
                let want = strings(&expected["surpriseUnexpected"]);
                let got = report.surprise.as_ref().map(|s| s.unexpected.clone()).unwrap_or_default();
                assert_eq!(got, want, "{id}: surprise.unexpected");
            }
            if let Some(reason) = expected["outcomeReason"].as_str() {
                assert!(
                    report.outcomes.iter().any(|outcome| outcome.reason.as_deref() == Some(reason)),
                    "{id}: no outcome carried the expected reason — got {:?}",
                    report.outcomes
                );
            }
        }

        for (name, contents) in expected["shadowFiles"].as_object().cloned().unwrap_or_default() {
            let actual = fs::read_to_string(shadow.root().join(&name))
                .unwrap_or_else(|error| panic!("{id}: shadow file {name} unreadable: {error}"));
            assert_eq!(actual, contents.as_str().unwrap(), "{id}: shadow file {name}");
        }
        for name in strings(&expected["shadowFilesAbsent"]) {
            assert!(
                !shadow.root().join(&name).exists(),
                "{id}: {name} must be absent from the shadow"
            );
        }
        for (name, contents) in expected["sourceFiles"].as_object().cloned().unwrap_or_default() {
            let actual = fs::read_to_string(source.join(&name))
                .unwrap_or_else(|error| panic!("{id}: source file {name} unreadable: {error}"));
            assert_eq!(actual, contents.as_str().unwrap(), "{id}: source file {name}");
        }

        let _ = fs::remove_dir_all(&source);
        let _ = fs::remove_dir_all(&shadow_root);
        checked += 1;
    }

    // A vector file that silently emptied would make the loop above pass by running zero
    // times, and the suite would report green for having checked nothing.
    assert_eq!(checked, 10, "the vector file must not shrink unnoticed");
}
