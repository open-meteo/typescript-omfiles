import { BlockCache } from "../BlockCache";
import { OmFileReaderBackend } from "./OmFileReaderBackend";

/**
 * Wraps a backend for caching blocks of data.
 */
export class BlockCacheBackend<K> implements OmFileReaderBackend {
  private readonly backend: OmFileReaderBackend;
  private readonly cache: BlockCache<K>;
  private readonly baseKey: K;
  private readonly keyBuilder: (baseKey: K, blockIdx: number) => K;
  private cachedCount: number | null = null;

  constructor(
    backend: OmFileReaderBackend,
    cache: BlockCache<K>,
    baseKey: K,
    keyBuilder: (baseKey: K, blockIdx: number) => K
  ) {
    this.backend = backend;
    this.cache = cache;
    this.baseKey = baseKey;
    this.keyBuilder = keyBuilder;
  }

  /**
   * Creates a BlockCacheBackend using bigint keys.
   */
  static withBigIntKeys(
    backend: OmFileReaderBackend,
    cache: BlockCache<bigint>,
    baseKey: bigint
  ): BlockCacheBackend<bigint> {
    return new BlockCacheBackend(backend, cache, baseKey, (base, blockIdx) => base + BigInt(blockIdx));
  }

  /**
   * Creates a BlockCacheBackend using string keys.
   */
  static withStringKeys(
    backend: OmFileReaderBackend,
    cache: BlockCache<string>,
    baseKey: string
  ): BlockCacheBackend<string> {
    return new BlockCacheBackend(backend, cache, baseKey, (base, blockIdx) => `${base}/block/${blockIdx}`);
  }

  /**
   * Generates a unique key for a specific block.
   */
  private getBlockKey(blockIdxFromEnd: number): K {
    return this.keyBuilder(this.baseKey, blockIdxFromEnd);
  }

  /**
   * Get the byte range for a block indexed from the end.
   * Block 0 = last blockSize bytes, Block 1 = previous blockSize bytes, etc.
   */
  private getBlockRange(blockIdxFromEnd: number, fileSize: number): { start: number; end: number } {
    const blockSize = this.cache.blockSize();
    const end = fileSize - blockIdxFromEnd * blockSize;
    const start = Math.max(0, end - blockSize);
    return { start, end };
  }

  /**
   * Get the block index (from end) that contains a given offset.
   */
  private getBlockIdxFromEnd(offset: number, fileSize: number): number {
    const blockSize = this.cache.blockSize();
    // Distance from end of file to end of the byte at offset
    const distanceFromEnd = fileSize - offset - 1;
    return Math.floor(distanceFromEnd / blockSize);
  }

  async count(): Promise<number> {
    if (this.cachedCount !== null) {
      return this.cachedCount;
    }

    // check last block, which contains the trailer
    const key = this.getBlockKey(0);
    const cached = await this.cache.size(key);
    if (cached) {
      this.cachedCount = cached;
      return cached;
    }

    // Fallback to regular count
    this.cachedCount = await this.backend.count();
    return this.cachedCount;
  }

  async getBytes(offset: number, size: number): Promise<Uint8Array> {
    const fileSize = await this.count();

    const startBlockFromEnd = this.getBlockIdxFromEnd(offset + size - 1, fileSize);
    const endBlockFromEnd = this.getBlockIdxFromEnd(offset, fileSize);

    // Single block fast path
    if (startBlockFromEnd === endBlockFromEnd) {
      const { start: blockStart, end: blockEnd } = this.getBlockRange(startBlockFromEnd, fileSize);
      const block = await this.cache.get(this.getBlockKey(startBlockFromEnd), () =>
        this.backend.getBytes(blockStart, blockEnd - blockStart)
      );
      const blockOffset = offset - blockStart;
      return block.subarray(blockOffset, blockOffset + size);
    }

    // Multi-block path - iterate from lowest block index (closest to end) to highest
    const output = new Uint8Array(size);
    const promises: Promise<void>[] = [];

    for (let blockIdxFromEnd = startBlockFromEnd; blockIdxFromEnd <= endBlockFromEnd; blockIdxFromEnd++) {
      const { start: blockStart, end: blockEnd } = this.getBlockRange(blockIdxFromEnd, fileSize);

      promises.push(
        this.cache
          .get(
            this.getBlockKey(blockIdxFromEnd),
            () => this.backend.getBytes(blockStart, blockEnd - blockStart),
            fileSize
          )
          .then((block) => {
            const srcStart = Math.max(offset, blockStart) - blockStart;
            const dstStart = Math.max(blockStart, offset) - offset;
            const len = Math.min(blockEnd - blockStart - srcStart, size - dstStart);
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
  async collectPrefetchTasks(offset: number, size: number): Promise<Array<() => Promise<void>>> {
    const fileSize = await this.count();
    const startBlockFromEnd = this.getBlockIdxFromEnd(offset + size - 1, fileSize);
    const endBlockFromEnd = this.getBlockIdxFromEnd(offset, fileSize);

    const tasks: Array<() => Promise<void>> = [];

    for (let blockIdxFromEnd = startBlockFromEnd; blockIdxFromEnd <= endBlockFromEnd; blockIdxFromEnd++) {
      const { start: blockStart, end: blockEnd } = this.getBlockRange(blockIdxFromEnd, fileSize);
      const key = this.getBlockKey(blockIdxFromEnd);

      tasks.push(async () => {
        await this.cache.prefetch(key, () => this.backend.getBytes(blockStart, blockEnd - blockStart));
      });
    }
    return tasks;
  }

  async close(): Promise<void> {
    await this.backend.close();
  }
}
