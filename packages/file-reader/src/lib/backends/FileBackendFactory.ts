import { FileBackend } from "./FileBackend";
import type { OmFileReaderBackend } from "./OmFileReaderBackend";

export async function createFileBackend(
  source: File | Blob | string | Uint8Array | ArrayBuffer
): Promise<OmFileReaderBackend> {
  const isNode = typeof process !== "undefined" && !!process.versions?.node;
  if (typeof source === "string") {
    if (isNode) {
      const { FileBackendNode } = await import("./FileBackendNode.js");
      return new FileBackendNode(source);
    } else {
      throw new Error("Reading from a string path is not supported in the browser");
    }
  }
  return new FileBackend(source as File | Blob | Uint8Array | ArrayBuffer);
}
