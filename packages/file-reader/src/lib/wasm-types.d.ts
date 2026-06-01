declare module "*om_reader_wasm.js" {
  // This default export function creates the module
  function ModuleFactory(options?: {
    locateFile?: (path: string) => string;
    wasmBinary?: ArrayBuffer;
    onRuntimeInitialized?: () => void;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    [key: string]: any;
  }): Promise<EmscriptenModule>;

  export default ModuleFactory;
}

// Define the Emscripten module interface
interface EmscriptenModule {
  // Memory management
  _malloc(this: void, size: number): number;
  _free(this: void, ptr: number): void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  setValue(this: void, ptr: number, value: any, type: string): void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getValue(this: void, ptr: number, type: string): any;
  HEAPU8: Uint8Array;

  // OM reader functions
  _om_header_size(this: void): number;
  _om_header_type(this: void, ptr: number): number;
  _om_trailer_size(this: void): number;
  _om_trailer_read(this: void, trailerPtr: number, offsetPtr: number, sizePtr: number): boolean;
  _om_variable_init(this: void, dataPtr: number): number;
  _om_variable_get_type(this: void, variable: number): number;
  _om_variable_get_compression(this: void, variable: number): number;
  _om_variable_get_scale_factor(this: void, variable: number): number;
  _om_variable_get_add_offset(this: void, variable: number): number;
  _om_variable_get_dimensions_count(this: void, variable: number): number;
  _om_variable_get_dimensions(this: void, variable: number): number;
  _om_variable_get_chunks(this: void, variable: number): number;
  _om_variable_get_name(this: void, variable: number): number;
  _om_variable_get_children_count(this: void, variable: number): number;
  _om_variable_get_children(this: void, variable: number, index: number, count: number, offsetPtr: number, sizePtr: number): boolean;
  _om_variable_get_scalar(this: void, variable: number, ptrPtr: number, sizePtr: number): number;
  _om_decoder_init(this: void, decoderPtr: number, variable: number, nDims: bigint, readOffsetPtr: number, readCountPtr: number, intoCubeOffsetPtr: number, intoCubeDimensionPtr: number, ioSizeMerge: bigint, ioSizeMax: bigint): number;
  _om_decoder_init_index_read(this: void, decoder: number, indexReadPtr: number): void;
  _om_decoder_init_data_read(this: void, dataReadPtr: number, indexReadPtr: number): void;
  _om_decoder_read_buffer_size(this: void, decoderPtr: number): number;
  _om_decoder_next_index_read(this: void, decoder: number, indexRead: number): boolean;
  _om_decoder_next_data_read(this: void, decoder: number, dataRead: number, indexData: number, indexCount: bigint, error: number): boolean;
  _om_decoder_decode_chunks(this: void, decoder: number, chunkIndex: number, data: number, count: bigint, output: number, chunkBuffer: number, error: number): boolean;

  // Runtime status
  calledRun: boolean;
  onRuntimeInitialized: () => void;
}

declare module "@openmeteo/file-format-wasm" {
  const factory: () => Promise<EmscriptenModule>;
  export default factory;
}

// For raw WASM files
declare module "*.wasm" {
  const wasmUrl: string;
  export default wasmUrl;
}
