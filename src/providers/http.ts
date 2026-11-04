import type { Miss } from "./types";

export const REQUEST_TIMEOUT_MS = 10_000;

export interface JsonResponse {
  /** 0 means the request never completed: offline, DNS failure or timeout. */
  status: number;
  json: unknown;
  retryAfterMs?: number;
}

export type JsonFetcher = (url: string) => Promise<JsonResponse>;

export function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : undefined;
}

export function createJsonFetcher(fetchImpl: typeof fetch = fetch.bind(globalThis), timeoutMs = REQUEST_TIMEOUT_MS): JsonFetcher {
  return async (url) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      // Requests go out with no X cookies, tokens or referrer: only the post ID leaves.
      const response = await fetchImpl(url, {
        credentials: "omit",
        referrerPolicy: "no-referrer",
        headers: { accept: "application/json" },
        signal: controller.signal,
      });
      const retryAfterMs = parseRetryAfter(response.headers.get("retry-after"));
      const json: unknown = await response.json().catch(() => null);
      return { status: response.status, json, ...(retryAfterMs === undefined ? {} : { retryAfterMs }) };
    } catch {
      return { status: 0, json: null };
    } finally {
      clearTimeout(timer);
    }
  };
}

/** Maps a failed HTTP result. A 404 stays `not_found`: it does not prove deletion. */
export function missFromHttp(response: JsonResponse): Miss {
  if (response.status === 429) {
    return {
      kind: "miss",
      status: "rate_limited",
      ...(response.retryAfterMs === undefined ? {} : { retryAfterMs: response.retryAfterMs }),
    };
  }
  if (response.status === 401 || response.status === 403) return { kind: "miss", status: "private" };
  if (response.status === 404) return { kind: "miss", status: "not_found" };
  return { kind: "miss", status: "provider_unavailable" };
}
