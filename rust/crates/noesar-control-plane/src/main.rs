// SPDX-License-Identifier: AGPL-3.0-or-later
use axum::{routing::get, Json, Router};
use noesar_authority_api::{
    require_production_authority, AuthorityStatus,
};
use noesar_contracts::PrivacyState;
use noesar_data_plane::{
    require_production_data_plane, DataPlaneStatus,
};
use serde_json::{json, Value};
use std::{env, net::SocketAddr};

async fn health() -> Json<Value> {
    Json(json!({
        "status":"healthy",
        "product":"NOESAR Evolution",
        "version":"0.6.0-rust-source",
        "authority":"Rust Control Plane source candidate",
        "authorityDaemon":"source-present-not-built",
        "authorityProtocolVersion":"1.1",
        "productionReady":false
    }))
}

async fn privacy() -> Json<Value> {
    Json(json!({
        "state":PrivacyState::LocalOnlyVerified,
        "headline":"NOESAR runs locally on your device.",
        "detail":"No data is sent to external servers."
    }))
}

fn enforce_release_gate() -> anyhow::Result<()> {
    let channel = env::var("NOESAR_RELEASE_CHANNEL")
        .unwrap_or_else(|_| "development".to_string());
    if channel != "production" {
        return Ok(());
    }

    // ZIP 1 V0.6.0 intentionally has no mechanism to manufacture these
    // attestations. The compiled final authority must construct them from
    // authenticated IPC, verified provenance and executed acceptance evidence.
    let authority = AuthorityStatus::reference_node();
    let data_plane = DataPlaneStatus::reference_json();
    require_production_authority(&authority)
        .map_err(anyhow::Error::msg)?;
    require_production_data_plane(&data_plane)
        .map_err(anyhow::Error::msg)?;
    Ok(())
}

// D-0664 (F-RUST-001), closing it: enforce_release_gate() is the only function in this
// binary-only crate with real decision logic, and it is a security-relevant one -- whether the
// product is willing to start against real users. A single test, not two, deliberately:
// std::env::set_var mutates process-global state, and cargo test runs tests in the same binary
// concurrently by default, so two tests each setting NOESAR_RELEASE_CHANNEL would race each
// other rather than exercising the gate. Both branches are checked sequentially in one test.
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_release_gate_blocks_production_but_not_development() {
        // SAFETY: this crate's test binary is single-threaded for this test (no other test in
        // this file touches NOESAR_RELEASE_CHANNEL), and the value is restored before return.
        unsafe { env::remove_var("NOESAR_RELEASE_CHANNEL") };
        assert!(
            enforce_release_gate().is_ok(),
            "an unset channel must default to development and never block startup",
        );

        unsafe { env::set_var("NOESAR_RELEASE_CHANNEL", "development") };
        assert!(enforce_release_gate().is_ok(), "an explicit development channel must not block startup");

        unsafe { env::set_var("NOESAR_RELEASE_CHANNEL", "production") };
        let outcome = enforce_release_gate();
        assert!(
            outcome.is_err(),
            "the production channel must refuse to start on the reference (never production-ready) authority and data-plane status -- ZIP 1 v0.6.0 has no mechanism to construct a real attestation yet",
        );

        unsafe { env::remove_var("NOESAR_RELEASE_CHANNEL") };
    }
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    enforce_release_gate()?;
    let app = Router::new()
        .route("/healthz", get(health))
        .route("/api/v1/privacy", get(privacy));
    let address = SocketAddr::from(([127, 0, 0, 1], 8088));
    let listener = tokio::net::TcpListener::bind(address).await?;
    axum::serve(listener, app).await?;
    Ok(())
}
