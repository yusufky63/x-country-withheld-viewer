import { DEFAULT_SETTINGS, type Settings } from "./types";

export async function readSettings(): Promise<Settings> {
  const stored = await chrome.storage.local.get({ ...DEFAULT_SETTINGS });
  return { ...DEFAULT_SETTINGS, ...stored };
}
