import { OmFileReaderBackend } from "./OmFileReaderBackend";
import fs from "node:fs/promises";

export class FileBackendNode implements OmFileReaderBackend {
  private filePath: string | null = null;
  private memory: Uint8Array | null = null;
  private fileSize: number = 0;
  private fileHandle: fs.FileHandle | null = null;

  constructor(source: string | Uint8Array | ArrayBuffer) {
    if (typeof source === "string") {
      this.filePath = source;
    } else if (source instanceof ArrayBuffer) {
      this.memory = new Uint8Array(source);
      this.fileSize = this.memory.length;
    } else if (source instanceof Uint8Array) {
      this.memory = source;
      this.fileSize = source.length;
    } else {
      throw new Error("Unsupported file source type for Node.js FileBackendNode");
    }
  }

  async count(): Promise<number> {
    if (this.memory) {
      return this.fileSize;
    }
    if (this.filePath) {
      if (this.fileSize > 0) return this.fileSize;
      const stats = await fs.stat(this.filePath);
      this.fileSize = stats.size;
      return this.fileSize;
    }
    throw new Error("Unable to determine file size");
  }

  async getBytes(offset: number, size: number): Promise<Uint8Array> {
    if (this.memory) {
      return this.memory.slice(offset, offset + size);
    }
    if (this.filePath) {
      if (!this.fileHandle) {
        this.fileHandle = await fs.open(this.filePath, "r");
      }
      const buffer = new Uint8Array(size);
      const { bytesRead } = await this.fileHandle.read(buffer, 0, size, offset);
      if (bytesRead !== size) {
        throw new Error(`Expected to read ${size} bytes but got ${bytesRead}`);
      }
      return buffer;
    }
    throw new Error("No file or memory buffer available");
  }

  // No collectPrefetchTasks - prefetching has minor effect

  async close(): Promise<void> {
    if (this.fileHandle) {
      await this.fileHandle.close();
      this.fileHandle = null;
    }
  }
}
