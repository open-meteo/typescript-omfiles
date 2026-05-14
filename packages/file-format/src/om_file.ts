// om_file.ts — OM file header and trailer parsing

import { OmHeaderType, OM_HEADER_V1_SIZE, OM_TRAILER_SIZE } from "./constants.js";

/**
 * Check the type of an OM file header.
 * `data` must be at least OM_HEADER_V1_SIZE (40) bytes for legacy files,
 * or OM_TRAILER_SIZE (24) bytes for V3 trailer detection.
 *
 * For initial detection, pass the first few bytes. Returns:
 * - OmHeaderType.Invalid: not an OM file
 * - OmHeaderType.Legacy: version 1 or 2 header (use om_header_size())
 * - OmHeaderType.ReadTrailer: version 3, must read trailer from end of file
 */
export function omHeaderType(data: Uint8Array): OmHeaderType {
  if (data.length < 3) return OmHeaderType.Invalid;
  if (data[0] !== 0x4f || data[1] !== 0x4d) return OmHeaderType.Invalid; // 'O','M'
  const version = data[2];
  if (version === 0 || version > 3) return OmHeaderType.Invalid;
  if (version === 3) return OmHeaderType.ReadTrailer;
  return OmHeaderType.Legacy; // version 1 or 2
}

/** Size of the V1/V2 legacy header (OmHeaderV1_t struct = 40 bytes). */
export function omHeaderSize(): number {
  return OM_HEADER_V1_SIZE;
}

/** Size of the V3 trailer (OmTrailer_t struct = 24 bytes). */
export function omTrailerSize(): number {
  return OM_TRAILER_SIZE;
}

/**
 * Parse the V3 trailer bytes. Returns { offset, size } of the root variable,
 * or null if the trailer is invalid.
 * `trailerData` must be exactly OM_TRAILER_SIZE (24) bytes.
 */
export function omTrailerRead(trailerData: Uint8Array): { offset: bigint; size: bigint } | null {
  if (trailerData.length < OM_TRAILER_SIZE) return null;
  // Trailer: uint8 magic1='O', uint8 magic2='M', uint8 version=3, uint8[5] padding,
  //           uint64_le offset, uint64_le size
  if (trailerData[0] !== 0x4f || trailerData[1] !== 0x4d || trailerData[2] !== 3) return null;
  const view = new DataView(trailerData.buffer, trailerData.byteOffset, trailerData.byteLength);
  const offset = view.getBigUint64(8, true);
  const size = view.getBigUint64(16, true);
  return { offset, size };
}
