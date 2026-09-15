import { describe, expect, it } from "vitest";
import { BlockCacheBackend } from "../lib/backends/BlockCacheBackend";
import { OmFileReaderBackend } from "../lib/backends/OmFileReaderBackend";
import { LruBlockCache } from "../lib/BlockCache";

/** Let every queued microtask run before asserting. */
const flushMicrotasks = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/**
 * Backend whose reads stay pending until the test settles them, exposing the
 * signal each one was issued under.
 */
class FakeBackend implements OmFileReaderBackend {
  readonly calls: {
    offset: number;
    size: number;
    signal: AbortSignal | undefined;
    resolve: (data: Uint8Array) => void;
    reject: (error: unknown) => void;
  }[] = [];

  constructor(private readonly fileSize: number) {}

  count(): Promise<number> {
    return Promise.resolve(this.fileSize);
  }

  getBytes(offset: number, size: number, signal?: AbortSignal): Promise<Uint8Array> {
    return new Promise<Uint8Array>((resolve, reject) => {
      this.calls.push({ offset, size, signal, resolve, reject });
    });
  }

  close(): Promise<void> {
    return Promise.resolve();
  }
}

const makeBackend = () => {
  const backend = new FakeBackend(64);
  const cache = new LruBlockCache(16, 8);
  return { backend, cached: BlockCacheBackend.withBigIntKeys(backend, cache, 0n) };
};

describe("BlockCacheBackend – shared block fetches", () => {
  it("deduplicates concurrent reads of the same block", async () => {
    const { backend, cached } = makeBackend();

    const first = cached.getBytes(0, 8);
    const second = cached.getBytes(0, 8);
    await flushMicrotasks();

    expect(backend.calls).toHaveLength(1);

    backend.calls[0].resolve(new Uint8Array(16).fill(7));
    await expect(first).resolves.toEqual(new Uint8Array(8).fill(7));
    await expect(second).resolves.toEqual(new Uint8Array(8).fill(7));
  });

  it("keeps a shared fetch alive while another reader still waits on it", async () => {
    const { backend, cached } = makeBackend();

    const abandoned = new AbortController();
    const wanted = new AbortController();

    const abandonedRead = cached.getBytes(0, 8, abandoned.signal);
    const wantedRead = cached.getBytes(0, 8, wanted.signal);
    await flushMicrotasks();
    expect(backend.calls).toHaveLength(1);

    // The reader that aborted is done at once, the fetch is not
    abandoned.abort();
    await expect(abandonedRead).rejects.toThrow();
    expect(backend.calls).toHaveLength(1);
    expect(backend.calls[0].signal?.aborted).toBe(false);

    backend.calls[0].resolve(new Uint8Array(16).fill(3));
    await expect(wantedRead).resolves.toEqual(new Uint8Array(8).fill(3));
  });

  it("cancels the fetch once the last reader waiting on it aborts", async () => {
    const { backend, cached } = makeBackend();

    const first = new AbortController();
    const second = new AbortController();

    const firstRead = cached.getBytes(0, 8, first.signal);
    const secondRead = cached.getBytes(0, 8, second.signal);
    await flushMicrotasks();

    first.abort();
    await expect(firstRead).rejects.toThrow();
    expect(backend.calls[0].signal?.aborted).toBe(false);

    second.abort();
    await expect(secondRead).rejects.toThrow();
    expect(backend.calls[0].signal?.aborted).toBe(true);
    expect(backend.calls).toHaveLength(1);
  });

  it("starts a fresh fetch for a reader arriving after the shared one was cancelled", async () => {
    const { backend, cached } = makeBackend();

    const abandoned = new AbortController();
    const abandonedRead = cached.getBytes(0, 8, abandoned.signal);
    await flushMicrotasks();

    abandoned.abort();
    await expect(abandonedRead).rejects.toThrow();
    expect(backend.calls[0].signal?.aborted).toBe(true);

    // The cancelled fetch has not rejected yet; a reader arriving now asked
    // for data, not for an abort
    const lateRead = cached.getBytes(0, 8);
    await flushMicrotasks();
    expect(backend.calls).toHaveLength(2);
    expect(backend.calls[1].signal?.aborted).toBe(false);

    backend.calls[0].reject(new DOMException("Aborted", "AbortError"));
    backend.calls[1].resolve(new Uint8Array(16).fill(5));
    await expect(lateRead).resolves.toEqual(new Uint8Array(8).fill(5));
  });

  it("rejects at once when the caller's own signal is already aborted", async () => {
    const { backend, cached } = makeBackend();

    const controller = new AbortController();
    controller.abort();

    await expect(cached.getBytes(0, 8, controller.signal)).rejects.toThrow();
    expect(backend.calls).toHaveLength(0);
  });
});
