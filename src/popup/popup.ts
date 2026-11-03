import type { BackgroundRequest } from "../bridge/message-schema";
import { readSettings } from "../core/settings";
import type { SessionStats, Settings } from "../core/types";

function element<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`Missing popup element: ${id}`);
  return found as T;
}

const enabled = element<HTMLInputElement>("enabled");
const xmd = element<HTMLInputElement>("xmd");
const glow = element<HTMLInputElement>("glow");
const shown = element("shown");
const missed = element("missed");
const clear = element<HTMLButtonElement>("clear");
const copy = element<HTMLButtonElement>("copy");

async function renderStats(): Promise<void> {
  const { stats } = (await chrome.storage.session.get("stats")) as { stats?: Partial<SessionStats> };
  shown.textContent = String(stats?.shown ?? 0);
  missed.textContent = String(stats?.missed ?? 0);
}

async function init(): Promise<void> {
  // Makes it obvious whether a rebuilt extension has actually been reloaded.
  element("version").textContent = chrome.runtime.getManifest().version;
  const settings = await readSettings();
  enabled.checked = settings.enabled;
  xmd.checked = settings.useXmdFallback;
  glow.checked = settings.glowBorder;
  await renderStats();
  // The next frame paints the loaded values, so transitions start after that.
  requestAnimationFrame(() => document.body.classList.add("ready"));
}

enabled.addEventListener("change", () => {
  void chrome.storage.local.set({ enabled: enabled.checked } satisfies Partial<Settings>);
});

xmd.addEventListener("change", () => {
  void chrome.storage.local.set({ useXmdFallback: xmd.checked } satisfies Partial<Settings>);
});

glow.addEventListener("change", () => {
  void chrome.storage.local.set({ glowBorder: glow.checked } satisfies Partial<Settings>);
});

clear.addEventListener("click", () => {
  clear.disabled = true;
  void chrome.runtime
    .sendMessage({ type: "clear-cache" } satisfies BackgroundRequest)
    .then(renderStats)
    .finally(() => {
      clear.disabled = false;
    });
});

copy.addEventListener("click", () => {
  void chrome.storage.session.get("diagnostics").then(({ diagnostics }) => {
    const lines = Array.isArray(diagnostics) ? (diagnostics as string[]) : [];
    const report = [`X Country Withheld Viewer ${chrome.runtime.getManifest().version}`, ...lines].join("\n");
    return navigator.clipboard.writeText(report).then(() => {
      copy.textContent = `Copied ${lines.length} lines`;
    });
  });
});

void init();
