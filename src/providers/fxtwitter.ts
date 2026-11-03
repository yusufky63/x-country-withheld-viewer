import { isProtectedAuthor, normalizeAuthor, normalizeStatus, normalizeStatusList } from "../core/normalize";
import type { ProviderId } from "../core/types";
import { type JsonFetcher, missFromHttp } from "./http";
import type { Provider, ProfileOutcome, ProviderOutcome } from "./types";

const API_BASE = "https://api.fxtwitter.com/2";
const PAGE_SIZE = "20";

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Reads one FxTwitter-shaped status. The ID must match the one requested, and a
 * protected author is refused even if a source returned the text.
 */
export function outcomeFromStatus(raw: unknown, requestedId: string, source: ProviderId, fetchedAt: number): ProviderOutcome {
  if (!isObject(raw)) return { kind: "miss", status: "not_found" };
  if (raw.type === "tombstone") {
    if (raw.reason === "deleted") return { kind: "miss", status: "deleted" };
    if (raw.reason === "suspended") return { kind: "miss", status: "suspended" };
    if (raw.reason === "private") return { kind: "miss", status: "private" };
    return { kind: "miss", status: "not_found" };
  }
  if (isProtectedAuthor(raw)) return { kind: "miss", status: "private" };
  const post = normalizeStatus(raw, source, fetchedAt);
  if (!post || post.id !== requestedId) return { kind: "miss", status: "not_found" };
  return { kind: "found", post };
}

export function outcomeFromProfile(raw: unknown): ProfileOutcome {
  if (isObject(raw) && raw.protected === true) return { kind: "miss", status: "private" };
  const author = normalizeAuthor(raw);
  return author ? { kind: "found", author } : { kind: "miss", status: "not_found" };
}

function bottomCursor(body: Json): string | undefined {
  const cursor = isObject(body.cursor) ? body.cursor.bottom : undefined;
  return typeof cursor === "string" && cursor ? cursor : undefined;
}

export function createFxTwitterProvider(fetchJson: JsonFetcher, now: () => number = Date.now): Provider {
  return {
    id: "fxtwitter",
    async fetchStatus({ id }) {
      const response = await fetchJson(`${API_BASE}/status/${id}`);
      if (response.status !== 200 || !isObject(response.json)) return missFromHttp(response);
      return outcomeFromStatus(response.json.status, id, "fxtwitter", now());
    },
    // The `id:` form stayed reliable for a withheld account while the same lookups by
    // handle flipped between 200 and 404, and X's own response always carries the ID.
    async fetchProfile({ id }) {
      const response = await fetchJson(`${API_BASE}/profile/id:${id}`);
      if (response.status !== 200 || !isObject(response.json)) return missFromHttp(response);
      return outcomeFromProfile(response.json.user);
    },
    async fetchUserPosts({ id, cursor, withReplies }) {
      const query = new URLSearchParams({ count: PAGE_SIZE });
      if (cursor) query.set("cursor", cursor);
      if (withReplies) query.set("with_replies", "1");
      const response = await fetchJson(`${API_BASE}/profile/id:${id}/statuses?${query}`);
      if (response.status !== 200 || !isObject(response.json)) return missFromHttp(response);
      const nextCursor = bottomCursor(response.json);
      return {
        kind: "found",
        posts: normalizeStatusList(response.json.results, "fxtwitter", now()),
        ...(nextCursor ? { nextCursor } : {}),
      };
    },
    async fetchConversation({ id, cursor }) {
      const query = cursor ? `?${new URLSearchParams({ cursor })}` : "";
      const response = await fetchJson(`${API_BASE}/conversation/${id}${query}`);
      // A later page can 404 while the first works, so X's existing replies must survive it.
      if (response.status !== 200 || !isObject(response.json)) return missFromHttp(response);
      const nextCursor = bottomCursor(response.json);
      return {
        kind: "found",
        posts: normalizeStatusList(response.json.replies, "fxtwitter", now()),
        ...(nextCursor ? { nextCursor } : {}),
      };
    },
  };
}
