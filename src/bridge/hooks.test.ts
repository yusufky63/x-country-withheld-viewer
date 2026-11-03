import { describe, expect, it, vi } from "vitest";
import { type BodyRewriter, installFetchHook, parseGraphqlRequest, parseRestUserRequest } from "./hooks";

const BASE = "https://x.com/home";

describe("parseGraphqlRequest", () => {
  it("reads the classic client's endpoint", () => {
    const variables = encodeURIComponent(JSON.stringify({ focalTweetId: "1" }));
    expect(parseGraphqlRequest(`/i/api/graphql/qpemjmVMoTWDvcRT43JIVQ/TweetDetail?variables=${variables}`, null, BASE)).toEqual({
      operation: "TweetDetail",
      variables: { focalTweetId: "1" },
    });
  });

  it("reads the Relay client's endpoint", () => {
    expect(parseGraphqlRequest("https://api.x.com/graphql/K0klVZsDs4_0U-mfdqbklw/TweetResultByRestId", null, BASE)).toEqual({
      operation: "TweetResultByRestId",
      variables: {},
    });
  });

  it("reads variables from a POST body", () => {
    const body = JSON.stringify({ variables: { tweetId: "9" } });
    expect(parseGraphqlRequest("https://x.com/i/api/graphql/abc/TweetResultByRestId", body, BASE)?.variables).toEqual({ tweetId: "9" });
  });

  it("ignores everything else", () => {
    expect(parseGraphqlRequest("https://x.com/i/api/1.1/account/settings.json", null, BASE)).toBeNull();
    expect(parseGraphqlRequest("https://api.x.com/1.1/graphql/app_context.json", null, BASE)).toBeNull();
    expect(parseGraphqlRequest("http://[bad", null, BASE)).toBeNull();
  });

  it("survives malformed variables", () => {
    expect(parseGraphqlRequest("/graphql/a/Op?variables=%7Bnot-json", null, BASE)?.variables).toEqual({});
  });
});

function fakeWindow(response: Response) {
  const nativeFetch = vi.fn(async () => response);
  const win = { fetch: nativeFetch, location: { href: BASE } } as unknown as Window & typeof globalThis;
  return { win, nativeFetch };
}

function rewriterReturning(next: string, takesOverErrors = false): BodyRewriter {
  return { rewrite: vi.fn(async () => next), takesOverErrors: vi.fn(() => takesOverErrors), watchesRestUsers: vi.fn(() => false) };
}

const GRAPHQL_URL = "https://x.com/i/api/graphql/abc/TweetDetail";

describe("parseRestUserRequest", () => {
  it("reads the REST endpoints that return whole users", () => {
    expect(parseRestUserRequest("/i/api/1.1/friends/following/list.json?count=20", BASE)?.operation).toBe("rest:friends/following/list");
    expect(parseRestUserRequest("https://x.com/i/api/1.1/users/lookup.json", BASE)?.operation).toBe("rest:users/lookup");
    expect(parseRestUserRequest("https://api.x.com/1.1/friendships/create.json", BASE)?.operation).toBe("rest:friendships/create");
  });

  it("leaves other endpoints alone, since reading a body waits for its end", () => {
    expect(parseRestUserRequest("/i/api/2/grok/add_response.json", BASE)).toBeNull();
    expect(parseRestUserRequest("/i/api/1.1/account/settings.json", BASE)).toBeNull();
    expect(parseRestUserRequest("/i/api/graphql/abc/UserByScreenName", BASE)).toBeNull();
  });
});

describe("installFetchHook", () => {
  it("reads REST user responses only while there is an account to protect", async () => {
    const url = "https://x.com/i/api/1.1/friends/following/list.json";
    const idle = rewriterReturning("changed");
    const first = fakeWindow(new Response("body"));
    installFetchHook(first.win, idle);
    await first.win.fetch(url);
    expect(idle.rewrite).not.toHaveBeenCalled();

    const watching = { ...rewriterReturning("changed"), watchesRestUsers: () => true };
    const second = fakeWindow(new Response("body"));
    installFetchHook(second.win, watching);
    await expect((await second.win.fetch(url)).text()).resolves.toBe("changed");
  });

  it("does not read anything outside GraphQL", async () => {
    const original = new Response("hello");
    const { win } = fakeWindow(original);
    const rewriter = rewriterReturning("changed");
    installFetchHook(win, rewriter);
    await expect(win.fetch("https://x.com/other")).resolves.toBe(original);
    expect(rewriter.rewrite).not.toHaveBeenCalled();
  });

  it("returns X's own response object when nothing changed", async () => {
    const original = new Response("same");
    const { win } = fakeWindow(original);
    installFetchHook(win, rewriterReturning("same"));
    await expect(win.fetch(GRAPHQL_URL)).resolves.toBe(original);
  });

  it("swaps the body and drops the now wrong length header", async () => {
    const { win } = fakeWindow(new Response("old", { status: 200, headers: { "content-length": "3", "x-keep": "1" } }));
    installFetchHook(win, rewriterReturning("a longer body"));
    const response = await win.fetch(GRAPHQL_URL);
    await expect(response.text()).resolves.toBe("a longer body");
    expect(response.headers.get("content-length")).toBeNull();
    expect(response.headers.get("x-keep")).toBe("1");
  });

  it("leaves errors alone by default", async () => {
    const original = new Response("nope", { status: 403 });
    const { win } = fakeWindow(original);
    const rewriter = rewriterReturning("changed");
    installFetchHook(win, rewriter);
    await expect(win.fetch(GRAPHQL_URL)).resolves.toBe(original);
    expect(rewriter.rewrite).not.toHaveBeenCalled();
  });

  it("replaces an error when the rewriter takes it over", async () => {
    const { win } = fakeWindow(new Response("bad cursor", { status: 400 }));
    installFetchHook(win, rewriterReturning('{"data":{}}', true));
    const response = await win.fetch(GRAPHQL_URL);
    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe('{"data":{}}');
  });

  it("keeps X working if the rewriter throws", async () => {
    const original = new Response("fine");
    const { win } = fakeWindow(original);
    installFetchHook(win, { rewrite: vi.fn(async () => Promise.reject(new Error("boom"))), takesOverErrors: () => false, watchesRestUsers: () => false });
    await expect(win.fetch(GRAPHQL_URL)).resolves.toBe(original);
  });

  it("accepts Request and URL inputs like the native function", async () => {
    const { win, nativeFetch } = fakeWindow(new Response("x"));
    const rewriter = rewriterReturning("x");
    installFetchHook(win, rewriter);
    await win.fetch(new URL(GRAPHQL_URL));
    await win.fetch(new Request(GRAPHQL_URL));
    expect(nativeFetch).toHaveBeenCalledTimes(2);
    expect(rewriter.rewrite).toHaveBeenCalledTimes(2);
  });
});
