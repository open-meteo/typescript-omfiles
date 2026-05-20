// turbopfor.ts — TurboPFor integer compression decoder (pure TypeScript)
//
// Supports:
//   p4nzdec128v16 — zigzag PFor, 128v vertical, 16-bit (used for PforDelta2dInt16)
//   p4nddec128v16 — delta PFor, 128v vertical, 16-bit
//   p4nzdec128v32 — zigzag PFor, 128v vertical, 32-bit
//   p4nddec128v32 — delta PFor, 128v vertical, 32-bit
//   p4nzdec8      — zigzag PFor, scalar horizontal, 8-bit
//   p4nddec8      — delta PFor, scalar horizontal, 8-bit
//   p4nzdec64     — zigzag PFor, scalar horizontal, 64-bit (BigInt)
//   p4nddec64     — delta PFor, scalar horizontal, 64-bit (BigInt)
//
// All functions return the number of compressed bytes consumed.

import { vbxget16, vbxget32, vbxget64 } from "./vbx.js";

const CSIZE = 128; // Block size

// ─── Zigzag decode ─────────────────────────────────────────────────────────

function zigzagdec16(x: number): number {
  // Treat x as unsigned 16-bit, output signed result as JS number
  return (x >>> 1) ^ -(x & 1);
}

function zigzagdec32(x: number): number {
  // Treat x as unsigned 32-bit
  return ((x >>> 1) ^ -(x & 1)) | 0; // keep as signed int32
}

function zigzagdec64(x: bigint): bigint {
  return (x >> 1n) ^ -(x & 1n);
}

// ─── Horizontal bit unpack ─────────────────────────────────────────────────
// Decodes `n` values at `b` bits each from src[offset..] using LSB-first horizontal packing.
// Fills dst[dstOff..dstOff+n-1] with unsigned values.
// Returns number of bytes consumed.

function bitunpackHoriz16(
  src: Uint8Array,
  offset: number,
  n: number,
  b: number,
  dst: Uint16Array | Int16Array,
  dstOff: number
): number {
  if (b === 0) {
    for (let i = 0; i < n; i++) dst[dstOff + i] = 0;
    return 0;
  }
  const mask = b < 16 ? (1 << b) - 1 : 0xffff;
  let bitPos = 0;
  for (let i = 0; i < n; i++) {
    const bytePos = bitPos >>> 3;
    const bitInByte = bitPos & 7;
    // Read 32 bits to handle up to 16-bit values at any bit alignment
    const w =
      (src[offset + bytePos] |
        (src[offset + bytePos + 1] << 8) |
        (src[offset + bytePos + 2] << 16) |
        (src[offset + bytePos + 3] << 24)) >>>
      0;
    dst[dstOff + i] = (w >>> bitInByte) & mask;
    bitPos += b;
  }
  return (bitPos + 7) >>> 3;
}

function bitunpackHoriz32(
  src: Uint8Array,
  offset: number,
  n: number,
  b: number,
  dst: Uint32Array | Int32Array,
  dstOff: number
): number {
  if (b === 0) {
    for (let i = 0; i < n; i++) dst[dstOff + i] = 0;
    return 0;
  }
  const mask = b < 32 ? (1 << b) - 1 : -1; // -1 = 0xFFFFFFFF as int32
  let bitPos = 0;
  for (let i = 0; i < n; i++) {
    const bytePos = bitPos >>> 3;
    const bitInByte = bitPos & 7;
    // Read 64 bits via two 32-bit reads to handle 32-bit values at any alignment
    const lo =
      (src[offset + bytePos] |
        (src[offset + bytePos + 1] << 8) |
        (src[offset + bytePos + 2] << 16) |
        (src[offset + bytePos + 3] << 24)) >>>
      0;
    if (bitInByte === 0) {
      dst[dstOff + i] = lo & mask;
    } else {
      const hi =
        (src[offset + bytePos + 4] |
          (src[offset + bytePos + 5] << 8) |
          (src[offset + bytePos + 6] << 16) |
          (src[offset + bytePos + 7] << 24)) >>>
        0;
      dst[dstOff + i] = ((lo >>> bitInByte) | (hi << (32 - bitInByte))) & mask;
    }
    bitPos += b;
  }
  return (bitPos + 7) >>> 3;
}

function bitunpackHoriz8(
  src: Uint8Array,
  offset: number,
  n: number,
  b: number,
  dst: Uint8Array | Int8Array,
  dstOff: number
): number {
  if (b === 0) {
    for (let i = 0; i < n; i++) dst[dstOff + i] = 0;
    return 0;
  }
  const mask = (1 << b) - 1;
  let bitPos = 0;
  for (let i = 0; i < n; i++) {
    const bytePos = bitPos >>> 3;
    const bitInByte = bitPos & 7;
    const w = (src[offset + bytePos] | (src[offset + bytePos + 1] << 8)) >>> 0;
    dst[dstOff + i] = (w >>> bitInByte) & mask;
    bitPos += b;
  }
  return (bitPos + 7) >>> 3;
}

function bitunpackHoriz64(
  src: Uint8Array,
  offset: number,
  n: number,
  b: number,
  dst: BigUint64Array | BigInt64Array,
  dstOff: number
): number {
  if (b === 0) {
    for (let i = 0; i < n; i++) dst[dstOff + i] = 0n;
    return 0;
  }
  const bBig = BigInt(b);
  const mask = b < 64 ? (1n << bBig) - 1n : 0xffffffffffffffffn;
  let bitPos = 0;
  for (let i = 0; i < n; i++) {
    const bytePos = bitPos >>> 3;
    const bitInByte = bitPos & 7;
    // Read 9 bytes (72 bits) to cover a 64-bit value at any bit alignment
    let w = 0n;
    for (let j = 0; j < 9; j++) {
      w |= BigInt(src[offset + bytePos + j] ?? 0) << BigInt(j * 8);
    }
    dst[dstOff + i] = (w >> BigInt(bitInByte)) & mask;
    bitPos += b;
  }
  return (bitPos + 7) >>> 3;
}

// ─── Vertical 128v bit unpack ──────────────────────────────────────────────
// Decodes `count` values (1..128) at `b` bits per value from vertical bit planes.
// For vertical format, plane j (0-indexed) is stored at src[offset + j*16 .. j*16+15].
// Bit j of value i is at: src[offset + j*16 + (i>>>3)], bit position (i&7).

// Decode 128 values at b bits each using the 128v SIMD horizontal-per-lane format.
// Data is stored in 8 interleaved uint16 "lanes" (one per SIMD lane):
//   output[p*8 + lane] comes from uint16 at byte (wordIdx*16 + lane*2),
//   where wordIdx = floor((p*b) / 16), at bit (p*b) % 16 within that uint16.
// Total bytes consumed: b * 16 = PAD8(128 * b).
function bitunpack128v16(src: Uint8Array, offset: number, b: number, dst: Uint16Array, dstOff: number): void {
  if (b === 0) {
    for (let k = 0; k < 128; k++) dst[dstOff + k] = 0;
    return;
  }
  const mask = b < 16 ? (1 << b) - 1 : 0xffff;
  for (let lane = 0; lane < 8; lane++) {
    const laneBase = offset + lane * 2;
    let bitPos = 0;
    for (let p = 0; p < 16; p++) {
      const wordIdx = bitPos >>> 4; // floor(bitPos / 16)
      const bitInWord = bitPos & 15;
      const byteOff = laneBase + wordIdx * 16;
      const word0 = src[byteOff] | (src[byteOff + 1] << 8);
      let val: number;
      if (bitInWord + b <= 16) {
        val = (word0 >>> bitInWord) & mask;
      } else {
        const word1 = src[byteOff + 16] | (src[byteOff + 17] << 8);
        val = ((word0 >>> bitInWord) | (word1 << (16 - bitInWord))) & mask;
      }
      dst[dstOff + p * 8 + lane] = val;
      bitPos += b;
    }
  }
}

// Decode 128 values at b bits each using the 128v SIMD horizontal-per-lane format for 32-bit.
// 4 uint32 lanes, 32 values per lane.
// output[p*4 + lane] comes from uint32 at byte (wordIdx*16 + lane*4),
// where wordIdx = floor((p*b) / 32), at bit (p*b) % 32.
function bitunpack128v32(src: Uint8Array, offset: number, b: number, dst: Uint32Array, dstOff: number): void {
  if (b === 0) {
    for (let k = 0; k < 128; k++) dst[dstOff + k] = 0;
    return;
  }
  const mask = b < 32 ? (1 << b) - 1 : -1; // -1 = 0xFFFFFFFF
  for (let lane = 0; lane < 4; lane++) {
    const laneBase = offset + lane * 4;
    let bitPos = 0;
    for (let p = 0; p < 32; p++) {
      const wordIdx = (bitPos / 32) | 0;
      const bitInWord = bitPos % 32;
      const byteOff = laneBase + wordIdx * 16;
      const word0 =
        (src[byteOff] | (src[byteOff + 1] << 8) | (src[byteOff + 2] << 16) | (src[byteOff + 3] << 24)) >>> 0;
      let val: number;
      if (bitInWord === 0) {
        val = (word0 & mask) >>> 0;
      } else if (bitInWord + b <= 32) {
        val = (word0 >>> bitInWord) & mask;
      } else {
        const word1 =
          (src[byteOff + 16] | (src[byteOff + 17] << 8) | (src[byteOff + 18] << 16) | (src[byteOff + 19] << 24)) >>> 0;
        val = ((word0 >>> bitInWord) | ((word1 << (32 - bitInWord)) >>> 0)) & mask;
      }
      dst[dstOff + p * 4 + lane] = val >>> 0;
      bitPos += b;
    }
  }
}

// ─── Variable-byte (vb) decode for exceptions in 0x40 mode ────────────────
// Different from vbx! Uses a different byte layout with VB_OFS1=177, etc.

const VB_OFS1 = 177;
const VB_BA2 = 241;
const VB_BA3 = 249;
const VB_OFS2 = 16561;

function vbget32_single(src: Uint8Array, offset: number): [number, number] {
  const x = src[offset++];
  if (x < VB_OFS1) return [x, offset];
  if (x < VB_BA2) {
    const next = src[offset++];
    return [(x << 8) + next + (VB_OFS1 - (VB_OFS1 << 8)), offset];
  }
  if (x < VB_BA3) {
    const lo16 = src[offset] | (src[offset + 1] << 8);
    offset += 2;
    return [lo16 + ((x - VB_BA2) << 16) + VB_OFS2, offset];
  }
  // Larger: b = x - VB_BA3 extra bytes
  const bExtra = x - VB_BA3;
  let val = 0;
  for (let i = 0; i < 3 + bExtra && i < 4; i++) {
    val |= src[offset + i] << (i * 8);
  }
  val = val >>> 0;
  offset += 3 + bExtra;
  return [val, offset];
}

// VB_MAX = 254 → overflow marker is VB_MAX + 1 = 255.
// When the encoder finds that the variable-byte stream would be larger
// than just storing raw uint8/uint16/uint32/uint64 values, it writes
// `0xff` followed by `n * (USIZE / 8)` raw little-endian bytes (the
// `OVERFLOWE` macro in vint.c).  The decoder counterpart (`OVERFLOWD`)
// detects this marker and bypasses the VB decode path.
const VB_OVERFLOW_MARKER = 255;

// Decode n variable-byte encoded values into a Uint8Array (USIZE = 8).
function vbdec8(src: Uint8Array, offset: number, n: number, dst: Uint8Array | Uint16Array | Uint32Array): number {
  if (src[offset] === VB_OVERFLOW_MARKER) {
    offset++;
    for (let i = 0; i < n; i++) dst[i] = src[offset + i];
    return offset + n;
  }
  for (let i = 0; i < n; i++) {
    const [v, newOff] = vbget32_single(src, offset);
    dst[i] = v;
    offset = newOff;
  }
  return offset;
}

// Decode n variable-byte encoded values into a Uint16Array (USIZE = 16).
function vbdec16(src: Uint8Array, offset: number, n: number, dst: Uint16Array | Uint32Array): number {
  if (src[offset] === VB_OVERFLOW_MARKER) {
    offset++;
    for (let i = 0; i < n; i++) {
      dst[i] = src[offset + i * 2] | (src[offset + i * 2 + 1] << 8);
    }
    return offset + n * 2;
  }
  for (let i = 0; i < n; i++) {
    const [v, newOff] = vbget32_single(src, offset);
    dst[i] = v;
    offset = newOff;
  }
  return offset;
}

// Decode n variable-byte encoded values into a Uint32Array (USIZE = 32).
function vbdec32(src: Uint8Array, offset: number, n: number, dst: Uint32Array, dstOff: number): number {
  if (src[offset] === VB_OVERFLOW_MARKER) {
    offset++;
    for (let i = 0; i < n; i++) {
      const b0 = src[offset + i * 4];
      const b1 = src[offset + i * 4 + 1];
      const b2 = src[offset + i * 4 + 2];
      const b3 = src[offset + i * 4 + 3];
      dst[dstOff + i] = (b0 | (b1 << 8) | (b2 << 16) | (b3 << 24)) >>> 0;
    }
    return offset + n * 4;
  }
  for (let i = 0; i < n; i++) {
    const [v, newOff] = vbget32_single(src, offset);
    dst[dstOff + i] = v;
    offset = newOff;
  }
  return offset;
}

// Decode n variable-byte encoded values into a Uint32Array, treating each
// decoded value as the low 32 bits of a 64-bit residual.  USIZE = 64, so the
// OVERFLOWD path reads 8 raw bytes per element (but only the low 32 bits are
// stored — the C code does the same when the exception count `bx` is bounded
// and values are known to fit, see the b + bx <= 32 constraint in vp4d.c).
function vbdec64_lo32(src: Uint8Array, offset: number, n: number, dst: Uint32Array): number {
  if (src[offset] === VB_OVERFLOW_MARKER) {
    offset++;
    for (let i = 0; i < n; i++) {
      const b0 = src[offset + i * 8];
      const b1 = src[offset + i * 8 + 1];
      const b2 = src[offset + i * 8 + 2];
      const b3 = src[offset + i * 8 + 3];
      dst[i] = (b0 | (b1 << 8) | (b2 << 16) | (b3 << 24)) >>> 0;
    }
    return offset + n * 8;
  }
  for (let i = 0; i < n; i++) {
    const [v, newOff] = vbget32_single(src, offset);
    dst[i] = v;
    offset = newOff;
  }
  return offset;
}

// ─── Block decoder helpers ─────────────────────────────────────────────────

// Shared temp buffers (reused across calls to avoid GC pressure)
// Extra CSIZE room for exceptions stored after main values
const _tmp16 = new Uint16Array(CSIZE * 2 + 8);
const _tmp32 = new Uint32Array(CSIZE * 2 + 8);
const _ex16 = new Uint16Array(CSIZE * 2 + 8);
const _ex32 = new Uint32Array(CSIZE * 2 + 8);
const _bitmapBuf = new Uint8Array(16);

// Decode one full block (CSIZE=128) for 16-bit, using 128v vertical format.
// Returns bytes consumed.
// `start` (by reference via array) is updated to last accumulated value.
function decodeBlock128v16(
  src: Uint8Array,
  ip: number,
  dst: Uint16Array,
  dstOff: number,
  startArr: Int32Array, // [0] = start (int32 to handle signed delta)
  isZigzag: boolean
): number {
  const ipStart = ip;
  const b = src[ip++];

  if ((b & 0xc0) === 0xc0) {
    // RLE: b & 0x3f gives bit-width, value stored as raw bytes (NOT vbxget)
    const mainBits = b & 0x3f;
    const bytesNeeded = (mainBits + 7) >> 3;
    let v = 0;
    for (let j = 0; j < bytesNeeded; j++) v |= src[ip + j] << (j * 8);
    if (mainBits < 16) v &= (1 << mainBits) - 1;
    v &= 0xffff;
    ip += bytesNeeded;
    let s = startArr[0];
    if (isZigzag) {
      for (let i = 0; i < CSIZE; i++) {
        s = (s + zigzagdec16(v)) & 0xffff;
        dst[dstOff + i] = s;
      }
    } else {
      for (let i = 0; i < CSIZE; i++) {
        s = (s + v) & 0xffff;
        dst[dstOff + i] = s;
      }
    }
    startArr[0] = s;
    return ip - ipStart;
  }

  if (!(b & 0x40)) {
    // Pure vertical bitpack (b & 0x80 == 0) or bitmap exceptions (b & 0x80 != 0)
    const mainBits = b & 0x3f;
    let hasExceptions = false;

    if (b & 0x80) {
      // Bitmap exceptions
      const bx = src[ip++];
      hasExceptions = true;
      // Copy 16-byte bitmap
      for (let j = 0; j < 16; j++) _bitmapBuf[j] = src[ip + j];
      ip += 16;
      // Count exceptions via popcount
      let nEx = 0;
      for (let j = 0; j < 16; j++) {
        let byte = _bitmapBuf[j];
        while (byte) {
          nEx++;
          byte &= byte - 1;
        }
      }
      // Scalar horizontal unpack exceptions at bx bits
      ip += bitunpackHoriz16(src, ip, nEx, bx, _ex16, 0);
    }

    // 128v SIMD format for main values
    bitunpack128v16(src, ip, mainBits, _tmp16, 0);
    ip += mainBits * 16;

    // Merge exceptions
    if (hasExceptions) {
      let k = 0;
      for (let j = 0; j < 16; j++) {
        let byte = _bitmapBuf[j];
        while (byte) {
          // ctz = number of trailing zeros
          const ctz = 31 - Math.clz32(byte & -byte);
          const pos = j * 8 + ctz;
          _tmp16[pos] = (_tmp16[pos] + (_ex16[k++] << mainBits)) & 0xffff;
          byte &= byte - 1;
        }
      }
    }

    // Apply delta/zigzag transform
    let s = startArr[0];
    if (isZigzag) {
      for (let i = 0; i < CSIZE; i++) {
        s = (s + zigzagdec16(_tmp16[i])) & 0xffff;
        dst[dstOff + i] = s;
      }
    } else {
      for (let i = 0; i < CSIZE; i++) {
        s = (s + _tmp16[i]) & 0xffff;
        dst[dstOff + i] = s;
      }
    }
    startArr[0] = s;
    return ip - ipStart;
  }

  // Variable-byte exception mode (b & 0x40 set, b & 0x80 not set)
  {
    const mainBits = b & 0x3f;
    const bx = src[ip++]; // number of exceptions

    // Horizontal unpack CSIZE values at mainBits bits
    // 128v SIMD format for main values in VB exception mode
    bitunpack128v16(src, ip, mainBits, _tmp16, 0);
    ip += mainBits * 16;

    // Decode bx exception values using vb encoding (USIZE = 16)
    ip = vbdec16(src, ip, bx, _ex16);

    // Read bx position indices (byte values)
    for (let j = 0; j < bx; j++) {
      const pos = src[ip + j];
      _tmp16[pos] = (_tmp16[pos] | (_ex16[j] << mainBits)) & 0xffff;
    }
    ip += bx;

    // Apply delta/zigzag
    let s = startArr[0];
    if (isZigzag) {
      for (let i = 0; i < CSIZE; i++) {
        s = (s + zigzagdec16(_tmp16[i])) & 0xffff;
        dst[dstOff + i] = s;
      }
    } else {
      for (let i = 0; i < CSIZE; i++) {
        s = (s + _tmp16[i]) & 0xffff;
        dst[dstOff + i] = s;
      }
    }
    startArr[0] = s;
    return ip - ipStart;
  }
}

// Decode partial block (n < CSIZE) for 16-bit using HORIZONTAL scalar format.
function decodePartialBlock16(
  src: Uint8Array,
  ip: number,
  n: number,
  dst: Uint16Array,
  dstOff: number,
  startArr: Int32Array,
  isZigzag: boolean
): number {
  const ipStart = ip;
  const b = src[ip++];

  if ((b & 0xc0) === 0xc0) {
    // RLE: b & 0x3f gives bit-width, value stored as raw bytes (NOT vbxget)
    const mainBits = b & 0x3f;
    const bytesNeeded = (mainBits + 7) >> 3;
    let v = 0;
    for (let j = 0; j < bytesNeeded; j++) v |= src[ip + j] << (j * 8);
    if (mainBits < 16) v &= (1 << mainBits) - 1;
    v &= 0xffff;
    ip += bytesNeeded;
    let s = startArr[0];
    if (isZigzag) {
      for (let i = 0; i < n; i++) {
        s = (s + zigzagdec16(v)) & 0xffff;
        dst[dstOff + i] = s;
      }
    } else {
      for (let i = 0; i < n; i++) {
        s = (s + v) & 0xffff;
        dst[dstOff + i] = s;
      }
    }
    startArr[0] = s;
    return ip - ipStart;
  }

  if (!(b & 0x40)) {
    const mainBits = b & 0x3f;
    let hasExceptions = false;

    if (b & 0x80) {
      const bx = src[ip++];
      hasExceptions = true;
      // Scalar partial-block format: ceil(n/8) bytes for position bitmap (1 bit per element)
      const p4dn = (n + 7) >> 3;
      let nEx = 0;
      for (let j = 0; j < p4dn; j++) {
        let byte = src[ip + j];
        if (j === p4dn - 1 && (n & 7) !== 0) byte &= (1 << (n & 7)) - 1;
        _bitmapBuf[j] = byte;
        while (byte) {
          nEx++;
          byte &= byte - 1;
        }
      }
      ip += p4dn;
      const exBytes = bitunpackHoriz16(src, ip, nEx, bx, _ex16, 0);
      ip += exBytes;
    }

    // Horizontal scalar unpack for partial blocks
    const mainBytes = bitunpackHoriz16(src, ip, n, mainBits, _tmp16, 0);
    ip += mainBytes;

    if (hasExceptions) {
      const p4dn = (n + 7) >> 3;
      let k = 0;
      for (let j = 0; j < p4dn; j++) {
        let byte = _bitmapBuf[j];
        while (byte) {
          const ctz = 31 - Math.clz32(byte & -byte);
          const pos = j * 8 + ctz;
          if (pos < n) {
            _tmp16[pos] = (_tmp16[pos] + (_ex16[k] << mainBits)) & 0xffff;
          }
          k++;
          byte &= byte - 1;
        }
      }
    }

    let s = startArr[0];
    if (isZigzag) {
      for (let i = 0; i < n; i++) {
        s = (s + zigzagdec16(_tmp16[i])) & 0xffff;
        dst[dstOff + i] = s;
      }
    } else {
      for (let i = 0; i < n; i++) {
        s = (s + _tmp16[i]) & 0xffff;
        dst[dstOff + i] = s;
      }
    }
    startArr[0] = s;
    return ip - ipStart;
  }

  {
    const mainBits = b & 0x3f;
    const bx = src[ip++];
    const mainBytes = bitunpackHoriz16(src, ip, n, mainBits, _tmp16, 0);
    ip += mainBytes;
    ip = vbdec16(src, ip, bx, _ex16);
    for (let j = 0; j < bx; j++) {
      const pos = src[ip + j];
      if (pos < n) _tmp16[pos] = (_tmp16[pos] | (_ex16[j] << mainBits)) & 0xffff;
    }
    ip += bx;
    let s = startArr[0];
    if (isZigzag) {
      for (let i = 0; i < n; i++) {
        s = (s + zigzagdec16(_tmp16[i])) & 0xffff;
        dst[dstOff + i] = s;
      }
    } else {
      for (let i = 0; i < n; i++) {
        s = (s + _tmp16[i]) & 0xffff;
        dst[dstOff + i] = s;
      }
    }
    startArr[0] = s;
    return ip - ipStart;
  }
}

// Decode one full block (CSIZE=128) for 32-bit, using 128v vertical format.
function decodeBlock128v32(
  src: Uint8Array,
  ip: number,
  dst: Uint32Array,
  dstOff: number,
  startArr: Float64Array, // [0] = start as unsigned 32-bit number
  isZigzag: boolean
): number {
  const ipStart = ip;
  const b = src[ip++];

  if ((b & 0xc0) === 0xc0) {
    // RLE: b & 0x3f gives bit-width, value stored as raw bytes (NOT vbxget)
    const mainBits = b & 0x3f;
    const bytesNeeded = (mainBits + 7) >> 3;
    let v = 0;
    for (let j = 0; j < bytesNeeded; j++) v |= src[ip + j] << (j * 8);
    if (mainBits < 32) v &= (1 << mainBits) - 1;
    v >>>= 0;
    ip += bytesNeeded;
    let s = startArr[0];
    if (isZigzag) {
      for (let i = 0; i < CSIZE; i++) {
        s = (s + zigzagdec32(v)) >>> 0;
        dst[dstOff + i] = s;
      }
    } else {
      for (let i = 0; i < CSIZE; i++) {
        s = (s + v) >>> 0;
        dst[dstOff + i] = s;
      }
    }
    startArr[0] = s;
    return ip - ipStart;
  }

  if (!(b & 0x40)) {
    const mainBits = b & 0x3f;
    let hasExceptions = false;

    if (b & 0x80) {
      const bx = src[ip++];
      hasExceptions = true;
      for (let j = 0; j < 16; j++) _bitmapBuf[j] = src[ip + j];
      ip += 16;
      let nEx = 0;
      for (let j = 0; j < 16; j++) {
        let byte = _bitmapBuf[j];
        while (byte) {
          nEx++;
          byte &= byte - 1;
        }
      }
      ip += bitunpackHoriz32(src, ip, nEx, bx, _ex32, 0);
    }

    // 128v SIMD format for main values
    bitunpack128v32(src, ip, mainBits, _tmp32, 0);
    ip += mainBits * 16;

    if (hasExceptions) {
      let k = 0;
      for (let j = 0; j < 16; j++) {
        let byte = _bitmapBuf[j];
        while (byte) {
          const ctz = 31 - Math.clz32(byte & -byte);
          const pos = j * 8 + ctz;
          _tmp32[pos] = (_tmp32[pos] + (_ex32[k++] << mainBits)) >>> 0;
          byte &= byte - 1;
        }
      }
    }

    let s = startArr[0];
    if (isZigzag) {
      for (let i = 0; i < CSIZE; i++) {
        s = (s + zigzagdec32(_tmp32[i])) >>> 0;
        dst[dstOff + i] = s;
      }
    } else {
      for (let i = 0; i < CSIZE; i++) {
        s = (s + _tmp32[i]) >>> 0;
        dst[dstOff + i] = s;
      }
    }
    startArr[0] = s;
    return ip - ipStart;
  }

  {
    const mainBits = b & 0x3f;
    const bx = src[ip++];
    // 128v SIMD format for main values in VB exception mode
    bitunpack128v32(src, ip, mainBits, _tmp32, 0);
    ip += mainBits * 16;
    ip = vbdec32(src, ip, bx, _ex32, 0);
    for (let j = 0; j < bx; j++) {
      const pos = src[ip + j];
      _tmp32[pos] = (_tmp32[pos] | (_ex32[j] << mainBits)) >>> 0;
    }
    ip += bx;
    let s = startArr[0];
    if (isZigzag) {
      for (let i = 0; i < CSIZE; i++) {
        s = (s + zigzagdec32(_tmp32[i])) >>> 0;
        dst[dstOff + i] = s;
      }
    } else {
      for (let i = 0; i < CSIZE; i++) {
        s = (s + _tmp32[i]) >>> 0;
        dst[dstOff + i] = s;
      }
    }
    startArr[0] = s;
    return ip - ipStart;
  }
}

// Decode partial block (n < CSIZE) for 32-bit using HORIZONTAL scalar format.
function decodePartialBlock32(
  src: Uint8Array,
  ip: number,
  n: number,
  dst: Uint32Array,
  dstOff: number,
  startArr: Float64Array,
  isZigzag: boolean
): number {
  const ipStart = ip;
  const b = src[ip++];

  if ((b & 0xc0) === 0xc0) {
    // RLE: b & 0x3f gives bit-width, value stored as raw bytes (NOT vbxget)
    const mainBits = b & 0x3f;
    const bytesNeeded = (mainBits + 7) >> 3;
    let v = 0;
    for (let j = 0; j < bytesNeeded; j++) v |= src[ip + j] << (j * 8);
    if (mainBits < 32) v &= (1 << mainBits) - 1;
    v >>>= 0;
    ip += bytesNeeded;
    let s = startArr[0];
    if (isZigzag) {
      for (let i = 0; i < n; i++) {
        s = (s + zigzagdec32(v)) >>> 0;
        dst[dstOff + i] = s;
      }
    } else {
      for (let i = 0; i < n; i++) {
        s = (s + v) >>> 0;
        dst[dstOff + i] = s;
      }
    }
    startArr[0] = s;
    return ip - ipStart;
  }

  if (!(b & 0x40)) {
    const mainBits = b & 0x3f;
    let hasExceptions = false;

    if (b & 0x80) {
      const bx = src[ip++];
      hasExceptions = true;
      // Scalar partial-block format: ceil(n/8) bytes for position bitmap (1 bit per element)
      const p4dn = (n + 7) >> 3;
      let nEx = 0;
      for (let j = 0; j < p4dn; j++) {
        let byte = src[ip + j];
        // mask the last byte to ignore bits beyond n
        if (j === p4dn - 1 && (n & 7) !== 0) byte &= (1 << (n & 7)) - 1;
        _bitmapBuf[j] = byte;
        while (byte) {
          nEx++;
          byte &= byte - 1;
        }
      }
      ip += p4dn;
      const exBytes = bitunpackHoriz32(src, ip, nEx, bx, _ex32, 0);
      ip += exBytes;
    }

    const mainBytes = bitunpackHoriz32(src, ip, n, mainBits, _tmp32, 0);
    ip += mainBytes;

    if (hasExceptions) {
      const p4dn = (n + 7) >> 3;
      let k = 0;
      for (let j = 0; j < p4dn; j++) {
        let byte = _bitmapBuf[j];
        while (byte) {
          const ctz = 31 - Math.clz32(byte & -byte);
          const pos = j * 8 + ctz;
          if (pos < n) {
            _tmp32[pos] = (_tmp32[pos] + (_ex32[k] << mainBits)) >>> 0;
          }
          k++;
          byte &= byte - 1;
        }
      }
    }

    let s = startArr[0];
    if (isZigzag) {
      for (let i = 0; i < n; i++) {
        s = (s + zigzagdec32(_tmp32[i])) >>> 0;
        dst[dstOff + i] = s;
      }
    } else {
      for (let i = 0; i < n; i++) {
        s = (s + _tmp32[i]) >>> 0;
        dst[dstOff + i] = s;
      }
    }
    startArr[0] = s;
    return ip - ipStart;
  }

  {
    const mainBits = b & 0x3f;
    const bx = src[ip++];
    const mainBytes = bitunpackHoriz32(src, ip, n, mainBits, _tmp32, 0);
    ip += mainBytes;
    ip = vbdec32(src, ip, bx, _ex32, 0);
    for (let j = 0; j < bx; j++) {
      const pos = src[ip + j];
      if (pos < n) _tmp32[pos] = (_tmp32[pos] | (_ex32[j] << mainBits)) >>> 0;
    }
    ip += bx;
    let s = startArr[0];
    if (isZigzag) {
      for (let i = 0; i < n; i++) {
        s = (s + zigzagdec32(_tmp32[i])) >>> 0;
        dst[dstOff + i] = s;
      }
    } else {
      for (let i = 0; i < n; i++) {
        s = (s + _tmp32[i]) >>> 0;
        dst[dstOff + i] = s;
      }
    }
    startArr[0] = s;
    return ip - ipStart;
  }
}

// ─── Public API ────────────────────────────────────────────────────────────

const _startArr16 = new Int32Array(1);
const _startArr32 = new Float64Array(1);

// ─── Debug tracing helper (temporary, remove after bug is found) ─────────────

/** Global debug flag: when set, p4nzdec128v16 logs each block's type and byte count. */
export let _p4n16Debug = false;
export function enableP4n16Debug(): void {
  _p4n16Debug = true;
}
export function disableP4n16Debug(): void {
  _p4n16Debug = false;
}

/** Compute how many bytes a single block at src[ip] will consume WITHOUT decoding it. */
function _traceBlock16(src: Uint8Array, ip: number, n: number): { type: string; bytes: number } {
  const ipStart = ip;
  const b = src[ip++];

  if ((b & 0xc0) === 0xc0) {
    const mainBits = b & 0x3f;
    const bytesNeeded = (mainBits + 7) >> 3;
    return { type: `RLE(bits=${mainBits})`, bytes: 1 + bytesNeeded };
  }

  if (!(b & 0x40)) {
    const mainBits = b & 0x3f;
    let exBytes: number;
    let bitmapBytes: number;
    if (b & 0x80) {
      const bx = src[ip++];
      if (n === CSIZE) {
        // Full block: 16-byte bitmap
        bitmapBytes = 16;
        let nEx = 0;
        for (let j = 0; j < 16; j++) {
          let byte = src[ipStart + 2 + j];
          while (byte) {
            nEx++;
            byte &= byte - 1;
          }
        }
        exBytes = Math.ceil((nEx * bx) / 8);
      } else {
        // Partial block: ceil(n/8) byte bitmap
        const p4dn = (n + 7) >> 3;
        bitmapBytes = p4dn;
        let nEx = 0;
        for (let j = 0; j < p4dn; j++) {
          let byte = src[ip + j];
          if (j === p4dn - 1 && (n & 7) !== 0) byte &= (1 << (n & 7)) - 1;
          while (byte) {
            nEx++;
            byte &= byte - 1;
          }
        }
        exBytes = Math.ceil((nEx * bx) / 8);
      }
      const mainBytes = n === CSIZE ? mainBits * 16 : Math.ceil((n * mainBits) / 8);
      return {
        type: `BitmapEx(mainBits=${mainBits},bx=${bx},nEx?,bitmapBytes=${bitmapBytes})`,
        bytes: 2 + bitmapBytes + exBytes + mainBytes,
      };
    }
    const mainBytes = n === CSIZE ? mainBits * 16 : Math.ceil((n * mainBits) / 8);
    return { type: `Bitpack(mainBits=${mainBits})`, bytes: 1 + mainBytes };
  }

  // VB exception mode
  const mainBits = b & 0x3f;
  const bx = src[ip++];
  const mainBytes = n === CSIZE ? mainBits * 16 : Math.ceil((n * mainBits) / 8);
  // vbdec: count bytes for bx values
  let vbBytes = 0;
  const tempIp = ip + mainBytes;
  if (src[tempIp] === VB_OVERFLOW_MARKER) {
    // OVERFLOWD path: 1 marker byte + bx * 2 raw uint16 bytes (USIZE = 16)
    vbBytes = 1 + bx * 2;
    return { type: `VBex(mainBits=${mainBits},bx=${bx},overflow)`, bytes: 2 + mainBytes + vbBytes + bx };
  }
  for (let j = 0; j < bx; j++) {
    const x = src[tempIp + vbBytes++];
    if (x >= 177 && x < 241)
      vbBytes++; // 2-byte
    else if (x >= 241 && x < 249)
      vbBytes += 2; // 3-byte
    else if (x >= 249) vbBytes += 2 + (x - 249); // 4+ byte
  }
  return { type: `VBex(mainBits=${mainBits},bx=${bx})`, bytes: 2 + mainBytes + vbBytes + bx };
}

/**
 * Zigzag-delta PFor decode, 128v vertical format, 16-bit.
 * Used for COMPRESSION_PFOR_DELTA2D_INT16.
 * Returns bytes consumed.
 */
export function p4nzdec128v16(src: Uint8Array, srcOff: number, n: number, dst: Uint16Array, dstOff: number): number {
  if (n === 0) return 0;
  let ip = srcOff;

  // Read first value (vbx-encoded)
  const [startVal, newIp] = vbxget16(src, ip);
  ip = newIp;
  dst[dstOff] = startVal & 0xffff;
  _startArr16[0] = startVal & 0xffff;
  let remaining = n - 1;
  let op = dstOff + 1;

  // Full blocks of CSIZE=128
  let blockNum = 0;
  while (remaining >= CSIZE) {
    const blockIpBefore = ip;
    if (_p4n16Debug) {
      const trace = _traceBlock16(src, ip, CSIZE);
      const consumed = decodeBlock128v16(src, ip, dst, op, _startArr16, true);
      if (trace.bytes !== consumed) {
        console.log(
          `[p4nzdec128v16] MISMATCH block ${blockNum}: trace=${trace.type} expected=${trace.bytes} actual=${consumed} at ip=${blockIpBefore - srcOff}`
        );
      } else {
        console.log(
          `[p4nzdec128v16] block ${blockNum}: ${trace.type} consumed=${consumed} at ip=${blockIpBefore - srcOff}`
        );
      }
      ip += consumed;
    } else {
      ip += decodeBlock128v16(src, ip, dst, op, _startArr16, true);
    }
    op += CSIZE;
    remaining -= CSIZE;
    blockNum++;
  }

  // Partial final block
  if (remaining > 0) {
    const blockIpBefore = ip;
    if (_p4n16Debug) {
      const trace = _traceBlock16(src, ip, remaining);
      const consumed = decodePartialBlock16(src, ip, remaining, dst, op, _startArr16, true);
      if (trace.bytes !== consumed) {
        console.log(
          `[p4nzdec128v16] MISMATCH partial block ${blockNum} (n=${remaining}): trace=${trace.type} expected=${trace.bytes} actual=${consumed} at ip=${blockIpBefore - srcOff}`
        );
      } else {
        console.log(
          `[p4nzdec128v16] partial block ${blockNum} (n=${remaining}): ${trace.type} consumed=${consumed} at ip=${blockIpBefore - srcOff}`
        );
      }
      ip += consumed;
    } else {
      ip += decodePartialBlock16(src, ip, remaining, dst, op, _startArr16, true);
    }
  }

  return ip - srcOff;
}

/**
 * Delta PFor decode, 128v vertical format, 16-bit.
 * Returns bytes consumed.
 */
export function p4nddec128v16(src: Uint8Array, srcOff: number, n: number, dst: Uint16Array, dstOff: number): number {
  if (n === 0) return 0;
  let ip = srcOff;

  const [startVal, newIp] = vbxget16(src, ip);
  ip = newIp;
  dst[dstOff] = startVal & 0xffff;
  _startArr16[0] = startVal & 0xffff;
  let remaining = n - 1;
  let op = dstOff + 1;

  while (remaining >= CSIZE) {
    ip += decodeBlock128v16(src, ip, dst, op, _startArr16, false);
    op += CSIZE;
    remaining -= CSIZE;
  }

  if (remaining > 0) {
    ip += decodePartialBlock16(src, ip, remaining, dst, op, _startArr16, false);
  }

  return ip - srcOff;
}

/**
 * Zigzag-delta PFor decode, 128v vertical format, 32-bit.
 * Returns bytes consumed.
 */
export function p4nzdec128v32(src: Uint8Array, srcOff: number, n: number, dst: Uint32Array, dstOff: number): number {
  if (n === 0) return 0;
  let ip = srcOff;

  const [startVal, newIp] = vbxget32(src, ip);
  ip = newIp;
  dst[dstOff] = startVal >>> 0;
  _startArr32[0] = startVal >>> 0;
  let remaining = n - 1;
  let op = dstOff + 1;

  while (remaining >= CSIZE) {
    ip += decodeBlock128v32(src, ip, dst, op, _startArr32, true);
    op += CSIZE;
    remaining -= CSIZE;
  }

  if (remaining > 0) {
    ip += decodePartialBlock32(src, ip, remaining, dst, op, _startArr32, true);
  }

  return ip - srcOff;
}

/**
 * Delta PFor decode, 128v vertical format, 32-bit.
 * Returns bytes consumed.
 */
export function p4nddec128v32(src: Uint8Array, srcOff: number, n: number, dst: Uint32Array, dstOff: number): number {
  if (n === 0) return 0;
  let ip = srcOff;

  const [startVal, newIp] = vbxget32(src, ip);
  ip = newIp;
  dst[dstOff] = startVal >>> 0;
  _startArr32[0] = startVal >>> 0;
  let remaining = n - 1;
  let op = dstOff + 1;

  while (remaining >= CSIZE) {
    ip += decodeBlock128v32(src, ip, dst, op, _startArr32, false);
    op += CSIZE;
    remaining -= CSIZE;
  }

  if (remaining > 0) {
    ip += decodePartialBlock32(src, ip, remaining, dst, op, _startArr32, false);
  }

  return ip - srcOff;
}

// ─── 8-bit scalar horizontal block decoder ────────────────────────────────

const _tmp8 = new Uint8Array(CSIZE * 2 + 8);
const _ex8 = new Uint32Array(CSIZE + 8);

function decodeBlockScalar8(
  src: Uint8Array,
  ip: number,
  count: number,
  dst: Uint8Array,
  dstOff: number,
  startRef: Uint32Array, // [0] = current start
  isZigzag: boolean
): number {
  const ipStart = ip;
  const b = src[ip++];

  if ((b & 0xc0) === 0xc0) {
    // RLE: b & 0x3f gives bit-width, value stored as raw bytes (NOT vbxget)
    const mainBits = b & 0x3f;
    const bytesNeeded = (mainBits + 7) >> 3;
    let v = 0;
    for (let j = 0; j < bytesNeeded; j++) v |= src[ip + j] << (j * 8);
    if (mainBits < 16) v &= (1 << mainBits) - 1;
    v &= 0xffff;
    ip += bytesNeeded;
    let s = startRef[0];
    if (isZigzag) {
      const delta = zigzagdec16(v) & 0xff;
      for (let i = 0; i < count; i++) {
        s = (s + delta) & 0xff;
        dst[dstOff + i] = s;
      }
    } else {
      for (let i = 0; i < count; i++) {
        s = (s + v) & 0xff;
        dst[dstOff + i] = s;
      }
    }
    startRef[0] = s;
    return ip - ipStart;
  }

  if (!(b & 0x40)) {
    const mainBits = b & 0x3f;
    if (b & 0x80) {
      // Bitmap exceptions
      const bx = src[ip++];
      for (let j = 0; j < 16; j++) _bitmapBuf[j] = src[ip + j];
      ip += 16;
      let nEx = 0;
      for (let j = 0; j < 16; j++) {
        let by = _bitmapBuf[j];
        while (by) {
          nEx++;
          by &= by - 1;
        }
      }
      ip += bitunpackHoriz8(src, ip, nEx, bx, _tmp8, CSIZE); // store exceptions after main area
      const mainBytes = bitunpackHoriz8(src, ip, count, mainBits, _tmp8, 0);
      ip += mainBytes;
      // Merge exceptions
      let k = 0;
      for (let j = 0; j < 16; j++) {
        let byte = _bitmapBuf[j];
        while (byte) {
          const ctz = 31 - Math.clz32(byte & -byte);
          const pos = j * 8 + ctz;
          if (pos < count) _tmp8[pos] = (_tmp8[pos] + (_tmp8[CSIZE + k] << mainBits)) & 0xff;
          k++;
          byte &= byte - 1;
        }
      }
    } else {
      const mainBytes = bitunpackHoriz8(src, ip, count, mainBits, _tmp8, 0);
      ip += mainBytes;
    }
  } else {
    // Variable-byte exceptions
    const mainBits = b & 0x3f;
    const bxCount = src[ip++];
    const mainBytes = bitunpackHoriz8(src, ip, count, mainBits, _tmp8, 0);
    ip += mainBytes;
    ip = vbdec8(src, ip, bxCount, _ex8);
    for (let j = 0; j < bxCount; j++) {
      const pos = src[ip + j];
      if (pos < count) _tmp8[pos] = (_tmp8[pos] | (_ex8[j] << mainBits)) & 0xff;
    }
    ip += bxCount;
  }

  let s = startRef[0];
  if (isZigzag) {
    for (let i = 0; i < count; i++) {
      s = (s + zigzagdec16(_tmp8[i])) & 0xff;
      dst[dstOff + i] = s;
    }
  } else {
    for (let i = 0; i < count; i++) {
      s = (s + _tmp8[i]) & 0xff;
      dst[dstOff + i] = s;
    }
  }
  startRef[0] = s;
  return ip - ipStart;
}

const _startRef8 = new Uint32Array(1);

/**
 * Zigzag-delta PFor decode, scalar horizontal format, 8-bit.
 * Returns bytes consumed.
 */
export function p4nzdec8(src: Uint8Array, srcOff: number, n: number, dst: Uint8Array, dstOff: number): number {
  if (n === 0) return 0;
  let ip = srcOff;
  // For 8-bit, first value is stored as a single raw byte (vbxget8 = just read 1 byte)
  const startVal = src[ip++];
  dst[dstOff] = startVal;
  _startRef8[0] = startVal;
  let remaining = n - 1;
  let op = dstOff + 1;

  while (remaining > 0) {
    const count = Math.min(remaining, CSIZE);
    ip += decodeBlockScalar8(src, ip, count, dst, op, _startRef8, true);
    op += count;
    remaining -= count;
  }
  return ip - srcOff;
}

/**
 * Delta PFor decode, scalar horizontal format, 8-bit.
 * Returns bytes consumed.
 */
export function p4nddec8(src: Uint8Array, srcOff: number, n: number, dst: Uint8Array, dstOff: number): number {
  if (n === 0) return 0;
  let ip = srcOff;
  const startVal = src[ip++];
  dst[dstOff] = startVal;
  _startRef8[0] = startVal;
  let remaining = n - 1;
  let op = dstOff + 1;

  while (remaining > 0) {
    const count = Math.min(remaining, CSIZE);
    ip += decodeBlockScalar8(src, ip, count, dst, op, _startRef8, false);
    op += count;
    remaining -= count;
  }
  return ip - srcOff;
}

// BigInt temp buffers for 64-bit
const _tmp64_BN = new BigUint64Array(CSIZE + 8);
const _ex64_BN = new BigUint64Array(CSIZE + 8);

/**
 * Zigzag-delta PFor decode, scalar horizontal format, 64-bit.
 * Used for LUT decompression when needed, and Int64Array types.
 * Returns bytes consumed.
 */
export function p4nzdec64(
  src: Uint8Array,
  srcOff: number,
  n: number,
  dst: BigUint64Array | BigInt64Array,
  dstOff: number
): number {
  if (n === 0) return 0;
  let ip = srcOff;
  const [startVal, newIp] = vbxget64(src, ip);
  ip = newIp;
  dst[dstOff] = startVal;
  let start = startVal;
  let remaining = n - 1;
  let op = dstOff + 1;

  const MASK64 = 0xffffffffffffffffn;

  while (remaining > 0) {
    const count = Math.min(remaining, CSIZE);
    const b = src[ip++];

    if ((b & 0xc0) === 0xc0) {
      // RLE: b & 0x3f gives bit-width, value stored as raw bytes (NOT vbxget)
      let mainBits = b & 0x3f;
      if (mainBits === 63) mainBits = 64;
      let u = 0n;
      const bytesNeeded = (mainBits + 7) >> 3;
      for (let j = 0; j < bytesNeeded; j++) {
        u |= BigInt(src[ip + j]) << BigInt(j * 8);
      }
      if (mainBits < 64) u &= (1n << BigInt(mainBits)) - 1n;
      ip += bytesNeeded;
      const delta = zigzagdec64(u);
      for (let i = 0; i < count; i++) {
        start = (start + delta) & MASK64;
        dst[op + i] = start;
      }
    } else if (!(b & 0x40)) {
      // PFOR bitpack (with optional exceptions)
      const mainBits = (b & 0x3f) === 63 ? 64 : b & 0x3f; // 63 stored means 64 for 64-bit
      let hasExceptions = false;

      if (b & 0x80) {
        const bx = src[ip++];
        hasExceptions = true;
        const p4dn = (count + 7) >> 3;
        let nEx = 0;
        for (let j = 0; j < p4dn; j++) {
          let byte = src[ip + j];
          if (j === p4dn - 1 && (count & 7) !== 0) byte &= (1 << (count & 7)) - 1;
          _bitmapBuf[j] = byte;
          while (byte) {
            nEx++;
            byte &= byte - 1;
          }
        }
        ip += p4dn;
        const exBytes = bitunpackHoriz64(src, ip, nEx, bx, _ex64_BN, 0);
        ip += exBytes;
      }

      const mainBytes = bitunpackHoriz64(src, ip, count, mainBits, _tmp64_BN, 0);
      ip += mainBytes;

      if (hasExceptions) {
        const p4dn = (count + 7) >> 3;
        let k = 0;
        for (let j = 0; j < p4dn; j++) {
          let byte = _bitmapBuf[j];
          while (byte) {
            const ctz = 31 - Math.clz32(byte & -byte);
            const pos = j * 8 + ctz;
            if (pos < count) {
              _tmp64_BN[pos] = (_tmp64_BN[pos] + (_ex64_BN[k] << BigInt(mainBits))) & MASK64;
            }
            k++;
            byte &= byte - 1;
          }
        }
      }

      for (let i = 0; i < count; i++) {
        start = (start + zigzagdec64(_tmp64_BN[i])) & MASK64;
        dst[op + i] = start;
      }
    } else {
      // Variable-byte exception mode
      const mainBits = (b & 0x3f) === 63 ? 64 : b & 0x3f; // 63 stored means 64 for 64-bit
      const bx = src[ip++];
      const mainBytes = bitunpackHoriz64(src, ip, count, mainBits, _tmp64_BN, 0);
      ip += mainBytes;
      ip = vbdec64_lo32(src, ip, bx, _ex32); // exception values (32-bit residuals above mainBits)
      for (let j = 0; j < bx; j++) {
        const pos = src[ip + j]; // exception position indices
        if (pos < count) _tmp64_BN[pos] = (_tmp64_BN[pos] | (BigInt(_ex32[j] >>> 0) << BigInt(mainBits))) & MASK64;
      }
      ip += bx;
      for (let i = 0; i < count; i++) {
        start = (start + zigzagdec64(_tmp64_BN[i])) & MASK64;
        dst[op + i] = start;
      }
    }

    op += count;
    remaining -= count;
  }

  return ip - srcOff;
}

/**
 * Delta PFor decode, scalar horizontal format, 64-bit.
 * Used in om_decoder for LUT decompression (p4nddec64).
 * Returns bytes consumed.
 */
export function p4nddec64(src: Uint8Array, srcOff: number, n: number, dst: BigUint64Array, dstOff: number): number {
  if (n === 0) return 0;
  let ip = srcOff;
  const [startVal, newIp] = vbxget64(src, ip);
  ip = newIp;
  dst[dstOff] = startVal;
  let start = startVal;
  let remaining = n - 1;
  let op = dstOff + 1;

  const MASK64 = 0xffffffffffffffffn;

  while (remaining > 0) {
    const count = Math.min(remaining, CSIZE);
    const b = src[ip++];

    if ((b & 0xc0) === 0xc0) {
      // RLE: b & 0x3f gives bit-width, value stored as raw bytes (NOT vbxget)
      let mainBits = b & 0x3f;
      if (mainBits === 63) mainBits = 64;
      let u = 0n;
      const bytesNeeded = (mainBits + 7) >> 3;
      for (let j = 0; j < bytesNeeded; j++) {
        u |= BigInt(src[ip + j]) << BigInt(j * 8);
      }
      if (mainBits < 64) u &= (1n << BigInt(mainBits)) - 1n;
      ip += bytesNeeded;
      for (let i = 0; i < count; i++) {
        start = (start + u) & MASK64;
        dst[op + i] = start;
      }
    } else if (!(b & 0x40)) {
      // PFOR bitpack with optional bitmap exceptions (no zigzag)
      const mainBits = (b & 0x3f) === 63 ? 64 : b & 0x3f; // 63 stored means 64 for 64-bit
      let hasExceptions = false;

      if (b & 0x80) {
        const bx = src[ip++];
        hasExceptions = true;
        const p4dn = (count + 7) >> 3;
        let nEx = 0;
        for (let j = 0; j < p4dn; j++) {
          let byte = src[ip + j];
          if (j === p4dn - 1 && (count & 7) !== 0) byte &= (1 << (count & 7)) - 1;
          _bitmapBuf[j] = byte;
          while (byte) {
            nEx++;
            byte &= byte - 1;
          }
        }
        ip += p4dn;
        const exBytes = bitunpackHoriz64(src, ip, nEx, bx, _ex64_BN, 0);
        ip += exBytes;
      }

      const mainBytes = bitunpackHoriz64(src, ip, count, mainBits, _tmp64_BN, 0);
      ip += mainBytes;

      if (hasExceptions) {
        const p4dn = (count + 7) >> 3;
        let k = 0;
        for (let j = 0; j < p4dn; j++) {
          let byte = _bitmapBuf[j];
          while (byte) {
            const ctz = 31 - Math.clz32(byte & -byte);
            const pos = j * 8 + ctz;
            if (pos < count) {
              _tmp64_BN[pos] = (_tmp64_BN[pos] + (_ex64_BN[k] << BigInt(mainBits))) & MASK64;
            }
            k++;
            byte &= byte - 1;
          }
        }
      }

      for (let i = 0; i < count; i++) {
        start = (start + _tmp64_BN[i]) & MASK64;
        dst[op + i] = start;
      }
    } else {
      // Variable-byte exception mode (b & 0x40 set, b & 0x80 not set) — no zigzag
      const mainBits = (b & 0x3f) === 63 ? 64 : b & 0x3f;
      const bx = src[ip++]; // number of exceptions
      const mainBytes = bitunpackHoriz64(src, ip, count, mainBits, _tmp64_BN, 0);
      ip += mainBytes;
      ip = vbdec64_lo32(src, ip, bx, _ex32); // exception values (32-bit residuals above mainBits)
      for (let j = 0; j < bx; j++) {
        const pos = src[ip + j]; // exception position indices
        if (pos < count) _tmp64_BN[pos] = (_tmp64_BN[pos] | (BigInt(_ex32[j] >>> 0) << BigInt(mainBits))) & MASK64;
      }
      ip += bx;
      for (let i = 0; i < count; i++) {
        start = (start + _tmp64_BN[i]) & MASK64;
        dst[op + i] = start;
      }
    }

    op += count;
    remaining -= count;
  }

  return ip - srcOff;
}

// ─── Raw block decoders for fpxdec (no delta, no start value) ─────────────

/**
 * Decode one block of n <= 128 unsigned 32-bit values.
 * For n === CSIZE: uses 128v vertical format. Otherwise: scalar horizontal.
 * No delta or zigzag. Returns bytes consumed.
 */
export function p4dec128v32_block(src: Uint8Array, ip: number, n: number, dst: Uint32Array, dstOff: number): number {
  const ipStart = ip;
  const b = src[ip++];

  if ((b & 0xc0) === 0xc0) {
    // RLE: b & 0x3f gives bit-width, value stored as raw bytes (NOT vbxget)
    const mainBits = b & 0x3f;
    const bytesNeeded = (mainBits + 7) >> 3;
    let v = 0;
    for (let j = 0; j < bytesNeeded; j++) v |= src[ip + j] << (j * 8);
    if (mainBits < 32) v &= (1 << mainBits) - 1;
    v >>>= 0;
    ip += bytesNeeded;
    for (let i = 0; i < n; i++) dst[dstOff + i] = v;
    return ip - ipStart;
  }

  if (!(b & 0x40)) {
    const mainBits = b & 0x3f;
    if (b & 0x80) {
      const bx = src[ip++];
      for (let j = 0; j < 16; j++) _bitmapBuf[j] = src[ip + j];
      ip += 16;
      let nEx = 0;
      for (let j = 0; j < 16; j++) {
        let by = _bitmapBuf[j];
        while (by) {
          nEx++;
          by &= by - 1;
        }
      }
      ip += bitunpackHoriz32(src, ip, nEx, bx, _ex32, 0);
      if (n === CSIZE) {
        bitunpack128v32(src, ip, mainBits, _tmp32, 0);
        ip += mainBits * 16;
      } else {
        ip += bitunpackHoriz32(src, ip, n, mainBits, _tmp32, 0);
      }
      let k = 0;
      for (let j = 0; j < 16; j++) {
        let byte = _bitmapBuf[j];
        while (byte) {
          const ctz = 31 - Math.clz32(byte & -byte);
          const pos = j * 8 + ctz;
          if (pos < n) _tmp32[pos] = (_tmp32[pos] + (_ex32[k] << mainBits)) >>> 0;
          k++;
          byte &= byte - 1;
        }
      }
    } else {
      if (n === CSIZE) {
        bitunpack128v32(src, ip, mainBits, _tmp32, 0);
        ip += mainBits * 16;
      } else {
        ip += bitunpackHoriz32(src, ip, n, mainBits, _tmp32, 0);
      }
    }
    for (let i = 0; i < n; i++) dst[dstOff + i] = _tmp32[i];
    return ip - ipStart;
  }

  {
    const mainBits = b & 0x3f;
    const bxCount = src[ip++];
    if (n === CSIZE) {
      bitunpack128v32(src, ip, mainBits, _tmp32, 0);
      ip += mainBits * 16;
    } else {
      ip += bitunpackHoriz32(src, ip, n, mainBits, _tmp32, 0);
    }
    ip = vbdec32(src, ip, bxCount, _ex32, 0);
    for (let j = 0; j < bxCount; j++) {
      const pos = src[ip + j];
      if (pos < n) _tmp32[pos] = (_tmp32[pos] | (_ex32[j] << mainBits)) >>> 0;
    }
    ip += bxCount;
    for (let i = 0; i < n; i++) dst[dstOff + i] = _tmp32[i];
    return ip - ipStart;
  }
}

/**
 * Decode one block of n <= 128 unsigned 64-bit values using scalar horizontal format.
 * No delta or zigzag. Returns bytes consumed.
 */
export function p4dec64_block(src: Uint8Array, ip: number, n: number, dst: BigUint64Array, dstOff: number): number {
  const ipStart = ip;
  const b = src[ip++];

  if ((b & 0xc0) === 0xc0) {
    // RLE: b & 0x3f gives bit-width, value stored as raw bytes (NOT vbxget)
    let mainBits = b & 0x3f;
    if (mainBits === 63) mainBits = 64;
    const bytesNeeded = (mainBits + 7) >> 3;
    let v = 0n;
    for (let j = 0; j < bytesNeeded; j++) v |= BigInt(src[ip + j]) << BigInt(j * 8);
    if (mainBits < 64) v &= (1n << BigInt(mainBits)) - 1n;
    ip += bytesNeeded;
    for (let i = 0; i < n; i++) dst[dstOff + i] = v;
    return ip - ipStart;
  }

  const mainBits = b === 0x3f ? 64 : b & 0x3f;
  ip += bitunpackHoriz64(src, ip, n, mainBits, _tmp64_BN, 0);
  for (let i = 0; i < n; i++) dst[dstOff + i] = _tmp64_BN[i];
  return ip - ipStart;
}
