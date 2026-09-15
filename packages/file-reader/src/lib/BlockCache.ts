import { InflightFetches } from "./InflightFetches";

export type KeyKind = "string" | "bigint";

/**
 * Fetches one block. Runs under the signal the cache hands it, not under the
 * caller's: the block may be shared with other callers, and the cache cancels
 * the fetch only once none of them is waiting for it anymore.
 */
export type BlockFetch = (signal: AbortSignal) => Promise<Uint8Array>;

/**
 * Interface for a block-level cache.
 * Implementations can be in-memory, persistent, or leverage browser APIs.
 */
export interface BlockCache<K = bigint> {
  keyKind: KeyKind;

  /** Returns the block size used by the cache. */
  blockSize(): number;

  /**
   * Retrieves a block from the cache or fetches it using the provided function.
   * `signal` is the caller's: aborting it rejects this call, and cancels the
   * fetch if no other caller is waiting on it.
   */
  get(key: K, fetchFn: BlockFetch, fileSize?: number, signal?: AbortSignal): Promise<Uint8Array>;

  /** Retrieves the total size of the cached file corresponding to key, if cached */
  size(key: K): Promise<number | undefined>;

  /** Optionally starts fetching a block into the cache without blocking. */
  prefetch(key: K, fetchFn: BlockFetch, fileSize?: number, signal?: AbortSignal): Promise<void>;

  /** Clears the cache contents. */
  clear(): void | Promise<void>;
}

export class LruBlockCache implements BlockCache {
  readonly keyKind = "bigint";
  private readonly _blockSize: number;
  private readonly maxBlocks: number;
  private readonly cache = new Map<bigint, Uint8Array>();
  private readonly inflight = new InflightFetches<bigint>();

  constructor(blockSize: number = 64 * 1024, maxBlocks = 256) {
    this._blockSize = blockSize;
    this.maxBlocks = maxBlocks;
  }

  blockSize(): number {
    return this._blockSize;
  }

  size(_key: bigint): Promise<number | undefined> {
    return Promise.resolve(undefined);
  }

  async get(key: bigint, fetchFn: BlockFetch, _fileSize?: number, signal?: AbortSignal): Promise<Uint8Array> {
    // Check cache
    const cached = this.cache.get(key);
    if (cached) {
      // Move to end (LRU refresh) - Map preserves insertion order
      this.cache.delete(key);
      this.cache.set(key, cached);
      return cached;
    }

    return this.inflight.get(
      key,
      async (fetchSignal) => {
        const data = await fetchFn(fetchSignal);
        // Evict if needed
        if (this.cache.size >= this.maxBlocks) {
          const oldest = this.cache.keys().next().value;
          if (oldest !== undefined) this.cache.delete(oldest);
        }
        this.cache.set(key, data);
        return data;
      },
      signal
    );
  }

  async prefetch(key: bigint, fetchFn: BlockFetch, fileSize?: number, signal?: AbortSignal): Promise<void> {
    await this.get(key, fetchFn, fileSize, signal).catch(() => {
      // ignore errors during prefetch
    });
  }

  clear(): void {
    this.cache.clear();
    this.inflight.clear();
  }
}
