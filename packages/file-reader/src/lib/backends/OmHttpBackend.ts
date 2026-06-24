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

/** Cached HEAD result, keyed by URL (size + validators). */
interface CachedMetadata {
  fileSize: number;
  lastModified: string | null;
  eTag: string | null;
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

  /**
   * Static cache of the HEAD result (size + validators), keyed by URL and shared across
   * instances. A fresh backend is created for every file read; without this cache each
   * read repeats a HEAD request (never covered by the block cache). `.om` files are
   * addressed by an immutable URL (model run / timestamp), so caching by URL is safe —
   * the same assumption already documented on `cacheKeyString`. Bounded with FIFO
   * eviction so it cannot grow without limit over long sessions (many runs / steps).
   */
  private static readonly metadataCache = new Map<string, CachedMetadata>();
  private static readonly METADATA_CACHE_MAX = 512;

  /** Clears the static metadata cache. Mainly useful for tests. */
  static clearMetadataCache(): void {
    OmHttpBackend.metadataCache.clear();
  }

  private static cacheMetadata(url: string, meta: CachedMetadata): void {
    const cache = OmHttpBackend.metadataCache;
    if (!cache.has(url) && cache.size >= OmHttpBackend.METADATA_CACHE_MAX) {
      const oldest = cache.keys().next().value;
      if (oldest !== undefined) cache.delete(oldest);
    }
    cache.set(url, meta);
  }

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
   * If the upstream resource can change, this cache-key is not safe to use!
   * => Only use for static files!
   */
  get cacheKeyString(): string {
    return this.url;
  }

  /**
   * Fetch metadata using HEAD request
   */
  private async fetchMetadata(signal?: AbortSignal): Promise<void> {
    if (this.metadataPromise) {
      return this.metadataPromise;
    }

    this.metadataPromise = (async () => {
      const cached = OmHttpBackend.metadataCache.get(this.url);
      if (cached) {
        this.fileSize = cached.fileSize;
        this.lastModified = cached.lastModified;
        this.eTag = cached.eTag;
        return;
      }

      const response = await fetchRetry(this.url, { method: "HEAD" }, this.timeoutMs, this.retries, signal);

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

      OmHttpBackend.cacheMetadata(this.url, {
        fileSize: this.fileSize,
        lastModified: this.lastModified,
        eTag: this.eTag,
      });
    })();

    return this.metadataPromise;
  }

  /**
   * Get the total size of the file
   */
  async count(signal?: AbortSignal): Promise<number> {
    if (this.fileSize !== null) {
      return this.fileSize;
    }

    await this.fetchMetadata(signal);
    return this.fileSize!;
  }

  /**
   * Get bytes from the file using Range requests
   */
  async getBytes(offset: number, size: number, signal?: AbortSignal): Promise<Uint8Array> {
    if (offset < 0 || size <= 0) {
      throw new OmHttpBackendError("Invalid offset or size");
    }

    // Ensure we have metadata
    await this.count(signal);

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

    const response = await fetchRetry(this.url, { headers }, this.timeoutMs, this.retries, signal);

    const buffer = await response.arrayBuffer();
    const data = new Uint8Array(buffer);

    if (data.length !== size) {
      throw new OmHttpBackendError(`Received ${data.length} bytes, expected ${size}`);
    }
    return data;
  }

  // No collectPrefetchTasks here - use BlockCacheBackend wrapper for prefetching

  async asCachedReader(cache: BlockCache<string> | BlockCache<bigint>): Promise<OmFileReader> {
    await this.fetchMetadata();
    switch (cache.keyKind) {
      case "bigint": {
        const cachedBackend = BlockCacheBackend.withBigIntKeys(this, cache as BlockCache<bigint>, this.cacheKeyBigInt);
        return OmFileReader.create(cachedBackend);
      }
      case "string": {
        const cachedBackend = BlockCacheBackend.withStringKeys(this, cache as BlockCache<string>, this.cacheKeyString);
        return OmFileReader.create(cachedBackend);
      }
      default: {
        const _: never = cache.keyKind;
        throw Error(`Unknown key type ${String(_)}`);
      }
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
    return Promise.resolve();
  }
}
