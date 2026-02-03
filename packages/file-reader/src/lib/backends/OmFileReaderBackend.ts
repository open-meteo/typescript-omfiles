// OmFileReaderBackend.ts
export interface OmFileReaderBackend {
  /**
   * Get bytes from the backend at the specified offset and size
   * @param offset The offset in bytes from the start of the file
   * @param size The number of bytes to read
   */
  getBytes(offset: number, size: number): Promise<Uint8Array>;

  /**
   * Get bytes from the end of file. Optional optimization for HTTP backends
   * to avoid a separate HEAD request when reading the trailer.
   * Returns data and file size in a single request.
   * @param size The number of bytes to read from the end
   */
  getBytesFromEnd?(size: number): Promise<{ data: Uint8Array; fileSize: number }>;

  /**
   * Collects prefetch tasks for a given range without executing them.
   * Returns an array of functions that, when called, will fetch the data.
   * This allows the caller to control concurrency.
   */
  collectPrefetchTasks?(offset: number, size: number): Promise<Array<() => Promise<void>>>;

  /**
   * Get the total size of the file in bytes
   */
  count(): Promise<number>;

  /**
   * Close the backend and release any resources
   */
  close(): Promise<void>;
}
