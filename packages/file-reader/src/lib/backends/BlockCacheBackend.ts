import { OmFileReaderBackend } from "./OmFileReaderBackend";
import pLimit from "p-limit";

/**
 * Minimal block cache for OmFileReaderBackend.
 * Uses simple in-memory Map; could be extended to support something like LRU eviction.
 */
export class BlockCache {
  readonly blockSize: number;
  private cache: Map<bigint, Uint8Array>;
  private inflight: Map<bigint, Promise<Uint8Array>>;

  constructor(blockSize = 64 * 1024) {
    this.blockSize = blockSize;
    this.cache = new Map();
    this.inflight = new Map();
  }

  get(key: bigint): Uint8Array | undefined {
    return this.cache.get(key);
  }

  getInflight(key: bigint): Promise<Uint8Array> | undefined {
    return this.inflight.get(key);
  }

  set(key: bigint, data: Uint8Array) {
    this.cache.set(key, data);
  }

  setInflight(key: bigint, promise: Promise<Uint8Array>) {
    this.inflight.set(key, promise);
    promise.finally(() => this.inflight.delete(key)); // Clean up when done
  }

  clear() {
    this.cache.clear();
    this.inflight.clear();
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

    const output = new Uint8Array(size);

    // Prepare tasks for blocks
    const blocks: Map<number, Uint8Array> = new Map();
    const tasks: (() => Promise<{blockIdx: number, block: Uint8Array}>)[] = [];

    for (let blockIdx = startBlock; blockIdx <= endBlock; blockIdx++) {
      const blockKey = this.cacheKey + BigInt(blockIdx);
      let block = this.cache.get(blockKey);

      if (block) {
        blocks.set(blockIdx, block);
      } else {
        // Check for inflight fetch
        let inflight = this.cache.getInflight(blockKey);
        if (!inflight) {
          const blockStart = blockIdx * blockSize;
          const blockEnd = Math.min(blockStart + blockSize, fileSize);
          inflight = this.backend.getBytes(blockStart, blockEnd - blockStart);
          this.cache.setInflight(blockKey, inflight);
        }
        tasks.push(async () => {
          const block = await inflight!;
          this.cache.set(blockKey, block);
          return {blockIdx, block};
        });
      }
    }

    const limit = pLimit(8); // concurrency of 8
    const fetchPromises = tasks.map(task => limit(task));
    const fetchedBlocks = await Promise.all(fetchPromises);
    for (const {blockIdx, block} of fetchedBlocks) {
      blocks.set(blockIdx, block);
    }

    // Copy relevant parts of each block to output
    for (let blockIdx = startBlock; blockIdx <= endBlock; blockIdx++) {
      const block = blocks.get(blockIdx)!;
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
