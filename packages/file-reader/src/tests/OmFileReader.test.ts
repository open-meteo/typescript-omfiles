import { describe, beforeAll, afterEach, it, expect, beforeEach } from "vitest";
import { initWasm, WasmModule } from "../lib/wasm";
import { OmFileReader } from "../lib/OmFileReader";
import path from "path";
import { CompressionType, OmDataType, Range } from "../lib/types";
import { FileBackendNode } from "../lib/backends/FileBackendNode";
import { OmFileReaderBackend } from "../lib/backends/OmFileReaderBackend";

describe("OmFileReader", () => {
  let reader: OmFileReader;
  let wasm: WasmModule;
  let backend: OmFileReaderBackend;

  // Initialize WASM and load test file before all tests
  beforeAll(async () => {
    wasm = await initWasm();
  });

  beforeEach(async () => {
    const testFilePath = path.join(__dirname, "../../test-data/read_test.om");
    backend = new FileBackendNode(testFilePath);
    reader = new OmFileReader(backend, wasm);
  });

  afterEach(async () => {
    if (reader) {
      reader.dispose();
    }
    if (backend) {
      await backend.close();
    }
  });

  it("should successfully initialize a reader", async () => {
    await expect(reader.initialize()).resolves.not.toThrow();
  });

  it("should fail to initialize reader with invalid data", async () => {
    const invalidBackend = new FileBackendNode(new ArrayBuffer(10)); // Too small to be valid
    const invalidReader = new OmFileReader(invalidBackend, wasm);

    await expect(invalidReader.initialize()).rejects.toThrow();
  });

  // Test getting name - this exercises the string handling
  it("should get the variable name if available", async () => {
    await reader.initialize();
    const name = reader.getName();
    console.log("Variable name:", name);
    // The name could be null if not set in file, so we just verify the API
    expect(typeof name === "string" || name === null).toBe(true);
  });

  // Test getting dimensions
  it("should correctly report dimensions", async () => {
    await reader.initialize();
    const dimensions = reader.getDimensions();

    expect(dimensions).toStrictEqual([5, 5]);
  });

  // Test getting name does not interfere with other metadata
  it("should correctly report dimensions after call to getName", async () => {
    await reader.initialize();
    const dimensions = reader.getDimensions();
    const name = reader.getName();
    expect(name).toBe("data");
    const dimensions2 = reader.getDimensions();

    expect(dimensions).toStrictEqual([5, 5]);
    expect(dimensions2).toStrictEqual([5, 5]);
  });

  // Test getting chunk dimensions
  it("should correctly report chunk dimensions", async () => {
    await reader.initialize();
    const chunks = reader.getChunkDimensions();

    expect(chunks).toStrictEqual([2, 2]);
    // Chunk dimensions array length should match file dimensions
    const dims = reader.getDimensions();
    expect(chunks.length).toBe(dims.length);
  });

  // Test data type and compression
  it("should report data type and compression correctly", async () => {
    await reader.initialize();
    const dataType = reader.dataType();
    const compression = reader.compression();

    expect(dataType).toBe(OmDataType.FloatArray);
    expect(compression).toBe(CompressionType.PforDelta2dInt16);
  });

  // Test scale factor and add offset
  it("should report scale factor and add offset", async () => {
    await reader.initialize();
    const scaleFactor = reader.scaleFactor();
    const addOffset = reader.addOffset();

    expect(scaleFactor).toBe(1);
    expect(addOffset).toBe(0);
  });

  // Test number of children
  it("should report the correct number of children", async () => {
    await reader.initialize();
    const numChildren = reader.numberOfChildren();
    // Test file does not have children
    expect(numChildren).toBe(0);
  });

  it("should successfully read data", async () => {
    await reader.initialize();

    const dimReadRange: Range[] = [
      { start: 0, end: 2 },
      { start: 0, end: 2 },
    ];

    const output = await reader.read(wasm.DATA_TYPE_FLOAT_ARRAY, dimReadRange);
    expect(output).toBeInstanceOf(Float32Array);

    console.log("Output data:", output);

    expect(output).toStrictEqual(new Float32Array([0, 1, 5, 6]));
  });

  it("should successfully readInto data", async () => {
    await reader.initialize();

    const outputSize = 4;
    const output = new Float32Array(outputSize);
    const dimReadRange: Range[] = [
      { start: 0, end: 2 },
      { start: 0, end: 2 },
    ];

    await expect(reader.readInto(wasm.DATA_TYPE_FLOAT_ARRAY, output, dimReadRange)).resolves.not.toThrow();

    expect(output).toStrictEqual(new Float32Array([0, 1, 5, 6]));
  });

  it("should fail with invalid dimensions", async () => {
    await reader.initialize();

    const output = new Float32Array(125);
    const dimReadRange: Range[] = [
      { start: 0, end: 5 },
      { start: 0, end: 5 },
      { start: 0, end: 5 },
    ]; // Wrong number of dimensions

    await expect(reader.readInto(wasm.DATA_TYPE_FLOAT_ARRAY, output, dimReadRange)).rejects.toThrow();
  });

  it("should handle out-of-bounds reads", async () => {
    await reader.initialize();

    const output = new Float32Array(10000);
    const dimReadRange: Range[] = [
      { start: 0, end: 100 },
      { start: 0, end: 100 },
    ]; // This exceeds the dimensions of the test file

    await expect(reader.readInto(wasm.DATA_TYPE_FLOAT_ARRAY, output, dimReadRange)).rejects.toThrow();
  });

  it("should properly clean up resources", async () => {
    await reader.initialize();
    reader.dispose();

    // Attempting to use the reader after disposal should throw
    const dimReadRange: Range[] = [
      { start: 0, end: 5 },
      { start: 0, end: 5 },
    ];

    await expect(reader.read(wasm.DATA_TYPE_FLOAT_ARRAY, dimReadRange)).rejects.toThrow();
  });
});

describe("OmFileReader hierarchical file navigation", () => {
  let reader: OmFileReader;
  let wasm: WasmModule;
  let backend: OmFileReaderBackend;

  beforeAll(async () => {
    wasm = await initWasm();
  });

  beforeEach(async () => {
    const testFilePath = path.join(__dirname, "../../test-data/hierarchical.om");
    backend = new FileBackendNode(testFilePath);
    reader = new OmFileReader(backend, wasm);
    await reader.initialize();
  });

  afterEach(async () => {
    if (reader) {
      reader.dispose();
    }
    if (backend) {
      await backend.close();
    }
  });

  it("should find nodes by path", async () => {
    // Test finding at different levels
    const child_0 = await reader.findByPath("child_0");
    expect(child_0).not.toBeNull();
    expect(child_0?.getName()).toBe("child_0");

    const child_0_0 = await reader.findByPath("child_0/child_0_0");
    expect(child_0_0).not.toBeNull();
    expect(child_0_0?.getName()).toBe("child_0_0");

    const child_0_0_1 = await reader.findByPath("child_0/child_0_0/child_0_0_1");
    expect(child_0_0_1).not.toBeNull();
    expect(child_0_0_1?.getName()).toBe("child_0_0_1");

    const nonexistent = await reader.findByPath("child_0/child_0_2");
    expect(nonexistent).toBeNull();
  });

  it("should get child by name", async () => {
    const child_0 = await reader.getChildByName("child_0");
    expect(child_0).not.toBeNull();

    const child_0_1 = await child_0?.getChildByName("child_0_1");
    expect(child_0_1).not.toBeNull();

    const child_0_1_0 = await child_0_1?.getChildByName("child_0_1_0");
    expect(child_0_1_0).not.toBeNull();
    expect(child_0_1_0?.getName()).toBe("child_0_1_0");

    const nonexistent = await child_0?.getChildByName("child_0_9");
    expect(nonexistent).toBeNull();
  });

  it("should navigate and read data from leaf nodes", async () => {
    // Navigate to leaf node and read data
    const child_0_0_1 = await reader.findByPath("child_0/child_0_0/child_0_0_1");
    expect(child_0_0_1).not.toBeNull();

    // Read 2x3 slice
    const data = await child_0_0_1?.read(wasm.DATA_TYPE_FLOAT_ARRAY, [
      { start: 0, end: 2 },
      { start: 0, end: 3 },
    ]);
    expect(data).toStrictEqual(new Float32Array([20.1, 20.2, 20.3, 21.1, 21.2, 21.3]));

    const child_0_1_1 = await reader.findByPath("child_0/child_0_1/child_0_1_1");
    expect(child_0_1_1).not.toBeNull();

    const data2 = await child_0_1_1?.read(wasm.DATA_TYPE_FLOAT_ARRAY, [{ start: 0, end: 2 }]);
    expect(data2).toStrictEqual(new Float32Array([1013.25, 1012.5]));
  });
});
