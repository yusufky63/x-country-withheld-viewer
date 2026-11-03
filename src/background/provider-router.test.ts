import { beforeEach, describe, expect, it, vi } from "vitest";
import withheld from "../core/__fixtures__/fx-status-withheld-reply.json";
import { normalizeStatus } from "../core/normalize";
import type { PostRecord, Settings } from "../core/types";
import type { PageOutcome, ProfileOutcome, Provider, ProviderOutcome } from "../providers/types";
import { MAX_CONCURRENT_REQUESTS, OUTAGE_COOLDOWN_MS, ProviderRouter, RATE_LIMIT_COOLDOWN_MS } from "./provider-router";
import { type KeyValueStore, NEGATIVE_TTL_MS, POSITIVE_TTL_MS, ResultCache } from "./result-cache";

const ID = "1900000000000000002";
const post = normalizeStatus(withheld.status, "fxtwitter", 0) as PostRecord;
const found: ProviderOutcome = { kind: "found", post };

function memoryStore(): KeyValueStore {
  const data = new Map<string, unknown>();
  return {
    get: async (key) => data.get(key),
    getAll: async () => Object.fromEntries(data),
    set: async (key, value) => void data.set(key, value),
    remove: async (keys) => keys.forEach((key) => data.delete(key)),
    clear: async () => data.clear(),
  };
}

function provider(id: Provider["id"], fetchStatus: Provider["fetchStatus"]): Provider {
  return {
    id,
    fetchStatus,
    fetchProfile: vi.fn(async (): Promise<ProfileOutcome> => ({ kind: "miss", status: "not_found" })),
    fetchUserPosts: vi.fn(async (): Promise<PageOutcome> => ({ kind: "found", posts: [post] })),
  };
}

describe("ProviderRouter", () => {
  let clock: number;
  let settings: Settings;
  const sleep = vi.fn(async () => {});

  function router(providers: Provider[]) {
    return new ProviderRouter({
      providers,
      cache: new ResultCache(memoryStore(), () => clock),
      getSettings: async () => settings,
      now: () => clock,
      sleep,
    });
  }

  beforeEach(() => {
    clock = 1_000_000;
    settings = { enabled: true, useXmdFallback: true, glowBorder: true };
    sleep.mockClear();
  });

  it("makes no request at all when switched off", async () => {
    const fx = vi.fn(async () => found);
    const results = await router([provider("fxtwitter", fx)]).recover([{ id: ID }]);
    expect(results).toHaveLength(1);
    settings.enabled = false;
    await expect(router([provider("fxtwitter", fx)]).recover([{ id: "2" }])).resolves.toEqual([{ id: "2", status: "disabled" }]);
    expect(fx).toHaveBeenCalledTimes(1);
  });

  it("falls through to x.md after a FxTwitter 404, since 404 proves nothing", async () => {
    const fx = vi.fn(async (): Promise<ProviderOutcome> => ({ kind: "miss", status: "not_found" }));
    const xmd = vi.fn(async (): Promise<ProviderOutcome> => ({ kind: "found", post: { ...post, source: "xmd" } }));
    const [result] = await router([provider("fxtwitter", fx), provider("xmd", xmd)]).recover([{ id: ID }]);
    expect(result).toMatchObject({ status: "found", post: { source: "xmd" } });
  });

  it("respects the x.md toggle", async () => {
    settings.useXmdFallback = false;
    const xmd = vi.fn(async () => found);
    const [result] = await router([
      provider("fxtwitter", async () => ({ kind: "miss", status: "not_found" })),
      provider("xmd", xmd),
    ]).recover([{ id: ID }]);
    expect(result?.status).toBe("not_found");
    expect(xmd).not.toHaveBeenCalled();
  });

  it("stops at a definite answer", async () => {
    const xmd = vi.fn(async () => found);
    const [result] = await router([
      provider("fxtwitter", async () => ({ kind: "miss", status: "private" })),
      provider("xmd", xmd),
    ]).recover([{ id: ID }]);
    expect(result?.status).toBe("private");
    expect(xmd).not.toHaveBeenCalled();
  });

  it("retries an outage twice with growing backoff, then cools down", async () => {
    const fx = vi.fn(async (): Promise<ProviderOutcome> => ({ kind: "miss", status: "provider_unavailable" }));
    const instance = router([provider("fxtwitter", fx)]);
    const [first] = await instance.recover([{ id: ID }]);
    expect(first?.status).toBe("provider_unavailable");
    expect(fx).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls).toEqual([[400], [800]]);

    await instance.recover([{ id: "2" }]);
    expect(fx).toHaveBeenCalledTimes(3);
    clock += OUTAGE_COOLDOWN_MS + 1;
    await instance.recover([{ id: "3" }]);
    expect(fx).toHaveBeenCalledTimes(6);
  });

  it("stops asking while rate limited, honoring Retry-After", async () => {
    const fx = vi.fn(async (): Promise<ProviderOutcome> => ({ kind: "miss", status: "rate_limited", retryAfterMs: 5_000 }));
    const instance = router([provider("fxtwitter", fx)]);
    await instance.recover([{ id: ID }]);
    const [second] = await instance.recover([{ id: "2" }]);
    expect(second?.status).toBe("rate_limited");
    expect(fx).toHaveBeenCalledTimes(1);
    clock += 5_001;
    await instance.recover([{ id: "3" }]);
    expect(fx).toHaveBeenCalledTimes(2);
  });

  it("uses the default cooldown without Retry-After", async () => {
    const fx = vi.fn(async (): Promise<ProviderOutcome> => ({ kind: "miss", status: "rate_limited" }));
    const instance = router([provider("fxtwitter", fx)]);
    await instance.recover([{ id: ID }]);
    clock += RATE_LIMIT_COOLDOWN_MS - 1;
    await instance.recover([{ id: "2" }]);
    expect(fx).toHaveBeenCalledTimes(1);
  });

  it("caches hits and misses for their own lifetimes", async () => {
    const fx = vi.fn(async (): Promise<ProviderOutcome> => found);
    const instance = router([provider("fxtwitter", fx)]);
    await instance.recover([{ id: ID }]);
    await instance.recover([{ id: ID }]);
    expect(fx).toHaveBeenCalledTimes(1);
    clock += POSITIVE_TTL_MS + 1;
    await instance.recover([{ id: ID }]);
    expect(fx).toHaveBeenCalledTimes(2);

    const missing = vi.fn(async (): Promise<ProviderOutcome> => ({ kind: "miss", status: "not_found" }));
    const other = router([provider("fxtwitter", missing)]);
    await other.recover([{ id: "9" }]);
    await other.recover([{ id: "9" }]);
    expect(missing).toHaveBeenCalledTimes(1);
    clock += NEGATIVE_TTL_MS + 1;
    await other.recover([{ id: "9" }]);
    expect(missing).toHaveBeenCalledTimes(2);
  });

  it("does not cache a transient failure", async () => {
    const fx = vi
      .fn<() => Promise<ProviderOutcome>>()
      .mockResolvedValueOnce({ kind: "miss", status: "rate_limited", retryAfterMs: 0 })
      .mockResolvedValueOnce(found);
    const instance = router([provider("fxtwitter", fx)]);
    expect((await instance.recover([{ id: ID }]))[0]?.status).toBe("rate_limited");
    clock += 1;
    expect((await instance.recover([{ id: ID }]))[0]?.status).toBe("found");
  });

  it("shares one request between simultaneous asks for the same post", async () => {
    const fx = vi.fn(async () => found);
    const instance = router([provider("fxtwitter", fx)]);
    await Promise.all([instance.recover([{ id: ID }]), instance.recover([{ id: ID }])]);
    expect(fx).toHaveBeenCalledTimes(1);
  });

  it("never runs more than the concurrency limit at once", async () => {
    let active = 0;
    let peak = 0;
    const fx = vi.fn(async (): Promise<ProviderOutcome> => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 1));
      active -= 1;
      return found;
    });
    const items = Array.from({ length: 8 }, (_, index) => ({ id: String(index + 1) }));
    await router([provider("fxtwitter", fx)]).recover(items);
    expect(peak).toBeLessThanOrEqual(MAX_CONCURRENT_REQUESTS);
  });

  it("still returns what it found when storage is full", async () => {
    const store = memoryStore();
    store.set = async () => Promise.reject(new Error("QUOTA_BYTES quota exceeded"));
    const instance = new ProviderRouter({
      providers: [provider("fxtwitter", async () => found)],
      cache: new ResultCache(store, () => clock),
      getSettings: async () => settings,
      now: () => clock,
      sleep,
    });
    await expect(instance.recover([{ id: ID }])).resolves.toMatchObject([{ id: ID, status: "found" }]);
  });

  it("clears cooldowns and cached results on request", async () => {
    const fx = vi.fn(async (): Promise<ProviderOutcome> => found);
    const instance = router([provider("fxtwitter", fx)]);
    await instance.recover([{ id: ID }]);
    await instance.clear();
    await instance.recover([{ id: ID }]);
    expect(fx).toHaveBeenCalledTimes(2);
  });

  it("skips a provider with no conversation support", async () => {
    const page = await router([provider("xmd", async () => found)]).conversation({ id: ID });
    expect(page).toEqual({ status: "provider_unavailable", posts: [] });
  });

  it("returns a posts page with its source", async () => {
    const page = await router([provider("fxtwitter", async () => found)]).userPosts({ id: "1", handle: "a", withReplies: false });
    expect(page).toMatchObject({ status: "found", source: "fxtwitter" });
    expect(page.posts).toHaveLength(1);
  });
});
