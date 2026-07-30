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
//! # EXECUTE, ARCH-008 / D-0253
//!
//! `EXECUTE` is not a blanket refusal any more — it mirrors `executor.mjs` (`D-0250`), the
//! caller decides. With no [`ExecuteSandboxConfig`] passed at all, the default is
//! byte-identical to before this phase: [`NO_EXECUTION_SURFACE`], because that is the answer
//! for an installation that never wired one up. A config that says `enabled: false` is a
//! DIFFERENT, more accurate fact — the mechanism exists on this build, an operator chose not
//! to turn it on — and gets [`EXECUTE_DISABLED_BY_OPERATOR`] instead, so the two are never
//! confused. Enabled, the same token discipline every other action kind uses applies (found,
//! spent BEFORE the effect, containment-checked), and only then does the effect become a
//! real, measured, per-capability-limited process run through `noesar-sandbox`
//! (`rust/crates/noesar-sandbox`) instead of a file operation — never with the whole
//! container's limits, never without a spent token naming it, and never without an isolation
//! envelope on the token ([`EXECUTE_TOKEN_WITHOUT_LIMITS`]).

use noesar_capability::{Attempt, AuthorizedPlan, CapabilityToken, Operation, TokenMinter};
use noesar_reasoning::Expectation;
use noesar_sandbox::IsolationLimits;
use noesar_shadow::{
    compare, Observation, ShadowCoverage, ShadowError, ShadowLimits, ShadowWorkspace, Surprise,
    TestResult,
};
use serde::{Deserialize, Serialize};
use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum Action {
    Read { path: String },
    Write { path: String, contents: String },
    Delete { path: String },
    /// `path` is the token-granted, containment-checked working directory the command runs
    /// confined to — not the command itself. See the crate documentation for when this runs
    /// at all.
    Execute {
        path: String,
        command: String,
        #[serde(default)]
        args: Vec<String>,
    },
}

impl Action {
    pub fn path(&self) -> &str {
        match self {
            Self::Read { path } | Self::Write { path, .. } | Self::Delete { path }
            | Self::Execute { path, .. } => path,
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
    /// The three fields below are populated only for a performed `EXECUTE` — every other
    /// action kind, and every refused one, carries `None`/empty. Mirrors `executor.mjs`'s
    /// outcome shape (`exitCode`/`stdout`/`stderr`) byte for byte.
    #[serde(default)]
    pub exit_code: Option<i32>,
    #[serde(default)]
    pub stdout: Option<String>,
    #[serde(default)]
    pub stderr: Option<String>,
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

/// Default path, unchanged since before this file supported EXECUTE at all: no config passed
/// at all reports this exact reason, byte-identical to `executor.mjs`'s own
/// `NO_EXECUTION_SURFACE` (conformance vector EXEC-007, untouched by ARCH-008/D-0253).
pub const NO_EXECUTION_SURFACE: &str =
    "this layer has no execution surface: a command cannot be contained here, \
     and pretending to run it would be worse than refusing";

/// A config WAS passed but says `enabled: false` — a different, more accurate fact than
/// `NO_EXECUTION_SURFACE`: the mechanism exists on this build, an operator chose not to turn
/// it on here. Byte-identical to `executor.mjs`'s `EXECUTE_DISABLED_BY_OPERATOR`.
pub const EXECUTE_DISABLED_BY_OPERATOR: &str =
    "EXECUTE capability exists on this installation but is disabled by operator configuration \
     (NOESAR_EXECUTE_SANDBOX=disabled)";

/// Belt and braces, mirroring `executor.mjs`: a token reaching here with no isolation
/// envelope is refused rather than run with the whole container's limits.
pub const EXECUTE_TOKEN_WITHOUT_LIMITS: &str =
    "an EXECUTE token without an isolation envelope cannot be run: the sandbox refuses a \
     command under no limits at all";

const EX_CONFIG: i32 = 78;
const DEFAULT_TIMEOUT: Duration = Duration::from_secs(30);
const MAX_OUTPUT_BYTES: usize = 1024 * 1024;

/// The client's decision, read by whoever constructs this (mirrors
/// `execute-sandbox-config.mjs::resolveExecuteSandboxConfig`'s shape — this crate does not
/// read `NOESAR_EXECUTE_SANDBOX` itself, it is not wired to any live entrypoint, see the
/// crate documentation).
#[derive(Debug, Clone)]
pub struct ExecuteSandboxConfig {
    pub enabled: bool,
    pub binary_path: Option<PathBuf>,
}

fn isolation_limits(limits: &noesar_capability::CapabilityLimits) -> IsolationLimits {
    IsolationLimits {
        memory_bytes: limits.memory_bytes,
        cpu_seconds: limits.cpu_seconds,
        open_files: limits.open_files,
        processes: limits.processes,
        file_size_bytes: limits.file_size_bytes,
        core_dump_bytes: limits.core_dump_bytes,
    }
}

fn limits_spec_json(limits: &IsolationLimits) -> String {
    fn field(name: &str, value: Option<u64>) -> String {
        match value {
            Some(number) => format!("\"{name}\":{number}"),
            None => format!("\"{name}\":null"),
        }
    }
    format!(
        "{{{},{},{},{},{},{}}}",
        field("memoryBytes", limits.memory_bytes),
        field("cpuSeconds", limits.cpu_seconds),
        field("openFiles", limits.open_files),
        field("processes", limits.processes),
        field("fileSizeBytes", limits.file_size_bytes),
        field("coreDumpBytes", limits.core_dump_bytes),
    )
}

/// The sandbox's own report is always the first line of stderr, written before `execvp`
/// replaces the process — everything after that first line belongs to the command, not to
/// `noesar-sandbox`. Mirrors `sandbox-runner.mjs`'s `splitSandboxReport` exactly, including
/// falling back to treating the whole stream as the command's own when the first line is not
/// one of the sandbox's own JSON reports.
fn split_sandbox_report(stderr_text: &str) -> (Option<String>, String) {
    let (first_line, rest) = match stderr_text.split_once('\n') {
        Some((first, rest)) => (first.to_string(), rest.to_string()),
        None => (stderr_text.to_string(), String::new()),
    };
    // The one shape `noesar-sandbox` ever writes as its own report: `{"sandbox":"REFUSED"|
    // "APPLIED",...}`. Mirrors the JS side's `'sandbox' in JSON.parse(firstLine)` check —
    // a substring test rather than a real parse, same posture as `report_reason` below.
    if first_line.contains("\"sandbox\":") {
        (Some(first_line), rest)
    } else {
        (None, stderr_text.to_string())
    }
}

/// Read a `"reason":"..."` field out of the sandbox's own refusal report — a small, deliberate
/// reader for the one shape `noesar-sandbox`'s own `fail()` ever writes, not a general JSON
/// parser (same posture as `parse_limits` in `main.rs`: pulling in a JSON crate for one string
/// field is not worth it in the caller either, and this is not the confined process).
fn report_reason(report: &str) -> Option<String> {
    let key = "\"reason\":\"";
    let start = report.find(key)? + key.len();
    let rest = &report[start..];
    let end = rest.find('"')?;
    Some(rest[..end].replace("\\\"", "\"").replace("\\\\", "\\"))
}

struct SandboxRunOutcome {
    performed: bool,
    reason: Option<String>,
    exit_code: Option<i32>,
    stdout: String,
    stderr: String,
}

/// Run `command` with `args` under `limits`, via a short-lived `noesar-sandbox` child, exactly
/// mirroring `runSandboxedSync` in `sandbox-runner.mjs`: a private temp spec file (limits never
/// appear in a process listing), the same three-way outcome (refused-before-running /
/// ran-and-failed / ran-and-succeeded), the same report/stderr split.
fn run_sandboxed(
    binary_path: &Path,
    limits: &IsolationLimits,
    command: &str,
    args: &[String],
    cwd: &Path,
    timeout: Duration,
) -> Result<SandboxRunOutcome, String> {
    let spec_dir = std::env::temp_dir().join(format!(
        "noesar-sandbox-exec-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0)
    ));
    fs::create_dir_all(&spec_dir).map_err(|error| format!("cannot create spec dir: {error}"))?;
    let spec_path = spec_dir.join("spec.json");
    let write_result = (|| -> std::io::Result<()> {
        let mut file = fs::File::create(&spec_path)?;
        file.write_all(limits_spec_json(limits).as_bytes())?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            file.set_permissions(fs::Permissions::from_mode(0o600))?;
        }
        Ok(())
    })();
    if let Err(error) = write_result {
        let _ = fs::remove_dir_all(&spec_dir);
        return Err(format!("cannot write spec file: {error}"));
    }

    let mut command_build = Command::new(binary_path);
    command_build
        .arg("--spec")
        .arg(&spec_path)
        .arg("--")
        .arg(command)
        .args(args)
        .current_dir(cwd)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let mut child = match command_build.spawn() {
        Ok(child) => child,
        Err(error) => {
            let _ = fs::remove_dir_all(&spec_dir);
            return Err(format!("cannot start the sandbox: {error}"));
        }
    };

    // Drain stdout/stderr on their own threads while the main thread polls for exit — a pipe
    // fills its OS buffer if nobody reads it, and a child blocked writing while we block
    // waiting for it to exit is a deadlock, not a slow test.
    let stdout_pipe = child.stdout.take().expect("stdout was piped");
    let stderr_pipe = child.stderr.take().expect("stderr was piped");
    let stdout_reader = std::thread::spawn(move || {
        let mut buffer = Vec::new();
        let _ = stdout_pipe.take(MAX_OUTPUT_BYTES as u64 + 1).read_to_end(&mut buffer);
        buffer
    });
    let stderr_reader = std::thread::spawn(move || {
        let mut buffer = Vec::new();
        let _ = stderr_pipe.take(MAX_OUTPUT_BYTES as u64 + 1).read_to_end(&mut buffer);
        buffer
    });

    let deadline = Instant::now() + timeout;
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break Some(status),
            Ok(None) => {
                if Instant::now() >= deadline {
                    let _ = child.kill();
                    let _ = child.wait();
                    break None;
                }
                std::thread::sleep(Duration::from_millis(20));
            }
            Err(error) => {
                let _ = fs::remove_dir_all(&spec_dir);
                return Err(format!("cannot wait for the sandbox: {error}"));
            }
        }
    };

    let stdout_bytes = stdout_reader.join().unwrap_or_default();
    let stderr_bytes = stderr_reader.join().unwrap_or_default();
    let _ = fs::remove_dir_all(&spec_dir);

    let stdout = String::from_utf8_lossy(&stdout_bytes).into_owned();
    let stderr_full = String::from_utf8_lossy(&stderr_bytes).into_owned();
    let (report, command_stderr) = split_sandbox_report(&stderr_full);

    let Some(status) = status else {
        return Ok(SandboxRunOutcome {
            performed: true,
            reason: None,
            exit_code: None,
            stdout,
            stderr: command_stderr,
        });
    };

    #[cfg(unix)]
    let code = {
        use std::os::unix::process::ExitStatusExt;
        status.code().or_else(|| status.signal().map(|s| -s))
    };
    #[cfg(not(unix))]
    let code = status.code();

    if code == Some(EX_CONFIG) {
        let reason = report
            .as_deref()
            .and_then(report_reason)
            .unwrap_or_else(|| "sandbox refused before the command ran".to_string());
        return Ok(SandboxRunOutcome {
            performed: false,
            reason: Some(reason),
            exit_code: code,
            stdout,
            stderr: command_stderr,
        });
    }

    Ok(SandboxRunOutcome {
        performed: true,
        reason: None,
        exit_code: code,
        stdout,
        stderr: command_stderr,
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
    execute_sandbox: Option<&ExecuteSandboxConfig>,
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
    let sandbox_enabled = execute_sandbox.map(|config| config.enabled).unwrap_or(false);

    for action in actions {
        if matches!(action, Action::Execute { .. }) && !sandbox_enabled {
            // No config at all -> NO_EXECUTION_SURFACE, byte-identical to before this crate
            // supported EXECUTE. A config that WAS passed but says enabled:false is a
            // different, more accurate fact -> EXECUTE_DISABLED_BY_OPERATOR. Mirrors
            // executor.mjs exactly; never confused with each other.
            let reason = if execute_sandbox.is_some() {
                EXECUTE_DISABLED_BY_OPERATOR
            } else {
                NO_EXECUTION_SURFACE
            };
            outcomes.push(ActionOutcome {
                path: action.path().to_string(),
                operation: Operation::Execute,
                performed: false,
                reason: Some(reason.to_string()),
                token_id: None,
                exit_code: None,
                stdout: None,
                stderr: None,
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
                exit_code: None,
                stdout: None,
                stderr: None,
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
                exit_code: None,
                stdout: None,
                stderr: None,
            });
            continue;
        }

        // Containment is the shadow's, not this crate's: one implementation of the rule.
        // EXECUTE's granted path is the working directory the command runs confined to —
        // not a second containment rule, the same call READ/WRITE/DELETE make.
        let resolved = match noesar_shadow::contained_in(shadow, action.path()) {
            Ok(path) => path,
            Err(error) => {
                outcomes.push(ActionOutcome {
                    path: action.path().to_string(),
                    operation: action.operation(),
                    performed: false,
                    reason: Some(error.to_string()),
                    token_id: Some(token.id.clone()),
                    exit_code: None,
                    stdout: None,
                    stderr: None,
                });
                continue;
            }
        };

        if let Action::Execute { command, args, .. } = action {
            // Belt and braces, mirroring executor.mjs: capability.mjs's mint() is the first
            // wall against an EXECUTE grant with no limits on an installation whose minter
            // carries a ceiling; a token reaching here with none anyway (a minter with no
            // ceiling, an older token format) is refused rather than run with the whole
            // container's limits.
            let Some(limits) = token.limits.as_ref() else {
                outcomes.push(ActionOutcome {
                    path: action.path().to_string(),
                    operation: Operation::Execute,
                    performed: false,
                    reason: Some(EXECUTE_TOKEN_WITHOUT_LIMITS.to_string()),
                    token_id: Some(token.id.clone()),
                    exit_code: None,
                    stdout: None,
                    stderr: None,
                });
                continue;
            };
            let binary_path = execute_sandbox.and_then(|config| config.binary_path.as_deref());
            let Some(binary_path) = binary_path else {
                outcomes.push(ActionOutcome {
                    path: action.path().to_string(),
                    operation: Operation::Execute,
                    performed: false,
                    reason: Some(
                        "EXECUTE is enabled but no sandbox binary path is configured".into(),
                    ),
                    token_id: Some(token.id.clone()),
                    exit_code: None,
                    stdout: None,
                    stderr: None,
                });
                continue;
            };
            match run_sandboxed(
                binary_path,
                &isolation_limits(limits),
                command,
                args,
                &resolved,
                DEFAULT_TIMEOUT,
            ) {
                Ok(run) => outcomes.push(ActionOutcome {
                    path: action.path().to_string(),
                    operation: Operation::Execute,
                    performed: run.performed,
                    reason: run.reason,
                    token_id: Some(token.id.clone()),
                    exit_code: run.exit_code,
                    stdout: Some(run.stdout),
                    stderr: Some(run.stderr),
                }),
                Err(reason) => outcomes.push(ActionOutcome {
                    path: action.path().to_string(),
                    operation: Operation::Execute,
                    performed: false,
                    reason: Some(reason),
                    token_id: Some(token.id.clone()),
                    exit_code: None,
                    stdout: None,
                    stderr: None,
                }),
            }
            continue;
        }

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
                exit_code: None,
                stdout: None,
                stderr: None,
            }),
            Err(error) => outcomes.push(ActionOutcome {
                path: action.path().to_string(),
                operation: action.operation(),
                performed: false,
                reason: Some(error.to_string()),
                token_id: Some(token.id.clone()),
                exit_code: None,
                stdout: None,
                stderr: None,
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
            limits: None,
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
            &expectation(&["a.txt"]), Vec::new(), NOW, None,
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
            &expectation(&["a.txt"]), Vec::new(), NOW, None,
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
            &expectation(&["b.txt"]), Vec::new(), NOW, None,
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
            &expectation(&["a.txt"]), Vec::new(), NOW, None,
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
            &expectation(&["a.txt"]), Vec::new(), NOW, None,
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
            &expectation(&["a.txt"]), Vec::new(), NOW, None,
        ).unwrap();
        assert_eq!(report.performed(), 0);
        assert_eq!(fs::read(b.shadow.root().join("a.txt")).unwrap(), b"before");
    }

    #[test]
    fn execute_is_refused_by_default_with_no_sandbox_config_at_all() {
        let mut b = bench("exec", &["a.txt"], true);
        // The token is mintable — the step is destructive — and the default path still
        // refuses: no `ExecuteSandboxConfig` was passed (`None`, same as every other call in
        // this module before ARCH-008/D-0253).
        let token = b.minter.mint(&b.plan, &ask(&["a.txt"], &[Operation::Execute], 1), NOW).unwrap();
        let report = execute(
            &b.plan, &mut b.minter, &[token], &b.shadow,
            &[Action::Execute { path: "a.txt".into(), command: "rm -rf /".into(), args: Vec::new() }],
            &expectation(&["a.txt"]), Vec::new(), NOW, None,
        ).unwrap();
        assert_eq!(report.performed(), 0);
        assert!(report.outcomes[0].reason.as_ref().unwrap().contains("no execution surface"));
    }

    #[test]
    fn execute_disabled_by_operator_is_a_different_reason_than_no_surface_at_all() {
        let mut b = bench("exec-disabled", &["a.txt"], true);
        let token = b.minter.mint(&b.plan, &ask(&["a.txt"], &[Operation::Execute], 1), NOW).unwrap();
        let config = ExecuteSandboxConfig { enabled: false, binary_path: None };
        let report = execute(
            &b.plan, &mut b.minter, &[token], &b.shadow,
            &[Action::Execute { path: "a.txt".into(), command: "rm -rf /".into(), args: Vec::new() }],
            &expectation(&["a.txt"]), Vec::new(), NOW, Some(&config),
        ).unwrap();
        assert_eq!(report.performed(), 0);
        assert_eq!(report.outcomes[0].reason.as_deref(), Some(EXECUTE_DISABLED_BY_OPERATOR));
    }

    #[test]
    fn execute_enabled_but_the_token_carries_no_limits_is_refused_without_spawning_anything() {
        let mut b = bench("exec-nolimits", &["a.txt"], true);
        // No limits requested — same as every other mint() in this module — so the token
        // this mints carries `limits: None`, and the belt-and-braces check in `execute()`
        // must catch it without ever trying to spawn a binary (binary_path: None proves it:
        // if the code tried to spawn, it would hit the "no binary path configured" branch
        // instead, a different reason string this test also would not accept).
        let token = b.minter.mint(&b.plan, &ask(&["a.txt"], &[Operation::Execute], 1), NOW).unwrap();
        assert!(token.limits.is_none());
        let config = ExecuteSandboxConfig { enabled: true, binary_path: None };
        let report = execute(
            &b.plan, &mut b.minter, &[token], &b.shadow,
            &[Action::Execute { path: "a.txt".into(), command: "rm -rf /".into(), args: Vec::new() }],
            &expectation(&["a.txt"]), Vec::new(), NOW, Some(&config),
        ).unwrap();
        assert_eq!(report.performed(), 0);
        assert_eq!(report.outcomes[0].reason.as_deref(), Some(EXECUTE_TOKEN_WITHOUT_LIMITS));
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
            &expectation(&["a.txt"]), Vec::new(), NOW, None,
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
            &expectation(&["a.txt"]), Vec::new(), NOW, None,
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
            &expectation(&["a.txt"]), Vec::new(), NOW, None,
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
            &expectation(&["a.txt"]), Vec::new(), NOW, None,
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
            &expectation(&["a.txt"]), Vec::new(), NOW, None,
        );
        assert!(matches!(refusal, Err(ShadowError::Invalid { .. })));
        // Refused before anything was spent or written.
        assert_eq!(fs::read(targeted.root().join("a.txt")).unwrap(), b"before");
    }
}
