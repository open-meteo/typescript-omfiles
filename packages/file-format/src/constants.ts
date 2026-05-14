// constants.ts — OM file format enums and constants

export const enum OmDataType {
  None = 0,
  Int8 = 1,
  Uint8 = 2,
  Int16 = 3,
  Uint16 = 4,
  Int32 = 5,
  Uint32 = 6,
  Int64 = 7,
  Uint64 = 8,
  Float = 9,
  Double = 10,
  String = 11,
  Int8Array = 12,
  Uint8Array = 13,
  Int16Array = 14,
  Uint16Array = 15,
  Int32Array = 16,
  Uint32Array = 17,
  Int64Array = 18,
  Uint64Array = 19,
  FloatArray = 20,
  DoubleArray = 21,
  StringArray = 22,
}

export const enum OmCompression {
  PforDelta2dInt16 = 0,
  FpxXor2d = 1,
  PforDelta2d = 2,
  PforDelta2dInt16Logarithmic = 3,
  None = 4,
}

export const enum OmError {
  Ok = 0,
  InvalidCompressionType = 1,
  InvalidDataType = 2,
  OutOfBoundRead = 3,
  NotAnOmFile = 4,
  DeflatedSizeMismatch = 5,
  InvalidDimensions = 6,
  InvalidChunkDimensions = 7,
  InvalidReadOffset = 8,
  InvalidReadCount = 9,
  InvalidCubeOffset = 10,
}

export const enum OmHeaderType {
  Invalid = 0,
  Legacy = 1,
  ReadTrailer = 2,
}

// Size of the V1 header (OmHeaderV1_t struct)
export const OM_HEADER_V1_SIZE = 40;

// Size of the V3 trailer (OmTrailer_t struct) = magic(2) + version(1) + padding(5) + offset(8) + size(8)
export const OM_TRAILER_SIZE = 24;

// Number of chunks per LUT chunk in V3 files
export const LUT_CHUNK_COUNT = 64;

// Bytes per element for each data type
export function bytesPerElement(dataType: OmDataType): number {
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

// Bytes per element in compressed form
export function bytesPerElementCompressed(dataType: OmDataType, compression: OmCompression): number {
  switch (compression) {
    case OmCompression.PforDelta2dInt16:
    case OmCompression.PforDelta2dInt16Logarithmic:
      return 2; // float → int16
    case OmCompression.FpxXor2d:
    case OmCompression.PforDelta2d:
      return bytesPerElement(dataType);
    default:
      return bytesPerElement(dataType);
  }
}
