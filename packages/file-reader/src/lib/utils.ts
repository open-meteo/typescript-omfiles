/**
 * Throws the signal's abort reason if the signal has been aborted.
 * Uses the standard DOMException with name "AbortError" as fallback.
 */
export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw signal.reason ?? new DOMException("The operation was aborted", "AbortError");
  }
}

/**
 * FNV-1a 64-bit hash implementation
 */
export function fnv1aHash64(str: string): bigint {
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

/**
 * Fetch with exponential backoff retry on server-side errors (HTTP 5xx) and per-attempt timeout.
 */
export async function fetchRetry(
  input: RequestInfo,
  init?: RequestInit,
  timeoutMs: number = 5000,
  retries: number = 3,
  signal?: AbortSignal
): Promise<Response> {
  let lastError: Error;

  function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    return Promise.race([
      promise,
      new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`Timeout after ${ms}ms`)), ms)),
    ]);
  }

  for (let attempt = 0; attempt < retries; attempt++) {
    throwIfAborted(signal);
    try {
      const mergedInit: RequestInit = { ...init };
      if (signal) {
        mergedInit.signal = signal;
      }
      const response = await withTimeout(fetch(input, mergedInit), timeoutMs);
      if (response.status >= 500 && response.status < 600) {
        throw new Error(`Server error: ${response.status}`);
      }
      return response;
    } catch (error) {
      // If the signal was aborted, re-throw immediately without retrying
      throwIfAborted(signal);
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt < retries - 1) {
        const delay = Math.min(500 * Math.pow(2, attempt), 5000);
        console.debug(`Attempt ${attempt + 1} failed, retrying in ${delay}ms: ${lastError.message}`);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }
  throw lastError!;
}

export async function runLimited<T>(tasks: (() => Promise<T>)[], limit: number, signal?: AbortSignal): Promise<T[]> {
  const results: T[] = new Array(tasks.length);

  for (let i = 0; i < tasks.length; i += limit) {
    throwIfAborted(signal);
    const batch = tasks.slice(i, i + limit);
    const batchResults = await Promise.all(batch.map((task) => task()));

    for (let j = 0; j < batchResults.length; j++) {
      results[i + j] = batchResults[j];
    }
  }

  return results;
}
