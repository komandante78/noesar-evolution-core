// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The proof that somebody controls the installation, used when the recovery codes are gone too
// — the situation that produced D-0369 in the first place. Its whole value rests on three
// properties, and each is asserted rather than described: the token reaches the filesystem and
// nothing else, only the owning account can read it, and it works once.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, statSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mintProof, verifyProof, proofPath, PROOF_TTL_MS } from '../src/owner-recovery.mjs';

const install = () => mkdtempSync(join(tmpdir(), 'noesar-proof-'));
const tokenOnDisk = (workspace) => readFileSync(proofPath(workspace), 'utf8').trim();

describe('what the network gets, and what it does not', () => {
  test('the response carries a fingerprint and never the token', () => {
    const workspace = install();
    const minted = mintProof({ workspace });
    assert.match(minted.fingerprint, /^[0-9a-f]{12}$/);
    assert.ok(!JSON.stringify(minted).includes(tokenOnDisk(workspace)),
      'a proof that travels back over the wire proves nothing about controlling the host');
  });

  test('the file is readable only by the account the product runs as', () => {
    const workspace = install();
    mintProof({ workspace });
    assert.equal(statSync(proofPath(workspace)).mode & 0o777, 0o600,
      'anything wider and "whoever can read this is the installer" stops being true');
  });
});

describe('what it accepts', () => {
  test('the token from the file, and nothing else', () => {
    const workspace = install();
    mintProof({ workspace });
    assert.equal(verifyProof({ workspace, presented: 'not-the-token' }).accepted, false);
    assert.equal(verifyProof({ workspace, presented: '' }).accepted, false);
    assert.equal(verifyProof({ workspace, presented: tokenOnDisk(workspace) }).accepted, true);
  });

  test('surrounding whitespace does not defeat a correct token', () => {
    const workspace = install();
    mintProof({ workspace });
    assert.equal(verifyProof({ workspace, presented: `  ${tokenOnDisk(workspace)}\n` }).accepted, true,
      'it is retyped from a terminal, where a trailing newline is the normal case');
  });

  test('nothing at all when none was minted', () => {
    assert.equal(verifyProof({ workspace: install(), presented: 'anything' }).accepted, false);
  });
});

describe('it works once, and not for long', () => {
  test('a used proof is consumed, so a terminal history opens nothing next week', () => {
    const workspace = install();
    mintProof({ workspace });
    const token = tokenOnDisk(workspace);
    assert.equal(verifyProof({ workspace, presented: token }).accepted, true);
    assert.equal(existsSync(proofPath(workspace)), false, 'success must remove the file');
    assert.equal(verifyProof({ workspace, presented: token }).accepted, false);
  });

  test('an expired proof is refused even though the bytes still match', () => {
    const workspace = install();
    mintProof({ workspace });
    const token = tokenOnDisk(workspace);
    const stale = new Date(Date.now() - PROOF_TTL_MS - 60_000);
    utimesSync(proofPath(workspace), stale, stale);
    const result = verifyProof({ workspace, presented: token });
    assert.equal(result.accepted, false);
    assert.equal(result.reason, 'expired');
  });

  test('minting again replaces the previous proof rather than adding one', () => {
    // Two live proofs on disk would be strictly worse than refusing the second request.
    const workspace = install();
    mintProof({ workspace });
    const first = tokenOnDisk(workspace);
    mintProof({ workspace });
    assert.notEqual(tokenOnDisk(workspace), first);
    assert.equal(verifyProof({ workspace, presented: first }).accepted, false);
  });
});
