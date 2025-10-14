import { describe, beforeAll, afterEach, it, expect, beforeEach } from "vitest";
import { initWasm, WasmModule } from "../lib/wasm";
import { OmFileReader } from "../lib/OmFileReader";
import path from "path";
import { CompressionType, OmDataType, Range, TypedArray } from "../lib/types";
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

    const output = await reader.read({ type: OmDataType.FloatArray, ranges: dimReadRange });
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

    await expect(reader.readInto({ type: OmDataType.FloatArray, output, ranges: dimReadRange })).resolves.not.toThrow();

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

    await expect(reader.readInto({ type: OmDataType.FloatArray, output, ranges: dimReadRange })).rejects.toThrow();
  });

  it("should handle out-of-bounds reads", async () => {
    await reader.initialize();

    const output = new Float32Array(10000);
    const dimReadRange: Range[] = [
      { start: 0, end: 100 },
      { start: 0, end: 100 },
    ]; // This exceeds the dimensions of the test file

    await expect(reader.readInto({ type: OmDataType.FloatArray, output, ranges: dimReadRange })).rejects.toThrow();
  });

  it("should properly clean up resources", async () => {
    await reader.initialize();
    reader.dispose();

    // Attempting to use the reader after disposal should throw
    const dimReadRange: Range[] = [
      { start: 0, end: 5 },
      { start: 0, end: 5 },
    ];

    await expect(reader.read({ type: OmDataType.FloatArray, ranges: dimReadRange })).rejects.toThrow();
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
    const data = await child_0_0_1?.read({
      type: OmDataType.FloatArray,
      ranges: [
        { start: 0, end: 2 },
        { start: 0, end: 3 },
      ],
      intoSAB: true,
    });
    expect(data).toStrictEqual(new Float32Array([20.1, 20.2, 20.3, 21.1, 21.2, 21.3]));

    const child_0_1_1 = await reader.findByPath("child_0/child_0_1/child_0_1_1");
    expect(child_0_1_1).not.toBeNull();

    const data2 = await child_0_1_1!.read({ type: OmDataType.FloatArray, ranges: [{ start: 0, end: 2 }] });
    expect(data2).toStrictEqual(new Float32Array([1013.25, 1012.5]));
  });

  it("should read all supported array data types from all_types group", async () => {
    const arrayTests: {
      name: string;
      type: number;
      expected: TypedArray;
    }[] = [
      { name: "int8", type: OmDataType.Int8Array, expected: new Int8Array([-8, 0, 8]) },
      { name: "uint8", type: OmDataType.Uint8Array, expected: new Uint8Array([0, 8, 255]) },
      { name: "int16", type: OmDataType.Int16Array, expected: new Int16Array([-16, 0, 16]) },
      { name: "uint16", type: OmDataType.Uint16Array, expected: new Uint16Array([0, 16, 65535]) },
      { name: "int32", type: OmDataType.Int32Array, expected: new Int32Array([-32, 0, 32]) },
      { name: "uint32", type: OmDataType.Uint32Array, expected: new Uint32Array([0, 32, 4294967295]) },
      { name: "int64", type: OmDataType.Int64Array, expected: new BigInt64Array([-64n, 0n, 64n]) },
      {
        name: "uint64",
        type: OmDataType.Uint64Array,
        expected: new BigUint64Array([0n, 64n, 2n ** 64n - 1n]),
      },
      { name: "float32", type: OmDataType.FloatArray, expected: new Float32Array([-3.14, 0.0, 2.71]) },
      {
        name: "float64",
        type: OmDataType.DoubleArray,
        expected: new Float64Array([-3.1415926535, 0.0, 2.7182818284]),
      },
    ];

    const allTypesGroup = await reader.findByPath("all_types");
    expect(allTypesGroup).not.toBeNull();

    for (const { name, type, expected } of arrayTests) {
      const node = await allTypesGroup!.getChildByName(name);
      expect(node).not.toBeNull();

      const data = await node!.read({ type, ranges: [{ start: 0, end: expected.length }] });
      expect(data).toStrictEqual(expected);
    }
  });

  it("should read all supported scalar data types from all_types group", async () => {
    const scalarTests: {
      name: string;
      type: OmDataType;
      expected: number | bigint | string;
    }[] = [
      { name: "int8_scalar", type: OmDataType.Int8, expected: -8 },
      { name: "uint8_scalar", type: OmDataType.Uint8, expected: 255 },
      { name: "int16_scalar", type: OmDataType.Int16, expected: -16 },
      { name: "uint16_scalar", type: OmDataType.Uint16, expected: 65535 },
      { name: "int32_scalar", type: OmDataType.Int32, expected: -32 },
      { name: "uint32_scalar", type: OmDataType.Uint32, expected: 4294967295 },
      { name: "int64_scalar", type: OmDataType.Int64, expected: -64n },
      { name: "uint64_scalar", type: OmDataType.Uint64, expected: 18446744073709551615n }, // 2**64 - 1
      { name: "float32_scalar", type: OmDataType.Float, expected: -3.14 },
      { name: "float64_scalar", type: OmDataType.Double, expected: -3.1415926535 },
      { name: "string_scalar", type: OmDataType.String, expected: "blub" },
    ];

    const allTypesGroup = await reader.findByPath("all_types");
    expect(allTypesGroup).not.toBeNull();

    // Scalar checks
    for (const { name, type, expected } of scalarTests) {
      const node = await allTypesGroup!.getChildByName(name);
      expect(node).not.toBeNull();

      // For int64/uint64, expect BigInt, otherwise number
      const value = await node!.readScalar(type);
      if (typeof expected === "bigint") {
        expect(typeof value).toBe("bigint");
        expect(value).toBe(expected);
      } else if (typeof expected === "string") {
        expect(typeof value).toBe("string");
        expect(value).toBe(expected);
      } else {
        expect(typeof value).toBe("number");
        // For floats, allow a small epsilon due to float32/float64 precision
        if (!Number.isInteger(expected)) {
          expect(value).toBeCloseTo(expected, 6);
        } else {
          expect(value).toBe(expected);
        }
      }
    }
  });
});
