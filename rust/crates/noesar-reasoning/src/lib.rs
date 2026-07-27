// SPDX-License-Identifier: AGPL-3.0-or-later
//! The `ReasoningProvider` contract — public, versioned and frozen.
//!
//! This crate is the seam described by `MASTER_PROJECT/02_ATOM.md` §5. It is **not** ATOM:
//! it is the public surface the engine defines and that *any* implementation may satisfy.
//! ATOM is one such implementation and lives in a separate private repository.
//!
//! `FOSS_CORE_DEPENDS_ON_ATOM = false` is an invariant. Nothing in this crate refers to
//! ATOM, requires it, or degrades without it.
//!
//! # Why the types are shaped this way
//!
//! The contract could have been a set of methods returning strings. It is not, because the
//! dishonest answers are the ones that cost: a confidence with no reason it is not higher,
//! a claim shown to a person with no source behind it, a hypothesis with no counter-evidence
//! because nobody looked, an expectation that expects nothing and so makes "surprise"
//! undefinable. Each of those is made **unrepresentable** here rather than forbidden in
//! prose that nothing enforces.

use serde::{Deserialize, Serialize};
use std::future::Future;
use std::pin::Pin;

/// The frozen contract version. Changing this contract is an event, not a modification
/// (`MASTER_PROJECT/03_ARCHITETTURA.md` §4).
pub const REASONING_CONTRACT_VERSION: &str = "1.0.0";

/// The eleven surfaces every provider must implement. `simulate` is deliberately absent:
/// it is the advantage a provider may offer, never a requirement (`02_ATOM.md` §5).
pub const MANDATORY_SURFACES: &[&str] = &[
    "interpret", "hypothesize", "plan", "decompose", "expect", "constrain",
    "classify", "confidence", "evidence", "cancel", "fixtures",
];

/// The five load-bearing surfaces. The rest are what make the product honest.
pub const LOAD_BEARING_SURFACES: &[&str] =
    &["interpret", "hypothesize", "plan", "decompose", "expect"];

// ---------------------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum ReasoningError {
    /// The provider does not offer this surface. Only `simulate` may legitimately return
    /// this; a provider returning it for a mandatory surface is not a provider.
    Unsupported { surface: String },
    /// The request could not be honoured, with the reason a person can act on.
    Refused { reason: String },
    /// An invariant of this contract was violated while constructing a value.
    Invalid { field: String, reason: String },
    /// The provider failed for a reason that is not the caller's fault.
    Internal { detail: String },
}

impl std::fmt::Display for ReasoningError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Unsupported { surface } => write!(f, "surface `{surface}` is not supported"),
            Self::Refused { reason } => write!(f, "refused: {reason}"),
            Self::Invalid { field, reason } => write!(f, "invalid `{field}`: {reason}"),
            Self::Internal { detail } => write!(f, "internal: {detail}"),
        }
    }
}

impl std::error::Error for ReasoningError {}

pub type Outcome<T> = Result<T, ReasoningError>;

/// Boxed so the trait stays dyn-compatible: the engine selects a provider at runtime
/// (`reference` or ATOM) and must be able to hold it as `dyn ReasoningProvider`.
pub type Answer<'a, T> = Pin<Box<dyn Future<Output = Outcome<T>> + Send + 'a>>;

// ---------------------------------------------------------------------------------------
// Evidence — a claim is sourced, or it says it is not
// ---------------------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Source {
    pub locator: String,
    pub excerpt: String,
}

/// There is no third state, and no empty `Supported`. A claim shown to a person either
/// carries its sources or declares itself an unsupported inference (`02_ATOM.md`, `evidence`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum Evidence {
    Supported { sources: Vec<Source> },
    /// "inference, not supported" — said out loud rather than implied by an empty list.
    UnsupportedInference { rationale: String },
}

impl Evidence {
    pub fn supported(sources: Vec<Source>) -> Outcome<Self> {
        if sources.is_empty() {
            return Err(ReasoningError::Invalid {
                field: "Evidence::Supported.sources".into(),
                reason: "supported evidence with no source is an unsupported inference \
                         wearing the word `supported`".into(),
            });
        }
        Ok(Self::Supported { sources })
    }

    pub fn is_supported(&self) -> bool {
        matches!(self, Self::Supported { .. })
    }
}

// ---------------------------------------------------------------------------------------
// Intent
// ---------------------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct IntentFrame {
    pub goal: String,
    pub non_goals: Vec<String>,
    pub success_criteria: Vec<String>,
    pub ambiguities: Vec<String>,
}

impl IntentFrame {
    pub fn try_new(
        goal: String,
        non_goals: Vec<String>,
        success_criteria: Vec<String>,
        ambiguities: Vec<String>,
    ) -> Outcome<Self> {
        if goal.trim().is_empty() {
            return Err(ReasoningError::Invalid {
                field: "IntentFrame.goal".into(),
                reason: "an intent with no goal cannot be planned against".into(),
            });
        }
        if success_criteria.is_empty() {
            return Err(ReasoningError::Invalid {
                field: "IntentFrame.success_criteria".into(),
                reason: "without a success criterion `done` is undefinable".into(),
            });
        }
        Ok(Self { goal, non_goals, success_criteria, ambiguities })
    }
}

// ---------------------------------------------------------------------------------------
// Hypotheses — "we found none" and "we did not look" are different answers
// ---------------------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum Contrary {
    /// No search for counter-evidence was performed. Honest, and visibly weaker.
    NotSought,
    /// Counter-evidence was sought and none was found.
    NoneFound,
    Found { evidence: Vec<Evidence> },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Hypothesis {
    pub statement: String,
    pub supporting: Vec<Evidence>,
    /// Required by construction: the spec asks for evidence *for and against*, and an empty
    /// vector cannot say which of the two reasons it is empty for.
    pub contrary: Contrary,
}

impl Hypothesis {
    pub fn try_new(
        statement: String,
        supporting: Vec<Evidence>,
        contrary: Contrary,
    ) -> Outcome<Self> {
        if statement.trim().is_empty() {
            return Err(ReasoningError::Invalid {
                field: "Hypothesis.statement".into(),
                reason: "an empty hypothesis cannot be confirmed or refuted".into(),
            });
        }
        if let Contrary::Found { evidence } = &contrary {
            if evidence.is_empty() {
                return Err(ReasoningError::Invalid {
                    field: "Hypothesis.contrary".into(),
                    reason: "`Found` with no evidence is `NoneFound` misreported".into(),
                });
            }
        }
        Ok(Self { statement, supporting, contrary })
    }
}

// ---------------------------------------------------------------------------------------
// Plan
// ---------------------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub enum RiskClass {
    Low,
    Moderate,
    High,
    Critical,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct BlastRadius {
    pub paths: Vec<String>,
    pub reaches_outside_workspace: bool,
    pub destructive: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PlanStep {
    pub id: String,
    pub description: String,
    pub files: Vec<String>,
    pub commands: Vec<String>,
    /// Ids of steps that must complete first. Validated to refer only to *earlier* steps,
    /// which makes a dependency cycle unrepresentable rather than merely detected.
    pub depends_on: Vec<String>,
    pub blast_radius: BlastRadius,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Plan {
    steps: Vec<PlanStep>,
    pub constraints: Vec<String>,
    pub mode: String,
}

impl Plan {
    pub fn try_new(steps: Vec<PlanStep>, constraints: Vec<String>, mode: String) -> Outcome<Self> {
        if steps.is_empty() {
            return Err(ReasoningError::Invalid {
                field: "Plan.steps".into(),
                reason: "a plan with no step authorises nothing and must not be minted".into(),
            });
        }
        let mut seen: Vec<&str> = Vec::with_capacity(steps.len());
        for step in &steps {
            if step.id.trim().is_empty() {
                return Err(ReasoningError::Invalid {
                    field: "PlanStep.id".into(),
                    reason: "a step without an id cannot be referenced or audited".into(),
                });
            }
            if seen.contains(&step.id.as_str()) {
                return Err(ReasoningError::Invalid {
                    field: "PlanStep.id".into(),
                    reason: format!("duplicate step id `{}`", step.id),
                });
            }
            for dependency in &step.depends_on {
                if !seen.contains(&dependency.as_str()) {
                    return Err(ReasoningError::Invalid {
                        field: "PlanStep.depends_on".into(),
                        reason: format!(
                            "step `{}` depends on `{}`, which is not an earlier step",
                            step.id, dependency
                        ),
                    });
                }
            }
            seen.push(&step.id);
        }
        Ok(Self { steps, constraints, mode })
    }

    pub fn steps(&self) -> &[PlanStep] {
        &self.steps
    }
}

/// `constrain` either narrows the plan or refuses it — and a refusal carries its reason.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum Constrained {
    Restricted { plan: Plan, removed: Vec<String> },
    Refused { reason: String },
}

/// `decompose` must either produce more than one step or say the step was already atomic.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum Decomposition {
    Split { steps: Vec<PlanStep> },
    AlreadyVerifiable,
}

impl Decomposition {
    pub fn split(steps: Vec<PlanStep>) -> Outcome<Self> {
        if steps.len() < 2 {
            return Err(ReasoningError::Invalid {
                field: "Decomposition::Split.steps".into(),
                reason: "a split that yields one step is `AlreadyVerifiable` misreported".into(),
            });
        }
        Ok(Self::Split { steps })
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RiskAssessment {
    pub per_step: Vec<(String, RiskClass)>,
    pub overall: RiskClass,
}

// ---------------------------------------------------------------------------------------
// Expectation — this is what makes "surprise" definable
// ---------------------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Expectation {
    pub tests_expected_to_pass: Vec<String>,
    /// Tests expected to fail **on purpose** — the fail-first evidence.
    pub tests_expected_to_fail: Vec<String>,
    pub paths_the_diff_must_touch: Vec<String>,
}

impl Expectation {
    pub fn try_new(
        tests_expected_to_pass: Vec<String>,
        tests_expected_to_fail: Vec<String>,
        paths_the_diff_must_touch: Vec<String>,
    ) -> Outcome<Self> {
        if tests_expected_to_pass.is_empty()
            && tests_expected_to_fail.is_empty()
            && paths_the_diff_must_touch.is_empty()
        {
            return Err(ReasoningError::Invalid {
                field: "Expectation".into(),
                reason: "an expectation that expects nothing cannot be surprised, and \
                         surprise is the only signal shadow execution produces".into(),
            });
        }
        Ok(Self { tests_expected_to_pass, tests_expected_to_fail, paths_the_diff_must_touch })
    }
}

// ---------------------------------------------------------------------------------------
// Confidence — a number is not an answer without the reasons it is not higher
// ---------------------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Confidence {
    value: f64,
    reasons_not_higher: Vec<String>,
}

impl Confidence {
    pub fn try_new(value: f64, reasons_not_higher: Vec<String>) -> Outcome<Self> {
        if !value.is_finite() || !(0.0..=1.0).contains(&value) {
            return Err(ReasoningError::Invalid {
                field: "Confidence.value".into(),
                reason: "confidence must be a finite number in 0.0..=1.0".into(),
            });
        }
        if value < 1.0 && reasons_not_higher.is_empty() {
            return Err(ReasoningError::Invalid {
                field: "Confidence.reasons_not_higher".into(),
                reason: "a confidence below certainty without a stated reason is a number \
                         nobody can act on".into(),
            });
        }
        Ok(Self { value, reasons_not_higher })
    }

    pub fn value(&self) -> f64 {
        self.value
    }

    pub fn reasons_not_higher(&self) -> &[String] {
        &self.reasons_not_higher
    }
}

// ---------------------------------------------------------------------------------------
// Cancellation, replay, identity
// ---------------------------------------------------------------------------------------

/// `cancel` is a clean stop that leaves something resumable — not a kill.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Cancellation {
    pub checkpoint_id: String,
    pub resumable: bool,
    pub completed_steps: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct FixturePack {
    pub session_id: String,
    pub digest: String,
    pub entries: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SimulationOutcome {
    pub predicted_diff: Vec<String>,
    pub predicted_result: String,
    /// Always false in this contract: simulation predicts, it never executes.
    pub executed: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ProviderIdentity {
    pub name: String,
    pub version: String,
    pub contract_version: String,
    pub supports_simulation: bool,
}

// ---------------------------------------------------------------------------------------
// The contract
// ---------------------------------------------------------------------------------------

/// The only road the engine has to obtain a plan.
///
/// Eleven surfaces are required. `simulate` is not: its default returns
/// `ReasoningError::Unsupported`, so a provider that cannot simulate says so instead of
/// returning an empty prediction that reads like a successful one.
pub trait ReasoningProvider: Send + Sync {
    fn identity(&self) -> ProviderIdentity;

    fn interpret<'a>(
        &'a self,
        request: &'a str,
        project_rules: &'a [String],
        map_digest: &'a str,
    ) -> Answer<'a, IntentFrame>;

    fn hypothesize<'a>(
        &'a self,
        intent: &'a IntentFrame,
        gathered: &'a [Evidence],
    ) -> Answer<'a, Vec<Hypothesis>>;

    fn plan<'a>(
        &'a self,
        chosen: &'a [Hypothesis],
        constraints: &'a [String],
        mode: &'a str,
    ) -> Answer<'a, Plan>;

    fn decompose<'a>(&'a self, step: &'a PlanStep) -> Answer<'a, Decomposition>;

    fn expect<'a>(&'a self, plan: &'a Plan) -> Answer<'a, Expectation>;

    fn constrain<'a>(&'a self, plan: &'a Plan, policy: &'a str) -> Answer<'a, Constrained>;

    fn classify<'a>(&'a self, plan: &'a Plan) -> Answer<'a, RiskAssessment>;

    fn confidence<'a>(&'a self, plan: &'a Plan, results: &'a [String]) -> Answer<'a, Confidence>;

    fn evidence<'a>(&'a self, claim: &'a str) -> Answer<'a, Evidence>;

    fn cancel<'a>(&'a self, plan: &'a Plan) -> Answer<'a, Cancellation>;

    fn fixtures<'a>(&'a self, session_id: &'a str) -> Answer<'a, FixturePack>;

    /// Optional. Predicts a diff and an outcome against a shadow workspace **without
    /// executing**. Providers that cannot do this must leave this default in place.
    fn simulate<'a>(
        &'a self,
        _plan: &'a Plan,
        _shadow_workspace: &'a str,
    ) -> Answer<'a, SimulationOutcome> {
        Box::pin(async {
            Err(ReasoningError::Unsupported { surface: "simulate".into() })
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn step(id: &str, depends_on: Vec<String>) -> PlanStep {
        PlanStep {
            id: id.into(),
            description: "s".into(),
            files: vec![],
            commands: vec![],
            depends_on,
            blast_radius: BlastRadius {
                paths: vec![],
                reaches_outside_workspace: false,
                destructive: false,
            },
        }
    }

    #[test]
    fn the_contract_declares_eleven_mandatory_surfaces_and_simulate_is_not_one() {
        assert_eq!(MANDATORY_SURFACES.len(), 11);
        assert!(!MANDATORY_SURFACES.contains(&"simulate"));
        for surface in LOAD_BEARING_SURFACES {
            assert!(MANDATORY_SURFACES.contains(surface));
        }
    }

    #[test]
    fn supported_evidence_without_a_source_is_rejected() {
        assert!(Evidence::supported(vec![]).is_err());
        assert!(Evidence::supported(vec![Source {
            locator: "f.rs:1".into(),
            excerpt: "x".into()
        }])
        .is_ok());
    }

    #[test]
    fn an_unsupported_inference_is_a_first_class_answer_not_an_empty_list() {
        let inference = Evidence::UnsupportedInference { rationale: "no source read".into() };
        assert!(!inference.is_supported());
    }

    #[test]
    fn an_intent_without_a_success_criterion_is_rejected() {
        assert!(IntentFrame::try_new("g".into(), vec![], vec![], vec![]).is_err());
        assert!(IntentFrame::try_new("g".into(), vec![], vec!["c".into()], vec![]).is_ok());
    }

    #[test]
    fn found_contrary_evidence_that_is_empty_is_rejected() {
        assert!(Hypothesis::try_new(
            "h".into(),
            vec![],
            Contrary::Found { evidence: vec![] }
        )
        .is_err());
        assert!(Hypothesis::try_new("h".into(), vec![], Contrary::NotSought).is_ok());
        assert!(Hypothesis::try_new("h".into(), vec![], Contrary::NoneFound).is_ok());
    }

    #[test]
    fn a_plan_with_no_step_is_rejected() {
        assert!(Plan::try_new(vec![], vec![], "safe".into()).is_err());
    }

    #[test]
    fn a_dependency_on_a_later_or_missing_step_is_rejected() {
        let forward = Plan::try_new(
            vec![step("a", vec!["b".into()]), step("b", vec![])],
            vec![],
            "safe".into(),
        );
        assert!(forward.is_err(), "a cycle must be unrepresentable, not merely detected");

        let missing = Plan::try_new(vec![step("a", vec!["ghost".into()])], vec![], "safe".into());
        assert!(missing.is_err());

        let ordered = Plan::try_new(
            vec![step("a", vec![]), step("b", vec!["a".into()])],
            vec![],
            "safe".into(),
        );
        assert!(ordered.is_ok());
    }

    #[test]
    fn duplicate_step_ids_are_rejected() {
        assert!(Plan::try_new(vec![step("a", vec![]), step("a", vec![])], vec![], "s".into())
            .is_err());
    }

    #[test]
    fn a_decomposition_into_one_step_is_rejected() {
        assert!(Decomposition::split(vec![step("a", vec![])]).is_err());
        assert!(Decomposition::split(vec![step("a", vec![]), step("b", vec![])]).is_ok());
    }

    #[test]
    fn an_expectation_that_expects_nothing_is_rejected() {
        assert!(Expectation::try_new(vec![], vec![], vec![]).is_err());
        assert!(Expectation::try_new(vec![], vec!["t".into()], vec![]).is_ok());
    }

    #[test]
    fn confidence_below_certainty_requires_its_reasons() {
        assert!(Confidence::try_new(0.7, vec![]).is_err());
        assert!(Confidence::try_new(0.7, vec!["no integration test".into()]).is_ok());
        assert!(Confidence::try_new(1.0, vec![]).is_ok());
    }

    #[test]
    fn confidence_outside_the_unit_interval_is_rejected() {
        assert!(Confidence::try_new(1.5, vec!["r".into()]).is_err());
        assert!(Confidence::try_new(-0.1, vec!["r".into()]).is_err());
        assert!(Confidence::try_new(f64::NAN, vec!["r".into()]).is_err());
    }

    struct MinimalProvider;

    impl ReasoningProvider for MinimalProvider {
        fn identity(&self) -> ProviderIdentity {
            ProviderIdentity {
                name: "minimal".into(),
                version: "0".into(),
                contract_version: REASONING_CONTRACT_VERSION.into(),
                supports_simulation: false,
            }
        }
        fn interpret<'a>(&'a self, _: &'a str, _: &'a [String], _: &'a str)
            -> Answer<'a, IntentFrame> {
            Box::pin(async { IntentFrame::try_new("g".into(), vec![], vec!["c".into()], vec![]) })
        }
        fn hypothesize<'a>(&'a self, _: &'a IntentFrame, _: &'a [Evidence])
            -> Answer<'a, Vec<Hypothesis>> {
            Box::pin(async { Ok(vec![]) })
        }
        fn plan<'a>(&'a self, _: &'a [Hypothesis], _: &'a [String], _: &'a str)
            -> Answer<'a, Plan> {
            Box::pin(async { Plan::try_new(vec![step("a", vec![])], vec![], "safe".into()) })
        }
        fn decompose<'a>(&'a self, _: &'a PlanStep) -> Answer<'a, Decomposition> {
            Box::pin(async { Ok(Decomposition::AlreadyVerifiable) })
        }
        fn expect<'a>(&'a self, _: &'a Plan) -> Answer<'a, Expectation> {
            Box::pin(async { Expectation::try_new(vec!["t".into()], vec![], vec![]) })
        }
        fn constrain<'a>(&'a self, _: &'a Plan, _: &'a str) -> Answer<'a, Constrained> {
            Box::pin(async { Ok(Constrained::Refused { reason: "no policy".into() }) })
        }
        fn classify<'a>(&'a self, _: &'a Plan) -> Answer<'a, RiskAssessment> {
            Box::pin(async { Ok(RiskAssessment { per_step: vec![], overall: RiskClass::Low }) })
        }
        fn confidence<'a>(&'a self, _: &'a Plan, _: &'a [String]) -> Answer<'a, Confidence> {
            Box::pin(async { Confidence::try_new(0.5, vec!["reference provider".into()]) })
        }
        fn evidence<'a>(&'a self, _: &'a str) -> Answer<'a, Evidence> {
            Box::pin(async {
                Ok(Evidence::UnsupportedInference { rationale: "not read".into() })
            })
        }
        fn cancel<'a>(&'a self, _: &'a Plan) -> Answer<'a, Cancellation> {
            Box::pin(async {
                Ok(Cancellation {
                    checkpoint_id: "c1".into(),
                    resumable: true,
                    completed_steps: vec![],
                })
            })
        }
        fn fixtures<'a>(&'a self, session_id: &'a str) -> Answer<'a, FixturePack> {
            Box::pin(async move {
                Ok(FixturePack {
                    session_id: session_id.into(),
                    digest: "d".into(),
                    entries: vec![],
                })
            })
        }
    }

    #[tokio::test]
    async fn a_provider_that_cannot_simulate_says_so_instead_of_returning_an_empty_prediction() {
        let provider = MinimalProvider;
        let plan = provider.plan(&[], &[], "safe").await.expect("plan");
        let outcome = provider.simulate(&plan, "/shadow").await;
        assert_eq!(
            outcome.unwrap_err(),
            ReasoningError::Unsupported { surface: "simulate".into() }
        );
        assert!(!provider.identity().supports_simulation);
    }

    #[tokio::test]
    async fn the_contract_is_dyn_compatible_so_the_engine_can_select_a_provider_at_runtime() {
        let provider: Box<dyn ReasoningProvider> = Box::new(MinimalProvider);
        assert_eq!(provider.identity().contract_version, REASONING_CONTRACT_VERSION);
        let intent = provider.interpret("do a thing", &[], "digest").await.expect("intent");
        assert_eq!(intent.success_criteria.len(), 1);
    }
}
