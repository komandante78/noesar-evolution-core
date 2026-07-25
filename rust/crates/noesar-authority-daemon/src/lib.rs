// SPDX-License-Identifier: AGPL-3.0-or-later
use noesar_authority_protocol::{
    AuthorityEnvelope,
    AuthorityVerifier,
    ExpectedBindings,
};
use noesar_authority_transport::{
    encode_frame,
    FrameDecoder,
    PeerIdentity,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::BTreeSet;
use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthorityRequest {
    pub schema_version: String,
    pub request_id: String,
    pub envelope: AuthorityEnvelope,
    pub client: ClientDescriptor,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientDescriptor {
    pub name: String,
    pub version: String,
    pub production_eligible: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthorityResponse {
    pub schema_version: String,
    pub request_id: String,
    pub request_nonce: String,
    pub actor_id: String,
    pub session_id: String,
    pub action: String,
    pub decision: String,
    pub authority: String,
    pub production_ready: bool,
}

#[derive(Debug, Clone)]
pub struct DaemonPolicy {
    pub allowed_uids: BTreeSet<u32>,
    pub expected_client_name: String,
    pub expected_client_version: String,
    pub max_connections: usize,
}

impl DaemonPolicy {
    pub fn validate(&self) -> Result<(), &'static str> {
        if self.allowed_uids.is_empty() {
            return Err("at least one allowed Unix uid is required");
        }
        if self.expected_client_name.is_empty() {
            return Err("expected client name is required");
        }
        if self.expected_client_version.is_empty() {
            return Err("expected client version is required");
        }
        if self.max_connections == 0 || self.max_connections > 4096 {
            return Err("max_connections must be between 1 and 4096");
        }
        Ok(())
    }
}

pub fn validate_socket_path(path: &Path) -> Result<PathBuf, &'static str> {
    if !path.is_absolute() {
        return Err("authority socket path must be absolute");
    }
    let parent = path.parent().ok_or("authority socket parent is required")?;
    let parent_metadata = fs::metadata(parent)
        .map_err(|_| "authority socket parent does not exist")?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if parent_metadata.permissions().mode() & 0o002 != 0 {
            return Err("authority socket parent must not be world-writable");
        }
    }
    Ok(path.to_path_buf())
}

pub fn verify_peer(
    peer: &PeerIdentity,
    policy: &DaemonPolicy,
) -> Result<(), &'static str> {
    policy.validate()?;
    peer.validate()?;
    let uid = peer.uid.ok_or("Unix peer uid is required")?;
    if !policy.allowed_uids.contains(&uid) {
        return Err("Unix peer uid is not authorized");
    }
    Ok(())
}

pub fn handle_request(
    value: Value,
    peer: &PeerIdentity,
    policy: &DaemonPolicy,
    verifier: &mut AuthorityVerifier,
    now_seconds: i64,
) -> Result<Value, &'static str> {
    verify_peer(peer, policy)?;
    let request: AuthorityRequest = serde_json::from_value(value)
        .map_err(|_| "authority request schema is invalid")?;
    if request.schema_version != "1.0" {
        return Err("authority request schema version mismatch");
    }
    if request.request_id.len() < 8 || request.request_id.len() > 128 {
        return Err("authority request id is invalid");
    }
    if request.client.name != policy.expected_client_name {
        return Err("authority client name mismatch");
    }
    if request.client.version != policy.expected_client_version {
        return Err("authority client version mismatch");
    }
    if request.client.production_eligible {
        return Err("reference client must not claim production eligibility");
    }

    let envelope = &request.envelope;
    verifier.verify(
        envelope,
        now_seconds,
        ExpectedBindings {
            actor_id: Some(&envelope.body.actor_id),
            session_id: Some(&envelope.body.session_id),
            action: Some(&envelope.body.action),
        },
    )?;

    let response = AuthorityResponse {
        schema_version: "1.0".to_string(),
        request_id: request.request_id,
        request_nonce: envelope.body.nonce.clone(),
        actor_id: envelope.body.actor_id.clone(),
        session_id: envelope.body.session_id.clone(),
        action: envelope.body.action.clone(),
        decision: "deny".to_string(),
        authority: "rust-canonical-candidate".to_string(),
        production_ready: false,
    };
    serde_json::to_value(response)
        .map_err(|_| "authority response serialization failed")
}

#[cfg(target_os = "linux")]
pub mod unix {
    use super::*;
    use noesar_authority_transport::AuthenticatedTransport;
    use std::os::fd::AsRawFd;
    use std::os::unix::net::UnixStream;

    pub fn peer_identity(
        stream: &UnixStream,
    ) -> Result<PeerIdentity, &'static str> {
        let fd = stream.as_raw_fd();
        let mut credentials = libc::ucred {
            pid: 0,
            uid: 0,
            gid: 0,
        };
        let mut length = std::mem::size_of::<libc::ucred>() as libc::socklen_t;
        let result = unsafe {
            libc::getsockopt(
                fd,
                libc::SOL_SOCKET,
                libc::SO_PEERCRED,
                &mut credentials as *mut _ as *mut libc::c_void,
                &mut length,
            )
        };
        if result != 0 {
            return Err("SO_PEERCRED failed");
        }
        let pid = u32::try_from(credentials.pid)
            .map_err(|_| "peer pid is invalid")?;
        Ok(PeerIdentity {
            authenticated: true,
            transport: AuthenticatedTransport::UnixDomainSocket,
            uid: Some(credentials.uid),
            pid: Some(pid),
            sid: None,
        })
    }

    pub fn serve_stream(
        mut stream: UnixStream,
        policy: &DaemonPolicy,
        verifier: &mut AuthorityVerifier,
        now_seconds: i64,
    ) -> anyhow::Result<()> {
        let peer = peer_identity(&stream)
            .map_err(anyhow::Error::msg)?;
        verify_peer(&peer, policy)
            .map_err(anyhow::Error::msg)?;

        let mut decoder = FrameDecoder::new(peer)
            .map_err(anyhow::Error::msg)?;
        let mut buffer = [0_u8; 8192];
        let mut request: Option<Value> = None;

        loop {
            let count = stream.read(&mut buffer)?;
            if count == 0 {
                break;
            }
            let values = decoder
                .push(&buffer[..count])
                .map_err(anyhow::Error::msg)?;
            if values.len() > 1 || request.is_some() && !values.is_empty() {
                anyhow::bail!("one authority request per connection is required");
            }
            if let Some(value) = values.into_iter().next() {
                request = Some(value);
            }
        }
        decoder.finish().map_err(anyhow::Error::msg)?;
        let request = request.ok_or_else(|| anyhow::anyhow!("authority request missing"))?;
        let response = handle_request(
            request,
            decoder.peer(),
            policy,
            verifier,
            now_seconds,
        )
        .map_err(anyhow::Error::msg)?;
        let frame = encode_frame(&response)
            .map_err(anyhow::Error::msg)?;
        stream.write_all(&frame)?;
        stream.flush()?;
        Ok(())
    }
}

pub fn daemon_status() -> Value {
    json!({
        "mode":"rust-canonical-candidate",
        "release":"0.6.0",
        "protocolVersion":"1.1",
        "transport":"unix-domain-socket-source",
        "peerCredentials":"SO_PEERCRED-source",
        "productionReady":false,
        "buildExecuted":false,
        "testsExecuted":false
    })
}
