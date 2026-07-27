// SPDX-License-Identifier: AGPL-3.0-or-later
//! The reference `ReasoningProvider` — step 2 of phase 1 (`09_PIANO.md`).
//!
//! This is what makes `FOSS_CORE_DEPENDS_ON_ATOM = false` a measurement instead of a
//! sentence. The product must start, run, pass its tests and deliver its documented
//! functions with this provider alone. ATOM makes it better, not possible.
//!
//! # What a provider without a reasoning model may honestly do
//!
//! It has no model. It cannot infer intent from prose, and the tempting failure is to emit
//! confident-looking output anyway — a goal restated from the request, a hypothesis with no
//! evidence, a confidence of 0.9 with no reason. That output is indistinguishable from a
//! real one until it is acted on, which is the worst property a component can have.
//!
//! So every surface here is **derivational**: it computes from what it was given, and where
//! it cannot compute it says so through the contract's own types —
//! `Evidence::UnsupportedInference`, `Contrary::NotSought`, `Decomposition::AlreadyVerifiable`,
//! and a `Confidence` that is never allowed to reach certainty. The reasons are not
//! decoration: `noesar_reasoning` refuses to build a `Confidence` below 1.0 without them.
//!
//! Determinism is a property, not an accident: same inputs, same outputs, no clock, no
//! randomness. `fixtures` depends on it.

use noesar_reasoning::{
    Answer, BlastRadius, Cancellation, Confidence, Constrained, Contrary, Decomposition,
    Evidence, Expectation, FixturePack, Hypothesis, IntentFrame, Outcome, Plan, PlanStep,
    ProviderIdentity, ReasoningError, ReasoningProvider, RiskAssessment, RiskClass,
    REASONING_CONTRACT_VERSION,
};
use sha2::{Digest, Sha256};

/// Stated once, used everywhere a confidence is minted. The product should be able to show
/// a person why the number is what it is.
pub const NO_MODEL_REASON: &str =
    "reference provider: derived from the request and the plan, with no reasoning model";

/// A step touching more paths than this is not verifiable in one piece.
const MAX_VERIFIABLE_FILES: usize = 3;

pub struct ReferenceReasoningProvider {
    workspace_root: String,
}

impl ReferenceReasoningProvider {
    pub fn new(workspace_root: impl Into<String>) -> Self {
        Self { workspace_root: workspace_root.into() }
    }

    fn digest(parts: &[&str]) -> String {
        let mut hasher = Sha256::new();
        for part in parts {
            hasher.update(part.as_bytes());
            // Length-delimited: without it, ["ab","c"] and ["a","bc"] hash the same and two
            // different sessions could mint one fixture id.
            hasher.update(part.len().to_le_bytes());
        }
        hex::encode(hasher.finalize())
    }

    /// Words that mark a request as under-specified. Detected, never resolved: naming an
    /// ambiguity is honest, guessing which reading was meant is not.
    fn ambiguities(request: &str) -> Vec<String> {
        const VAGUE: &[&str] = &[
            "etc", "and so on", "as needed", "appropriate", "properly", "somehow",
            "various", "several", "et cetera", "whatever",
        ];
        let lowered = request.to_lowercase();
        let mut found: Vec<String> = VAGUE
            .iter()
            .filter(|term| lowered.contains(*term))
            .map(|term| format!("`{term}` does not name what is included"))
            .collect();
        if !request.contains('.') && request.split_whitespace().count() > 25 {
            found.push("the request is one long sentence with no stated boundary".into());
        }
        found
    }

    fn blast_radius(&self, files: &[String], destructive: bool) -> BlastRadius {
        let outside = files.iter().any(|path| !self.inside_workspace(path));
        BlastRadius { paths: files.to_vec(), reaches_outside_workspace: outside, destructive }
    }

    /// Textual containment is not path resolution: `..` is treated as leaving, because a
    /// provider that cannot resolve symlinks must not claim a path is contained.
    fn inside_workspace(&self, path: &str) -> bool {
        if path.contains("..") {
            return false;
        }
        if path.starts_with('/') || path.contains(":\\") {
            return path.starts_with(&self.workspace_root);
        }
        true
    }

    fn risk_of(step: &PlanStep) -> RiskClass {
        if step.blast_radius.reaches_outside_workspace {
            RiskClass::Critical
        } else if step.blast_radius.destructive {
            RiskClass::High
        } else if step.commands.is_empty() {
            RiskClass::Low
        } else {
            RiskClass::Moderate
        }
    }

    fn build_intent(request: &str) -> Outcome<IntentFrame> {
        let trimmed = request.trim();
        if trimmed.is_empty() {
            return Err(ReasoningError::Refused {
                reason: "an empty request has no intent to interpret".into(),
            });
        }
        // The goal is the request's first sentence, quoted rather than paraphrased: a
        // paraphrase without a model is a guess wearing the shape of an understanding.
        let goal = trimmed
            .split(['.', '\n'])
            .map(str::trim)
            .find(|part| !part.is_empty())
            .unwrap_or(trimmed)
            .to_string();
        IntentFrame::try_new(
            goal,
            Vec::new(),
            vec![
                "the plan's every step completed".into(),
                "the expectation of the plan met with no surprise".into(),
            ],
            Self::ambiguities(trimmed),
        )
    }
}

impl ReasoningProvider for ReferenceReasoningProvider {
    fn identity(&self) -> ProviderIdentity {
        ProviderIdentity {
            name: "reference".into(),
            version: env!("CARGO_PKG_VERSION").into(),
            contract_version: REASONING_CONTRACT_VERSION.into(),
            supports_simulation: false,
        }
    }

    fn interpret<'a>(
        &'a self,
        request: &'a str,
        project_rules: &'a [String],
        _map_digest: &'a str,
    ) -> Answer<'a, IntentFrame> {
        Box::pin(async move {
            let mut intent = Self::build_intent(request)?;
            // Project rules become non-goals verbatim. This provider does not judge which
            // rules apply -- that is a reasoning task -- so it carries all of them forward
            // where they stay visible instead of silently dropping the ones it cannot rank.
            intent.non_goals = project_rules.to_vec();
            Ok(intent)
        })
    }

    fn hypothesize<'a>(
        &'a self,
        intent: &'a IntentFrame,
        gathered: &'a [Evidence],
    ) -> Answer<'a, Vec<Hypothesis>> {
        Box::pin(async move {
            let supported: Vec<Evidence> =
                gathered.iter().filter(|item| item.is_supported()).cloned().collect();
            // One hypothesis, and it is the only one this provider can stand behind: that
            // the stated goal is achievable by the evidence already gathered. Emitting a
            // ranked list of causal alternatives is exactly the model-shaped work it cannot
            // do, and `Contrary::NotSought` says out loud that nothing looked for a
            // counter-example -- which is different from having looked and found none.
            Ok(vec![Hypothesis::try_new(
                format!("the stated goal is reachable as written: {}", intent.goal),
                supported,
                Contrary::NotSought,
            )?])
        })
    }

    fn plan<'a>(
        &'a self,
        chosen: &'a [Hypothesis],
        constraints: &'a [String],
        mode: &'a str,
    ) -> Answer<'a, Plan> {
        Box::pin(async move {
            if chosen.is_empty() {
                return Err(ReasoningError::Refused {
                    reason: "no hypothesis was chosen, so there is nothing to plan for".into(),
                });
            }
            let steps: Vec<PlanStep> = chosen
                .iter()
                .enumerate()
                .map(|(index, hypothesis)| {
                    let previous =
                        if index == 0 { Vec::new() } else { vec![format!("step-{index}")] };
                    PlanStep {
                        id: format!("step-{}", index + 1),
                        description: hypothesis.statement.clone(),
                        files: Vec::new(),
                        commands: Vec::new(),
                        depends_on: previous,
                        blast_radius: self.blast_radius(&[], false),
                    }
                })
                .collect();
            Plan::try_new(steps, constraints.to_vec(), mode.to_string())
        })
    }

    fn decompose<'a>(&'a self, step: &'a PlanStep) -> Answer<'a, Decomposition> {
        Box::pin(async move {
            if step.files.len() <= MAX_VERIFIABLE_FILES && step.commands.len() <= 1 {
                return Ok(Decomposition::AlreadyVerifiable);
            }
            let mut parts = Vec::new();
            for (index, chunk) in step.files.chunks(MAX_VERIFIABLE_FILES).enumerate() {
                let previous = if index == 0 {
                    Vec::new()
                } else {
                    vec![format!("{}-{}", step.id, index)]
                };
                parts.push(PlanStep {
                    id: format!("{}-{}", step.id, index + 1),
                    description: format!("{} ({} of the files)", step.description, chunk.len()),
                    files: chunk.to_vec(),
                    commands: step.commands.get(index).cloned().into_iter().collect(),
                    depends_on: previous,
                    blast_radius: self
                        .blast_radius(chunk, step.blast_radius.destructive),
                });
            }
            // A step with many commands but few files still has to split, or the guard
            // above would call it verifiable when nothing can attribute a failure.
            if parts.len() < 2 {
                parts = step
                    .commands
                    .iter()
                    .enumerate()
                    .map(|(index, command)| {
                        let previous = if index == 0 {
                            Vec::new()
                        } else {
                            vec![format!("{}-{}", step.id, index)]
                        };
                        PlanStep {
                            id: format!("{}-{}", step.id, index + 1),
                            description: format!("{}: {command}", step.description),
                            files: step.files.clone(),
                            commands: vec![command.clone()],
                            depends_on: previous,
                            blast_radius: step.blast_radius.clone(),
                        }
                    })
                    .collect();
            }
            Decomposition::split(parts)
        })
    }

    fn expect<'a>(&'a self, plan: &'a Plan) -> Answer<'a, Expectation> {
        Box::pin(async move {
            let mut paths: Vec<String> = Vec::new();
            let mut tests: Vec<String> = Vec::new();
            for step in plan.steps() {
                for path in &step.files {
                    if !paths.contains(path) {
                        paths.push(path.clone());
                    }
                }
                for command in &step.commands {
                    if command.contains("test") && !tests.contains(command) {
                        tests.push(command.clone());
                    }
                }
            }
            // A plan that touches nothing and runs no test cannot be surprised, and the
            // contract refuses to represent that. Refusing here names the reason instead of
            // letting the constructor's message surface as an internal error.
            if paths.is_empty() && tests.is_empty() {
                return Err(ReasoningError::Refused {
                    reason: "the plan names no file and no test, so nothing about it could \
                             turn out to be false".into(),
                });
            }
            Expectation::try_new(tests, Vec::new(), paths)
        })
    }

    fn constrain<'a>(&'a self, plan: &'a Plan, policy: &'a str) -> Answer<'a, Constrained> {
        Box::pin(async move {
            let restrictive = policy != "permissive";
            let mut kept: Vec<PlanStep> = Vec::new();
            let mut removed: Vec<String> = Vec::new();
            for step in plan.steps() {
                let refuse = step.blast_radius.reaches_outside_workspace
                    || (restrictive && step.blast_radius.destructive);
                if refuse {
                    removed.push(step.id.clone());
                } else {
                    // Dependencies on removed steps go with them: a kept step whose
                    // prerequisite was dropped would be authorised to run against a state
                    // that was never produced.
                    let mut narrowed = step.clone();
                    if narrowed.depends_on.iter().any(|id| removed.contains(id)) {
                        removed.push(narrowed.id.clone());
                        continue;
                    }
                    narrowed.depends_on.retain(|id| !removed.contains(id));
                    kept.push(narrowed);
                }
            }
            if kept.is_empty() {
                return Ok(Constrained::Refused {
                    reason: format!(
                        "every step of the plan is refused under policy `{policy}`: {} step(s) \
                         reach outside the workspace or are destructive",
                        removed.len()
                    ),
                });
            }
            let narrowed = Plan::try_new(
                kept,
                plan.constraints.to_vec(),
                plan.mode.clone(),
            )?;
            Ok(Constrained::Restricted { plan: narrowed, removed })
        })
    }

    fn classify<'a>(&'a self, plan: &'a Plan) -> Answer<'a, RiskAssessment> {
        Box::pin(async move {
            let per_step: Vec<(String, RiskClass)> = plan
                .steps()
                .iter()
                .map(|step| (step.id.clone(), Self::risk_of(step)))
                .collect();
            // The plan is as risky as its worst step. Averaging would let one critical step
            // hide behind nine harmless ones.
            let overall = per_step
                .iter()
                .map(|(_, risk)| *risk)
                .max()
                .unwrap_or(RiskClass::Low);
            Ok(RiskAssessment { per_step, overall })
        })
    }

    fn confidence<'a>(&'a self, plan: &'a Plan, results: &'a [String]) -> Answer<'a, Confidence> {
        Box::pin(async move {
            let mut reasons = vec![NO_MODEL_REASON.to_string()];
            let steps = plan.steps().len();
            let unverified = plan
                .steps()
                .iter()
                .filter(|step| step.commands.is_empty())
                .count();
            if unverified > 0 {
                reasons.push(format!(
                    "{unverified} of {steps} step(s) carry no command, so nothing would \
                     observe whether they worked"
                ));
            }
            if results.is_empty() {
                reasons.push("no result has been observed yet".into());
            }
            // Never 1.0, and the ceiling is deliberate: this provider cannot reach certainty
            // about work it did not reason about. The number falls as the reasons accumulate
            // rather than being asserted independently of them.
            let ceiling = 0.6_f64;
            let value = (ceiling - 0.1 * (reasons.len() as f64 - 1.0)).max(0.1);
            Confidence::try_new(value, reasons)
        })
    }

    fn evidence<'a>(&'a self, claim: &'a str) -> Answer<'a, Evidence> {
        Box::pin(async move {
            if claim.trim().is_empty() {
                return Err(ReasoningError::Refused {
                    reason: "an empty claim has nothing to support".into(),
                });
            }
            // This provider reads no corpus, so it has no source to offer -- and says that
            // rather than returning an empty source list that would read as "supported".
            Ok(Evidence::UnsupportedInference {
                rationale: format!(
                    "the reference provider holds no corpus and did not read anything to \
                     support: {claim}"
                ),
            })
        })
    }

    fn cancel<'a>(&'a self, plan: &'a Plan) -> Answer<'a, Cancellation> {
        Box::pin(async move {
            let ids: Vec<String> =
                plan.steps().iter().map(|step| step.id.clone()).collect();
            let refs: Vec<&str> = ids.iter().map(String::as_str).collect();
            Ok(Cancellation {
                checkpoint_id: Self::digest(&refs),
                // Nothing has been executed by this provider, so nothing is half-done and
                // the checkpoint is the plan itself. `resumable` is true because that is
                // observably the case, not because it is the friendlier answer.
                resumable: true,
                completed_steps: Vec::new(),
            })
        })
    }

    fn fixtures<'a>(&'a self, session_id: &'a str) -> Answer<'a, FixturePack> {
        Box::pin(async move {
            if session_id.trim().is_empty() {
                return Err(ReasoningError::Refused {
                    reason: "a replay pack needs the session it replays".into(),
                });
            }
            let entries = vec![
                format!("provider={}", self.identity().name),
                format!("contract={REASONING_CONTRACT_VERSION}"),
                format!("workspace={}", self.workspace_root),
            ];
            let refs: Vec<&str> =
                std::iter::once(session_id).chain(entries.iter().map(String::as_str)).collect();
            Ok(FixturePack {
                session_id: session_id.to_string(),
                digest: Self::digest(&refs),
                entries,
            })
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn provider() -> ReferenceReasoningProvider {
        ReferenceReasoningProvider::new("/workspace")
    }

    fn step(id: &str, files: Vec<String>, commands: Vec<String>, destructive: bool) -> PlanStep {
        PlanStep {
            id: id.into(),
            description: "s".into(),
            files: files.clone(),
            commands,
            depends_on: Vec::new(),
            blast_radius: BlastRadius {
                paths: files.clone(),
                reaches_outside_workspace: files.iter().any(|f| f.contains("..")),
                destructive,
            },
        }
    }

    #[tokio::test]
    async fn the_core_runs_end_to_end_with_no_atom_present() {
        // This test is what FOSS_CORE_DEPENDS_ON_ATOM = false means. Nothing here names or
        // reaches ATOM, and all eleven mandatory surfaces answer.
        let p = provider();
        let intent = p.interpret("Repair the parser. It drops trailing commas.", &[], "d")
            .await.expect("interpret");
        let hypotheses = p.hypothesize(&intent, &[]).await.expect("hypothesize");
        let plan = p.plan(&hypotheses, &[], "safe").await.expect("plan");
        p.decompose(&plan.steps()[0]).await.expect("decompose");
        p.constrain(&plan, "restrictive").await.expect("constrain");
        p.classify(&plan).await.expect("classify");
        p.confidence(&plan, &[]).await.expect("confidence");
        p.evidence("the parser drops commas").await.expect("evidence");
        p.cancel(&plan).await.expect("cancel");
        p.fixtures("session-1").await.expect("fixtures");
        assert_eq!(p.identity().name, "reference");
    }

    #[tokio::test]
    async fn simulate_is_not_claimed() {
        let p = provider();
        let plan = p
            .plan(&[Hypothesis::try_new("h".into(), vec![], Contrary::NotSought).unwrap()], &[], "safe")
            .await
            .unwrap();
        assert!(p.simulate(&plan, "/shadow").await.is_err());
        assert!(!p.identity().supports_simulation);
    }

    #[tokio::test]
    async fn confidence_never_reaches_certainty_and_always_carries_the_no_model_reason() {
        let p = provider();
        let plan = p
            .plan(&[Hypothesis::try_new("h".into(), vec![], Contrary::NotSought).unwrap()], &[], "safe")
            .await
            .unwrap();
        let confidence = p.confidence(&plan, &[]).await.expect("confidence");
        assert!(confidence.value() < 1.0);
        assert!(confidence.value() > 0.0);
        assert!(confidence
            .reasons_not_higher()
            .iter()
            .any(|reason| reason == NO_MODEL_REASON));
    }

    #[tokio::test]
    async fn certainty_is_unreachable_even_on_the_path_where_nothing_is_missing() {
        // The `< 1.0` assertion above passes for the wrong reason: the accumulated reasons
        // subtract from the ceiling, so it holds even if the ceiling itself is raised to
        // certainty. This drives the one path that reaches the ceiling untouched -- every
        // step carries a command and a result has been observed, so only the no-model reason
        // remains -- and pins the ceiling there. Found by seeding `ceiling = 1.0` and
        // watching all thirteen tests still pass.
        let p = provider();
        let plan = Plan::try_new(
            vec![step("a", vec!["src/a.rs".into()], vec!["cargo test".into()], false)],
            vec![],
            "safe".into(),
        )
        .unwrap();
        let confidence = p.confidence(&plan, &["observed".to_string()]).await.expect("confidence");
        assert_eq!(confidence.reasons_not_higher().len(), 1, "the minimal-reasons path");
        assert!(
            confidence.value() <= 0.6,
            "a provider with no reasoning model must not approach certainty, got {}",
            confidence.value()
        );
    }

    #[tokio::test]
    async fn the_ambiguity_is_named_and_never_resolved() {
        let p = provider();
        let intent = p
            .interpret("Tidy the config files, handlers etc, as needed.", &[], "d")
            .await
            .expect("interpret");
        assert_eq!(intent.ambiguities.len(), 2, "`etc` and `as needed` are both under-specified");
        // The goal is quoted from the request, not paraphrased into something it did not say.
        assert!(intent.goal.starts_with("Tidy the config files"));
    }

    #[tokio::test]
    async fn evidence_is_always_declared_an_unsupported_inference() {
        let p = provider();
        let evidence = p.evidence("the cache is cold").await.expect("evidence");
        assert!(!evidence.is_supported());
        assert!(p.evidence("   ").await.is_err());
    }

    #[tokio::test]
    async fn a_step_reaching_outside_the_workspace_is_refused_not_narrowed() {
        let p = provider();
        let plan = Plan::try_new(
            vec![step("a", vec!["../etc/passwd".into()], vec![], false)],
            vec![],
            "safe".into(),
        )
        .unwrap();
        match p.constrain(&plan, "restrictive").await.expect("constrain") {
            Constrained::Refused { reason } => assert!(reason.contains("outside the workspace")),
            other => panic!("expected a refusal, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn a_kept_step_never_survives_the_removal_of_what_it_depends_on() {
        let p = provider();
        let mut dependent = step("b", vec!["src/ok.rs".into()], vec![], false);
        dependent.depends_on = vec!["a".into()];
        let plan = Plan::try_new(
            vec![step("a", vec!["src/gone.rs".into()], vec![], true), dependent],
            vec![],
            "safe".into(),
        )
        .unwrap();
        // `a` is destructive and dropped under a restrictive policy; `b` needed it, so
        // authorising `b` alone would run it against a state that was never produced.
        match p.constrain(&plan, "restrictive").await.expect("constrain") {
            Constrained::Refused { .. } => {}
            Constrained::Restricted { plan, removed } => {
                assert!(removed.contains(&"a".to_string()));
                assert!(removed.contains(&"b".to_string()));
                assert!(plan.steps().iter().all(|s| s.id != "b"));
            }
        }
    }

    #[tokio::test]
    async fn the_plan_is_as_risky_as_its_worst_step() {
        let p = provider();
        let plan = Plan::try_new(
            vec![
                step("a", vec!["src/a.rs".into()], vec![], false),
                step("b", vec!["src/b.rs".into()], vec![], true),
            ],
            vec![],
            "safe".into(),
        )
        .unwrap();
        let assessment = p.classify(&plan).await.expect("classify");
        assert_eq!(assessment.overall, RiskClass::High);
        assert_eq!(assessment.per_step.len(), 2);
    }

    #[tokio::test]
    async fn a_plan_that_could_not_be_wrong_is_refused_rather_than_given_an_empty_expectation() {
        let p = provider();
        let plan = Plan::try_new(vec![step("a", vec![], vec![], false)], vec![], "safe".into())
            .unwrap();
        let refusal = p.expect(&plan).await.unwrap_err();
        assert!(matches!(refusal, ReasoningError::Refused { .. }));
    }

    #[tokio::test]
    async fn a_step_too_large_to_verify_is_split_and_a_small_one_is_not() {
        let p = provider();
        let big = step(
            "a",
            (0..7).map(|i| format!("src/f{i}.rs")).collect(),
            vec!["cargo test".into(), "cargo build".into()],
            false,
        );
        match p.decompose(&big).await.expect("decompose") {
            Decomposition::Split { steps } => assert_eq!(steps.len(), 3),
            other => panic!("expected a split, got {other:?}"),
        }
        let small = step("b", vec!["src/one.rs".into()], vec!["cargo test".into()], false);
        assert!(matches!(
            p.decompose(&small).await.expect("decompose"),
            Decomposition::AlreadyVerifiable
        ));
    }

    #[tokio::test]
    async fn the_same_session_always_produces_the_same_replay_pack() {
        let p = provider();
        let first = p.fixtures("session-7").await.expect("fixtures");
        let second = p.fixtures("session-7").await.expect("fixtures");
        assert_eq!(first.digest, second.digest);
        let other = p.fixtures("session-8").await.expect("fixtures");
        assert_ne!(first.digest, other.digest);
        assert!(p.fixtures(" ").await.is_err());
    }

    #[test]
    fn the_digest_cannot_be_collided_by_moving_a_boundary() {
        // Without length delimiting, ["ab","c"] and ["a","bc"] hash identically and two
        // different sessions could mint one fixture id.
        assert_ne!(
            ReferenceReasoningProvider::digest(&["ab", "c"]),
            ReferenceReasoningProvider::digest(&["a", "bc"])
        );
    }

    #[tokio::test]
    async fn an_empty_request_is_refused_instead_of_producing_an_empty_intent() {
        let p = provider();
        assert!(p.interpret("   ", &[], "d").await.is_err());
        assert!(p.plan(&[], &[], "safe").await.is_err());
    }
}
