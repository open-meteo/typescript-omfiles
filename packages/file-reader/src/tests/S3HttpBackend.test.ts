import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { S3HttpBackend, S3HttpBackendError } from "../lib/backends/S3HttpBackend";

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe("S3HttpBackend", () => {
  let backend: S3HttpBackend;
  const testUrl = "https://blubblub.com/test-file.om";

  beforeEach(() => {
    vi.clearAllMocks();
    backend = new S3HttpBackend({ url: testUrl, debug: false});
  });

  afterEach(async () => {
    await backend.close();
  });

  describe("count()", () => {
    it("should fetch file size using HEAD request", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: {
          get: (name: string) => {
            const headers: Record<string, string> = {
              "content-length": "1024",
              "etag": '"abc123"',
              "last-modified": "Wed, 21 Oct 2015 07:28:00 GMT",
            };
            return headers[name.toLowerCase()] || null;
          },
        },
      });

      const size = await backend.count();
      expect(size).toBe(1024);
      expect(mockFetch).toHaveBeenCalledWith(testUrl, {
        method: "HEAD",
        signal: expect.any(AbortSignal),
      });
    });

    it("should cache file size after first request", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: {
          get: (name: string) => {
            const headers: Record<string, string> = {
              "content-length": "2048",
            };
            return headers[name.toLowerCase()] || null;
          },
        },
      });

      const size1 = await backend.count();
      const size2 = await backend.count();

      expect(size1).toBe(2048);
      expect(size2).toBe(2048);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("should throw error when Content-Length header is missing", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        headers: {
          get: () => null,
        },
      });

      await expect(backend.count()).rejects.toThrow(S3HttpBackendError);
      await expect(backend.count()).rejects.toThrow("Content-Length header missing");
    });

    it("should throw error for 404 responses", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        headers: {
          get: () => null,
        },
      });

      await expect(backend.count()).rejects.toThrow(S3HttpBackendError);
      await expect(backend.count()).rejects.toThrow("File not found");
    });

    it("should throw error for other HTTP errors", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        headers: {
          get: () => null,
        },
      });

      await expect(backend.count()).rejects.toThrow(S3HttpBackendError);
      await expect(backend.count()).rejects.toThrow("HTTP error: 500");
    });
  });

  describe("getBytes()", () => {
    beforeEach(async () => {
      // Mock HEAD request for metadata
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: {
          get: (name: string) => {
            const headers: Record<string, string> = {
              "content-length": "1024",
              "etag": '"abc123"',
              "last-modified": "Wed, 21 Oct 2015 07:28:00 GMT",
            };
            return headers[name.toLowerCase()] || null;
          },
        },
      });
      await backend.count(); // Initialize metadata
      vi.clearAllMocks();
    });

    it("should make range request with correct headers", async () => {
      const testData = new Uint8Array([1, 2, 3, 4, 5]);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 206,
        headers: {
          get: () => null,
        },
        arrayBuffer: () => Promise.resolve(testData.buffer),
      });

      const result = await backend.getBytes(10, 5);

      expect(result).toEqual(testData);
      expect(mockFetch).toHaveBeenCalledWith(testUrl, {
        headers: {
          Range: "bytes=10-14",
          "If-Unmodified-Since": "Wed, 21 Oct 2015 07:28:00 GMT",
          "If-Match": '"abc123"',
        },
        signal: expect.any(AbortSignal),
      });
    });

    it("should handle requests without ETag and Last-Modified", async () => {
      // Reset backend without metadata
      await backend.close();
      backend = new S3HttpBackend({ url: testUrl });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: {
          get: (name: string) => {
            const headers: Record<string, string> = {
              "content-length": "1024",
            };
            return headers[name.toLowerCase()] || null;
          },
        },
      });
      await backend.count();
      vi.clearAllMocks();

      const testData = new Uint8Array([1, 2, 3]);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 206,
        headers: {
          get: () => null,
        },
        arrayBuffer: () => Promise.resolve(testData.buffer),
      });

      await backend.getBytes(0, 3);

      expect(mockFetch).toHaveBeenCalledWith(testUrl, {
        headers: {
          Range: "bytes=0-2",
        },
        signal: expect.any(AbortSignal),
      });
    });

    it("should validate input parameters", async () => {
      await expect(backend.getBytes(-1, 5)).rejects.toThrow("Invalid offset or size");
      await expect(backend.getBytes(0, 0)).rejects.toThrow("Invalid offset or size");
      await expect(backend.getBytes(0, -1)).rejects.toThrow("Invalid offset or size");
    });

    it("should validate range against file size", async () => {
      await expect(backend.getBytes(1020, 10)).rejects.toThrow(
        "Requested range (1020:1030) exceeds file size (1024)"
      );
    });

    it("should handle 416 Range Not Satisfiable error", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 416,
        headers: {
          get: () => null,
        },
      });

      await expect(backend.getBytes(0, 5)).rejects.toThrow("Range not satisfiable");
    });

    it("should handle 412 Precondition Failed error", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 412,
        headers: {
          get: () => null,
        },
      });

      await expect(backend.getBytes(0, 5)).rejects.toThrow(
        "Precondition failed - file may have been modified"
      );
    });

    it("should validate response data length", async () => {
      const testData = new Uint8Array([1, 2, 3]); // Only 3 bytes
      mockFetch.mockResolvedValue({
        ok: true,
        status: 206,
        headers: {
          get: () => null,
        },
        arrayBuffer: () => Promise.resolve(testData.buffer),
      });

      await expect(backend.getBytes(0, 5)).rejects.toThrow("Received 3 bytes, expected 5");
    });
  });

  describe("retry logic", () => {
    it("should retry on server errors", async () => {
      const backend = new S3HttpBackend({ url: testUrl, retries: 2, debug: false });

      // First call fails with 500, second succeeds
      mockFetch
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
          headers: {
            get: () => null,
          },
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: {
            get: (name: string) => {
              const headers: Record<string, string> = {
                "content-length": "1024",
              };
              return headers[name.toLowerCase()] || null;
            },
          },
        });

      const size = await backend.count();
      expect(size).toBe(1024);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it("should not retry on client errors", async () => {
      const backend = new S3HttpBackend({ url: testUrl, retries: 2 });

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        headers: {
          get: () => null,
        },
      });

      await expect(backend.count()).rejects.toThrow("File not found");
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("should eventually fail after max retries", async () => {
      const backend = new S3HttpBackend({ url: testUrl, retries: 2 });

      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        headers: {
          get: () => null,
        },
      });

      await expect(backend.count()).rejects.toThrow("HTTP error: 500");
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });

  describe("timeout handling", () => {
    it("should timeout long requests", async () => {

      const backend = new S3HttpBackend({ url: testUrl, timeoutMs: 100, retries: 0});

      mockFetch.mockImplementation(() => {
        return new Promise((resolve) => {
          setTimeout(() => {
            resolve({
              ok: true,
              status: 200,
              headers: {
                get: (name: string) => {
                  const headers: Record<string, string> = {
                    "content-length": "1024",
                    "etag": '"version1"',
                    "last-modified": "Wed, 21 Oct 2015 07:28:00 GMT",
                  };
                  return headers[name.toLowerCase()] || null;
                },
              },
            });
          }, 250);
        });
      });

      await expect(backend.count()).rejects.toThrow("Request timeout");
    });
  });

  describe("cacheKey", () => {
    it("should generate different cache keys for different URLs", async () => {
      const backend1 = new S3HttpBackend({ url: "https://example.com/file1.om" });
      const backend2 = new S3HttpBackend({ url: "https://example.com/file2.om" });

      expect(backend1.cacheKey).not.toBe(backend2.cacheKey);
    });

    it("should include ETag and Last-Modified in cache key", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: {
          get: (name: string) => {
            const headers: Record<string, string> = {
              "content-length": "1024",
              "etag": '"version1"',
              "last-modified": "Wed, 21 Oct 2015 07:28:00 GMT",
            };
            return headers[name.toLowerCase()] || null;
          },
        },
      });

      const keyBefore = backend.cacheKey;
      await backend.count();
      const keyAfter = backend.cacheKey;

      expect(keyBefore).not.toBe(keyAfter);
    });
  });

  describe("close()", () => {
    it("should reset internal state", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: {
          get: (name: string) => {
            const headers: Record<string, string> = {
              "content-length": "1024",
            };
            return headers[name.toLowerCase()] || null;
          },
        },
      });

      await backend.count();
      await backend.close();

      // Should make new HEAD request after close
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: {
          get: (name: string) => {
            const headers: Record<string, string> = {
              "content-length": "2048",
            };
            return headers[name.toLowerCase()] || null;
          },
        },
      });

      const size = await backend.count();
      expect(size).toBe(2048);
    });
  });
});
