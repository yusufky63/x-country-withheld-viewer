import { describe, expect, it } from "vitest";
import withheld from "../core/__fixtures__/fx-status-withheld-reply.json";
import { normalizeStatus } from "../core/normalize";
import type { PostRecord } from "../core/types";
import { isBackgroundRequest, isMarksMessage, isPageRequest, isProfileResult, isRecoveryResults, isRequestMessage, isSafePost } from "./message-schema";

const post = normalizeStatus(withheld.status, "fxtwitter", 0) as PostRecord;

describe("isSafePost", () => {
  it("accepts a real normalized post", () => {
    expect(isSafePost(post)).toBe(true);
  });

  it.each([
    ["a non-numeric ID", { ...post, id: "<img>" }],
    ["an avatar outside X's CDNs", { ...post, author: { ...post.author, avatarUrl: "https://evil.example/a.jpg" } }],
    ["a bad handle", { ...post, author: { ...post.author, handle: "a b" } }],
    ["a script link", { ...post, urls: [{ url: "javascript:alert(1)", expandedUrl: "javascript:alert(1)", displayUrl: "x", indices: [0, 1] }] }],
    ["foreign media", { ...post, media: [{ id: "1", type: "photo", url: "https://evil.example/x.jpg", width: 1, height: 1 }] }],
    ["a foreign video variant", { ...post, media: [{ id: "1", type: "video", url: "https://pbs.twimg.com/a.jpg", width: 1, height: 1, variants: [{ contentType: "video/mp4", url: "https://evil.example/v.mp4" }] }] }],
    ["an unknown source", { ...post, source: "evil" }],
    ["oversized text", { ...post, text: "x".repeat(100_001) }],
    ["an unsafe quote", { ...post, quote: { ...post, id: "bad" } }],
  ])("rejects %s, since the page channel can be forged", (_label, value) => {
    expect(isSafePost(value)).toBe(false);
  });
});

describe("request validation", () => {
  it("only lets numeric IDs reach the sources", () => {
    expect(isPageRequest({ type: "recover", items: [{ id: "123" }] })).toBe(true);
    expect(isPageRequest({ type: "recover", items: [{ id: "123/../../x" }] })).toBe(false);
    expect(isPageRequest({ type: "recover-profile", user: { id: "1", handle: "../x" } })).toBe(false);
  });

  it("caps how many posts one message can ask for", () => {
    const items = Array.from({ length: 101 }, () => ({ id: "1" }));
    expect(isPageRequest({ type: "recover", items })).toBe(false);
  });

  it("does not let the page world clear the cache", () => {
    expect(isPageRequest({ type: "clear-cache" })).toBe(false);
    expect(isBackgroundRequest({ type: "clear-cache" })).toBe(true);
    expect(isRequestMessage({ channel: "xcwv", direction: "to-content", type: "request", requestId: "a", request: { type: "clear-cache" } })).toBe(false);
  });

  it("ignores other extensions' messages", () => {
    expect(isRequestMessage({ channel: "other", direction: "to-content", type: "request", requestId: "a", request: { type: "recover", items: [] } })).toBe(false);
  });
});

describe("response validation", () => {
  it("requires a safe post on a found result", () => {
    expect(isRecoveryResults([{ id: "1", status: "found", post }])).toBe(true);
    expect(isRecoveryResults([{ id: "1", status: "found" }])).toBe(false);
    expect(isRecoveryResults([{ id: "1", status: "not_found" }])).toBe(true);
    expect(isRecoveryResults([{ id: "1", status: "made_up" }])).toBe(false);
  });

  it("requires a safe author on a found profile", () => {
    expect(isProfileResult({ status: "found", author: post.author, source: "fxtwitter" })).toBe(true);
    expect(isProfileResult({ status: "found", author: { ...post.author, avatarUrl: "http://evil.example" }, source: "fxtwitter" })).toBe(false);
    expect(isProfileResult({ status: "not_found" })).toBe(true);
  });

  it("validates marks", () => {
    const applied = { id: "1", handle: "a", createdAtMs: 1, source: "fxtwitter", kind: "withheld", quoted: false };
    const message = { channel: "xcwv", direction: "to-content", type: "marks", applied: [applied], failed: [], profiles: [] };
    expect(isMarksMessage(message)).toBe(true);
    expect(isMarksMessage({ ...message, applied: [{ ...applied, handle: "<b>" }] })).toBe(false);
    expect(isMarksMessage({ ...message, profiles: undefined })).toBe(false);
  });
});
