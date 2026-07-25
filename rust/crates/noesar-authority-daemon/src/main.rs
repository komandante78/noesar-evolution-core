// SPDX-License-Identifier: AGPL-3.0-or-later
use noesar_authority_daemon::{
    validate_socket_path,
    DaemonPolicy,
};
use noesar_authority_protocol::AuthorityVerifier;
use std::collections::BTreeSet;
use std::env;
use std::fs;
use std::path::PathBuf;

fn parse_allowed_uids(value: &str) -> anyhow::Result<BTreeSet<u32>> {
    let mut result = BTreeSet::new();
    for part in value.split(',').map(str::trim).filter(|item| !item.is_empty()) {
        result.insert(part.parse::<u32>()?);
    }
    if result.is_empty() {
        anyhow::bail!("NOESAR_AUTHORITY_ALLOWED_UIDS is required");
    }
    Ok(result)
}

fn secret_from_file() -> anyhow::Result<Vec<u8>> {
    use std::os::unix::fs::PermissionsExt;

    let path = PathBuf::from(
        env::var("NOESAR_AUTHORITY_HMAC_SECRET_FILE")?
    );
    let metadata = fs::symlink_metadata(&path)?;
    if metadata.file_type().is_symlink() {
        anyhow::bail!("authority HMAC secret file must not be a symlink");
    }
    if metadata.permissions().mode() & 0o077 != 0 {
        anyhow::bail!("authority HMAC secret file must have private permissions");
    }
    let value = fs::read_to_string(path)?;
    let secret = hex::decode(value.trim())?;
    if secret.len() < 32 {
        anyhow::bail!("authority HMAC secret must contain at least 32 bytes");
    }
    Ok(secret)
}

#[cfg(target_os = "linux")]
fn main() -> anyhow::Result<()> {
    use noesar_authority_daemon::unix::serve_stream;
    use std::os::unix::fs::PermissionsExt;
    use std::os::unix::net::UnixListener;
    use std::time::{SystemTime, UNIX_EPOCH};

    let socket_path = PathBuf::from(
        env::var("NOESAR_AUTHORITY_SOCKET")?
    );
    let socket_path = validate_socket_path(&socket_path)
        .map_err(anyhow::Error::msg)?;
    if socket_path.exists() {
        let metadata = fs::symlink_metadata(&socket_path)?;
        if metadata.file_type().is_symlink() {
            anyhow::bail!("authority socket path must not be a symlink");
        }
        fs::remove_file(&socket_path)?;
    }

    let policy = DaemonPolicy {
        allowed_uids: parse_allowed_uids(
            &env::var("NOESAR_AUTHORITY_ALLOWED_UIDS")?
        )?,
        expected_client_name: "noesar-reference-control-plane".to_string(),
        expected_client_version: "0.6.0".to_string(),
        max_connections: env::var("NOESAR_AUTHORITY_MAX_CONNECTIONS")
            .unwrap_or_else(|_| "128".to_string())
            .parse()?,
    };
    policy.validate().map_err(anyhow::Error::msg)?;

    let listener = UnixListener::bind(&socket_path)?;
    fs::set_permissions(&socket_path, fs::Permissions::from_mode(0o600))?;
    let mut verifier = AuthorityVerifier::new(secret_from_file()?, 5)
        .map_err(anyhow::Error::msg)?;

    for stream in listener.incoming().take(policy.max_connections) {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)?
            .as_secs() as i64;
        serve_stream(stream?, &policy, &mut verifier, now)?;
    }
    Ok(())
}

#[cfg(not(target_os = "linux"))]
fn main() -> anyhow::Result<()> {
    anyhow::bail!(
        "V0.6.0 source package implements the Unix SO_PEERCRED daemon path only; \
         non-Linux peer-credential transports remain unimplemented"
    )
}
