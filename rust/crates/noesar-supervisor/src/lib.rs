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

/// Where the image puts ATOM, and the address it is told to listen on.
///
/// **Loopback, not `0.0.0.0`.** As its own container ATOM had to listen on the network for
/// `api` to reach it, which also made it reachable by every other container on that network.
/// Inside, the only caller is a sibling process, so the listener stops being reachable from
/// anywhere at all. That is a narrowing, and it is the reason this address is written here
/// rather than left to the environment: an operator cannot widen it by accident.
pub const ATOM_BINARY_PATH: &str = "/opt/noesar/bin/atomd";
pub const ATOM_BIND: &str = "127.0.0.1:8410";
pub const ATOM_LOCAL_ENDPOINT: &str = "http://127.0.0.1:8410";

/// The three ARCH-001 peers, and only those.
///
/// Kept as its own function because `ARCH-001` is an invariant about THESE three and a test
/// asserts it by name. ATOM is supervised beside them (s335) but it is not a fourth peer: the
/// peers are the product's own halves, and ATOM is a provider the installation may or may not
/// carry. Merging the two lists would have made the ARCH-001 row unable to fail.
pub fn arch001_peers(workspace_root: &str) -> Vec<ChildSpec> {
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

/// ATOM, when this image carries it — Owner, s335: *«fai in modo che sia dentro NOESAR
/// EVOLUTION, quando installano deve esserci tutto»*.
///
/// `binary_present` is passed in rather than probed here so this stays a pure decision that a
/// test can drive both ways. The caller probes the filesystem once.
///
/// **Nothing is set that the environment already says.** `ChildSpec.env` is layered ON TOP of
/// the supervisor's environment, so writing the endpoint unconditionally would override an
/// operator who deliberately pointed this installation at an ATOM somewhere else — turning a
/// deployment choice into a value this file silently wins. Hence `Option` on every input: the
/// caller passes `None` for anything the environment already answered.
pub fn atom_child(
    binary_present: bool,
    token: Option<&str>,
    model_endpoint: Option<&str>,
) -> Option<ChildSpec> {
    if !binary_present {
        return None;
    }
    let mut env = vec![("ATOM_BIND".to_string(), ATOM_BIND.to_string())];
    if let Some(token) = token {
        env.push(("ATOM_TOKEN".to_string(), token.to_string()));
    }
    // A-0026: the one place the installation says where the model is. Absent here means the
    // environment did not name one, and ATOM keeps its own default rather than being handed
    // an empty string that would parse to nothing.
    if let Some(endpoint) = model_endpoint {
        env.push(("ATOM_MODEL_ENDPOINT".to_string(), endpoint.to_string()));
    }
    Some(ChildSpec {
        name: "atom",
        program: ATOM_BINARY_PATH.to_string(),
        args: vec![],
        env,
        // Lower than the peers' 5 on purpose: ATOM falling is a DECLARED condition this product
        // already handles (`D-0312` — the product carries on and says so), so a provider that
        // cannot start must reach that declared state promptly instead of holding the
        // installation in a restart storm pretending it is about to work.
        max_restarts: 3,
    })
}

/// Everything this supervisor runs: the three peers, and ATOM when the image carries it.
pub fn supervised_children(workspace_root: &str) -> Vec<ChildSpec> {
    supervised_children_with(
        workspace_root,
        std::path::Path::new(ATOM_BINARY_PATH).exists(),
        None,
        None,
    )
}

/// The table, with every environment-dependent input passed in — the form the tests drive.
pub fn supervised_children_with(
    workspace_root: &str,
    atom_binary_present: bool,
    atom_token: Option<&str>,
    atom_model_endpoint: Option<&str>,
) -> Vec<ChildSpec> {
    let mut children = arch001_peers(workspace_root);
    if let Some(atom) = atom_child(atom_binary_present, atom_token, atom_model_endpoint) {
        children.push(atom);
    }
    children
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
        // Read from `arch001_peers` and not from the whole table: ATOM is supervised beside the
        // peers since s335, and asserting this invariant against a list that ATOM may join
        // would make the ARCH-001 row unable to fail for the reason it exists.
        let names: Vec<&str> = arch001_peers("/workspace").iter().map(|c| c.name).collect();
        assert_eq!(names, vec!["postgres", "api", "codev"], "ARCH-001 wants exactly three peers");
    }

    #[test]
    fn an_image_without_atom_supervises_the_three_peers_and_nothing_else() {
        let names: Vec<&str> = supervised_children_with("/workspace", false, None, None)
            .iter().map(|c| c.name).collect();
        assert_eq!(names, vec!["postgres", "api", "codev"]);
        assert!(atom_child(false, Some("t"), Some("http://m:8420")).is_none(),
            "a token and an endpoint must not conjure a child out of a binary that is not there");
    }

    #[test]
    fn an_image_carrying_atom_supervises_it_beside_the_peers_on_loopback() {
        let children = supervised_children_with("/workspace", true, Some("secret"), Some("http://m:8420"));
        let names: Vec<&str> = children.iter().map(|c| c.name).collect();
        assert_eq!(names, vec!["postgres", "api", "codev", "atom"]);
        let atom = children.last().expect("atom child");
        assert_eq!(atom.program, ATOM_BINARY_PATH);
        let bind = atom.env.iter().find(|(k, _)| k == "ATOM_BIND").map(|(_, v)| v.as_str());
        // The narrowing this move buys. `0.0.0.0` here would hand back the reachability that
        // running inside the product took away, and nothing else in the image would notice.
        assert_eq!(bind, Some("127.0.0.1:8410"));
        assert!(!bind.unwrap().starts_with("0.0.0.0"));
    }

    #[test]
    fn nothing_the_environment_already_answered_is_written_over() {
        // `ChildSpec.env` layers ON TOP of the supervisor's environment, so a value written
        // here wins over the container's. An operator pointing this installation at an ATOM or
        // a model elsewhere must not be silently overridden — absent in, absent out.
        let atom = atom_child(true, None, None).expect("atom child");
        assert!(atom.env.iter().all(|(k, _)| k != "ATOM_TOKEN"));
        assert!(atom.env.iter().all(|(k, _)| k != "ATOM_MODEL_ENDPOINT"));
        // The bind address is the one thing this file does insist on, and says why.
        assert!(atom.env.iter().any(|(k, _)| k == "ATOM_BIND"));
    }

    #[test]
    fn atom_reaches_its_declared_down_state_sooner_than_a_peer() {
        let atom = atom_child(true, Some("t"), None).expect("atom child");
        let api = arch001_peers("/workspace").into_iter().find(|c| c.name == "api").expect("api");
        assert!(atom.max_restarts < api.max_restarts,
            "ATOM falling is a declared condition the product handles; a storm delays that declaration");
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
