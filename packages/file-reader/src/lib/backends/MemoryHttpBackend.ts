import { OmFileReaderBackend } from "./OmFileReaderBackend";

export class MemoryHttpBackend implements OmFileReaderBackend {
  private url: string;
  private fileSize: number | null = null;
  private fileData: Uint8Array | null = null;
  private loadPromise: Promise<void> | null = null;
  private countPromise: Promise<number> | null = null;
  private maxFileSize: number;
  private onProgress?: (loaded: number, total: number) => void;
  private debug: boolean;

  /**
   * Create a new MemoryHttpBackend
   * @param options Configuration options
   */
  constructor(options: {
    url: string;
    maxFileSize?: number;
    onProgress?: (loaded: number, total: number) => void;
    debug?: boolean;
  }) {
    this.url = options.url;
    this.maxFileSize = options.maxFileSize ?? 200 * 1024 * 1024; // 200 MB default
    this.onProgress = options.onProgress;
    this.debug = options.debug ?? false;

    // Start loading the file in the background
    this.loadFile().catch((err) => {
      if (this.debug) console.error("Background file load failed:", err);
    });
  }

  /**
   * Get the total size of the file
   */
  async count(): Promise<number> {
    if (this.fileSize !== null) {
      return this.fileSize;
    }

    if (!this.countPromise) {
      if (this.debug) console.log(`Making HEAD request to ${this.url}`);

      this.countPromise = (async () => {
        try {
          const response = await fetch(this.url, {
            method: "HEAD",
          });

          if (!response.ok) {
            throw new Error(`HTTP error: ${response.status}`);
          }

          const contentLength = response.headers.get("content-length");
          if (!contentLength) {
            throw new Error("Content-Length header not available");
          }

          this.fileSize = parseInt(contentLength, 10);

          if (this.fileSize > this.maxFileSize) {
            throw new Error(
              `File size (${this.fileSize} bytes) exceeds maximum allowed size (${this.maxFileSize} bytes)`
            );
          }

          if (this.debug) console.log(`File size: ${this.fileSize} bytes`);
          return this.fileSize;
        } catch (error) {
          this.countPromise = null;
          throw new Error(`Failed to get file size: ${error instanceof Error ? error.message : String(error)}`);
        }
      })();
    }

    return this.countPromise;
  }

  /**
   * Load the entire file into memory
   */
  async loadFile(): Promise<void> {
    // If already loaded or loading, return that promise
    if (this.fileData) {
      return Promise.resolve();
    }

    if (this.loadPromise) {
      return this.loadPromise;
    }

    this.loadPromise = (async () => {
      try {
        // First get the file size
        const size = await this.count();

        if (this.debug) console.log(`Fetching entire file (${size} bytes) from ${this.url}`);

        // Use fetch with streaming and progress tracking
        const response = await fetch(this.url);

        if (!response.ok) {
          throw new Error(`HTTP error: ${response.status}`);
        }

        // Check if ReadableStream is supported and if progress tracking is needed
        if (this.onProgress && response.body && "getReader" in response.body) {
          // Stream the response with progress tracking
          const contentLength = Number(response.headers.get("content-length") || size);
          const reader = response.body.getReader();
          const chunks: Uint8Array[] = [];

          let receivedLength = 0;
          let lastProgressUpdate = 0;

          while (true) {
            const { done, value } = await reader.read();

            if (done) {
              break;
            }

            chunks.push(value);
            receivedLength += value.length;

            // Don't update progress too frequently (throttle updates)
            const now = Date.now();
            if (now - lastProgressUpdate > 100) {
              // update every 100ms
              this.onProgress(receivedLength, contentLength);
              lastProgressUpdate = now;
            }
          }

          // Concatenate chunks into a single Uint8Array
          this.fileData = new Uint8Array(receivedLength);
          let position = 0;
          for (const chunk of chunks) {
            this.fileData.set(chunk, position);
            position += chunk.length;
          }

          // Final progress update
          this.onProgress(receivedLength, contentLength);
        } else {
          // Simple approach without streaming
          const buffer = await response.arrayBuffer();
          this.fileData = new Uint8Array(buffer);

          if (this.onProgress) {
            this.onProgress(this.fileData.length, size);
          }
        }

        if (this.debug) console.log(`File loaded successfully (${this.fileData.length} bytes)`);
        return;
      } catch (error) {
        this.loadPromise = null;
        throw new Error(`Failed to load file: ${error instanceof Error ? error.message : String(error)}`);
      }
    })();

    return this.loadPromise;
  }

  /**
   * Get bytes from the file
   * @param offset The starting position in the file
   * @param size The number of bytes to read
   */
  async getBytes(offset: number, size: number): Promise<Uint8Array> {
    try {
      // Make sure the file is loaded
      if (!this.fileData) {
        if (this.debug) console.log(`getBytes(${offset}, ${size}): Waiting for file to load...`);
        await this.loadFile();
        if (this.debug) console.log(`getBytes(${offset}, ${size}): File loaded`);
      }

      // At this point, fileData should be available
      if (!this.fileData) {
        throw new Error("File data is not available after load");
      }

      // Bounds check
      if (offset < 0 || offset + size > this.fileData.length) {
        throw new Error(`Requested range (${offset}:${offset + size}) is out of bounds (0:${this.fileData.length})`);
      }

      if (this.debug) console.log(`Serving ${size} bytes from offset ${offset} from memory`);

      // Return the requested slice of data
      return this.fileData.slice(offset, offset + size);
    } catch (error) {
      throw new Error(`Error in getBytes: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Check if the file is fully loaded
   */
  isLoaded(): boolean {
    return !!this.fileData;
  }

  /**
   * Get the current loaded data or null if not loaded
   */
  getFileData(): Uint8Array | null {
    return this.fileData;
  }

  /**
   * Force a reload of the file
   */
  async reload(): Promise<void> {
    this.fileData = null;
    this.loadPromise = null;
    return this.loadFile();
  }

  /**
   * Close the backend and release any resources
   */
  async close(): Promise<void> {
    this.fileData = null;
    this.loadPromise = null;
  }
}
