/* Minimal QR encoder — byte mode, error correction level M, versions 1 to 10.
 *
 * Written to ISO/IEC 18004 rather than pulled from a CDN, so the site keeps
 * working offline and nothing about which paper is on screen leaves the device.
 * Verified against the Python `qrcode` reference library for every mask and
 * every supported version (see tools/verify_qr.py).
 *
 * Level M corrects roughly 15% damage, which is the usual choice for a printed
 * or on-screen link. Capacity at version 10 is 213 bytes — far more than any
 * DOI or PubMed URL needs.
 */

/* ------------------------------------------------------------ GF(256) --- */

const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
})();

const gfMul = (a, b) => (a === 0 || b === 0) ? 0 : EXP[LOG[a] + LOG[b]];

function rsGenerator(degree) {
  let poly = [1];
  for (let i = 0; i < degree; i++) {
    const next = new Array(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= poly[j];
      next[j + 1] ^= gfMul(poly[j], EXP[i]);
    }
    poly = next;
  }
  return poly;
}

function rsRemainder(data, ecLen) {
  const gen = rsGenerator(ecLen);
  const rem = new Array(ecLen).fill(0);
  for (const byte of data) {
    const factor = byte ^ rem[0];
    rem.shift();
    rem.push(0);
    for (let i = 0; i < ecLen; i++) rem[i] ^= gfMul(gen[i + 1], factor);
  }
  return rem;
}

/* --------------------------------------------------- version tables (M) --- */

/* [totalCodewords, ecPerBlock, group1Blocks, group1Data, group2Blocks, group2Data] */
const VERSIONS_M = {
  1:  [26,  10, 1, 16, 0, 0],
  2:  [44,  16, 1, 28, 0, 0],
  3:  [70,  26, 1, 44, 0, 0],
  4:  [100, 18, 2, 32, 0, 0],
  5:  [134, 24, 2, 43, 0, 0],
  6:  [172, 16, 4, 27, 0, 0],
  7:  [196, 18, 4, 31, 0, 0],
  8:  [242, 22, 2, 38, 2, 39],
  9:  [292, 22, 3, 36, 2, 37],
  10: [346, 26, 4, 43, 1, 44]
};

const ALIGNMENT = {
  1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30],
  6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50]
};

const dataCapacity = v => {
  const [, ec, b1, d1, b2, d2] = VERSIONS_M[v];
  return b1 * d1 + b2 * d2;
};

/* -------------------------------------------------------- bit encoding --- */

function toBytes(text) {
  return Array.from(new TextEncoder().encode(text));
}

function chooseVersion(byteLen) {
  for (let v = 1; v <= 10; v++) {
    const countBits = v < 10 ? 8 : 16;
    const needed = Math.ceil((4 + countBits + byteLen * 8) / 8);
    if (needed <= dataCapacity(v)) return v;
  }
  throw new Error(`Text is ${byteLen} bytes — too long for QR version 10 at EC level M`);
}

function buildCodewords(bytes, version) {
  const capacity = dataCapacity(version);
  const countBits = version < 10 ? 8 : 16;
  const bits = [];
  const push = (value, len) => {
    for (let i = len - 1; i >= 0; i--) bits.push((value >> i) & 1);
  };

  push(0b0100, 4);
  push(bytes.length, countBits);
  for (const b of bytes) push(b, 8);

  const maxBits = capacity * 8;
  for (let i = 0; i < 4 && bits.length < maxBits; i++) bits.push(0);
  while (bits.length % 8) bits.push(0);

  const words = [];
  for (let i = 0; i < bits.length; i += 8) {
    let byte = 0;
    for (let j = 0; j < 8; j++) byte = (byte << 1) | bits[i + j];
    words.push(byte);
  }
  const PAD = [0xec, 0x11];
  let p = 0;
  while (words.length < capacity) words.push(PAD[p++ % 2]);
  return words;
}

function interleave(words, version) {
  const [, ecLen, b1, d1, b2, d2] = VERSIONS_M[version];
  const blocks = [];
  let offset = 0;
  for (let i = 0; i < b1; i++) { blocks.push(words.slice(offset, offset + d1)); offset += d1; }
  for (let i = 0; i < b2; i++) { blocks.push(words.slice(offset, offset + d2)); offset += d2; }

  const ecBlocks = blocks.map(b => rsRemainder(b, ecLen));
  const out = [];
  const maxData = Math.max(...blocks.map(b => b.length));
  for (let i = 0; i < maxData; i++) {
    for (const b of blocks) if (i < b.length) out.push(b[i]);
  }
  for (let i = 0; i < ecLen; i++) {
    for (const b of ecBlocks) out.push(b[i]);
  }
  return out;
}

/* -------------------------------------------------------- matrix build --- */

function newGrid(size, fill) {
  return Array.from({ length: size }, () => new Array(size).fill(fill));
}

function placeFunctionPatterns(m, reserved, version) {
  const size = m.length;
  const set = (r, c, v) => { m[r][c] = v; reserved[r][c] = true; };

  const finder = (r0, c0) => {
    for (let r = -1; r <= 7; r++) {
      for (let c = -1; c <= 7; c++) {
        const rr = r0 + r, cc = c0 + c;
        if (rr < 0 || rr >= size || cc < 0 || cc >= size) continue;
        const inRing = (r >= 0 && r <= 6 && (c === 0 || c === 6)) ||
                       (c >= 0 && c <= 6 && (r === 0 || r === 6));
        const inCore = r >= 2 && r <= 4 && c >= 2 && c <= 4;
        set(rr, cc, inRing || inCore ? 1 : 0);
      }
    }
  };
  finder(0, 0);
  finder(0, size - 7);
  finder(size - 7, 0);

  for (let i = 8; i < size - 8; i++) {
    const v = i % 2 === 0 ? 1 : 0;
    set(6, i, v);
    set(i, 6, v);
  }

  const centres = ALIGNMENT[version];
  const first = centres[0], last = centres[centres.length - 1];
  for (const r0 of centres) {
    for (const c0 of centres) {
      // Only the three centres sitting on a finder pattern are omitted. A
      // centre on the timing row/column (e.g. 6,24 at version 8) IS drawn.
      const onFinder = (r0 === first && c0 === first) ||
                       (r0 === first && c0 === last) ||
                       (r0 === last && c0 === first);
      if (onFinder) continue;
      for (let r = -2; r <= 2; r++) {
        for (let c = -2; c <= 2; c++) {
          const edge = Math.max(Math.abs(r), Math.abs(c));
          set(r0 + r, c0 + c, edge === 1 ? 0 : 1);
        }
      }
    }
  }

  set(size - 8, 8, 1);                                      // dark module

  for (let i = 0; i < 9; i++) {                             // format areas
    if (!reserved[8][i]) { m[8][i] = 0; reserved[8][i] = true; }
    if (!reserved[i][8]) { m[i][8] = 0; reserved[i][8] = true; }
  }
  for (let i = 0; i < 8; i++) {
    if (!reserved[8][size - 1 - i]) { m[8][size - 1 - i] = 0; reserved[8][size - 1 - i] = true; }
    if (!reserved[size - 1 - i][8]) { m[size - 1 - i][8] = 0; reserved[size - 1 - i][8] = true; }
  }

  if (version >= 7) {
    const bits = versionBits(version);
    for (let i = 0; i < 18; i++) {
      const bit = (bits >> i) & 1;
      const a = Math.floor(i / 3), b = size - 11 + (i % 3);
      set(a, b, bit);
      set(b, a, bit);
    }
  }
}

function versionBits(version) {
  let d = version << 12;
  for (let i = 17; i >= 12; i--) {
    if ((d >> i) & 1) d ^= 0x1f25 << (i - 12);
  }
  return (version << 12) | d;
}

function formatBits(maskId) {
  const data = (0b00 << 3) | maskId;                        // 00 = EC level M
  let d = data << 10;
  for (let i = 14; i >= 10; i--) {
    if ((d >> i) & 1) d ^= 0x537 << (i - 10);
  }
  return ((data << 10) | d) ^ 0x5412;
}

function placeFormat(m, maskId) {
  const size = m.length;
  const bits = formatBits(maskId);
  const copyA = [
    [8, 0], [8, 1], [8, 2], [8, 3], [8, 4], [8, 5], [8, 7], [8, 8],
    [7, 8], [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8]
  ];
  const copyB = [
    [size - 1, 8], [size - 2, 8], [size - 3, 8], [size - 4, 8],
    [size - 5, 8], [size - 6, 8], [size - 7, 8],
    [8, size - 8], [8, size - 7], [8, size - 6], [8, size - 5],
    [8, size - 4], [8, size - 3], [8, size - 2], [8, size - 1]
  ];
  for (let i = 0; i < 15; i++) {
    const bit = (bits >> (14 - i)) & 1;
    m[copyA[i][0]][copyA[i][1]] = bit;
    m[copyB[i][0]][copyB[i][1]] = bit;
  }
}

function placeData(m, reserved, codewords) {
  const size = m.length;
  const bits = [];
  for (const w of codewords) for (let i = 7; i >= 0; i--) bits.push((w >> i) & 1);

  let idx = 0, dir = -1, row = size - 1;
  for (let col = size - 1; col > 0; col -= 2) {
    if (col === 6) col--;
    for (;;) {
      for (const c of [col, col - 1]) {
        if (!reserved[row][c]) {
          m[row][c] = idx < bits.length ? bits[idx] : 0;
          idx++;
        }
      }
      row += dir;
      if (row < 0 || row >= size) { row -= dir; dir = -dir; break; }
    }
  }
}

const MASKS = [
  (r, c) => (r + c) % 2 === 0,
  (r) => r % 2 === 0,
  (r, c) => c % 3 === 0,
  (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
  (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0
];

function applyMask(m, reserved, maskId) {
  const fn = MASKS[maskId];
  const size = m.length;
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (!reserved[r][c] && fn(r, c)) m[r][c] ^= 1;
    }
  }
}

function penalty(m) {
  const size = m.length;
  let score = 0;

  const runScore = line => {
    let total = 0, run = 1;
    for (let i = 1; i < line.length; i++) {
      if (line[i] === line[i - 1]) run++;
      else { if (run >= 5) total += 3 + (run - 5); run = 1; }
    }
    if (run >= 5) total += 3 + (run - 5);
    return total;
  };

  for (let r = 0; r < size; r++) score += runScore(m[r]);
  for (let c = 0; c < size; c++) score += runScore(m.map(row => row[c]));

  for (let r = 0; r < size - 1; r++) {
    for (let c = 0; c < size - 1; c++) {
      const v = m[r][c];
      if (v === m[r][c + 1] && v === m[r + 1][c] && v === m[r + 1][c + 1]) score += 3;
    }
  }

  const A = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0];
  const B = [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1];
  const matches = line => {
    let n = 0;
    for (let i = 0; i + 11 <= line.length; i++) {
      let a = true, b = true;
      for (let j = 0; j < 11; j++) {
        if (line[i + j] !== A[j]) a = false;
        if (line[i + j] !== B[j]) b = false;
      }
      if (a) n++;
      if (b) n++;
    }
    return n;
  };
  for (let r = 0; r < size; r++) score += 40 * matches(m[r]);
  for (let c = 0; c < size; c++) score += 40 * matches(m.map(row => row[c]));

  let dark = 0;
  for (const row of m) for (const v of row) dark += v;
  const percent = (dark * 100) / (size * size);
  score += 10 * Math.floor(Math.abs(percent - 50) / 5);

  return score;
}

/* ------------------------------------------------------------- public --- */

/** Returns { matrix, version, maskId, penalty }. */
export function qrInfo(text, { forceMask = null } = {}) {
  const bytes = toBytes(text);
  const version = chooseVersion(bytes.length);
  const size = 17 + 4 * version;
  const codewords = interleave(buildCodewords(bytes, version), version);

  let best = null;
  const candidates = forceMask === null ? [0, 1, 2, 3, 4, 5, 6, 7] : [forceMask];

  for (const maskId of candidates) {
    const m = newGrid(size, 0);
    const reserved = newGrid(size, false);
    placeFunctionPatterns(m, reserved, version);
    placeData(m, reserved, codewords);
    applyMask(m, reserved, maskId);
    placeFormat(m, maskId);
    const score = penalty(m);
    if (!best || score < best.penalty) best = { matrix: m, version, maskId, penalty: score };
  }
  return best;
}

/** Returns a square array of 0/1 rows. */
export function qrMatrix(text, opts = {}) {
  return qrInfo(text, opts).matrix;
}

/**
 * SVG string for the given text.
 * quiet: quiet-zone modules (4 is the spec minimum; do not go below it).
 */
export function qrSVG(text, { size = 160, quiet = 4, label = 'QR code' } = {}) {
  const m = qrMatrix(text);
  const n = m.length;
  const total = n + quiet * 2;

  let path = '';
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (m[r][c]) path += `M${c + quiet} ${r + quiet}h1v1h-1z`;
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" ` +
    `width="${size}" height="${size}" role="img" aria-label="${label.replace(/"/g, '&quot;')}" ` +
    `shape-rendering="crispEdges">` +
    `<rect width="${total}" height="${total}" fill="#ffffff"/>` +
    `<path d="${path}" fill="#000000"/></svg>`;
}
