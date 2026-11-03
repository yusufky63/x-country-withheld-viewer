import { describe, expect, it, vi } from "vitest";
import { type KeyValueStore, POSITIVE_TTL_MS, ResultCache } from "./result-cache";

function memoryStore(): KeyValueStore & { data: Map<string, unknown> } {
  const data = new Map<string, unknown>();
  return {
    data,
    get: async (key) => data.get(key),
    getAll: async () => Object.fromEntries(data),
    set: async (key, value) => void data.set(key, value),
    remove: async (keys) => keys.forEach((key) => data.delete(key)),
    clear: async () => data.clear(),
  };
}

describe("ResultCache", () => {
  it("returns a stored value until it expires", async () => {
    let clock = 1_000;
    const cache = new ResultCache(memoryStore(), () => clock);
    await cache.set("a", { found: true }, POSITIVE_TTL_MS);
    await expect(cache.get("a")).resolves.toEqual({ found: true });
    clock += POSITIVE_TTL_MS + 1;
    await expect(cache.get("a")).resolves.toBeUndefined();
  });

  it("survives a full quota by dropping cached entries and keeping the counters", async () => {
    const store = memoryStore();
    const cache = new ResultCache(store);
    await cache.recordOutcome(3, 1);
    await cache.set("old", 1, POSITIVE_TTL_MS);
    const realSet = store.set;
    store.set = vi.fn(async () => Promise.reject(new Error("QUOTA_BYTES quota exceeded")));

    await expect(cache.set("new", 2, POSITIVE_TTL_MS)).resolves.toBeUndefined();

    store.set = realSet;
    expect(store.data.has("cache:old")).toBe(false);
    await expect(cache.readStats()).resolves.toEqual({ shown: 3, missed: 1 });
  });

  it("treats unavailable storage as a miss rather than an error", async () => {
    const broken: KeyValueStore = {
      get: async () => Promise.reject(new Error("gone")),
      getAll: async () => Promise.reject(new Error("gone")),
      set: async () => Promise.reject(new Error("gone")),
      remove: async () => Promise.reject(new Error("gone")),
      clear: async () => Promise.reject(new Error("gone")),
    };
    const cache = new ResultCache(broken);
    await expect(cache.get("a")).resolves.toBeUndefined();
    await expect(cache.set("a", 1, 1_000)).resolves.toBeUndefined();
    await expect(cache.recordOutcome(1, 0)).resolves.toBeUndefined();
  });

  it("reads the whole store only now and then, and evicts the oldest", async () => {
    const store = memoryStore();
    const getAll = vi.spyOn(store, "getAll");
    let clock = 1_000;
    const cache = new ResultCache(store, () => clock);
    for (let index = 0; index < 425; index += 1) {
      clock += 1;
      await cache.set(`key-${index}`, index, POSITIVE_TTL_MS);
    }
    expect(getAll.mock.calls.length).toBeLessThan(20);
    expect(store.data.size).toBeLessThanOrEqual(400);
    expect(store.data.has("cache:key-424")).toBe(true);
    expect(store.data.has("cache:key-0")).toBe(false);
  });
});
