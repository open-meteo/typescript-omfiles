import { BlockCache, BlockKey } from "../BlockCache";
import { OmFileReaderBackend } from "./OmFileReaderBackend";

/**
 * Wraps a backend for caching blocks of data.
 */
export class BlockCacheBackend implements OmFileReaderBackend {
  private readonly backend: OmFileReaderBackend;
  private readonly cache: BlockCache;
  private readonly baseKey: BlockKey;

  constructor(backend: OmFileReaderBackend, cache: BlockCache, baseKey: BlockKey) {
    this.backend = backend;
    this.cache = cache;
    this.baseKey = baseKey;
  }

  /**
   * Generates a unique key for a specific block.
   */
  private getBlockKey(blockIdx: number): BlockKey {
    if (typeof this.baseKey === "bigint") {
      return this.baseKey + BigInt(blockIdx);
    }
    // Use query parameters instead of fragments, as Cache API ignores fragments.
    const separator = this.baseKey.includes("?") ? "&" : "?";
    return `${this.baseKey}${separator}block=${blockIdx}`;
  }

  async count(): Promise<number> {
    return this.backend.count();
  }

  async prefetchData(offset: number, count: number): Promise<void> {
    const blockSize = this.cache.blockSize();
    const fileSize = await this.count();
    const startBlock = Math.floor(offset / blockSize);
    const endBlock = Math.floor((offset + count - 1) / blockSize);

    for (let blockIdx = startBlock; blockIdx <= endBlock; blockIdx++) {
      const blockStart = blockIdx * blockSize;
      const blockEnd = Math.min(blockStart + blockSize, fileSize);
      this.cache.prefetch(this.getBlockKey(blockIdx), () =>
        this.backend.getBytes(blockStart, blockEnd - blockStart)
      );
    }
  }

  async getBytes(offset: number, size: number): Promise<Uint8Array> {
    const blockSize = this.cache.blockSize();
    const fileSize = await this.count();
    const startBlock = Math.floor(offset / blockSize);
    const endBlock = Math.floor((offset + size - 1) / blockSize);

    const output = new Uint8Array(size);

    // Fetch all blocks in parallel and write directly to output
    const promises: Promise<void>[] = [];

    for (let blockIdx = startBlock; blockIdx <= endBlock; blockIdx++) {
      const blockStart = blockIdx * blockSize;
      const blockEnd = Math.min(blockStart + blockSize, fileSize);

      const promise = this.cache
        .get(this.getBlockKey(blockIdx), () => this.backend.getBytes(blockStart, blockEnd - blockStart))
        .then((block) => {
          const blockOffset = Math.max(offset, blockStart) - blockStart;
          const outOffset = Math.max(blockStart, offset) - offset;
          const copyLen = Math.min(blockSize - blockOffset, size - outOffset);
          output.set(block.subarray(blockOffset, blockOffset + copyLen), outOffset);
        });

      promises.push(promise);
    }

    await Promise.all(promises);
    return output;
  }

  async close(): Promise<void> {
    await this.backend.close();
  }
}
