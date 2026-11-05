import { isBackgroundRequest } from "../bridge/message-schema";
import { applyConsent, readConsent } from "../core/consent";
import { readSettings } from "../core/settings";
import { createJsonFetcher } from "../providers/http";
import { createRecoveryService } from "./recovery-service";
import type { KeyValueStore } from "./result-cache";

// Session storage lives in memory and survives service worker restarts, so recovered
// text is never written to disk and disappears when the browser closes.
const sessionStore: KeyValueStore = {
  async get(key) {
    return (await chrome.storage.session.get(key))[key];
  },
  getAll: () => chrome.storage.session.get(null),
  set: (key, value) => chrome.storage.session.set({ [key]: value }),
  remove: (keys) => chrome.storage.session.remove(keys),
  clear: () => chrome.storage.session.clear(),
};

const handle = createRecoveryService({
  fetchJson: createJsonFetcher(),
  store: sessionStore,
  getSettings: async () => applyConsent(await readSettings(), await readConsent()),
});

// The extension does nothing until the user answers, so the question cannot wait for them
// to find the toolbar icon. A no is final until they change it in the popup.
chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason !== "install" && reason !== "update") return;
  void readConsent().then((consent) => {
    if (!consent) void chrome.tabs.create({ url: "popup.html?welcome" });
  });
});

chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || !isBackgroundRequest(message)) return false;
  handle(message).then(sendResponse, () => sendResponse(null));
  return true;
});
