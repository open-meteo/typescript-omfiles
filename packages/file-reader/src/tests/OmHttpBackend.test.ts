import { describe, beforeAll, afterEach, it, expect, vi } from "vitest";
import fs from "fs";
import path from "path";
import { initWasm } from "../lib/wasm";
import { OmHttpBackend } from "../lib/backends/OmHttpBackend";
import { LruBlockCache } from "../lib/BlockCache";
import { OmDataType, Range } from "../lib/types";

// Serve the local test file through a stubbed global fetch, so the full HTTP
// read path (HEAD + Range requests) runs without a network.
const testFilePath = path.join(__dirname, "../../test-data/read_test.om");
const fileBytes = new Uint8Array(fs.readFileSync(testFilePath));

function stubFetchWithTestFile(): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_input: RequestInfo, init?: RequestInit) => {
      if (init?.method === "HEAD") {
        return new Response(null, {
          status: 200,
          headers: {
            "content-length": String(fileBytes.length),
            "last-modified": "Mon, 01 Jan 2024 00:00:00 GMT",
          },
        });
      }
      const range = (init?.headers as Record<string, string> | undefined)?.["Range"] ?? "";
      const match = /bytes=(\d+)-(\d+)/.exec(range);
      if (!match) {
        return new Response(fileBytes.slice().buffer, { status: 200 });
      }
      const start = parseInt(match[1], 10);
      const end = parseInt(match[2], 10);
      return new Response(fileBytes.slice(start, end + 1).buffer, { status: 206 });
    })
  );
}

describe("OmHttpBackend.withReader", () => {
  beforeAll(async () => {
    await initWasm();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reads data through a scoped reader and disposes it afterwards", async () => {
    stubFetchWithTestFile();
    const backend = new OmHttpBackend({ url: "https://example.com/read_test.om", eTagValidation: false });
    const cache = new LruBlockCache(1024, 16);

    const dimReadRange: Range[] = [
      { start: 0, end: 2 },
      { start: 0, end: 2 },
    ];

    let disposeSpy: ReturnType<typeof vi.spyOn> | undefined;
    const output = await backend.withReader(cache, (reader) => {
      disposeSpy = vi.spyOn(reader, "dispose");
      return reader.read({ type: OmDataType.FloatArray, ranges: dimReadRange });
    });

    expect(output).toStrictEqual(new Float32Array([0, 1, 5, 6]));
    expect(disposeSpy).toHaveBeenCalledOnce();
  });

  it("disposes the reader even when the callback throws", async () => {
    stubFetchWithTestFile();
    const backend = new OmHttpBackend({ url: "https://example.com/read_test.om", eTagValidation: false });
    const cache = new LruBlockCache(1024, 16);

    let disposeSpy: ReturnType<typeof vi.spyOn> | undefined;
    await expect(
      backend.withReader(cache, async (reader) => {
        disposeSpy = vi.spyOn(reader, "dispose");
        throw new Error("boom");
      })
    ).rejects.toThrow("boom");

    expect(disposeSpy).toHaveBeenCalledOnce();
  });

  it("propagates open failures without invoking the callback", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 404 }))
    );
    const backend = new OmHttpBackend({ url: "https://example.com/missing.om", eTagValidation: false, retries: 1 });
    const cache = new LruBlockCache(1024, 16);

    const fn = vi.fn();
    await expect(backend.withReader(cache, fn)).rejects.toThrow("File not found");
    expect(fn).not.toHaveBeenCalled();
  });
});
