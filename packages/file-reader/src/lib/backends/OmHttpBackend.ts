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

    const metadataPromise = (async () => {
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
    })();

    this.metadataPromise = metadataPromise;
    // A failed fetch must not stay memoized, otherwise a long-lived backend
    // (e.g. from OmHttpBackendPool) could never retry this URL. The rejection
    // itself still reaches callers via the returned metadataPromise.
    void metadataPromise.catch(() => {
      if (this.metadataPromise === metadataPromise) {
        this.metadataPromise = null;
      }
    });

    return metadataPromise;
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
   * Open a cached reader, run `fn` with it and dispose it afterwards.
   *
   * The reader never escapes the callback, so callers hold no reader state:
   * there is no "current file" to mutate and no dispose ordering to get wrong
   * when multiple files are read concurrently.
   */
  async withReader<T>(
    cache: BlockCache<string> | BlockCache<bigint>,
    fn: (reader: OmFileReader) => T | Promise<T>
  ): Promise<T> {
    const reader = await this.asCachedReader(cache);
    try {
      return await fn(reader);
    } finally {
      reader.dispose();
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

export interface OmHttpBackendPoolOptions {
  /** Options applied to every backend created by the pool (`url` is set per entry). */
  backendOptions?: Omit<OmHttpBackendOptions, "url">;
  /** Maximum number of memoized backends; least recently used entries are evicted. @default 64 */
  maxBackends?: number;
}

/**
 * Memoizes one `OmHttpBackend` per URL, so repeated reads of the same file skip
 * the HEAD metadata request (a backend memoizes it internally). Backends hold no
 * wasm resources, so eviction is always safe — an evicted backend still in use by
 * an in-flight read keeps working and is garbage collected afterwards.
 */
export class OmHttpBackendPool {
  private readonly backends = new Map<string, OmHttpBackend>();
  private readonly backendOptions: Omit<OmHttpBackendOptions, "url">;
  private readonly maxBackends: number;

  constructor(options: OmHttpBackendPoolOptions = {}) {
    this.backendOptions = options.backendOptions ?? {};
    this.maxBackends = options.maxBackends ?? 64;
  }

  /** Get (or create) the memoized backend for a URL and mark it recently used. */
  backend(url: string): OmHttpBackend {
    const existing = this.backends.get(url);
    if (existing) {
      // Re-insert to move to the most recently used position
      this.backends.delete(url);
      this.backends.set(url, existing);
      return existing;
    }

    const backend = new OmHttpBackend({ ...this.backendOptions, url });
    this.backends.set(url, backend);
    while (this.backends.size > Math.max(1, this.maxBackends)) {
      const oldest = this.backends.keys().next().value;
      if (oldest === undefined) break;
      this.backends.delete(oldest);
    }
    return backend;
  }

  /** Scoped read via the memoized backend for `url` (see `OmHttpBackend.withReader`). */
  withReader<T>(
    url: string,
    cache: BlockCache<string> | BlockCache<bigint>,
    fn: (reader: OmFileReader) => T | Promise<T>
  ): Promise<T> {
    return this.backend(url).withReader(cache, fn);
  }

  /** Drop all memoized backends, e.g. to force fresh metadata requests. */
  clear(): void {
    this.backends.clear();
  }
}
