// SPDX-License-Identifier: AGPL-3.0-or-later
import { canonicalJsonBytes } from './canonical-json.mjs';

export const AUTHORITY_MAX_FRAME_BYTES = 1024 * 1024;

export function requirePeerIdentity(peer, {
  allowedTransports = ['unix-domain-socket', 'windows-named-pipe'],
  expectedUid,
  expectedSid,
} = {}) {
  if (!peer || peer.authenticated !== true) {
    throw new Error('authenticated peer identity is required');
  }
  if (!allowedTransports.includes(peer.transport)) {
    throw new Error('unsupported authenticated IPC transport');
  }
  if (peer.transport === 'unix-domain-socket') {
    if (!Number.isInteger(peer.uid) || !Number.isInteger(peer.pid)) {
      throw new Error('Unix peer uid and pid are required');
    }
    if (expectedUid !== undefined && peer.uid !== expectedUid) {
      throw new Error('Unix peer uid mismatch');
    }
  }
  if (peer.transport === 'windows-named-pipe') {
    if (typeof peer.sid !== 'string' || peer.sid.length < 4) {
      throw new Error('Windows peer SID is required');
    }
    if (expectedSid !== undefined && peer.sid !== expectedSid) {
      throw new Error('Windows peer SID mismatch');
    }
  }
  return Object.freeze({ ...peer });
}

export function encodeAuthorityFrame(value, {
  maxFrameBytes = AUTHORITY_MAX_FRAME_BYTES,
} = {}) {
  const payload = canonicalJsonBytes(value);
  if (payload.length === 0 || payload.length > maxFrameBytes) {
    throw new Error('authority IPC frame size is invalid');
  }
  const frame = Buffer.allocUnsafe(4 + payload.length);
  frame.writeUInt32BE(payload.length, 0);
  payload.copy(frame, 4);
  return frame;
}

export class AuthorityFrameDecoder {
  constructor({
    maxFrameBytes = AUTHORITY_MAX_FRAME_BYTES,
    peerIdentity,
    peerRequirements,
  } = {}) {
    this.maxFrameBytes = maxFrameBytes;
    this.peer = requirePeerIdentity(peerIdentity, peerRequirements);
    this.buffer = Buffer.alloc(0);
  }

  push(chunk) {
    if (!Buffer.isBuffer(chunk)) throw new TypeError('IPC chunk must be a Buffer');
    this.buffer = Buffer.concat([this.buffer, chunk]);
    const values = [];

    while (this.buffer.length >= 4) {
      const length = this.buffer.readUInt32BE(0);
      if (length === 0 || length > this.maxFrameBytes) {
        throw new Error('authority IPC frame length is invalid');
      }
      if (this.buffer.length < 4 + length) break;
      const payload = this.buffer.subarray(4, 4 + length);
      this.buffer = this.buffer.subarray(4 + length);

      let value;
      try {
        value = JSON.parse(payload.toString('utf8'));
      } catch {
        throw new Error('authority IPC frame contains invalid JSON');
      }
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error('authority IPC frame must contain an object');
      }
      values.push(value);
    }

    return values;
  }

  finish() {
    if (this.buffer.length !== 0) {
      throw new Error('authority IPC stream ended with a partial frame');
    }
  }
}
