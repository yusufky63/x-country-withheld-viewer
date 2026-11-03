import { isBackgroundRequest, type BackgroundRequest } from "../bridge/message-schema";
import { readSettings } from "../core/settings";
import { createFxTwitterProvider } from "../providers/fxtwitter";
import { createJsonFetcher } from "../providers/http";
import { createXmdProvider } from "../providers/xmd";
import { DiagnosticsLog } from "./diagnostics-log";
import { ProviderRouter } from "./provider-router";
import { type KeyValueStore, ResultCache } from "./result-cache";

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

const fetchJson = createJsonFetcher();
const router = new ProviderRouter({
  providers: [createFxTwitterProvider(fetchJson), createXmdProvider(fetchJson)],
  cache: new ResultCache(sessionStore),
  getSettings: readSettings,
});

const diagnostics = new DiagnosticsLog(sessionStore);

function handle(request: BackgroundRequest): Promise<unknown> {
  switch (request.type) {
    case "is-enabled":
      return readSettings().then(({ enabled }) => ({ enabled }));
    case "log":
      return diagnostics.append(request.line);
    case "recover":
      return router.recover(request.items);
    case "recover-profile":
      return router.recoverProfile(request.user);
    case "user-posts":
      return router.userPosts(request.request);
    case "conversation":
      return router.conversation(request.request);
    case "clear-cache":
      diagnostics.reset();
      return router.clear();
  }
}

chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || !isBackgroundRequest(message)) return false;
  handle(message).then(sendResponse, () => sendResponse(null));
  return true;
});
