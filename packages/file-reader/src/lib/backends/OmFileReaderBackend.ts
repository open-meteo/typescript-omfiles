// OmFileReaderBackend.ts
export interface OmFileReaderBackend {
  /**
   * Get bytes from the backend at the specified offset and size
   * @param offset The offset in bytes from the start of the file
   * @param size The number of bytes to read
   * @param signal Optional AbortSignal to cancel the operation
   */
  getBytes(offset: number, size: number, signal?: AbortSignal): Promise<Uint8Array>;

  /**
   * Collects prefetch tasks for a given range without executing them.
   * Returns an array of functions that, when called, will fetch the data.
   * This allows the caller to control concurrency.
   * @param offset The offset in bytes from the start of the file
   * @param size The number of bytes to prefetch
   * @param signal Optional AbortSignal to cancel the operation
   */
  collectPrefetchTasks?(offset: number, size: number, signal?: AbortSignal): Promise<Array<() => Promise<void>>>;

  /**
   * Get the total size of the file in bytes
   * @param signal Optional AbortSignal to cancel the operation
   */
  count(signal?: AbortSignal): Promise<number>;

  /**
   * Close the backend and release any resources
   */
  close(): Promise<void>;
}
