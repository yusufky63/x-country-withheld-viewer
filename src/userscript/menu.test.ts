import { describe, expect, it, vi } from "vitest";
import type { GmGetValue, GmMenuId } from "./gm";
import { createSettingsMenu, type MenuDeps, readGmSettings } from "./menu";

function setup(stored: Record<string, unknown> = {}) {
  const values = new Map(Object.entries(stored));
  const entries = new Map<GmMenuId, { label: string; run: () => void }>();
  const listeners = new Map<string, Parameters<MenuDeps["onValueChange"]>[1]>();
  let nextId = 1;
  const getValue = ((key, fallback) => (values.has(key) ? values.get(key) : fallback)) as GmGetValue;
  const deps = {
    getValue,
    setValue: (key: string, value: unknown) => void values.set(key, value),
    register(label: string, run: () => void, options: { id?: GmMenuId }) {
      const id = options.id ?? nextId++;
      entries.set(id, { label, run });
      return id;
    },
    onValueChange(key: string, listener: Parameters<MenuDeps["onValueChange"]>[1]) {
      listeners.set(key, listener);
    },
    copy: vi.fn(),
    apply: vi.fn(),
    clearResults: vi.fn(async () => {}),
    diagnostics: vi.fn(async () => ["header", "one", "two"]),
  } satisfies MenuDeps;
  const menu = createSettingsMenu(deps);
  menu.refresh();
  const labels = () => [...entries.values()].map((entry) => entry.label);
  const click = (start: string) => {
    const entry = [...entries.values()].find(({ label }) => label.startsWith(start));
    if (!entry) throw new Error(`No menu entry: ${start} in ${labels().join(", ")}`);
    entry.run();
  };
  return { deps, values, listeners, labels, click };
}

describe("readGmSettings", () => {
  it("falls back to the defaults, in Turkish", () => {
    expect(readGmSettings(((_key, fallback) => fallback) as GmGetValue)).toEqual({ enabled: true, useXmdFallback: true, glowBorder: true, language: "tr" });
  });

  it("treats an unknown language as Turkish", () => {
    const getValue = ((key, fallback) => (key === "language" ? "de" : fallback)) as GmGetValue;
    expect(readGmSettings(getValue).language).toBe("tr");
  });
});

describe("createSettingsMenu", () => {
  it("shows every popup setting in Turkish by default", () => {
    expect(setup().labels()).toEqual([
      "Gizlenen gönderileri göster: Açık",
      "x.md yedeği: Açık",
      "Parlayan kenarlık: Açık",
      "Dil: Türkçe",
      "Kurtarılan gönderileri temizle",
      "Tanı bilgisini kopyala",
    ]);
  });

  it("saves a toggle, applies it at once and updates its entry in place", () => {
    const { click, values, labels, deps } = setup();
    click("Parlayan kenarlık");
    expect(values.get("glowBorder")).toBe(false);
    expect(deps.apply).toHaveBeenLastCalledWith(expect.objectContaining({ glowBorder: false }));
    expect(labels()).toHaveLength(6);
    expect(labels()[2]).toBe("Parlayan kenarlık: Kapalı");
  });

  it("toggles back from the stored value, not the one it was built with", () => {
    const { click, values } = setup();
    click("Parlayan kenarlık");
    click("Parlayan kenarlık");
    expect(values.get("glowBorder")).toBe(true);
  });

  it("switches language for its own labels and the marker", () => {
    const { click, labels, deps } = setup();
    click("Dil");
    expect(labels()[0]).toBe("Show withheld posts: On");
    expect(labels()[3]).toBe("Language: English");
    expect(deps.apply).toHaveBeenLastCalledWith(expect.objectContaining({ language: "en" }));
    click("Language");
    expect(labels()[3]).toBe("Dil: Türkçe");
  });

  it("clears recovered posts", () => {
    const { click, deps } = setup();
    click("Kurtarılan");
    expect(deps.clearResults).toHaveBeenCalledOnce();
  });

  it("copies the diagnostics and counts their lines without the header", async () => {
    const { click, labels, deps } = setup();
    click("Tanı bilgisini");
    await vi.waitFor(() => expect(deps.copy).toHaveBeenCalledWith("header\none\ntwo"));
    await vi.waitFor(() => expect(labels()[5]).toBe("2 satır kopyalandı"));
  });

  it("follows a change made in another tab, and only that kind", () => {
    const { deps, listeners, values } = setup();
    deps.apply.mockClear();
    listeners.get("glowBorder")?.("glowBorder", true, false, false);
    expect(deps.apply).not.toHaveBeenCalled();
    values.set("glowBorder", false);
    listeners.get("glowBorder")?.("glowBorder", true, false, true);
    expect(deps.apply).toHaveBeenCalledWith(expect.objectContaining({ glowBorder: false }));
  });
});
