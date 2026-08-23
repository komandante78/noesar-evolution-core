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

// D-0663 (F-RUST-001), the last of the eight originally zero-test crates. A length-prefixed
// framing decoder is a classic parser attack surface: partial reads, oversized-length DoS,
// malformed payloads and non-object frames must each be refused on their own, not merely "the
// happy path works." `PeerIdentity::validate()` gates which platform-specific fields a session
// must actually carry before a decoder is even constructed.
#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn unix_peer() -> PeerIdentity {
        PeerIdentity { authenticated: true, transport: AuthenticatedTransport::UnixDomainSocket, uid: Some(1000), pid: Some(42), sid: None }
    }

    fn windows_peer() -> PeerIdentity {
        PeerIdentity { authenticated: true, transport: AuthenticatedTransport::WindowsNamedPipe, uid: None, pid: None, sid: Some("S-1-5".into()) }
    }

    #[test]
    fn peer_identity_requires_authenticated_true() {
        let mut peer = unix_peer();
        peer.authenticated = false;
        assert_eq!(peer.validate(), Err("authenticated peer identity is required"));
    }

    #[test]
    fn unix_peer_requires_both_uid_and_pid() {
        assert_eq!(unix_peer().validate(), Ok(()));
        let mut missing_uid = unix_peer();
        missing_uid.uid = None;
        assert_eq!(missing_uid.validate(), Err("Unix peer uid and pid are required"));
        let mut missing_pid = unix_peer();
        missing_pid.pid = None;
        assert_eq!(missing_pid.validate(), Err("Unix peer uid and pid are required"));
    }

    #[test]
    fn windows_peer_requires_a_sid_at_least_four_characters_long() {
        assert_eq!(windows_peer().validate(), Ok(()));
        let mut none_sid = windows_peer();
        none_sid.sid = None;
        assert_eq!(none_sid.validate(), Err("Windows peer SID is required"));
        let mut short_sid = windows_peer();
        short_sid.sid = Some("S-1".into()); // 3 chars
        assert_eq!(short_sid.validate(), Err("Windows peer SID is required"));
    }

    #[test]
    fn frame_decoder_new_propagates_peer_validation_failure() {
        let mut invalid = unix_peer();
        invalid.authenticated = false;
        assert!(FrameDecoder::new(invalid).is_err());
    }

    #[test]
    fn frame_decoder_exposes_the_peer_it_was_built_with() {
        let decoder = FrameDecoder::new(unix_peer()).unwrap();
        assert_eq!(decoder.peer(), &unix_peer());
    }

    #[test]
    fn encode_then_push_round_trips_a_single_frame() {
        let value = json!({"action": "authority.health"});
        let frame = encode_frame(&value).expect("encode");
        let mut decoder = FrameDecoder::new(unix_peer()).unwrap();
        let decoded = decoder.push(&frame).expect("push");
        assert_eq!(decoded, vec![value]);
        assert_eq!(decoder.finish(), Ok(()));
    }

    #[test]
    fn a_frame_delivered_one_byte_at_a_time_still_decodes_once_complete() {
        let value = json!({"k": [1, 2, 3], "nested": {"a": true}});
        let frame = encode_frame(&value).expect("encode");
        let mut decoder = FrameDecoder::new(unix_peer()).unwrap();
        let mut collected = Vec::new();
        for byte in &frame {
            collected.extend(decoder.push(&[*byte]).expect("push"));
        }
        assert_eq!(collected, vec![value]);
        assert_eq!(decoder.finish(), Ok(()));
    }

    #[test]
    fn two_frames_concatenated_in_one_chunk_both_decode_in_order() {
        let first = json!({"n": 1});
        let second = json!({"n": 2});
        let mut both = encode_frame(&first).unwrap();
        both.extend(encode_frame(&second).unwrap());
        let mut decoder = FrameDecoder::new(unix_peer()).unwrap();
        assert_eq!(decoder.push(&both).unwrap(), vec![first, second]);
    }

    #[test]
    fn finish_refuses_a_stream_that_ends_with_a_partial_frame() {
        let value = json!({"k": "v"});
        let frame = encode_frame(&value).unwrap();
        let mut decoder = FrameDecoder::new(unix_peer()).unwrap();
        decoder.push(&frame[..frame.len() - 1]).expect("push a truncated frame");
        assert_eq!(decoder.finish(), Err("authority IPC stream ended with a partial frame"));
    }

    #[test]
    fn a_declared_length_of_zero_is_refused() {
        let mut decoder = FrameDecoder::new(unix_peer()).unwrap();
        assert_eq!(decoder.push(&[0, 0, 0, 0]), Err("authority IPC frame length is invalid"));
    }

    #[test]
    fn a_declared_length_beyond_the_maximum_frame_size_is_refused() {
        let mut decoder = FrameDecoder::new(unix_peer()).unwrap();
        let over_max = (MAX_FRAME_BYTES as u32) + 1;
        assert_eq!(decoder.push(&over_max.to_be_bytes()), Err("authority IPC frame length is invalid"));
    }

    #[test]
    fn malformed_json_bytes_are_refused_not_panicked_on() {
        let mut decoder = FrameDecoder::new(unix_peer()).unwrap();
        let payload = b"{not valid json";
        let mut frame = (payload.len() as u32).to_be_bytes().to_vec();
        frame.extend_from_slice(payload);
        assert_eq!(decoder.push(&frame), Err("authority IPC frame contains invalid JSON"));
    }

    #[test]
    fn a_frame_whose_payload_is_valid_json_but_not_an_object_is_refused() {
        let mut decoder = FrameDecoder::new(unix_peer()).unwrap();
        let frame = encode_frame(&json!([1, 2, 3])).unwrap();
        assert_eq!(decoder.push(&frame), Err("authority IPC frame must contain an object"));
    }

    #[test]
    fn encode_frame_refuses_a_payload_larger_than_the_maximum_frame_size() {
        let huge = "a".repeat(MAX_FRAME_BYTES + 16);
        let value = json!({"s": huge});
        assert_eq!(encode_frame(&value), Err("authority IPC frame size is invalid"));
    }
}
