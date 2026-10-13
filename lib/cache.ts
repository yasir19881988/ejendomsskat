/**
 * Simpel in-memory cache med TTL (Time To Live).
 * Til produktion bør dette erstattes med Redis eller lignende.
 */

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

class Cache {
  private store = new Map<string, CacheEntry<unknown>>();
  private defaultTtlMs: number;

  constructor(defaultTtlMs = 5 * 60 * 1000) { // 5 minutter som standard
    this.defaultTtlMs = defaultTtlMs;
  }

  get<T>(key: string): T | null {
    const entry = this.store.get(key);
    if (!entry) return null;

    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return null;
    }

    return entry.value as T;
  }

  set<T>(key: string, value: T, ttlMs?: number): void {
    const ttl = ttlMs ?? this.defaultTtlMs;
    this.store.set(key, {
      value,
      expiresAt: Date.now() + ttl,
    });
  }

  delete(key: string): void {
    this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }

  // Ryd udløbne entries (kaldes periodisk)
  cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.store.entries()) {
      if (now > entry.expiresAt) {
        this.store.delete(key);
      }
    }
  }
}

// Singleton instance
export const cache = new Cache(10 * 60 * 1000); // 10 minutter default

// Start cleanup interval hvis vi er i server-miljø
if (typeof setInterval !== 'undefined') {
  setInterval(() => cache.cleanup(), 60 * 1000); // Ryd op hvert minut
}
