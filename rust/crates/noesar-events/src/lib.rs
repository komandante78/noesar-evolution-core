// SPDX-License-Identifier: AGPL-3.0-or-later
//! The event ledger: correlation, causation and a digest chain.
//!
//! Step 6 of phase 1 (`09_PIANO.md`). Distinct from the product's `AuditLedger`, which
//! records *who did what* as a flat hash chain. This records *what caused what*: every event
//! names the run it belongs to and the single event that caused it, so a question like "why
//! did this file change" is answered by walking backwards instead of by reading a log and
//! guessing which lines belong together.
//!
//! # Three properties, and each one is refused rather than repaired
//!
//! - **Correlation**: every event belongs to exactly one run, and a run has exactly one root.
//!   A second root would make "the beginning" ambiguous.
//! - **Causation**: an event's cause must already exist *and* belong to the same run. A cause
//!   from another run is not a cause, and a dangling one turns the graph into a lie the first
//!   time someone walks it.
//! - **Digest**: each event's digest covers the previous one, so removing or reordering a
//!   middle event breaks every digest after it. Verification recomputes the whole chain
//!   rather than checking each event against the digest the event itself carries — a record
//!   that vouches for itself vouches for nothing.

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;

pub const GENESIS: &str = "GENESIS";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum EventError {
    DanglingCausation { id: String, causation_id: String },
    CrossCorrelation { id: String, causation_id: String },
    DuplicateId { id: String },
    SecondRoot { correlation_id: String },
    CauseInTheFuture { id: String, causation_id: String },
    ChainBroken { position: usize, reason: String },
    Invalid { field: String, reason: String },
}

impl std::fmt::Display for EventError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::DanglingCausation { id, causation_id } => write!(
                f, "event `{id}` is caused by `{causation_id}`, which does not exist"),
            Self::CrossCorrelation { id, causation_id } => write!(
                f, "event `{id}` is caused by `{causation_id}` from another correlation"),
            Self::DuplicateId { id } => write!(f, "event `{id}` already exists"),
            Self::SecondRoot { correlation_id } => write!(
                f, "correlation `{correlation_id}` already has a root event"),
            Self::CauseInTheFuture { id, causation_id } => write!(
                f, "event `{id}` is recorded before its cause `{causation_id}`"),
            Self::ChainBroken { position, reason } => write!(
                f, "the digest chain is broken at position {position}: {reason}"),
            Self::Invalid { field, reason } => write!(f, "invalid `{field}`: {reason}"),
        }
    }
}

impl std::error::Error for EventError {}

pub type Outcome<T> = Result<T, EventError>;

/// What a caller asks to record. The digests are not its business: they are computed here.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct EventDraft {
    pub id: String,
    pub correlation_id: String,
    pub causation_id: Option<String>,
    pub actor: String,
    pub action: String,
    pub payload: String,
    pub recorded_at_unix: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Event {
    pub id: String,
    pub correlation_id: String,
    pub causation_id: Option<String>,
    pub actor: String,
    pub action: String,
    pub payload: String,
    pub recorded_at_unix: i64,
    pub previous_digest: String,
    pub digest: String,
}

/// Length-delimited over every field, including the previous digest. Without the delimiters
/// two different events could hash alike by moving a boundary between adjacent fields.
fn digest_of(event: &EventDraft, previous_digest: &str) -> String {
    let mut hasher = Sha256::new();
    let mut feed = |value: &str| {
        hasher.update(value.as_bytes());
        hasher.update(value.len().to_le_bytes());
    };
    feed(previous_digest);
    feed(&event.id);
    feed(&event.correlation_id);
    feed(event.causation_id.as_deref().unwrap_or(""));
    feed(&event.actor);
    feed(&event.action);
    feed(&event.payload);
    feed(&event.recorded_at_unix.to_string());
    hex::encode(hasher.finalize())
}

#[derive(Debug, Default)]
pub struct EventLedger {
    events: Vec<Event>,
    index: HashMap<String, usize>,
}

impl EventLedger {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn len(&self) -> usize {
        self.events.len()
    }

    pub fn is_empty(&self) -> bool {
        self.events.is_empty()
    }

    pub fn events(&self) -> &[Event] {
        &self.events
    }

    pub fn get(&self, id: &str) -> Option<&Event> {
        self.index.get(id).map(|position| &self.events[*position])
    }

    pub fn append(&mut self, draft: EventDraft) -> Outcome<&Event> {
        if draft.id.trim().is_empty() || draft.correlation_id.trim().is_empty() {
            return Err(EventError::Invalid {
                field: "EventDraft".into(),
                reason: "an event needs an id and the run it belongs to".into(),
            });
        }
        if draft.action.trim().is_empty() {
            return Err(EventError::Invalid {
                field: "EventDraft.action".into(),
                reason: "an event that does not say what happened records nothing".into(),
            });
        }
        if self.index.contains_key(&draft.id) {
            return Err(EventError::DuplicateId { id: draft.id });
        }

        match &draft.causation_id {
            Some(causation_id) => {
                let cause = self.get(causation_id).ok_or_else(|| {
                    EventError::DanglingCausation {
                        id: draft.id.clone(),
                        causation_id: causation_id.clone(),
                    }
                })?;
                if cause.correlation_id != draft.correlation_id {
                    return Err(EventError::CrossCorrelation {
                        id: draft.id,
                        causation_id: causation_id.clone(),
                    });
                }
                // An effect recorded before its cause is not a causal record; it is two
                // records with an arrow drawn between them.
                if draft.recorded_at_unix < cause.recorded_at_unix {
                    return Err(EventError::CauseInTheFuture {
                        id: draft.id,
                        causation_id: causation_id.clone(),
                    });
                }
            }
            None => {
                // A run with two beginnings has no beginning.
                if self
                    .events
                    .iter()
                    .any(|event| event.correlation_id == draft.correlation_id
                        && event.causation_id.is_none())
                {
                    return Err(EventError::SecondRoot {
                        correlation_id: draft.correlation_id,
                    });
                }
            }
        }

        let previous_digest =
            self.events.last().map(|event| event.digest.clone()).unwrap_or_else(|| GENESIS.into());
        let digest = digest_of(&draft, &previous_digest);
        let event = Event {
            id: draft.id,
            correlation_id: draft.correlation_id,
            causation_id: draft.causation_id,
            actor: draft.actor,
            action: draft.action,
            payload: draft.payload,
            recorded_at_unix: draft.recorded_at_unix,
            previous_digest,
            digest,
        };
        self.index.insert(event.id.clone(), self.events.len());
        self.events.push(event);
        Ok(self.events.last().expect("just pushed"))
    }

    /// Recomputes the whole chain from `GENESIS`. Every digest is derived again from the
    /// event's own fields rather than compared with the one it carries: a record that
    /// vouches for itself vouches for nothing.
    pub fn verify(&self) -> Outcome<()> {
        let mut previous = GENESIS.to_string();
        for (position, event) in self.events.iter().enumerate() {
            if event.previous_digest != previous {
                return Err(EventError::ChainBroken {
                    position,
                    reason: "the recorded previous digest is not the digest of the event before"
                        .into(),
                });
            }
            let draft = EventDraft {
                id: event.id.clone(),
                correlation_id: event.correlation_id.clone(),
                causation_id: event.causation_id.clone(),
                actor: event.actor.clone(),
                action: event.action.clone(),
                payload: event.payload.clone(),
                recorded_at_unix: event.recorded_at_unix,
            };
            let recomputed = digest_of(&draft, &previous);
            if recomputed != event.digest {
                return Err(EventError::ChainBroken {
                    position,
                    reason: "the event does not hash to the digest it carries".into(),
                });
            }
            previous = event.digest.clone();
        }
        Ok(())
    }

    /// Every event of one run, in the order recorded.
    pub fn correlation(&self, correlation_id: &str) -> Vec<&Event> {
        self.events
            .iter()
            .filter(|event| event.correlation_id == correlation_id)
            .collect()
    }

    /// Walks causation backwards from `id` to the root of its run: the answer to "why did
    /// this happen". Returns oldest first. An unknown id yields nothing rather than a
    /// partial chain that would read as complete.
    pub fn causal_chain(&self, id: &str) -> Vec<&Event> {
        let mut chain = Vec::new();
        let mut cursor = self.get(id);
        while let Some(event) = cursor {
            chain.push(event);
            cursor = event.causation_id.as_deref().and_then(|next| self.get(next));
        }
        chain.reverse();
        chain
    }

    /// Restores a ledger from records that came from somewhere else, verifying as it goes.
    /// Rebuilding by pushing into `append` would recompute the digests and hide exactly the
    /// tampering this is meant to catch.
    pub fn restore(events: Vec<Event>) -> Outcome<Self> {
        let mut index = HashMap::new();
        for (position, event) in events.iter().enumerate() {
            if index.insert(event.id.clone(), position).is_some() {
                return Err(EventError::DuplicateId { id: event.id.clone() });
            }
        }
        let ledger = Self { events, index };
        ledger.verify()?;
        Ok(ledger)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const NOW: i64 = 1_800_000_000;

    fn draft(id: &str, correlation: &str, causation: Option<&str>, at: i64) -> EventDraft {
        EventDraft {
            id: id.into(),
            correlation_id: correlation.into(),
            causation_id: causation.map(str::to_string),
            actor: "owner-001".into(),
            action: "plan.approved".into(),
            payload: "{}".into(),
            recorded_at_unix: at,
        }
    }

    fn ledger_of(count: usize) -> EventLedger {
        let mut ledger = EventLedger::new();
        ledger.append(draft("e1", "run-1", None, NOW)).unwrap();
        for n in 2..=count {
            ledger
                .append(draft(
                    &format!("e{n}"),
                    "run-1",
                    Some(&format!("e{}", n - 1)),
                    NOW + n as i64,
                ))
                .unwrap();
        }
        ledger
    }

    #[test]
    fn a_chain_verifies_and_the_first_event_hangs_off_genesis() {
        let ledger = ledger_of(4);
        assert_eq!(ledger.len(), 4);
        assert_eq!(ledger.events()[0].previous_digest, GENESIS);
        assert!(ledger.verify().is_ok());
    }

    #[test]
    fn a_cause_that_does_not_exist_is_refused() {
        let mut ledger = EventLedger::new();
        ledger.append(draft("e1", "run-1", None, NOW)).unwrap();
        assert!(matches!(
            ledger.append(draft("e2", "run-1", Some("ghost"), NOW)).unwrap_err(),
            EventError::DanglingCausation { .. }
        ));
        // The refused event left nothing behind.
        assert_eq!(ledger.len(), 1);
    }

    #[test]
    fn a_cause_from_another_run_is_not_a_cause() {
        let mut ledger = EventLedger::new();
        ledger.append(draft("e1", "run-1", None, NOW)).unwrap();
        ledger.append(draft("f1", "run-2", None, NOW)).unwrap();
        assert!(matches!(
            ledger.append(draft("f2", "run-2", Some("e1"), NOW)).unwrap_err(),
            EventError::CrossCorrelation { .. }
        ));
    }

    #[test]
    fn a_run_has_exactly_one_beginning() {
        let mut ledger = EventLedger::new();
        ledger.append(draft("e1", "run-1", None, NOW)).unwrap();
        assert!(matches!(
            ledger.append(draft("e2", "run-1", None, NOW)).unwrap_err(),
            EventError::SecondRoot { .. }
        ));
        // A different run may of course begin.
        assert!(ledger.append(draft("f1", "run-2", None, NOW)).is_ok());
    }

    #[test]
    fn an_effect_recorded_before_its_cause_is_refused() {
        let mut ledger = EventLedger::new();
        ledger.append(draft("e1", "run-1", None, NOW)).unwrap();
        assert!(matches!(
            ledger.append(draft("e2", "run-1", Some("e1"), NOW - 1)).unwrap_err(),
            EventError::CauseInTheFuture { .. }
        ));
        // The same instant is fine: two things can be recorded in one second.
        assert!(ledger.append(draft("e3", "run-1", Some("e1"), NOW)).is_ok());
    }

    #[test]
    fn a_duplicate_id_is_refused() {
        let mut ledger = ledger_of(2);
        assert!(matches!(
            ledger.append(draft("e1", "run-1", Some("e2"), NOW + 9)).unwrap_err(),
            EventError::DuplicateId { .. }
        ));
    }

    #[test]
    fn altering_an_event_breaks_the_chain_at_that_position() {
        let mut ledger = ledger_of(4);
        ledger.events[2].payload = "tampered".into();
        match ledger.verify().unwrap_err() {
            EventError::ChainBroken { position, .. } => assert_eq!(position, 2),
            other => panic!("expected a broken chain, got {other}"),
        }
    }

    #[test]
    fn removing_a_middle_event_breaks_the_chain() {
        let mut ledger = ledger_of(4);
        ledger.events.remove(1);
        assert!(ledger.verify().is_err());
    }

    #[test]
    fn reordering_two_events_breaks_the_chain() {
        let mut ledger = ledger_of(4);
        ledger.events.swap(1, 2);
        assert!(ledger.verify().is_err());
    }

    #[test]
    fn recomputing_the_digest_after_tampering_still_fails_because_the_chain_moves_on() {
        // The obvious repair by an attacker: alter an event and fix its own digest. Every
        // later event still carries the old previous digest, so the break simply moves.
        let mut ledger = ledger_of(4);
        ledger.events[1].payload = "tampered".into();
        let draft = EventDraft {
            id: ledger.events[1].id.clone(),
            correlation_id: ledger.events[1].correlation_id.clone(),
            causation_id: ledger.events[1].causation_id.clone(),
            actor: ledger.events[1].actor.clone(),
            action: ledger.events[1].action.clone(),
            payload: ledger.events[1].payload.clone(),
            recorded_at_unix: ledger.events[1].recorded_at_unix,
        };
        let previous = ledger.events[0].digest.clone();
        ledger.events[1].digest = digest_of(&draft, &previous);
        match ledger.verify().unwrap_err() {
            EventError::ChainBroken { position, .. } => assert_eq!(position, 2),
            other => panic!("expected a broken chain, got {other}"),
        }
    }

    #[test]
    fn the_causal_chain_answers_why_this_happened() {
        let ledger = ledger_of(4);
        let chain: Vec<&str> =
            ledger.causal_chain("e4").iter().map(|event| event.id.as_str()).collect();
        assert_eq!(chain, vec!["e1", "e2", "e3", "e4"]);
        // An unknown id yields nothing rather than a partial chain that would read complete.
        assert!(ledger.causal_chain("ghost").is_empty());
    }

    #[test]
    fn correlation_separates_the_runs() {
        let mut ledger = ledger_of(3);
        ledger.append(draft("f1", "run-2", None, NOW)).unwrap();
        ledger.append(draft("f2", "run-2", Some("f1"), NOW + 1)).unwrap();
        assert_eq!(ledger.correlation("run-1").len(), 3);
        assert_eq!(ledger.correlation("run-2").len(), 2);
        assert!(ledger.correlation("run-3").is_empty());
    }

    #[test]
    fn restoring_tampered_records_is_refused_instead_of_rehashed() {
        let ledger = ledger_of(3);
        let mut records = ledger.events().to_vec();
        records[1].payload = "tampered".into();
        // Rebuilding through append() would recompute the digests and hide exactly this.
        assert!(EventLedger::restore(records).is_err());
        assert!(EventLedger::restore(ledger.events().to_vec()).is_ok());
    }

    #[test]
    fn an_event_that_does_not_say_what_happened_is_refused() {
        let mut ledger = EventLedger::new();
        let mut empty = draft("e1", "run-1", None, NOW);
        empty.action = "  ".into();
        assert!(ledger.append(empty).is_err());
    }
}
