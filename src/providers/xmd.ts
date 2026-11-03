import { normalizeStatusList } from "../core/normalize";
import { type JsonFetcher, missFromHttp } from "./http";
import { outcomeFromProfile, outcomeFromStatus } from "./fxtwitter";
import type { Provider } from "./types";

const BASE = "https://mdfromx.com";

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export function createXmdProvider(fetchJson: JsonFetcher, now: () => number = Date.now): Provider {
  return {
    id: "xmd",
    async fetchStatus({ id, handle }) {
      // x.md resolves by ID, so `i` works when the tombstone text named no author.
      const response = await fetchJson(`${BASE}/${handle ?? "i"}/status/${id}?format=json`);
      if (response.status !== 200 || !isObject(response.json)) return missFromHttp(response);
      const posts = response.json.posts;
      const match: unknown = Array.isArray(posts) ? posts.find((post: unknown) => isObject(post) && post.id === id) : undefined;
      return outcomeFromStatus(match, id, "xmd", now());
    },
    async fetchProfile({ handle }) {
      const response = await fetchJson(`${BASE}/${handle}?format=json`);
      if (response.status !== 200 || !isObject(response.json)) return missFromHttp(response);
      return outcomeFromProfile(response.json.profile);
    },
    async fetchUserPosts({ handle, cursor }) {
      const query = new URLSearchParams({ format: "json" });
      if (cursor) query.set("cursor", cursor);
      const response = await fetchJson(`${BASE}/${handle}?${query}`);
      if (response.status !== 200 || !isObject(response.json)) return missFromHttp(response);
      const nextCursor = response.json.nextCursor;
      return {
        kind: "found",
        posts: normalizeStatusList(response.json.posts, "xmd", now()),
        ...(typeof nextCursor === "string" && nextCursor ? { nextCursor } : {}),
      };
    },
  };
}
