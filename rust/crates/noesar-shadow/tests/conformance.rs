// SPDX-License-Identifier: AGPL-3.0-or-later
//! Runs `conformance/shadow-vectors.json` through the Rust comparison. The Node shadow runs
//! the same file; neither is the oracle for the other.

use noesar_reasoning::Expectation;
use noesar_shadow::{compare, Change, Observation, TestResult};
use serde_json::Value;
use std::collections::BTreeMap;

fn vectors() -> Value {
    let path = concat!(env!("CARGO_MANIFEST_DIR"), "/../../../conformance/shadow-vectors.json");
    let text = std::fs::read_to_string(path)
        .unwrap_or_else(|error| panic!("shadow vectors unreadable at {path}: {error}"));
    serde_json::from_str(&text).expect("shadow vectors are not valid JSON")
}

fn strings(value: &Value) -> Vec<String> {
    value
        .as_array()
        .map(|items| items.iter().map(|item| item.as_str().unwrap().to_string()).collect())
        .unwrap_or_default()
}

fn change(name: &str) -> Change {
    match name {
        "CREATED" => Change::Created,
        "MODIFIED" => Change::Modified,
        "DELETED" => Change::Deleted,
        other => panic!("unknown change `{other}` in the vectors"),
    }
}

#[test]
fn every_shadow_vector_passes() {
    let data = vectors();
    let mut checked = 0_usize;

    for vector in data["cases"].as_array().unwrap() {
        let id = vector["id"].as_str().unwrap();
        let expectation = Expectation::try_new(
            strings(&vector["expectation"]["testsExpectedToPass"]),
            strings(&vector["expectation"]["testsExpectedToFail"]),
            strings(&vector["expectation"]["pathsTheDiffMustTouch"]),
        )
        .unwrap_or_else(|error| panic!("{id}: {error}"));

        let mut changed = BTreeMap::new();
        for (path, kind) in vector["observation"]["changed"].as_object().unwrap() {
            changed.insert(path.clone(), change(kind.as_str().unwrap()));
        }
        let tests: Vec<TestResult> = vector["observation"]["tests"]
            .as_array()
            .unwrap()
            .iter()
            .map(|test| TestResult {
                name: test["name"].as_str().unwrap().to_string(),
                passed: test["passed"].as_bool().unwrap(),
            })
            .collect();
        let observation = Observation { changed, tests };

        let outcome = compare(&expectation, &observation);
        if vector["expected"]["refused"].as_bool().unwrap_or(false) {
            assert!(outcome.is_err(), "{id}: expected a refusal");
            checked += 1;
            continue;
        }
        let surprise = outcome.unwrap_or_else(|error| panic!("{id}: {error}"));
        assert_eq!(
            surprise.is_clean(),
            vector["expected"]["clean"].as_bool().unwrap(),
            "{id}: {surprise:?}"
        );
        for (field, actual) in [
            ("unexpected", &surprise.unexpected),
            ("expectedAndAbsent", &surprise.expected_and_absent),
            ("testsNeverRun", &surprise.tests_never_run),
            ("testsExpectedToPassThatFailed", &surprise.tests_expected_to_pass_that_failed),
            ("testsExpectedToFailThatPassed", &surprise.tests_expected_to_fail_that_passed),
            ("declaredCommandsThatFailed", &surprise.declared_commands_that_failed),
        ] {
            if !vector["expected"][field].is_null() {
                assert_eq!(actual, &strings(&vector["expected"][field]), "{id} {field}");
            }
        }
        checked += 1;
    }

    // A vector file that silently emptied would make the loop above pass by running zero
    // times, and the suite would report green for having checked nothing.
    assert_eq!(checked, 12, "the vector file must not shrink unnoticed");
}
