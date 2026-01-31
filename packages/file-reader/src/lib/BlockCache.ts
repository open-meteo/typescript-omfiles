export type BlockKey = bigint | string;

/**
 * Interface for a block-level cache.
 * Implementations can be in-memory, persistent, or leverage browser APIs.
 */
export interface BlockCache {
  /** Returns the block size used by the cache. */
  blockSize(): number;

  /** Retrieves a block from the cache or fetches it using the provided function. */
  get(key: BlockKey, fetchFn: () => Promise<Uint8Array>): Promise<Uint8Array>;

  /** Optionally starts fetching a block into the cache without blocking. */
  prefetch(key: BlockKey, fetchFn: () => Promise<Uint8Array>): void;

  /** Clears the cache contents. */
  clear(): void | Promise<void>;
}

export class BlockCacheCoordinator implements BlockCache {
  private readonly cache: SharedBlockCache;

  constructor(blockSize: number, maxBlocks: number) {
    this.cache = new SharedBlockCache(blockSize, maxBlocks);
  }

  blockSize(): number {
    return this.cache.blockSize;
  }

  maxBlocks(): number {
    return this.cache.maxBlocks;
  }

  async get(key: BlockKey, fetchFn: () => Promise<Uint8Array>): Promise<Uint8Array> {
    const cached = this.cache.get(key);
    if (cached) return cached;

    let inflight = this.cache.getInflight(key);
    if (!inflight) {
      inflight = fetchFn();
      this.cache.setInflight(key, inflight);
      inflight.then((data) => this.cache.set(key, data));
    }
    return inflight;
  }

  prefetch(key: BlockKey, fetchFn: () => Promise<Uint8Array>): void {
    if (!this.cache.get(key) && !this.cache.getInflight(key)) {
      const inflight = fetchFn();
      this.cache.setInflight(key, inflight);
      inflight.then((data) => this.cache.set(key, data));
    }
  }

  clear(): void {
    this.cache.clear();
  }
}

export class SharedBlockCache {
  readonly blockSize: number;
  readonly maxBlocks: number;
  private readonly cache = new Map<BlockKey, Uint8Array>();
  private readonly lru: BlockKey[] = [];
  private readonly inflight = new Map<BlockKey, Promise<Uint8Array>>();

  constructor(blockSize: number, maxBlocks: number) {
    this.blockSize = blockSize;
    this.maxBlocks = maxBlocks;
  }

  get(key: BlockKey): Uint8Array | undefined {
    const data = this.cache.get(key);
    if (data) {
      // Move to end of LRU
      const idx = this.lru.indexOf(key);
      if (idx !== -1) {
        this.lru.splice(idx, 1);
        this.lru.push(key);
      }
    }
    return data;
  }

  set(key: BlockKey, data: Uint8Array): void {
    if (this.cache.has(key)) {
      // Already exists, just update LRU position
      const idx = this.lru.indexOf(key);
      if (idx !== -1) {
        this.lru.splice(idx, 1);
      }
    } else if (this.cache.size >= this.maxBlocks) {
      // Evict oldest
      const oldest = this.lru.shift();
      if (oldest !== undefined) {
        this.cache.delete(oldest);
      }
    }

    this.cache.set(key, data);
    this.lru.push(key);
  }

  getInflight(key: BlockKey): Promise<Uint8Array> | undefined {
    return this.inflight.get(key);
  }

  setInflight(key: BlockKey, promise: Promise<Uint8Array>): void {
    this.inflight.set(key, promise);
    promise.finally(() => this.inflight.delete(key));
  }

  clear(): void {
    this.cache.clear();
    this.lru.length = 0;
    this.inflight.clear();
  }
}
