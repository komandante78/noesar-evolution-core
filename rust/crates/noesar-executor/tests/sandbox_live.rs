// SPDX-License-Identifier: AGPL-3.0-or-later
//! ARCH-008/D-0253: proof that the Rust EXECUTE mirror is not just plumbing — a real command
//! runs through a real `noesar-sandbox` child process, end to end through `execute()`, the
//! same public entry point every other action kind goes through.
//!
//! Deliberately NOT in `conformance/executor-vectors.json`: that file's whole value is
//! portability (data any host can replay), and spawning a real binary makes a vector only
//! meaningful on a host where it was built. `services/reference-control-plane/test/
//! sandbox-runner.test.mjs` set the precedent already used here: a real, binary-gated,
//! honestly-skipped-not-silently-passed native test, on each language side, outside the
//! shared vector file. `HAVE_BINARY` mirrors that file's own `HAVE_BINARY` check, including
//! the same failure mode this project has a named rule against: a skip that looks like a
//! pass is exactly the "a clean scan proves nothing" trap — this prints WHY it skipped rather
//! than reporting a silent green.

use noesar_capability::{Approval, CapabilityRequest, CapabilityLimits, Operation, TokenMinter};
use noesar_executor::{execute, Action, ExecuteSandboxConfig};
use noesar_reasoning::{BlastRadius, Expectation, Plan, PlanStep};
use noesar_shadow::{ShadowLimits, ShadowWorkspace};
use std::fs;
use std::path::PathBuf;

const NOW: i64 = 1_800_000_000;

// `Expectation::try_new` refuses all-three-empty ("an expectation that expects nothing cannot
// be surprised"). The JS test this mirrors (executor.test.mjs) passes an all-empty literal
// for its EXECUTE tests and JS never gates the shape — a real, small divergence found while
// building this, out of scope for ARCH-008/D-0253 and not fixed here (named in the decision
// log). `placeholder.txt` here is a real file the EXECUTE command never touches — it only
// exists to satisfy Rust's constructor; none of these tests assert on `report.is_ok()` or
// `surprise`, only on the EXECUTE outcome itself.

fn binary_path() -> PathBuf {
    PathBuf::from(concat!(env!("CARGO_MANIFEST_DIR"), "/../../target/release/noesar-sandbox"))
}

fn have_binary() -> bool {
    binary_path().is_file()
}

fn scratch(label: &str) -> PathBuf {
    let path = std::env::temp_dir().join(format!(
        "noesar-execv-live-{label}-{}",
        std::process::id()
    ));
    let _ = fs::remove_dir_all(&path);
    fs::create_dir_all(&path).unwrap();
    path
}

fn bench(label: &str) -> (PathBuf, ShadowWorkspace, TokenMinter, noesar_capability::AuthorizedPlan) {
    let source = scratch(&format!("{label}-src"));
    // A placeholder file, not part of the EXECUTE grant itself: ShadowWorkspace::materialise
    // refuses "a shadow of nothing" (a structurally empty materialisation can never report an
    // undeclared write). Mirrors benchDir() in executor.test.mjs exactly.
    fs::write(source.join("placeholder.txt"), b"unrelated to the EXECUTE grant").unwrap();
    let shadow_root = scratch(&format!("{label}-dst"));
    let shadow = ShadowWorkspace::materialise(&source, &shadow_root, ShadowLimits::default()).unwrap();
    // The EXECUTE grant is on `.` (the workspace root), not a file — the confinement path is
    // the command's working directory, not something it reads or writes. Mirrors
    // executor.test.mjs's benchDir() exactly (`files:['.']`).
    let step = PlanStep {
        id: "a".into(),
        description: "s".into(),
        files: vec![".".into()],
        commands: Vec::new(),
        depends_on: Vec::new(),
        blast_radius: BlastRadius { paths: vec![".".into()], reaches_outside_workspace: false, destructive: true },
    };
    let plan = noesar_capability::AuthorizedPlan::try_authorize(
        Plan::try_new(vec![step], Vec::new(), "safe".into()).unwrap(),
        Approval { approver_id: "owner-001".into(), granted_at_unix: NOW, expires_at_unix: NOW + 3600, scope_note: "test".into() },
        NOW,
    ).unwrap();
    (source, shadow, TokenMinter::new(vec![7_u8; 32]).unwrap(), plan)
}

fn generous_limits() -> CapabilityLimits {
    CapabilityLimits {
        memory_bytes: Some(256 * 1024 * 1024),
        cpu_seconds: Some(5),
        open_files: Some(64),
        processes: Some(8),
        file_size_bytes: Some(1024 * 1024),
        core_dump_bytes: Some(0),
    }
}

#[test]
fn a_real_command_runs_end_to_end_through_execute_and_a_real_sandbox_child() {
    if !have_binary() {
        eprintln!(
            "skipping a_real_command_runs_end_to_end_through_execute_and_a_real_sandbox_child: \
             expected at {:?} — build with: cd rust && cargo build --release -p noesar-sandbox",
            binary_path()
        );
        return;
    }
    let (source, shadow, mut minter, plan) = bench("run");
    let token = minter
        .mint(
            &plan,
            &CapabilityRequest {
                step_id: "a".into(), paths: vec![".".into()], operations: vec![Operation::Execute],
                reason: "test".into(), uses: 1, expires_at_unix: NOW + 600, limits: Some(generous_limits()),
            },
            NOW,
        )
        .unwrap();
    let config = ExecuteSandboxConfig { enabled: true, binary_path: Some(binary_path()) };
    let report = execute(
        &plan, &mut minter, &[token], &shadow,
        &[Action::Execute { path: ".".into(), command: "/bin/echo".into(), args: vec!["ran for real".into()] }],
        &Expectation::try_new(Vec::new(), Vec::new(), vec!["placeholder.txt".into()]).unwrap(),
        Vec::new(), NOW, Some(&config),
    ).unwrap();

    assert_eq!(report.performed(), 1, "{report:?}");
    let outcome = &report.outcomes[0];
    assert!(outcome.performed, "{outcome:?}");
    assert_eq!(outcome.exit_code, Some(0), "{outcome:?}");
    assert_eq!(outcome.stdout.as_deref(), Some("ran for real\n"), "{outcome:?}");
    let _ = fs::remove_dir_all(&source);
    let _ = fs::remove_dir_all(shadow.root());
}

#[test]
fn a_command_that_exits_non_zero_is_performed_but_not_ok() {
    if !have_binary() {
        eprintln!("skipping a_command_that_exits_non_zero_is_performed_but_not_ok: no sandbox binary built");
        return;
    }
    let (source, shadow, mut minter, plan) = bench("nonzero");
    let token = minter
        .mint(
            &plan,
            &CapabilityRequest {
                step_id: "a".into(), paths: vec![".".into()], operations: vec![Operation::Execute],
                reason: "test".into(), uses: 1, expires_at_unix: NOW + 600, limits: Some(generous_limits()),
            },
            NOW,
        )
        .unwrap();
    let config = ExecuteSandboxConfig { enabled: true, binary_path: Some(binary_path()) };
    let report = execute(
        &plan, &mut minter, &[token], &shadow,
        &[Action::Execute { path: ".".into(), command: "/bin/false".into(), args: Vec::new() }],
        &Expectation::try_new(Vec::new(), Vec::new(), vec!["placeholder.txt".into()]).unwrap(),
        Vec::new(), NOW, Some(&config),
    ).unwrap();

    let outcome = &report.outcomes[0];
    assert!(outcome.performed, "a command that ran and exited non-zero was still PERFORMED — the sandbox did its job, the command just failed on its own: {outcome:?}");
    assert_eq!(outcome.exit_code, Some(1), "{outcome:?}");
    let _ = fs::remove_dir_all(&source);
    let _ = fs::remove_dir_all(shadow.root());
}

#[test]
fn exceeding_the_limit_is_a_real_kernel_enforced_refusal_not_a_polite_ask() {
    if !have_binary() {
        eprintln!("skipping exceeding_the_limit_is_a_real_kernel_enforced_refusal_not_a_polite_ask: no sandbox binary built");
        return;
    }
    let (source, shadow, mut minter, plan) = bench("tight");
    // Same values and shape as THE MEASURED CRITERION test in sandbox-runner.test.mjs: 64
    // MiB is enough for /bin/sh itself to start (proven there, not re-proven here) but not
    // enough for a 512 MiB allocation attempt inside it.
    let tight = CapabilityLimits {
        memory_bytes: Some(64 * 1024 * 1024),
        cpu_seconds: Some(10),
        open_files: Some(16),
        processes: Some(4),
        file_size_bytes: None,
        core_dump_bytes: Some(0),
    };
    let token = minter
        .mint(
            &plan,
            &CapabilityRequest {
                step_id: "a".into(), paths: vec![".".into()], operations: vec![Operation::Execute],
                reason: "test".into(), uses: 1, expires_at_unix: NOW + 600, limits: Some(tight),
            },
            NOW,
        )
        .unwrap();
    let config = ExecuteSandboxConfig { enabled: true, binary_path: Some(binary_path()) };
    let report = execute(
        &plan, &mut minter, &[token], &shadow,
        &[Action::Execute {
            path: ".".into(), command: "/bin/sh".into(),
            args: vec![
                "-c".into(),
                "dd if=/dev/zero of=/dev/null bs=1M count=1 2>/dev/null; \
                 python3 -c 'b=bytearray(512*1024*1024)' 2>&1 || exit 9".into(),
            ],
        }],
        &Expectation::try_new(Vec::new(), Vec::new(), vec!["placeholder.txt".into()]).unwrap(),
        Vec::new(), NOW, Some(&config),
    ).unwrap();

    let outcome = &report.outcomes[0];
    // Either the allocation fails inside the shell/python (exit != 0) or python3 is absent
    // and the explicit `exit 9` fires — both are "not silently succeeded at 512 MiB under a
    // 64 MiB grant", the property under test. What must not happen is exit 0.
    assert!(outcome.performed, "the shell itself must start under 64 MiB: {outcome:?}");
    assert_ne!(outcome.exit_code, Some(0), "a 512 MiB allocation must not succeed under a 64 MiB grant: {outcome:?}");
    let _ = fs::remove_dir_all(&source);
    let _ = fs::remove_dir_all(shadow.root());
}
