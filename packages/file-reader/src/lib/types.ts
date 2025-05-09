export interface Range {
  start: number;
  end: number;
}

export interface OffsetSize {
  offset: number;
  size: number;
}

export enum CompressionType {
  /// Lossy compression using 2D delta coding and scale-factor.
  /// Only supports float and scales to 16-bit signed integer.
  PforDelta2dInt16 = 0,
  /// Lossless float/double compression using 2D xor coding.
  FpxXor2d = 1,
  /// PFor integer compression.
  /// f32 values are scaled to u32, f64 are scaled to u64.
  PforDelta2d = 2,
  /// Similar to `PforDelta2dInt16` but applies `log10(1+x)` before.
  PforDelta2dInt16Logarithmic = 3,
  None = 4,
}

export enum OmDataType {
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

export type TypedArray =
  | Int8Array
  | Uint8Array
  | Int16Array
  | Uint16Array
  | Int32Array
  | Uint32Array
  | Float32Array
  | Float64Array;
// | BigInt64Array
// | BigUint64Array;
