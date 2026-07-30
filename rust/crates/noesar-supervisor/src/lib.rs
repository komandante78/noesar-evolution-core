// SPDX-License-Identifier: AGPL-3.0-or-later
//
// ARCH-001 (MASTER_PROJECT/03_ARCHITETTURA.md §1, §10): "un solo container OCI, un
// supervisore sottile come PID 1 e tre figli pari (postgres, api, codev)". This crate is
// that supervisor. It is deliberately small: the pure, testable pieces (backoff schedule,
// child table, log line shape) live here; the actual process/signal orchestration, which
// can only be exercised against a real kernel, lives in `main.rs` and is verified live
// (docker kill/restart), the same way `postgres-supervisor.mjs`'s own crash-recovery
// behaviour always has been — there is no `.test.mjs` for that file either, and this
// crate does not pretend a unit test can substitute for watching a real SIGKILL land.
//
// All THREE peers are wired here: `postgres`, `api`, and `codev`
// (services/reference-control-plane/bin/codev-child.mjs). `codev` carries no business
// logic of its own — it is a byte-transparent relay between the externally-reachable
// session-protocol socket (NOESAR_TUI_SOCKET_PATH) and the internal-only one `api` now
// listens on instead (NOESAR_CODEV_PEER_SOCKET_PATH). The actual dispatch (plan/simulate/
// approve/…) stays owned exclusively by `api`, so there is still exactly one engine — see
// that file's own header comment for why a second copy of it would be wrong, not just
// unnecessary.

use serde::Serialize;

/// One child process this supervisor is responsible for.
#[derive(Debug, Clone)]
pub struct ChildSpec {
    pub name: &'static str,
    pub program: String,
    pub args: Vec<String>,
    /// Extra environment variables layered on top of the supervisor's own environment.
    pub env: Vec<(String, String)>,
    /// Cap on automatic restarts before this child is left down (the OTHER child keeps
    /// running — ARCH-002 is exactly this: one child's exhaustion must not touch the
    /// other's lifecycle).
    pub max_restarts: u32,
}

/// Exponential backoff with the same shape as `postgres-supervisor.mjs`'s
/// `#attemptRestart`: 1s, 2s, 4s, 8s, capped at 15s. Kept identical on purpose — a
/// restart-storm on the Rust side should not read as unrelated to the equivalent JS
/// behaviour operators may already be familiar with from Phase 4 acceptance evidence.
pub fn backoff_delay_ms(restart_count: u32, cap_ms: u64) -> u64 {
    let raw = 1000u64.saturating_mul(1u64 << restart_count.saturating_sub(1).min(20));
    raw.min(cap_ms)
}

#[derive(Debug, Serialize)]
pub struct LogLine<'a> {
    pub ts: String,
    pub level: &'a str,
    pub event: &'a str,
    pub component: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub child: Option<&'a str>,
    #[serde(flatten)]
    pub detail: serde_json::Value,
}

pub fn log_line(level: &str, event: &str, child: Option<&str>, detail: serde_json::Value) -> String {
    let line = LogLine {
        ts: chrono::Utc::now().to_rfc3339(),
        level,
        event,
        component: "noesar-supervisor",
        child,
        detail,
    };
    serde_json::to_string(&line).unwrap_or_else(|_| {
        format!(
            "{{\"level\":\"{level}\",\"event\":\"{event}\",\"component\":\"noesar-supervisor\"}}"
        )
    })
}

/// The internal-only peer socket `api` listens on and `codev` relays to — under `/run`
/// (tmpfs, container-local, never bind-mounted) so both children agree on its path without
/// either one having to be told the other's env var name.
const CODEV_PEER_SOCKET_PATH: &str = "/run/codev-peer.sock";

/// The declared child table — all three ARCH-001 peers.
pub fn supervised_children(workspace_root: &str) -> Vec<ChildSpec> {
    vec![
        ChildSpec {
            name: "postgres",
            program: "node".to_string(),
            args: vec!["services/reference-control-plane/bin/postgres-child.mjs".to_string()],
            env: vec![
                ("NOESAR_WORKSPACE".to_string(), workspace_root.to_string()),
            ],
            max_restarts: 5,
        },
        ChildSpec {
            name: "api",
            program: "node".to_string(),
            args: vec!["services/reference-control-plane/src/server.mjs".to_string()],
            env: vec![
                ("NOESAR_WORKSPACE".to_string(), workspace_root.to_string()),
                // ARCH-001: tells server.mjs its PostgresSupervisor instance must NOT
                // own the postgres OS process — that is now the `postgres` peer's job.
                ("NOESAR_POSTGRES_PEER_MODE".to_string(), "1".to_string()),
                // ARCH-001: api listens on the internal peer socket, not the externally-
                // reachable one — `codev` owns that path now.
                ("NOESAR_CODEV_PEER_SOCKET_PATH".to_string(), CODEV_PEER_SOCKET_PATH.to_string()),
            ],
            max_restarts: 5,
        },
        ChildSpec {
            name: "codev",
            program: "node".to_string(),
            args: vec!["services/reference-control-plane/bin/codev-child.mjs".to_string()],
            env: vec![
                ("NOESAR_WORKSPACE".to_string(), workspace_root.to_string()),
                ("NOESAR_CODEV_PEER_SOCKET_PATH".to_string(), CODEV_PEER_SOCKET_PATH.to_string()),
                // NOESAR_TUI_SOCKET_PATH is left to codev-child.mjs's own default
                // (`${workspace}/tui.sock`) unless the container environment overrides
                // it — same default server.mjs used before this phase, so the host bind
                // mount (NOESAR_EVOLUTION_RUNTIME/tui.sock) needs no change.
            ],
            max_restarts: 5,
        },
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn backoff_matches_the_js_supervisor_shape() {
        assert_eq!(backoff_delay_ms(1, 15000), 1000);
        assert_eq!(backoff_delay_ms(2, 15000), 2000);
        assert_eq!(backoff_delay_ms(3, 15000), 4000);
        assert_eq!(backoff_delay_ms(4, 15000), 8000);
        assert_eq!(backoff_delay_ms(5, 15000), 15000, "5th attempt would be 16000, capped");
        assert_eq!(backoff_delay_ms(9, 15000), 15000, "stays capped, never overflows");
    }

    #[test]
    fn backoff_never_panics_on_large_restart_counts() {
        // A child that has been restarting for a very long time must not overflow the
        // shift and panic the supervisor that exists to keep the OTHER child alive.
        let _ = backoff_delay_ms(u32::MAX, 15000);
    }

    #[test]
    fn exactly_three_peers_declared() {
        let children = supervised_children("/workspace");
        let names: Vec<&str> = children.iter().map(|c| c.name).collect();
        assert_eq!(names, vec!["postgres", "api", "codev"], "ARCH-001 wants exactly three peers");
    }

    #[test]
    fn api_peer_is_told_not_to_own_postgres() {
        let children = supervised_children("/workspace");
        let api = children.iter().find(|c| c.name == "api").expect("api child declared");
        assert!(api.env.iter().any(|(k, v)| k == "NOESAR_POSTGRES_PEER_MODE" && v == "1"));
    }

    #[test]
    fn api_and_codev_agree_on_the_same_internal_peer_socket_path() {
        let children = supervised_children("/workspace");
        let api = children.iter().find(|c| c.name == "api").expect("api child declared");
        let codev = children.iter().find(|c| c.name == "codev").expect("codev child declared");
        let api_path = api.env.iter().find(|(k, _)| k == "NOESAR_CODEV_PEER_SOCKET_PATH").map(|(_, v)| v.as_str());
        let codev_path = codev.env.iter().find(|(k, _)| k == "NOESAR_CODEV_PEER_SOCKET_PATH").map(|(_, v)| v.as_str());
        assert!(api_path.is_some(), "api must be told where to listen for codev");
        assert_eq!(api_path, codev_path, "a mismatch here means codev relays to a socket api never listens on");
    }

    #[test]
    fn codev_peer_socket_path_is_under_run_not_the_bind_mounted_workspace() {
        // /run is the tmpfs INST-004 restores: container-local, never bind-mounted, gone
        // on restart. Putting the internal peer socket under /workspace instead would leak
        // it onto the host bind mount for no reason a peer-only RPC channel has.
        let children = supervised_children("/workspace");
        let codev = children.iter().find(|c| c.name == "codev").expect("codev child declared");
        let path = codev.env.iter().find(|(k, _)| k == "NOESAR_CODEV_PEER_SOCKET_PATH").map(|(_, v)| v.as_str());
        assert_eq!(path, Some("/run/codev-peer.sock"));
    }

    #[test]
    fn log_line_is_valid_json_with_the_expected_shape() {
        let line = log_line("info", "child.spawned", Some("postgres"), serde_json::json!({"pid": 42}));
        let parsed: serde_json::Value = serde_json::from_str(&line).expect("valid JSON");
        assert_eq!(parsed["level"], "info");
        assert_eq!(parsed["event"], "child.spawned");
        assert_eq!(parsed["component"], "noesar-supervisor");
        assert_eq!(parsed["child"], "postgres");
        assert_eq!(parsed["pid"], 42);
    }

    #[test]
    fn log_line_without_a_child_omits_the_field_rather_than_nulling_it() {
        let line = log_line("info", "supervisor.start", None, serde_json::json!({}));
        let parsed: serde_json::Value = serde_json::from_str(&line).expect("valid JSON");
        assert!(parsed.get("child").is_none());
    }
}
