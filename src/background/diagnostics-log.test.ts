import { describe, expect, it } from "vitest";
import { DIAGNOSTICS_KEY, DiagnosticsLog } from "./diagnostics-log";
import type { KeyValueStore } from "./result-cache";

function memoryStore(initial: Record<string, unknown> = {}): KeyValueStore & { data: Map<string, unknown> } {
  const data = new Map(Object.entries(initial));
  return {
    data,
    get: async (key) => data.get(key),
    getAll: async () => Object.fromEntries(data),
    set: async (key, value) => void data.set(key, value),
    remove: async (keys) => keys.forEach((key) => data.delete(key)),
    clear: async () => data.clear(),
  };
}

describe("DiagnosticsLog", () => {
  it("keeps the most recent lines only", async () => {
    const store = memoryStore();
    const log = new DiagnosticsLog(store);
    for (let index = 0; index < 70; index += 1) await log.append(`line ${index}`);
    const lines = store.data.get(DIAGNOSTICS_KEY) as string[];
    expect(lines).toHaveLength(60);
    expect(lines[0]).toBe("line 10");
    expect(lines.at(-1)).toBe("line 69");
  });

  it("continues after a service worker restart", async () => {
    const store = memoryStore({ [DIAGNOSTICS_KEY]: ["before"] });
    await new DiagnosticsLog(store).append("after");
    expect(store.data.get(DIAGNOSTICS_KEY)).toEqual(["before", "after"]);
  });

  it("starts over after a reset", async () => {
    const store = memoryStore({ [DIAGNOSTICS_KEY]: ["old"] });
    const log = new DiagnosticsLog(store);
    log.reset();
    await log.append("new");
    expect(store.data.get(DIAGNOSTICS_KEY)).toEqual(["new"]);
  });
});
