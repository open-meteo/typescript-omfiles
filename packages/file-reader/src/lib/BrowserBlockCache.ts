import { BlockCache, BlockKey } from "./BlockCache";

/** Summary statistics for the cache */
export interface CacheStats {
  /** Total entries in persistent cache */
  persistentEntries: number;
  /** Total bytes in persistent cache */
  persistentBytes: number;
  /** Entries currently in memory */
  memoryEntries: number;
  /** Bytes currently in memory */
  memoryBytes: number;
  /** Currently pending fetches */
  inflightCount: number;
  /** Maximum allowed bytes */
  maxBytes: number;
  /** Block size */
  blockSize: number;
}

/** Information about a cached entry */
export interface CacheEntryInfo {
  url: string;
  size: number;
  createdAt?: number;
}

export interface BrowserBlockCacheOptions {
  blockSize?: number;
  cacheName?: string;
  /** Time in ms before an unused block is evicted from in-memory cache. Default: 1000 */
  memCacheTtlMs?: number;
  /** Maximum total size in bytes for persistent cache. Default: 1GB */
  maxBytes?: number;
  /** When evicting, remove this fraction of maxBytes to avoid frequent evictions. Default: 0.1 */
  evictionFraction?: number;
}

/**
 * A BlockCache implementation that uses the browser's Cache API.
 *
 * Features:
 * - Fast in-memory layer for recently accessed blocks
 * - Size-based eviction with configurable limits
 * - Metadata stored in response headers (no separate metadata cache)
 */
export class BrowserBlockCache implements BlockCache {
  private readonly _blockSize: number;
  private readonly cacheName: string;
  private readonly inflight = new Map<string, Promise<Uint8Array>>();

  /** In-memory cache for fast repeated access */
  private readonly memCache = new Map<string, Uint8Array>();
  /** Timers for automatic memory eviction */
  private readonly evictionTimers = new Map<string, ReturnType<typeof setTimeout>>();
  /** Time in ms before an unused entry is evicted from memory */
  private readonly memCacheTtlMs: number;

  /** Maximum total bytes for persistent storage */
  private readonly maxBytes: number;
  /** Fraction of cache to clear during eviction */
  private readonly evictionFraction: number;

  /** Lock to prevent concurrent evictions */
  private evictionInProgress: Promise<void> | null = null;

  /** Cached reference to the opened Cache object */
  private cachePromise: Promise<Cache> | null = null;

  constructor(options: BrowserBlockCacheOptions = {}) {
    this._blockSize = options.blockSize ?? 64 * 1024;
    this.cacheName = options.cacheName ?? "om-file-cache";
    this.memCacheTtlMs = options.memCacheTtlMs ?? 1000;
    this.maxBytes = options.maxBytes ?? 1024 * 1024 * 1024; // 1GB default
    this.evictionFraction = options.evictionFraction ?? 0.1;
  }

  blockSize(): number {
    return this._blockSize;
  }

  /**
   * Resolves a BlockKey into a URL string for the Cache API.
   */
  private resolveUrl(key: BlockKey): string {
    return `https://omfiles.local/cache/${key}`;
  }

  /** Opens the cache once and reuses the reference */
  private async getCache(): Promise<Cache | null> {
    if (typeof caches === "undefined") return null;

    if (!this.cachePromise) {
      this.cachePromise = caches.open(this.cacheName);
    }
    return this.cachePromise;
  }

  /**
   * Scans the Cache API to get current total size and entry list.
   */
  private async scanCache(): Promise<{ totalBytes: number; entries: CacheEntryInfo[] }> {
    const cache = await this.getCache();
    if (!cache) {
      return { totalBytes: 0, entries: [] };
    }

    const keys = await cache.keys();
    const entries: CacheEntryInfo[] = [];
    let totalBytes = 0;

    for (const request of keys) {
      const response = await cache.match(request);
      if (response) {
        const size = parseInt(response.headers.get("Content-Length") || "0", 10);
        const createdAtStr = response.headers.get("X-Om-Created-At");
        const createdAt = createdAtStr ? parseInt(createdAtStr, 10) : undefined;

        entries.push({
          url: request.url,
          size,
          createdAt,
        });
        totalBytes += size;
      }
    }

    return { totalBytes, entries };
  }

  /**
   * Evicts oldest entries until we're under the size limit.
   * Uses createdAt timestamp from headers for ordering.
   */
  private async evictIfNeeded(): Promise<void> {
    const cache = await caches.open(this.cacheName);
    if (!cache) return;

    // Prevent concurrent evictions
    if (this.evictionInProgress) {
      await this.evictionInProgress;
      return;
    }

    this.evictionInProgress = (async () => {
      const { totalBytes, entries } = await this.scanCache();

      if (totalBytes <= this.maxBytes) return;

      const targetBytes = this.maxBytes * (1 - this.evictionFraction);
      let currentBytes = totalBytes;

      // Sort by createdAt (oldest first), entries without timestamp go first
      entries.sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));

      for (const entry of entries) {
        if (currentBytes <= targetBytes) break;

        await cache.delete(entry.url).catch(() => {});
        currentBytes -= entry.size;

        // Also remove from memory cache
        this.memCache.delete(entry.url);
        const timer = this.evictionTimers.get(entry.url);
        if (timer) {
          clearTimeout(timer);
          this.evictionTimers.delete(entry.url);
        }
      }
    })();

    try {
      await this.evictionInProgress;
    } finally {
      this.evictionInProgress = null;
    }
  }

  /**
   * Refreshes the memory eviction timer for a URL.
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
      const cache = await this.getCache();

      // Check browser Cache API
      if (cache) {
        const cached = await cache.match(url);

        if (cached) {
          const buffer = await cached.arrayBuffer();
          const data = new Uint8Array(buffer);
          this.setMemCache(url, data);
          return data;
        }
      }

      // Fetch from source
      const data = await fetchFn();
      this.setMemCache(url, data);

      // Store in browser Cache API with metadata in headers
      if (cache) {
        const buffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;

        const response = new Response(buffer, {
          status: 200,
          statusText: "OK",
          headers: {
            "Content-Type": "application/octet-stream",
            "Content-Length": data.length.toString(),
            "X-Om-Block-Key": key.toString(),
            "X-Om-Created-At": Date.now().toString(),
          },
        });

        cache
          .put(url, response)
          .then(() => this.evictIfNeeded())
          .catch(() => {});
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

  async prefetch(key: BlockKey, fetchFn: () => Promise<Uint8Array>): Promise<void> {
    await this.get(key, fetchFn).catch(() => {});
  }

  /**
   * Gets current cache statistics by scanning the Cache API.
   */
  async getStats(): Promise<CacheStats> {
    const { totalBytes, entries } = await this.scanCache();

    let memoryBytes = 0;
    for (const data of this.memCache.values()) {
      memoryBytes += data.length;
    }

    return {
      persistentEntries: entries.length,
      persistentBytes: totalBytes,
      memoryEntries: this.memCache.size,
      memoryBytes,
      inflightCount: this.inflight.size,
      maxBytes: this.maxBytes,
      blockSize: this._blockSize,
    };
  }

  async clear(): Promise<void> {
    // Clear all memory eviction timers
    for (const timer of this.evictionTimers.values()) {
      clearTimeout(timer);
    }
    this.evictionTimers.clear();
    this.memCache.clear();
    this.inflight.clear();
    this.cachePromise = null;

    if (typeof caches !== "undefined") {
      await caches.delete(this.cacheName);
    }
  }
}
