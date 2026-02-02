import { OmFileReaderBackend } from "./backends/OmFileReaderBackend";
import {
  OffsetSize,
  OmDataType,
  TypedArray,
  OmDataTypeToTypedArray,
  OmFileReadOptions,
  OmFileReadIntoOptions,
} from "./types";
import { runLimited } from "./utils";
import { WasmModule, initWasm, getWasmModule } from "./wasm";

export class OmFileReader {
  private backend: OmFileReaderBackend;
  private wasm: WasmModule;
  private variable: number | null;
  private variableDataPtr: number | null;
  private metadataCache: Map<string, OffsetSize | null>;

  constructor(backend: OmFileReaderBackend, wasm?: WasmModule) {
    this.backend = backend;
    this.wasm = wasm || getWasmModule();
    this.variable = null;
    this.variableDataPtr = null;
    this.metadataCache = new Map();
  }

  /**
   * Static factory method to create and initialize an OmFileReader
   */
  static async create(backend: OmFileReaderBackend): Promise<OmFileReader> {
    // Make sure WASM is initialized
    const wasm = await initWasm();
    const reader = new OmFileReader(backend, wasm);
    await reader.initialize();
    return reader;
  }

  async initialize(): Promise<OmFileReader> {
    let variableData: Uint8Array | undefined;

    // First, try to read the trailer
    const fileSize = await this.backend.count();
    const trailerSize = this.wasm.om_trailer_size();

    if (fileSize >= trailerSize) {
      const trailerOffset = fileSize - trailerSize;
      const trailerPtr = await this.readDataBlock(trailerOffset, trailerSize);

      const offsetPtr = this.wasm._malloc(8); // 64-bit value
      const sizePtr = this.wasm._malloc(8);

      try {
        const success = this.wasm.om_trailer_read(trailerPtr, offsetPtr, sizePtr);

        if (success) {
          const offset = Number(this.wasm.getValue(offsetPtr, "i64"));
          const size = Number(this.wasm.getValue(sizePtr, "i64"));
          variableData = await this.backend.getBytes(offset, size);
        }
      } finally {
        this.wasm._free(trailerPtr);
        this.wasm._free(offsetPtr);
        this.wasm._free(sizePtr);
      }
    }

    // Fallback to legacy header if trailer reading fails
    if (!variableData) {
      const headerSize = this.wasm.om_header_size();
      const headerData = await this.backend.getBytes(0, headerSize);
      const headerPtr = this.wasm._malloc(headerData.length);
      this.wasm.HEAPU8.set(headerData, headerPtr);

      try {
        const headerType = this.wasm.om_header_type(headerPtr);
        if (headerType === this.wasm.OM_HEADER_LEGACY) {
          variableData = headerData;
        }
      } finally {
        this.wasm._free(headerPtr);
      }
    }

    if (!variableData) {
      throw new Error("Not a valid OM file");
    }

    // Initialize variable
    const variableDataPtr = this.wasm._malloc(variableData.length);
    this.wasm.HEAPU8.set(variableData, variableDataPtr);
    this.variable = this.wasm.om_variable_init(variableDataPtr);

    if (!this.variable) {
      this.wasm._free(variableDataPtr);
      throw new Error("Failed to initialize variable");
    }

    this.variableDataPtr = variableDataPtr;

    return this;
  }

  // Helper method to convert C strings to JS strings
  private _getString(strPtr: number, strLen: number): string {
    const bytes = this.wasm.HEAPU8.subarray(strPtr, strPtr + strLen);
    return new TextDecoder("utf8").decode(bytes);
  }

  dataType(): number {
    if (this.variable === null) throw new Error("Reader not initialized");
    return this.wasm.om_variable_get_type(this.variable);
  }

  compression(): number {
    if (this.variable === null) throw new Error("Reader not initialized");
    return this.wasm.om_variable_get_compression(this.variable);
  }

  scaleFactor(): number {
    if (this.variable === null) throw new Error("Reader not initialized");
    return this.wasm.om_variable_get_scale_factor(this.variable);
  }

  addOffset(): number {
    if (this.variable === null) throw new Error("Reader not initialized");
    return this.wasm.om_variable_get_add_offset(this.variable);
  }

  getDimensions(): number[] {
    if (this.variable === null) throw new Error("Reader not initialized");

    const count = Number(this.wasm.om_variable_get_dimensions_count(this.variable));
    const dimensionsPtr = this.wasm.om_variable_get_dimensions_ptr(this.variable);

    // Create view directly into WASM memory
    const int64View = new BigInt64Array(this.wasm.HEAPU8.buffer, dimensionsPtr, count);
    return Array.from(int64View, (bigIntVal) => Number(bigIntVal));
  }

  getChunkDimensions(): number[] {
    if (this.variable === null) throw new Error("Reader not initialized");

    const count = Number(this.wasm.om_variable_get_dimensions_count(this.variable));
    const chunksPtr = this.wasm.om_variable_get_chunks_ptr(this.variable);

    // Create view directly into WASM memory
    const int64View = new BigInt64Array(this.wasm.HEAPU8.buffer, chunksPtr, count);
    return Array.from(int64View, (bigIntVal) => Number(bigIntVal));
  }

  getName(): string | null {
    if (this.variable === null) throw new Error("Reader not initialized");

    // string length is i16
    const lengthPtr = this.wasm._malloc(2);
    const valuePtr = this.wasm.om_variable_get_name_ptr(this.variable, lengthPtr);
    const size = this.wasm.getValue(lengthPtr, "i16");
    this.wasm._free(lengthPtr);
    if (size === 0 || valuePtr === 0) {
      return null;
    }
    return this._getString(valuePtr, size);
  }

  numberOfChildren(): number {
    if (this.variable === null) throw new Error("Reader not initialized");
    return this.wasm.om_variable_get_children_count(this.variable);
  }

  async getChild(index: number): Promise<OmFileReader | null> {
    if (this.variable === null) throw new Error("Reader not initialized");

    // Allocate memory for the output parameters
    const offsetPtr = this.wasm._malloc(8);
    const sizePtr = this.wasm._malloc(8);

    const success = this.wasm.om_variable_get_children(this.variable, index, 1, offsetPtr, sizePtr);

    if (!success) {
      this.wasm._free(offsetPtr);
      this.wasm._free(sizePtr);
      return null;
    }

    const offset = Number(this.wasm.getValue(offsetPtr, "i64"));
    const size = Number(this.wasm.getValue(sizePtr, "i64"));

    this.wasm._free(offsetPtr);
    this.wasm._free(sizePtr);

    return this.initChildFromOffsetSize({ offset, size });
  }

  /**
   * Searches direct children by name. Does not search recursively.
   */
  async getChildByName(name: string): Promise<OmFileReader | null> {
    // Check cache first
    const cachedMetadata = this.metadataCache.get(name);
    if (cachedMetadata === null) {
      return null;
    }
    if (cachedMetadata) {
      return await this.initChildFromOffsetSize(cachedMetadata);
    }

    // Search through children and cache metadata
    const numChildren = this.numberOfChildren();
    for (let i = 0; i < numChildren; i++) {
      const metadata = this._getChildMetadata(i);
      if (metadata) {
        const child = await this.initChildFromOffsetSize(metadata);
        const childName = child.getName();
        if (childName) {
          this.metadataCache.set(childName, metadata);
          if (childName === name) {
            return child; // keep this one
          }
        }
        child.dispose();
      }
    }
    // also remember invalid names
    this.metadataCache.set(name, null);
    return null;
  }

  async initChildFromOffsetSize(offsetSize: OffsetSize): Promise<OmFileReader> {
    const childDataPtr = await this.readDataBlock(offsetSize.offset, offsetSize.size);

    const childReader = new OmFileReader(this.backend, this.wasm);

    childReader.variable = this.wasm.om_variable_init(childDataPtr);
    childReader.variableDataPtr = childDataPtr;

    return childReader;
  }

  /**
   * Get child metadata by index.
   */
  _getChildMetadata(index: number): OffsetSize | null {
    if (this.variable === null) throw new Error("Reader not initialized");

    // Allocate memory for the output parameters
    const offsetPtr = this.wasm._malloc(8);
    const sizePtr = this.wasm._malloc(8);

    const success = this.wasm.om_variable_get_children(this.variable, index, 1, offsetPtr, sizePtr);

    if (!success) {
      this.wasm._free(offsetPtr);
      this.wasm._free(sizePtr);
      return null;
    }

    const offset = Number(this.wasm.getValue(offsetPtr, "i64"));
    const size = Number(this.wasm.getValue(sizePtr, "i64"));

    this.wasm._free(offsetPtr);
    this.wasm._free(sizePtr);

    return { offset, size };
  }

  /**
   * Find a variable by its path (e.g., "parent/child/grandchild")
   */
  async findByPath(path: string): Promise<OmFileReader | null> {
    const parts = path.split("/").filter((s) => s.length > 0);
    return await this.navigatePath(parts);
  }

  /**
   * Navigate through a path recursively
   */
  async navigatePath(parts: string[]): Promise<OmFileReader | null> {
    if (parts.length === 0) {
      return null;
    }

    const child = await this.getChildByName(parts[0]);
    if (child) {
      if (parts.length === 1) {
        return child;
      } else {
        return await child.navigatePath(parts.slice(1));
      }
    }
    return null;
  }

  // Method to read scalar values
  readScalar<T>(dataType: OmDataType): T | null {
    if (this.variable === null) throw new Error("Reader not initialized");

    if (this.dataType() !== dataType) {
      return null;
    }

    // Allocate memory for output parameters
    const ptrPtr = this.wasm._malloc(4); // pointer to pointer
    const sizePtr = this.wasm._malloc(8); // u64

    try {
      const error = this.wasm.om_variable_get_scalar(this.variable, ptrPtr, sizePtr);

      if (error !== this.wasm.ERROR_OK) {
        return null;
      }

      const dataPtr = this.wasm.getValue(ptrPtr, "*");

      if (dataPtr === 0) {
        return null;
      }

      // Read data based on type
      let result: T | null;

      // TODO: Support Int64 and Uint64
      switch (dataType) {
        case OmDataType.Int8:
          result = this.wasm.getValue(dataPtr, "i8");
          break;
        case OmDataType.Uint8:
          result = (this.wasm.getValue(dataPtr, "i8") & 0xff) as T;
          break;
        case OmDataType.Int16:
          result = this.wasm.getValue(dataPtr, "i16");
          break;
        case OmDataType.Uint16:
          result = (this.wasm.getValue(dataPtr, "i16") & 0xffff) as T;
          break;
        case OmDataType.Int32:
          result = this.wasm.getValue(dataPtr, "i32");
          break;
        case OmDataType.Uint32:
          result = (this.wasm.getValue(dataPtr, "i32") >>> 0) as T;
          break;
        case OmDataType.Int64:
          result = this.wasm.getValue(dataPtr, "i64");
          break;
        case OmDataType.Uint64:
          // convert to unsigned BigInt
          {
            const val = this.wasm.getValue(dataPtr, "i64");
            result = (val & BigInt("0xFFFFFFFFFFFFFFFF")) as T;
          }
          break;
        case OmDataType.Float:
          result = this.wasm.getValue(dataPtr, "float");
          break;
        case OmDataType.Double:
          result = this.wasm.getValue(dataPtr, "double");
          break;
        case OmDataType.String:
          {
            const size = Number(this.wasm.getValue(sizePtr, "i64"));
            if (size === 0) {
              return null;
            }
            result = this._getString(dataPtr, size) as T;
          }
          break;
        default:
          result = null;
      }
      return result;
    } finally {
      this.wasm._free(ptrPtr);
      this.wasm._free(sizePtr);
    }
  }

  private newIndexRead(decoderPtr: number): number {
    // Size of OmDecoder_indexRead_t
    const sizeOfRange = 16; // 8 bytes for lowerBound + 8 bytes for upperBound
    const sizeOfIndexRead = 8 + 8 + sizeOfRange * 3; // offset + count + 3 range structs

    // Allocate the memory
    const indexReadPtr = this.wasm._malloc(sizeOfIndexRead);
    this.wasm.om_decoder_init_index_read(decoderPtr, indexReadPtr);
    return indexReadPtr;
  }

  private newDataRead(indexReadPtr: number): number {
    // Size of OmDecoder_dataRead_t
    const sizeOfRange = 16; // 8 bytes for lowerBound + 8 bytes for upperBound
    const sizeOfDataRead = 8 + 8 + sizeOfRange * 3; // offset + count + 3 range structs

    // Allocate the memory
    const dataReadPtr = this.wasm._malloc(sizeOfDataRead);
    this.wasm.om_decoder_init_data_read(dataReadPtr, indexReadPtr);
    return dataReadPtr;
  }

  private allocateTypedArray<T extends keyof OmDataTypeToTypedArray>(
    dataType: T,
    size: number,
    useSharedBuffer: boolean = false
  ): OmDataTypeToTypedArray[T] {
    if (useSharedBuffer && typeof SharedArrayBuffer === "undefined") {
      throw new Error("SharedArrayBuffer is not available in this environment");
    }

    // Type-safe mapping of data types to their constructors and byte sizes
    const typeInfo = {
      [this.wasm.DATA_TYPE_INT8_ARRAY]: { constructor: Int8Array<ArrayBufferLike>, bytes: 1 },
      [this.wasm.DATA_TYPE_UINT8_ARRAY]: { constructor: Uint8Array<ArrayBufferLike>, bytes: 1 },
      [this.wasm.DATA_TYPE_INT16_ARRAY]: { constructor: Int16Array<ArrayBufferLike>, bytes: 2 },
      [this.wasm.DATA_TYPE_UINT16_ARRAY]: { constructor: Uint16Array<ArrayBufferLike>, bytes: 2 },
      [this.wasm.DATA_TYPE_INT32_ARRAY]: { constructor: Int32Array<ArrayBufferLike>, bytes: 4 },
      [this.wasm.DATA_TYPE_UINT32_ARRAY]: { constructor: Uint32Array<ArrayBufferLike>, bytes: 4 },
      [this.wasm.DATA_TYPE_INT64_ARRAY]: { constructor: BigInt64Array<ArrayBufferLike>, bytes: 8 },
      [this.wasm.DATA_TYPE_UINT64_ARRAY]: { constructor: BigUint64Array<ArrayBufferLike>, bytes: 8 },
      [this.wasm.DATA_TYPE_FLOAT_ARRAY]: { constructor: Float32Array<ArrayBufferLike>, bytes: 4 },
      [this.wasm.DATA_TYPE_DOUBLE_ARRAY]: { constructor: Float64Array<ArrayBufferLike>, bytes: 8 },
    } as const;

    const info = typeInfo[dataType];
    if (!info) {
      throw new Error("Unsupported data type");
    }
    const byteLength = size * info.bytes;

    if (useSharedBuffer) {
      // In browsers, crossOriginIsolated must be true; in Node, it's undefined (so skip check)
      if (
        typeof SharedArrayBuffer === "undefined" ||
        (typeof crossOriginIsolated !== "undefined" && !crossOriginIsolated)
      ) {
        throw new Error("SharedArrayBuffer is not available in this environment");
      }
      const sharedBuffer = new SharedArrayBuffer(byteLength);
      return new info.constructor(sharedBuffer) as OmDataTypeToTypedArray[T];
    } else {
      const normalBuffer = new ArrayBuffer(byteLength);
      return new info.constructor(normalBuffer) as OmDataTypeToTypedArray[T];
    }
  }

  /**
   * Reads data from the file and returns a new TypedArray of the requested type.
   *
   * @param options Options for reading, including:
   *   - type: The data type to read.
   *   - ranges: Array of dimension ranges to read.
   *   - prefetch: Whether to prefetch data (default: true).
   *   - intoSAB: Use SharedArrayBuffer for output (default: false).
   *   - ioSizeMax: Maximum I/O size (default: 65536).
   *   - ioSizeMerge: Merge threshold for I/O operations (default: 2048).
   */
  async read<T extends keyof OmDataTypeToTypedArray>(
    options: OmFileReadOptions<T>
  ): Promise<OmDataTypeToTypedArray[T]> {
    const {
      type,
      ranges,
      prefetch = true,
      intoSAB = false,
      ioSizeMax = BigInt(65536),
      ioSizeMerge = BigInt(2048),
    } = options;

    // Calculate output dimensions
    const outDims = ranges.map((range) => Number(range.end - range.start));
    const totalSize = outDims.reduce((a, b) => a * b, 1);

    const output = this.allocateTypedArray(type, totalSize, intoSAB);

    await this.readInto({ type, output, ranges, ioSizeMax, ioSizeMerge, prefetch });
    return output;
  }

  /**
   * Reads data into an existing TypedArray with specified dimension ranges.
   *
   * @param options Options for reading, including:
   *   - type: The data type to read.
   *   - output: The TypedArray to read data into.
   *   - ranges: Array of dimension ranges to read.
   *   - prefetch: Whether to prefetch data (default: true).
   *   - ioSizeMax: Maximum I/O size (default: 65536).
   *   - ioSizeMerge: Merge threshold for I/O operations (default: 2048).
   */
  async readInto<T extends keyof OmDataTypeToTypedArray>(options: OmFileReadIntoOptions<T>): Promise<void> {
    const { type, output, ranges, prefetch = true, ioSizeMax = BigInt(65536), ioSizeMerge = BigInt(2048) } = options;
    if (this.variable === null) throw new Error("Reader not initialized");

    if (this.dataType() !== type) {
      throw new Error(`Invalid data type: expected ${this.dataType()}, got ${type}`);
    }

    const nDims = ranges.length;
    const fileDims = this.getDimensions();

    // Validate dimension counts
    if (fileDims.length !== nDims) {
      throw new Error(`Mismatched dimensions: file has ${fileDims.length}, request has ${nDims}`);
    }

    // Calculate output dimensions and prepare arrays for WASM
    const outDims = ranges.map((range) => range.end - range.start);

    // Calculate total elements to ensure output array has correct size
    const totalElements = outDims.reduce((a, b) => a * Number(b), 1);
    if (output.length < totalElements) {
      throw new Error(`Output array is too small: needs ${totalElements} elements, has ${output.length}`);
    }

    // Allocate memory for arrays
    const readOffsetPtr = this.wasm._malloc(nDims * 8); // u64 array
    const readCountPtr = this.wasm._malloc(nDims * 8);
    const intoCubeOffsetPtr = this.wasm._malloc(nDims * 8);
    const intoCubeDimensionPtr = this.wasm._malloc(nDims * 8);

    try {
      // Fill arrays
      for (let i = 0; i < nDims; i++) {
        // Validate ranges
        if (ranges[i].start < 0 || ranges[i].end > fileDims[i] || ranges[i].start >= ranges[i].end) {
          throw new Error(`Invalid range for dimension ${i}: ${JSON.stringify(ranges[i])}`);
        }

        this.wasm.setValue(readOffsetPtr + i * 8, BigInt(ranges[i].start), "i64");
        this.wasm.setValue(readCountPtr + i * 8, BigInt(outDims[i]), "i64");
        this.wasm.setValue(intoCubeOffsetPtr + i * 8, BigInt(0), "i64");
        this.wasm.setValue(intoCubeDimensionPtr + i * 8, BigInt(outDims[i]), "i64");
      }
      // Create decoder
      const decoderPtr = this.wasm._malloc(this.wasm.sizeof_decoder);

      try {
        // Initialize decoder
        const error = this.wasm.om_decoder_init(
          decoderPtr,
          this.variable,
          BigInt(nDims),
          readOffsetPtr,
          readCountPtr,
          intoCubeOffsetPtr,
          intoCubeDimensionPtr,
          ioSizeMerge,
          ioSizeMax
        );

        if (error !== this.wasm.ERROR_OK) {
          throw new Error(`Decoder initialization failed: error code ${error}`);
        }
        if (prefetch) {
          await this.decodePrefetch(decoderPtr);
        }
        await this.decode(decoderPtr, output);
      } finally {
        this.wasm._free(decoderPtr);
      }
    } finally {
      // Clean up input arrays
      this.wasm._free(readOffsetPtr);
      this.wasm._free(readCountPtr);
      this.wasm._free(intoCubeOffsetPtr);
      this.wasm._free(intoCubeDimensionPtr);
    }
  }

  async decodePrefetch(decoderPtr: number): Promise<void> {
    if (!this.backend.prefetchData) {
      // Prefetch not supported by backend
      return;
    }

    const indexReadPtr = this.newIndexRead(decoderPtr);
    const errorPtr = this.wasm._malloc(4);
    this.wasm.setValue(errorPtr, this.wasm.ERROR_OK, "i32");

    try {
      // Loop over index blocks
      while (this.wasm.om_decoder_next_index_read(decoderPtr, indexReadPtr)) {
        const indexOffset = Number(this.wasm.getValue(indexReadPtr, "i64"));
        const indexCount = Number(this.wasm.getValue(indexReadPtr + 8, "i64"));

        // Get bytes for index-read
        const indexDataPtr = await this.readDataBlock(indexOffset, indexCount);
        const dataReadPtr = this.newDataRead(indexReadPtr);

        try {
          // Collect prefetch tasks
          const prefetchTasks: (() => Promise<void>)[] = [];
          while (
            this.wasm.om_decoder_next_data_read(decoderPtr, dataReadPtr, indexDataPtr, BigInt(indexCount), errorPtr)
          ) {
            const dataOffset = Number(this.wasm.getValue(dataReadPtr, "i64"));
            const dataCount = Number(this.wasm.getValue(dataReadPtr + 8, "i64"));
            prefetchTasks.push(() => this.backend.prefetchData(dataOffset, dataCount));
          }

          // Run prefetches in parallel
          await runLimited(prefetchTasks, 5000);

          // Check for errors after data_read loop
          const error = this.wasm.getValue(errorPtr, "i32");
          if (error !== this.wasm.ERROR_OK) {
            throw new Error(`Data read error: ${error}`);
          }
        } finally {
          this.wasm._free(dataReadPtr);
          this.wasm._free(indexDataPtr);
        }
      }
    } finally {
      this.wasm._free(indexReadPtr);
      this.wasm._free(errorPtr);
    }
  }

  private async decode(decoderPtr: number, outputArray: TypedArray): Promise<void> {
    const outputPtr = this.wasm._malloc(outputArray.byteLength);
    const chunkBufferSize = Number(this.wasm.om_decoder_read_buffer_size(decoderPtr));
    const chunkBufferPtr = this.wasm._malloc(chunkBufferSize);
    // Create index_read struct
    const indexReadPtr = this.newIndexRead(decoderPtr);
    const errorPtr = this.wasm._malloc(4);
    // Initialize error to OK
    this.wasm.setValue(errorPtr, this.wasm.ERROR_OK, "i32");

    try {
      // Loop over index blocks
      while (this.wasm.om_decoder_next_index_read(decoderPtr, indexReadPtr)) {
        // Get index_read parameters
        const indexOffset = Number(this.wasm.getValue(indexReadPtr, "i64"));
        const indexCount = Number(this.wasm.getValue(indexReadPtr + 8, "i64"));
        // Get bytes for index-read
        const indexDataPtr = await this.readDataBlock(indexOffset, indexCount);
        const dataReadPtr = this.newDataRead(indexReadPtr);

        try {
          // Loop over data blocks and read compressed data chunks
          while (
            this.wasm.om_decoder_next_data_read(decoderPtr, dataReadPtr, indexDataPtr, BigInt(indexCount), errorPtr)
          ) {
            // Get data_read parameters
            const dataOffset = Number(this.wasm.getValue(dataReadPtr, "i64"));
            const dataCount = Number(this.wasm.getValue(dataReadPtr + 8, "i64"));
            const chunkIndexPtr = dataReadPtr + 32; // offset(8), count(8), indexRange(16)

            // Get bytes for data-read
            const dataBlockPtr = await this.readDataBlock(dataOffset, dataCount);

            try {
              // Decode chunks
              const success = this.wasm.om_decoder_decode_chunks(
                decoderPtr,
                chunkIndexPtr,
                dataBlockPtr,
                BigInt(dataCount),
                outputPtr,
                chunkBufferPtr,
                errorPtr
              );

              // Check for error
              if (!success) {
                const error = this.wasm.getValue(errorPtr, "i32");
                throw new Error(`Decoder failed to decode chunks: error ${error}`);
              }
            } finally {
              this.wasm._free(dataBlockPtr);
            }
          }

          // Check for errors after data_read loop
          const error = this.wasm.getValue(errorPtr, "i32");
          if (error !== this.wasm.ERROR_OK) {
            throw new Error(`Data read error: ${error}`);
          }
        } finally {
          this.wasm._free(dataReadPtr);
          this.wasm._free(indexDataPtr);
        }
      }

      // Copy the data back to the output array with the correct type
      this.copyToTypedArray(outputPtr, outputArray);
    } finally {
      this.wasm._free(errorPtr);
      this.wasm._free(indexReadPtr);
      this.wasm._free(chunkBufferPtr);
      this.wasm._free(outputPtr);
    }
  }

  private async readDataBlock(offset: number, size: number): Promise<number> {
    const data = await this.backend.getBytes(offset, size);
    const ptr = this.wasm._malloc(data.length);
    this.wasm.HEAPU8.set(data, ptr);
    return ptr;
  }

  /**
   * Helper method to copy data from WASM memory to a TypedArray with the correct type
   */
  private copyToTypedArray(sourcePtr: number, targetArray: TypedArray): void {
    switch (targetArray.constructor) {
      case Float32Array:
        (targetArray as Float32Array).set(new Float32Array(this.wasm.HEAPU8.buffer, sourcePtr, targetArray.length));
        break;
      case Float64Array:
        (targetArray as Float64Array).set(new Float64Array(this.wasm.HEAPU8.buffer, sourcePtr, targetArray.length));
        break;
      case Int8Array:
        (targetArray as Int8Array).set(new Int8Array(this.wasm.HEAPU8.buffer, sourcePtr, targetArray.length));
        break;
      case Uint8Array:
        (targetArray as Uint8Array).set(new Uint8Array(this.wasm.HEAPU8.buffer, sourcePtr, targetArray.length));
        break;
      case Int16Array:
        (targetArray as Int16Array).set(new Int16Array(this.wasm.HEAPU8.buffer, sourcePtr, targetArray.length));
        break;
      case Uint16Array:
        (targetArray as Uint16Array).set(new Uint16Array(this.wasm.HEAPU8.buffer, sourcePtr, targetArray.length));
        break;
      case Int32Array:
        (targetArray as Int32Array).set(new Int32Array(this.wasm.HEAPU8.buffer, sourcePtr, targetArray.length));
        break;
      case Uint32Array:
        (targetArray as Uint32Array).set(new Uint32Array(this.wasm.HEAPU8.buffer, sourcePtr, targetArray.length));
        break;
      case BigInt64Array:
        (targetArray as BigInt64Array).set(new BigInt64Array(this.wasm.HEAPU8.buffer, sourcePtr, targetArray.length));
        break;
      case BigUint64Array:
        (targetArray as BigUint64Array).set(new BigUint64Array(this.wasm.HEAPU8.buffer, sourcePtr, targetArray.length));
        break;
      default:
        throw new Error("Unsupported TypedArray type in copyToTypedArray");
    }
  }

  // Clean up resources when done
  dispose(): void {
    if (this.variableDataPtr !== null) {
      this.wasm._free(this.variableDataPtr);
      this.variableDataPtr = null;
    }
    this.variable = null;
  }
}
