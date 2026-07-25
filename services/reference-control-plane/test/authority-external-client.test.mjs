import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import {
  chmodSync,
  lstatSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import { join, resolve } from 'node:path';
import {
  ExternalAuthorityClient,
  AuthorityExternalClientInternals,
} from '../src/authority-external-client.mjs';
import { encodeAuthorityFrame } from '../src/authority-ipc-frame.mjs';

const envelope = Object.freeze({
  schemaVersion:'1.1',
  actorId:'owner-001',
  sessionId:'session-001',
  action:'authority.health',
  payload:{},
  nonce:'0123456789abcdef',
  issuedAt:1_800_000_000,
  expiresAt:1_800_000_020,
  signature:'test-signature',
});

async function withServer(handler, operation) {
  const root = mkdtempSync(join(os.tmpdir(), 'noesar-authority-client-'));
  chmodSync(root, 0o700);
  const socketPath = join(root, 'authority.sock');
  const server = net.createServer(handler);
  await new Promise((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(socketPath, resolveListen);
  });
  try {
    return await operation(socketPath);
  } finally {
    await new Promise((resolveClose) => server.close(resolveClose));
    rmSync(root, { recursive:true, force:true });
  }
}

function response(overrides = {}) {
  return {
    schemaVersion:'1.0',
    requestId:'request-001',
    requestNonce:envelope.nonce,
    actorId:envelope.actorId,
    sessionId:envelope.sessionId,
    action:envelope.action,
    decision:'allow',
    authority:'rust-canonical-candidate',
    productionReady:false,
    ...overrides,
  };
}

test('constructor validates timeout', () => {
  assert.throws(
    () => new ExternalAuthorityClient({
      socketPath:'/tmp/a.sock',
      timeoutMs:10,
    }),
    /timeoutMs/
  );
});

test('constructor validates frame maximum', () => {
  assert.throws(
    () => new ExternalAuthorityClient({
      socketPath:'/tmp/a.sock',
      maxFrameBytes:100,
    }),
    /maxFrameBytes/
  );
});

test('socket path must be absolute', () => {
  assert.throws(
    () => AuthorityExternalClientInternals.requirePrivateSocketPath('relative.sock'),
    /absolute/
  );
});

test('regular file is rejected as authority endpoint', () => {
  const root = mkdtempSync(join(os.tmpdir(), 'noesar-authority-file-'));
  const path = join(root, 'authority.sock');
  writeFileSync(path, 'not a socket');
  try {
    assert.throws(
      () => AuthorityExternalClientInternals.requirePrivateSocketPath(path),
      /Unix-domain socket/
    );
  } finally {
    rmSync(root, { recursive:true, force:true });
  }
});

test('symlink authority endpoint is rejected', async () => {
  await withServer(() => {}, async (socketPath) => {
    const link = join(resolve(socketPath, '..'), 'authority-link.sock');
    symlinkSync(socketPath, link);
    assert.equal(lstatSync(link).isSymbolicLink(), true);
    assert.throws(
      () => AuthorityExternalClientInternals.requirePrivateSocketPath(link),
      /symlink/
    );
  });
});

test('valid framed response is bound and remains non-production', async () => {
  await withServer((socket) => {
    socket.on('data', () => {
      socket.end(encodeAuthorityFrame(response()));
    });
  }, async (socketPath) => {
    const value = await new ExternalAuthorityClient({ socketPath }).request({
      requestId:'request-001',
      envelope,
    });
    assert.equal(value.decision, 'allow');
    assert.equal(value.serverPeerCredentialsVerified, false);
    assert.equal(value.productionEligible, false);
  });
});

test('request nonce mismatch is rejected', async () => {
  await withServer((socket) => {
    socket.on('data', () => {
      socket.end(encodeAuthorityFrame(response({
        requestNonce:'different-nonce',
      })));
    });
  }, async (socketPath) => {
    await assert.rejects(
      new ExternalAuthorityClient({ socketPath }).request({
        requestId:'request-001',
        envelope,
      }),
      /requestNonce binding mismatch/
    );
  });
});

test('actor binding mismatch is rejected', async () => {
  await withServer((socket) => {
    socket.on('data', () => {
      socket.end(encodeAuthorityFrame(response({ actorId:'other' })));
    });
  }, async (socketPath) => {
    await assert.rejects(
      new ExternalAuthorityClient({ socketPath }).request({
        requestId:'request-001',
        envelope,
      }),
      /actorId binding mismatch/
    );
  });
});

test('production-ready response claim is rejected', async () => {
  await withServer((socket) => {
    socket.on('data', () => {
      socket.end(encodeAuthorityFrame(response({ productionReady:true })));
    });
  }, async (socketPath) => {
    await assert.rejects(
      new ExternalAuthorityClient({ socketPath }).request({
        requestId:'request-001',
        envelope,
      }),
      /invalid readiness claim/
    );
  });
});

test('trailing response bytes are rejected', async () => {
  await withServer((socket) => {
    socket.on('data', () => {
      socket.end(Buffer.concat([
        encodeAuthorityFrame(response()),
        Buffer.from('trailing'),
      ]));
    });
  }, async (socketPath) => {
    await assert.rejects(
      new ExternalAuthorityClient({ socketPath }).request({
        requestId:'request-001',
        envelope,
      }),
      /trailing bytes/
    );
  });
});

test('partial response frame is rejected', async () => {
  await withServer((socket) => {
    socket.on('data', () => {
      const frame = encodeAuthorityFrame(response());
      socket.end(frame.subarray(0, frame.length - 2));
    });
  }, async (socketPath) => {
    await assert.rejects(
      new ExternalAuthorityClient({ socketPath }).request({
        requestId:'request-001',
        envelope,
      }),
      /partial frame/
    );
  });
});

test('invalid response decision is rejected', async () => {
  await withServer((socket) => {
    socket.on('data', () => {
      socket.end(encodeAuthorityFrame(response({ decision:'maybe' })));
    });
  }, async (socketPath) => {
    await assert.rejects(
      new ExternalAuthorityClient({ socketPath }).request({
        requestId:'request-001',
        envelope,
      }),
      /decision is invalid/
    );
  });
});
