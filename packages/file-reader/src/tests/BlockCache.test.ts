import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LruBlockCache } from "../lib/BlockCache";
import { BrowserBlockCache } from "../lib/BrowserBlockCache";

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
const bytes = new Uint8Array([1, 2, 3]);

function controlledFetch() {
  const calls: {
    resolve: (data: Uint8Array) => void;
  }[] = [];
  // Keep downloads pending until the test releases a fetch slot.
  const fetch = vi.fn(
    () =>
      new Promise<Uint8Array>((resolve) => {
        calls.push({ resolve });
      })
  );
  return { calls, fetch };
}

describe("LruBlockCache", () => {
  it("rejects an already aborted caller when the block is cached", async () => {
    const cache = new LruBlockCache();
    const fetch = vi.fn(() => Promise.resolve(bytes));
    await cache.get(0n, fetch);
    const controller = new AbortController();
    const reason = new Error("caller left");
    controller.abort(reason);

    await expect(cache.get(0n, fetch, undefined, controller.signal)).rejects.toBe(reason);
    expect(fetch).toHaveBeenCalledTimes(1);
    await expect(cache.get(0n, fetch)).resolves.toEqual(bytes);
  });
});

describe("BrowserBlockCache", () => {
  let cache: BrowserBlockCache;

  beforeEach(() => {
    const stored = new Map<string, Response>();
    vi.stubGlobal("caches", {
      open: () =>
        Promise.resolve({
          match: (url: string) => Promise.resolve(stored.get(url)?.clone()),
          put: (url: string, response: Response) => {
            stored.set(url, response);
            return Promise.resolve();
          },
          keys: () => Promise.resolve([]),
        }),
      delete: () => {
        stored.clear();
        return Promise.resolve(true);
      },
    });
    cache = new BrowserBlockCache();
  });

  afterEach(async () => {
    await cache.clear();
    vi.unstubAllGlobals();
  });

  it("rejects an already aborted caller even when the block is in memory", async () => {
    const fetch = vi.fn(() => Promise.resolve(bytes));
    await cache.get("0", fetch);
    const controller = new AbortController();
    const reason = new Error("caller left");
    controller.abort(reason);

    await expect(cache.get("0", fetch, undefined, controller.signal)).rejects.toBe(reason);
    expect(fetch).toHaveBeenCalledTimes(1);
    await expect(cache.get("0", fetch)).resolves.toEqual(bytes);
  });

  it("skips a cancelled download waiting for a fetch slot", async () => {
    cache = new BrowserBlockCache({ maxConcurrentFetches: 1 });
    const { fetch, calls } = controlledFetch();
    const first = cache.get("0", fetch);
    const controller = new AbortController();
    const queued = cache.get("1", fetch, undefined, controller.signal);
    const rejected = expect(queued).rejects.toThrow();
    await flush();
    expect(calls).toHaveLength(1);
    controller.abort();
    await rejected;
    calls[0].resolve(bytes);
    await first;
    await flush();
    expect(calls).toHaveLength(1);
    const next = cache.get("2", fetch);
    await flush();
    expect(calls).toHaveLength(2);
    calls[1].resolve(bytes);
    await next;
  });
});
