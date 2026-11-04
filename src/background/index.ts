import { isBackgroundRequest } from "../bridge/message-schema";
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
  getSettings: readSettings,
});

chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || !isBackgroundRequest(message)) return false;
  handle(message).then(sendResponse, () => sendResponse(null));
  return true;
});
