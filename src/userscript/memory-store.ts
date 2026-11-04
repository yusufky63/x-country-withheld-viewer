import type { KeyValueStore } from "../background/result-cache";

/**
 * Manager storage is written to disk and handed to the script on every page load, which is
 * the wrong place for recovered text. The cost is that a reload asks the sources again.
 */
export function createMemoryStore(): KeyValueStore {
  const entries = new Map<string, unknown>();
  return {
    get: async (key) => entries.get(key),
    getAll: async () => Object.fromEntries(entries),
    set: async (key, value) => {
      entries.set(key, value);
    },
    remove: async (keys) => {
      for (const key of keys) entries.delete(key);
    },
    clear: async () => {
      entries.clear();
    },
  };
}
