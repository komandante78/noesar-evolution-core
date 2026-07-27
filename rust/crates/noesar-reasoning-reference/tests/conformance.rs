// SPDX-License-Identifier: AGPL-3.0-or-later
//! Runs `conformance/reasoning-vectors.json` through the Rust reference provider.
//!
//! The Node reference provider runs the same file. Neither implementation is the oracle for
//! the other — the file is — so a change that suits one and not the other fails here or
//! there, instead of drifting silently until someone notices the two disagree.

use noesar_reasoning::{
    BlastRadius, Contrary, Decomposition, Evidence, Hypothesis, Plan, PlanStep, ReasoningProvider,
    RiskClass,
};
use noesar_reasoning_reference::{ReferenceReasoningProvider, NO_MODEL_REASON};
use serde_json::Value;

fn vectors() -> Value {
    let path = concat!(env!("CARGO_MANIFEST_DIR"), "/../../../conformance/reasoning-vectors.json");
    let text = std::fs::read_to_string(path)
        .unwrap_or_else(|error| panic!("reasoning vectors unreadable at {path}: {error}"));
    serde_json::from_str(&text).expect("reasoning vectors are not valid JSON")
}

fn strings(value: &Value) -> Vec<String> {
    value
        .as_array()
        .map(|items| items.iter().map(|item| item.as_str().unwrap().to_string()).collect())
        .unwrap_or_default()
}

fn step_from(value: &Value, provider: &ReferenceReasoningProvider) -> PlanStep {
    let files = strings(&value["files"]);
    let destructive = value["destructive"].as_bool().unwrap_or(false);
    let _ = provider;
    let outside = files.iter().any(|path| path.contains(".."));
    PlanStep {
        id: value["id"].as_str().unwrap().to_string(),
        description: value["id"].as_str().unwrap().to_string(),
        files: files.clone(),
        commands: strings(&value["commands"]),
        depends_on: strings(&value["dependsOn"]),
        blast_radius: BlastRadius { paths: files, reaches_outside_workspace: outside, destructive },
    }
}

fn plan_from(value: &Value, provider: &ReferenceReasoningProvider) -> Plan {
    let steps: Vec<PlanStep> =
        value.as_array().unwrap().iter().map(|item| step_from(item, provider)).collect();
    Plan::try_new(steps, Vec::new(), "safe".to_string()).expect("plan")
}

fn risk_name(risk: RiskClass) -> &'static str {
    match risk {
        RiskClass::Low => "LOW",
        RiskClass::Moderate => "MODERATE",
        RiskClass::High => "HIGH",
        RiskClass::Critical => "CRITICAL",
    }
}

#[tokio::test]
async fn every_reasoning_vector_passes() {
    let data = vectors();
    let provider =
        ReferenceReasoningProvider::new(data["workspaceRoot"].as_str().unwrap().to_string());
    let mut checked = 0_usize;

    assert_eq!(data["contractVersion"], noesar_reasoning::REASONING_CONTRACT_VERSION);

    for vector in data["interpret"].as_array().unwrap() {
        let id = vector["id"].as_str().unwrap();
        let request = vector["request"].as_str().unwrap();
        let outcome = provider.interpret(request, &[], "digest").await;
        if vector["expected"]["refused"].as_bool().unwrap_or(false) {
            assert!(outcome.is_err(), "{id}: expected a refusal");
        } else {
            let intent = outcome.unwrap_or_else(|error| panic!("{id}: {error}"));
            assert_eq!(intent.goal, vector["expected"]["goal"].as_str().unwrap(), "{id} goal");
            assert_eq!(
                intent.ambiguities.len() as u64,
                vector["expected"]["ambiguityCount"].as_u64().unwrap(),
                "{id} ambiguities"
            );
            assert_eq!(
                intent.success_criteria.len() as u64,
                vector["expected"]["successCriteriaCount"].as_u64().unwrap(),
                "{id} success criteria"
            );
        }
        checked += 1;
    }

    for vector in data["hypothesize"].as_array().unwrap() {
        let id = vector["id"].as_str().unwrap();
        let intent = noesar_reasoning::IntentFrame::try_new(
            vector["goal"].as_str().unwrap().to_string(),
            Vec::new(),
            vec!["c".into()],
            Vec::new(),
        )
        .unwrap();
        let hypotheses = provider.hypothesize(&intent, &[]).await.unwrap();
        assert_eq!(hypotheses.len() as u64, vector["expected"]["count"].as_u64().unwrap(), "{id}");
        assert!(matches!(hypotheses[0].contrary, Contrary::NotSought), "{id} contrary");
        assert_eq!(
            hypotheses[0].supporting.len() as u64,
            vector["expected"]["supportingCount"].as_u64().unwrap(),
            "{id} supporting"
        );
        checked += 1;
    }

    for vector in data["classify"].as_array().unwrap() {
        let id = vector["id"].as_str().unwrap();
        let plan = plan_from(&vector["steps"], &provider);
        let assessment = provider.classify(&plan).await.unwrap();
        assert_eq!(
            risk_name(assessment.overall),
            vector["expected"]["overall"].as_str().unwrap(),
            "{id} overall"
        );
        let per_step: Vec<&str> =
            assessment.per_step.iter().map(|(_, risk)| risk_name(*risk)).collect();
        assert_eq!(per_step, strings(&vector["expected"]["perStep"]), "{id} per step");
        checked += 1;
    }

    for vector in data["constrain"].as_array().unwrap() {
        let id = vector["id"].as_str().unwrap();
        let plan = plan_from(&vector["steps"], &provider);
        let outcome = provider.constrain(&plan, vector["policy"].as_str().unwrap()).await.unwrap();
        let refused = matches!(outcome, noesar_reasoning::Constrained::Refused { .. });
        assert_eq!(refused, vector["expected"]["refused"].as_bool().unwrap(), "{id} refused");
        if let noesar_reasoning::Constrained::Restricted { plan, removed } = outcome {
            let kept: Vec<String> = plan.steps().iter().map(|s| s.id.clone()).collect();
            assert_eq!(kept, strings(&vector["expected"]["keptIds"]), "{id} kept");
            assert_eq!(removed, strings(&vector["expected"]["removedIds"]), "{id} removed");
        }
        checked += 1;
    }

    for vector in data["decompose"].as_array().unwrap() {
        let id = vector["id"].as_str().unwrap();
        let step = step_from(&vector["step"], &provider);
        let outcome = provider.decompose(&step).await.unwrap();
        match (&outcome, vector["expected"]["split"].as_bool().unwrap()) {
            (Decomposition::Split { steps }, true) => assert_eq!(
                steps.len() as u64,
                vector["expected"]["parts"].as_u64().unwrap(),
                "{id} parts"
            ),
            (Decomposition::AlreadyVerifiable, false) => {}
            (other, expected) => panic!("{id}: expected split={expected}, got {other:?}"),
        }
        checked += 1;
    }

    for vector in data["expect"].as_array().unwrap() {
        let id = vector["id"].as_str().unwrap();
        let plan = plan_from(&vector["steps"], &provider);
        let outcome = provider.expect(&plan).await;
        if vector["expected"]["refused"].as_bool().unwrap() {
            assert!(outcome.is_err(), "{id}: expected a refusal");
        } else {
            let expectation = outcome.unwrap();
            assert_eq!(
                expectation.paths_the_diff_must_touch,
                strings(&vector["expected"]["paths"]),
                "{id} paths"
            );
            assert_eq!(
                expectation.tests_expected_to_pass,
                strings(&vector["expected"]["testsExpectedToPass"]),
                "{id} tests"
            );
        }
        checked += 1;
    }

    for vector in data["confidence"].as_array().unwrap() {
        let id = vector["id"].as_str().unwrap();
        let plan = plan_from(&vector["steps"], &provider);
        let results = strings(&vector["results"]);
        let confidence = provider.confidence(&plan, &results).await.unwrap();
        assert_eq!(
            confidence.reasons_not_higher().len() as u64,
            vector["expected"]["reasonCount"].as_u64().unwrap(),
            "{id} reasons"
        );
        assert!(
            confidence.value() <= vector["expected"]["maximum"].as_f64().unwrap(),
            "{id}: a provider with no model must not approach certainty, got {}",
            confidence.value()
        );
        assert!(confidence.reasons_not_higher().iter().any(|r| r == NO_MODEL_REASON), "{id}");
        checked += 1;
    }

    for vector in data["evidence"].as_array().unwrap() {
        let id = vector["id"].as_str().unwrap();
        let outcome = provider.evidence(vector["claim"].as_str().unwrap()).await;
        if vector["expected"]["refused"].as_bool().unwrap_or(false) {
            assert!(outcome.is_err(), "{id}: expected a refusal");
        } else {
            assert!(
                matches!(outcome.unwrap(), Evidence::UnsupportedInference { .. }),
                "{id}: the reference provider reads no corpus and must say so"
            );
        }
        checked += 1;
    }

    // A vector file that silently emptied would make every loop above pass by running zero
    // times, and the suite would report green for having checked nothing.
    assert_eq!(checked, 18, "the vector file must not shrink unnoticed");
    let _ = Hypothesis::try_new("x".into(), vec![], Contrary::NoneFound).unwrap();
}
