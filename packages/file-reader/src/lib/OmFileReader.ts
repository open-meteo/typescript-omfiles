import { OmFileReaderBackend } from "./backends/OmFileReaderBackend";
import { OffsetSize, OmDataType, TypedArray, Range } from "./types";
import { runLimited } from "./utils";
import { WasmModule, initWasm, getWasmModule } from "./wasm";

export class OmFileReader {
  private backend: OmFileReaderBackend;
  private wasm: WasmModule;
  private variable: number | null;
  private variableDataPtr: number | null;
  private verbose: boolean;

  constructor(backend: OmFileReaderBackend, wasm?: WasmModule) {
    this.backend = backend;
    this.wasm = wasm || getWasmModule();
    this.variable = null;
    this.variableDataPtr = null;
    this.verbose = false;
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
    // Similar to the 'new' method in Rust
    const headerSize = this.wasm.om_header_size();

    const headerData = await this.backend.getBytes(0, headerSize);
    const headerPtr = this.wasm._malloc(headerData.length);
    this.wasm.HEAPU8.set(headerData, headerPtr);

    const headerType = this.wasm.om_header_type(headerPtr);

    if (headerType === this.wasm.OM_HEADER_INVALID) {
      this.wasm._free(headerPtr);
      throw new Error("Not a valid OM file");
    }

    let variableData: Uint8Array;

    if (headerType === this.wasm.OM_HEADER_LEGACY) {
      variableData = headerData;
    } else if (headerType === this.wasm.OM_HEADER_READ_TRAILER) {
      const fileSize = await this.backend.count();
      const trailerSize = this.wasm.om_trailer_size();
      const trailerOffset = fileSize - trailerSize;

      const trailerPtr = await this.readDataBlock(trailerOffset, trailerSize);

      // Create pointers for offset and size (out parameters)
      const offsetPtr = this.wasm._malloc(8); // 64-bit value = 8 bytes
      const sizePtr = this.wasm._malloc(8);

      const success = this.wasm.om_trailer_read(trailerPtr, offsetPtr, sizePtr);

      if (!success) {
        this.wasm._free(headerPtr);
        this.wasm._free(trailerPtr);
        this.wasm._free(offsetPtr);
        this.wasm._free(sizePtr);
        throw new Error("Failed to read trailer");
      }

      // Read values from memory
      const offset = Number(this.wasm.getValue(offsetPtr, "i64"));
      const size = Number(this.wasm.getValue(sizePtr, "i64"));

      // Free memory
      this.wasm._free(trailerPtr);
      this.wasm._free(offsetPtr);
      this.wasm._free(sizePtr);

      // Get variable data
      variableData = await this.backend.getBytes(offset, size);
    } else {
      this.wasm._free(headerPtr);
      throw new Error("Unknown header type");
    }

    // Initialize variable
    const variableDataPtr = this.wasm._malloc(variableData.length);
    this.wasm.HEAPU8.set(variableData, variableDataPtr);
    this.variable = this.wasm.om_variable_init(variableDataPtr);
    this.variableDataPtr = variableDataPtr;

    this.wasm._free(headerPtr);

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

    // Get count using the wrapper function
    const count = Number(this.wasm.om_variable_get_dimension_count(this.variable));

    // Get each dimension individually
    const dimensions: number[] = [];
    for (let i = 0; i < count; i++) {
      dimensions.push(Number(this.wasm.om_variable_get_dimension_value(this.variable, BigInt(i))));
    }

    return dimensions;
  }

  getChunkDimensions(): number[] {
    if (this.variable === null) throw new Error("Reader not initialized");

    // Get count using the wrapper function
    const count = Number(this.wasm.om_variable_get_chunk_count(this.variable));

    // Get each chunk dimension individually
    const chunks: number[] = [];
    for (let i = 0; i < count; i++) {
      chunks.push(Number(this.wasm.om_variable_get_chunk_value(this.variable, BigInt(i))));
    }

    return chunks;
  }

  getName(): string | null {
    if (this.variable === null) throw new Error("Reader not initialized");

    const size = this.wasm.om_variable_get_name_count(this.variable);
    if (size === 0) {
      return null;
    }

    const valuePtr = this.wasm.om_variable_get_name_ptr(this.variable);
    if (valuePtr === 0) {
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

  async initChildFromOffsetSize(offsetSize: OffsetSize): Promise<OmFileReader> {
    const childDataPtr = await this.readDataBlock(offsetSize.offset, offsetSize.size);

    const childReader = new OmFileReader(this.backend, this.wasm);

    childReader.variable = this.wasm.om_variable_init(childDataPtr);
    childReader.variableDataPtr = childDataPtr;

    return childReader;
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
      const size = Number(this.wasm.getValue(sizePtr, "i64"));

      if (dataPtr === 0) {
        return null;
      }

      // Read data based on type
      let result: any;

      switch (dataType) {
        case OmDataType.Int8:
          result = this.wasm.getValue(dataPtr, "i8");
          break;
        case OmDataType.Uint8:
          result = this.wasm.getValue(dataPtr, "i8") & 0xff;
          break;
        case OmDataType.Int16:
          result = this.wasm.getValue(dataPtr, "i16");
          break;
        case OmDataType.Uint16:
          result = this.wasm.getValue(dataPtr, "i16") & 0xffff;
          break;
        case OmDataType.Int32:
          result = this.wasm.getValue(dataPtr, "i32");
          break;
        case OmDataType.Uint32:
          result = this.wasm.getValue(dataPtr, "i32") >>> 0;
          break;
        case OmDataType.Float:
          result = this.wasm.getValue(dataPtr, "float");
          break;
        case OmDataType.Double:
          result = this.wasm.getValue(dataPtr, "double");
          break;
        default:
          result = null;
      }

      return result as T;
    } finally {
      this.wasm._free(ptrPtr);
      this.wasm._free(sizePtr);
    }
  }

  private newIndexRead(decoderPtr: number): number {
    // Calculate proper size for OmDecoder_indexRead_t
    const sizeOfRange = 16; // 8 bytes for lowerBound + 8 bytes for upperBound
    const sizeOfIndexRead = 8 + 8 + sizeOfRange * 3; // offset + count + 3 range structs

    // Allocate and zero the memory
    const indexReadPtr = this.wasm._malloc(sizeOfIndexRead);

    // Zero out the memory (equivalent to std::mem::zeroed())
    const zeroBuffer = new Uint8Array(sizeOfIndexRead);
    this.wasm.HEAPU8.set(zeroBuffer, indexReadPtr);

    // Initialize the structure using C function
    this.wasm.om_decoder_init_index_read(decoderPtr, indexReadPtr);

    return indexReadPtr;
  }

  private newDataRead(indexReadPtr: number): number {
    // Size of OmDecoder_dataRead_t
    const sizeOfRange = 16; // 8 bytes for lowerBound + 8 bytes for upperBound
    const sizeOfDataRead = 8 + 8 + sizeOfRange * 3; // offset + count + 3 range structs

    // Allocate and zero the memory
    const dataReadPtr = this.wasm._malloc(sizeOfDataRead);

    // Zero out the memory (equivalent to std::mem::zeroed())
    const zeroBuffer = new Uint8Array(sizeOfDataRead);
    this.wasm.HEAPU8.set(zeroBuffer, dataReadPtr);

    // Initialize the structure using C function
    this.wasm.om_decoder_init_data_read(dataReadPtr, indexReadPtr);

    return dataReadPtr;
  }

  async read(
    dataType: OmDataType,
    dimRanges: Range[],
    ioSizeMax: bigint = BigInt(65536),
    ioSizeMerge: bigint = BigInt(512),
    prefetch: boolean = true
  ): Promise<TypedArray> {
    if (this.variable === null) throw new Error("Reader not initialized");

    if (this.dataType() !== dataType) {
      throw new Error(`Invalid data type: expected ${this.dataType()}, got ${dataType}`);
    }

    // Calculate output dimensions
    const outDims = dimRanges.map((range) => Number(range.end - range.start));
    const totalSize = outDims.reduce((a, b) => a * b, 1);

    // Create output TypedArray based on data type
    let output: TypedArray;
    switch (dataType) {
      case this.wasm.DATA_TYPE_INT8_ARRAY:
        output = new Int8Array(totalSize);
        break;
      case this.wasm.DATA_TYPE_UINT8_ARRAY:
        output = new Uint8Array(totalSize);
        break;
      case this.wasm.DATA_TYPE_INT16_ARRAY:
        output = new Int16Array(totalSize);
        break;
      case this.wasm.DATA_TYPE_UINT16_ARRAY:
        output = new Uint16Array(totalSize);
        break;
      case this.wasm.DATA_TYPE_INT32_ARRAY:
        output = new Int32Array(totalSize);
        break;
      case this.wasm.DATA_TYPE_UINT32_ARRAY:
        output = new Uint32Array(totalSize);
        break;
      case this.wasm.DATA_TYPE_FLOAT_ARRAY:
        output = new Float32Array(totalSize);
        break;
      case this.wasm.DATA_TYPE_DOUBLE_ARRAY:
        output = new Float64Array(totalSize);
        break;
      default:
        throw new Error("Unsupported data type");
    }

    await this.readInto(dataType, output, dimRanges, ioSizeMax, ioSizeMerge, prefetch);
    return output;
  }

  /**
   * Read data into an existing TypedArray with specified dimension ranges
   * @param dataType The data type to read
   * @param output The TypedArray to read data into
   * @param dimRanges Ranges for each dimension to read
   * @param ioSizeMax Maximum I/O size (default: 65536)
   * @param ioSizeMerge Merge threshold for I/O operations (default: 512)
   */
  async readInto(
    dataType: OmDataType,
    output: TypedArray,
    dimRanges: Range[],
    ioSizeMax: bigint = BigInt(65536),
    ioSizeMerge: bigint = BigInt(512),
    prefetch: boolean = true
  ): Promise<void> {
    if (this.variable === null) throw new Error("Reader not initialized");

    if (this.dataType() !== dataType) {
      throw new Error(`Invalid data type: expected ${this.dataType()}, got ${dataType}`);
    }

    const nDims = dimRanges.length;
    const fileDims = this.getDimensions();

    // Validate dimension counts
    if (fileDims.length !== nDims) {
      throw new Error(`Mismatched dimensions: file has ${fileDims.length}, request has ${nDims}`);
    }

    // Calculate output dimensions and prepare arrays for WASM
    const outDims = dimRanges.map((range) => range.end - range.start);

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
        if (dimRanges[i].start < 0 || dimRanges[i].end > fileDims[i] || dimRanges[i].start >= dimRanges[i].end) {
          throw new Error(`Invalid range for dimension ${i}: ${JSON.stringify(dimRanges[i])}`);
        }

        this.wasm.setValue(readOffsetPtr + i * 8, BigInt(dimRanges[i].start), "i64");
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
        let dataReadPtr = this.newDataRead(indexReadPtr);

        try {
          // Collect prefetch tasks
          const prefetchTasks: (() => Promise<void>)[] = [];
          while (
            this.wasm.om_decoder_next_data_read(
              decoderPtr,
              dataReadPtr,
              indexDataPtr,
              BigInt(indexCount),
              errorPtr
            )
          ) {
            const dataOffset = Number(this.wasm.getValue(dataReadPtr, "i64"));
            const dataCount = Number(this.wasm.getValue(dataReadPtr + 8, "i64"));
            prefetchTasks.push(() => this.backend.prefetchData(dataOffset, dataCount));
          }

          // Run prefetches in parallel
          await Promise.all(prefetchTasks);

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
    if (this.verbose){
    	console.log(`Starting decode with ${outputArray.constructor.name}, length=${outputArray.length}`);
    }

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
      let indexBlockCount = 0;
      while (this.wasm.om_decoder_next_index_read(decoderPtr, indexReadPtr)) {
        indexBlockCount++;

        // Get index_read parameters
        const indexOffset = Number(this.wasm.getValue(indexReadPtr, "i64"));
        const indexCount = Number(this.wasm.getValue(indexReadPtr + 8, "i64"));

        if (this.verbose){
          console.log(`Index block #${indexBlockCount}: offset=${indexOffset}, count=${indexCount}`);
        }

        // Get bytes for index-read
        const indexDataPtr = await this.readDataBlock(indexOffset, indexCount);

        // Create data_read struct
        let dataReadPtr = this.newDataRead(indexReadPtr);

        try {
          // Collect all data block info first
          let dataBlockCount = 0;
          const dataBlocks: { dataOffset: number, dataCount: number, chunkIndexArray: BigUint64Array }[] = [];
          while (
            this.wasm.om_decoder_next_data_read(
              decoderPtr,
              dataReadPtr,
              indexDataPtr,
              BigInt(indexCount),
              errorPtr
            )
          ) {
            dataBlockCount++;
            const dataOffset = Number(this.wasm.getValue(dataReadPtr, "i64"));
            const dataCount = Number(this.wasm.getValue(dataReadPtr + 8, "i64"));
            const chunkIndexArrayShared = new BigUint64Array(this.wasm.HEAPU8.buffer, dataReadPtr + 32, 2);
            const chunkIndexArray = new BigUint64Array(chunkIndexArrayShared)
            // console.log(`Chunk Index Array: ${chunkIndexArray}`);
            // const chunkIndexStart = Number(this.wasm.getValue(dataReadPtr + 48, "u64"));
            // const chunkIndexEnd = Number(this.wasm.getValue(dataReadPtr + 40, "u64"));
            if (this.verbose) {
              console.log(
                `  Data block #${dataBlockCount}: offset=${dataOffset}, count=${dataCount}, chunkIndexArray=${chunkIndexArray}`
              );
            }
            dataBlocks.push({ dataOffset, dataCount, chunkIndexArray });
          }

          // Fetch data blocks in parallel with concurrency limit
          const dataBlocksData = await runLimited(
            dataBlocks.map(({ dataOffset, dataCount }) => () => this.fetchBlock(dataOffset, dataCount)),
            100
          );

          // Decode each block sequentially
          // console.log("Decoding each block sequentially");
          for (let i = 0; i < dataBlocks.length; i++) {
            const { dataOffset, dataCount, chunkIndexArray} = dataBlocks[i];
            const chunkIndexPtr = this.wasm._malloc(2 * 8);
            for (let i = 0; i < chunkIndexArray.length; i++) {
              this.wasm.setValue(chunkIndexPtr + i * 8, chunkIndexArray[i], "i64");
            }
            // console.log(`Chunk Index Array: ${chunkIndexArray}`);

            const dataBlockPtr = this.wasm._malloc(dataBlocksData[i].length);
            this.wasm.HEAPU8.set(dataBlocksData[i], dataBlockPtr);
            try {
              // console.log("Decoding...");
              const success = this.wasm.om_decoder_decode_chunks(
                decoderPtr,
                chunkIndexPtr,
                dataBlockPtr,
                BigInt(dataCount),
                outputPtr,
                chunkBufferPtr,
                errorPtr
              );
              // console.log("Decoding complete");
              // console.log(`Success: ${success}`)
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
      // console.log("Copying data back to output array");
      this.copyToTypedArray(outputPtr, outputArray);
    } finally {
      this.wasm._free(errorPtr);
      this.wasm._free(indexReadPtr);
      this.wasm._free(chunkBufferPtr);
      this.wasm._free(outputPtr);
    }
  }

  private async fetchBlock(offset: number, size: number): Promise<Uint8Array<ArrayBufferLike>> {
    return await this.backend.getBytes(offset, size);
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
        const f32Array = new Float32Array(this.wasm.HEAPU8.buffer, sourcePtr, targetArray.length);
        (targetArray as Float32Array).set(f32Array);
        break;
      case Float64Array:
        const f64Array = new Float64Array(this.wasm.HEAPU8.buffer, sourcePtr, targetArray.length);
        (targetArray as Float64Array).set(f64Array);
        break;
      case Int8Array:
        const i8Array = new Int8Array(this.wasm.HEAPU8.buffer, sourcePtr, targetArray.length);
        (targetArray as Int8Array).set(i8Array);
        break;
      case Uint8Array:
        const u8Array = new Uint8Array(this.wasm.HEAPU8.buffer, sourcePtr, targetArray.length);
        (targetArray as Uint8Array).set(u8Array);
        break;
      case Int16Array:
        const i16Array = new Int16Array(this.wasm.HEAPU8.buffer, sourcePtr, targetArray.length);
        (targetArray as Int16Array).set(i16Array);
        break;
      case Uint16Array:
        const u16Array = new Uint16Array(this.wasm.HEAPU8.buffer, sourcePtr, targetArray.length);
        (targetArray as Uint16Array).set(u16Array);
        break;
      case Int32Array:
        const i32Array = new Int32Array(this.wasm.HEAPU8.buffer, sourcePtr, targetArray.length);
        (targetArray as Int32Array).set(i32Array);
        break;
      case Uint32Array:
        const u32Array = new Uint32Array(this.wasm.HEAPU8.buffer, sourcePtr, targetArray.length);
        (targetArray as Uint32Array).set(u32Array);
        break;
      default:
        // Fallback to byte-by-byte copy
        const byteArray = new Uint8Array(this.wasm.HEAPU8.buffer, sourcePtr, targetArray.byteLength);
        new Uint8Array(targetArray.buffer).set(byteArray);
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
