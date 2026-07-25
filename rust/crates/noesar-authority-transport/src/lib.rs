// SPDX-License-Identifier: AGPL-3.0-or-later
use serde::{Deserialize, Serialize};
use serde_json::Value;

pub const MAX_FRAME_BYTES: usize = 1024 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum AuthenticatedTransport {
    UnixDomainSocket,
    WindowsNamedPipe,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct PeerIdentity {
    pub authenticated: bool,
    pub transport: AuthenticatedTransport,
    pub uid: Option<u32>,
    pub pid: Option<u32>,
    pub sid: Option<String>,
}

impl PeerIdentity {
    pub fn validate(&self) -> Result<(), &'static str> {
        if !self.authenticated {
            return Err("authenticated peer identity is required");
        }
        match self.transport {
            AuthenticatedTransport::UnixDomainSocket => {
                if self.uid.is_none() || self.pid.is_none() {
                    return Err("Unix peer uid and pid are required");
                }
            }
            AuthenticatedTransport::WindowsNamedPipe => {
                if self.sid.as_deref().unwrap_or_default().len() < 4 {
                    return Err("Windows peer SID is required");
                }
            }
        }
        Ok(())
    }
}

pub fn encode_frame(value: &Value) -> Result<Vec<u8>, &'static str> {
    let payload = noesar_canonical_json::to_vec(value)?;
    if payload.is_empty() || payload.len() > MAX_FRAME_BYTES {
        return Err("authority IPC frame size is invalid");
    }
    let length = u32::try_from(payload.len())
        .map_err(|_| "authority IPC frame is too large")?;
    let mut frame = Vec::with_capacity(4 + payload.len());
    frame.extend_from_slice(&length.to_be_bytes());
    frame.extend_from_slice(&payload);
    Ok(frame)
}

pub struct FrameDecoder {
    buffer: Vec<u8>,
    max_frame_bytes: usize,
    peer: PeerIdentity,
}

impl FrameDecoder {
    pub fn new(peer: PeerIdentity) -> Result<Self, &'static str> {
        peer.validate()?;
        Ok(Self {
            buffer: Vec::new(),
            max_frame_bytes: MAX_FRAME_BYTES,
            peer,
        })
    }

    pub fn peer(&self) -> &PeerIdentity {
        &self.peer
    }

    pub fn push(&mut self, chunk: &[u8]) -> Result<Vec<Value>, &'static str> {
        self.buffer.extend_from_slice(chunk);
        let mut values = Vec::new();

        loop {
            if self.buffer.len() < 4 {
                break;
            }
            let length = u32::from_be_bytes([
                self.buffer[0],
                self.buffer[1],
                self.buffer[2],
                self.buffer[3],
            ]) as usize;
            if length == 0 || length > self.max_frame_bytes {
                return Err("authority IPC frame length is invalid");
            }
            if self.buffer.len() < 4 + length {
                break;
            }
            let payload = self.buffer[4..4 + length].to_vec();
            self.buffer.drain(..4 + length);
            let value: Value = serde_json::from_slice(&payload)
                .map_err(|_| "authority IPC frame contains invalid JSON")?;
            if !value.is_object() {
                return Err("authority IPC frame must contain an object");
            }
            values.push(value);
        }
        Ok(values)
    }

    pub fn finish(&self) -> Result<(), &'static str> {
        if self.buffer.is_empty() {
            Ok(())
        } else {
            Err("authority IPC stream ended with a partial frame")
        }
    }
}
