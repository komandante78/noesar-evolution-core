import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPathPlan } from '../src/path-auth.mjs';
import { evaluateEgress } from '../src/privacy.mjs';
import { authorityStatus } from '../src/authority.mjs';
import { dataPlaneStatus } from '../src/data-plane.mjs';
import {
  AuthorityFrameDecoder,
  encodeAuthorityFrame,
} from '../src/authority-ipc-frame.mjs';
import {
  AuthorityExternalClientInternals,
} from '../src/authority-external-client.mjs';

const root = resolve(fileURLToPath(new URL('../../..', import.meta.url)));
const vectors = JSON.parse(readFileSync(join(root, 'conformance/authority-vectors.json'), 'utf8'));

for (const vector of vectors.cases) {
  test(`conformance ${vector.id}`, () => {
    let actual;
    let workspace;
    if (vector.type === 'path') {
      workspace = mkdtempSync(join(tmpdir(), 'noesar-vector-'));
      actual = createPathPlan(vector.request, workspace);
    } else if (vector.type === 'egress') {
      actual = evaluateEgress(vector.request);
    } else if (vector.type === 'authority') {
      actual = authorityStatus(vector.environment);
    } else if (vector.type === 'data-plane') {
      actual = dataPlaneStatus(vector.environment);
    } else {
      throw new Error(`unknown vector type: ${vector.type}`);
    }
    try {
      for (const [key, value] of Object.entries(vector.expected)) {
        assert.deepEqual(actual[key], value, `${vector.id}:${key}`);
      }
    } finally {
      if (workspace) rmSync(workspace, { recursive:true, force:true });
    }
  });
}


test('authority IPC conformance vector is frame deterministic', () => {
  const vector = vectors.authorityIpc[0];
  const peer = {
    authenticated:true,
    transport:'unix-domain-socket',
    uid:10001,
    pid:4242,
  };
  const decoder = new AuthorityFrameDecoder({ peerIdentity:peer });
  const values = decoder.push(encodeAuthorityFrame(vector.request));
  decoder.finish();
  assert.deepEqual(values, [vector.request]);
  assert.equal(vector.maxFrameBytes, 1024 * 1024);
  assert.equal(vector.serverPeerCredentialsRequired, true);
});

test('authority IPC response vector is binding-valid and non-production', () => {
  const vector = vectors.authorityIpc[0];
  const value = AuthorityExternalClientInternals.validateResponse(
    vector.response,
    {
      requestId:vector.request.requestId,
      requestNonce:vector.request.envelope.nonce,
      actorId:vector.request.envelope.actorId,
      sessionId:vector.request.envelope.sessionId,
      action:vector.request.envelope.action,
    }
  );
  assert.equal(value.productionEligible, false);
  assert.equal(value.serverPeerCredentialsVerified, false);
});

test('PostgreSQL production gate requires seven evidence kinds', () => {
  const vector = vectors.postgresProductionGate[0];
  assert.equal(vector.release, '0.6.0');
  assert.equal(new Set(vector.requiredKinds).size, 7);
  assert.equal(vector.productionReadyWhenAllPresent, true);
  assert.equal(vector.productionReadyWhenOneMissing, false);
});
