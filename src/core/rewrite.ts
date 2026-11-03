import { fillKnownUsers, findBlockedUsers, mightContainBlockedUser } from "./profile";
import { buildTweetResult } from "./synthesize";
import {
  buildConversationEntries,
  buildUserEntries,
  conversationPayload,
  decodeCursor,
  dialectOf,
  findEntriesArray,
  focalSortIndex,
  hasConversationReplies,
  type RepostLabel,
  type SyntheticCursor,
  type TimelineView,
  timelineViewOf,
  userTimelinePayload,
} from "./timeline";
import type { AppliedMark, FailedMark, PostAuthor, PostRecord, PostsPage, ProfileMark, ProfileResult, RecoveryItem, RecoveryResult } from "./types";
import { findConversationId, findHits, mightContainHits, type RequestContext, type TombstoneHit } from "./withheld-detector";

type Json = Record<string, unknown>;

export interface RewriteDeps {
  recover(items: RecoveryItem[]): Promise<RecoveryResult[]>;
  recoverProfile(user: { id: string; handle: string }): Promise<ProfileResult>;
  userPosts(request: { id: string; handle: string; cursor?: string; withReplies: boolean }): Promise<PostsPage>;
  conversation(request: { id: string; cursor?: string }): Promise<PostsPage>;
  repostLabel?: RepostLabel;
}

export interface Marks {
  applied: AppliedMark[];
  failed: FailedMark[];
  profiles: ProfileMark[];
}

export interface RewriteOutcome extends Marks {
  text: string;
  /** One line for the popup's diagnostics. Holds shape and counts, never post content. */
  diagnostic?: string;
}

// sort indexes must sit above zero and leave room for many pages below them.
const USER_TIMELINE_TOP = "9000000000000000000";

// A filtered tab can find little on one source page, and X's client treats a page with
// no posts as the end of the list, so a few pages are read before answering.
const MIN_FILTERED_POSTS = 5;
const MAX_SOURCE_PAGES = 4;
const USER_LOOKUP = /^Users?By/;

const isObject = (value: unknown): value is Json =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function uniqueItems(hits: TombstoneHit[]): RecoveryItem[] {
  const items = new Map<string, RecoveryItem>();
  for (const { id, handle } of hits) {
    if (!items.has(id)) items.set(id, { id, ...(handle ? { handle } : {}) });
  }
  return [...items.values()];
}

function postMark(post: PostRecord, country?: string): AppliedMark {
  return {
    id: post.id,
    handle: post.author.handle,
    createdAtMs: post.createdAtMs,
    source: post.source,
    kind: "withheld",
    quoted: false,
    ...(country ? { country } : {}),
  };
}

function emptyMarks(): Marks {
  return { applied: [], failed: [], profiles: [] };
}

/** Describes what X sent for a request, so a report can show which client and shape it was. */
function describeShape(payload: unknown): string {
  if (!isObject(payload) || !isObject(payload.data)) return "data=none";
  const slots = Object.entries(payload.data).map(([key, slot]) => {
    const result = isObject(slot) ? slot.result : undefined;
    if (!isObject(result)) return key;
    // Field names only: enough to see which client's shape this was, with no profile data.
    const fields = [isObject(result.legacy) ? result.legacy : {}, isObject(result.profile_bio) ? result.profile_bio : {}]
      .flatMap((source) => Object.keys(source))
      .filter((name) => /^with_?held/.test(name))
      .join("+");
    return `${key}:${String(result.__typename)}${isObject(result.legacy) ? ",legacy" : ""}${fields ? `,fields=${fields}` : ""}`;
  });
  return `data=[${slots.join(";")}]`;
}

/**
 * Fills the gaps in X's GraphQL bodies so X's own client renders recovered posts and
 * profiles. Any failure leaves the original text in place, so X keeps working as it
 * would have without the extension and shows its own notice for anything unrecovered.
 */
export class ResponseRewriter {
  readonly #deps: RewriteDeps;
  // Blocked accounts seen on this page, so their timeline requests can be filled in.
  // The classic client asks by user ID, the Relay client by screen name.
  readonly #blockedById = new Map<string, { id: string; handle: string; country?: string }>();
  readonly #blockedByHandle = new Map<string, { id: string; handle: string; country?: string }>();
  readonly #blockedAuthors = new Map<string, PostAuthor>();

  constructor(deps: RewriteDeps) {
    this.#deps = deps;
  }

  #blockedTimelineUser(ctx: RequestContext) {
    if (!timelineViewOf(ctx)) return undefined;
    const { userId, screenName } = ctx.variables;
    if (typeof userId === "string") return this.#blockedById.get(userId);
    return typeof screenName === "string" ? this.#blockedByHandle.get(screenName.toLowerCase()) : undefined;
  }

  /** X refuses cursors it did not issue and may error on a blocked account's timeline. */
  takesOverErrors(ctx: RequestContext): boolean {
    return decodeCursor(ctx.variables.cursor) !== null || this.#blockedTimelineUser(ctx) !== undefined;
  }

  async rewrite(text: string, ctx: RequestContext): Promise<RewriteOutcome> {
    const unchanged: RewriteOutcome = { text, ...emptyMarks() };
    const synthetic = decodeCursor(ctx.variables.cursor);
    if (synthetic) return (await this.#nextPage(synthetic, ctx)) ?? unchanged;

    const timelineUser = this.#blockedTimelineUser(ctx);
    // User lookups are small and are where a blocked account shows up, so they are always
    // read. The substring checks spare every larger body a second parse.
    const isUserLookup = USER_LOOKUP.test(ctx.operation);
    const mentionsKnownUser = this.#blockedAuthors.size > 0 && text.includes("with_held_scope");
    if (!timelineUser && !isUserLookup && !mentionsKnownUser && !mightContainHits(text) && !mightContainBlockedUser(text)) return unchanged;

    let payload: unknown;
    try {
      payload = JSON.parse(text);
    } catch {
      if (!timelineUser) return { ...unchanged, diagnostic: this.#describe(text, "data=unparsed", "", ctx, unchanged) };
    }

    // Read before filling, because the point is to show what X itself sent.
    const shape = describeShape(payload);
    const marks = emptyMarks();
    const profiles = await this.#fillProfiles(payload, ctx, marks);
    let changed = profiles.changed;
    changed = fillKnownUsers(payload, this.#blockedAuthors) || changed;
    changed = (await this.#fillTombstones(payload, ctx, marks)) || changed;
    changed = (await this.#fillConversation(payload, ctx, marks)) || changed;

    if (timelineUser) {
      const filled = await this.#fillUserTimeline(payload, ctx, timelineUser, marks);
      if (filled) return { text: JSON.stringify(filled), ...marks, diagnostic: this.#describe(text, shape, profiles.note, ctx, marks) };
    }
    return { text: changed ? JSON.stringify(payload) : text, ...marks, diagnostic: this.#describe(text, shape, profiles.note, ctx, marks) };
  }

  #describe(text: string, shape: string, profileNote: string, ctx: RequestContext, marks: Marks): string {
    return [
      ctx.transport ?? "?",
      ctx.operation,
      `status=${ctx.status ?? "?"}`,
      `bytes=${text.length}`,
      shape,
      profileNote,
      `applied=${marks.applied.length}`,
      `failed=${marks.failed.length}`,
      `profiles=${marks.profiles.length}`,
    ]
      .filter(Boolean)
      .join(" ");
  }

  async #fillProfiles(payload: unknown, ctx: RequestContext, marks: Marks): Promise<{ changed: boolean; note: string }> {
    const requestedHandle = ctx.variables.screen_name ?? ctx.variables.screenName;
    const blocked = findBlockedUsers(payload, requestedHandle);
    const statuses: string[] = [];
    let changed = false;
    for (const user of blocked) {
      const { id, handle, country } = user;
      const result = await this.#deps.recoverProfile({ id, handle });
      statuses.push(result.status);
      if (result.status !== "found" || !result.author || !result.source) continue;
      user.fill(result.author);
      const known = { id, handle, ...(country ? { country } : {}) };
      this.#blockedById.set(id, known);
      this.#blockedByHandle.set(handle.toLowerCase(), known);
      this.#blockedAuthors.set(id, result.author);
      marks.profiles.push({ handle, source: result.source, ...(country ? { country } : {}) });
      changed = true;
    }
    return { changed, note: `blocked=${blocked.length}${statuses.length > 0 ? `:${statuses.join("+")}` : ""}` };
  }

  async #fillTombstones(payload: unknown, ctx: RequestContext, marks: Marks): Promise<boolean> {
    const hits = findHits(payload, ctx);
    if (hits.length === 0) return false;

    const results = new Map((await this.#deps.recover(uniqueItems(hits))).map((result) => [result.id, result]));
    const conversationId = findConversationId(payload);
    let changed = false;
    for (const hit of hits) {
      const result = results.get(hit.id);
      if (result?.status === "found" && result.post) {
        const post = { ...result.post, conversationId: conversationId ?? result.post.conversationId };
        hit.fill(buildTweetResult(post));
        marks.applied.push({ ...postMark(post, hit.country), kind: hit.kind, quoted: hit.quoted });
        changed = true;
      } else if (result && hit.message && result.status !== "disabled") {
        marks.failed.push({ id: hit.id, status: result.status, message: hit.message });
      }
    }
    return changed;
  }

  /**
   * Adds source replies only when X returned none for a recovered focal post. Replies
   * X does return are always kept, since they carry real viewer state.
   */
  async #fillConversation(payload: unknown, ctx: RequestContext, marks: Marks): Promise<boolean> {
    if (ctx.operation !== "TweetDetail" || typeof ctx.variables.focalTweetId !== "string") return false;
    const focalId = ctx.variables.focalTweetId;
    if (!marks.applied.some((mark) => mark.id === focalId)) return false;

    const entries = findEntriesArray(payload);
    if (!entries || hasConversationReplies(entries, focalId)) return false;
    const start = focalSortIndex(entries, focalId);
    if (!start) return false;

    const page = await this.#deps.conversation({ id: focalId });
    if (page.status !== "found" || page.posts.length === 0) return false;
    entries.push(...buildConversationEntries(page.posts, start, focalId, page.nextCursor));
    marks.applied.push(...page.posts.map((post) => postMark(post)));
    return true;
  }

  async #fillUserTimeline(
    payload: unknown,
    ctx: RequestContext,
    user: { id: string; handle: string; country?: string },
    marks: Marks,
  ): Promise<unknown> {
    const view = timelineViewOf(ctx);
    if (!view) return null;
    const { withReplies } = view;
    const dialect = dialectOf(ctx);
    const page = await this.#collectPosts(user, view);
    if (!page) return null;
    const existing = dialect === "classic" ? findEntriesArray(payload) : null;
    // X may have returned some of these itself, as tombstones that were just filled.
    const known = new Set(existing?.flatMap((entry) => (isObject(entry) && typeof entry.entryId === "string" ? [entry.entryId] : [])));
    const posts = page.posts.filter((post) => !known.has(`tweet-${post.id}`));
    marks.applied.push(...posts.map((post) => postMark(post, user.country)));

    const entries = buildUserEntries(
      posts,
      USER_TIMELINE_TOP,
      {
        id: user.id,
        handle: user.handle,
        withReplies,
        ...(page.nextCursor ? { cursor: page.nextCursor } : {}),
        ...(user.country ? { country: user.country } : {}),
      },
      dialect,
      this.#deps.repostLabel,
    );
    if (!existing) return userTimelinePayload(entries, dialect, user);
    // Only the source's cursor can page further, since X has nothing more to give here.
    const kept = existing.filter((entry) => !(isObject(entry) && typeof entry.entryId === "string" && entry.entryId.startsWith("cursor-")));
    existing.splice(0, existing.length, ...kept, ...entries);
    return payload;
  }

  /** Null only when the first page failed, so what was already read is never thrown away. */
  async #collectPosts(
    user: { id: string; handle: string },
    view: TimelineView,
    startCursor?: string,
  ): Promise<{ posts: PostRecord[]; nextCursor?: string } | null> {
    const posts = new Map<string, PostRecord>();
    let cursor = startCursor;
    for (let read = 0; read < MAX_SOURCE_PAGES; read += 1) {
      const page = await this.#deps.userPosts({
        id: user.id,
        handle: user.handle,
        withReplies: view.withReplies,
        ...(cursor ? { cursor } : {}),
      });
      if (page.status !== "found") {
        if (read === 0) return null;
        cursor = undefined;
        break;
      }
      for (const post of page.posts) {
        if (!view.keep || view.keep(post)) posts.set(post.id, post);
      }
      cursor = page.nextCursor;
      if (!cursor || !view.keep || posts.size >= MIN_FILTERED_POSTS) break;
    }
    return { posts: [...posts.values()], ...(cursor ? { nextCursor: cursor } : {}) };
  }

  async #nextPage(cursor: SyntheticCursor, ctx: RequestContext): Promise<RewriteOutcome | null> {
    const marks = emptyMarks();
    if (cursor.kind === "user") {
      const { id, handle, withReplies, country } = cursor;
      const dialect = dialectOf(ctx);
      const view = timelineViewOf(ctx) ?? { withReplies };
      const page = await this.#collectPosts({ id, handle }, view, cursor.cursor);
      if (!page) return null;
      marks.applied.push(...page.posts.map((post) => postMark(post, country)));
      const entries = buildUserEntries(
        page.posts,
        cursor.next,
        {
          id,
          handle,
          withReplies,
          ...(page.nextCursor ? { cursor: page.nextCursor } : {}),
          ...(country ? { country } : {}),
        },
        dialect,
        this.#deps.repostLabel,
      );
      return { text: JSON.stringify(userTimelinePayload(entries, dialect, { id, handle })), ...marks };
    }
    const page = await this.#deps.conversation({ id: cursor.id, cursor: cursor.cursor });
    if (page.status !== "found") return null;
    marks.applied.push(...page.posts.map((post) => postMark(post)));
    const entries = buildConversationEntries(page.posts, cursor.next, cursor.id, page.nextCursor);
    return { text: JSON.stringify(conversationPayload(entries)), ...marks };
  }
}
