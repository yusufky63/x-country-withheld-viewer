import type { BackgroundRequest } from "../bridge/message-schema";
import type { Settings } from "../core/types";
import { createFxTwitterProvider } from "../providers/fxtwitter";
import type { JsonFetcher } from "../providers/http";
import { createXmdProvider } from "../providers/xmd";
import { DiagnosticsLog } from "./diagnostics-log";
import { ProviderRouter } from "./provider-router";
import { type KeyValueStore, ResultCache } from "./result-cache";

export interface RecoveryServiceDeps {
  fetchJson: JsonFetcher;
  store: KeyValueStore;
  getSettings: () => Promise<Settings>;
}

/** Answers the page's requests. The extension runs it in its worker, the userscript beside the page. */
export function createRecoveryService({ fetchJson, store, getSettings }: RecoveryServiceDeps) {
  const router = new ProviderRouter({
    providers: [createFxTwitterProvider(fetchJson), createXmdProvider(fetchJson)],
    cache: new ResultCache(store),
    getSettings,
  });
  const diagnostics = new DiagnosticsLog(store);

  return (request: BackgroundRequest): Promise<unknown> => {
    switch (request.type) {
      case "is-enabled":
        return getSettings().then(({ enabled }) => ({ enabled }));
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
  };
}
