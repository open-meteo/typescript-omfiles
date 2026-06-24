import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The wasm module is loaded lazily (dynamic import in wasm.ts) and is never exercised
// by these tests (HEAD/count only). Stub it so Vite does not try to resolve the package
// (no dist in the test environment).
vi.mock("@openmeteo/file-format-wasm", () => ({ default: vi.fn() }));

import { OmHttpBackend } from "../lib/backends/OmHttpBackend";

// Synthetic HEAD response: content-length + validators.
const headResponse = () =>
  new Response(null, {
    status: 200,
    headers: {
      "content-length": "123456",
      "last-modified": "Mon, 01 Jan 2026 00:00:00 GMT",
      etag: '"abc123"',
    },
  });

describe("OmHttpBackend metadata cache", () => {
  beforeEach(() => {
    // Static cache shared across instances: reset it before each test.
    OmHttpBackend.clearMetadataCache();
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(headResponse()))
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("issues a single HEAD for two backends on the same URL", async () => {
    const url = "https://example.test/data_spatial/x/2026/06/10/0000Z/2026-06-10T0000.om";

    const a = new OmHttpBackend({ url });
    expect(await a.count()).toBe(123456);

    const b = new OmHttpBackend({ url });
    expect(await b.count()).toBe(123456);

    const headCalls = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.filter(
      ([, init]) => (init as RequestInit | undefined)?.method === "HEAD"
    );
    expect(headCalls).toHaveLength(1);
  });

  it("issues a new HEAD for a different URL", async () => {
    await new OmHttpBackend({ url: "https://example.test/a.om" }).count();
    await new OmHttpBackend({ url: "https://example.test/b.om" }).count();

    const headCalls = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.filter(
      ([, init]) => (init as RequestInit | undefined)?.method === "HEAD"
    );
    expect(headCalls).toHaveLength(2);
  });
});
