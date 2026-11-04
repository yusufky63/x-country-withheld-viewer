import {
  CHANNEL,
  isResponseMessage,
  type MarksMessage,
  type PageRequest,
  type RequestMessage,
} from "./message-schema";
import { claimPage, RECOVERY_BUDGET_MS, startPageRuntime } from "./page-runtime";

declare const __EXTENSION_VERSION__: string;

const pending = new Map<string, (response: unknown) => void>();

function send(request: PageRequest, requestId: string = crypto.randomUUID()): void {
  window.postMessage(
    { channel: CHANNEL, direction: "to-content", type: "request", requestId, request } satisfies RequestMessage,
    location.origin,
  );
}

if (claimPage(window, `extension ${__EXTENSION_VERSION__}`)) {
  window.addEventListener("message", (event) => {
    if (event.source !== window || event.origin !== location.origin) return;
    if (isResponseMessage(event.data)) pending.get(event.data.requestId)?.(event.data.response);
  });

  startPageRuntime(window, {
    build: __EXTENSION_VERSION__,
    tell: (request) => send(request),
    ask: (request) =>
      new Promise((resolve) => {
        const requestId = crypto.randomUUID();
        // Nothing answers once the extension is reloaded under this page.
        const timer = setTimeout(() => pending.delete(requestId), RECOVERY_BUDGET_MS);
        pending.set(requestId, (response) => {
          clearTimeout(timer);
          pending.delete(requestId);
          resolve(response);
        });
        send(request, requestId);
      }),
    mark: (applied, failed, profiles) =>
      window.postMessage(
        { channel: CHANNEL, direction: "to-content", type: "marks", applied, failed, profiles } satisfies MarksMessage,
        location.origin,
      ),
  });
}
