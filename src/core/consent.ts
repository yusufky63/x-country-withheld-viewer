import type { Settings } from "./types";

/**
 * The store requires a clear yes inside the extension before any user data is handled, so
 * until then it behaves as if switched off. No answer is kept apart from a no, so that an
 * update asks only the people who were never asked.
 */
export type Consent = "accepted" | "declined";

export function consentFrom(stored: unknown): Consent | undefined {
  return stored === "accepted" || stored === "declined" ? stored : undefined;
}

export function applyConsent(settings: Settings, consent: Consent | undefined): Settings {
  return consent === "accepted" ? settings : { ...settings, enabled: false };
}

export async function readConsent(): Promise<Consent | undefined> {
  const { consent } = (await chrome.storage.local.get("consent")) as { consent?: unknown };
  return consentFrom(consent);
}
