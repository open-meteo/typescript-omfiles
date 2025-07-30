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
  retries: number = 3
): Promise<Response> {
  let lastError: Error;

  function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    return Promise.race([
      promise,
      new Promise<T>((_, reject) =>
        setTimeout(() => reject(new Error(`Timeout after ${ms}ms`)), ms)
      ),
    ]);
  }

  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const response = await withTimeout(fetch(input, init), timeoutMs);
      if (response.status >= 500 && response.status < 600) {
        throw new Error(`Server error: ${response.status}`);
      }
      return response;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt < retries - 1) {
        const delay = Math.min(500 * Math.pow(2, attempt), 5000);
        console.debug(`Attempt ${attempt + 1} failed, retrying in ${delay}ms: ${lastError.message}`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  throw lastError!;
}

export async function runLimited<T>(tasks: (() => Promise<T>)[], limit: number): Promise<T[]> {
  const results: T[] = new Array(tasks.length);

  for (let i = 0; i < tasks.length; i += limit) {
    const batch = tasks.slice(i, i + limit);
    const batchResults = await Promise.all(batch.map(task => task()));

    for (let j = 0; j < batchResults.length; j++) {
      results[i + j] = batchResults[j];
    }
  }

  return results;
}
