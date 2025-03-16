import { describe, it, expect } from "vitest";
import { initWasm } from "../index";
import { getWasmModule } from "../lib/wasm";

describe("WASM", () => {
  it("should not throw when initialized", () => {
    expect(async () => {
      await initWasm();
    }).not.toThrow();
  });

  it("should have all required WASM functions and constants", async () => {
    await initWasm();
    const wasm = getWasmModule();
    // Check required functions
    expect(typeof wasm.om_header_size).toBe("function");
    expect(typeof wasm.om_header_type).toBe("function");
    expect(typeof wasm.om_trailer_size).toBe("function");
    expect(typeof wasm.om_trailer_read).toBe("function");
    expect(typeof wasm.om_variable_init).toBe("function");
    expect(typeof wasm.om_variable_get_type).toBe("function");
    expect(typeof wasm.om_variable_get_compression).toBe("function");
    expect(typeof wasm.om_variable_get_scale_factor).toBe("function");
    expect(typeof wasm.om_variable_get_add_offset).toBe("function");
    expect(typeof wasm.om_variable_get_dimension_count).toBe("function");
    expect(typeof wasm.om_variable_get_dimension_value).toBe("function");
    expect(typeof wasm.om_variable_get_chunk_count).toBe("function");
    expect(typeof wasm.om_variable_get_chunk_value).toBe("function");
    expect(typeof wasm.om_variable_get_name_ptr).toBe("function");
    expect(typeof wasm.om_variable_get_children_count).toBe("function");
    expect(typeof wasm.om_variable_get_children).toBe("function");
    expect(typeof wasm.om_variable_get_scalar).toBe("function");
    expect(typeof wasm.om_decoder_init).toBe("function");
    expect(typeof wasm.om_decoder_read_buffer_size).toBe("function");
    expect(typeof wasm.om_decoder_next_index_read).toBe("function");
    expect(typeof wasm.om_decoder_next_data_read).toBe("function");
    expect(typeof wasm.om_decoder_decode_chunks).toBe("function");

    // Check memory management functions
    expect(typeof wasm._malloc).toBe("function");
    expect(typeof wasm._free).toBe("function");
    expect(typeof wasm.setValue).toBe("function");
    expect(typeof wasm.getValue).toBe("function");

    // Check required memory views
    expect(wasm.HEAPU8).toBeInstanceOf(Uint8Array);
    expect(wasm.HEAPU32).toBeInstanceOf(Uint32Array);

    // Check required constants
    expect(typeof wasm.OM_HEADER_INVALID).toBe("number");
    expect(typeof wasm.OM_HEADER_LEGACY).toBe("number");
    expect(typeof wasm.OM_HEADER_READ_TRAILER).toBe("number");
    expect(typeof wasm.ERROR_OK).toBe("number");

    // Check data type constants
    expect(typeof wasm.DATA_TYPE_INT8_ARRAY).toBe("number");
    expect(typeof wasm.DATA_TYPE_UINT8_ARRAY).toBe("number");
    expect(typeof wasm.DATA_TYPE_INT16_ARRAY).toBe("number");
    expect(typeof wasm.DATA_TYPE_UINT16_ARRAY).toBe("number");
    expect(typeof wasm.DATA_TYPE_INT32_ARRAY).toBe("number");
    expect(typeof wasm.DATA_TYPE_UINT32_ARRAY).toBe("number");
    expect(typeof wasm.DATA_TYPE_FLOAT_ARRAY).toBe("number");
    expect(typeof wasm.DATA_TYPE_DOUBLE_ARRAY).toBe("number");

    // Check that sizeof_decoder is defined
    expect(typeof wasm.sizeof_decoder).toBe("number");
    expect(wasm.sizeof_decoder).toBeGreaterThan(0);
  });
});
