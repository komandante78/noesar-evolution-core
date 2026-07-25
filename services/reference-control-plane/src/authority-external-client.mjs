// SPDX-License-Identifier: AGPL-3.0-or-later
import net from 'node:net';
import {
  lstatSync,
  realpathSync,
  statSync,
} from 'node:fs';
import {
  dirname,
  isAbsolute,
  resolve,
} from 'node:path';
import {
  AUTHORITY_MAX_FRAME_BYTES,
  encodeAuthorityFrame,
} from './authority-ipc-frame.mjs';

const RESPONSE_FIELDS = Object.freeze([
  'schemaVersion',
  'requestId',
  'requestNonce',
  'actorId',
  'sessionId',
  'action',
  'decision',
  'authority',
  'productionReady',
]);

function requirePrivateSocketPath(socketPath) {
  if (typeof socketPath !== 'string' || !isAbsolute(socketPath)) {
    throw new Error('authority socket path must be absolute');
  }
  const resolved = resolve(socketPath);
  const parent = dirname(resolved);
  const parentInfo = statSync(parent);
  if ((parentInfo.mode & 0o002) !== 0) {
    throw new Error('authority socket parent must not be world-writable');
  }

  const linkInfo = lstatSync(resolved);
  if (linkInfo.isSymbolicLink()) {
    throw new Error('authority socket path must not be a symlink');
  }
  if (!linkInfo.isSocket()) {
    throw new Error('authority endpoint must be a Unix-domain socket');
  }
  if (realpathSync(resolved) !== resolved) {
    throw new Error('authority socket path must be canonical');
  }
  return resolved;
}

function decodeSingleFrame(buffer, maxFrameBytes) {
  if (buffer.length < 4) return null;
  const length = buffer.readUInt32BE(0);
  if (length < 1 || length > maxFrameBytes) {
    throw new Error('authority response frame length is invalid');
  }
  if (buffer.length < 4 + length) return null;
  if (buffer.length !== 4 + length) {
    throw new Error('authority response contains trailing bytes');
  }
  let value;
  try {
    value = JSON.parse(buffer.subarray(4).toString('utf8'));
  } catch {
    throw new Error('authority response contains invalid JSON');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('authority response must contain an object');
  }
  return value;
}

function validateResponse(response, expected) {
  for (const field of RESPONSE_FIELDS) {
    if (!(field in response)) {
      throw new Error(`authority response missing ${field}`);
    }
  }
  if (response.schemaVersion !== '1.0') {
    throw new Error('authority response schema version mismatch');
  }
  for (const [field, value] of Object.entries(expected)) {
    if (response[field] !== value) {
      throw new Error(`authority response ${field} binding mismatch`);
    }
  }
  if (!['allow', 'deny'].includes(response.decision)) {
    throw new Error('authority response decision is invalid');
  }
  if (
    response.authority !== 'rust-canonical-candidate'
    || response.productionReady !== false
  ) {
    throw new Error('authority response contains an invalid readiness claim');
  }
  return Object.freeze({
    ...response,
    transport:'unix-domain-socket-reference-client',
    serverPeerCredentialsVerified:false,
    productionEligible:false,
  });
}

export class ExternalAuthorityClient {
  constructor({
    socketPath,
    timeoutMs = 1500,
    maxFrameBytes = AUTHORITY_MAX_FRAME_BYTES,
  }) {
    if (!Number.isInteger(timeoutMs) || timeoutMs < 50 || timeoutMs > 10000) {
      throw new Error('authority timeoutMs must be between 50 and 10000');
    }
    if (
      !Number.isInteger(maxFrameBytes)
      || maxFrameBytes < 256
      || maxFrameBytes > AUTHORITY_MAX_FRAME_BYTES
    ) {
      throw new Error('authority maxFrameBytes is invalid');
    }
    this.socketPath = socketPath;
    this.timeoutMs = timeoutMs;
    this.maxFrameBytes = maxFrameBytes;
  }

  async request({ requestId, envelope }) {
    const socketPath = requirePrivateSocketPath(this.socketPath);
    if (!requestId || typeof requestId !== 'string') {
      throw new Error('authority requestId is required');
    }
    if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) {
      throw new Error('authority envelope is required');
    }
    for (const field of [
      'nonce', 'actorId', 'sessionId', 'action', 'signature',
    ]) {
      if (typeof envelope[field] !== 'string' || !envelope[field]) {
        throw new Error(`authority envelope ${field} is required`);
      }
    }

    const frame = encodeAuthorityFrame({
      schemaVersion:'1.0',
      requestId,
      envelope,
      client:{
        name:'noesar-reference-control-plane',
        version:'0.6.0',
        productionEligible:false,
      },
    }, { maxFrameBytes:this.maxFrameBytes });

    return new Promise((resolvePromise, rejectPromise) => {
      const socket = net.createConnection({ path:socketPath });
      let settled = false;
      let response = Buffer.alloc(0);

      const finish = (error, value) => {
        if (settled) return;
        settled = true;
        socket.destroy();
        if (error) rejectPromise(error);
        else resolvePromise(value);
      };

      socket.setTimeout(this.timeoutMs);
      socket.once('timeout', () => {
        finish(new Error('authority request timed out'));
      });
      socket.once('error', (error) => finish(error));
      socket.once('connect', () => socket.end(frame));
      socket.on('data', (chunk) => {
        response = Buffer.concat([response, chunk]);
        if (response.length > this.maxFrameBytes + 4) {
          finish(new Error('authority response exceeds maximum frame size'));
        }
      });
      socket.once('end', () => {
        try {
          const value = decodeSingleFrame(response, this.maxFrameBytes);
          if (value === null) {
            throw new Error('authority response ended with a partial frame');
          }
          finish(null, validateResponse(value, {
            requestId,
            requestNonce:envelope.nonce,
            actorId:envelope.actorId,
            sessionId:envelope.sessionId,
            action:envelope.action,
          }));
        } catch (error) {
          finish(error);
        }
      });
    });
  }
}

export const AuthorityExternalClientInternals = Object.freeze({
  decodeSingleFrame,
  requirePrivateSocketPath,
  validateResponse,
});
