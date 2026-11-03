import { isHandle, isSnowflake } from "./normalize";
import { buildTweetResult, wrapTweetResult } from "./synthesize";
import type { PostRecord } from "./types";

type Json = Record<string, unknown>;

const CURSOR_PREFIX = "xcwv:";

const isObject = (value: unknown): value is Json =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * X's two clients read differently shaped timelines. The classic client uses camelCase
 * (`entryId`, `itemContent`), the Relay client snake_case (`entry_id`, `content.content`).
 * The Relay shape below comes from the query artifact in X's own JS bundle.
 */
export type Dialect = "classic" | "relay";

/** Operation names are shared between clients, but only Relay sends its provider variables. */
export function dialectOf(ctx: { variables: Record<string, unknown> }): Dialect {
  return Object.keys(ctx.variables).some((key) => key.startsWith("__relay_internal__")) ? "relay" : "classic";
}

export interface TimelineView {
  withReplies: boolean;
  /** Left out when the view shows everything the source returns. */
  keep?: (post: PostRecord) => boolean;
}

const hasMedia = (post: PostRecord, types: PostRecord["media"][number]["type"][]) =>
  post.media.some((media) => types.includes(media.type));

/**
 * The profile tabs on X's classic client. All read `data.user.result.timeline.timeline`, and
 * they differ only in what they show, so each is one filter over the source's list.
 */
const CLASSIC_VIEWS: Record<string, TimelineView> = {
  UserTweets: { withReplies: false },
  ProfileFilter: { withReplies: false },
  UserTweetsAndReplies: { withReplies: true },
  UserOriginalsTimeline: { withReplies: false, keep: (post) => !post.repostedBy },
  UserRepliesTimeline: { withReplies: true, keep: (post) => !post.repostedBy && post.parentId !== undefined },
  UserRepostsTimeline: { withReplies: false, keep: (post) => post.repostedBy !== undefined },
  UserMedia: { withReplies: false, keep: (post) => post.media.length > 0 },
  UserPhotoTimeline: { withReplies: false, keep: (post) => hasMedia(post, ["photo"]) },
  UserVideoTimeline: { withReplies: false, keep: (post) => hasMedia(post, ["video", "animated_gif"]) },
};

// The bundle shows the Relay client's response path for this query only.
const RELAY_VIEWS: Record<string, TimelineView> = {
  UserOriginalsTimeline: { withReplies: false, keep: (post) => !post.repostedBy },
};

export function timelineViewOf(ctx: { operation: string; variables: Record<string, unknown> }): TimelineView | undefined {
  return (dialectOf(ctx) === "relay" ? RELAY_VIEWS : CLASSIC_VIEWS)[ctx.operation];
}

/**
 * A bottom cursor X's client hands back on scroll. It carries the source's own
 * cursor, since X cannot page content it withholds. `next` keeps entries in source order.
 */
export type SyntheticCursor =
  | { kind: "user"; id: string; handle: string; cursor: string; next: string; withReplies: boolean; country?: string }
  | { kind: "conversation"; id: string; cursor: string; next: string };

export function encodeCursor(cursor: SyntheticCursor): string {
  return CURSOR_PREFIX + btoa(encodeURIComponent(JSON.stringify(cursor)));
}

export function decodeCursor(value: unknown): SyntheticCursor | null {
  if (typeof value !== "string" || !value.startsWith(CURSOR_PREFIX)) return null;
  try {
    const parsed: unknown = JSON.parse(decodeURIComponent(atob(value.slice(CURSOR_PREFIX.length))));
    if (!isObject(parsed) || !isSnowflake(parsed.id) || typeof parsed.cursor !== "string" || typeof parsed.next !== "string") {
      return null;
    }
    if (parsed.kind === "conversation") {
      return { kind: "conversation", id: parsed.id, cursor: parsed.cursor, next: parsed.next };
    }
    if (parsed.kind === "user" && isHandle(parsed.handle)) {
      return {
        kind: "user",
        id: parsed.id,
        handle: parsed.handle,
        cursor: parsed.cursor,
        next: parsed.next,
        withReplies: parsed.withReplies === true,
        ...(typeof parsed.country === "string" ? { country: parsed.country } : {}),
      };
    }
    return null;
  } catch {
    return null;
  }
}

/** X draws this line as given, so it has to match the language of X's own interface. */
export type RepostLabel = (name: string) => string;

const englishRepostLabel: RepostLabel = (name) => `${name} reposted`;

function tweetItemContent(post: PostRecord, repostLabel: RepostLabel = englishRepostLabel): Json {
  return {
    itemType: "TimelineTweet",
    __typename: "TimelineTweet",
    tweet_results: { result: buildTweetResult(post) },
    tweetDisplayType: "Tweet",
    ...(post.repostedBy
      ? {
          socialContext: {
            type: "TimelineGeneralContext",
            contextType: "Retweet",
            text: repostLabel(post.repostedBy.name),
            landingUrl: { url: `/${post.repostedBy.handle}`, urlType: "DeepLink" },
          },
        }
      : {}),
  };
}

function relayTweetContent(post: PostRecord): Json {
  return {
    __typename: "TimelineTweet",
    __isTimelineTimelineItemContent: "TimelineTweet",
    display_type: "Tweet",
    tweet_results: wrapTweetResult(post),
  };
}

function cursorEntry(value: string, sortIndex: string, dialect: Dialect): Json {
  if (dialect === "relay") {
    return {
      entry_id: `cursor-bottom-${sortIndex}`,
      sort_index: sortIndex,
      content: { __typename: "TimelineTimelineCursor", cursor_type: "Bottom", value },
    };
  }
  return {
    entryId: `cursor-bottom-${sortIndex}`,
    sortIndex,
    content: {
      entryType: "TimelineTimelineCursor",
      __typename: "TimelineTimelineCursor",
      value,
      cursorType: "Bottom",
    },
  };
}

function timelineEntry(post: PostRecord, sortIndex: string, dialect: Dialect, repostLabel?: RepostLabel): Json {
  if (dialect === "relay") {
    return {
      entry_id: `tweet-${post.id}`,
      sort_index: sortIndex,
      content: {
        __typename: "TimelineTimelineItem",
        client_event_info: { component: "tweet", element: "tweet" },
        content: relayTweetContent(post),
      },
    };
  }
  return {
    entryId: `tweet-${post.id}`,
    sortIndex,
    content: {
      entryType: "TimelineTimelineItem",
      __typename: "TimelineTimelineItem",
      itemContent: tweetItemContent(post, repostLabel),
      clientEventInfo: { component: "tweet", element: "tweet" },
    },
  };
}

function conversationEntry(post: PostRecord, sortIndex: string): Json {
  return {
    entryId: `conversationthread-${post.id}`,
    sortIndex,
    content: {
      entryType: "TimelineTimelineModule",
      __typename: "TimelineTimelineModule",
      items: [
        {
          entryId: `conversationthread-${post.id}-tweet-${post.id}`,
          item: {
            itemContent: tweetItemContent(post),
            clientEventInfo: { component: "tweet", element: "tweet" },
          },
        },
      ],
      displayType: "VerticalConversation",
      clientEventInfo: { component: "tweet", element: "tweet" },
    },
  };
}

interface PageEntries {
  entries: Json[];
  nextSortIndex: string;
}

/** X orders entries by descending sort index, so each one steps down from `start`. */
function assignSortIndexes(posts: PostRecord[], start: string, build: (post: PostRecord, sortIndex: string) => Json): PageEntries {
  let index = BigInt(start);
  const entries = posts.map((post) => {
    index -= 1n;
    return build(post, index.toString());
  });
  return { entries, nextSortIndex: (index - 1n).toString() };
}

export function buildUserEntries(
  posts: PostRecord[],
  start: string,
  next: { id: string; handle: string; cursor?: string; withReplies: boolean; country?: string },
  dialect: Dialect = "classic",
  repostLabel?: RepostLabel,
): Json[] {
  const { entries, nextSortIndex } = assignSortIndexes(posts, start, (post, index) => timelineEntry(post, index, dialect, repostLabel));
  if (next.cursor) {
    const { cursor, id, handle, withReplies, country } = next;
    entries.push(
      cursorEntry(
        encodeCursor({ kind: "user", id, handle, cursor, withReplies, next: nextSortIndex, ...(country ? { country } : {}) }),
        nextSortIndex,
        dialect,
      ),
    );
  }
  return entries;
}

export function buildConversationEntries(posts: PostRecord[], start: string, id: string, cursor?: string): Json[] {
  const { entries, nextSortIndex } = assignSortIndexes(posts, start, conversationEntry);
  if (cursor) {
    entries.push(cursorEntry(encodeCursor({ kind: "conversation", id, cursor, next: nextSortIndex }), nextSortIndex, "classic"));
  }
  return entries;
}

export function userTimelinePayload(entries: Json[], dialect: Dialect, user: { id: string; handle: string }): Json {
  if (dialect === "relay") {
    const key = `urt:profile:${user.handle.toLowerCase()}`;
    return {
      data: {
        user_result_by_screen_name: {
          id: btoa(`UserResults:${user.id}`),
          result: {
            __typename: "User",
            id: btoa(`User:${user.id}`),
            profile_user_originals_timeline: {
              id: btoa(`Timeline:${key}`),
              timeline: {
                id: btoa(`TimelineTimeline:${key}`),
                instructions: [{ __typename: "TimelineAddEntries", entries }],
                response_objects: { feedback_actions: [], immediate_reactions: [] },
              },
            },
          },
        },
      },
    };
  }
  const timeline = () => ({
    timeline: { instructions: [{ type: "TimelineAddEntries", entries }], metadata: { scribeConfig: { page: "profileBest" } } },
  });
  // X has used both keys for this timeline. Unread keys are ignored by the client.
  return { data: { user: { result: { __typename: "User", timeline: timeline(), timeline_v2: timeline() } } } };
}

export function conversationPayload(entries: Json[]): Json {
  return { data: { threaded_conversation_with_injections_v2: { instructions: [{ type: "TimelineAddEntries", entries }] } } };
}

/** Finds the entries array a classic timeline response is built around, whatever wraps it. */
export function findEntriesArray(payload: unknown): unknown[] | null {
  const stack: unknown[] = [payload];
  while (stack.length > 0) {
    const node = stack.pop();
    if (Array.isArray(node)) {
      stack.push(...node);
    } else if (isObject(node)) {
      if (Array.isArray(node.instructions)) {
        for (const instruction of node.instructions) {
          if (isObject(instruction) && instruction.type === "TimelineAddEntries" && Array.isArray(instruction.entries)) {
            return instruction.entries as unknown[];
          }
        }
      }
      stack.push(...Object.values(node));
    }
  }
  return null;
}

export function hasConversationReplies(entries: unknown[], focalId: string): boolean {
  return entries.some((entry) => {
    if (!isObject(entry) || typeof entry.entryId !== "string") return false;
    return entry.entryId.startsWith("conversationthread-") && !entry.entryId.endsWith(`-${focalId}`);
  });
}

export function focalSortIndex(entries: unknown[], focalId: string): string | null {
  for (const entry of entries) {
    if (isObject(entry) && entry.entryId === `tweet-${focalId}` && typeof entry.sortIndex === "string") {
      return entry.sortIndex;
    }
  }
  return null;
}
