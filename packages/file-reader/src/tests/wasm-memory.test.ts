import { beforeAll, describe, expect, it } from "vitest";
import path from "node:path";
import { initWasm, WasmModule } from "../lib/wasm";
import { OmFileReader } from "../lib/OmFileReader";
import { FileBackendNode } from "../lib/backends/FileBackendNode";
import { OmDataType } from "../lib/types";

const ranges = [
  { start: 0, end: 5 },
  { start: 0, end: 5 },
];
const expected = Float32Array.from({ length: 25 }, (_, i) => i);
const fixture = path.join(__dirname, "../../test-data/read_test.om");

// Inject failure at each allocation in a real operation, tracking owned pointers.
function trackAllocations(wasm: WasmModule, failAt = Infinity, throws = false) {
  const live = new Set<number>();
  let calls = 0;
  const tracked = Object.create(wasm) as WasmModule;
  tracked._malloc = (size) => {
    if (++calls === failAt) {
      if (throws) throw new Error("Injected allocation failure");
      return 0;
    }
    const ptr = wasm._malloc(size);
    if (ptr) live.add(ptr);
    return ptr;
  };
  tracked._free = (ptr) => {
    if (ptr) {
      expect(live.delete(ptr), `free of unowned pointer ${ptr}`).toBe(true);
      wasm._free(ptr);
    }
  };
  return { wasm: tracked, live, calls: () => calls };
}

describe("WASM memory", () => {
  let wasm: WasmModule;
  beforeAll(async () => {
    wasm = await initWasm();
  });

  it("starts at 16 MiB and decodes correctly when an allocation grows memory", async () => {
    expect(wasm.HEAPU8.byteLength).toBe(16 * 1024 * 1024);
    const backend = new FileBackendNode(fixture);
    const reader = new OmFileReader(backend, wasm);
    try {
      await reader.initialize();
      const oldHeap = wasm.HEAPU8;
      // The decoder allocates a WASM output buffer matching this JS buffer.
      const output = new Float32Array(oldHeap.byteLength / 4);
      await reader.readInto({ type: OmDataType.FloatArray, ranges, output, prefetch: false });
      expect(wasm.HEAPU8.buffer).not.toBe(oldHeap.buffer);
      expect(wasm.HEAPU8.byteLength).toBeGreaterThan(16 * 1024 * 1024);
      expect(output.slice(0, 25)).toEqual(expected);
      expect(reader.getDimensions()).toEqual([5, 5]);
      expect(reader.getName()).toBe("data");
      expect(await reader.read({ type: OmDataType.FloatArray, ranges })).toEqual(expected);
    } finally {
      reader.dispose();
      await backend.close();
    }
  });

  const operations = [
    {
      name: "decoding",
      file: fixture,
      run: async (reader: OmFileReader) => {
        reader.getName();
        await reader.getChild(0);
        await reader.read({ type: OmDataType.FloatArray, ranges, prefetch: false });
      },
    },
    {
      name: "child navigation and scalar reads",
      file: path.join(__dirname, "../../test-data/hierarchical.om"),
      run: async (reader: OmFileReader) => {
        const group = await reader.getChildByName("all_types");
        expect(group).not.toBeNull();
        try {
          const scalar = await group!.getChildByName("int8_scalar");
          expect(scalar).not.toBeNull();
          try {
            expect(scalar!.readScalar(OmDataType.Int8)).toBe(-8);
          } finally {
            scalar?.dispose();
          }
        } finally {
          group?.dispose();
        }
      },
    },
  ];

  for (const operation of operations) {
    for (const throws of [false, true]) {
      it(`cleans up ${operation.name} when malloc ${throws ? "throws" : "returns zero"}`, async () => {
        const run = async (failAt = Infinity) => {
          const tracked = trackAllocations(wasm, failAt, throws);
          const backend = new FileBackendNode(operation.file);
          const reader = new OmFileReader(backend, tracked.wasm);
          const execute = async () => {
            await reader.initialize();
            await operation.run(reader);
          };
          try {
            if (failAt === Infinity) await execute();
            else await expect(execute()).rejects.toThrow(throws ? "Injected allocation failure" : "Failed to allocate");
          } finally {
            reader.dispose();
            await backend.close();
            expect(tracked.live.size).toBe(0);
          }
          return tracked.calls();
        };
        const count = await run();
        expect(count).toBeGreaterThan(10);
        for (let failAt = 1; failAt <= count; failAt++) await run(failAt);
        // Failures must leave the shared WASM module usable.
        await run();
      });
    }
  }
});
