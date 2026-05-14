// om_variable.ts — OM file variable metadata reader (pure TypeScript)
//
// Supports OmVariableV3_t (scalar) and OmVariableArrayV3_t (array) layouts,
// plus the legacy OmHeaderV1_t layout.

import { OmDataType, OmCompression, OM_HEADER_V1_SIZE } from "./constants.js";

// Memory layout types (matches C OmMemoryLayout_t)
const enum MemLayout {
  Legacy = 0,
  Array = 1,
  Scalar = 3,
}

// OmVariableV3_t offsets (8 bytes total):
//   uint8  data_type        (+0)
//   uint8  compression_type (+1)
//   uint16 name_size        (+2)
//   uint32 children_count   (+4)
const V3_OFF_DATA_TYPE = 0;
const V3_OFF_COMPRESSION = 1;
const V3_OFF_NAME_SIZE = 2;
const V3_OFF_CHILDREN_COUNT = 4;
const SIZEOF_V3 = 8;

// OmVariableArrayV3_t offsets (40 bytes total):
// [V3_OFF_*] same as above for first 8 bytes, then:
//   uint64 lut_size         (+8)
//   uint64 lut_offset       (+16)
//   uint64 dimension_count  (+24)
//   float  scale_factor     (+32)
//   float  add_offset       (+36)
const ARRAY_OFF_LUT_SIZE = 8;
const ARRAY_OFF_LUT_OFFSET = 16;
const ARRAY_OFF_DIM_COUNT = 24;
const ARRAY_OFF_SCALE_FACTOR = 32;
const ARRAY_OFF_ADD_OFFSET = 36;
const SIZEOF_ARRAY_V3 = 40;

// Legacy OmHeaderV1_t offsets (40 bytes):
//   uint8  magic1='O'  (+0)
//   uint8  magic2='M'  (+1)
//   uint8  version     (+2)
//   uint8  compression (+3)   (only for version 2; v1 always PFOR_INT16)
//   float  scalefactor (+4)
//   uint32 dim0        (+8)  [but actually uint64]
//   uint32 dim1        (+16)
//   uint32 chunk0      (+24)
//   uint32 chunk1      (+32)
const LEGACY_OFF_VERSION = 2;
const LEGACY_OFF_COMPRESSION = 3;
const LEGACY_OFF_SCALE_FACTOR = 4;
const LEGACY_OFF_DIM0 = 8;
const LEGACY_OFF_DIM1 = 16;
const LEGACY_OFF_CHUNK0 = 24;
const LEGACY_OFF_CHUNK1 = 32;

function getMemLayout(data: Uint8Array): MemLayout {
  // Check if legacy (magic bytes 'O','M' + version 1 or 2)
  if (data[0] === 0x4f && data[1] === 0x4d && (data[2] === 1 || data[2] === 2)) {
    return MemLayout.Legacy;
  }
  // V3: check if array (data_type >= 12 && <= 21)
  const dataType = data[V3_OFF_DATA_TYPE];
  if (dataType >= OmDataType.Int8Array && dataType <= OmDataType.DoubleArray) {
    return MemLayout.Array;
  }
  return MemLayout.Scalar;
}

function readU16LE(data: Uint8Array, off: number): number {
  return (data[off] | (data[off + 1] << 8)) >>> 0;
}
function readU32LE(data: Uint8Array, off: number): number {
  return (data[off] | (data[off + 1] << 8) | (data[off + 2] << 16) | (data[off + 3] << 24)) >>> 0;
}
function readU64LE(data: Uint8Array, off: number): bigint {
  const lo = readU32LE(data, off);
  const hi = readU32LE(data, off + 4);
  return BigInt(lo) | (BigInt(hi) << 32n);
}
function readF32LE(data: Uint8Array, off: number): number {
  const view = new DataView(data.buffer, data.byteOffset + off, 4);
  return view.getFloat32(0, true);
}

/**
 * OmVariable — wraps a raw byte slice representing a variable's metadata.
 * Implements the same operations as the C om_variable_* functions.
 */
export class OmVariable {
  constructor(public readonly data: Uint8Array) {}

  private get layout(): MemLayout {
    return getMemLayout(this.data);
  }

  getDataType(): OmDataType {
    const layout = this.layout;
    if (layout === MemLayout.Legacy) return OmDataType.FloatArray;
    return this.data[V3_OFF_DATA_TYPE] as OmDataType;
  }

  getCompression(): OmCompression {
    const layout = this.layout;
    if (layout === MemLayout.Legacy) {
      if (this.data[LEGACY_OFF_VERSION] === 1) return OmCompression.PforDelta2dInt16;
      return this.data[LEGACY_OFF_COMPRESSION] as OmCompression;
    }
    return this.data[V3_OFF_COMPRESSION] as OmCompression;
  }

  getScaleFactor(): number {
    const layout = this.layout;
    if (layout === MemLayout.Legacy) return readF32LE(this.data, LEGACY_OFF_SCALE_FACTOR);
    if (layout === MemLayout.Array) return readF32LE(this.data, ARRAY_OFF_SCALE_FACTOR);
    return 1;
  }

  getAddOffset(): number {
    const layout = this.layout;
    if (layout === MemLayout.Legacy) return 0;
    if (layout === MemLayout.Array) return readF32LE(this.data, ARRAY_OFF_ADD_OFFSET);
    return 0;
  }

  getDimensionsCount(): bigint {
    const layout = this.layout;
    if (layout === MemLayout.Legacy) return 2n;
    if (layout === MemLayout.Array) return readU64LE(this.data, ARRAY_OFF_DIM_COUNT);
    return 0n;
  }

  getDimensions(): BigUint64Array {
    const layout = this.layout;
    if (layout === MemLayout.Legacy) {
      const result = new BigUint64Array(2);
      result[0] = readU64LE(this.data, LEGACY_OFF_DIM0);
      result[1] = readU64LE(this.data, LEGACY_OFF_DIM1);
      return result;
    }
    if (layout === MemLayout.Array) {
      const childrenCount = readU32LE(this.data, V3_OFF_CHILDREN_COUNT);
      const dimCount = Number(readU64LE(this.data, ARRAY_OFF_DIM_COUNT));
      const off = SIZEOF_ARRAY_V3 + childrenCount * 16;
      const result = new BigUint64Array(dimCount);
      for (let i = 0; i < dimCount; i++) {
        result[i] = readU64LE(this.data, off + i * 8);
      }
      return result;
    }
    return new BigUint64Array(0);
  }

  getChunks(): BigUint64Array {
    const layout = this.layout;
    if (layout === MemLayout.Legacy) {
      const result = new BigUint64Array(2);
      result[0] = readU64LE(this.data, LEGACY_OFF_CHUNK0);
      result[1] = readU64LE(this.data, LEGACY_OFF_CHUNK1);
      return result;
    }
    if (layout === MemLayout.Array) {
      const childrenCount = readU32LE(this.data, V3_OFF_CHILDREN_COUNT);
      const dimCount = Number(readU64LE(this.data, ARRAY_OFF_DIM_COUNT));
      // Chunks come after dimensions array
      const off = SIZEOF_ARRAY_V3 + childrenCount * 16 + dimCount * 8;
      const result = new BigUint64Array(dimCount);
      for (let i = 0; i < dimCount; i++) {
        result[i] = readU64LE(this.data, off + i * 8);
      }
      return result;
    }
    return new BigUint64Array(0);
  }

  getChildrenCount(): number {
    const layout = this.layout;
    if (layout === MemLayout.Legacy) return 0;
    return readU32LE(this.data, V3_OFF_CHILDREN_COUNT);
  }

  /** Get offset and size of the i-th child variable. Returns null on error. */
  getChild(index: number): { offset: bigint; size: bigint } | null {
    const layout = this.layout;
    if (layout === MemLayout.Legacy) return null;
    const childrenCount = readU32LE(this.data, V3_OFF_CHILDREN_COUNT);
    if (index < 0 || index >= childrenCount) return null;

    const baseOff = layout === MemLayout.Array ? SIZEOF_ARRAY_V3 : SIZEOF_V3;
    // sizes array starts right after the base struct
    const sizesOff = baseOff;
    // offsets array starts after all sizes
    const offsetsOff = baseOff + childrenCount * 8;

    const size = readU64LE(this.data, sizesOff + index * 8);
    const offset = readU64LE(this.data, offsetsOff + index * 8);
    return { offset, size };
  }

  getName(): string | null {
    const layout = this.layout;
    if (layout === MemLayout.Legacy) return null;

    const nameSize = readU16LE(this.data, V3_OFF_NAME_SIZE);
    if (nameSize === 0) return null;

    const childrenCount = readU32LE(this.data, V3_OFF_CHILDREN_COUNT);

    if (layout === MemLayout.Array) {
      const dimCount = Number(readU64LE(this.data, ARRAY_OFF_DIM_COUNT));
      // Name is after: base struct + children(16 each) + dimensions(8 each) + chunks(8 each)
      const off = SIZEOF_ARRAY_V3 + childrenCount * 16 + dimCount * 8 + dimCount * 8;
      const nameBytes = this.data.subarray(off, off + nameSize);
      return new TextDecoder().decode(nameBytes);
    }

    // Scalar: name is after base struct + children(16 each) + scalar value
    const baseOff = SIZEOF_V3 + childrenCount * 16;
    const dataType = this.data[V3_OFF_DATA_TYPE] as OmDataType;
    let scalarSize = 0;
    switch (dataType) {
      case OmDataType.None:
        scalarSize = 0;
        break;
      case OmDataType.Int8:
      case OmDataType.Uint8:
        scalarSize = 1;
        break;
      case OmDataType.Int16:
      case OmDataType.Uint16:
        scalarSize = 2;
        break;
      case OmDataType.Int32:
      case OmDataType.Uint32:
      case OmDataType.Float:
        scalarSize = 4;
        break;
      case OmDataType.Int64:
      case OmDataType.Uint64:
      case OmDataType.Double:
        scalarSize = 8;
        break;
      case OmDataType.String: {
        // String: uint64 size + string bytes
        const strSize = Number(readU64LE(this.data, baseOff));
        scalarSize = 8 + strSize;
        break;
      }
      default:
        return null;
    }
    const off = baseOff + scalarSize;
    const nameBytes = this.data.subarray(off, off + nameSize);
    return new TextDecoder().decode(nameBytes);
  }

  /** Read a scalar value. Returns the raw bytes and type info, or null. */
  getScalarBytes(): { bytes: Uint8Array; dataType: OmDataType } | null {
    const layout = this.layout;
    if (layout !== MemLayout.Scalar) return null;

    const dataType = this.data[V3_OFF_DATA_TYPE] as OmDataType;
    const childrenCount = readU32LE(this.data, V3_OFF_CHILDREN_COUNT);
    const baseOff = SIZEOF_V3 + childrenCount * 16;

    switch (dataType) {
      case OmDataType.None:
        return { bytes: new Uint8Array(0), dataType };
      case OmDataType.Int8:
      case OmDataType.Uint8:
        return { bytes: this.data.subarray(baseOff, baseOff + 1), dataType };
      case OmDataType.Int16:
      case OmDataType.Uint16:
        return { bytes: this.data.subarray(baseOff, baseOff + 2), dataType };
      case OmDataType.Int32:
      case OmDataType.Uint32:
      case OmDataType.Float:
        return { bytes: this.data.subarray(baseOff, baseOff + 4), dataType };
      case OmDataType.Int64:
      case OmDataType.Uint64:
      case OmDataType.Double:
        return { bytes: this.data.subarray(baseOff, baseOff + 8), dataType };
      case OmDataType.String: {
        const strSize = Number(readU64LE(this.data, baseOff));
        return { bytes: this.data.subarray(baseOff + 8, baseOff + 8 + strSize), dataType };
      }
      default:
        return null;
    }
  }

  /** Get LUT metadata (only valid for Array layout). */
  getLutInfo(): { lutSize: bigint; lutOffset: bigint } | null {
    if (this.layout !== MemLayout.Array) return null;
    return {
      lutSize: readU64LE(this.data, ARRAY_OFF_LUT_SIZE),
      lutOffset: readU64LE(this.data, ARRAY_OFF_LUT_OFFSET),
    };
  }

  isLegacy(): boolean {
    return this.layout === MemLayout.Legacy;
  }
  isArray(): boolean {
    return this.layout === MemLayout.Array;
  }
  isScalar(): boolean {
    return this.layout === MemLayout.Scalar;
  }
}
