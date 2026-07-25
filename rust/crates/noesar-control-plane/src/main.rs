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
