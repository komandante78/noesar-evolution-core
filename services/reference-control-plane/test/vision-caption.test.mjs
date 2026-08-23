// SPDX-License-Identifier: AGPL-3.0-or-later
//
// `D-0649`/`D-0651`, `§4#10` item 2 — the image-caption fallback. `visionCapable` on a provider
// profile is the new concept (`provider-gateway.mjs`); this file proves the selection, the two
// supported wire shapes, and the fallback-and-report-honestly behaviour of `captionImage()`
// against injected fakes — no real provider, no real HTTP call, no store.

import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { captionImage, visionCapableProfiles, visionContentFor, SUPPORTED_VISION_STYLES, CAPTION_PROMPT } from '../src/ai-workspace/vision-caption.mjs';

describe('which providers may be asked to caption an image', () => {
  test('disabled and non-vision-capable providers are excluded, priority order is kept', () => {
    const profiles = [
      { id: 'a', enabled: true, visionCapable: true, apiStyle: 'openai-chat', priority: 50 },
      { id: 'b', enabled: false, visionCapable: true, apiStyle: 'openai-chat', priority: 10 },
      { id: 'c', enabled: true, visionCapable: false, apiStyle: 'anthropic-messages', priority: 5 },
      { id: 'd', enabled: true, visionCapable: true, apiStyle: 'anthropic-messages', priority: 20 },
    ];
    assert.deepEqual(visionCapableProfiles(profiles).map((p) => p.id), ['d', 'a']);
  });

  test('a vision-capable, enabled provider of an unsupported apiStyle is excluded, not guessed at', () => {
    // `openai-responses` — the only style this file's own module comment names as unverifiable
    // without a live account, and therefore never claimed as supported.
    assert.deepEqual(SUPPORTED_VISION_STYLES.includes('openai-responses'), false);
    const profiles = [{ id: 'x', enabled: true, visionCapable: true, apiStyle: 'openai-responses', priority: 1 }];
    assert.deepEqual(visionCapableProfiles(profiles), []);
  });

  test('no profiles at all is the empty list, not a throw', () => {
    assert.deepEqual(visionCapableProfiles(undefined), []);
    assert.deepEqual(visionCapableProfiles([]), []);
  });
});

describe('the wire shape each apiStyle needs', () => {
  test('openai-chat carries an image_url data URL', () => {
    const content = visionContentFor('openai-chat', { text: 'describe it', base64: 'QUJD', mimeType: 'image/png' });
    assert.deepEqual(content, [
      { type: 'text', text: 'describe it' },
      { type: 'image_url', image_url: { url: 'data:image/png;base64,QUJD' } },
    ]);
  });

  test('anthropic-messages carries a base64 image source', () => {
    const content = visionContentFor('anthropic-messages', { text: 'describe it', base64: 'QUJD', mimeType: 'image/jpeg' });
    assert.deepEqual(content, [
      { type: 'text', text: 'describe it' },
      { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'QUJD' } },
    ]);
  });
});

describe('captionImage()', () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

  test('no vision-capable provider configured — reported as unconfigured, complete() never called', async () => {
    const result = await captionImage({
      profiles: [{ id: 'a', enabled: false, visionCapable: true, apiStyle: 'openai-chat' }],
      complete: () => { throw new Error('must not be called'); },
      bytes: png, mimeType: 'image/png',
    });
    assert.equal(result.configured, false);
    assert.match(result.reason, /no enabled provider/);
    assert.equal(result.text, '');
  });

  test('the configured provider succeeds — text, model and providerId are reported', async () => {
    let seenProfileId = null; let seenRequest = null;
    const result = await captionImage({
      profiles: [{ id: 'p1', enabled: true, visionCapable: true, apiStyle: 'openai-chat', defaultModel: 'llava', priority: 10 }],
      complete: async (profileId, request) => { seenProfileId = profileId; seenRequest = request; return { text: '  a red bicycle leaning on a brick wall  ' }; },
      bytes: png, mimeType: 'image/png',
    });
    assert.equal(result.configured, true);
    assert.equal(result.text, 'a red bicycle leaning on a brick wall');
    assert.equal(result.model, 'llava');
    assert.equal(result.providerId, 'p1');
    assert.equal(seenProfileId, 'p1');
    assert.equal(seenRequest.model, 'llava');
    assert.equal(seenRequest.messages[0].role, 'user');
    assert.equal(seenRequest.messages[0].content[0].text, CAPTION_PROMPT);
  });

  test('the first candidate fails, the second succeeds — the same fallback shape chat already has', async () => {
    const attempts = [];
    const result = await captionImage({
      profiles: [
        { id: 'first', enabled: true, visionCapable: true, apiStyle: 'openai-chat', priority: 1 },
        { id: 'second', enabled: true, visionCapable: true, apiStyle: 'anthropic-messages', priority: 2 },
      ],
      complete: async (profileId) => {
        attempts.push(profileId);
        if (profileId === 'first') throw new Error('provider unreachable');
        return { text: 'a caption from the second provider' };
      },
      bytes: png, mimeType: 'image/png',
    });
    assert.deepEqual(attempts, ['first', 'second']);
    assert.equal(result.configured, true);
    assert.equal(result.providerId, 'second');
    assert.equal(result.text, 'a caption from the second provider');
  });

  test('every candidate fails or answers empty — reported failed, never invented', async () => {
    const result = await captionImage({
      profiles: [
        { id: 'a', enabled: true, visionCapable: true, apiStyle: 'openai-chat', priority: 1 },
        { id: 'b', enabled: true, visionCapable: true, apiStyle: 'openai-chat', priority: 2 },
      ],
      complete: async (profileId) => { if (profileId === 'a') throw new Error('502 upstream refused'); return { text: '   ' }; },
      bytes: png, mimeType: 'image/png',
    });
    assert.equal(result.configured, true);
    assert.equal(result.failed, true);
    assert.equal(result.text, '');
    assert.equal(result.failures.length, 2);
    assert.match(result.failures[0].error, /502 upstream refused/);
    assert.match(result.failures[1].error, /no caption text/);
  });

  test('no way to reach a provider at all is reported, not thrown', async () => {
    const result = await captionImage({
      profiles: [{ id: 'a', enabled: true, visionCapable: true, apiStyle: 'openai-chat' }],
      complete: undefined,
      bytes: png, mimeType: 'image/png',
    });
    assert.equal(result.configured, false);
    assert.match(result.reason, /no way to reach a provider/);
  });
});
