import { OmFileReaderBackend } from "./OmFileReaderBackend";

/**
 * Minimal block cache for OmFileReaderBackend.
 * Uses simple in-memory Map; could be extended to support something like LRU eviction.
 */
export class BlockCache {
  readonly blockSize: number;
  private cache: Map<bigint, Uint8Array>;

  constructor(blockSize = 64 * 1024) {
    this.blockSize = blockSize;
    this.cache = new Map();
  }

  get(key: bigint): Uint8Array | undefined {
    return this.cache.get(key);
  }

  set(key: bigint, data: Uint8Array) {
    this.cache.set(key, data);
  }

  clear() {
    this.cache.clear();
  }
}

/**
 * Wraps a backend and caches blocks of data.
 */
export class BlockCacheBackend implements OmFileReaderBackend {
  private backend: OmFileReaderBackend;
  private cache: BlockCache;
  private cacheKey: bigint;

  constructor(backend: OmFileReaderBackend, cacheKey: bigint, blockSize = 64 * 1024) {
    this.backend = backend;
    this.cacheKey = cacheKey;
    this.cache = new BlockCache(blockSize);
  }

  async count(): Promise<number> {
    return this.backend.count();
  }

  async getBytes(offset: number, size: number): Promise<Uint8Array> {
    const blockSize = this.cache.blockSize;
    const fileSize = await this.count();
    const startBlock = Math.floor(offset / blockSize);
    const endBlock = Math.floor((offset + size - 1) / blockSize);

    // Allocate output buffer
    const output = new Uint8Array(size);

    for (let blockIdx = startBlock; blockIdx <= endBlock; blockIdx++) {
      const blockKey = this.cacheKey + BigInt(blockIdx);
      let block = this.cache.get(blockKey);

      // If not cached, fetch and cache
      if (!block) {
        const blockStart = blockIdx * blockSize;
        const blockEnd = Math.min(blockStart + blockSize, fileSize);
        block = await this.backend.getBytes(blockStart, blockEnd - blockStart);
        this.cache.set(blockKey, block);
      }

      // Copy relevant part of block to output
      const blockOffset = Math.max(offset, blockIdx * blockSize) - blockIdx * blockSize;
      const outOffset = Math.max(blockIdx * blockSize, offset) - offset;
      const copyLen = Math.min(blockSize - blockOffset, size - outOffset);

      output.set(block.subarray(blockOffset, blockOffset + copyLen), outOffset);
    }

    return output;
  }

  async close(): Promise<void> {
    this.cache.clear();
    await this.backend.close();
  }
}
