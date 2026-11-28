/** Lightweight in-memory singleflight request coalescer and bounded TTL cache for high-concurrency reads. */

export function createSingleflight() {
  const inFlight = new Map<string, Promise<unknown>>();

  async function run<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const existing = inFlight.get(key) as Promise<T> | undefined;
    if (existing) {
      return existing;
    }
    const promise = fn().finally(() => {
      if (inFlight.get(key) === promise) {
        inFlight.delete(key);
      }
    });
    inFlight.set(key, promise);
    return promise;
  }

  return {
    run,
    inFlightCount: () => inFlight.size,
  };
}

export class TtlCache<V> {
  private readonly store = new Map<string, { value: V; expiresAt: number }>();

  constructor(
    private readonly ttlMs: number,
    private readonly maxEntries = 200,
  ) {}

  get(key: string, nowMs: number = Date.now()): V | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (nowMs >= entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: string, value: V, nowMs: number = Date.now()): void {
    if (this.store.size >= this.maxEntries && !this.store.has(key)) {
      const oldestKey = this.store.keys().next().value;
      if (oldestKey !== undefined) {
        this.store.delete(oldestKey);
      }
    }
    this.store.set(key, { value, expiresAt: nowMs + this.ttlMs });
  }

  delete(key: string): void {
    this.store.delete(key);
  }

  deleteByPrefix(prefix: string): void {
    for (const key of this.store.keys()) {
      if (key.startsWith(prefix)) {
        this.store.delete(key);
      }
    }
  }

  clear(): void {
    this.store.clear();
  }

  size(): number {
    return this.store.size;
  }
}
