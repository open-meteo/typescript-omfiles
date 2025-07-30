type BlockKey = bigint;

export class BlockCacheCoordinator {
  private cache: SharedBlockCache;

  // constructor(cache: SharedBlockCache) {
  //   this.cache = cache;
  // }

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
      inflight.then(data => this.cache.set(key, data));
    }
    return inflight;
  }

  prefetch(key: BlockKey, fetchFn: () => Promise<Uint8Array>) {
    if (!this.cache.get(key) && !this.cache.getInflight(key)) {
      const inflight = fetchFn();
      this.cache.setInflight(key, inflight);
      inflight.then(data => this.cache.set(key, data));
    }
  }

  clear() {
    this.cache.clear();
  }
}

interface BlockEntry {
  data: Uint8Array;
  timestamp: number;
}

export class SharedBlockCache {
  blockSize: number;
  maxBlocks: number;
  private cache: Map<BlockKey, BlockEntry>;
  private lru: BlockKey[];
  private inflight: Map<BlockKey, Promise<Uint8Array>>;

  constructor(blockSize: number, maxBlocks: number) {
    this.blockSize = blockSize;
    this.maxBlocks = maxBlocks;
    this.cache = new Map();
    this.lru = [];
    this.inflight = new Map();
  }

  get(key: BlockKey): Uint8Array | undefined {
    const entry = this.cache.get(key);
    if (entry) {
      entry.timestamp = Date.now();
      // Move to end of LRU
      this.lru = this.lru.filter(k => k !== key);
      this.lru.push(key);
      return entry.data;
    }
    return undefined;
  }

  set(key: BlockKey, data: Uint8Array) {
    if (this.cache.size >= this.maxBlocks) {
      // Evict LRU
      const oldestKey = this.lru.shift();
      if (oldestKey !== undefined) this.cache.delete(oldestKey);
    }
    this.cache.set(key, { data, timestamp: Date.now() });
    this.lru.push(key);
  }

  getInflight(key: BlockKey): Promise<Uint8Array> | undefined {
    return this.inflight.get(key);
  }

  setInflight(key: BlockKey, promise: Promise<Uint8Array>) {
    this.inflight.set(key, promise);
    promise.finally(() => this.inflight.delete(key));
  }

  clear() {
    this.cache.clear();
    this.lru = [];
    this.inflight.clear();
  }
}
