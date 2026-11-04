import { DEFAULT_SETTINGS, type Settings } from "./types";

export function settingsFrom(stored: Partial<Settings>): Settings {
  const settings = { ...DEFAULT_SETTINGS, ...stored };
  return { ...settings, language: settings.language === "en" ? "en" : "tr" };
}

export async function readSettings(): Promise<Settings> {
  return settingsFrom(await chrome.storage.local.get({ ...DEFAULT_SETTINGS }));
}
