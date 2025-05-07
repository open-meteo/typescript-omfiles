// @ts-ignore
import { OmFileFormat } from "../wasm/om_reader_wasm.js";

export interface WasmModule {
  _malloc(size: number): number;
  _free(ptr: number): void;
  setValue(ptr: number, value: any, type: string): void;
  getValue(ptr: number, type: string): any;
  HEAPU8: Uint8Array;

  // C-API functions
  om_header_size(): number;
  om_header_type(ptr: number): number;
  om_trailer_size(): number;
  om_trailer_read(trailerPtr: number, offsetPtr: number, sizePtr: number): boolean;
  om_variable_init(dataPtr: number): number;
  om_variable_get_type(variable: number): number;
  om_variable_get_compression(variable: number): number;
  om_variable_get_scale_factor(variable: number): number;
  om_variable_get_add_offset(variable: number): number;
  om_variable_get_dimension_count(variable: number): number;
  om_variable_get_dimension_value(variable: number, index: bigint): number;
  om_variable_get_chunk_count(variable: number): number;
  om_variable_get_chunk_value(variable: number, index: bigint): number;
  om_variable_get_name_count(variable: number): number;
  om_variable_get_name_ptr(variable: number): number;
  om_variable_get_children_count(variable: number): number;
  om_variable_get_children(variable: number, index: number, count: number, offsetPtr: number, sizePtr: number): boolean;
  om_variable_get_scalar(variable: number, ptrPtr: number, sizePtr: number): number;
  om_decoder_init(
    decoderPtr: number,
    variable: number,
    nDims: BigInt,
    readOffsetPtr: number,
    readCountPtr: number,
    intoCubeOffsetPtr: number,
    intoCubeDimensionPtr: number,
    ioSizeMerge: bigint,
    ioSizeMax: bigint
  ): number;
  om_decoder_init_index_read(decoder: number, indexReadPtr: number): void;
  om_decoder_init_data_read(dataReadPtr: number, indexReadPtr: number): void;
  om_decoder_read_buffer_size(decoderPtr: number): number;
  om_decoder_next_index_read(decoder: number, indexRead: number): boolean;
  om_decoder_next_data_read(
    decoder: number,
    dataRead: number,
    indexData: number,
    indexCount: bigint,
    error: number
  ): boolean;
  om_decoder_decode_chunks(
    decoder: number,
    chunkIndex: number,
    data: number,
    count: bigint,
    output: number,
    chunkBuffer: number,
    error: number
  ): boolean;

  // Constants
  OM_HEADER_INVALID: number;
  OM_HEADER_LEGACY: number;
  OM_HEADER_READ_TRAILER: number;
  ERROR_OK: number;
  DATA_TYPE_INT8_ARRAY: number;
  DATA_TYPE_UINT8_ARRAY: number;
  DATA_TYPE_INT16_ARRAY: number;
  DATA_TYPE_UINT16_ARRAY: number;
  DATA_TYPE_INT32_ARRAY: number;
  DATA_TYPE_UINT32_ARRAY: number;
  DATA_TYPE_INT64_ARRAY: number;
  DATA_TYPE_UINT64_ARRAY: number;
  DATA_TYPE_FLOAT_ARRAY: number;
  DATA_TYPE_DOUBLE_ARRAY: number;

  // Additional info
  sizeof_decoder: number;
}

// Constants mapping
const DATA_TYPES = {
  DATA_TYPE_NONE: 0,
  DATA_TYPE_INT8: 1,
  DATA_TYPE_UINT8: 2,
  DATA_TYPE_INT16: 3,
  DATA_TYPE_UINT16: 4,
  DATA_TYPE_INT32: 5,
  DATA_TYPE_UINT32: 6,
  DATA_TYPE_INT64: 7,
  DATA_TYPE_UINT64: 8,
  DATA_TYPE_FLOAT: 9,
  DATA_TYPE_DOUBLE: 10,
  DATA_TYPE_STRING: 11,
  DATA_TYPE_INT8_ARRAY: 12,
  DATA_TYPE_UINT8_ARRAY: 13,
  DATA_TYPE_INT16_ARRAY: 14,
  DATA_TYPE_UINT16_ARRAY: 15,
  DATA_TYPE_INT32_ARRAY: 16,
  DATA_TYPE_UINT32_ARRAY: 17,
  DATA_TYPE_INT64_ARRAY: 18,
  DATA_TYPE_UINT64_ARRAY: 19,
  DATA_TYPE_FLOAT_ARRAY: 20,
  DATA_TYPE_DOUBLE_ARRAY: 21,
  DATA_TYPE_STRING_ARRAY: 22,
};

const HEADER_TYPES = {
  OM_HEADER_INVALID: 0,
  OM_HEADER_LEGACY: 1,
  OM_HEADER_READ_TRAILER: 2,
};

const ERROR_CODES = {
  ERROR_OK: 0,
};

// Size of the decoder structure (estimate, will be updated during init)
const SIZEOF_DECODER = 256;

let wasmModuleRaw: any = null;
let wasmModuleWrapped: WasmModule | null = null;

export async function initWasm(): Promise<WasmModule> {
  if (wasmModuleWrapped) return wasmModuleWrapped;

  try {
    // Import the factory function that creates the module
    const OmFileFormat = await import("../wasm/om_reader_wasm.js");
    // Initialize the module by calling the factory function
    const wasmModuleRaw = await OmFileFormat.default();

    // Create our wrapped module with the expected interface
    wasmModuleWrapped = createWrappedModule(wasmModuleRaw);

    return wasmModuleWrapped;
  } catch (error) {
    throw new Error(`Failed to initialize WASM module: ${error}`);
  }
}

function createWrappedModule(rawModule: any): WasmModule {
  // Create a wrapper that maps the prefixed function names to our interface
  return {
    // Memory management functions
    _malloc: rawModule._malloc,
    _free: rawModule._free,
    setValue: rawModule.setValue,
    getValue: rawModule.getValue,
    HEAPU8: rawModule.HEAPU8,

    // Map all the C functions to their prefixed versions
    om_header_size: rawModule._om_header_size,
    om_header_type: rawModule._om_header_type,
    om_trailer_size: rawModule._om_trailer_size,
    om_trailer_read: rawModule._om_trailer_read,
    om_variable_init: rawModule._om_variable_init,
    om_variable_get_type: rawModule._om_variable_get_type,
    om_variable_get_compression: rawModule._om_variable_get_compression,
    om_variable_get_scale_factor: rawModule._om_variable_get_scale_factor,
    om_variable_get_add_offset: rawModule._om_variable_get_add_offset,
    om_variable_get_dimension_count: rawModule._om_variable_get_dimension_count,
    om_variable_get_dimension_value: rawModule._om_variable_get_dimension_value,
    om_variable_get_chunk_count: rawModule._om_variable_get_chunk_count,
    om_variable_get_chunk_value: rawModule._om_variable_get_chunk_value,
    om_variable_get_name_count: rawModule._om_variable_get_name_count,
    om_variable_get_name_ptr: rawModule._om_variable_get_name_ptr,
    om_variable_get_children_count: rawModule._om_variable_get_children_count,
    om_variable_get_children: rawModule._om_variable_get_children,
    om_variable_get_scalar: rawModule._om_variable_get_scalar,
    om_decoder_init: rawModule._om_decoder_init,
    om_decoder_init_index_read: rawModule._om_decoder_init_index_read,
    om_decoder_init_data_read: rawModule._om_decoder_init_data_read,
    om_decoder_read_buffer_size: rawModule._om_decoder_read_buffer_size,
    om_decoder_next_index_read: rawModule._om_decoder_next_index_read,
    om_decoder_next_data_read: rawModule._om_decoder_next_data_read,
    om_decoder_decode_chunks: rawModule._om_decoder_decode_chunks,

    // Constants
    ...HEADER_TYPES,
    ...ERROR_CODES,
    ...DATA_TYPES,

    // Additional info
    sizeof_decoder: SIZEOF_DECODER, // We could try to determine this dynamically if there's a C API for it
  };
}

export function getWasmModule() {
  if (!wasmModuleWrapped) {
    throw new Error("WASM module not initialized. Call initWasm() first.");
  }
  return wasmModuleWrapped;
}
