import { OmFileReaderBackend } from "./OmFileReaderBackend";

export class FileBackend implements OmFileReaderBackend {
  private fileObj: File | Blob | null = null;
  private memory: Uint8Array | null = null;
  private fileSize: number = 0;

  constructor(source: File | Blob | Uint8Array | ArrayBuffer) {
    if (typeof File !== "undefined" && source instanceof File) {
      this.fileObj = source;
      this.fileSize = source.size;
    } else if (typeof Blob !== "undefined" && source instanceof Blob) {
      this.fileObj = source;
      this.fileSize = source.size;
    } else if (source instanceof ArrayBuffer) {
      this.memory = new Uint8Array(source);
      this.fileSize = this.memory.length;
    } else if (source instanceof Uint8Array) {
      this.memory = source;
      this.fileSize = source.length;
    } else {
      throw new Error("Unsupported file source type for browser FileBackend");
    }
  }

  async count(): Promise<number> {
    return this.fileSize;
  }

  async getBytes(offset: number, size: number): Promise<Uint8Array> {
    if (this.memory) {
      return this.memory.slice(offset, offset + size);
    }
    if (this.fileObj) {
      const blob = this.fileObj.slice(offset, offset + size);
      const buffer = await blob.arrayBuffer();
      return new Uint8Array(buffer);
    }
    throw new Error("No file or memory buffer available");
  }

  async prefetchData(_offset: number, _bytes: number): Promise<void> {
    // No-op for now!
  }

  async close(): Promise<void> {
    // Nothing to clean up in browser
  }
}
