// SPDX-License-Identifier: AGPL-3.0-or-later
//! The executor that accepts nothing but a capability token, and the sandbox that spends it.
//!
//! Step 5 of phase 1 (`09_PIANO.md`), and the step that closes the circle: an approved plan
//! mints tokens, the executor may only act by spending one, everything it does lands in a
//! shadow, and the shadow is compared against what the plan declared.
//!
//! # The order is the security property
//!
//! The token is spent **before** the effect, never after. If spending is refused the effect
//! never happens; if the effect happened first, a refusal would be a report about damage
//! already done. Every attempt is recorded either way — a refused action is the one most
//! worth being able to find later.
//!
//! # What this executor cannot do, and says so
//!
//! [`Action::Execute`] is a declared, permanently refused variant. This layer has no
//! execution surface: there is no sandbox here that could contain a running process, and
//! offering the operation while quietly doing nothing would be worse than not offering it.
//! `noesar-capability` will happily mint an `EXECUTE` token for a step declared destructive;
//! the executor still refuses to act on one, and the refusal names the reason.

use noesar_capability::{Attempt, AuthorizedPlan, CapabilityToken, Operation, TokenMinter};
use noesar_reasoning::Expectation;
use noesar_shadow::{
    compare, Observation, ShadowCoverage, ShadowError, ShadowLimits, ShadowWorkspace, Surprise,
    TestResult,
};
use serde::{Deserialize, Serialize};
use std::fs;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum Action {
    Read { path: String },
    Write { path: String, contents: String },
    Delete { path: String },
    /// Declared and permanently refused. See the crate documentation.
    Execute { command: String },
}

impl Action {
    pub fn path(&self) -> &str {
        match self {
            Self::Read { path } | Self::Write { path, .. } | Self::Delete { path } => path,
            Self::Execute { .. } => "",
        }
    }

    pub fn operation(&self) -> Operation {
        match self {
            Self::Read { .. } => Operation::Read,
            Self::Write { .. } => Operation::Write,
            Self::Delete { .. } => Operation::Delete,
            Self::Execute { .. } => Operation::Execute,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ActionOutcome {
    pub path: String,
    pub operation: Operation,
    pub performed: bool,
    /// Present whenever `performed` is false. A refusal with no reason is what makes an
    /// audit trail useless.
    pub reason: Option<String>,
    pub token_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ExecutionReport {
    pub plan_digest: String,
    pub outcomes: Vec<ActionOutcome>,
    pub observation: Observation,
    /// Absent when the observation was empty: an observation of nothing cannot be compared,
    /// and reporting a clean surprise for it would be the worst possible lie.
    pub surprise: Option<Surprise>,
    pub comparison_refused: Option<String>,
}

impl ExecutionReport {
    pub fn performed(&self) -> usize {
        self.outcomes.iter().filter(|outcome| outcome.performed).count()
    }

    pub fn refused(&self) -> usize {
        self.outcomes.iter().filter(|outcome| !outcome.performed).count()
    }

    /// True only when every action was performed *and* the comparison ran *and* it was
    /// clean. A run whose comparison could not happen is never "ok".
    pub fn is_ok(&self) -> bool {
        self.refused() == 0
            && self.surprise.as_ref().map(Surprise::is_clean).unwrap_or(false)
    }
}

fn token_for<'a>(
    tokens: &'a [CapabilityToken],
    action: &Action,
) -> Option<&'a CapabilityToken> {
    tokens.iter().find(|token| {
        token.paths.iter().any(|path| path == action.path())
            && token.operations.contains(&action.operation())
    })
}

/// Runs `actions` against `shadow`, spending a token for each one first.
///
/// Nothing outside the shadow is touched: every path is resolved through the shadow's own
/// containment, so a path that escapes is refused rather than written.
///
/// The shadow must cover the **whole workspace**. One holding only the paths the plan named
/// cannot ever report that a file nobody declared was touched: `unexpected` would be empty
/// because there was nothing else there to observe, not because nothing else happened.
/// Refused here rather than run to a result that claims a guarantee decided by whoever
/// built the shadow.
pub fn execute(
    plan: &AuthorizedPlan,
    minter: &mut TokenMinter,
    tokens: &[CapabilityToken],
    shadow: &ShadowWorkspace,
    actions: &[Action],
    expectation: &Expectation,
    tests: Vec<TestResult>,
    now_unix: i64,
) -> Result<ExecutionReport, ShadowError> {
    if shadow.coverage() != ShadowCoverage::WholeWorkspace {
        return Err(ShadowError::Invalid {
            field: "shadow".into(),
            reason: "the executor requires a whole-workspace shadow: one holding only the \
                     declared paths cannot observe an undeclared write, and a clean comparison \
                     from it would be an artefact of its own construction"
                .into(),
        });
    }
    let mut outcomes = Vec::with_capacity(actions.len());

    for action in actions {
        if let Action::Execute { command } = action {
            outcomes.push(ActionOutcome {
                path: command.clone(),
                operation: Operation::Execute,
                performed: false,
                reason: Some(
                    "this layer has no execution surface: a command cannot be contained here, \
                     and pretending to run it would be worse than refusing"
                        .into(),
                ),
                token_id: None,
            });
            continue;
        }

        // A token bound to a different plan is not a token for this run. Checked before the
        // spend, because spending it would consume a use of somebody else's grant.
        let candidate = token_for(tokens, action)
            .filter(|token| token.plan_digest == plan.digest());
        let Some(token) = candidate else {
            outcomes.push(ActionOutcome {
                path: action.path().to_string(),
                operation: action.operation(),
                performed: false,
                reason: Some(
                    "no capability token of this plan grants this path and operation".into(),
                ),
                token_id: None,
            });
            continue;
        };

        let attempt =
            Attempt { path: action.path().to_string(), operation: action.operation() };
        // Spent BEFORE the effect. A refusal here must mean nothing happened.
        if let Err(error) = minter.spend(token, &attempt, now_unix) {
            outcomes.push(ActionOutcome {
                path: action.path().to_string(),
                operation: action.operation(),
                performed: false,
                reason: Some(error.to_string()),
                token_id: Some(token.id.clone()),
            });
            continue;
        }

        // Containment is the shadow's, not this crate's: one implementation of the rule.
        let resolved = match noesar_shadow::contained_in(shadow, action.path()) {
            Ok(path) => path,
            Err(error) => {
                outcomes.push(ActionOutcome {
                    path: action.path().to_string(),
                    operation: action.operation(),
                    performed: false,
                    reason: Some(error.to_string()),
                    token_id: Some(token.id.clone()),
                });
                continue;
            }
        };

        let result = match action {
            Action::Read { .. } => fs::read(&resolved).map(|_| ()),
            Action::Write { contents, .. } => {
                if let Some(parent) = resolved.parent() {
                    let _ = fs::create_dir_all(parent);
                }
                fs::write(&resolved, contents.as_bytes())
            }
            Action::Delete { .. } => fs::remove_file(&resolved),
            Action::Execute { .. } => unreachable!("handled above"),
        };

        match result {
            Ok(()) => outcomes.push(ActionOutcome {
                path: action.path().to_string(),
                operation: action.operation(),
                performed: true,
                reason: None,
                token_id: Some(token.id.clone()),
            }),
            Err(error) => outcomes.push(ActionOutcome {
                path: action.path().to_string(),
                operation: action.operation(),
                performed: false,
                reason: Some(error.to_string()),
                token_id: Some(token.id.clone()),
            }),
        }
    }

    let observation = shadow.observe(tests).unwrap_or(Observation {
        changed: Default::default(),
        tests: Vec::new(),
    });
    let (surprise, comparison_refused) = match compare(expectation, &observation) {
        Ok(value) => (Some(value), None),
        Err(error) => (None, Some(error.to_string())),
    };

    Ok(ExecutionReport {
        plan_digest: plan.digest().to_string(),
        outcomes,
        observation,
        surprise,
        comparison_refused,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use noesar_capability::{Approval, CapabilityRequest};
    use noesar_reasoning::{BlastRadius, Plan, PlanStep};
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicU32, Ordering};

    const NOW: i64 = 1_800_000_000;
    static COUNTER: AtomicU32 = AtomicU32::new(0);

    fn scratch(label: &str) -> PathBuf {
        let n = COUNTER.fetch_add(1, Ordering::SeqCst);
        let path = std::env::temp_dir().join(format!("noesar-exec-{label}-{n}"));
        let _ = fs::remove_dir_all(&path);
        fs::create_dir_all(&path).unwrap();
        path
    }

    fn step(id: &str, files: &[&str], destructive: bool) -> PlanStep {
        let files: Vec<String> = files.iter().map(|f| f.to_string()).collect();
        PlanStep {
            id: id.into(),
            description: "s".into(),
            files: files.clone(),
            commands: Vec::new(),
            depends_on: Vec::new(),
            blast_radius: BlastRadius {
                paths: files,
                reaches_outside_workspace: false,
                destructive,
            },
        }
    }

    fn authorized(steps: Vec<PlanStep>) -> AuthorizedPlan {
        AuthorizedPlan::try_authorize(
            Plan::try_new(steps, Vec::new(), "safe".into()).unwrap(),
            Approval {
                approver_id: "owner-001".into(),
                granted_at_unix: NOW,
                expires_at_unix: NOW + 3600,
                scope_note: "one repair".into(),
            },
            NOW,
        )
        .unwrap()
    }

    fn ask(paths: &[&str], operations: &[Operation], uses: u32) -> CapabilityRequest {
        CapabilityRequest {
            step_id: "a".into(),
            paths: paths.iter().map(|p| p.to_string()).collect(),
            operations: operations.to_vec(),
            reason: "test".into(),
            uses,
            expires_at_unix: NOW + 600,
        }
    }

    fn expectation(paths: &[&str]) -> Expectation {
        Expectation::try_new(
            Vec::new(),
            Vec::new(),
            paths.iter().map(|p| p.to_string()).collect(),
        )
        .unwrap()
    }

    struct Bench {
        source: PathBuf,
        shadow: ShadowWorkspace,
        minter: TokenMinter,
        plan: AuthorizedPlan,
    }

    fn bench(label: &str, files: &[&str], destructive: bool) -> Bench {
        let source = scratch(label);
        for file in files {
            fs::write(source.join(file), b"before").unwrap();
        }
        let shadow_root = scratch(&format!("{label}-shadow"));
        // The whole workspace, not the declared paths: a shadow built from exactly what the
        // plan named could never report an undeclared write, and the executor refuses one.
        let shadow = ShadowWorkspace::materialise(&source, &shadow_root, ShadowLimits::default())
        .unwrap();
        Bench {
            source,
            shadow,
            minter: TokenMinter::new(vec![7_u8; 32]).unwrap(),
            plan: authorized(vec![step("a", files, destructive)]),
        }
    }

    #[test]
    fn an_action_with_a_token_lands_in_the_shadow_and_never_in_the_source() {
        let mut b = bench("ok", &["a.txt"], false);
        let token = b.minter.mint(&b.plan, &ask(&["a.txt"], &[Operation::Write], 1), NOW).unwrap();
        let report = execute(
            &b.plan, &mut b.minter, &[token], &b.shadow,
            &[Action::Write { path: "a.txt".into(), contents: "after".into() }],
            &expectation(&["a.txt"]), Vec::new(), NOW,
        ).unwrap();
        assert_eq!(report.performed(), 1, "{report:?}");
        assert!(report.is_ok(), "{report:?}");
        assert_eq!(fs::read(b.shadow.root().join("a.txt")).unwrap(), b"after");
        // The source is untouched: that is what the shadow is for.
        assert_eq!(fs::read(b.source.join("a.txt")).unwrap(), b"before");
    }

    #[test]
    fn an_action_with_no_token_is_refused_and_changes_nothing() {
        let mut b = bench("notoken", &["a.txt"], false);
        let report = execute(
            &b.plan, &mut b.minter, &[], &b.shadow,
            &[Action::Write { path: "a.txt".into(), contents: "after".into() }],
            &expectation(&["a.txt"]), Vec::new(), NOW,
        ).unwrap();
        assert_eq!(report.performed(), 0);
        assert_eq!(fs::read(b.shadow.root().join("a.txt")).unwrap(), b"before");
        // Nothing happened, so nothing was observed, so the comparison could not run — and
        // the report says that instead of calling the run clean.
        assert!(report.surprise.is_none());
        assert!(report.comparison_refused.is_some());
        assert!(!report.is_ok());
    }

    #[test]
    fn a_token_for_a_different_path_does_not_authorise_this_one() {
        let mut b = bench("wrongpath", &["a.txt", "b.txt"], false);
        let token = b.minter.mint(&b.plan, &ask(&["a.txt"], &[Operation::Write], 1), NOW).unwrap();
        let report = execute(
            &b.plan, &mut b.minter, &[token], &b.shadow,
            &[Action::Write { path: "b.txt".into(), contents: "after".into() }],
            &expectation(&["b.txt"]), Vec::new(), NOW,
        ).unwrap();
        assert_eq!(report.performed(), 0);
        assert_eq!(fs::read(b.shadow.root().join("b.txt")).unwrap(), b"before");
    }

    #[test]
    fn a_token_for_a_different_operation_does_not_authorise_this_one() {
        let mut b = bench("wrongop", &["a.txt"], false);
        let token = b.minter.mint(&b.plan, &ask(&["a.txt"], &[Operation::Read], 1), NOW).unwrap();
        let report = execute(
            &b.plan, &mut b.minter, &[token], &b.shadow,
            &[Action::Write { path: "a.txt".into(), contents: "after".into() }],
            &expectation(&["a.txt"]), Vec::new(), NOW,
        ).unwrap();
        assert_eq!(report.performed(), 0);
        assert_eq!(fs::read(b.shadow.root().join("a.txt")).unwrap(), b"before");
    }

    #[test]
    fn a_spent_token_stops_authorising_and_the_second_action_has_no_effect() {
        let mut b = bench("spent", &["a.txt"], false);
        let token = b.minter.mint(&b.plan, &ask(&["a.txt"], &[Operation::Write], 1), NOW).unwrap();
        let report = execute(
            &b.plan, &mut b.minter, &[token], &b.shadow,
            &[
                Action::Write { path: "a.txt".into(), contents: "first".into() },
                Action::Write { path: "a.txt".into(), contents: "second".into() },
            ],
            &expectation(&["a.txt"]), Vec::new(), NOW,
        ).unwrap();
        assert_eq!(report.performed(), 1);
        assert_eq!(report.refused(), 1);
        // The second write never happened: the spend is refused before the effect.
        assert_eq!(fs::read(b.shadow.root().join("a.txt")).unwrap(), b"first");
    }

    #[test]
    fn a_token_minted_for_another_plan_is_not_accepted() {
        let mut b = bench("otherplan", &["a.txt"], false);
        let other = authorized(vec![step("a", &["a.txt"], false)]);
        // Same shape, different content, therefore a different digest.
        let mismatched = authorized(vec![step("a", &["a.txt", "extra.txt"], false)]);
        let token = b
            .minter
            .mint(&mismatched, &ask(&["a.txt"], &[Operation::Write], 1), NOW)
            .unwrap();
        assert_ne!(token.plan_digest, other.digest());
        let report = execute(
            &b.plan, &mut b.minter, &[token], &b.shadow,
            &[Action::Write { path: "a.txt".into(), contents: "after".into() }],
            &expectation(&["a.txt"]), Vec::new(), NOW,
        ).unwrap();
        assert_eq!(report.performed(), 0);
        assert_eq!(fs::read(b.shadow.root().join("a.txt")).unwrap(), b"before");
    }

    #[test]
    fn execute_is_declared_and_always_refused() {
        let mut b = bench("exec", &["a.txt"], true);
        // The token is mintable — the step is destructive — and the executor still refuses.
        let token = b.minter.mint(&b.plan, &ask(&["a.txt"], &[Operation::Execute], 1), NOW).unwrap();
        let report = execute(
            &b.plan, &mut b.minter, &[token], &b.shadow,
            &[Action::Execute { command: "rm -rf /".into() }],
            &expectation(&["a.txt"]), Vec::new(), NOW,
        ).unwrap();
        assert_eq!(report.performed(), 0);
        assert!(report.outcomes[0].reason.as_ref().unwrap().contains("no execution surface"));
    }

    #[test]
    fn a_path_leaving_the_shadow_is_refused_even_with_a_token() {
        let mut b = bench("escape", &["a.txt"], false);
        // The capability layer refuses to mint for a path the step never named, so the only
        // way to reach the executor's own containment is a token that names it. Minting one
        // requires the step to name it, which is itself the first wall; this proves the
        // second wall independently.
        let plan = authorized(vec![step("a", &["../outside.txt"], false)]);
        let token = b
            .minter
            .mint(&plan, &ask(&["../outside.txt"], &[Operation::Write], 1), NOW);
        // The first wall holds: the step declares a path outside, so nothing is minted.
        assert!(token.is_err(), "the capability layer must refuse this first");

        // Second wall, exercised directly: a hand-made action whose path escapes.
        let good = b.minter.mint(&b.plan, &ask(&["a.txt"], &[Operation::Write], 1), NOW).unwrap();
        let mut widened = good.clone();
        widened.paths = vec!["../outside.txt".into()];
        let report = execute(
            &b.plan, &mut b.minter, &[widened], &b.shadow,
            &[Action::Write { path: "../outside.txt".into(), contents: "x".into() }],
            &expectation(&["a.txt"]), Vec::new(), NOW,
        ).unwrap();
        assert_eq!(report.performed(), 0, "{report:?}");
        assert!(!b.source.parent().unwrap().join("outside.txt").exists());
    }

    #[test]
    fn a_delete_is_observed_and_compared() {
        let mut b = bench("del", &["a.txt"], true);
        let token = b.minter.mint(&b.plan, &ask(&["a.txt"], &[Operation::Delete], 1), NOW).unwrap();
        let report = execute(
            &b.plan, &mut b.minter, &[token], &b.shadow,
            &[Action::Delete { path: "a.txt".into() }],
            &expectation(&["a.txt"]), Vec::new(), NOW,
        ).unwrap();
        assert_eq!(report.performed(), 1);
        assert!(report.is_ok(), "{report:?}");
        assert!(!b.shadow.root().join("a.txt").exists());
        assert!(b.source.join("a.txt").exists());
    }

    #[test]
    fn a_change_nobody_declared_makes_the_run_not_ok_even_though_every_action_was_allowed() {
        let mut b = bench("surprise", &["a.txt", "secret.txt"], false);
        let token = b
            .minter
            .mint(&b.plan, &ask(&["a.txt", "secret.txt"], &[Operation::Write], 2), NOW)
            .unwrap();
        let report = execute(
            &b.plan, &mut b.minter, &[token], &b.shadow,
            &[
                Action::Write { path: "a.txt".into(), contents: "after".into() },
                Action::Write { path: "secret.txt".into(), contents: "after".into() },
            ],
            // Only a.txt was declared.
            &expectation(&["a.txt"]), Vec::new(), NOW,
        ).unwrap();
        assert_eq!(report.performed(), 2);
        assert!(!report.is_ok());
        assert_eq!(report.surprise.unwrap().unexpected, vec!["secret.txt".to_string()]);
    }

    // The case above catches the undeclared write only because the bench put `secret.txt` in
    // the plan's files, so the shadow held it. This is the real shape: a file the plan never
    // mentioned at all, which a targeted shadow would not contain and could not report.
    #[test]
    fn a_file_the_plan_never_named_is_still_observed_when_it_is_written() {
        let mut b = bench("never-named", &["a.txt"], false);
        fs::write(b.source.join("never-mentioned.txt"), b"before").unwrap();
        let shadow_root = scratch("never-named-shadow2");
        let shadow =
            ShadowWorkspace::materialise(&b.source, &shadow_root, ShadowLimits::default())
                .unwrap();
        let token = b
            .minter
            .mint(&b.plan, &ask(&["a.txt"], &[Operation::Write], 1), NOW)
            .unwrap();
        execute(
            &b.plan, &mut b.minter, &[token], &shadow,
            &[Action::Write { path: "a.txt".into(), contents: "after".into() }],
            &expectation(&["a.txt"]), Vec::new(), NOW,
        )
        .unwrap();
        // Something outside the executor touches the shadow: a test runner, a build, a script.
        fs::write(shadow.root().join("never-mentioned.txt"), b"touched").unwrap();
        let observed = shadow.observe(Vec::new()).unwrap();
        let surprise = compare(&expectation(&["a.txt"]), &observed).unwrap();
        assert!(!surprise.is_clean());
        assert_eq!(surprise.unexpected, vec!["never-mentioned.txt".to_string()]);
        assert_eq!(fs::read(b.source.join("never-mentioned.txt")).unwrap(), b"before");
    }

    #[test]
    fn the_executor_refuses_a_shadow_that_cannot_observe_an_undeclared_write() {
        let mut b = bench("coverage", &["a.txt"], false);
        let targeted_root = scratch("coverage-targeted");
        let targeted =
            ShadowWorkspace::create(&b.source, &targeted_root, &["a.txt".into()]).unwrap();
        let token = b
            .minter
            .mint(&b.plan, &ask(&["a.txt"], &[Operation::Write], 1), NOW)
            .unwrap();
        let refusal = execute(
            &b.plan, &mut b.minter, &[token], &targeted,
            &[Action::Write { path: "a.txt".into(), contents: "after".into() }],
            &expectation(&["a.txt"]), Vec::new(), NOW,
        );
        assert!(matches!(refusal, Err(ShadowError::Invalid { .. })));
        // Refused before anything was spent or written.
        assert_eq!(fs::read(targeted.root().join("a.txt")).unwrap(), b"before");
    }
}
