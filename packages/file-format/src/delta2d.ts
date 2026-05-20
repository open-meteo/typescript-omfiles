// delta2d.ts — 2D delta / XOR filter for OM file format
//
// After TurboPFor decompression, these filters reconstruct the original values
// by reversing the 2D delta coding applied during compression.
//
// Layout: data[d0 * length1 + d1] where d0 is the "slow" (row) dimension
// and d1 is the "fast" (column) dimension.
// The delta is applied along d0 (rows), comparing each row to the previous.

/** In-place 2D delta decode for Int8/Uint8 buffers. */
export function delta2dDecode8(length0: number, length1: number, buf: Int8Array | Uint8Array): void {
  for (let d0 = 1; d0 < length0; d0++) {
    const rowOff = d0 * length1;
    const prevOff = (d0 - 1) * length1;
    for (let d1 = 0; d1 < length1; d1++) {
      buf[rowOff + d1] = (buf[rowOff + d1] + buf[prevOff + d1]) & 0xff;
    }
  }
}

/** In-place 2D delta decode for Int16/Uint16 buffers. */
export function delta2dDecode16(length0: number, length1: number, buf: Int16Array | Uint16Array): void {
  for (let d0 = 1; d0 < length0; d0++) {
    const rowOff = d0 * length1;
    const prevOff = (d0 - 1) * length1;
    for (let d1 = 0; d1 < length1; d1++) {
      buf[rowOff + d1] = (buf[rowOff + d1] + buf[prevOff + d1]) & 0xffff;
    }
  }
}

/** In-place 2D delta decode for Int32/Uint32 buffers. */
export function delta2dDecode32(length0: number, length1: number, buf: Int32Array | Uint32Array): void {
  for (let d0 = 1; d0 < length0; d0++) {
    const rowOff = d0 * length1;
    const prevOff = (d0 - 1) * length1;
    for (let d1 = 0; d1 < length1; d1++) {
      buf[rowOff + d1] = (buf[rowOff + d1] + buf[prevOff + d1]) >>> 0;
    }
  }
}

/** In-place 2D delta decode for Int64/Uint64 buffers. */
export function delta2dDecode64(length0: number, length1: number, buf: BigInt64Array | BigUint64Array): void {
  for (let d0 = 1; d0 < length0; d0++) {
    const rowOff = d0 * length1;
    const prevOff = (d0 - 1) * length1;
    for (let d1 = 0; d1 < length1; d1++) {
      buf[rowOff + d1] = buf[rowOff + d1] + buf[prevOff + d1];
    }
  }
}

/**
 * In-place 2D XOR decode for Float32 buffers (used with COMPRESSION_FPX_XOR2D).
 * Operates on the float bits as uint32.
 */
export function delta2dDecodeXor(length0: number, length1: number, buf: Uint32Array): void {
  for (let d0 = 1; d0 < length0; d0++) {
    const rowOff = d0 * length1;
    const prevOff = (d0 - 1) * length1;
    for (let d1 = 0; d1 < length1; d1++) {
      buf[rowOff + d1] = (buf[rowOff + d1] ^ buf[prevOff + d1]) >>> 0;
    }
  }
}

/**
 * In-place 2D XOR decode for Float64 buffers (used with COMPRESSION_FPX_XOR2D for doubles).
 * Operates on the double bits as uint64 (via BigUint64Array view).
 */
export function delta2dDecodeXorDouble(length0: number, length1: number, buf: BigUint64Array): void {
  for (let d0 = 1; d0 < length0; d0++) {
    const rowOff = d0 * length1;
    const prevOff = (d0 - 1) * length1;
    for (let d1 = 0; d1 < length1; d1++) {
      buf[rowOff + d1] = buf[rowOff + d1] ^ buf[prevOff + d1];
    }
  }
}
