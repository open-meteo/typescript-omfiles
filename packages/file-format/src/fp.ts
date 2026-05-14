// fp.ts — Floating point XOR compression (fpxdec32, fpxdec64)
//
// Algorithm: TurboFloat XOR (from TurboPFor library)
// For each block of VSIZE=128 values:
//   1. Read 1 byte b = leading-zero shift count
//   2. Decode VSIZE values using p4dec128v (vertical PFor, pure unsigned, no delta)
//   3. For each value: output = reverseBits(packed) >> b ^ prev; prev = output
// For the remaining < VSIZE values: same but using scalar horizontal p4dec.
//
// The output uint32/uint64 bits are the float32/float64 bit patterns.

import { p4dec128v32_block, p4dec64_block } from "./turbopfor.js";

const VSIZE = 128;

// Reverse bits of a 32-bit integer
function reverseBits32(x: number): number {
  x = ((x & 0xaaaaaaaa) >>> 1) | ((x & 0x55555555) << 1);
  x = ((x & 0xcccccccc) >>> 2) | ((x & 0x33333333) << 2);
  x = ((x & 0xf0f0f0f0) >>> 4) | ((x & 0x0f0f0f0f) << 4);
  x = ((x & 0xff00ff00) >>> 8) | ((x & 0x00ff00ff) << 8);
  return ((x >>> 16) | (x << 16)) >>> 0;
}

// Reverse bits of a 64-bit BigInt via two 32-bit halves
function reverseBits64(x: bigint): bigint {
  const lo = reverseBits32(Number(x & 0xffffffffn));
  const hi = reverseBits32(Number((x >> 32n) & 0xffffffffn));
  return (BigInt(lo) << 32n) | BigInt(hi >>> 0);
}

const _fpTmp32 = new Uint32Array(VSIZE + 8);
const _fpTmp64 = new BigUint64Array(VSIZE + 8);

/**
 * Decode fpxdec32 compressed bytes into dst (uint32 bit patterns).
 * Call with start=0. Returns bytes consumed.
 */
export function fpxdec32(src: Uint8Array, srcOff: number, n: number, dst: Uint32Array, dstOff: number): number {
  if (n === 0) return 0;
  let ip = srcOff;
  let prev = 0;
  let op = dstOff;
  let remaining = n;

  while (remaining >= VSIZE) {
    const b = src[ip++];
    ip += p4dec128v32_block(src, ip, VSIZE, _fpTmp32, 0);
    for (let i = 0; i < VSIZE; i++) {
      const u = reverseBits32(_fpTmp32[i]) >>> b;
      const out = (u ^ prev) >>> 0;
      dst[op + i] = out;
      prev = out;
    }
    op += VSIZE;
    remaining -= VSIZE;
  }

  if (remaining > 0) {
    const b = src[ip++];
    ip += p4dec128v32_block(src, ip, remaining, _fpTmp32, 0);
    for (let i = 0; i < remaining; i++) {
      const u = reverseBits32(_fpTmp32[i]) >>> b;
      const out = (u ^ prev) >>> 0;
      dst[op + i] = out;
      prev = out;
    }
    op += remaining;
    remaining = 0;
  }

  return ip - srcOff;
}

/**
 * Decode fpxdec64 compressed bytes into dst (uint64 bit patterns, BigInt).
 * Call with start=0n. Returns bytes consumed.
 */
export function fpxdec64(src: Uint8Array, srcOff: number, n: number, dst: BigUint64Array, dstOff: number): number {
  if (n === 0) return 0;
  let ip = srcOff;
  let prev = 0n;
  let op = dstOff;
  let remaining = n;

  while (remaining > 0) {
    const count = Math.min(remaining, VSIZE);
    const b = src[ip++];
    ip += p4dec64_block(src, ip, count, _fpTmp64, 0);
    const bBig = BigInt(b);
    for (let i = 0; i < count; i++) {
      const u = reverseBits64(_fpTmp64[i]) >> bBig;
      const out = u ^ prev;
      dst[op + i] = out;
      prev = out;
    }
    op += count;
    remaining -= count;
  }

  return ip - srcOff;
}
