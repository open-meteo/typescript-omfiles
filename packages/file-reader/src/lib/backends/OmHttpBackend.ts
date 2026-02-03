import { BlockCache } from "../BlockCache";
import { OmFileReader } from "../OmFileReader";
import { fetchRetry, fnv1aHash64 } from "../utils";
import { BlockCacheBackend } from "./BlockCacheBackend";
import { OmFileReaderBackend } from "./OmFileReaderBackend";

export interface OmHttpBackendOptions {
  url: string;
  eTagValidation?: boolean;
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

  private eTagValidation: boolean;
  private fileSize: number | null = null;
  private lastModified: string | null = null;
  private eTag: string | null = null;
  private metadataPromise: Promise<void> | null = null;

  constructor(options: OmHttpBackendOptions) {
    this.url = options.url;
    this.debug = options.debug ?? false;
    this.timeoutMs = options.timeoutMs ?? 30000;
    this.retries = options.retries ?? 1;
    this.eTagValidation = options.eTagValidation ?? true;
  }

  /**
   * Returns a bigint cache key for use with LruBlockCache.
   * Uniquely identifies the file based on its URL, ETag, and Last-Modified headers.
   * The ETag is only included if validation is enabled.
   */
  get cacheKeyBigInt(): bigint {
    const urlHash = fnv1aHash64(this.url);
    const lastModifiedHash = this.lastModified ? fnv1aHash64(this.lastModified) : 0n;
    // Only include the eTag in the cache key if we are actually validating against it.
    const eTagHash = this.eTag && this.eTagValidation ? fnv1aHash64(this.eTag) : 0n;

    return urlHash ^ eTagHash ^ lastModifiedHash;
  }

  /**
   * Returns a string cache key for use with BrowserBlockCache based on the underlying url.
   */
  get cacheKeyString(): string {
    return this.url;
  }

  // /**
  //  * Returns a cache key that uniquely identifies the file based on its URL, ETag, and Last-Modified headers.
  //  * The ETag is only included if validation is enabled.
  //  */
  // get cacheKey(): BlockKey {
  //   const urlHash = fnv1aHash64(this.url);
  //   return urlHash;
  //   const lastModifiedHash = this.lastModified ? fnv1aHash64(this.lastModified) : 0n;
  //   // Only include the eTag in the cache key if we are actually validating against it.
  //   const eTagHash = this.eTag && this.eTagValidation ? fnv1aHash64(this.eTag) : 0n;

  //   return urlHash ^ eTagHash ^ lastModifiedHash;
  // }

  /**
   * Fetch metadata using HEAD request
   */
  private async fetchMetadata(): Promise<void> {
    console.log("fetchMetadata");
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
    console.log("coubnt");
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
    await this.count();

    if (offset + size > this.fileSize!) {
      throw new OmHttpBackendError(`Requested range (${offset}:${offset + size}) exceeds file size (${this.fileSize})`);
    }

    // Prepare request
    const headers: Record<string, string> = {
      Range: `bytes=${offset}-${offset + size - 1}`,
    };

    if (this.eTagValidation) {
      // Add conditional headers for cache validation
      if (this.lastModified) {
        headers["If-Unmodified-Since"] = this.lastModified;
      }
      if (this.eTag) {
        headers["If-Match"] = this.eTag;
      }
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

  /**
   * Get bytes from the end of file using negative Range request.
   * Returns data and file size in a single request (saves HEAD round trip).
   */
  async getBytesFromEnd(size: number): Promise<{ data: Uint8Array; fileSize: number }> {
    if (size <= 0) {
      throw new OmHttpBackendError("Invalid size");
    }

    const headers: Record<string, string> = {
      Range: `bytes=-${size}`,
    };

    if (this.debug) {
      console.log(`Getting last ${size} bytes from ${this.url}`);
    }

    const response = await fetchRetry(this.url, { headers }, this.timeoutMs, this.retries);

    if (!(response.status === 206 || response.status === 200)) {
      throw new OmHttpBackendError(`Expected 206 Partial Content, got ${response.status}`, response.status);
    }

    // Parse Content-Range header: "bytes START-END/TOTAL"
    const contentRange = response.headers.get("content-range");
    if (!contentRange) {
      throw new OmHttpBackendError("Content-Range header missing from response");
    }

    const match = contentRange.match(/bytes\s+(\d+)-(\d+)\/(\d+)/);
    if (!match) {
      throw new OmHttpBackendError(`Invalid Content-Range header: ${contentRange}`);
    }

    const fileSize = parseInt(match[3], 10);

    // Cache metadata for subsequent requests
    if (this.fileSize === null) {
      this.fileSize = fileSize;
      this.lastModified = response.headers.get("last-modified");
      this.eTag = response.headers.get("etag");
    }

    const buffer = await response.arrayBuffer();
    const data = new Uint8Array(buffer);

    if (data.length !== size) {
      throw new OmHttpBackendError(`Received ${data.length} bytes, expected ${size}`);
    }

    return { data, fileSize };
  }

  // No collectPrefetchTasks here - use BlockCacheBackend wrapper for prefetching

  async asCachedReader(cache: BlockCache<bigint>): Promise<OmFileReader>;
  async asCachedReader(cache: BlockCache<string>): Promise<OmFileReader>;
  async asCachedReader(_cache: BlockCache<bigint> | BlockCache<string>): Promise<OmFileReader> {
    // Type check based on what the cache accepts
    // We need a way to distinguish - simplest is to check cache type at runtime
    // or use separate methods

    // For simplicity, let's use separate methods instead:
    throw new Error("Use asCachedReaderWithBigInt or asCachedReaderWithString");
  }

  async asCachedReaderWithBigInt(cache: BlockCache<bigint>): Promise<OmFileReader> {
    const cachedBackend = BlockCacheBackend.withBigIntKeys(this, cache, this.cacheKeyBigInt);
    return OmFileReader.create(cachedBackend);
  }

  async asCachedReaderWithString(cache: BlockCache<string>): Promise<OmFileReader> {
    const cachedBackend = BlockCacheBackend.withStringKeys(this, cache, this.cacheKeyString);
    return OmFileReader.create(cachedBackend);
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
