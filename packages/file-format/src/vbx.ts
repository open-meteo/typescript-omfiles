// vbx.ts — Variable-byte extended (vbxget) encoding used for PFor start values
//
// Format (UTF-8-like, big-endian MSBit-flagged):
//   1 byte  [0x00-0x7F]: value 0..127
//   2 bytes [0x80-0xBF, byte]: value = (b0&0x3F)<<8 | b1  → 0..16383
//   3 bytes [0xC0-0xDF, b1, b2]: value = (b0&0x1F)<<16 | b1<<8 | b2  (little-endian b1b2)
//           actually: value = (b0&0x1F)<<16 | ctou16LE(ptr)  → 0..2097151

// Read a vbx-encoded 32/16-bit unsigned value from src[offset].
// Returns [value, newOffset].
export function vbxget32(src: Uint8Array, offset: number): [number, number] {
  const b = src[offset++];
  if (!(b & 0x80)) {
    return [b, offset];
  }
  if (!(b & 0x40)) {
    // 2-byte: bswap16(ctou16(ptr-1) & 0xff3f)
    // = (src[offset] & 0xff) | ((b & 0x3f) << 8)
    const next = src[offset++];
    return [((b & 0x3f) << 8) | next, offset];
  }
  if (!(b & 0x20)) {
    // 3-byte: (b & 0x1f) << 16 | ctou16LE(ptr)
    const lo = src[offset] | (src[offset + 1] << 8);
    offset += 2;
    return [((b & 0x1f) << 16) | lo, offset];
  }
  if (!(b & 0x10)) {
    // 4-byte: bswap32(ctou32(ptr-1) & 0xffffff0f)
    const b1 = src[offset++];
    const b2 = src[offset++];
    const b3 = src[offset++];
    // bswap32(ctou32le(ptr-1) & 0xffffff0f)
    // ctou32le(ptr-1) = b | b1<<8 | b2<<16 | b3<<24
    // & 0xffffff0f: clears bits 4-7 (the top 4 bits of b which are 1110)
    // bswap32: result = b3 | b2<<8 | b1<<16 | (b&0x0f)<<24
    return [b3 | (b2 << 8) | (b1 << 16) | ((b & 0x0f) << 24), offset];
  }
  // 5-byte: (b & 0x07) << 32 | ctou32LE(ptr) — for 32-bit this truncates to 32 bits
  const lo32 = (src[offset] | (src[offset + 1] << 8) | (src[offset + 2] << 16) | (src[offset + 3] << 24)) >>> 0;
  offset += 4;
  return [lo32, offset]; // upper bits (b & 0x07) lost for 32-bit context
}

// vbxget16 uses the same format as vbxget32
export const vbxget16 = vbxget32;

// vbxget64: returns BigInt for 64-bit values
export function vbxget64(src: Uint8Array, offset: number): [bigint, number] {
  const b = src[offset++];
  if (!(b & 0x80)) {
    return [BigInt(b), offset];
  }
  if (!(b & 0x40)) {
    // 2-byte: bswap16(ctou16(ptr-1) & 0xff3f)
    const next = src[offset++];
    return [BigInt(((b & 0x3f) << 8) | next), offset];
  }
  if (!(b & 0x20)) {
    // 3-byte: (b & 0x1f) << 16 | ctou16LE(ptr)
    const lo = src[offset] | (src[offset + 1] << 8);
    offset += 2;
    return [BigInt(((b & 0x1f) << 16) | lo), offset];
  }
  if (!(b & 0x10)) {
    // 4-byte: bswap32(ctou32(ptr-1) & 0xffffff0f)
    const b1 = src[offset++];
    const b2 = src[offset++];
    const b3 = src[offset++];
    return [BigInt(b3 | (b2 << 8) | (b1 << 16) | ((b & 0x0f) << 24)), offset];
  }
  if (!(b & 0x08)) {
    // 5-byte: (b & 0x07) << 32 | ctou32LE(ptr)
    const lo32 = (src[offset] | (src[offset + 1] << 8) | (src[offset + 2] << 16) | (src[offset + 3] << 24)) >>> 0;
    offset += 4;
    return [BigInt(b & 0x07) * 0x100000000n + BigInt(lo32), offset];
  }
  if (!(b & 0x04)) {
    // 6-byte: (bswap16(ctou16(ip-1)) & 0x7ff) << 32 | ctou32(ip+1); ip += 5
    // ctou16(ip-1) = b | (src[offset] << 8), bswap16 = src[offset] | (b << 8), & 0x7ff
    const hiPart = src[offset] | ((b & 0x03) << 8); // 10-bit value
    offset++; // skip first byte of the pair
    const lo32 = (src[offset] | (src[offset + 1] << 8) | (src[offset + 2] << 16) | (src[offset + 3] << 24)) >>> 0;
    offset += 4;
    return [BigInt(hiPart) * 0x100000000n + BigInt(lo32), offset];
  }
  if (!(b & 0x02)) {
    // 7-byte: (b & 0x03) << 48 | ctou16LE(ip) << 32 | ctou32LE(ip+2); ip += 6
    const hi16 = (src[offset] | (src[offset + 1] << 8)) >>> 0;
    const lo32 = (src[offset + 2] | (src[offset + 3] << 8) | (src[offset + 4] << 16) | (src[offset + 5] << 24)) >>> 0;
    offset += 6;
    return [(BigInt(b & 0x03) << 48n) | (BigInt(hi16) << 32n) | BigInt(lo32), offset];
  }
  if (!(b & 0x01)) {
    // 8-byte: bswap64(ctou64(ip-1)) & 0x01ffffffffffffff; ip += 7
    // ctou64(ip-1) reads 8 bytes starting from b (LE), bswap64 reverses them
    // Result = high bits from first byte after masking, then 6 more bytes
    const b7 = src[offset + 6];
    const b6 = src[offset + 5];
    const b5 = src[offset + 4];
    const b4 = src[offset + 3];
    const b3 = src[offset + 2];
    const b2 = src[offset + 1];
    const b1 = src[offset + 0];
    // bswap64 of [b, b1, b2, b3, b4, b5, b6, b7] = [b7, b6, b5, b4, b3, b2, b1, b] & 0x01ff...
    // Actually: bswap64(ctou64(ip-1)) gives the 8 bytes reversed
    // ctou64LE(ip-1) = b + b1<<8 + ... + b7<<56
    // bswap64 = b7 + b6<<8 + ... + b<<56
    // & 0x01ffffffffffffff = (b<<56 + ... + b7) & mask → upper byte masked to 0x01
    // This is complex - let's use a simpler approach
    const val =
      (BigInt(b & 0x01) << 56n) |
      (BigInt(b1) << 48n) |
      (BigInt(b2) << 40n) |
      (BigInt(b3) << 32n) |
      (BigInt(b4) << 24n) |
      (BigInt(b5) << 16n) |
      (BigInt(b6) << 8n) |
      BigInt(b7);
    offset += 7;
    return [val, offset];
  }
  // 9-byte (b = 0xff): next 8 bytes are the value LE
  const lo32 = (src[offset] | (src[offset + 1] << 8) | (src[offset + 2] << 16) | (src[offset + 3] << 24)) >>> 0;
  const hi32 = (src[offset + 4] | (src[offset + 5] << 8) | (src[offset + 6] << 16) | (src[offset + 7] << 24)) >>> 0;
  offset += 8;
  return [BigInt(hi32) * 0x100000000n + BigInt(lo32), offset];
}
