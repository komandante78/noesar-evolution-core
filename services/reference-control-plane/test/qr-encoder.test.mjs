// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The QR encoder is hand-written, so it is verified rather than trusted.
//
// Two bugs were found here by comparing against libqrencode, and neither was visible
// by inspection: the format-information bits were placed in reverse order, and the
// Reed-Solomon generator polynomial had its shift and its alpha term swapped, which
// yields correct DATA codewords and wrong ERROR-CORRECTION codewords. Both produce a
// symbol that looks exactly like a QR code and does not decode.
//
// Where libqrencode is installed, these tests compare module-for-module against it.
// Where it is not, they fall back to structural invariants and SAY SO — a skipped
// comparison is reported, never quietly passed.
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { encodeQr, qrSvg } from '../../../apps/webui-static/qr.js';

function haveReference() {
  try { execFileSync('qrencode', ['--version'], { stdio: 'ignore' }); return true; }
  catch { return false; }
}
const REFERENCE = haveReference();

/** libqrencode's module grid for `text` at `version`, byte mode, level M. */
function referenceGrid(text, version) {
  const out = execFileSync('qrencode',
    ['-8', '-l', 'M', '-v', String(version), '-m', '0', '-t', 'ASCII', '-o', '-', text],
    { encoding: 'utf8' });
  return out.split('\n').filter((line) => line.length > 0).map((line) => {
    const row = [];
    for (let i = 0; i < line.length; i += 2) row.push(line[i] === ' ' ? 0 : 1);
    return row;
  });
}

describe('encoder matches the reference implementation', () => {
  const payloads = [
    ['short text', 'HELLO WORLD'],
    ['url', 'https://example.invalid/x'],
    ['compact key uri', 'otpauth://totp/owner?secret=JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP&issuer=NOESAR%20Evolution'],
    ['long username', `otpauth://totp/${'u'.repeat(20)}?secret=MZXW6YTBOI7EY3ZBMZXW6YTBOI7EY3ZB&issuer=NOESAR%20Evolution`],
    ['at capacity', 'X'.repeat(106)],
    ['typical enrolment', `otpauth://totp/owner?secret=${'B'.repeat(32)}&issuer=NOESAR%20Evolution`],
  ];

  for (const [name, text] of payloads) {
    test(`${name} — every module identical to libqrencode`, { skip: REFERENCE ? false : 'qrencode not installed' }, () => {
      const mine = encodeQr(text);
      const reference = referenceGrid(text, mine.version);
      assert.equal(reference.length, mine.size, 'symbol size');
      assert.equal(reference[0].length, mine.size, 'symbol width');
      // The comparison is "the reference equals one of our eight masks", not "it equals
      // the mask we happened to pick". Which mask is used is a readability heuristic and
      // is recorded in the format information, so any of the eight decodes to the same
      // data; the two implementations legitimately score them differently. What must
      // match exactly is everything else: bitstream, error correction, interleaving and
      // placement. Demanding the same mask would fail a correct encoder.
      let matched = null;
      let closest = Infinity;
      for (let mask = 0; mask < 8; mask += 1) {
        const candidate = encodeQr(text, { forceMask: mask });
        let differing = 0;
        for (let row = 0; row < candidate.size; row += 1) {
          for (let col = 0; col < candidate.size; col += 1) {
            if (reference[row][col] !== candidate.modules[row][col]) differing += 1;
          }
        }
        closest = Math.min(closest, differing);
        if (differing === 0) { matched = mask; break; }
      }
      assert.notEqual(matched, null,
        `no mask reproduced libqrencode at version ${mine.version}; closest was ${closest} differing modules`);
    });
  }
});

describe('structural invariants', () => {
  const grid = encodeQr('otpauth://totp/owner?secret=JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP&issuer=NOESAR%20Evolution');

  test('size follows the version formula', () => {
    assert.equal(grid.size, grid.version * 4 + 17);
  });

  test('three finder patterns are present and correct', () => {
    const { modules, size } = grid;
    for (const [r0, c0] of [[0, 0], [0, size - 7], [size - 7, 0]]) {
      assert.equal(modules[r0][c0], 1);
      assert.equal(modules[r0 + 3][c0 + 3], 1, 'finder core');
      assert.equal(modules[r0 + 1][c0 + 1], 0, 'finder inner ring');
      assert.equal(modules[r0 + 6][c0 + 6], 1);
    }
  });

  test('timing patterns alternate', () => {
    for (let i = 8; i < grid.size - 8; i += 1) {
      assert.equal(grid.modules[6][i], i % 2 === 0 ? 1 : 0, `horizontal timing at ${i}`);
      assert.equal(grid.modules[i][6], i % 2 === 0 ? 1 : 0, `vertical timing at ${i}`);
    }
  });

  test('the dark module is set', () => {
    assert.equal(grid.modules[grid.size - 8][8], 1);
  });

  test('every module is 0 or 1 — a null means a cell was never written', () => {
    for (let r = 0; r < grid.size; r += 1) {
      for (let c = 0; c < grid.size; c += 1) {
        assert.ok(grid.modules[r][c] === 0 || grid.modules[r][c] === 1, `module ${r},${c} is ${grid.modules[r][c]}`);
      }
    }
  });
});

describe('declared operating range', () => {
  test('refuses a payload beyond the verified capacity instead of emitting a broken symbol', () => {
    assert.throws(() => encodeQr('X'.repeat(107)), /exceeds this encoder's verified range/);
  });

  test('every version it will emit is one that was verified', () => {
    for (const length of [1, 20, 40, 60, 80, 106]) {
      const result = encodeQr('X'.repeat(length));
      assert.ok(result.version >= 1 && result.version <= 6,
        `version ${result.version} is outside the verified 1-6 range`);
    }
  });

  test('a typical enrolment URI fits, and the boundary is known rather than assumed', () => {
    const uriFor = (username) => `otpauth://totp/${username}?secret=${'A'.repeat(32)}&issuer=NOESAR%20Evolution`;
    // The fixed part of the URI is 81 bytes, so the username budget is 25 characters.
    assert.doesNotThrow(() => encodeQr(uriFor('o'.repeat(25))), 'a 25-character username must fit');
    // normalizeUsername allows up to 64 characters, so a long username genuinely does
    // NOT fit the verified range. That is a real limit, recorded rather than hidden:
    // the interface falls back to the manual key and says why. See finding F4W-005.
    assert.throws(() => encodeQr(uriFor('o'.repeat(64))), /exceeds this encoder's verified range/);
  });
});

describe('SVG rendering', () => {
  const uri = 'otpauth://totp/owner?secret=JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP&issuer=NOESAR%20Evolution';

  test('is self-contained: no network reference of any kind', () => {
    const svg = qrSvg(uri);
    assert.ok(svg.startsWith('<svg'));
    assert.equal(/https?:\/\/(?!www\.w3\.org)/.test(svg), false, 'no remote URL may appear');
    assert.equal(svg.includes('<image'), false, 'no external image');
    assert.equal(svg.includes('<script'), false, 'no script');
    assert.equal(svg.includes('href'), false, 'no link of any kind');
  });

  test('includes the quiet zone the specification requires', () => {
    const svg = qrSvg(uri, { quietZone: 4 });
    const { size } = encodeQr(uri);
    assert.ok(svg.includes(`viewBox="0 0 ${size + 8} ${size + 8}"`), 'four modules of quiet zone on each side');
  });

  test('does not leak the secret into the accessible label', () => {
    const svg = qrSvg(uri, { title: 'Authenticator QR code' });
    const label = svg.match(/aria-label="([^"]*)"/)?.[1] ?? '';
    assert.equal(label.includes('JBSWY3DPEHPK3PXP'), false);
    assert.equal(label, 'Authenticator QR code');
  });
});
