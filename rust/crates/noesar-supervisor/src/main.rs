// SPDX-License-Identifier: AGPL-3.0-or-later
//
// PID 1 of the container. Spawns the declared peer children (see lib.rs), reaps any
// process reparented to it (the classic PID-1 zombie-reaping duty — tokio only reaps
// processes IT spawned, not orphans that land on us because something else died first),
// forwards SIGTERM/SIGINT to every child on container stop, and restarts a crashed child
// on its own backoff schedule WITHOUT touching the sibling child's lifecycle (ARCH-002).
//
// What this is not: a general-purpose init system. It supervises exactly the children in
// `supervised_children()`, nothing more, and it does not fork itself into the background.

use std::sync::Arc;
use std::time::Duration;

use noesar_supervisor::{backoff_delay_ms, log_line, ChildSpec};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::watch;

const GRACEFUL_STOP_TIMEOUT: Duration = Duration::from_secs(45);
const BACKOFF_CAP_MS: u64 = 15_000;
const REAP_POLL_INTERVAL: Duration = Duration::from_millis(1000);

fn workspace_root() -> String {
    std::env::var("NOESAR_WORKSPACE").unwrap_or_else(|_| "/workspace".to_string())
}

fn spawn_child(spec: &ChildSpec) -> std::io::Result<Child> {
    let mut cmd = Command::new(&spec.program);
    cmd.args(&spec.args);
    for (k, v) in &spec.env {
        cmd.env(k, v);
    }
    cmd.stdout(std::process::Stdio::piped());
    cmd.stderr(std::process::Stdio::piped());
    // The supervisor process itself has no controlling terminal to leak and no stdin any
    // child needs — closing it means a child that mistakenly tries to read from stdin
    // fails fast instead of hanging the whole container at startup.
    cmd.stdin(std::process::Stdio::null());
    cmd.spawn()
}

fn forward_stream<R>(reader: R, child_name: &'static str, level: &'static str)
where
    R: tokio::io::AsyncRead + Unpin + Send + 'static,
{
    tokio::spawn(async move {
        let mut lines = BufReader::new(reader).lines();
        loop {
            match lines.next_line().await {
                Ok(Some(line)) => {
                    if line.trim().is_empty() {
                        continue;
                    }
                    // Child processes already emit their own JSON log lines (the same
                    // {ts,level,event,component,...} convention this supervisor uses) —
                    // passed through verbatim so downstream log tooling keeps working.
                    // Anything that is not valid JSON (a stack trace, a raw panic) is
                    // wrapped instead of silently dropped.
                    if serde_json::from_str::<serde_json::Value>(&line).is_ok() {
                        println!("{line}");
                    } else {
                        println!(
                            "{}",
                            log_line(level, "child.raw_output", Some(child_name), serde_json::json!({"line": line}))
                        );
                    }
                }
                Ok(None) => break,
                Err(_) => break,
            }
        }
    });
}

/// Reaps any process reparented to PID 1 that is NOT one of our own tracked children —
/// e.g. a postgres backend orphaned because its immediate parent (the `postgres` peer's
/// node wrapper) died before it could clean up. Without this, orphans accumulate as
/// zombies and eventually exhaust the process table, which is the specific failure mode
/// PID 1 exists to prevent.
fn spawn_foreign_zombie_reaper(tracked: Arc<std::sync::Mutex<std::collections::HashSet<i32>>>) {
    std::thread::spawn(move || loop {
        std::thread::sleep(REAP_POLL_INTERVAL);
        loop {
            let mut status: i32 = 0;
            // WNOHANG: never blocks. -1: any child of this process, tracked or not.
            let pid = unsafe { libc::waitpid(-1, &mut status, libc::WNOHANG) };
            if pid <= 0 {
                break;
            }
            let is_tracked = tracked.lock().map(|set| set.contains(&pid)).unwrap_or(false);
            if !is_tracked {
                println!(
                    "{}",
                    log_line(
                        "warn",
                        "supervisor.reaped_foreign_orphan",
                        None,
                        serde_json::json!({"pid": pid, "status": status}),
                    )
                );
            }
            // A tracked child's own wait() (in run_child) also reaps it when it notices
            // the exit; racing with waitpid here is harmless — a pid is only reapable
            // once, so at most one of the two sees a real exit code.
        }
    });
}

async fn run_child(
    spec: ChildSpec,
    tracked_pids: Arc<std::sync::Mutex<std::collections::HashSet<i32>>>,
    mut shutdown_rx: watch::Receiver<bool>,
) {
    let mut restart_count: u32 = 0;
    loop {
        let mut child = match spawn_child(&spec) {
            Ok(c) => c,
            Err(error) => {
                println!(
                    "{}",
                    log_line(
                        "error", "child.spawn_failed", Some(spec.name),
                        serde_json::json!({"message": error.to_string()}),
                    )
                );
                restart_count += 1;
                if restart_count > spec.max_restarts {
                    println!(
                        "{}",
                        log_line("error", "child.permanently_failed", Some(spec.name), serde_json::json!({}))
                    );
                    let _ = shutdown_rx.changed().await;
                    return;
                }
                tokio::time::sleep(Duration::from_millis(backoff_delay_ms(restart_count, BACKOFF_CAP_MS))).await;
                continue;
            }
        };

        let pid = child.id().map(|p| p as i32);
        if let Some(pid) = pid {
            if let Ok(mut set) = tracked_pids.lock() {
                set.insert(pid);
            }
        }
        println!(
            "{}",
            log_line("info", "child.spawned", Some(spec.name), serde_json::json!({"pid": pid}))
        );

        if let Some(stdout) = child.stdout.take() {
            forward_stream(stdout, spec.name, "info");
        }
        if let Some(stderr) = child.stderr.take() {
            forward_stream(stderr, spec.name, "warn");
        }

        tokio::select! {
            status = child.wait() => {
                let status = status.ok();
                if let Some(pid) = pid {
                    if let Ok(mut set) = tracked_pids.lock() { set.remove(&pid); }
                }
                if *shutdown_rx.borrow() {
                    // The supervisor is stopping the whole container; this exit is
                    // expected, not a crash to restart from.
                    return;
                }
                println!(
                    "{}",
                    log_line(
                        "error", "child.exited_unexpectedly", Some(spec.name),
                        serde_json::json!({"code": status.and_then(|s| s.code()), "restarts": restart_count}),
                    )
                );
                restart_count += 1;
                if restart_count > spec.max_restarts {
                    println!(
                        "{}",
                        log_line(
                            "error", "child.permanently_failed", Some(spec.name),
                            serde_json::json!({"restarts": restart_count}),
                        )
                    );
                    // ARCH-002: this child gives up. The sibling child's task is
                    // entirely independent and keeps running — there is nothing here
                    // that touches it.
                    let _ = shutdown_rx.changed().await;
                    return;
                }
                let delay = backoff_delay_ms(restart_count, BACKOFF_CAP_MS);
                println!(
                    "{}",
                    log_line(
                        "warn", "child.restart_scheduled", Some(spec.name),
                        serde_json::json!({"attempt": restart_count, "delay_ms": delay}),
                    )
                );
                tokio::time::sleep(Duration::from_millis(delay)).await;
            }
            _ = shutdown_rx.changed() => {
                if !*shutdown_rx.borrow() {
                    continue;
                }
                println!(
                    "{}",
                    log_line("info", "child.stopping", Some(spec.name), serde_json::json!({"pid": pid}))
                );
                if let Some(pid) = pid {
                    unsafe { libc::kill(pid, libc::SIGTERM); }
                }
                let graceful = tokio::time::timeout(GRACEFUL_STOP_TIMEOUT, child.wait()).await;
                if graceful.is_err() {
                    println!(
                        "{}",
                        log_line("warn", "child.stop_escalated_to_kill", Some(spec.name), serde_json::json!({}))
                    );
                    if let Some(pid) = pid {
                        unsafe { libc::kill(pid, libc::SIGKILL); }
                    }
                    let _ = child.wait().await;
                }
                if let Some(pid) = pid {
                    if let Ok(mut set) = tracked_pids.lock() { set.remove(&pid); }
                }
                println!(
                    "{}",
                    log_line("info", "child.stopped", Some(spec.name), serde_json::json!({}))
                );
                return;
            }
        }
    }
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    println!(
        "{}",
        log_line("info", "supervisor.start", None, serde_json::json!({"pid": std::process::id()}))
    );

    let workspace = workspace_root();

    // s335 — ATOM runs inside this image now, and ONE variable says where the model is.
    //
    // NOESAR reads `NOESAR_AUTHORING_ENDPOINT`; ATOM reads `ATOM_MODEL_ENDPOINT` (A-0026).
    // Deriving the second from the first here is what stops them being two values an operator
    // has to keep equal by hand — precisely the state s335 found this installation in, with
    // ATOM's address compiled into its binary and neither process able to notice a divergence.
    //
    // `ATOM_MODEL_ENDPOINT` set explicitly WINS: an operator who pointed ATOM at a different
    // model server meant it, and a supervisor that overrode them would make the variable a lie.
    let atom_binary_present = std::path::Path::new(noesar_supervisor::ATOM_BINARY_PATH).exists();
    let atom_model_endpoint = if std::env::var_os("ATOM_MODEL_ENDPOINT").is_some() {
        None
    } else {
        std::env::var("NOESAR_AUTHORING_ENDPOINT")
            .ok()
            .filter(|value| !value.trim().is_empty())
    };
    println!(
        "{}",
        log_line(
            "info",
            "supervisor.atom",
            None,
            serde_json::json!({
                "present": atom_binary_present,
                "binary": noesar_supervisor::ATOM_BINARY_PATH,
                // Said out loud at every boot. An installation that carries ATOM and one that
                // does not are different products, and which one this is must not have to be
                // inferred from the absence of a log line.
                "modelEndpointFrom": if atom_model_endpoint.is_some() { "NOESAR_AUTHORING_ENDPOINT" } else { "environment" },
            })
        )
    );
    let children = noesar_supervisor::supervised_children_with(
        &workspace,
        atom_binary_present,
        None,
        atom_model_endpoint.as_deref(),
    );
    let tracked_pids: Arc<std::sync::Mutex<std::collections::HashSet<i32>>> =
        Arc::new(std::sync::Mutex::new(std::collections::HashSet::new()));

    spawn_foreign_zombie_reaper(tracked_pids.clone());

    let (shutdown_tx, shutdown_rx) = watch::channel(false);

    let mut handles = Vec::new();
    for spec in children {
        let name = spec.name;
        let handle = tokio::spawn(run_child(spec, tracked_pids.clone(), shutdown_rx.clone()));
        handles.push((name, handle));
    }

    let mut sigterm = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())?;
    let mut sigint = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::interrupt())?;

    tokio::select! {
        _ = sigterm.recv() => {
            println!("{}", log_line("info", "supervisor.signal_received", None, serde_json::json!({"signal": "SIGTERM"})));
        }
        _ = sigint.recv() => {
            println!("{}", log_line("info", "supervisor.signal_received", None, serde_json::json!({"signal": "SIGINT"})));
        }
    }

    shutdown_tx.send(true).ok();

    for (name, handle) in handles {
        if let Err(error) = handle.await {
            println!(
                "{}",
                log_line("error", "child.task_panicked", Some(name), serde_json::json!({"message": error.to_string()}))
            );
        }
    }

    println!("{}", log_line("info", "supervisor.stopped", None, serde_json::json!({})));
    Ok(())
}
