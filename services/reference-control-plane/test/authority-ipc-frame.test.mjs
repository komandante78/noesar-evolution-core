import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AUTHORITY_MAX_FRAME_BYTES,
  AuthorityFrameDecoder,
  encodeAuthorityFrame,
  requirePeerIdentity,
} from '../src/authority-ipc-frame.mjs';

const unixPeer = {
  authenticated:true,
  transport:'unix-domain-socket',
  uid:10001,
  pid:4242,
};

test('Unix authenticated peer is accepted', () => {
  const value = requirePeerIdentity(unixPeer, { expectedUid:10001 });
  assert.equal(value.pid, 4242);
});

test('unauthenticated peer is rejected', () => {
  assert.throws(
    () => requirePeerIdentity({ ...unixPeer, authenticated:false }),
    /authenticated peer/
  );
});

test('Unix UID mismatch is rejected', () => {
  assert.throws(
    () => requirePeerIdentity(unixPeer, { expectedUid:999 }),
    /uid mismatch/
  );
});

test('Windows named-pipe SID is accepted', () => {
  const value = requirePeerIdentity({
    authenticated:true,
    transport:'windows-named-pipe',
    sid:'S-1-5-21-test',
  }, { expectedSid:'S-1-5-21-test' });
  assert.equal(value.transport, 'windows-named-pipe');
});

test('frame round-trip is deterministic', () => {
  const decoder = new AuthorityFrameDecoder({ peerIdentity:unixPeer });
  const values = decoder.push(encodeAuthorityFrame({ b:2, a:1 }));
  assert.deepEqual(values, [{ a:1, b:2 }]);
  decoder.finish();
});

test('partial frame is buffered', () => {
  const frame = encodeAuthorityFrame({ value:'test' });
  const decoder = new AuthorityFrameDecoder({ peerIdentity:unixPeer });
  assert.deepEqual(decoder.push(frame.subarray(0, 5)), []);
  assert.deepEqual(decoder.push(frame.subarray(5)), [{ value:'test' }]);
  decoder.finish();
});

test('multiple frames in one chunk are decoded', () => {
  const decoder = new AuthorityFrameDecoder({ peerIdentity:unixPeer });
  const chunk = Buffer.concat([
    encodeAuthorityFrame({ id:1 }),
    encodeAuthorityFrame({ id:2 }),
  ]);
  assert.deepEqual(decoder.push(chunk), [{ id:1 }, { id:2 }]);
});

test('oversized frame is rejected', () => {
  assert.throws(
    () => encodeAuthorityFrame(
      { payload:'x'.repeat(256) },
      { maxFrameBytes:32 }
    ),
    /size is invalid/
  );
});

test('invalid frame length is rejected before allocation', () => {
  const decoder = new AuthorityFrameDecoder({
    peerIdentity:unixPeer,
    maxFrameBytes:32,
  });
  const header = Buffer.alloc(4);
  header.writeUInt32BE(33, 0);
  assert.throws(() => decoder.push(header), /length is invalid/);
});

test('partial stream is rejected on finish', () => {
  const decoder = new AuthorityFrameDecoder({ peerIdentity:unixPeer });
  const frame = encodeAuthorityFrame({ value:'test' });
  decoder.push(frame.subarray(0, frame.length - 1));
  assert.throws(() => decoder.finish(), /partial frame/);
});

test('maximum default frame is one MiB', () => {
  assert.equal(AUTHORITY_MAX_FRAME_BYTES, 1024 * 1024);
});
