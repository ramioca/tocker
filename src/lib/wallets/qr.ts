/**
 * A minimal QR encoder — byte mode, error-correction level M, versions 1-10.
 *
 * Why hand-rolled rather than `qrcode.react`: the only thing this product ever
 * puts in a QR is a wallet address (32-44 characters) or a short payment URI,
 * which fits version 3 with room to spare. That is a few hundred lines of table
 * lookup and finite-field arithmetic, it is pure, and it is tested against
 * frozen fixtures generated from a reference encoder — cheaper than another
 * client dependency in the bundle that renders the deposit sheet.
 *
 * Pure: no DOM, no canvas. {@link encodeQr} returns a boolean matrix and the
 * component draws it as SVG.
 */

export type EccLevel = "M";

export interface QrMatrix {
  /** Modules per side, excluding the quiet zone. */
  size: number;
  /** `modules[row][col]` — true is dark. */
  modules: boolean[][];
  version: number;
  mask: number;
}

/** Per version (index 1-10): EC codewords per block, then [blocks, data codewords] per group. */
const EC_BLOCKS_M: Array<[number, Array<[number, number]>]> = [
  [0, []], // unused index 0
  [10, [[1, 16]]],
  [16, [[1, 28]]],
  [26, [[1, 44]]],
  [18, [[2, 32]]],
  [24, [[2, 43]]],
  [16, [[4, 27]]],
  [18, [[4, 31]]],
  [22, [[2, 38], [2, 39]]],
  [22, [[3, 36], [2, 37]]],
  [26, [[4, 43], [1, 44]]],
];

/** Byte-mode capacity in characters, level M, versions 1-10. */
const BYTE_CAPACITY_M = [0, 14, 26, 42, 62, 84, 106, 122, 152, 180, 213];

/** Row/column centres of the alignment patterns, versions 1-10. */
const ALIGNMENT_POSITIONS: number[][] = [
  [],
  [],
  [6, 18],
  [6, 22],
  [6, 26],
  [6, 30],
  [6, 34],
  [6, 22, 38],
  [6, 24, 42],
  [6, 26, 46],
  [6, 28, 50],
];

export const MAX_QR_BYTES = BYTE_CAPACITY_M[10];

// ------------------------------------------------------------ GF(256) maths

const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
{
  let x = 1;
  for (let i = 0; i < 255; i += 1) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i += 1) EXP[i] = EXP[i - 255];
}

function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return EXP[LOG[a] + LOG[b]];
}

/** Generator polynomial of degree `degree`, coefficients high-order first. */
function generatorPoly(degree: number): number[] {
  let poly = [1];
  for (let i = 0; i < degree; i += 1) {
    const next = new Array<number>(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j += 1) {
      next[j] ^= poly[j];
      next[j + 1] ^= gfMul(poly[j], EXP[i]);
    }
    poly = next;
  }
  return poly;
}

function reedSolomon(data: number[], ecLength: number): number[] {
  const gen = generatorPoly(ecLength);
  const remainder = new Array<number>(ecLength).fill(0);
  for (const byte of data) {
    const factor = byte ^ remainder[0];
    remainder.shift();
    remainder.push(0);
    for (let i = 0; i < ecLength; i += 1) {
      remainder[i] ^= gfMul(gen[i + 1], factor);
    }
  }
  return remainder;
}

// ------------------------------------------------------------------ bit bag

class BitBuffer {
  bits: number[] = [];

  put(value: number, length: number) {
    for (let i = length - 1; i >= 0; i -= 1) this.bits.push((value >>> i) & 1);
  }

  get length() {
    return this.bits.length;
  }
}

// --------------------------------------------------------------- encoding

function toUtf8(text: string): number[] {
  const out: number[] = [];
  for (const byte of new TextEncoder().encode(text)) out.push(byte);
  return out;
}

function pickVersion(byteLength: number): number {
  for (let v = 1; v <= 10; v += 1) {
    if (byteLength <= BYTE_CAPACITY_M[v]) return v;
  }
  throw new Error(`QR payload of ${byteLength} bytes is too long (max ${MAX_QR_BYTES})`);
}

function totalDataCodewords(version: number): number {
  const [, groups] = EC_BLOCKS_M[version];
  return groups.reduce((sum, [blocks, size]) => sum + blocks * size, 0);
}

function buildCodewords(bytes: number[], version: number): number[] {
  const capacity = totalDataCodewords(version);
  const buffer = new BitBuffer();
  buffer.put(0b0100, 4); // byte mode
  buffer.put(bytes.length, version < 10 ? 8 : 16);
  for (const byte of bytes) buffer.put(byte, 8);

  const limit = capacity * 8;
  const terminator = Math.min(4, limit - buffer.length);
  buffer.put(0, terminator);
  while (buffer.length % 8 !== 0) buffer.put(0, 1);

  const codewords: number[] = [];
  for (let i = 0; i < buffer.length; i += 8) {
    let byte = 0;
    for (let j = 0; j < 8; j += 1) byte = (byte << 1) | buffer.bits[i + j];
    codewords.push(byte);
  }
  const PAD = [0xec, 0x11];
  for (let i = 0; codewords.length < capacity; i += 1) codewords.push(PAD[i % 2]);
  return codewords;
}

/** Split into blocks, add EC per block, then interleave as the spec requires. */
function interleave(codewords: number[], version: number): number[] {
  const [ecLength, groups] = EC_BLOCKS_M[version];
  const dataBlocks: number[][] = [];
  const ecBlocks: number[][] = [];
  let offset = 0;
  for (const [blocks, size] of groups) {
    for (let i = 0; i < blocks; i += 1) {
      const block = codewords.slice(offset, offset + size);
      offset += size;
      dataBlocks.push(block);
      ecBlocks.push(reedSolomon(block, ecLength));
    }
  }

  const out: number[] = [];
  const maxData = Math.max(...dataBlocks.map((b) => b.length));
  for (let i = 0; i < maxData; i += 1) {
    for (const block of dataBlocks) if (i < block.length) out.push(block[i]);
  }
  for (let i = 0; i < ecLength; i += 1) {
    for (const block of ecBlocks) out.push(block[i]);
  }
  return out;
}

// --------------------------------------------------------------- placement

type Grid = Array<Array<boolean | null>>;

function blankGrid(size: number): Grid {
  return Array.from({ length: size }, () => new Array<boolean | null>(size).fill(null));
}

function placeFinder(grid: Grid, row: number, col: number) {
  for (let r = -1; r <= 7; r += 1) {
    for (let c = -1; c <= 7; c += 1) {
      const rr = row + r;
      const cc = col + c;
      if (rr < 0 || cc < 0 || rr >= grid.length || cc >= grid.length) continue;
      const inRing = (r >= 0 && r <= 6 && (c === 0 || c === 6)) || (c >= 0 && c <= 6 && (r === 0 || r === 6));
      const inCore = r >= 2 && r <= 4 && c >= 2 && c <= 4;
      grid[rr][cc] = inRing || inCore;
    }
  }
}

function placeAlignment(grid: Grid, version: number) {
  const positions = ALIGNMENT_POSITIONS[version];
  const size = grid.length;
  for (const row of positions) {
    for (const col of positions) {
      // Skip the three corners the finder patterns already own.
      if ((row === 6 && col === 6) || (row === 6 && col === size - 7) || (row === size - 7 && col === 6)) {
        continue;
      }
      for (let r = -2; r <= 2; r += 1) {
        for (let c = -2; c <= 2; c += 1) {
          grid[row + r][col + c] = Math.max(Math.abs(r), Math.abs(c)) !== 1;
        }
      }
    }
  }
}

function placeTiming(grid: Grid) {
  const size = grid.length;
  for (let i = 8; i < size - 8; i += 1) {
    const dark = i % 2 === 0;
    if (grid[6][i] === null) grid[6][i] = dark;
    if (grid[i][6] === null) grid[i][6] = dark;
  }
}

function reserveFormat(grid: Grid, version: number) {
  const size = grid.length;
  for (let i = 0; i < 9; i += 1) {
    if (grid[8][i] === null) grid[8][i] = false;
    if (grid[i][8] === null) grid[i][8] = false;
  }
  for (let i = 0; i < 8; i += 1) {
    if (grid[8][size - 1 - i] === null) grid[8][size - 1 - i] = false;
    if (grid[size - 1 - i][8] === null) grid[size - 1 - i][8] = false;
  }
  grid[4 * version + 9][8] = true; // the always-dark module
}

/** BCH(15,5) format information, already masked with 0x5412. Level M is 0b00. */
function formatBits(mask: number): number {
  const data = (0b00 << 3) | mask;
  let value = data << 10;
  for (let i = 14; i >= 10; i -= 1) {
    if ((value >>> i) & 1) value ^= 0x537 << (i - 10);
  }
  return ((data << 10) | value) ^ 0x5412;
}

/** BCH(18,6) version information — only versions 7 and above carry it. */
function versionBits(version: number): number {
  let value = version << 12;
  for (let i = 17; i >= 12; i -= 1) {
    if ((value >>> i) & 1) value ^= 0x1f25 << (i - 12);
  }
  return (version << 12) | value;
}

function placeFormat(grid: Grid, mask: number) {
  const size = grid.length;
  const bits = formatBits(mask);
  for (let i = 0; i < 15; i += 1) {
    const dark = ((bits >>> i) & 1) === 1;
    // The vertical copy: down column 8, skipping the timing row at 6.
    if (i < 6) grid[i][8] = dark;
    else if (i < 8) grid[i + 1][8] = dark;
    else grid[size - 15 + i][8] = dark;
    // The horizontal copy: along row 8, from the right edge back to column 0.
    if (i < 8) grid[8][size - 1 - i] = dark;
    else if (i === 8) grid[8][7] = dark;
    else grid[8][14 - i] = dark;
  }
  grid[size - 8][8] = true; // the always-dark module, never masked
}

function placeVersion(grid: Grid, version: number) {
  if (version < 7) return;
  const size = grid.length;
  const bits = versionBits(version);
  for (let i = 0; i < 18; i += 1) {
    const dark = ((bits >>> i) & 1) === 1;
    const row = Math.floor(i / 3);
    const col = (i % 3) + size - 11;
    grid[row][col] = dark;
    grid[col][row] = dark;
  }
}

function applyMask(row: number, col: number, mask: number): boolean {
  switch (mask) {
    case 0:
      return (row + col) % 2 === 0;
    case 1:
      return row % 2 === 0;
    case 2:
      return col % 3 === 0;
    case 3:
      return (row + col) % 3 === 0;
    case 4:
      return (Math.floor(row / 2) + Math.floor(col / 3)) % 2 === 0;
    case 5:
      return ((row * col) % 2) + ((row * col) % 3) === 0;
    case 6:
      return (((row * col) % 2) + ((row * col) % 3)) % 2 === 0;
    default:
      return (((row + col) % 2) + ((row * col) % 3)) % 2 === 0;
  }
}

function placeData(grid: Grid, data: number[], mask: number) {
  const size = grid.length;
  let bitIndex = 0;
  let upward = true;

  for (let right = size - 1; right >= 1; right -= 2) {
    // Column 6 is the vertical timing pattern; the pair skips over it.
    const rightCol = right <= 6 ? right - 1 : right;
    for (let step = 0; step < size; step += 1) {
      const row = upward ? size - 1 - step : step;
      for (const col of [rightCol, rightCol - 1]) {
        if (grid[row][col] !== null) continue;
        const byte = data[bitIndex >>> 3] ?? 0;
        const bit = ((byte >>> (7 - (bitIndex & 7))) & 1) === 1;
        grid[row][col] = bit !== applyMask(row, col, mask);
        bitIndex += 1;
      }
    }
    upward = !upward;
  }
}

function penalty(modules: boolean[][]): number {
  const size = modules.length;
  let score = 0;

  // Rule 1 — runs of five or more of the same colour, in both directions.
  for (let i = 0; i < size; i += 1) {
    for (const horizontal of [true, false]) {
      let run = 1;
      for (let j = 1; j < size; j += 1) {
        const prev = horizontal ? modules[i][j - 1] : modules[j - 1][i];
        const current = horizontal ? modules[i][j] : modules[j][i];
        if (prev === current) {
          run += 1;
        } else {
          if (run >= 5) score += run - 2;
          run = 1;
        }
      }
      if (run >= 5) score += run - 2;
    }
  }

  // Rule 2 — every 2x2 block of one colour.
  for (let r = 0; r < size - 1; r += 1) {
    for (let c = 0; c < size - 1; c += 1) {
      const v = modules[r][c];
      if (v === modules[r][c + 1] && v === modules[r + 1][c] && v === modules[r + 1][c + 1]) score += 3;
    }
  }

  // Rule 3 — the finder-lookalike 1:1:3:1:1 pattern with four light modules beside it.
  const patternA = [true, false, true, true, true, false, true, false, false, false, false];
  const patternB = [false, false, false, false, true, false, true, true, true, false, true];
  const matches = (get: (k: number) => boolean, start: number, pattern: boolean[]) =>
    pattern.every((want, k) => get(start + k) === want);
  for (let i = 0; i < size; i += 1) {
    for (let j = 0; j + 11 <= size; j += 1) {
      const row = (k: number) => modules[i][k];
      const col = (k: number) => modules[k][i];
      if (matches(row, j, patternA) || matches(row, j, patternB)) score += 40;
      if (matches(col, j, patternA) || matches(col, j, patternB)) score += 40;
    }
  }

  // Rule 4 — imbalance between dark and light.
  let dark = 0;
  for (const row of modules) for (const cell of row) if (cell) dark += 1;
  const ratio = (dark * 100) / (size * size);
  score += Math.floor(Math.abs(ratio - 50) / 5) * 10;

  return score;
}

/**
 * Encode `text` as a QR matrix. Throws only when the payload cannot fit in
 * version 10 — callers pass addresses, so that never happens in practice.
 */
export function encodeQr(text: string): QrMatrix {
  const bytes = toUtf8(text);
  const version = pickVersion(bytes.length);
  const size = version * 4 + 17;
  const data = interleave(buildCodewords(bytes, version), version);

  const base = blankGrid(size);
  placeFinder(base, 0, 0);
  placeFinder(base, 0, size - 7);
  placeFinder(base, size - 7, 0);
  placeAlignment(base, version);
  placeTiming(base);
  placeVersion(base, version);
  reserveFormat(base, version);

  let best: { modules: boolean[][]; mask: number; score: number } | null = null;
  for (let mask = 0; mask < 8; mask += 1) {
    const grid = base.map((row) => [...row]);
    placeData(grid, data, mask);
    placeFormat(grid, mask);
    const modules = grid.map((row) => row.map((cell) => cell === true));
    const score = penalty(modules);
    if (!best || score < best.score) best = { modules, mask, score };
  }

  const chosen = best as { modules: boolean[][]; mask: number; score: number };
  return { size, modules: chosen.modules, version, mask: chosen.mask };
}

/**
 * The matrix as an SVG path `d` string, one module per unit square. The caller
 * sets the viewBox to `size + 2 * quietZone` and translates by the quiet zone.
 */
export function qrPath(matrix: QrMatrix): string {
  const parts: string[] = [];
  for (let r = 0; r < matrix.size; r += 1) {
    for (let c = 0; c < matrix.size; c += 1) {
      if (matrix.modules[r][c]) parts.push(`M${c} ${r}h1v1h-1z`);
    }
  }
  return parts.join("");
}
