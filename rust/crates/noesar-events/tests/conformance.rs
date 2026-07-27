// SPDX-License-Identifier: AGPL-3.0-or-later
//! Runs `conformance/event-vectors.json` through the Rust event ledger. The Node ledger runs
//! the same file; neither is the oracle for the other.

use noesar_events::{Event, EventDraft, EventError, EventLedger, GENESIS};
use serde_json::Value;

fn vectors() -> Value {
    let path = concat!(env!("CARGO_MANIFEST_DIR"), "/../../../conformance/event-vectors.json");
    let text = std::fs::read_to_string(path)
        .unwrap_or_else(|error| panic!("event vectors unreadable at {path}: {error}"));
    serde_json::from_str(&text).expect("event vectors are not valid JSON")
}

fn kind(error: &EventError) -> &'static str {
    match error {
        EventError::DanglingCausation { .. } => "DANGLING_CAUSATION",
        EventError::CrossCorrelation { .. } => "CROSS_CORRELATION",
        EventError::DuplicateId { .. } => "DUPLICATE_ID",
        EventError::SecondRoot { .. } => "SECOND_ROOT",
        EventError::CauseInTheFuture { .. } => "CAUSE_IN_THE_FUTURE",
        EventError::ChainBroken { .. } => "CHAIN_BROKEN",
        EventError::Invalid { .. } => "INVALID",
    }
}

fn chain_of(count: usize) -> EventLedger {
    let mut ledger = EventLedger::new();
    ledger
        .append(EventDraft {
            id: "e1".into(),
            correlation_id: "run-1".into(),
            causation_id: None,
            actor: "a".into(),
            action: "start".into(),
            payload: "{}".into(),
            recorded_at_unix: 1_800_000_000,
        })
        .unwrap();
    for n in 2..=count {
        ledger
            .append(EventDraft {
                id: format!("e{n}"),
                correlation_id: "run-1".into(),
                causation_id: Some(format!("e{}", n - 1)),
                actor: "a".into(),
                action: "step".into(),
                payload: "{}".into(),
                recorded_at_unix: 1_800_000_000 + n as i64,
            })
            .unwrap();
    }
    ledger
}

#[test]
fn every_event_vector_passes() {
    let data = vectors();
    let mut checked = 0_usize;

    for vector in data["append"].as_array().unwrap() {
        let id = vector["id"].as_str().unwrap();
        let mut ledger = EventLedger::new();
        let mut accepted = 0_usize;
        let mut observed: Option<&'static str> = None;
        for draft in vector["drafts"].as_array().unwrap() {
            let outcome = ledger.append(EventDraft {
                id: draft["id"].as_str().unwrap().to_string(),
                correlation_id: draft["correlationId"].as_str().unwrap().to_string(),
                causation_id: draft["causationId"].as_str().map(str::to_string),
                actor: "owner-001".into(),
                action: draft["action"].as_str().unwrap().to_string(),
                payload: "{}".into(),
                recorded_at_unix: draft["recordedAtUnix"].as_i64().unwrap(),
            });
            match outcome {
                Ok(_) => accepted += 1,
                Err(error) => {
                    observed = Some(kind(&error));
                    break;
                }
            }
        }
        assert_eq!(
            accepted as u64,
            vector["expected"]["accepted"].as_u64().unwrap(),
            "{id} accepted (kind {observed:?})"
        );
        if let Some(expected) = vector["expected"]["kind"].as_str() {
            assert_eq!(observed, Some(expected), "{id} kind");
        }
        if let Some(valid) = vector["expected"]["chainValid"].as_bool() {
            assert_eq!(ledger.verify().is_ok(), valid, "{id} chain");
        }
        if let Some(target) = vector["expected"]["causalChainOf"].as_str() {
            let walked: Vec<&str> =
                ledger.causal_chain(target).iter().map(|event| event.id.as_str()).collect();
            let expected: Vec<&str> = vector["expected"]["causalChain"]
                .as_array()
                .unwrap()
                .iter()
                .map(|value| value.as_str().unwrap())
                .collect();
            assert_eq!(walked, expected, "{id} causal chain");
        }
        if let Some(sizes) = vector["expected"]["correlationSizes"].as_object() {
            for (correlation, size) in sizes {
                assert_eq!(
                    ledger.correlation(correlation).len() as u64,
                    size.as_u64().unwrap(),
                    "{id} correlation {correlation}"
                );
            }
        }
        checked += 1;
    }

    for vector in data["tamper"].as_array().unwrap() {
        let id = vector["id"].as_str().unwrap();
        let ledger = chain_of(vector["events"].as_u64().unwrap() as usize);
        let mut records: Vec<Event> = ledger.events().to_vec();
        if let Some(alter) = vector["alter"].as_object() {
            let position = alter["position"].as_u64().unwrap() as usize;
            records[position].payload = alter["value"].as_str().unwrap().to_string();
        }
        if let Some(remove) = vector["remove"].as_u64() {
            records.remove(remove as usize);
        }
        if let Some(swap) = vector["swap"].as_array() {
            records.swap(swap[0].as_u64().unwrap() as usize, swap[1].as_u64().unwrap() as usize);
        }
        // Through restore(), which recomputes every digest — the same path a ledger read back
        // from anywhere else would take. Rebuilding through append() would rehash the records
        // and hide exactly this.
        let outcome = EventLedger::restore(records);
        assert_eq!(outcome.is_ok(), vector["expected"]["valid"].as_bool().unwrap(), "{id}");
        checked += 1;
    }

    assert_eq!(chain_of(2).events()[0].previous_digest, GENESIS);
    // A vector file that silently emptied would make both loops pass by running zero times.
    assert_eq!(checked, 14, "the vector file must not shrink unnoticed");
}
