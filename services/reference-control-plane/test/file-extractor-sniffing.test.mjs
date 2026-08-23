// SPDX-License-Identifier: AGPL-3.0-or-later
//
// `F4-011`, closed. The register carried it OPEN and ACCEPTED since phase 4:
//
//   > extraction is routed by filename extension and declared MIME type, with no content sniffing
//   > SEC-24: PDF bytes declared text/plain are stored as text; text declared application/pdf
//   >         reaches pdftotext and fails extraction
//
// Both halves of SEC-24 are driven below against the real extractor. What is being defended is
// not "sniffing exists" but the ORDER OF AUTHORITY: bytes over declaration where the bytes speak,
// declaration where they do not, and the disagreement written down either way.
//
// The environment note that matters when reading a failure here: `pdftotext`, `unzip` and
// `tesseract` are not installed in this test environment, so those branches end in
// `extractor_unavailable`. That is the branch being ASSERTED — which extractor was chosen — and
// not whether the tool then succeeded. Asserting extracted text would make this suite a test of
// the host's package list.

import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileExtractor, sniffContentType, looksLikeText } from '../src/ai-workspace/file-extractors.mjs';

const b64 = (value) => Buffer.from(value, 'latin1').toString('base64');
const bytesOf = (...values) => Buffer.from(values).toString('base64');

async function withExtractor(run) {
  const dir = mkdtempSync(join(tmpdir(), 'extractor-sniff-'));
  try { return await run(new FileExtractor({ blobRoot: dir })); } finally { rmSync(dir, { recursive: true, force: true }); }
}

describe('what the bytes say', () => {
  test('the signatures that matter are recognised', () => {
    assert.equal(sniffContentType(Buffer.from('%PDF-1.7\n')), 'pdf');
    assert.equal(sniffContentType(Buffer.from([0x50, 0x4b, 0x03, 0x04])), 'zip');
    assert.equal(sniffContentType(Buffer.from([0x89, 0x50, 0x4e, 0x47])), 'png');
    assert.equal(sniffContentType(Buffer.from([0xff, 0xd8, 0xff, 0xe0])), 'jpeg');
    assert.equal(sniffContentType(Buffer.from([0x1f, 0x8b, 0x08, 0x00])), 'gzip');
    assert.equal(sniffContentType(Buffer.from([0x7f, 0x45, 0x4c, 0x46])), 'elf');
    assert.equal(sniffContentType(Buffer.from('MZ\x90\x00', 'latin1')), 'pe');
  });

  test('RIFF is not one format, and the four bytes after it are what decide', () => {
    // A guard that stopped at `RIFF` would call a WAV a WEBP. Both are RIFF containers.
    assert.equal(sniffContentType(Buffer.from('RIFF____WEBPVP8 ', 'latin1')), 'webp');
    assert.equal(sniffContentType(Buffer.from('RIFF____WAVEfmt ', 'latin1')), 'wav');
  });

  test('prose has no signature, and is reported as having none', () => {
    // Important that this is `unknown` and not `text`: the declared type keeps its say where the
    // bytes are silent, and a sniffer that claimed everything would be the second guesser this
    // change exists to avoid.
    assert.equal(sniffContentType(Buffer.from('just some words')), 'unknown');
    assert.equal(sniffContentType(Buffer.from('ab')), 'unknown', 'too short to judge');
  });

  test('text is recognised by what it is NOT', () => {
    assert.equal(looksLikeText(Buffer.from('perfectly ordinary prose')), true);
    assert.equal(looksLikeText(Buffer.from('accenti: perché città')), true);
    assert.equal(looksLikeText(Buffer.from([0x68, 0x00, 0x69])), false, 'a NUL says it is not text');
    assert.equal(looksLikeText(Buffer.from([0xff, 0xfe, 0xfd, 0xfc])), false, 'not valid UTF-8');
  });
});

describe('SEC-24, both halves, against the real extractor', () => {
  test('FIRST HALF: PDF bytes declared text/plain are no longer stored as text', async () => {
    await withExtractor(async (extractor) => {
      const result = await extractor.extract({ name: 'notes.txt', mimeType: 'text/plain', bytesBase64: b64('%PDF-1.4\n1 0 obj\n') });
      assert.equal(result.detectedType, 'pdf');
      assert.equal(result.extractor, 'pdftotext', 'the bytes did not win');
      assert.equal(result.text, '', 'raw PDF bytes were stored as prose');
      assert.deepEqual(result.metadata.typeMismatch, { declared: 'text/plain', detected: 'pdf' });
    });
  });

  test('SECOND HALF: text declared application/pdf no longer reaches pdftotext', async () => {
    await withExtractor(async (extractor) => {
      const result = await extractor.extract({ name: 'report.pdf', mimeType: 'application/pdf', bytesBase64: b64('this is just prose') });
      assert.equal(result.extractor, 'utf8');
      assert.equal(result.status, 'complete');
      assert.equal(result.text, 'this is just prose');
      assert.deepEqual(result.metadata.typeMismatch, { declared: 'application/pdf', detected: 'unknown' });
    });
  });

  test('an honest file produces no mismatch at all', async () => {
    // The other half of a guard: it must be quiet when nothing is wrong, or the warning stops
    // meaning anything.
    await withExtractor(async (extractor) => {
      const result = await extractor.extract({ name: 'notes.txt', mimeType: 'text/plain', bytesBase64: b64('ordinary notes') });
      assert.equal(result.status, 'complete');
      assert.equal(result.metadata.typeMismatch, undefined);
      assert.equal(result.warning, null);
    });
  });

  test('an image hiding behind .txt is sent to the image path', async () => {
    await withExtractor(async (extractor) => {
      const result = await extractor.extract({ name: 'x.txt', mimeType: 'text/plain', bytesBase64: bytesOf(0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10, 1, 2, 3, 4) });
      assert.equal(result.detectedType, 'png');
      assert.equal(result.extractor, 'tesseract-ocr');
    });
  });
});

describe('the container is not the contents', () => {
  test('a zip named .docx still takes the Office path', async () => {
    // Every Office file IS a zip. A sniffer that routed on the signature alone would send every
    // document to the generic archive reader and lose its text — the fix breaking the thing it
    // was meant to protect.
    await withExtractor(async (extractor) => {
      const result = await extractor.extract({
        name: 'letter.docx',
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        bytesBase64: bytesOf(0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0),
      });
      assert.equal(result.detectedType, 'zip');
      assert.equal(result.extractor, 'office-xml');
      assert.equal(result.metadata.typeMismatch, undefined, 'a docx IS a zip — that is not a disagreement');
    });
  });

  test('a plain zip named .docx is still read as an archive when nothing claims Office', async () => {
    await withExtractor(async (extractor) => {
      const result = await extractor.extract({ name: 'bundle.zip', mimeType: 'application/octet-stream', bytesBase64: bytesOf(0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0) });
      assert.equal(result.extractor, 'safe-zip-text');
    });
  });
});

describe('an executable is named and refused', () => {
  test('an ELF called notes.txt is not extracted from at all', async () => {
    // Nothing here would have EXECUTED it — but storing its bytes as prose puts them in a
    // knowledge base, and handing it to unzip is a decision nobody made.
    await withExtractor(async (extractor) => {
      const result = await extractor.extract({ name: 'notes.txt', mimeType: 'text/plain', bytesBase64: b64('\x7fELF\x02\x01\x01\x00payload') });
      assert.equal(result.status, 'unsupported');
      assert.equal(result.extractor, 'none');
      assert.equal(result.text, '');
      assert.match(result.warning, /Linux ELF executable/);
    });
  });

  test('a Windows executable is refused the same way', async () => {
    await withExtractor(async (extractor) => {
      const result = await extractor.extract({ name: 'setup.pdf', mimeType: 'application/pdf', bytesBase64: b64('MZ\x90\x00\x03payload') });
      assert.equal(result.status, 'unsupported');
      assert.match(result.warning, /Windows PE executable/);
    });
  });
});

describe('what is reported back', () => {
  test('the record keeps the caller\'s declaration AND what was found', async () => {
    // Rewriting the caller's statement in the record would hide the disagreement the record
    // exists to surface — a source that says `application/pdf` and holds prose is a fact worth
    // being able to find later.
    await withExtractor(async (extractor) => {
      const result = await extractor.extract({ name: 'report.pdf', mimeType: 'application/pdf', bytesBase64: b64('prose') });
      assert.equal(result.mimeType, 'application/pdf', 'the declaration was overwritten');
      assert.equal(result.extension, '.pdf');
      assert.equal(result.detectedType, 'unknown');
      assert.equal(result.metadata.typeMismatch.declared, 'application/pdf');
    });
  });
});
