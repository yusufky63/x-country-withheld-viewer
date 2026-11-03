import { DEFAULT_SETTINGS, type Settings } from "./types";

export async function readSettings(): Promise<Settings> {
  const stored = await chrome.storage.local.get({ ...DEFAULT_SETTINGS });
  const settings = { ...DEFAULT_SETTINGS, ...stored };
  return { ...settings, language: settings.language === "en" ? "en" : "tr" };
}
