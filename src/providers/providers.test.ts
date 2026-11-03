import { describe, expect, it, vi } from "vitest";
import profile from "../core/__fixtures__/fx-profile-withheld.json";
import withheld from "../core/__fixtures__/fx-status-withheld-reply.json";
import statuses from "../core/__fixtures__/fx-user-statuses.json";
import { createFxTwitterProvider } from "./fxtwitter";
import { createJsonFetcher, type JsonFetcher } from "./http";
import { createXmdProvider } from "./xmd";

const ID = "1900000000000000002";

function responding(status: number, json: unknown, retryAfterMs?: number): JsonFetcher {
  return vi.fn(async () => ({ status, json, ...(retryAfterMs === undefined ? {} : { retryAfterMs }) }));
}

describe("createJsonFetcher", () => {
  it("sends no credentials or referrer", async () => {
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 200 }));
    await createJsonFetcher(fetchImpl as unknown as typeof fetch)("https://api.fxtwitter.com/2/status/1");
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.fxtwitter.com/2/status/1",
      expect.objectContaining({ credentials: "omit", referrerPolicy: "no-referrer" }),
    );
  });

  it("reports a network failure as status 0", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("offline");
    });
    await expect(createJsonFetcher(fetchImpl as unknown as typeof fetch)("https://x")).resolves.toEqual({ status: 0, json: null });
  });

  it("reads Retry-After in seconds", async () => {
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 429, headers: { "retry-after": "30" } }));
    const result = await createJsonFetcher(fetchImpl as unknown as typeof fetch)("https://x");
    expect(result).toMatchObject({ status: 429, retryAfterMs: 30_000 });
  });

  it("times out instead of hanging", async () => {
    const fetchImpl = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_, reject) => {
          init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
        }),
    );
    await expect(createJsonFetcher(fetchImpl as unknown as typeof fetch, 5)("https://x")).resolves.toEqual({ status: 0, json: null });
  });
});

describe("FxTwitter provider", () => {
  it("returns the post when the source has it", async () => {
    const fetchJson = responding(200, withheld);
    const outcome = await createFxTwitterProvider(fetchJson).fetchStatus({ id: ID });
    expect(fetchJson).toHaveBeenCalledWith(`https://api.fxtwitter.com/2/status/${ID}`);
    expect(outcome).toMatchObject({ kind: "found", post: { id: ID, source: "fxtwitter" } });
  });

  it("does not accept a different post than the one asked for", async () => {
    const outcome = await createFxTwitterProvider(responding(200, withheld)).fetchStatus({ id: "1" });
    expect(outcome).toEqual({ kind: "miss", status: "not_found" });
  });

  it.each([
    ["deleted", "deleted"],
    ["suspended", "suspended"],
    ["private", "private"],
    ["unavailable", "not_found"],
  ])("maps a %s tombstone inside HTTP 200 to %s", async (reason, status) => {
    const body = { code: 200, status: { type: "tombstone", reason } };
    const outcome = await createFxTwitterProvider(responding(200, body)).fetchStatus({ id: ID });
    expect(outcome).toEqual({ kind: "miss", status });
  });

  it("refuses a protected author even when text is present", async () => {
    const body = { status: { ...withheld.status, author: { ...withheld.status.author, protected: true } } };
    const outcome = await createFxTwitterProvider(responding(200, body)).fetchStatus({ id: ID });
    expect(outcome).toEqual({ kind: "miss", status: "private" });
  });

  it.each([
    [404, "not_found"],
    [401, "private"],
    [429, "rate_limited"],
    [500, "provider_unavailable"],
    [0, "provider_unavailable"],
  ])("maps HTTP %i to %s and never to deleted", async (http, status) => {
    const outcome = await createFxTwitterProvider(responding(http, null)).fetchStatus({ id: ID });
    expect(outcome).toEqual({ kind: "miss", status });
  });

  it("looks profiles up by ID, which stayed reliable for withheld accounts", async () => {
    const fetchJson = responding(200, profile);
    const outcome = await createFxTwitterProvider(fetchJson).fetchProfile({ id: "1800000000000000003", handle: "BlockedSample" });
    expect(fetchJson).toHaveBeenCalledWith("https://api.fxtwitter.com/2/profile/id:1800000000000000003");
    expect(outcome).toMatchObject({ kind: "found", author: { handle: "BlockedSample", name: "Sample", blueVerified: true } });
  });

  it("refuses a protected profile", async () => {
    const body = { user: { ...profile.user, protected: true } };
    const outcome = await createFxTwitterProvider(responding(200, body)).fetchProfile({ id: "1", handle: "a" });
    expect(outcome).toEqual({ kind: "miss", status: "private" });
  });

  it("pages user posts and marks reposts", async () => {
    const fetchJson = responding(200, statuses);
    const outcome = await createFxTwitterProvider(fetchJson).fetchUserPosts({ id: "1", handle: "a", cursor: "C", withReplies: true });
    expect(fetchJson).toHaveBeenCalledWith("https://api.fxtwitter.com/2/profile/id:1/statuses?count=20&cursor=C&with_replies=1");
    expect(outcome).toMatchObject({ kind: "found", nextCursor: "BOTTOM_CURSOR" });
    if (outcome.kind !== "found") throw new Error("expected posts");
    expect(outcome.posts[0]?.repostedBy).toBeUndefined();
    expect(outcome.posts[1]?.repostedBy).toEqual({ handle: "BlockedSample", name: "Sample" });
  });

  it("reads conversation replies, and a failed later page stays a plain miss", async () => {
    const provider = createFxTwitterProvider(responding(200, { replies: [withheld.status], cursor: { bottom: "B" } }));
    await expect(provider.fetchConversation?.({ id: "1" })).resolves.toMatchObject({ kind: "found", nextCursor: "B" });
    const failing = createFxTwitterProvider(responding(404, null));
    await expect(failing.fetchConversation?.({ id: "1", cursor: "B" })).resolves.toEqual({ kind: "miss", status: "not_found" });
  });
});

describe("x.md provider", () => {
  it("picks the requested post out of the thread it returns", async () => {
    const fetchJson = responding(200, { posts: [{ id: "1" }, withheld.status] });
    const outcome = await createXmdProvider(fetchJson).fetchStatus({ id: ID, handle: "example_replier" });
    expect(fetchJson).toHaveBeenCalledWith(`https://mdfromx.com/example_replier/status/${ID}?format=json`);
    expect(outcome).toMatchObject({ kind: "found", post: { id: ID, source: "xmd" } });
  });

  it("falls back to `i` when the tombstone named no author", async () => {
    const fetchJson = responding(200, { posts: [] });
    await createXmdProvider(fetchJson).fetchStatus({ id: ID });
    expect(fetchJson).toHaveBeenCalledWith(`https://mdfromx.com/i/status/${ID}?format=json`);
  });

  it("reads profiles and pages by handle", async () => {
    const provider = createXmdProvider(responding(200, { profile: profile.user, posts: statuses.results, nextCursor: "N" }));
    await expect(provider.fetchProfile({ id: "1", handle: "BlockedSample" })).resolves.toMatchObject({ kind: "found" });
    await expect(provider.fetchUserPosts({ id: "1", handle: "BlockedSample", withReplies: false })).resolves.toMatchObject({
      kind: "found",
      nextCursor: "N",
    });
  });
});
