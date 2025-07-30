import { BlockCacheCoordinator } from "../BlockCache";
import { OmFileReaderBackend } from "./OmFileReaderBackend";

/**
 * Wraps a backend for caching blocks of data.
 */
export class BlockCacheBackend implements OmFileReaderBackend {
  private backend: OmFileReaderBackend;
  private cacheCoordinator: BlockCacheCoordinator;
  private cacheKey: bigint;

  constructor(backend: OmFileReaderBackend, cacheCoordinator: BlockCacheCoordinator, cacheKey: bigint) {
    this.backend = backend;
    this.cacheKey = cacheKey;
    this.cacheCoordinator = cacheCoordinator;
  }

  async count(): Promise<number> {
    return this.backend.count();
  }

  async prefetchData(offset: number, count: number): Promise<void> {
    const blockSize = this.cacheCoordinator.blockSize();
    const fileSize = await this.count();
    const startBlock = Math.floor(offset / blockSize);
    const endBlock = Math.floor((offset + count - 1) / blockSize);

    for (let blockIdx = startBlock; blockIdx <= endBlock; blockIdx++) {
      const blockKey = this.cacheKey + BigInt(blockIdx);
      this.cacheCoordinator.prefetch(
        blockKey,
        () => this.backend.getBytes(blockIdx * blockSize, Math.min(blockSize, fileSize - blockIdx * blockSize))
      );
    }
  }

  async getBytes(offset: number, size: number): Promise<Uint8Array> {
    const blockSize = this.cacheCoordinator.blockSize();
    const fileSize = await this.count();
    const startBlock = Math.floor(offset / blockSize);
    const endBlock = Math.floor((offset + size - 1) / blockSize);

    const output = new Uint8Array(size);

    // Fetch all blocks in parallel
    const tasks: (() => Promise<{blockIdx: number, block: Uint8Array}>)[] = [];
    for (let blockIdx = startBlock; blockIdx <= endBlock; blockIdx++) {
      const blockKey = this.cacheKey + BigInt(blockIdx);
      tasks.push(async () => {
        const blockStart = blockIdx * blockSize;
        const blockEnd = Math.min(blockStart + blockSize, fileSize);
        const block = await this.cacheCoordinator.get(
          blockKey,
          () => this.backend.getBytes(blockStart, blockEnd - blockStart)
        );
        return { blockIdx, block };
      });
    }

    const fetchedBlocks = await Promise.all(tasks.map(task => task()));

    const blocks = new Map<number, Uint8Array>();
    for (const { blockIdx, block } of fetchedBlocks) {
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
    this.cacheCoordinator.clear();
    await this.backend.close();
  }
}
