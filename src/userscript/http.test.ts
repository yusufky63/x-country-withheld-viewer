import { describe, expect, it, vi } from "vitest";
import type { GmRequestDetails } from "./gm";
import { createGmJsonFetcher } from "./http";

function fetcherWith(respond: (details: GmRequestDetails) => void) {
  const request = vi.fn(respond);
  return { request, fetchJson: createGmJsonFetcher(request, 1234) };
}

describe("createGmJsonFetcher", () => {
  it("leaves X's cookies behind and sets a timeout", async () => {
    const { request, fetchJson } = fetcherWith((details) => details.onload({ status: 200, responseText: "{}" }));
    await fetchJson("https://api.fxtwitter.com/2/status/1");
    expect(request.mock.calls[0]?.[0]).toMatchObject({ method: "GET", url: "https://api.fxtwitter.com/2/status/1", anonymous: true, timeout: 1234 });
  });

  it("returns the status and parsed body", async () => {
    const { fetchJson } = fetcherWith((details) => details.onload({ status: 200, responseText: '{"a":1}' }));
    await expect(fetchJson("u")).resolves.toEqual({ status: 200, json: { a: 1 } });
  });

  it("keeps the status when the body is not JSON", async () => {
    const { fetchJson } = fetcherWith((details) => details.onload({ status: 502, responseText: "<html>" }));
    await expect(fetchJson("u")).resolves.toEqual({ status: 502, json: null });
  });

  it("reads Retry-After out of the raw header block", async () => {
    const { fetchJson } = fetcherWith((details) =>
      details.onload({ status: 429, responseText: "", responseHeaders: "content-type: text/plain\r\nRetry-After: 7\r\n" }),
    );
    await expect(fetchJson("u")).resolves.toEqual({ status: 429, json: null, retryAfterMs: 7000 });
  });

  for (const event of ["onerror", "ontimeout", "onabort"] as const) {
    it(`reports ${event} as a request that never completed`, async () => {
      const { fetchJson } = fetcherWith((details) => details[event]());
      await expect(fetchJson("u")).resolves.toEqual({ status: 0, json: null });
    });
  }

  it("survives a manager that throws, as it does for a host it was not told about", async () => {
    const { fetchJson } = fetcherWith(() => {
      throw new Error("blocked");
    });
    await expect(fetchJson("u")).resolves.toEqual({ status: 0, json: null });
  });
});
