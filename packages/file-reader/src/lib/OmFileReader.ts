import { OmFileReaderBackend } from "./backends/OmFileReaderBackend";
import {
  OffsetSize,
  OmDataType,
  TypedArray,
  OmDataTypeToTypedArray,
  OmFileReadOptions,
  OmFileReadIntoOptions,
  Range,
  OmFilePrefetchReadOptions,
} from "./types";
import { runLimited, throwIfAborted } from "./utils";
import {
  omHeaderType,
  omTrailerRead,
  OmHeaderType,
  OmVariable,
  OmCompression,
  OmError,
  omDecoderInit,
  omInitIndexRead,
  omInitDataRead,
  omNextIndexRead,
  omNextDataRead,
  omDecodeChunks,
  omDecoderReadBufferSize,
} from "@openmeteo/file-format";
import { OM_TRAILER_SIZE, OM_HEADER_V1_SIZE } from "@openmeteo/file-format";

export class OmFileReader {
  private backend: OmFileReaderBackend;
  private variable: OmVariable | null;
  private metadataCache: Map<string, OffsetSize | null>;

  constructor(backend: OmFileReaderBackend, _wasm?: unknown) {
    this.backend = backend;
    this.variable = null;
    this.metadataCache = new Map();
  }

  static async create(backend: OmFileReaderBackend): Promise<OmFileReader> {
    const reader = new OmFileReader(backend);
    await reader.initialize();
    return reader;
  }

  async initialize(): Promise<OmFileReader> {
    let variableData: Uint8Array | undefined;

    const fileSize = await this.backend.count();
    if (fileSize >= OM_TRAILER_SIZE) {
      const trailerBytes = await this.backend.getBytes(fileSize - OM_TRAILER_SIZE, OM_TRAILER_SIZE);
      const parsed = omTrailerRead(trailerBytes);
      if (parsed) {
        variableData = await this.backend.getBytes(Number(parsed.offset), Number(parsed.size));
      }
    }

    if (!variableData) {
      const headerBytes = await this.backend.getBytes(0, OM_HEADER_V1_SIZE);
      const headerType = omHeaderType(headerBytes);
      if (headerType === OmHeaderType.Legacy) {
        variableData = headerBytes;
      }
    }

    if (!variableData) {
      throw new Error("Not a valid OM file");
    }

    this.variable = new OmVariable(variableData);
    return this;
  }

  dataType(): OmDataType {
    if (this.variable === null) throw new Error("Reader not initialized");
    return this.variable.getDataType() as unknown as OmDataType;
  }

  compression(): OmCompression {
    if (this.variable === null) throw new Error("Reader not initialized");
    return this.variable.getCompression();
  }

  scaleFactor(): number {
    if (this.variable === null) throw new Error("Reader not initialized");
    return this.variable.getScaleFactor();
  }

  addOffset(): number {
    if (this.variable === null) throw new Error("Reader not initialized");
    return this.variable.getAddOffset();
  }

  getDimensions(): number[] {
    if (this.variable === null) throw new Error("Reader not initialized");
    return Array.from(this.variable.getDimensions(), (v) => Number(v));
  }

  getChunkDimensions(): number[] {
    if (this.variable === null) throw new Error("Reader not initialized");
    return Array.from(this.variable.getChunks(), (v) => Number(v));
  }

  getName(): string | null {
    if (this.variable === null) throw new Error("Reader not initialized");
    return this.variable.getName();
  }

  numberOfChildren(): number {
    if (this.variable === null) throw new Error("Reader not initialized");
    return this.variable.getChildrenCount();
  }

  async getChild(index: number): Promise<OmFileReader | null> {
    if (this.variable === null) throw new Error("Reader not initialized");
    const child = this.variable.getChild(index);
    if (!child) return null;
    return this.initChildFromOffsetSize({ offset: Number(child.offset), size: Number(child.size) });
  }

  async getChildByName(name: string): Promise<OmFileReader | null> {
    const cachedMetadata = this.metadataCache.get(name);
    if (cachedMetadata === null) return null;
    if (cachedMetadata) return this.initChildFromOffsetSize(cachedMetadata);

    const numChildren = this.numberOfChildren();
    for (let i = 0; i < numChildren; i++) {
      const child = this.variable!.getChild(i);
      if (!child) continue;
      const metadata = { offset: Number(child.offset), size: Number(child.size) };
      const childReader = await this.initChildFromOffsetSize(metadata);
      const childName = childReader.getName();
      if (childName) {
        this.metadataCache.set(childName, metadata);
        if (childName === name) return childReader;
      }
      childReader.dispose();
    }
    this.metadataCache.set(name, null);
    return null;
  }

  async initChildFromOffsetSize(offsetSize: OffsetSize): Promise<OmFileReader> {
    const childData = await this.backend.getBytes(offsetSize.offset, offsetSize.size);
    const childReader = new OmFileReader(this.backend);
    childReader.variable = new OmVariable(childData);
    return childReader;
  }

  async findByPath(path: string): Promise<OmFileReader | null> {
    const parts = path.split("/").filter((s) => s.length > 0);
    return this.navigatePath(parts);
  }

  async navigatePath(parts: string[]): Promise<OmFileReader | null> {
    if (parts.length === 0) return null;
    const child = await this.getChildByName(parts[0]);
    if (child) {
      if (parts.length === 1) return child;
      return child.navigatePath(parts.slice(1));
    }
    return null;
  }

  readScalar<T>(dataType: OmDataType): T | null {
    if (this.variable === null) throw new Error("Reader not initialized");
    if (this.dataType() !== dataType) return null;
    const result = this.variable.getScalarBytes();
    if (!result) return null;
    const { bytes } = result;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    switch (dataType) {
      case OmDataType.Int8:
        return view.getInt8(0) as T;
      case OmDataType.Uint8:
        return view.getUint8(0) as T;
      case OmDataType.Int16:
        return view.getInt16(0, true) as T;
      case OmDataType.Uint16:
        return view.getUint16(0, true) as T;
      case OmDataType.Int32:
        return view.getInt32(0, true) as T;
      case OmDataType.Uint32:
        return view.getUint32(0, true) as T;
      case OmDataType.Int64:
        return view.getBigInt64(0, true) as T;
      case OmDataType.Uint64:
        return view.getBigUint64(0, true) as T;
      case OmDataType.Float:
        return view.getFloat32(0, true) as T;
      case OmDataType.Double:
        return view.getFloat64(0, true) as T;
      case OmDataType.String:
        return new TextDecoder().decode(bytes) as T;
      default:
        return null;
    }
  }

  async read<T extends keyof OmDataTypeToTypedArray>(
    options: OmFileReadOptions<T>
  ): Promise<OmDataTypeToTypedArray[T]> {
    const {
      type,
      ranges,
      prefetch = true,
      prefetchConcurrency = 10,
      intoSAB = false,
      ioSizeMax = BigInt(65536),
      ioSizeMerge = BigInt(2048),
      signal,
    } = options;
    const outDims = ranges.map((r) => r.end - r.start);
    const totalSize = outDims.reduce((a, b) => a * b, 1);
    const output = this._allocateTypedArray(type, totalSize, intoSAB);
    await this.readInto({ type, output, ranges, ioSizeMax, ioSizeMerge, prefetch, prefetchConcurrency, signal });
    return output;
  }

  async readInto<T extends keyof OmDataTypeToTypedArray>(options: OmFileReadIntoOptions<T>): Promise<void> {
    const {
      type,
      output,
      ranges,
      prefetch = true,
      prefetchConcurrency = 10,
      ioSizeMax = BigInt(65536),
      ioSizeMerge = BigInt(2048),
      signal,
    } = options;

    if (this.dataType() !== type) {
      throw new Error(`Invalid data type: expected ${this.dataType()}, got ${type}`);
    }

    const fileDims = this.getDimensions();
    if (fileDims.length !== ranges.length) {
      throw new Error(`Mismatched dimensions: file has ${fileDims.length}, request has ${ranges.length}`);
    }

    const totalElements = ranges.reduce((acc, r) => acc * (r.end - r.start), 1);
    if (output.length < totalElements) {
      throw new Error(`Output array is too small: needs ${totalElements} elements, has ${output.length}`);
    }

    await this._runWithDecoder(
      ranges,
      ioSizeMax,
      ioSizeMerge,
      async (decoder) => {
        if (prefetch) {
          await this._decodePrefetch(decoder, prefetchConcurrency, signal);
        }
        await this._decode(decoder, output as TypedArray, signal);
      },
      signal
    );
  }

  async readPrefetch(options: OmFilePrefetchReadOptions): Promise<void> {
    const { ranges, prefetchConcurrency = 20, ioSizeMax = BigInt(65536), ioSizeMerge = BigInt(2048), signal } = options;
    await this._runWithDecoder(
      ranges,
      ioSizeMax,
      ioSizeMerge,
      async (decoder) => {
        await this._decodePrefetch(decoder, prefetchConcurrency, signal);
      },
      signal
    );
  }

  private async _decodePrefetch(
    decoder: ReturnType<typeof omDecoderInit> & object,
    concurrency: number,
    signal?: AbortSignal
  ): Promise<void> {
    if (!this.backend.collectPrefetchTasks) return;
    const allTasks: Array<() => Promise<void>> = [];
    await this._iterateDataBlocks(
      decoder,
      async (dataRead) => {
        const tasks = await this.backend.collectPrefetchTasks!(dataRead.offset, dataRead.count, signal);
        allTasks.push(...tasks);
      },
      signal
    );
    if (allTasks.length > 0) await runLimited(allTasks, concurrency, signal);
  }

  private async _decode(
    decoder: ReturnType<typeof omDecoderInit> & object,
    output: TypedArray,
    signal?: AbortSignal
  ): Promise<void> {
    const chunkBufSize = omDecoderReadBufferSize(decoder);
    const chunkBuf = new Uint8Array(chunkBufSize);
    let totalDataReads = 0;

    await this._iterateDataBlocks(
      decoder,
      async (dataRead) => {
        totalDataReads++;
        const data = await this.backend.getBytes(dataRead.offset, dataRead.count, signal);
        const error = omDecodeChunks(decoder, dataRead.chunkIndex, data, output as any, chunkBuf);
        if (error !== OmError.Ok) {
          console.error(
            `[OmFileReader] omDecodeChunks error=${error} at dataRead #${totalDataReads}: offset=${dataRead.offset} count=${dataRead.count} chunkIndex=[${dataRead.chunkIndex.lowerBound},${dataRead.chunkIndex.upperBound})`
          );
          throw new Error(`Decoder failed with error ${error}`);
        }
      },
      signal
    );

    if (totalDataReads === 0) {
      console.warn("[OmFileReader] _decode: no data reads were performed (no chunks matched)");
    }
  }

  private async _runWithDecoder(
    ranges: Range[],
    ioSizeMax: bigint,
    ioSizeMerge: bigint,
    task: (decoder: ReturnType<typeof omDecoderInit> & object) => Promise<void>,
    signal?: AbortSignal
  ): Promise<void> {
    throwIfAborted(signal);
    if (this.variable === null) throw new Error("Reader not initialized");

    const fileDims = this.getDimensions();
    const nDims = ranges.length;
    if (fileDims.length !== nDims) {
      throw new Error(`Mismatched dimensions: file has ${fileDims.length}, request has ${nDims}`);
    }

    for (let i = 0; i < nDims; i++) {
      if (ranges[i].start < 0 || ranges[i].end > fileDims[i] || ranges[i].start >= ranges[i].end) {
        throw new Error(`Invalid range for dimension ${i}: ${JSON.stringify(ranges[i])}`);
      }
    }

    const readOffset = ranges.map((r) => r.start);
    const readCount = ranges.map((r) => r.end - r.start);
    const cubeOffset = readCount.map(() => 0);
    const cubeDimensions = readCount.slice();

    const lutInfo = this.variable.getLutInfo();
    const isLegacy = this.variable.isLegacy();

    const decoderVar = {
      scaleFactor: this.variable.getScaleFactor(),
      addOffset: this.variable.getAddOffset(),
      dataType: this.variable.getDataType() as unknown as import("@openmeteo/file-format").OmDataType,
      compression: this.variable.getCompression() as unknown as import("@openmeteo/file-format").OmCompression,
      dimensions: Array.from(this.variable.getDimensions(), (v) => Number(v)),
      chunks: Array.from(this.variable.getChunks(), (v) => Number(v)),
      lutSize: lutInfo ? Number(lutInfo.lutSize) : 0,
      lutOffset: lutInfo ? Number(lutInfo.lutOffset) : OM_HEADER_V1_SIZE,
      isLegacy,
    };

    const decoder = omDecoderInit(
      decoderVar,
      nDims,
      readOffset,
      readCount,
      cubeOffset,
      cubeDimensions,
      Number(ioSizeMerge),
      Number(ioSizeMax)
    );

    if (typeof decoder === "number") {
      throw new Error(`Decoder initialization failed: error ${decoder}`);
    }

    await task(decoder);
  }

  private async _iterateDataBlocks(
    decoder: ReturnType<typeof omDecoderInit> & object,
    callback: (dataRead: ReturnType<typeof omInitDataRead>) => Promise<void>,
    signal?: AbortSignal
  ): Promise<void> {
    const indexRead = omInitIndexRead(decoder);

    while (omNextIndexRead(decoder, indexRead)) {
      throwIfAborted(signal);
      const indexData = await this.backend.getBytes(indexRead.offset, indexRead.count, signal);
      const dataRead = omInitDataRead(indexRead);

      while (true) {
        const { result, error } = omNextDataRead(decoder, dataRead, indexData);
        if (error !== OmError.Ok) throw new Error(`Data read error: ${error}`);
        if (!result) break;
        throwIfAborted(signal);
        await callback(dataRead);
      }
    }
  }

  private _allocateTypedArray<T extends keyof OmDataTypeToTypedArray>(
    dataType: T,
    size: number,
    useSharedBuffer = false
  ): OmDataTypeToTypedArray[T] {
    const typeMap: Record<number, new (buf: ArrayBufferLike) => TypedArray> = {
      [OmDataType.Int8Array]: Int8Array,
      [OmDataType.Uint8Array]: Uint8Array,
      [OmDataType.Int16Array]: Int16Array,
      [OmDataType.Uint16Array]: Uint16Array,
      [OmDataType.Int32Array]: Int32Array,
      [OmDataType.Uint32Array]: Uint32Array,
      [OmDataType.Int64Array]: BigInt64Array,
      [OmDataType.Uint64Array]: BigUint64Array,
      [OmDataType.FloatArray]: Float32Array,
      [OmDataType.DoubleArray]: Float64Array,
    };
    const bytesMap: Record<number, number> = {
      [OmDataType.Int8Array]: 1,
      [OmDataType.Uint8Array]: 1,
      [OmDataType.Int16Array]: 2,
      [OmDataType.Uint16Array]: 2,
      [OmDataType.Int32Array]: 4,
      [OmDataType.Uint32Array]: 4,
      [OmDataType.Int64Array]: 8,
      [OmDataType.Uint64Array]: 8,
      [OmDataType.FloatArray]: 4,
      [OmDataType.DoubleArray]: 8,
    };

    const Ctor = typeMap[dataType as number];
    if (!Ctor) throw new Error("Unsupported data type");
    const byteLength = size * bytesMap[dataType as number];

    const buf = useSharedBuffer ? new SharedArrayBuffer(byteLength) : new ArrayBuffer(byteLength);
    return new Ctor(buf) as OmDataTypeToTypedArray[T];
  }

  dispose(): void {
    this.variable = null;
  }
}
