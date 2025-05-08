import { S3Client, GetObjectCommand, HeadObjectCommand, S3ClientConfig } from "@aws-sdk/client-s3";
import { OmFileReaderBackend } from "./OmFileReaderBackend";

/**
 * Configuration options for the S3Backend
 */
export interface S3BackendOptions {
  region: string;
  bucket: string;
  key: string;
  /**
   * Authentication configuration:
   * - Provide credentials object with access keys
   * - Use 'anonymous' for public buckets
   * - Omit to use default AWS credentials chain
   */
  credentials?: { accessKeyId: string; secretAccessKey: string };
  cacheEnabled?: boolean;
  cacheMaxSize?: number;
}

/**
 * A backend implementation that fetches file parts directly from Amazon S3
 */
export class S3Backend implements OmFileReaderBackend {
  private s3Client: S3Client;
  private bucket: string;
  private key: string;
  private fileSize: number | null = null;
  private cachedRanges: Map<string, Uint8Array> = new Map();
  private cacheEnabled: boolean;
  private cacheMaxSize: number;
  private cacheSize: number = 0;

  /**
   * Create a new S3 backend
   * @param options Configuration options for the S3 backend
   */
  constructor(options: S3BackendOptions) {
    // Set up S3 client configuration
    const clientConfig: S3ClientConfig = {
      region: options.region,
    };

    // Configure credentials based on the option
    if (options.credentials) {
      // Use provided credentials
      clientConfig.credentials = options.credentials;
    } else {
      // // Use anonymous credentials
      clientConfig.credentials = {
        accessKeyId: "",
        secretAccessKey: "",
      };
      clientConfig.signer = { sign: async (request) => request };
    }

    // Create the S3 client
    this.s3Client = new S3Client(clientConfig);

    this.bucket = options.bucket;
    this.key = options.key;
    this.cacheEnabled = options.cacheEnabled ?? true;
    this.cacheMaxSize = options.cacheMaxSize ?? 100 * 1024 * 1024; // 100 MB default
  }

  /**
   * Get the total size of the object in S3
   */
  async count(): Promise<number> {
    if (this.fileSize !== null) {
      return this.fileSize;
    }

    try {
      const command = new HeadObjectCommand({
        Bucket: this.bucket,
        Key: this.key,
      });

      const response = await this.s3Client.send(command);

      if (!response.ContentLength) {
        throw new Error("Unable to determine file size from S3");
      }

      this.fileSize = response.ContentLength;
      return this.fileSize;
    } catch (error) {
      throw new Error(`Failed to get object size from S3: ${error}`);
    }
  }

  /**
   * Get bytes from S3 using a range request
   * @param offset The starting position in the file
   * @param size The number of bytes to read
   */
  async getBytes(offset: number, size: number): Promise<Uint8Array> {
    // Check if we already have this range cached
    const rangeKey = `${offset}-${size}`;

    if (this.cacheEnabled && this.cachedRanges.has(rangeKey)) {
      return this.cachedRanges.get(rangeKey)!;
    }

    try {
      // Create the byte range string for S3
      const range = `bytes=${offset}-${offset + size - 1}`;

      const command = new GetObjectCommand({
        Bucket: this.bucket,
        Key: this.key,
        Range: range,
      });

      const response = await this.s3Client.send(command);

      if (!response.Body) {
        throw new Error("S3 response body is empty");
      }

      // Convert the response body to a Uint8Array
      const responseArrayBuffer = await response.Body.transformToByteArray();
      const data = new Uint8Array(responseArrayBuffer);

      // Cache the result if caching is enabled
      if (this.cacheEnabled) {
        this.cacheData(rangeKey, data);
      }

      return data;
    } catch (error) {
      throw new Error(`Failed to get bytes from S3: ${error}`);
    }
  }

  /**
   * Add data to the cache, evicting older entries if needed
   */
  private cacheData(key: string, data: Uint8Array): void {
    // Check if adding this would exceed our cache limit
    if (this.cacheSize + data.byteLength > this.cacheMaxSize) {
      // Simple LRU-like eviction - just clear the entire cache if we're at capacity
      // A more sophisticated implementation might use a proper LRU cache
      this.cachedRanges.forEach((value) => {
        this.cacheSize -= value.byteLength;
      });
      this.cachedRanges.clear();
    }

    // Add to cache
    this.cachedRanges.set(key, data);
    this.cacheSize += data.byteLength;
  }

  /**
   * Clear the cache
   */
  clearCache(): void {
    this.cachedRanges.clear();
    this.cacheSize = 0;
  }
}
