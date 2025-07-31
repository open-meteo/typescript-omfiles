import { BlockCacheCoordinator } from "../BlockCache";
import { OmFileReader } from "../OmFileReader";
import { fetchRetry, fnv1aHash64 } from "../utils";
import { BlockCacheBackend } from "./BlockCacheBackend";
import { OmFileReaderBackend } from "./OmFileReaderBackend";

let globalCache: BlockCacheCoordinator | null = null;

export function setupGlobalCache(blockSize: number = 64 * 1024, maxBlocks: number = 256) {
  if (!globalCache) {
    globalCache = new BlockCacheCoordinator(blockSize, maxBlocks);
  } else {
    if (globalCache.blockSize() !== blockSize || globalCache.maxBlocks() !== maxBlocks) {
      throw new Error("Global coordinator already set up with configuration " + blockSize + " " + maxBlocks);
    }
  }
}

export interface OmHttpBackendOptions {
  url: string;
  debug?: boolean;
  timeoutMs?: number;
  retries?: number;
}

export class OmHttpBackendError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number
  ) {
    super(message);
    this.name = "OmHttpBackendError";
  }
}

/**
 * Backend for reading from HTTP servers with partial read support using Range requests.
 * Checks last modified header and ETag.
 */
export class OmHttpBackend implements OmFileReaderBackend {
  private readonly url: string;
  private readonly debug: boolean;
  private readonly timeoutMs: number;
  private readonly retries: number;

  private fileSize: number | null = null;
  private lastModified: string | null = null;
  private eTag: string | null = null;
  private metadataPromise: Promise<void> | null = null;

  constructor(options: OmHttpBackendOptions) {
    this.url = options.url;
    this.debug = options.debug ?? false;
    this.timeoutMs = options.timeoutMs ?? 30000;
    this.retries = options.retries ?? 1;
  }

  /**
   * Get cache key based on URL, ETag, and Last-Modified
   */
  get cacheKey(): bigint {
    const urlHash = fnv1aHash64(this.url);
    const eTagHash = this.eTag ? fnv1aHash64(this.eTag) : 0n;
    const lastModifiedHash = this.lastModified ? fnv1aHash64(this.lastModified) : 0n;

    return urlHash ^ eTagHash ^ lastModifiedHash;
  }

  /**
   * Fetch metadata using HEAD request
   */
  private async fetchMetadata(): Promise<void> {
    if (this.metadataPromise) {
      return this.metadataPromise;
    }

    this.metadataPromise = (async () => {
      const response = await fetchRetry(this.url, { method: "HEAD" }, this.timeoutMs ?? 5000, this.retries);

      if (!response.ok) {
        throw new OmHttpBackendError(
          response.status === 404 ? "File not found" : `HTTP error: ${response.status}`,
          response.status
        );
      }

      const contentLength = response.headers.get("content-length");
      if (!contentLength) throw new OmHttpBackendError("Content-Length header missing");

      this.fileSize = parseInt(contentLength, 10);
      this.lastModified = response.headers.get("last-modified");
      this.eTag = response.headers.get("etag");
    })();

    return this.metadataPromise;
  }

  /**
   * Get the total size of the file
   */
  async count(): Promise<number> {
    if (this.fileSize !== null) {
      return this.fileSize;
    }

    await this.fetchMetadata();
    return this.fileSize!;
  }

  /**
   * Get bytes from the file using Range requests
   */
  async getBytes(offset: number, size: number): Promise<Uint8Array> {
    if (offset < 0 || size <= 0) {
      throw new OmHttpBackendError("Invalid offset or size");
    }

    // Ensure we have metadata
    await this.fetchMetadata();

    if (offset + size > this.fileSize!) {
      throw new OmHttpBackendError(`Requested range (${offset}:${offset + size}) exceeds file size (${this.fileSize})`);
    }

    // Prepare request
    const headers: Record<string, string> = {
      Range: `bytes=${offset}-${offset + size - 1}`,
    };
    // Add conditional headers for cache validation
    if (this.lastModified) {
      headers["If-Unmodified-Since"] = this.lastModified;
    }
    if (this.eTag) {
      headers["If-Match"] = this.eTag;
    }

    if (this.debug) {
      console.log(`Getting data range ${offset}-${offset + size - 1} from ${this.url}`);
    }

    const response = await fetchRetry(this.url, { headers }, this.timeoutMs, this.retries);

    const buffer = await response.arrayBuffer();
    const data = new Uint8Array(buffer);

    if (data.length !== size) {
      throw new OmHttpBackendError(`Received ${data.length} bytes, expected ${size}`);
    }
    return data;
  }

  async prefetchData(_offset: number, _bytes: number): Promise<void> {
    // No-op for now!
  }

  async asCachedReader(): Promise<OmFileReader> {
    if (globalCache) {
      const cachedBackend = new BlockCacheBackend(this, globalCache, this.cacheKey);
      return await OmFileReader.create(cachedBackend);
    } else {
      throw new OmHttpBackendError("No global cache set up! Configure it with setupGlobalCache first!");
    }
  }

  /**
   * Close the backend and release resources
   */
  async close(): Promise<void> {
    this.metadataPromise = null;
    this.fileSize = null;
    this.lastModified = null;
    this.eTag = null;
  }
}
