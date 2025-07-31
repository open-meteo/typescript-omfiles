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
  _malloc(size: number): number;
  _free(ptr: number): void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  setValue(ptr: number, value: any, type: string): void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getValue(ptr: number, type: string): any;
  HEAPU8: Uint8Array;

  // OM reader functions
  _om_header_size(): number;
  _om_header_type(ptr: number): number;
  _om_trailer_size(): number;
  _om_trailer_read(trailerPtr: number, offsetPtr: number, sizePtr: number): boolean;
  _om_variable_init(dataPtr: number): number;
  _om_variable_get_type(variable: number): number;
  _om_variable_get_compression(variable: number): number;
  _om_variable_get_scale_factor(variable: number): number;
  _om_variable_get_add_offset(variable: number): number;
  _om_variable_get_dimension_count(variable: number): number;
  _om_variable_get_dimension_value(variable: number, index: bigint): number;
  _om_variable_get_chunk_count(variable: number): number;
  _om_variable_get_chunk_value(variable: number, index: bigint): number;
  _om_variable_get_name(variable: number): number;
  _om_variable_get_children_count(variable: number): number;
  _om_variable_get_children(
    variable: number,
    index: number,
    count: number,
    offsetPtr: number,
    sizePtr: number
  ): boolean;
  _om_variable_get_scalar(variable: number, ptrPtr: number, sizePtr: number): number;
  _om_decoder_init(
    decoderPtr: number,
    variable: number,
    nDims: bigint,
    readOffsetPtr: number,
    readCountPtr: number,
    intoCubeOffsetPtr: number,
    intoCubeDimensionPtr: number,
    ioSizeMerge: bigint,
    ioSizeMax: bigint
  ): number;
  _om_decoder_init_index_read(decoder: number, indexReadPtr: number): void;
  _om_decoder_init_data_read(dataReadPtr: number, indexReadPtr: number): void;
  _om_decoder_read_buffer_size(decoderPtr: number): number;
  _om_decoder_next_index_read(decoder: number, indexRead: number): boolean;
  _om_decoder_next_data_read(
    decoder: number,
    dataRead: number,
    indexData: number,
    indexCount: bigint,
    error: number
  ): boolean;
  _om_decoder_decode_chunks(
    decoder: number,
    chunkIndex: number,
    data: number,
    count: bigint,
    output: number,
    chunkBuffer: number,
    error: number
  ): boolean;

  // Runtime status
  calledRun: boolean;
  onRuntimeInitialized: () => void;
}

// For raw WASM files
declare module "*.wasm" {
  const wasmUrl: string;
  export default wasmUrl;
}
