import { type JsonFetcher, parseRetryAfter, REQUEST_TIMEOUT_MS } from "../providers/http";
import type { GmRequest } from "./gm";

function parseJson(text: string | undefined): unknown {
  try {
    return JSON.parse(text ?? "");
  } catch {
    return null;
  }
}

function retryAfterHeader(headers: string | undefined): string | null {
  return headers?.match(/^retry-after:[ \t]*(.*?)\s*$/im)?.[1] ?? null;
}

/** A page's own fetch is bound by X's CSP, so the sources are reached through the manager. */
export function createGmJsonFetcher(request: GmRequest, timeoutMs = REQUEST_TIMEOUT_MS): JsonFetcher {
  return (url) =>
    new Promise((resolve) => {
      const failed = () => resolve({ status: 0, json: null });
      try {
        request({
          method: "GET",
          url,
          // Requests go out with no X cookies: only the post ID leaves.
          anonymous: true,
          timeout: timeoutMs,
          headers: { accept: "application/json" },
          onload(response) {
            const retryAfterMs = parseRetryAfter(retryAfterHeader(response.responseHeaders));
            resolve({ status: response.status, json: parseJson(response.responseText), ...(retryAfterMs === undefined ? {} : { retryAfterMs }) });
          },
          onerror: failed,
          ontimeout: failed,
          onabort: failed,
        });
      } catch {
        failed();
      }
    });
}
