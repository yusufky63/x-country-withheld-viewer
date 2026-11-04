import { copiedLines, MENU_TEXT, POPUP_TEXT } from "../core/i18n";
import { settingsFrom } from "../core/settings";
import { DEFAULT_SETTINGS, type Settings } from "../core/types";
import type { GmGetValue, GmMenuId } from "./gm";

const SETTING_KEYS = Object.keys(DEFAULT_SETTINGS) as Array<keyof Settings>;
const TOGGLES = [
  ["enabled", "enabledLabel"],
  ["useXmdFallback", "xmd"],
  ["glowBorder", "glow"],
] as const;

export function readGmSettings(getValue: GmGetValue): Settings {
  return settingsFrom(Object.fromEntries(SETTING_KEYS.map((key) => [key, getValue(key, DEFAULT_SETTINGS[key])])));
}

export interface MenuDeps {
  getValue: GmGetValue;
  setValue(key: string, value: unknown): void;
  register(label: string, run: () => void, options: { id?: GmMenuId }): GmMenuId;
  onValueChange(key: string, listener: (key: string, before: unknown, after: unknown, remote: boolean) => void): unknown;
  copy(text: string): void;
  /** Settings that the marker on this page has to follow at once. */
  apply(settings: Settings): void;
  clearResults(): Promise<unknown>;
  diagnostics(): Promise<string[]>;
}

/** A userscript has no popup, so the manager's own menu carries the same settings. */
export function createSettingsMenu(deps: MenuDeps): { refresh(): void } {
  const ids = new Map<string, GmMenuId>();
  let copyLabel: string | null = null;

  function item(key: string, label: string, run: () => void): void {
    const id = ids.get(key);
    // Passing the earlier ID updates that entry, so the menu keeps its order.
    ids.set(key, deps.register(label, run, id === undefined ? {} : { id }));
  }

  function refresh(): void {
    const settings = readGmSettings(deps.getValue);
    deps.apply(settings);
    const texts = POPUP_TEXT[settings.language];
    const words = MENU_TEXT[settings.language];
    for (const [key, textKey] of TOGGLES) {
      item(key, `${texts[textKey]}: ${settings[key] ? words.on : words.off}`, () => {
        deps.setValue(key, !readGmSettings(deps.getValue)[key]);
        refresh();
      });
    }
    item("language", `${texts.language}: ${words.languageName}`, () => {
      deps.setValue("language", readGmSettings(deps.getValue).language === "tr" ? "en" : "tr");
      refresh();
    });
    item("clear", texts.clear, () => void deps.clearResults());
    item("copy", copyLabel ?? texts.copy, () => {
      void deps.diagnostics().then((lines) => {
        deps.copy(lines.join("\n"));
        copyLabel = copiedLines(Math.max(0, lines.length - 1), readGmSettings(deps.getValue).language);
        refresh();
        copyLabel = null;
      });
    });
  }

  // A change made in another tab has to reach this tab's marker and menu too.
  for (const key of SETTING_KEYS) {
    deps.onValueChange(key, (_key, _before, _after, remote) => {
      if (remote) refresh();
    });
  }

  return { refresh };
}
