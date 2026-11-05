import { describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, type Settings } from "../core/types";
import { createRecoveryService } from "./recovery-service";
import type { KeyValueStore } from "./result-cache";

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

function service(settings: Settings) {
  const store = memoryStore();
  const fetchJson = vi.fn();
  return { store, fetchJson, handle: createRecoveryService({ fetchJson, store, getSettings: async () => settings }) };
}

describe("recovery service while switched off", () => {
  const off = { ...DEFAULT_SETTINGS, enabled: false };

  it("keeps no diagnostics, since they name page paths", async () => {
    const { store, handle } = service(off);
    await handle({ type: "log", line: "/some/path active" });
    expect(store.data.size).toBe(0);
  });

  it("asks no source", async () => {
    const { fetchJson, handle } = service(off);
    await handle({ type: "recover", items: [{ id: "1900000000000000002" }] });
    await handle({ type: "recover-profile", user: { id: "20", handle: "jack" } });
    await handle({ type: "user-posts", request: { id: "20", handle: "jack", withReplies: false } });
    await handle({ type: "conversation", request: { id: "1900000000000000002" } });
    expect(fetchJson).not.toHaveBeenCalled();
  });

  it("reports itself as off", async () => {
    await expect(service(off).handle({ type: "is-enabled" })).resolves.toEqual({ enabled: false });
  });
});

describe("recovery service while switched on", () => {
  it("keeps diagnostics", async () => {
    const { store, handle } = service(DEFAULT_SETTINGS);
    await handle({ type: "log", line: "/some/path active" });
    expect(store.data.size).toBeGreaterThan(0);
  });
});
