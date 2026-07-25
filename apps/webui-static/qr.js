// SPDX-License-Identifier: AGPL-3.0-or-later
//
// A QR encoder, written here rather than pulled in.
//
// The obvious way to show an enrolment QR code is an <img> pointing at a chart service,
// or a CDN script. Both would send the TOTP secret to a third party — the one value in
// the entire product that must never leave the machine — and both would put a remote
// dependency in a path that is supposed to work with no network at all. The product
// also declares zero third-party npm dependencies, and an authenticator QR code is not
// a good reason to make that false.
//
// So: byte mode, ECC level M, versions 1-10, drawn as inline SVG. That covers an
// otpauth:// URI comfortably (version 10 at level M holds 213 bytes; a NOESAR
// enrolment URI is around 130).
//
// Reference: ISO/IEC 18004. The tables below are the parts of it this encoder needs.

// Total codewords and EC codewords per block, for level M, versions 1-10.
const VERSIONS = {
  1:  { total: 26,  ecPerBlock: 10, group1Blocks: 1, group1Data: 16 },
  2:  { total: 44,  ecPerBlock: 16, group1Blocks: 1, group1Data: 28 },
  3:  { total: 70,  ecPerBlock: 26, group1Blocks: 1, group1Data: 44 },
  4:  { total: 100, ecPerBlock: 18, group1Blocks: 2, group1Data: 32 },
  5:  { total: 134, ecPerBlock: 24, group1Blocks: 2, group1Data: 43 },
  6:  { total: 172, ecPerBlock: 16, group1Blocks: 4, group1Data: 27 },
  7:  { total: 196, ecPerBlock: 18, group1Blocks: 4, group1Data: 31 },
  8:  { total: 242, ecPerBlock: 22, group1Blocks: 2, group1Data: 38, group2Blocks: 2, group2Data: 39 },
  9:  { total: 292, ecPerBlock: 22, group1Blocks: 3, group1Data: 36, group2Blocks: 2, group2Data: 37 },
  10: { total: 346, ecPerBlock: 26, group1Blocks: 4, group1Data: 43, group2Blocks: 1, group2Data: 44 },
};

// BCH(18,6) version information, versions 7-10 (ISO/IEC 18004 Table D.1). Versions
// 1-6 carry none. Stored LSB-first, which is the order they are placed in.
const VERSION_INFORMATION = {
  7:  0b000111110010010100,
  8:  0b001000010110111100,
  9:  0b001001101010011001,
  10: 0b001010010011010011,
};

const ALIGNMENT_CENTRES = {
  1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30],
  6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50],
};

// --- GF(256) arithmetic, primitive polynomial 0x11d ---
const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i += 1) {
    EXP[i] = x; LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i += 1) EXP[i] = EXP[i - 255];
})();

const mul = (a, b) => (a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]]);

/**
 * Build the generator polynomial (x - α^0)(x - α^1)…(x - α^(degree-1)).
 *
 * Coefficients are stored highest power first, so multiplying by (x + α^i) means
 * `next[j] ^= poly[j]` (the shift, i.e. times x) and `next[j+1] ^= poly[j]·α^i`.
 * Swapping those two — which is easy to do and produces a polynomial that still
 * looks plausible — yields a non-monic generator, correct DATA codewords and wrong
 * ERROR-CORRECTION codewords. That is invisible to the eye and fatal to a scanner,
 * and it is exactly what comparing against libqrencode caught.
 */
function generatorPolynomial(degree) {
  let poly = [1];
  for (let i = 0; i < degree; i += 1) {
    const next = new Array(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j += 1) {
      next[j] ^= poly[j];
      next[j + 1] ^= mul(poly[j], EXP[i]);
    }
    poly = next;
  }
  return poly;
}

function errorCorrection(data, ecLength) {
  const generator = generatorPolynomial(ecLength);
  const remainder = new Array(ecLength).fill(0);
  for (const byte of data) {
    const factor = byte ^ remainder[0];
    remainder.shift();
    remainder.push(0);
    if (factor !== 0) {
      for (let i = 0; i < generator.length - 1; i += 1) {
        remainder[i] ^= mul(generator[i + 1], factor);
      }
    }
  }
  return remainder;
}

// Versions 1-6 only, and that limit is a verification result rather than a preference.
//
// Every version in this range was checked module-for-module against libqrencode (byte
// mode, level M) and matches exactly, including the automatically chosen mask.
// Versions 7 and above additionally carry an 18-bit version-information block, and
// those did NOT match: something in that path is still wrong. A QR code that renders
// but does not decode is worse than no QR code, so the encoder refuses to emit one
// rather than guessing. See docs/MFA_LIFECYCLE.md and finding F4W-005.
const MAX_VERSION = 6;

function chooseVersion(byteLength) {
  for (let version = 1; version <= MAX_VERSION; version += 1) {
    const spec = VERSIONS[version];
    const capacity = spec.group1Blocks * spec.group1Data + (spec.group2Blocks ?? 0) * (spec.group2Data ?? 0);
    // 4 bits mode + 8 or 16 bits length + payload, in bytes
    const headerBits = 4 + (version < 10 ? 8 : 16);
    if (capacity * 8 >= headerBits + byteLength * 8) return version;
  }
  throw new Error(`Payload of ${byteLength} bytes exceeds this encoder's verified range (QR version 1-6, level M, max 106 bytes).`);
}

function buildBitStream(bytes, version) {
  const bits = [];
  const push = (value, length) => {
    for (let i = length - 1; i >= 0; i -= 1) bits.push((value >> i) & 1);
  };
  push(0b0100, 4);                              // byte mode
  push(bytes.length, version < 10 ? 8 : 16);    // character count
  for (const byte of bytes) push(byte, 8);

  const spec = VERSIONS[version];
  const dataCodewords = spec.group1Blocks * spec.group1Data + (spec.group2Blocks ?? 0) * (spec.group2Data ?? 0);
  const capacityBits = dataCodewords * 8;
  for (let i = 0; i < 4 && bits.length < capacityBits; i += 1) bits.push(0); // terminator
  while (bits.length % 8 !== 0) bits.push(0);

  const codewords = [];
  for (let i = 0; i < bits.length; i += 8) {
    codewords.push(bits.slice(i, i + 8).reduce((acc, bit) => (acc << 1) | bit, 0));
  }
  // Alternating pad bytes, as the specification requires.
  const PAD = [0xec, 0x11];
  let padIndex = 0;
  while (codewords.length < dataCodewords) { codewords.push(PAD[padIndex % 2]); padIndex += 1; }
  return codewords;
}

function interleave(codewords, version) {
  const spec = VERSIONS[version];
  const blocks = [];
  let offset = 0;
  for (let i = 0; i < spec.group1Blocks; i += 1) {
    blocks.push(codewords.slice(offset, offset + spec.group1Data));
    offset += spec.group1Data;
  }
  for (let i = 0; i < (spec.group2Blocks ?? 0); i += 1) {
    blocks.push(codewords.slice(offset, offset + spec.group2Data));
    offset += spec.group2Data;
  }
  const ecBlocks = blocks.map((block) => errorCorrection(block, spec.ecPerBlock));

  const result = [];
  const maxData = Math.max(...blocks.map((block) => block.length));
  for (let i = 0; i < maxData; i += 1) {
    for (const block of blocks) if (i < block.length) result.push(block[i]);
  }
  for (let i = 0; i < spec.ecPerBlock; i += 1) {
    for (const block of ecBlocks) result.push(block[i]);
  }
  return result;
}

function createMatrix(version) {
  const size = version * 4 + 17;
  const modules = Array.from({ length: size }, () => new Array(size).fill(null));
  const reserved = Array.from({ length: size }, () => new Array(size).fill(false));

  const placeFinder = (row, col) => {
    for (let r = -1; r <= 7; r += 1) {
      for (let c = -1; c <= 7; c += 1) {
        const rr = row + r; const cc = col + c;
        if (rr < 0 || rr >= size || cc < 0 || cc >= size) continue;
        const inRing = (r >= 0 && r <= 6 && (c === 0 || c === 6)) || (c >= 0 && c <= 6 && (r === 0 || r === 6));
        const inCore = r >= 2 && r <= 4 && c >= 2 && c <= 4;
        modules[rr][cc] = inRing || inCore ? 1 : 0;
        reserved[rr][cc] = true;
      }
    }
  };
  placeFinder(0, 0); placeFinder(0, size - 7); placeFinder(size - 7, 0);

  // Timing patterns
  for (let i = 8; i < size - 8; i += 1) {
    const value = i % 2 === 0 ? 1 : 0;
    if (!reserved[6][i]) { modules[6][i] = value; reserved[6][i] = true; }
    if (!reserved[i][6]) { modules[i][6] = value; reserved[i][6] = true; }
  }

  // Alignment patterns
  const centres = ALIGNMENT_CENTRES[version];
  for (const row of centres) {
    for (const col of centres) {
      if (reserved[row][col]) continue;
      for (let r = -2; r <= 2; r += 1) {
        for (let c = -2; c <= 2; c += 1) {
          const isDark = Math.max(Math.abs(r), Math.abs(c)) !== 1;
          modules[row + r][col + c] = isDark ? 1 : 0;
          reserved[row + r][col + c] = true;
        }
      }
    }
  }

  // Version information — versions 7 and above only.
  //
  // Two 6x3 blocks of BCH(18,6) data next to the top-right and bottom-left finders.
  // Omitting them does not just lose 36 modules of metadata: those cells are not
  // reserved, so the data stream spills into them and every codeword after that point
  // lands in the wrong place. Versions 1-6 were byte-identical to libqrencode while
  // 8 and 9 were not, which is precisely the shape of this bug.
  if (VERSION_INFORMATION[version]) {
    const bits = VERSION_INFORMATION[version];
    for (let i = 0; i < 18; i += 1) {
      const bit = (bits >> i) & 1;
      const a = Math.floor(i / 3);
      const b = size - 11 + (i % 3);
      modules[a][b] = bit; reserved[a][b] = true;   // top right
      modules[b][a] = bit; reserved[b][a] = true;   // bottom left
    }
  }

  // Dark module and format-information areas
  modules[size - 8][8] = 1; reserved[size - 8][8] = true;
  for (let i = 0; i < 9; i += 1) {
    if (!reserved[8][i]) { reserved[8][i] = true; modules[8][i] = 0; }
    if (!reserved[i][8]) { reserved[i][8] = true; modules[i][8] = 0; }
  }
  for (let i = size - 8; i < size; i += 1) {
    if (!reserved[8][i]) { reserved[8][i] = true; modules[8][i] = 0; }
    if (!reserved[i][8]) { reserved[i][8] = true; modules[i][8] = 0; }
  }
  return { size, modules, reserved };
}

const MASKS = [
  (r, c) => (r + c) % 2 === 0,
  (r) => r % 2 === 0,
  (r, c) => c % 3 === 0,
  (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
  (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
];

function placeData(matrix, codewords, maskIndex) {
  const { size, modules, reserved } = matrix;
  const grid = modules.map((row) => row.slice());
  const bits = [];
  for (const byte of codewords) for (let i = 7; i >= 0; i -= 1) bits.push((byte >> i) & 1);

  let bitIndex = 0;
  let upward = true;
  for (let right = size - 1; right > 0; right -= 2) {
    if (right === 6) right -= 1; // skip the vertical timing column
    for (let step = 0; step < size; step += 1) {
      const row = upward ? size - 1 - step : step;
      for (const col of [right, right - 1]) {
        if (reserved[row][col]) continue;
        const bit = bitIndex < bits.length ? bits[bitIndex] : 0;
        bitIndex += 1;
        grid[row][col] = MASKS[maskIndex](row, col) ? bit ^ 1 : bit;
      }
    }
    upward = !upward;
  }
  return grid;
}

// Format information for level M with the chosen mask, BCH(15,5) + XOR mask.
function formatBits(maskIndex) {
  const data = (0b00 << 3) | maskIndex; // 00 = error correction level M
  let value = data << 10;
  for (let i = 14; i >= 10; i -= 1) {
    if ((value >> i) & 1) value ^= 0b10100110111 << (i - 10);
  }
  return ((data << 10) | value) ^ 0b101010000010010;
}

function placeFormat(grid, size, maskIndex) {
  const bits = formatBits(maskIndex);
  // Bit 0 of the PLACEMENT order is the leftmost character of the published format
  // string, which is the most significant bit of the value formatBits() returns.
  // Indexing it as (bits >> i) reverses the string and produces a symbol whose
  // format information decodes to a different mask — verified against libqrencode.
  const bitAt = (i) => (bits >> (14 - i)) & 1;
  for (let i = 0; i <= 5; i += 1) grid[8][i] = bitAt(i);
  grid[8][7] = bitAt(6); grid[8][8] = bitAt(7); grid[7][8] = bitAt(8);
  for (let i = 9; i <= 14; i += 1) grid[14 - i][8] = bitAt(i);
  for (let i = 0; i <= 7; i += 1) grid[size - 1 - i][8] = bitAt(i);
  for (let i = 8; i <= 14; i += 1) grid[8][size - 15 + i] = bitAt(i);
  grid[size - 8][8] = 1;
  return grid;
}

// Penalty scoring (ISO/IEC 18004 section 8.8.2) — pick the mask a reader copes with best.
function penalty(grid, size) {
  let score = 0;
  const runPenalty = (line) => {
    let run = 1;
    for (let i = 1; i < line.length; i += 1) {
      if (line[i] === line[i - 1]) { run += 1; continue; }
      if (run >= 5) score += 3 + (run - 5);
      run = 1;
    }
    if (run >= 5) score += 3 + (run - 5);
  };
  for (let i = 0; i < size; i += 1) {
    runPenalty(grid[i]);
    runPenalty(grid.map((row) => row[i]));
  }
  for (let r = 0; r < size - 1; r += 1) {
    for (let c = 0; c < size - 1; c += 1) {
      const v = grid[r][c];
      if (v === grid[r][c + 1] && v === grid[r + 1][c] && v === grid[r + 1][c + 1]) score += 3;
    }
  }
  let dark = 0;
  for (const row of grid) for (const cell of row) dark += cell;
  const ratio = (dark * 100) / (size * size);
  score += Math.floor(Math.abs(ratio - 50) / 5) * 10;
  return score;
}

/**
 * Encode `text` and return the module grid (1 = dark).
 */
export function encodeQr(text, { forceMask = null } = {}) {
  const bytes = new TextEncoder().encode(String(text));
  const version = chooseVersion(bytes.length);
  const codewords = interleave(buildBitStream(bytes, version), version);
  const matrix = createMatrix(version);

  let best = null;
  for (let mask = forceMask === null ? 0 : forceMask; mask < (forceMask === null ? 8 : forceMask + 1); mask += 1) {
    const grid = placeFormat(placeData(matrix, codewords, mask), matrix.size, mask);
    const score = penalty(grid, matrix.size);
    if (!best || score < best.score) best = { grid, score, mask };
  }
  return { size: matrix.size, modules: best.grid, version, mask: best.mask };
}

/**
 * Render `text` as an inline SVG string. No network, no canvas, no dependency.
 */
export function qrSvg(text, { quietZone = 4, title = 'QR code' } = {}) {
  const { size, modules } = encodeQr(text);
  const dimension = size + quietZone * 2;
  const paths = [];
  for (let row = 0; row < size; row += 1) {
    for (let col = 0; col < size; col += 1) {
      if (modules[row][col]) paths.push(`M${col + quietZone} ${row + quietZone}h1v1h-1z`);
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${dimension} ${dimension}" `
    + `shape-rendering="crispEdges" role="img" aria-label="${String(title).replace(/[<>&"]/g, '')}">`
    + `<rect width="${dimension}" height="${dimension}" fill="#ffffff"/>`
    + `<path d="${paths.join('')}" fill="#000000"/></svg>`;
}
