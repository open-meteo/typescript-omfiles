import { OmFileReaderBackend } from "./OmFileReaderBackend";

// Simple environment detection
const isNode = typeof process !== "undefined" && process.versions != null && process.versions.node != null;

export class FileBackend implements OmFileReaderBackend {
  private file: File | string | Uint8Array;
  private fileSize: number = 0;
  private fileHandle: any = null; // For Node.js file handles

  constructor(source: File | string | Uint8Array | ArrayBuffer) {
    if (source instanceof ArrayBuffer) {
      this.file = new Uint8Array(source);
      this.fileSize = this.file.length;
    } else {
      this.file = source;

      // For Uint8Array, we already know the size
      if (source instanceof Uint8Array) {
        this.fileSize = source.length;
      }
      // For File objects, we can get size directly
      else if (source instanceof File) {
        this.fileSize = source.size;
      }
      // For path strings in Node.js, we'll get size later
    }
  }

  async count(): Promise<number> {
    // If we already know the size
    if (this.fileSize > 0) {
      return this.fileSize;
    }

    // Handle Node.js string paths
    if (typeof this.file === "string" && isNode) {
      // Dynamically import fs to avoid browser issues
      const fs = await import("fs/promises");
      const stats = await fs.stat(this.file);
      this.fileSize = stats.size;
      return this.fileSize;
    }

    throw new Error("Unable to determine file size");
  }

  async getBytes(offset: number, size: number): Promise<Uint8Array> {
    // Handle in-memory Uint8Array
    if (this.file instanceof Uint8Array) {
      return this.file.slice(offset, offset + size);
    }

    // Handle browser File objects
    if (this.file instanceof File) {
      const blob = this.file.slice(offset, offset + size);
      const buffer = await blob.arrayBuffer();
      return new Uint8Array(buffer);
    }

    // Handle Node.js file paths
    if (typeof this.file === "string" && isNode) {
      try {
        const fs = await import("fs/promises");

        // Open file handle if needed
        if (!this.fileHandle) {
          this.fileHandle = await fs.open(this.file, "r");
        }

        // Create buffer for the read
        const buffer = new Uint8Array(size);

        // Read from file at offset
        const { bytesRead } = await this.fileHandle.read(buffer, 0, size, offset);

        // If we didn't read enough bytes, something went wrong
        if (bytesRead !== size) {
          throw new Error(`Expected to read ${size} bytes but got ${bytesRead}`);
        }

        return buffer;
      } catch (error) {
        console.error("Error reading file:", error);
        throw error;
      }
    }

    throw new Error("Unsupported file source type");
  }

  // Clean up resources when done
  async close(): Promise<void> {
    if (this.fileHandle) {
      await this.fileHandle.close();
      this.fileHandle = null;
    }
  }
}
