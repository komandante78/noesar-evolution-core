// SPDX-License-Identifier: AGPL-3.0-or-later
//
// D-0656. Phase E of FUNDING/19_WORK_PLAN_TO_BETA.md (WP3), Rust half: the same claim
// services/reference-control-plane/test/reasoning-authority-conformance.test.mjs (D-0654)
// proved for the JS minter — "does a backend ever exceed its granted token, for any
// implementation of the 11-surface contract" — proved here against the REAL Rust
// `TokenMinter`/`AuthorizedPlan`. Nothing about the authority layer is mocked.
//
// `AdversarialReasoningProvider` below wraps `ReferenceReasoningProvider` and delegates
// every mandatory surface except `constrain()`, which never filters or refuses anything —
// the one piece of cooperation the authority boundary is not supposed to need
// (`noesar-reasoning-reference::ReferenceReasoningProvider::constrain` filters out steps
// that reach outside the workspace or are destructive under a restrictive policy; this
// fixture keeps them all). It is defined here, in the test binary, rather than exported
// from a crate: nothing outside this file may import it, which is a stronger form of the
// same "conformance fixture, not a product component" boundary the JS fixture states in
// its own header comment.
//
// AUTH-001 is a positive control: without it, every refusal below would pass vacuously
// against a `mint()` that refuses everything. AUTH-002/003/004 are the actual claim:
// whatever the reasoning backend declares or fails to filter, `mint()` independently
// re-derives the workspace-escape check and the step-membership check.
//
// The JS suite's fifth case — "the fixture is not a strawman, it implements every mandatory
// surface" — has no runtime equivalent here: `impl ReasoningProvider for
// AdversarialReasoningProvider` below would fail to *compile* if a surface were missing,
// so the check that JS performs with `typeof adversary[surface] === 'function'` at test
// time is enforced by the Rust compiler at build time instead. The trailing test in this
// file only makes that compile-time fact observable as a passing test, via a trait-object
// coercion that requires every surface to already exist.

use noesar_capability::{
    Approval, AuthorizedPlan, CapabilityError, CapabilityRequest, Operation, TokenMinter,
};
use noesar_reasoning::{
    Answer, BlastRadius, Cancellation, Confidence, Constrained, Decomposition, Evidence,
    Expectation, FixturePack, Hypothesis, IntentFrame, Plan, PlanStep, ProviderIdentity,
    ReasoningProvider, RiskAssessment,
};
use noesar_reasoning_reference::ReferenceReasoningProvider;

const NOW: i64 = 1_800_000_000;

fn secret() -> Vec<u8> {
    vec![5_u8; 32]
}

fn approval_for(plan_expiry: i64) -> Approval {
    Approval {
        approver_id: "owner-001".into(),
        granted_at_unix: NOW,
        expires_at_unix: plan_expiry + 999_999,
        scope_note: "authority conformance".into(),
    }
}

struct AdversarialReasoningProvider {
    reference: ReferenceReasoningProvider,
}

impl AdversarialReasoningProvider {
    fn new(workspace_root: impl Into<String>) -> Self {
        Self { reference: ReferenceReasoningProvider::new(workspace_root) }
    }
}

impl ReasoningProvider for AdversarialReasoningProvider {
    fn identity(&self) -> ProviderIdentity {
        let mut identity = self.reference.identity();
        identity.name = "adversarial-fixture".into();
        identity
    }

    fn interpret<'a>(
        &'a self,
        request: &'a str,
        project_rules: &'a [String],
        map_digest: &'a str,
    ) -> Answer<'a, IntentFrame> {
        self.reference.interpret(request, project_rules, map_digest)
    }

    fn hypothesize<'a>(
        &'a self,
        intent: &'a IntentFrame,
        gathered: &'a [Evidence],
    ) -> Answer<'a, Vec<Hypothesis>> {
        self.reference.hypothesize(intent, gathered)
    }

    fn plan<'a>(
        &'a self,
        chosen: &'a [Hypothesis],
        constraints: &'a [String],
        mode: &'a str,
    ) -> Answer<'a, Plan> {
        self.reference.plan(chosen, constraints, mode)
    }

    fn decompose<'a>(&'a self, step: &'a PlanStep) -> Answer<'a, Decomposition> {
        self.reference.decompose(step)
    }

    fn expect<'a>(&'a self, plan: &'a Plan) -> Answer<'a, Expectation> {
        self.reference.expect(plan)
    }

    /// The one dishonest surface. A real `constrain()` refuses a step that reaches outside
    /// the workspace, or that is destructive under a restrictive policy — see
    /// `ReferenceReasoningProvider::constrain`. This one keeps every step unchanged, as if
    /// each were already safe. Any containment that survives this provider is containment
    /// the *authority layer* provides, not containment borrowed from a cooperative backend.
    fn constrain<'a>(&'a self, plan: &'a Plan, _policy: &'a str) -> Answer<'a, Constrained> {
        let plan = plan.clone();
        Box::pin(async move { Ok(Constrained::Restricted { plan, removed: Vec::new() }) })
    }

    fn classify<'a>(&'a self, plan: &'a Plan) -> Answer<'a, RiskAssessment> {
        self.reference.classify(plan)
    }

    fn confidence<'a>(&'a self, plan: &'a Plan, results: &'a [String]) -> Answer<'a, Confidence> {
        self.reference.confidence(plan, results)
    }

    fn evidence<'a>(&'a self, claim: &'a str) -> Answer<'a, Evidence> {
        self.reference.evidence(claim)
    }

    fn cancel<'a>(&'a self, plan: &'a Plan) -> Answer<'a, Cancellation> {
        self.reference.cancel(plan)
    }

    fn fixtures<'a>(&'a self, session_id: &'a str) -> Answer<'a, FixturePack> {
        self.reference.fixtures(session_id)
    }
}

#[tokio::test]
async fn auth_001_positive_control_an_honest_step_and_a_matching_request_still_mint() {
    let step = PlanStep {
        id: "a".into(),
        description: "s".into(),
        files: vec!["src/a.rs".into()],
        commands: Vec::new(),
        depends_on: Vec::new(),
        blast_radius: BlastRadius {
            paths: vec!["src/a.rs".into()],
            reaches_outside_workspace: false,
            destructive: false,
        },
    };
    let plan = Plan::try_new(vec![step], Vec::new(), "safe".into()).unwrap();
    let authorized = AuthorizedPlan::try_authorize(plan, approval_for(NOW + 600), NOW).unwrap();
    let mut minter = TokenMinter::new(secret()).unwrap();
    let request = CapabilityRequest {
        step_id: "a".into(),
        paths: vec!["src/a.rs".into()],
        operations: vec![Operation::Write],
        reason: "conformance".into(),
        uses: 1,
        expires_at_unix: NOW + 600,
        limits: None,
    };
    let token = minter
        .mint(&authorized, &request, NOW)
        .expect("the benign case must mint — otherwise every refusal below is vacuous");
    assert_eq!(token.mac().len(), 64);
}

#[tokio::test]
async fn auth_002_a_workspace_escaping_step_honestly_declared_unfiltered_by_constrain() {
    let adversary = AdversarialReasoningProvider::new("/workspace");
    let step = PlanStep {
        id: "a".into(),
        description: "s".into(),
        files: vec!["../../etc/passwd".into()],
        commands: Vec::new(),
        depends_on: Vec::new(),
        // The reference provider's own construction logic would compute this same flag
        // from the path — asserted honestly here rather than through a private helper.
        blast_radius: BlastRadius {
            paths: vec!["../../etc/passwd".into()],
            reaches_outside_workspace: true,
            destructive: false,
        },
    };
    let plan = Plan::try_new(vec![step], Vec::new(), "safe".into()).unwrap();
    let constrained = adversary.constrain(&plan, "restrictive").await.unwrap();
    let narrowed = match constrained {
        Constrained::Restricted { plan, removed } => {
            assert!(removed.is_empty(), "sanity: the adversarial fixture must not filter this");
            plan
        }
        Constrained::Refused { reason } => {
            panic!("sanity: the adversarial fixture must NOT refuse this — got {reason}")
        }
    };

    let authorized = AuthorizedPlan::try_authorize(narrowed, approval_for(NOW + 600), NOW).unwrap();
    let mut minter = TokenMinter::new(secret()).unwrap();
    let request = CapabilityRequest {
        step_id: "a".into(),
        paths: vec!["../../etc/passwd".into()],
        operations: vec![Operation::Read],
        reason: "conformance".into(),
        uses: 1,
        expires_at_unix: NOW + 600,
        limits: None,
    };
    let outcome = minter.mint(&authorized, &request, NOW);
    assert!(
        matches!(outcome, Err(CapabilityError::OutOfScope { .. })),
        "mint() must refuse this independently of the unfiltered plan and the \
         never-refusing constrain(), got {outcome:?}",
    );
}

#[tokio::test]
async fn auth_003_an_escaping_step_whose_own_blast_radius_flag_lies() {
    // Not every future ReasoningProvider will compute this flag correctly. This step is
    // built by hand to be exactly what a buggy or malicious third implementation might
    // emit: files that escape, and a flag that says they do not.
    let adversary = AdversarialReasoningProvider::new("/workspace");
    let step = PlanStep {
        id: "a".into(),
        description: "s".into(),
        files: vec!["../../etc/passwd".into()],
        commands: Vec::new(),
        depends_on: Vec::new(),
        blast_radius: BlastRadius {
            paths: vec!["../../etc/passwd".into()],
            reaches_outside_workspace: false,
            destructive: false,
        },
    };
    let plan = Plan::try_new(vec![step], Vec::new(), "safe".into()).unwrap();
    let constrained = adversary.constrain(&plan, "restrictive").await.unwrap();
    let narrowed = match constrained {
        Constrained::Restricted { plan, .. } => plan,
        Constrained::Refused { reason } => {
            panic!("sanity: the adversarial fixture must NOT refuse this — got {reason}")
        }
    };

    let authorized = AuthorizedPlan::try_authorize(narrowed, approval_for(NOW + 600), NOW).unwrap();
    let mut minter = TokenMinter::new(secret()).unwrap();
    let request = CapabilityRequest {
        step_id: "a".into(),
        paths: vec!["../../etc/passwd".into()],
        operations: vec![Operation::Read],
        reason: "conformance".into(),
        uses: 1,
        expires_at_unix: NOW + 600,
        limits: None,
    };
    let outcome = minter.mint(&authorized, &request, NOW);
    assert!(
        matches!(outcome, Err(CapabilityError::OutOfScope { .. })),
        "mint() must not trust a declared reaches_outside_workspace=false when the path \
         itself escapes, got {outcome:?}",
    );
}

#[tokio::test]
async fn auth_004_a_request_naming_a_path_the_step_never_listed() {
    let adversary = AdversarialReasoningProvider::new("/workspace");
    let step = PlanStep {
        id: "a".into(),
        description: "s".into(),
        files: vec!["src/a.rs".into()],
        commands: Vec::new(),
        depends_on: Vec::new(),
        blast_radius: BlastRadius {
            paths: vec!["src/a.rs".into()],
            reaches_outside_workspace: false,
            destructive: false,
        },
    };
    let plan = Plan::try_new(vec![step], Vec::new(), "safe".into()).unwrap();
    let constrained = adversary.constrain(&plan, "restrictive").await.unwrap();
    let narrowed = match constrained {
        Constrained::Restricted { plan, .. } => plan,
        Constrained::Refused { reason } => {
            panic!("sanity: the adversarial fixture must NOT refuse this — got {reason}")
        }
    };

    let authorized = AuthorizedPlan::try_authorize(narrowed, approval_for(NOW + 600), NOW).unwrap();
    let mut minter = TokenMinter::new(secret()).unwrap();
    let request = CapabilityRequest {
        step_id: "a".into(),
        paths: vec!["src/a.rs".into(), "src/secret.rs".into()],
        operations: vec![Operation::Read],
        reason: "conformance".into(),
        uses: 1,
        expires_at_unix: NOW + 600,
        limits: None,
    };
    let outcome = minter.mint(&authorized, &request, NOW);
    assert!(
        matches!(outcome, Err(CapabilityError::OutOfScope { .. })),
        "mint() must refuse a path the approved step never declared, regardless of which \
         provider proposed the plan, got {outcome:?}",
    );
}

#[test]
fn the_adversarial_fixture_genuinely_implements_the_full_contract() {
    // If a mandatory surface were ever missing from the `impl` above, this line would fail
    // to compile — the coercion to `dyn ReasoningProvider` requires all eleven methods to
    // already exist with the right signatures. Passing is the observable form of a fact
    // the compiler already enforced.
    let adversary = AdversarialReasoningProvider::new("/workspace");
    let _as_trait_object: &dyn ReasoningProvider = &adversary;
}
