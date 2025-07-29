import { OmFileReaderBackend } from "./OmFileReaderBackend";

/**
 * FNV-1a 64-bit hash implementation
 */
function fnv1aHash64(str: string): bigint {
  const FNV_OFFSET_BASIS = 0xcbf29ce484222325n;
  const FNV_PRIME = 0x100000001b3n;

  let hash = FNV_OFFSET_BASIS;
  const bytes = new TextEncoder().encode(str);

  for (const byte of bytes) {
    hash ^= BigInt(byte);
    hash = (hash * FNV_PRIME) & 0xffffffffffffffffn;
  }

  return hash;
}

export interface S3HttpBackendOptions {
  url: string;
  debug?: boolean;
  timeoutMs?: number;
  retries?: number;
}

export class S3HttpBackendError extends Error {
  constructor(message: string, public readonly statusCode?: number) {
    super(message);
    this.name = 'S3HttpBackendError';
  }
}

/**
 * Backend for reading from S3 or HTTP servers with partial read support using Range requests.
 * Supports ETags and Last-Modified headers for cache validation.
 */
export class S3HttpBackend implements OmFileReaderBackend {
  private readonly url: string;
  private readonly debug: boolean;
  private readonly timeoutMs: number;
  private readonly retries: number;

  private fileSize: number | null = null;
  private lastModified: string | null = null;
  private eTag: string | null = null;
  private metadataPromise: Promise<void> | null = null;

  constructor(options: S3HttpBackendOptions) {
    this.url = options.url;
    this.debug = options.debug ?? false;
    this.timeoutMs = options.timeoutMs ?? 30000;
    this.retries = options.retries ?? 3;
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

    this.metadataPromise = this.executeWithRetry(async () => {
      if (this.debug) {
        console.log(`Making HEAD request to ${this.url}`);
      }

      const controller = new AbortController();
      const timeoutId = setTimeout(() => {
        console.log(`Timeout reached for ${this.url}`);
        controller.abort();
      }, this.timeoutMs);

      try {
        const response = await fetch(this.url, {
          method: 'HEAD',
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          if (response.status === 404) {
            throw new S3HttpBackendError('File not found', 404);
          }
          throw new S3HttpBackendError(`HTTP error: ${response.status}`, response.status);
        }

        const contentLength = response.headers.get('content-length');
        if (!contentLength) {
          throw new S3HttpBackendError('Content-Length header missing');
        }

        this.fileSize = parseInt(contentLength, 10);
        this.lastModified = response.headers.get('last-modified');
        this.eTag = response.headers.get('etag');

        if (this.debug) {
          console.log(`File size: ${this.fileSize} bytes, ETag: ${this.eTag}, Last-Modified: ${this.lastModified}`);
        }
      } catch (error) {
        clearTimeout(timeoutId);
        if (error instanceof S3HttpBackendError) {
          throw error;
        }
        if (error instanceof Error && error.name === 'AbortError') {
          throw new S3HttpBackendError('Request timeout');
        }
        throw new S3HttpBackendError(`Failed to fetch metadata: ${error instanceof Error ? error.message : String(error)}`);
      }
    });

    return this.metadataPromise;
  }

  /**
   * Execute request with exponential backoff retry
   */
  private async executeWithRetry<T>(operation: () => Promise<T>): Promise<T> {
    let lastError: Error;

    for (let attempt = 0; attempt < this.retries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        // Don't retry on 404 or other client errors
        if (error instanceof S3HttpBackendError && error.statusCode && error.statusCode < 500) {
          throw error;
        }

        if (attempt < this.retries - 1) {
          const delay = Math.min(500 * Math.pow(2, attempt), 5000);
          if (this.debug) {
            console.log(`Attempt ${attempt + 1} failed, retrying in ${delay}ms: ${lastError.message}`);
          }
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }

    throw lastError!;
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
      throw new S3HttpBackendError('Invalid offset or size');
    }

    // Ensure we have metadata
    await this.fetchMetadata();

    if (offset + size > this.fileSize!) {
      throw new S3HttpBackendError(`Requested range (${offset}:${offset + size}) exceeds file size (${this.fileSize})`);
    }

    return this.executeWithRetry(async () => {
      const headers: Record<string, string> = {
        'Range': `bytes=${offset}-${offset + size - 1}`,
      };

      // Add conditional headers for cache validation
      if (this.lastModified) {
        headers['If-Unmodified-Since'] = this.lastModified;
      }
      if (this.eTag) {
        headers['If-Match'] = this.eTag;
      }

      if (this.debug) {
        console.log(`Getting data range ${offset}-${offset + size - 1} from ${this.url}`);
      }

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

      try {
        const response = await fetch(this.url, {
          headers,
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          if (response.status === 416) {
            throw new S3HttpBackendError('Range not satisfiable', 416);
          }
          if (response.status === 412) {
            throw new S3HttpBackendError('Precondition failed - file may have been modified', 412);
          }
          throw new S3HttpBackendError(`HTTP error: ${response.status}`, response.status);
        }

        // Verify we got a partial content response
        if (response.status !== 206) {
          if (this.debug) {
            console.warn(`Expected 206 Partial Content, got ${response.status}`);
          }
        }

        const buffer = await response.arrayBuffer();
        const data = new Uint8Array(buffer);

        if (data.length !== size) {
          throw new S3HttpBackendError(`Received ${data.length} bytes, expected ${size}`);
        }

        return data;
      } catch (error) {
        clearTimeout(timeoutId);
        if (error instanceof S3HttpBackendError) {
          throw error;
        }
        if (error instanceof Error && error.name === 'AbortError') {
          throw new S3HttpBackendError('Request timeout');
        }
        throw new S3HttpBackendError(`Failed to get bytes: ${error instanceof Error ? error.message : String(error)}`);
      }
    });
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
