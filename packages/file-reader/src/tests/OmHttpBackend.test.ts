import { describe, beforeAll, afterEach, it, expect, vi, type Mock, type MockInstance } from "vitest";
import fs from "fs";
import path from "path";
import { initWasm } from "../lib/wasm";
import { OmHttpBackend, OmHttpBackendPool } from "../lib/backends/OmHttpBackend";
import { LruBlockCache } from "../lib/BlockCache";
import { OmDataType, Range } from "../lib/types";

// Serve the local test file through a stubbed global fetch, so the full HTTP
// read path (HEAD + Range requests) runs without a network.
const testFilePath = path.join(__dirname, "../../test-data/read_test.om");
const fileBytes = new Uint8Array(fs.readFileSync(testFilePath));

function stubFetchWithTestFile(): Mock {
  const fetchMock = vi.fn((_input: RequestInfo, init?: RequestInit): Promise<Response> => {
    if (init?.method === "HEAD") {
      return Promise.resolve(
        new Response(null, {
          status: 200,
          headers: {
            "content-length": String(fileBytes.length),
            "last-modified": "Mon, 01 Jan 2024 00:00:00 GMT",
          },
        })
      );
    }
    const range = (init?.headers as Record<string, string> | undefined)?.Range ?? "";
    const match = /bytes=(\d+)-(\d+)/.exec(range);
    if (!match) {
      return Promise.resolve(new Response(fileBytes.slice().buffer, { status: 200 }));
    }
    const start = parseInt(match[1], 10);
    const end = parseInt(match[2], 10);
    return Promise.resolve(new Response(fileBytes.slice(start, end + 1).buffer, { status: 206 }));
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/** Number of HEAD requests issued for `url` (all HEADs when `url` is omitted). */
function headCount(fetchMock: Mock, url?: string): number {
  return fetchMock.mock.calls.filter(
    ([input, init]: [RequestInfo, RequestInit | undefined]) =>
      init?.method === "HEAD" && (url === undefined || input === url)
  ).length;
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

    let disposeSpy: MockInstance<() => void> | undefined;
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

    let disposeSpy: MockInstance<() => void> | undefined;
    await expect(
      backend.withReader(cache, (reader) => {
        disposeSpy = vi.spyOn(reader, "dispose");
        return Promise.reject(new Error("boom"));
      })
    ).rejects.toThrow("boom");

    expect(disposeSpy).toHaveBeenCalledOnce();
  });

  it("propagates open failures without invoking the callback", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(new Response(null, { status: 404 })))
    );
    const backend = new OmHttpBackend({ url: "https://example.com/missing.om", eTagValidation: false, retries: 1 });
    const cache = new LruBlockCache(1024, 16);

    const fn = vi.fn();
    await expect(backend.withReader(cache, fn)).rejects.toThrow("File not found");
    expect(fn).not.toHaveBeenCalled();
  });
});

describe("OmHttpBackendPool", () => {
  const READ_OPTIONS = {
    type: OmDataType.FloatArray,
    ranges: [
      { start: 0, end: 2 },
      { start: 0, end: 2 },
    ] as Range[],
  } as const;

  beforeAll(async () => {
    await initWasm();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reuses the memoized backend, so repeated reads issue only one HEAD request", async () => {
    const fetchMock = stubFetchWithTestFile();
    const pool = new OmHttpBackendPool({ backendOptions: { eTagValidation: false } });
    const cache = new LruBlockCache(1024, 16);
    const url = "https://example.com/read_test.om";

    const first = await pool.withReader(url, cache, (reader) => reader.read(READ_OPTIONS));
    const second = await pool.withReader(url, cache, (reader) => reader.read(READ_OPTIONS));

    expect(first).toStrictEqual(new Float32Array([0, 1, 5, 6]));
    expect(second).toStrictEqual(new Float32Array([0, 1, 5, 6]));
    expect(headCount(fetchMock)).toBe(1);
  });

  it("shares one HEAD request across concurrent reads of the same URL", async () => {
    const fetchMock = stubFetchWithTestFile();
    const pool = new OmHttpBackendPool({ backendOptions: { eTagValidation: false } });
    const cache = new LruBlockCache(1024, 16);
    const url = "https://example.com/read_test.om";

    const [first, second] = await Promise.all([
      pool.withReader(url, cache, (reader) => reader.read(READ_OPTIONS)),
      pool.withReader(url, cache, (reader) => reader.read(READ_OPTIONS)),
    ]);

    expect(first).toStrictEqual(new Float32Array([0, 1, 5, 6]));
    expect(second).toStrictEqual(new Float32Array([0, 1, 5, 6]));
    expect(headCount(fetchMock)).toBe(1);
  });

  it("retries metadata after a failed open instead of memoizing the failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(new Response(null, { status: 404 })))
    );
    const pool = new OmHttpBackendPool({ backendOptions: { eTagValidation: false, retries: 1 } });
    const cache = new LruBlockCache(1024, 16);
    const url = "https://example.com/read_test.om";

    await expect(pool.withReader(url, cache, (reader) => reader.read(READ_OPTIONS))).rejects.toThrow("File not found");

    // The file appears (e.g. a model run gets published): the same pooled
    // backend must retry the metadata request rather than stay poisoned.
    stubFetchWithTestFile();
    const output = await pool.withReader(url, cache, (reader) => reader.read(READ_OPTIONS));
    expect(output).toStrictEqual(new Float32Array([0, 1, 5, 6]));
  });

  it("evicts least recently used backends beyond maxBackends", async () => {
    const fetchMock = stubFetchWithTestFile();
    const pool = new OmHttpBackendPool({ backendOptions: { eTagValidation: false }, maxBackends: 1 });
    const cache = new LruBlockCache(1024, 16);
    const urlA = "https://example.com/a.om";
    const urlB = "https://example.com/b.om";

    await pool.withReader(urlA, cache, (reader) => reader.read(READ_OPTIONS));
    await pool.withReader(urlB, cache, (reader) => reader.read(READ_OPTIONS)); // evicts A
    await pool.withReader(urlA, cache, (reader) => reader.read(READ_OPTIONS)); // fresh backend for A

    expect(headCount(fetchMock, urlA)).toBe(2);
    expect(headCount(fetchMock, urlB)).toBe(1);
  });
});
