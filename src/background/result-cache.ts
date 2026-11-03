import type { SessionStats } from "../core/types";

export const POSITIVE_TTL_MS = 30 * 60_000;
export const NEGATIVE_TTL_MS = 5 * 60_000;
const MAX_ENTRIES = 400;
// Eviction reads the whole store, so it runs now and then rather than on every write.
const EVICT_EVERY_WRITES = 25;
const KEY_PREFIX = "cache:";
const STATS_KEY = "stats";

export interface KeyValueStore {
  get(key: string): Promise<unknown>;
  getAll(): Promise<Record<string, unknown>>;
  set(key: string, value: unknown): Promise<void>;
  remove(keys: string[]): Promise<void>;
  clear(): Promise<void>;
}

interface CacheEntry {
  value: unknown;
  expiresAt: number;
}

const isEntry = (value: unknown): value is CacheEntry =>
  typeof value === "object" && value !== null && "value" in value && "expiresAt" in value;

/**
 * Only ever an optimization: a storage failure, such as a full session quota, must
 * cost a repeat request at most and never the result the request just produced.
 */
export class ResultCache {
  readonly #store: KeyValueStore;
  readonly #now: () => number;
  #writes = 0;

  constructor(store: KeyValueStore, now: () => number = Date.now) {
    this.#store = store;
    this.#now = now;
  }

  async get<T>(key: string): Promise<T | undefined> {
    try {
      const entry = await this.#store.get(KEY_PREFIX + key);
      if (!isEntry(entry)) return undefined;
      if (entry.expiresAt > this.#now()) return entry.value as T;
      await this.#store.remove([KEY_PREFIX + key]);
    } catch {
      // Reads as a miss, so the source gets asked again.
    }
    return undefined;
  }

  async set(key: string, value: unknown, ttlMs: number): Promise<void> {
    try {
      await this.#store.set(KEY_PREFIX + key, { value, expiresAt: this.#now() + ttlMs } satisfies CacheEntry);
      this.#writes += 1;
      if (this.#writes % EVICT_EVERY_WRITES === 0) await this.#evict();
    } catch {
      await this.#dropEntries();
    }
  }

  async #evict(): Promise<void> {
    const all = await this.#store.getAll();
    const entries = Object.entries(all).filter(([key]) => key.startsWith(KEY_PREFIX));
    if (entries.length <= MAX_ENTRIES) return;
    const expiry = (value: unknown) => (isEntry(value) ? value.expiresAt : 0);
    const oldest = entries.sort((a, b) => expiry(a[1]) - expiry(b[1])).slice(0, entries.length - MAX_ENTRIES);
    await this.#store.remove(oldest.map(([key]) => key));
  }

  /** Frees the quota while keeping the session's counts and diagnostics. */
  async #dropEntries(): Promise<void> {
    try {
      const all = await this.#store.getAll();
      await this.#store.remove(Object.keys(all).filter((key) => key.startsWith(KEY_PREFIX)));
    } catch {
      // Storage is unavailable altogether, and the extension still works without it.
    }
  }

  async recordOutcome(shown: number, missed: number): Promise<void> {
    try {
      const stats = await this.readStats();
      await this.#store.set(STATS_KEY, {
        shown: stats.shown + shown,
        missed: stats.missed + missed,
      } satisfies SessionStats);
    } catch {
      // The popup's counters are not worth failing a recovery over.
    }
  }

  async readStats(): Promise<SessionStats> {
    const value = await this.#store.get(STATS_KEY);
    const stats = (typeof value === "object" && value !== null ? value : {}) as Partial<SessionStats>;
    return { shown: stats.shown ?? 0, missed: stats.missed ?? 0 };
  }

  clear(): Promise<void> {
    return this.#store.clear();
  }
}
