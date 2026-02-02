import { BlockCache, BlockKey } from "../BlockCache";
import { OmFileReaderBackend } from "./OmFileReaderBackend";

/**
 * Wraps a backend for caching blocks of data.
 */
export class BlockCacheBackend implements OmFileReaderBackend {
  private readonly backend: OmFileReaderBackend;
  private readonly cache: BlockCache;
  private readonly baseKey: BlockKey;
  private cachedCount: number | null = null;

  constructor(backend: OmFileReaderBackend, cache: BlockCache, baseKey: BlockKey) {
    this.backend = backend;
    this.cache = cache;
    this.baseKey = baseKey;
  }

  /**
   * Generates a unique key for a specific block.
   */
  private getBlockKey(blockIdx: number): BlockKey {
    return this.baseKey + BigInt(blockIdx);
  }

  async count(): Promise<number> {
    // Cache the count to avoid repeated async calls
    return (this.cachedCount ??= await this.backend.count());
  }

  async getBytes(offset: number, size: number): Promise<Uint8Array> {
    const blockSize = this.cache.blockSize();
    const fileSize = await this.count();
    const startBlock = Math.floor(offset / blockSize);
    const endBlock = Math.floor((offset + size - 1) / blockSize);

    // Single block fast path
    if (startBlock === endBlock) {
      const blockStart = startBlock * blockSize;
      const block = await this.cache.get(this.getBlockKey(startBlock), () =>
        this.backend.getBytes(blockStart, Math.min(blockSize, fileSize - blockStart))
      );
      const blockOffset = offset - blockStart;
      return block.subarray(blockOffset, blockOffset + size);
    }

    // Multi-block path
    const output = new Uint8Array(size);
    const promises: Promise<void>[] = [];

    for (let blockIdx = startBlock; blockIdx <= endBlock; blockIdx++) {
      const blockStart = blockIdx * blockSize;
      promises.push(
        this.cache
          .get(this.getBlockKey(blockIdx), () =>
            this.backend.getBytes(blockStart, Math.min(blockSize, fileSize - blockStart))
          )
          .then((block) => {
            const srcStart = Math.max(offset, blockStart) - blockStart;
            const dstStart = Math.max(blockStart, offset) - offset;
            const len = Math.min(blockSize - srcStart, size - dstStart);
            output.set(block.subarray(srcStart, srcStart + len), dstStart);
          })
      );
    }

    await Promise.all(promises);
    return output;
  }

  /**
   * Collects block fetch tasks for a given range without executing them.
   * Returns an array of functions that, when called, will fetch and cache the block.
   */
  async collectPrefetchTasks(offset: number, count: number): Promise<Array<() => Promise<void>>> {
    const blockSize = this.cache.blockSize();
    const fileSize = await this.count();
    const startBlock = Math.floor(offset / blockSize);
    const endBlock = Math.floor((offset + count - 1) / blockSize);

    const tasks: Array<() => Promise<void>> = [];

    for (let blockIdx = startBlock; blockIdx <= endBlock; blockIdx++) {
      const blockStart = blockIdx * blockSize;
      const key = this.getBlockKey(blockIdx);

      // Create a task that fetches via cache.get (which handles deduplication)
      tasks.push(async () => {
        await this.cache.get(key, () => this.backend.getBytes(blockStart, Math.min(blockSize, fileSize - blockStart)));
      });
    }

    return tasks;
  }

  async prefetchData(offset: number, count: number): Promise<void> {
    console.time("prefetchData");
    const blockSize = this.cache.blockSize();
    const fileSize = await this.count();
    const startBlock = Math.floor(offset / blockSize);
    const endBlock = Math.floor((offset + count - 1) / blockSize);

    for (let blockIdx = startBlock; blockIdx <= endBlock; blockIdx++) {
      const blockStart = blockIdx * blockSize;
      this.cache.prefetch(this.getBlockKey(blockIdx), () =>
        this.backend.getBytes(blockStart, Math.min(blockSize, fileSize - blockStart))
      );
    }
    console.timeEnd("prefetchData");
  }

  async close(): Promise<void> {
    await this.backend.close();
  }
}
