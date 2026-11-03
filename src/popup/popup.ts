import type { BackgroundRequest } from "../bridge/message-schema";
import { copiedLines, type PopupKey, POPUP_TEXT } from "../core/i18n";
import { readSettings } from "../core/settings";
import type { Language, SessionStats, Settings } from "../core/types";

function element<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`Missing popup element: ${id}`);
  return found as T;
}

const enabled = element<HTMLInputElement>("enabled");
const xmd = element<HTMLInputElement>("xmd");
const glow = element<HTMLInputElement>("glow");
const languageTr = element<HTMLInputElement>("language-tr");
const languageEn = element<HTMLInputElement>("language-en");
const shown = element("shown");
const missed = element("missed");
const clear = element<HTMLButtonElement>("clear");
const copy = element<HTMLButtonElement>("copy");

let language: Language = "tr";

function renderTexts(): void {
  const texts = POPUP_TEXT[language];
  document.documentElement.lang = language;
  enabled.setAttribute("aria-label", texts.enabledLabel);
  for (const node of document.querySelectorAll<HTMLElement>("[data-i18n]")) {
    node.textContent = texts[node.dataset.i18n as PopupKey];
  }
}

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
  language = settings.language;
  languageTr.checked = language === "tr";
  languageEn.checked = language === "en";
  renderTexts();
  await renderStats();
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

for (const radio of [languageTr, languageEn]) {
  radio.addEventListener("change", () => {
    if (!radio.checked) return;
    language = radio.value === "en" ? "en" : "tr";
    renderTexts();
    void chrome.storage.local.set({ language } satisfies Partial<Settings>);
  });
}

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
      copy.textContent = copiedLines(lines.length, language);
    });
  });
});

void init().finally(() => {
  // The next frame paints the loaded values, so the page shows and animates only after that.
  requestAnimationFrame(() => document.body.classList.add("ready"));
});
