import type { BlockFetch } from "./BlockCache";
import { throwIfAborted } from "./utils";

interface Inflight {
  controller: AbortController;
  /** Callers still waiting on the fetch; it is cancelled once this drops to zero. */
  waiting: number;
  promise: Promise<Uint8Array>;
}

/**
 * Deduplicates concurrent fetches of the same key.
 *
 * A fetch runs under a signal of its own rather than under the signal of
 * whichever caller asked first: every caller waiting on it is counted, one
 * aborting only gives up its own claim, and the fetch is cancelled once the
 * last claim is gone. Two variables read from the same file share its index
 * blocks, so one of them being abandoned would otherwise fail the other.
 *
 * A fetch whose callers have all aborted is no longer joinable even while its
 * rejection is still in flight — the next caller starts a fresh one instead of
 * inheriting a cancellation it did not ask for.
 */
export class InflightFetches<K> {
  private readonly entries = new Map<K, Inflight>();

  get size(): number {
    return this.entries.size;
  }

  clear(): void {
    this.entries.clear();
  }

  async get(key: K, fetchFn: BlockFetch, signal?: AbortSignal): Promise<Uint8Array> {
    throwIfAborted(signal);

    let entry = this.entries.get(key);
    if (!entry) {
      const controller = new AbortController();
      const fresh: Inflight = { controller, waiting: 0, promise: fetchFn(controller.signal) };
      // Only forget what still belongs to this fetch: a cancelled one can have
      // been replaced by a fresh fetch before it settles
      const forget = () => {
        if (this.entries.get(key) === fresh) this.entries.delete(key);
      };
      void fresh.promise.then(forget, forget);
      this.entries.set(key, fresh);
      entry = fresh;
    }

    return this.join(key, entry, signal);
  }

  private async join(key: K, entry: Inflight, signal?: AbortSignal): Promise<Uint8Array> {
    entry.waiting += 1;
    const release = () => {
      entry.waiting -= 1;
      // A settled fetch has already been forgotten; there is nothing to cancel
      if (entry.waiting > 0 || this.entries.get(key) !== entry) return;
      this.entries.delete(key);
      entry.controller.abort();
    };

    if (!signal) {
      try {
        return await entry.promise;
      } finally {
        release();
      }
    }

    // Rejects as soon as the caller aborts, even though the fetch itself may
    // carry on for the other callers. `onAbort` is assigned synchronously by
    // the executor.
    let onAbort!: () => void;
    const abortedByCaller = new Promise<void>((resolve) => {
      onAbort = () => resolve();
      signal.addEventListener("abort", onAbort, { once: true });
    });
    try {
      await Promise.race([entry.promise, abortedByCaller]);
      throwIfAborted(signal);
      return await entry.promise;
    } finally {
      signal.removeEventListener("abort", onAbort);
      release();
    }
  }
}
