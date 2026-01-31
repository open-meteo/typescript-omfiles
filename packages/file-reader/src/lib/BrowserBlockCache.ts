import { BlockCache, BlockKey } from "./BlockCache";

/**
 * A BlockCache implementation that uses the browser's Cache API.
 * Allows blocks to persist across sessions and be accessible to Service Workers.
 *
 * Includes a fast in-memory layer that keeps recently accessed blocks
 * to avoid repeated async Cache API lookups during decoding operations.
 */
export class BrowserBlockCache implements BlockCache {
  private readonly _blockSize: number;
  private readonly cacheName: string;
  private readonly inflight = new Map<string, Promise<Uint8Array>>();

  /** In-memory cache for fast repeated access */
  private readonly memCache = new Map<string, Uint8Array>();
  /** Timers for automatic eviction */
  private readonly evictionTimers = new Map<string, ReturnType<typeof setTimeout>>();
  /** Time in ms before an unused entry is evicted from memory */
  private readonly memCacheTtlMs: number;

  constructor(options: {
    blockSize?: number;
    cacheName?: string;
    /** Time in ms before an unused block is evicted from in-memory cache. Default: 2000 */
    memCacheTtlMs?: number;
  } = {}) {
    this._blockSize = options.blockSize ?? 64 * 1024;
    this.cacheName = options.cacheName ?? "om-file-cache";
    this.memCacheTtlMs = options.memCacheTtlMs ?? 2000;
  }

  blockSize(): number {
    return this._blockSize;
  }

  /**
   * Resolves a BlockKey into a URL string for the Cache API.
   */
  private resolveUrl(key: BlockKey): string {
    if (typeof key === "string") {
      if (key.startsWith("http://") || key.startsWith("https://")) {
        return key;
      }
      return `https://omfiles.local/cache/${encodeURIComponent(key)}`;
    }
    return `https://omfiles.local/cache/${key}`;
  }

  /**
   * Refreshes the eviction timer for a key, keeping it in memory longer if accessed again.
   */
  private refreshEvictionTimer(url: string): void {
    const existing = this.evictionTimers.get(url);
    if (existing) {
      clearTimeout(existing);
    }

    const timer = setTimeout(() => {
      this.memCache.delete(url);
      this.evictionTimers.delete(url);
    }, this.memCacheTtlMs);

    this.evictionTimers.set(url, timer);
  }

  /**
   * Stores data in the in-memory cache with automatic eviction.
   */
  private setMemCache(url: string, data: Uint8Array): void {
    this.memCache.set(url, data);
    this.refreshEvictionTimer(url);
  }

  async get(key: BlockKey, fetchFn: () => Promise<Uint8Array>): Promise<Uint8Array> {
    const url = this.resolveUrl(key);

    // Fast path: check in-memory cache first
    const memCached = this.memCache.get(url);
    if (memCached) {
      this.refreshEvictionTimer(url);
      return memCached;
    }

    // Deduplicate concurrent requests for the same block
    const existing = this.inflight.get(url);
    if (existing) {
      return existing;
    }

    const promise = (async () => {
      // Check browser Cache API
      if (typeof caches !== "undefined") {
        const cache = await caches.open(this.cacheName);
        const cached = await cache.match(url);

        if (cached) {
          const data = new Uint8Array(await cached.arrayBuffer());
          this.setMemCache(url, data);
          return data;
        }
      }

      // Fetch from source
      const data = await fetchFn();
      this.setMemCache(url, data);

      // Store in browser Cache API (fire-and-forget)
      if (typeof caches !== "undefined") {
        const buffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
        const response = new Response(buffer, {
          headers: {
            "Content-Type": "application/octet-stream",
            "Content-Length": data.length.toString(),
            "X-Om-Block-Key": key.toString(),
          },
        });
        caches.open(this.cacheName).then((cache) => cache.put(url, response).catch(() => {}));
      }

      return data;
    })();

    this.inflight.set(url, promise);

    try {
      return await promise;
    } finally {
      this.inflight.delete(url);
    }
  }

  prefetch(key: BlockKey, fetchFn: () => Promise<Uint8Array>): void {
    this.get(key, fetchFn).catch(() => {});
  }

  async clear(): Promise<void> {
    // Clear all eviction timers
    for (const timer of this.evictionTimers.values()) {
      clearTimeout(timer);
    }
    this.evictionTimers.clear();
    this.memCache.clear();
    this.inflight.clear();

    if (typeof caches !== "undefined") {
      await caches.delete(this.cacheName);
    }
  }
}
