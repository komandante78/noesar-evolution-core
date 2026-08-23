// SPDX-License-Identifier: AGPL-3.0-or-later
//
// `D-0649`/`D-0651` item 2 — the image branch's caption fallback. `tesseract` is not installed
// on this host or in CI (measured — `command -v tesseract` finds nothing), so the branch
// normally never gets past `extractor_unavailable`; `runImpl` is injected to simulate both an
// OCR success-with-nothing-found and an OCR-unavailable case, so this proves the WIRING without
// depending on a package this suite cannot assume. `captionImage()`'s own selection/fallback
// logic is proven by `vision-caption.test.mjs`; this file does not re-test it — `captionImpl`
// here is a direct fake standing in for the whole `vision-caption.mjs` call.

import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileExtractor } from '../src/ai-workspace/file-extractors.mjs';

const ocrEmpty = { available: true, ok: true, stdout: '' };
const ocrUnavailable = { available: false, ok: false, error: 'tesseract is not installed.' };
const ocrFoundText = { available: true, ok: true, stdout: 'printed words in the image' };

function withExtractor({ captionImpl, runImpl }, run) {
  const dir = mkdtempSync(join(tmpdir(), 'extractor-caption-'));
  return (async () => {
    try { return await run(new FileExtractor({ blobRoot: dir, captionImpl, runImpl })); }
    finally { rmSync(dir, { recursive: true, force: true }); }
  })();
}

const uploadImage = (extractor) => extractor.extract({ name: 'photo.png', mimeType: 'image/png', bytesBase64: Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString('base64') });

describe('image caption fallback wiring', () => {
  test('OCR found real text — the caption fallback is never invoked', async () => {
    await withExtractor({
      runImpl: () => ocrFoundText,
      captionImpl: async () => { throw new Error('must not be called when OCR already found text'); },
    }, async (extractor) => {
      const result = await uploadImage(extractor);
      assert.equal(result.status, 'complete');
      assert.equal(result.text, 'printed words in the image');
      assert.equal(result.extractor, 'tesseract-ocr');
    });
  });

  test('OCR ran and found nothing, a caption succeeds — extraction completes with the description', async () => {
    await withExtractor({
      runImpl: () => ocrEmpty,
      captionImpl: async ({ bytes, mimeType }) => {
        assert.ok(bytes instanceof Uint8Array && bytes.length > 0);
        assert.equal(mimeType, 'image/png');
        return { configured: true, text: 'a mountain landscape at sunset', model: 'llava', providerId: 'p1' };
      },
    }, async (extractor) => {
      const result = await uploadImage(extractor);
      assert.equal(result.status, 'complete');
      assert.equal(result.text, 'a mountain landscape at sunset');
      assert.equal(result.extractor, 'tesseract-ocr+vision-caption');
      assert.equal(result.warning, null);
      assert.equal(result.metadata.caption.providerId, 'p1');
    });
  });

  test('tesseract is unavailable, a caption succeeds — reported as vision-caption alone', async () => {
    await withExtractor({
      runImpl: () => ocrUnavailable,
      captionImpl: async () => ({ configured: true, text: 'a red bicycle', model: 'llava', providerId: 'p1' }),
    }, async (extractor) => {
      const result = await uploadImage(extractor);
      assert.equal(result.status, 'complete');
      assert.equal(result.text, 'a red bicycle');
      assert.equal(result.extractor, 'vision-caption');
    });
  });

  test('OCR found nothing, no vision-capable provider is configured — declared as a gap, not silently complete', async () => {
    await withExtractor({
      runImpl: () => ocrEmpty,
      captionImpl: async () => ({ configured: false, text: '', reason: 'no enabled provider is declared vision-capable (Settings → Providers)' }),
    }, async (extractor) => {
      const result = await uploadImage(extractor);
      assert.equal(result.status, 'caption_required');
      assert.match(result.warning, /no enabled provider is declared vision-capable/);
      assert.equal(result.text, '');
    });
  });

  test('OCR found nothing, every vision-capable provider failed — reported, metadata not lost', async () => {
    await withExtractor({
      runImpl: () => ocrEmpty,
      captionImpl: async () => ({ configured: true, failed: true, text: '', failures: [{ providerId: 'p1', error: 'upstream refused' }] }),
    }, async (extractor) => {
      const result = await uploadImage(extractor);
      assert.equal(result.status, 'caption_failed');
      assert.match(result.warning, /No text found by OCR/);
      assert.match(result.warning, /upstream refused/);
    });
  });

  test('no captionImpl wired at all — unchanged from before this phase', async () => {
    await withExtractor({ runImpl: () => ocrEmpty, captionImpl: null }, async (extractor) => {
      const result = await uploadImage(extractor);
      assert.equal(result.status, 'complete');
      assert.equal(result.text, '');
      assert.equal(result.extractor, 'tesseract-ocr');
    });
  });
});
