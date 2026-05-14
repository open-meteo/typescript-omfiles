// om_decoder.ts — OM file chunk decoder (pure TypeScript port of om_decoder.c)

import { OmDataType, OmCompression, OmError, LUT_CHUNK_COUNT, OM_HEADER_V1_SIZE } from "./constants.js";
import {
  p4nzdec128v16,
  p4nddec128v16,
  p4nzdec128v32,
  p4nddec128v32,
  p4nzdec8,
  p4nddec8,
  p4nzdec64,
  p4nddec64,
} from "./turbopfor.js";
import { fpxdec32, fpxdec64 } from "./fp.js";
import {
  delta2dDecode8,
  delta2dDecode16,
  delta2dDecode32,
  delta2dDecode64,
  delta2dDecodeXor,
  delta2dDecodeXorDouble,
} from "./delta2d.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function divRoundUp(a: number, b: number): number {
  return Math.ceil(a / b);
}
function omMin(a: number, b: number): number {
  return a < b ? a : b;
}
function omMax(a: number, b: number): number {
  return a > b ? a : b;
}

// ─── Types ───────────────────────────────────────────────────────────────────

/** A contiguous range [lowerBound, upperBound). */
export interface OmRange {
  lowerBound: number;
  upperBound: number;
}

/** State for one LUT (index) read operation. */
export interface OmIndexRead {
  /** File byte offset to read. */
  offset: number;
  /** Byte count to read. */
  count: number;
  /** Which chunk indices are covered by this index read. */
  indexRange: OmRange;
  /** Chunk range the caller should process after reading. */
  chunkIndex: OmRange;
  /** Internal: next chunk to continue from. */
  nextChunk: OmRange;
}

/** State for one compressed-data read + decode operation. */
export interface OmDataRead {
  /** File byte offset to read. */
  offset: number;
  /** Byte count to read. */
  count: number;
  /** Which chunk indices are covered by this data read. */
  indexRange: OmRange;
  /** Chunk range to decode. */
  chunkIndex: OmRange;
  /** Internal: next chunk to continue from. */
  nextChunk: OmRange;
}

/** Immutable decoder configuration, created by omDecoderInit(). */
export interface OmDecoder {
  scaleFactor: number;
  addOffset: number;
  dimensions: number[];
  dimensionsCount: number;
  chunks: number[];
  readOffset: number[];
  readCount: number[];
  cubeOffset: number[] | null;
  cubeDimensions: number[] | null;
  lutChunkLength: number; // 0 = legacy V1; >1 = V3 compressed
  lutStart: number; // file byte offset of LUT start
  ioSizeMerge: number;
  ioSizeMax: number;
  numberOfChunks: number;
  dataType: OmDataType;
  compression: OmCompression;
  bytesPerElement: number;
  bytesPerElementCompressed: number;
}

/** Variable metadata needed to construct a decoder. */
export interface OmDecoderVariable {
  scaleFactor: number;
  addOffset: number;
  dataType: OmDataType;
  compression: OmCompression;
  dimensions: number[];
  chunks: number[];
  /** V3 array LUT size in bytes (0 for legacy). */
  lutSize: number;
  /** V3 array LUT start offset in file (40 for legacy). */
  lutOffset: number;
  /** True if this is a legacy V1/V2 file header. */
  isLegacy: boolean;
}

// ─── Decoder init ─────────────────────────────────────────────────────────────

/**
 * Initialise the decoder state.
 * Returns an OmDecoder on success, or an OmError code on failure.
 */
export function omDecoderInit(
  variable: OmDecoderVariable,
  dimensionCount: number,
  readOffset: number[],
  readCount: number[],
  cubeOffset: number[] | null,
  cubeDimensions: number[] | null,
  ioSizeMerge: number,
  ioSizeMax: number
): OmDecoder | OmError {
  const { scaleFactor, addOffset, dataType, compression, dimensions, chunks } = variable;

  let lutSize = variable.lutSize;
  let lutStart = variable.lutOffset;
  let lutChunkLength = variable.isLegacy ? 0 : 1;

  if (variable.isLegacy) {
    lutStart = OM_HEADER_V1_SIZE;
    lutSize = 0;
  }

  // Validate and compute total chunk count
  let nChunks = 1;
  for (let i = 0; i < dimensionCount; i++) {
    if (dimensions[i] === 0) return OmError.InvalidDimensions;
    if (chunks[i] === 0 || chunks[i] > dimensions[i]) return OmError.InvalidChunkDimensions;
    if (readOffset[i] >= dimensions[i]) return OmError.InvalidReadOffset;
    if (readCount[i] > dimensions[i] || readOffset[i] + readCount[i] > dimensions[i]) return OmError.InvalidReadCount;

    const cubeOff = cubeOffset == null ? 0 : cubeOffset[i];
    const cubeDim = cubeDimensions == null ? readCount[i] : cubeDimensions[i];
    if (cubeOff + readCount[i] > cubeDim) return OmError.InvalidCubeOffset;

    nChunks *= divRoundUp(dimensions[i], chunks[i]);
  }

  if (lutChunkLength > 0) {
    const nLutChunks = divRoundUp(nChunks + 1, LUT_CHUNK_COUNT);
    lutChunkLength = nLutChunks > 0 ? Math.floor(lutSize / nLutChunks) : 0;
  }

  const bpe = bytesPerElement(dataType);
  const bpec = bytesPerElementCompressed(dataType, compression);
  if (bpe === 0 || bpec === 0) return OmError.InvalidDataType;

  return {
    scaleFactor,
    addOffset,
    dimensions,
    dimensionsCount: dimensionCount,
    chunks,
    readOffset,
    readCount,
    cubeOffset,
    cubeDimensions,
    lutChunkLength,
    lutStart,
    ioSizeMerge,
    ioSizeMax,
    numberOfChunks: nChunks,
    dataType,
    compression,
    bytesPerElement: bpe,
    bytesPerElementCompressed: bpec,
  };
}

/** Bytes of chunk buffer needed for one chunk. */
export function omDecoderReadBufferSize(decoder: OmDecoder): number {
  let len = 1;
  for (let i = 0; i < decoder.dimensionsCount; i++) len *= decoder.chunks[i];
  return len * decoder.bytesPerElement;
}

// ─── Index read iteration ─────────────────────────────────────────────────────

/** Initialise the OmIndexRead state. Call before iterating with omNextIndexRead(). */
export function omInitIndexRead(decoder: OmDecoder): OmIndexRead {
  let chunkStart = 0;
  let chunkEnd = 1;

  for (let i = 0; i < decoder.dimensionsCount; i++) {
    const dim = decoder.dimensions[i];
    const chunk = decoder.chunks[i];
    const ro = decoder.readOffset[i];
    const rc = decoder.readCount[i];

    const chunksLower = Math.floor(ro / chunk);
    const chunksUpper = divRoundUp(ro + rc, chunk);
    const chunksCount = chunksUpper - chunksLower;
    const nChunksInDim = divRoundUp(dim, chunk);

    chunkStart = chunkStart * nChunksInDim + chunksLower;
    if (rc === dim) {
      chunkEnd = chunkEnd * nChunksInDim;
    } else {
      chunkEnd = chunkStart + chunksCount;
    }
  }

  return {
    offset: 0,
    count: 0,
    indexRange: { lowerBound: 0, upperBound: 0 },
    chunkIndex: { lowerBound: 0, upperBound: 0 },
    nextChunk: { lowerBound: chunkStart, upperBound: chunkEnd },
  };
}

/** Initialise OmDataRead from an OmIndexRead state. */
export function omInitDataRead(indexRead: OmIndexRead): OmDataRead {
  return {
    offset: 0,
    count: 0,
    indexRange: { ...indexRead.indexRange },
    chunkIndex: { lowerBound: 0, upperBound: 0 },
    nextChunk: { ...indexRead.chunkIndex },
  };
}

// ─── Internal: advance chunk position ────────────────────────────────────────

function _nextChunkPosition(decoder: OmDecoder, chunkIndex: OmRange): boolean {
  let rollingMultiply = 1;
  let linearReadCount = 1;
  let linearRead = true;
  const n = decoder.dimensionsCount;

  for (let iForward = 0; iForward < n; iForward++) {
    const i = n - iForward - 1;
    const dim = decoder.dimensions[i];
    const chunk = decoder.chunks[i];
    const ro = decoder.readOffset[i];
    const rc = decoder.readCount[i];

    const nChunksInDim = divRoundUp(dim, chunk);
    const chunksLower = Math.floor(ro / chunk);
    const chunksUpper = divRoundUp(ro + rc, chunk);
    const chunksCount = chunksUpper - chunksLower;

    chunkIndex.lowerBound += rollingMultiply;

    if (i === n - 1 && dim !== rc) {
      linearReadCount = chunksCount;
      linearRead = false;
    }
    if (linearRead && dim === rc) {
      linearReadCount *= nChunksInDim;
    } else {
      linearRead = false;
    }

    const c0 = Math.floor(chunkIndex.lowerBound / rollingMultiply) % nChunksInDim;

    if (c0 !== chunksUpper && c0 !== 0) {
      break;
    }

    chunkIndex.lowerBound -= chunksCount * rollingMultiply;
    rollingMultiply *= nChunksInDim;

    if (i === 0) {
      chunkIndex.upperBound = chunkIndex.lowerBound;
      return false;
    }
  }

  chunkIndex.upperBound = chunkIndex.lowerBound + linearReadCount;
  return true;
}

// ─── Next index (LUT) read ───────────────────────────────────────────────────

/**
 * Advance the index read state to the next batch.
 * Returns true if there is work to do (index_read.offset/count have been set).
 */
export function omNextIndexRead(decoder: OmDecoder, indexRead: OmIndexRead): boolean {
  if (indexRead.nextChunk.lowerBound >= indexRead.nextChunk.upperBound) return false;

  indexRead.chunkIndex = { ...indexRead.nextChunk };
  indexRead.indexRange.lowerBound = indexRead.nextChunk.lowerBound;

  let chunkIndex = indexRead.nextChunk.lowerBound;

  const isV3LUT = decoder.lutChunkLength > 1;
  const lutChunkElemCount = isV3LUT ? LUT_CHUNK_COUNT : 1;
  const lutChunkLength = isV3LUT ? decoder.lutChunkLength : 8; // sizeof(uint64_t)
  const ioSizeMax = decoder.ioSizeMax;

  const alignOffset = isV3LUT || indexRead.indexRange.lowerBound === 0 ? 0 : 1;
  const endAlignOffset = isV3LUT ? 1 : 0;

  const readStart = Math.floor((indexRead.nextChunk.lowerBound - alignOffset) / lutChunkElemCount) * lutChunkLength;

  while (true) {
    const maxRead = Math.floor(ioSizeMax / lutChunkLength) * lutChunkElemCount;
    const nextChunkCount = indexRead.nextChunk.upperBound - indexRead.nextChunk.lowerBound;
    const nextIncrement = omMax(1, omMin(maxRead - 1, nextChunkCount - 1));

    if (indexRead.nextChunk.lowerBound + nextIncrement >= indexRead.nextChunk.upperBound) {
      if (!_nextChunkPosition(decoder, indexRead.nextChunk)) {
        break;
      }
      const readEndNext =
        divRoundUp(indexRead.nextChunk.lowerBound + endAlignOffset, lutChunkElemCount) * lutChunkLength;
      const readStartNext = readEndNext - lutChunkLength;
      const readEndPrevious = Math.floor(chunkIndex / lutChunkElemCount) * lutChunkLength;

      if (readEndNext - readStart > ioSizeMax) break;
      if (readStartNext - readEndPrevious > decoder.ioSizeMerge) break;
    } else {
      const readEndNext =
        Math.floor((indexRead.nextChunk.lowerBound + nextIncrement + endAlignOffset) / lutChunkElemCount) *
        lutChunkLength;
      if (readEndNext - readStart > ioSizeMax) {
        indexRead.nextChunk.lowerBound += 1;
        break;
      }
      indexRead.nextChunk.lowerBound += nextIncrement;
    }
    chunkIndex = indexRead.nextChunk.lowerBound;
  }

  const readEnd = (Math.floor((chunkIndex + endAlignOffset) / lutChunkElemCount) + 1) * lutChunkLength;

  indexRead.offset = decoder.lutStart + readStart;
  indexRead.count = readEnd - readStart;
  indexRead.indexRange.upperBound = chunkIndex + 1;
  return true;
}

// ─── Next data read ──────────────────────────────────────────────────────────

/**
 * Decompress the LUT index data and determine the next data read range.
 * Returns true if there is work to do.
 */
export function omNextDataRead(
  decoder: OmDecoder,
  dataRead: OmDataRead,
  indexData: Uint8Array
): { result: boolean; error: OmError } {
  if (dataRead.nextChunk.lowerBound >= dataRead.nextChunk.upperBound) {
    return { result: false, error: OmError.Ok };
  }

  let chunkIndex = dataRead.nextChunk.lowerBound;
  dataRead.chunkIndex.lowerBound = chunkIndex;

  const nChunks = decoder.numberOfChunks;

  // ─── Legacy V1: LUT is a flat uint64 array ────────────────────────────────
  if (decoder.lutChunkLength === 0) {
    const isOffset0 = dataRead.indexRange.lowerBound === 0;
    const startOffset = isOffset0 ? 1 : 0;
    const lutView = new DataView(indexData.buffer, indexData.byteOffset, indexData.byteLength);

    let readPos = chunkIndex - dataRead.indexRange.lowerBound - startOffset;
    if (!isOffset0 && (readPos + 1) * 8 > indexData.byteLength) {
      return { result: false, error: OmError.OutOfBoundRead };
    }

    const startPos = isOffset0 && chunkIndex === 0 ? 0 : Number(lutView.getBigUint64(readPos * 8, true));
    let endPos = startPos;

    while (true) {
      readPos = dataRead.nextChunk.lowerBound - dataRead.indexRange.lowerBound - startOffset + 1;
      if ((readPos + 1) * 8 > indexData.byteLength) {
        return { result: false, error: OmError.OutOfBoundRead };
      }
      const dataEndPos = Number(lutView.getBigUint64(readPos * 8, true));

      if (
        startPos !== endPos &&
        (dataEndPos - startPos > decoder.ioSizeMax || dataEndPos - endPos > decoder.ioSizeMerge)
      ) {
        break;
      }
      endPos = dataEndPos;
      chunkIndex = dataRead.nextChunk.lowerBound;

      if (dataRead.nextChunk.lowerBound + 1 >= dataRead.nextChunk.upperBound) {
        if (!_nextChunkPosition(decoder, dataRead.nextChunk)) break;
      } else {
        dataRead.nextChunk.lowerBound += 1;
      }

      if (dataRead.nextChunk.lowerBound >= dataRead.indexRange.upperBound) {
        dataRead.nextChunk.lowerBound = 0;
        dataRead.nextChunk.upperBound = 0;
        break;
      }
    }

    // In legacy files, data follows the LUT immediately after the header
    const dataStart = OM_HEADER_V1_SIZE + nChunks * 8;
    dataRead.offset = startPos + dataStart;
    dataRead.count = endPos - startPos;
    dataRead.chunkIndex.upperBound = chunkIndex + 1;
    return { result: true, error: OmError.Ok };
  }

  // ─── V3: LUT chunks are compressed with p4nddec64 ────────────────────────
  const lutChunkLength = decoder.lutChunkLength;
  const lutOffset = Math.floor(dataRead.indexRange.lowerBound / LUT_CHUNK_COUNT) * lutChunkLength;

  const uncompressedLut = new BigUint64Array(LUT_CHUNK_COUNT);

  let lutChunk = Math.floor(chunkIndex / LUT_CHUNK_COUNT);

  // Decompress first LUT chunk
  {
    const thisElemCount = omMin((lutChunk + 1) * LUT_CHUNK_COUNT, nChunks + 1) - lutChunk * LUT_CHUNK_COUNT;
    const start = lutChunk * lutChunkLength - lutOffset;
    if (start + lutChunkLength > indexData.byteLength || thisElemCount > LUT_CHUNK_COUNT) {
      return { result: false, error: OmError.OutOfBoundRead };
    }
    p4nddec64(indexData, start, thisElemCount, uncompressedLut, 0);
  }

  const startPos = Number(uncompressedLut[chunkIndex % LUT_CHUNK_COUNT]);
  let endPos = startPos;

  while (true) {
    const nextLutChunk = Math.floor((dataRead.nextChunk.lowerBound + 1) / LUT_CHUNK_COUNT);

    if (nextLutChunk !== lutChunk) {
      const nextElemCount = omMin((nextLutChunk + 1) * LUT_CHUNK_COUNT, nChunks + 1) - nextLutChunk * LUT_CHUNK_COUNT;
      const start = nextLutChunk * lutChunkLength - lutOffset;
      if (start + lutChunkLength > indexData.byteLength || nextElemCount > LUT_CHUNK_COUNT) {
        return { result: false, error: OmError.OutOfBoundRead };
      }
      p4nddec64(indexData, start, nextElemCount, uncompressedLut, 0);
      lutChunk = nextLutChunk;
    }

    const dataEndPos = Number(uncompressedLut[(dataRead.nextChunk.lowerBound + 1) % LUT_CHUNK_COUNT]);

    if (
      startPos !== endPos &&
      (dataEndPos - startPos > decoder.ioSizeMax || dataEndPos - endPos > decoder.ioSizeMerge)
    ) {
      break;
    }
    endPos = dataEndPos;
    chunkIndex = dataRead.nextChunk.lowerBound;

    if (chunkIndex + 1 >= dataRead.nextChunk.upperBound) {
      if (!_nextChunkPosition(decoder, dataRead.nextChunk)) break;
    } else {
      dataRead.nextChunk.lowerBound += 1;
    }

    if (dataRead.nextChunk.lowerBound >= dataRead.indexRange.upperBound) {
      dataRead.nextChunk.lowerBound = 0;
      dataRead.nextChunk.upperBound = 0;
      break;
    }
  }

  dataRead.offset = startPos;
  dataRead.count = endPos - startPos;
  dataRead.chunkIndex.upperBound = chunkIndex + 1;
  return { result: true, error: OmError.Ok };
}

// ─── Decompression helpers ───────────────────────────────────────────────────

/** Decompress one chunk's worth of data. Returns bytes consumed. */
function omDecodeDecompress(
  dataType: OmDataType,
  compression: OmCompression,
  src: Uint8Array,
  srcOff: number,
  count: number,
  chunkBuf: Uint8Array
): number {
  switch (compression) {
    case OmCompression.PforDelta2dInt16:
    case OmCompression.PforDelta2dInt16Logarithmic: {
      const out = new Uint16Array(chunkBuf.buffer, chunkBuf.byteOffset, count);
      return p4nzdec128v16(src, srcOff, count, out, 0);
    }
    case OmCompression.FpxXor2d:
      if (dataType === OmDataType.FloatArray) {
        const out = new Uint32Array(chunkBuf.buffer, chunkBuf.byteOffset, count);
        return fpxdec32(src, srcOff, count, out, 0);
      } else {
        const out = new BigUint64Array(chunkBuf.buffer, chunkBuf.byteOffset, count);
        return fpxdec64(src, srcOff, count, out, 0);
      }
    case OmCompression.PforDelta2d:
      switch (dataType) {
        case OmDataType.Int8Array: {
          const out = new Uint8Array(chunkBuf.buffer, chunkBuf.byteOffset, count);
          return p4nzdec8(src, srcOff, count, out, 0);
        }
        case OmDataType.Uint8Array: {
          const out = new Uint8Array(chunkBuf.buffer, chunkBuf.byteOffset, count);
          return p4nddec8(src, srcOff, count, out, 0);
        }
        case OmDataType.Int16Array: {
          const out = new Uint16Array(chunkBuf.buffer, chunkBuf.byteOffset, count);
          return p4nzdec128v16(src, srcOff, count, out, 0);
        }
        case OmDataType.Uint16Array: {
          const out = new Uint16Array(chunkBuf.buffer, chunkBuf.byteOffset, count);
          return p4nddec128v16(src, srcOff, count, out, 0);
        }
        case OmDataType.Int32Array:
        case OmDataType.FloatArray: {
          const out = new Uint32Array(chunkBuf.buffer, chunkBuf.byteOffset, count);
          return p4nzdec128v32(src, srcOff, count, out, 0);
        }
        case OmDataType.Uint32Array: {
          const out = new Uint32Array(chunkBuf.buffer, chunkBuf.byteOffset, count);
          return p4nddec128v32(src, srcOff, count, out, 0);
        }
        case OmDataType.Int64Array:
        case OmDataType.DoubleArray: {
          const out = new BigUint64Array(chunkBuf.buffer, chunkBuf.byteOffset, count);
          return p4nzdec64(src, srcOff, count, out, 0);
        }
        case OmDataType.Uint64Array: {
          const out = new BigUint64Array(chunkBuf.buffer, chunkBuf.byteOffset, count);
          return p4nddec64(src, srcOff, count, out, 0);
        }
        default:
          return 0;
      }
    case OmCompression.None:
    default:
      return 0;
  }
}

/** Apply 2D delta/XOR filter in-place on the chunk buffer. */
function omDecodeFilter(
  dataType: OmDataType,
  compression: OmCompression,
  chunkBuf: Uint8Array,
  lengthInChunk: number,
  lengthLast: number
): void {
  const width = lengthInChunk / lengthLast;
  switch (compression) {
    case OmCompression.PforDelta2dInt16:
    case OmCompression.PforDelta2dInt16Logarithmic: {
      const view = new Int16Array(chunkBuf.buffer, chunkBuf.byteOffset, lengthInChunk);
      delta2dDecode16(width, lengthLast, view);
      break;
    }
    case OmCompression.FpxXor2d:
      if (dataType === OmDataType.FloatArray) {
        const view = new Uint32Array(chunkBuf.buffer, chunkBuf.byteOffset, lengthInChunk);
        delta2dDecodeXor(width, lengthLast, view);
      } else {
        const view = new BigUint64Array(chunkBuf.buffer, chunkBuf.byteOffset, lengthInChunk);
        delta2dDecodeXorDouble(width, lengthLast, view);
      }
      break;
    case OmCompression.PforDelta2d:
      switch (dataType) {
        case OmDataType.Int8Array:
        case OmDataType.Uint8Array: {
          const view = new Int8Array(chunkBuf.buffer, chunkBuf.byteOffset, lengthInChunk);
          delta2dDecode8(width, lengthLast, view);
          break;
        }
        case OmDataType.Int16Array:
        case OmDataType.Uint16Array: {
          const view = new Int16Array(chunkBuf.buffer, chunkBuf.byteOffset, lengthInChunk);
          delta2dDecode16(width, lengthLast, view);
          break;
        }
        case OmDataType.Int32Array:
        case OmDataType.Uint32Array:
        case OmDataType.FloatArray: {
          const view = new Int32Array(chunkBuf.buffer, chunkBuf.byteOffset, lengthInChunk);
          delta2dDecode32(width, lengthLast, view);
          break;
        }
        case OmDataType.Int64Array:
        case OmDataType.Uint64Array:
        case OmDataType.DoubleArray: {
          const view = new BigInt64Array(chunkBuf.buffer, chunkBuf.byteOffset, lengthInChunk);
          delta2dDecode64(width, lengthLast, view);
          break;
        }
        default:
          break;
      }
      break;
    case OmCompression.None:
    default:
      break;
  }
}

const INT16_MAX = 32767;
const INT32_MAX = 2147483647;
const INT64_MAX = 9223372036854775807n;

/** Copy decoded values from chunkBuf (at element index `d`) to `output` (at element index `q`). */
function omDecodeCopy(
  dataType: OmDataType,
  compression: OmCompression,
  count: number,
  scaleFactor: number,
  addOffset: number,
  chunkBuf: Uint8Array,
  d: number, // element offset in chunkBuf
  bytesPerElementCompressed: number,
  output:
    | Float32Array
    | Float64Array
    | Int8Array
    | Uint8Array
    | Int16Array
    | Uint16Array
    | Int32Array
    | Uint32Array
    | BigInt64Array
    | BigUint64Array,
  q: number // element offset in output
): void {
  switch (compression) {
    case OmCompression.PforDelta2dInt16: {
      const src = new Int16Array(chunkBuf.buffer, chunkBuf.byteOffset + d * 2, count);
      const dst = output as Float32Array;
      for (let i = 0; i < count; i++) {
        const v = src[i];
        dst[q + i] = v === INT16_MAX ? NaN : v / scaleFactor - addOffset;
      }
      break;
    }
    case OmCompression.PforDelta2dInt16Logarithmic: {
      const src = new Int16Array(chunkBuf.buffer, chunkBuf.byteOffset + d * 2, count);
      const dst = output as Float32Array;
      for (let i = 0; i < count; i++) {
        const v = src[i];
        dst[q + i] = v === INT16_MAX ? NaN : Math.pow(10, v / scaleFactor) - 1;
      }
      break;
    }
    case OmCompression.FpxXor2d:
      if (dataType === OmDataType.FloatArray) {
        // Uint32 bits → Float32 (reinterpret cast via shared buffer)
        const srcU32 = new Uint32Array(chunkBuf.buffer, chunkBuf.byteOffset + d * 4, count);
        const dstF32 = output as Float32Array;
        // Fastest reinterpret: use a shared DataView
        const tmp = new DataView(chunkBuf.buffer, chunkBuf.byteOffset + d * 4);
        for (let i = 0; i < count; i++) {
          dstF32[q + i] = tmp.getFloat32(i * 4, true);
        }
      } else {
        // BigUint64 bits → Float64
        const srcU64 = new BigUint64Array(chunkBuf.buffer, chunkBuf.byteOffset + d * 8, count);
        const dstF64 = output as Float64Array;
        const tmp = new DataView(chunkBuf.buffer, chunkBuf.byteOffset + d * 8);
        for (let i = 0; i < count; i++) {
          dstF64[q + i] = tmp.getFloat64(i * 8, true);
        }
      }
      break;
    case OmCompression.PforDelta2d:
      switch (dataType) {
        case OmDataType.Int8Array:
        case OmDataType.Uint8Array: {
          const src = new Uint8Array(chunkBuf.buffer, chunkBuf.byteOffset + d, count);
          const dst = output as Int8Array | Uint8Array;
          for (let i = 0; i < count; i++) dst[q + i] = src[i];
          break;
        }
        case OmDataType.Int16Array:
        case OmDataType.Uint16Array: {
          const src = new Uint16Array(chunkBuf.buffer, chunkBuf.byteOffset + d * 2, count);
          const dst = output as Int16Array | Uint16Array;
          for (let i = 0; i < count; i++) dst[q + i] = src[i];
          break;
        }
        case OmDataType.Int32Array:
        case OmDataType.Uint32Array: {
          const src = new Uint32Array(chunkBuf.buffer, chunkBuf.byteOffset + d * 4, count);
          const dst = output as Int32Array | Uint32Array;
          for (let i = 0; i < count; i++) dst[q + i] = src[i];
          break;
        }
        case OmDataType.FloatArray: {
          // Int32 → Float32 with scale
          const src = new Int32Array(chunkBuf.buffer, chunkBuf.byteOffset + d * 4, count);
          const dst = output as Float32Array;
          for (let i = 0; i < count; i++) {
            const v = src[i];
            dst[q + i] = v === INT32_MAX ? NaN : v / scaleFactor - addOffset;
          }
          break;
        }
        case OmDataType.Int64Array:
        case OmDataType.Uint64Array: {
          const src = new BigUint64Array(chunkBuf.buffer, chunkBuf.byteOffset + d * 8, count);
          const dst = output as BigInt64Array | BigUint64Array;
          for (let i = 0; i < count; i++) dst[q + i] = src[i];
          break;
        }
        case OmDataType.DoubleArray: {
          const src = new BigInt64Array(chunkBuf.buffer, chunkBuf.byteOffset + d * 8, count);
          const dst = output as Float64Array;
          const sf = scaleFactor;
          const ao = addOffset;
          for (let i = 0; i < count; i++) {
            const v = src[i];
            dst[q + i] = v === BigInt(INT64_MAX) ? NaN : Number(v) / sf - ao;
          }
          break;
        }
        default:
          break;
      }
      break;
    case OmCompression.None:
    default:
      break;
  }
}

// ─── Chunk decode ─────────────────────────────────────────────────────────────

type OutputArray =
  | Float32Array
  | Float64Array
  | Int8Array
  | Uint8Array
  | Int16Array
  | Uint16Array
  | Int32Array
  | Uint32Array
  | BigInt64Array
  | BigUint64Array;

/** Decode one chunk. Returns bytes consumed from `data`. */
function _decodeChunk(
  decoder: OmDecoder,
  chunkIndex: number,
  data: Uint8Array,
  dataOff: number,
  output: OutputArray,
  chunkBuf: Uint8Array
): number {
  let rollingMultiply = 1;
  let rollingMultiplyChunkLength = 1;
  let rollingMultiplyTargetCube = 1;

  let d = 0;
  let q = 0;
  let linearReadCount = 1;
  let linearRead = true;
  let lengthLast = 0;
  let noData = false;

  const n = decoder.dimensionsCount;

  // First pass: compute d (chunk buffer offset), q (output offset), lengthInChunk
  for (let iForward = 0; iForward < n; iForward++) {
    const i = n - iForward - 1;
    const dim = decoder.dimensions[i];
    const chunk = decoder.chunks[i];
    const ro = decoder.readOffset[i];
    const rc = decoder.readCount[i];
    const cubeOff = decoder.cubeOffset == null ? 0 : decoder.cubeOffset[i];
    const cubeDim = decoder.cubeDimensions == null ? rc : decoder.cubeDimensions[i];

    const nChunksInDim = divRoundUp(dim, chunk);
    const c0 = Math.floor(chunkIndex / rollingMultiply) % nChunksInDim;
    const chunkGlobalStart = c0 * chunk;
    const chunkGlobalEnd = omMin((c0 + 1) * chunk, dim);
    const length0 = chunkGlobalEnd - chunkGlobalStart;
    const clampedGlobalStart = omMax(chunkGlobalStart, ro);
    const clampedGlobalEnd = omMin(chunkGlobalEnd, ro + rc);
    const clampedLocalStart = clampedGlobalStart - c0 * chunk;
    const lengthRead = clampedGlobalEnd - clampedGlobalStart;

    if (ro + rc <= chunkGlobalStart || ro >= chunkGlobalEnd) noData = true;

    if (i === n - 1) lengthLast = length0;

    const t0 = chunkGlobalStart - ro + clampedLocalStart;
    const q0 = t0 + cubeOff;

    d += rollingMultiplyChunkLength * clampedLocalStart;
    q += rollingMultiplyTargetCube * q0;

    if (i === n - 1 && !(lengthRead === length0 && rc === length0 && cubeDim === length0)) {
      linearReadCount = lengthRead;
      linearRead = false;
    }
    if (linearRead && lengthRead === length0 && rc === length0 && cubeDim === length0) {
      linearReadCount *= length0;
    } else {
      linearRead = false;
    }

    rollingMultiply *= nChunksInDim;
    rollingMultiplyTargetCube *= cubeDim;
    rollingMultiplyChunkLength *= length0;
  }

  const lengthInChunk = rollingMultiplyChunkLength;

  // Decompress
  const uncompressedBytes = omDecodeDecompress(
    decoder.dataType,
    decoder.compression,
    data,
    dataOff,
    lengthInChunk,
    chunkBuf
  );

  if (noData) return uncompressedBytes;

  // 2D filter
  omDecodeFilter(decoder.dataType, decoder.compression, chunkBuf, lengthInChunk, lengthLast);

  // Scatter-copy loop
  while (true) {
    omDecodeCopy(
      decoder.dataType,
      decoder.compression,
      linearReadCount,
      decoder.scaleFactor,
      decoder.addOffset,
      chunkBuf,
      d,
      decoder.bytesPerElementCompressed,
      output,
      q
    );

    q += linearReadCount - 1;
    d += linearReadCount - 1;

    // Re-init for next run
    rollingMultiply = 1;
    rollingMultiplyTargetCube = 1;
    rollingMultiplyChunkLength = 1;
    linearReadCount = 1;
    linearRead = true;

    for (let iForward = 0; iForward < n; iForward++) {
      const i = n - iForward - 1;
      const dim = decoder.dimensions[i];
      const chunk = decoder.chunks[i];
      const ro = decoder.readOffset[i];
      const rc = decoder.readCount[i];
      const cubeDim = decoder.cubeDimensions == null ? rc : decoder.cubeDimensions[i];

      const nChunksInDim = divRoundUp(dim, chunk);
      const c0 = Math.floor(chunkIndex / rollingMultiply) % nChunksInDim;
      const chunkGlobalStart = c0 * chunk;
      const chunkGlobalEnd = omMin((c0 + 1) * chunk, dim);
      const length0 = chunkGlobalEnd - chunkGlobalStart;
      const clampedGlobalStart = omMax(chunkGlobalStart, ro);
      const clampedGlobalEnd = omMin(chunkGlobalEnd, ro + rc);
      const clampedLocalEnd = clampedGlobalEnd - chunkGlobalStart;
      const lengthRead = clampedGlobalEnd - clampedGlobalStart;

      d += rollingMultiplyChunkLength;
      q += rollingMultiplyTargetCube;

      if (i === n - 1 && !(lengthRead === length0 && rc === length0 && cubeDim === length0)) {
        linearReadCount = lengthRead;
        linearRead = false;
      }
      if (linearRead && lengthRead === length0 && rc === length0 && cubeDim === length0) {
        linearReadCount *= length0;
      } else {
        linearRead = false;
      }

      const d0 = Math.floor(d / rollingMultiplyChunkLength) % length0;
      if (d0 !== clampedLocalEnd && d0 !== 0) break;

      d -= lengthRead * rollingMultiplyChunkLength;
      q -= lengthRead * rollingMultiplyTargetCube;

      rollingMultiply *= nChunksInDim;
      rollingMultiplyTargetCube *= cubeDim;
      rollingMultiplyChunkLength *= length0;

      if (i === 0) return uncompressedBytes;
    }
  }
}

/**
 * Decode all chunks in the given range.
 * `data` is the compressed data read from the file (at `dataRead.offset`).
 * `output` is the destination array (already allocated to the full read shape).
 * `chunkBuf` is a scratch buffer; allocate it with omDecoderReadBufferSize().
 */
export function omDecodeChunks(
  decoder: OmDecoder,
  chunkRange: OmRange,
  data: Uint8Array,
  output: OutputArray,
  chunkBuf: Uint8Array
): OmError {
  let pos = 0;
  for (let chunkNum = chunkRange.lowerBound; chunkNum < chunkRange.upperBound; chunkNum++) {
    if (pos >= data.byteLength) return OmError.DeflatedSizeMismatch;
    const consumed = _decodeChunk(decoder, chunkNum, data, pos, output, chunkBuf);
    pos += consumed;
  }
  if (pos !== data.byteLength) return OmError.DeflatedSizeMismatch;
  return OmError.Ok;
}

// ─── Byte size helpers (duplicated from constants.ts to avoid circular) ──────

function bytesPerElement(dataType: OmDataType): number {
  switch (dataType) {
    case OmDataType.Int8Array:
    case OmDataType.Uint8Array:
      return 1;
    case OmDataType.Int16Array:
    case OmDataType.Uint16Array:
      return 2;
    case OmDataType.Int32Array:
    case OmDataType.Uint32Array:
    case OmDataType.FloatArray:
      return 4;
    case OmDataType.Int64Array:
    case OmDataType.Uint64Array:
    case OmDataType.DoubleArray:
      return 8;
    default:
      return 0;
  }
}

function bytesPerElementCompressed(dataType: OmDataType, compression: OmCompression): number {
  switch (compression) {
    case OmCompression.PforDelta2dInt16:
    case OmCompression.PforDelta2dInt16Logarithmic:
      return 2;
    case OmCompression.FpxXor2d:
    case OmCompression.PforDelta2d:
    case OmCompression.None:
      return bytesPerElement(dataType);
    default:
      return bytesPerElement(dataType);
  }
}
