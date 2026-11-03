import type { HitKind } from "./types";
import { isHandle, isSnowflake } from "./normalize";

type Json = Record<string, unknown>;

export interface RequestContext {
  operation: string;
  variables: Json;
  /** Only used in diagnostics, to show how X fetched this and what it answered. */
  transport?: "fetch" | "xhr";
  status?: number;
}

export interface TombstoneHit {
  id: string;
  kind: HitKind;
  handle?: string;
  country?: string;
  message: string;
  quoted: boolean;
  /** Writes the recovered tweet into the exact slot X left empty. */
  fill(result: Json): void;
}

const COUNTRY_WITHHELD = /\bwithheld\s+in\s+(.+?)\s+in\s+response\s+to\s+a\s+legal\s+demand/i;
const HANDLE_IN_TEXT = /@([A-Za-z0-9_]{1,50})/;
const ENTRY_TWEET_ID = /(?:tweet|tombstone)-(\d+)$/;

// X translates tombstones. The help-center link inside the text is the language
// independent signal; these phrases only cover tombstones that arrive without it.
const WITHHELD_URL = /withheld/i;
const WITHHELD_TEXT = /withheld|yasal bir talep|yasal talep|legal demand|demande légale|requerimiento legal|demanda legal/i;

const MISSING_RESULT_KEYS = new Set(["tweet_result_by_rest_id", "tweet_results", "tweetResult"]);
const STUB_KEYS = new Set(["id", "rest_id", "__typename"]);

const isObject = (value: unknown): value is Json =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Skips JSON.parse for the vast majority of responses, which have no empty slot. */
export function mightContainHits(text: string): boolean {
  return (
    text.includes("TweetTombstone") ||
    text.includes("TimelineTombstone") ||
    text.includes("TweetUnavailable") ||
    /"(?:tweet_result_by_rest_id|tweet_results|tweetResult)"\s*:\s*\{\s*(?:"__typename"\s*:\s*"[^"]*"\s*,\s*)?"(?:id|rest_id)"\s*:\s*"[^"]*"\s*,\s*"(?:id|rest_id)"\s*:\s*"[^"]*"\s*\}/.test(
      text,
    )
  );
}

function richText(source: unknown): { text: string; urls: string[] } {
  if (!isObject(source)) return { text: "", urls: [] };
  const urls: string[] = [];
  const entities = Array.isArray(source.entities) ? source.entities : [];
  for (const entity of entities) {
    if (isObject(entity) && isObject(entity.ref) && typeof entity.ref.url === "string") urls.push(entity.ref.url);
  }
  return { text: typeof source.text === "string" ? source.text : "", urls };
}

interface Classified {
  message: string;
  country?: string;
  handle?: string;
}

/** Only a stated legal hold qualifies. Deleted and protected posts stay as X shows them. */
function classifyWithheld(text: string, urls: string[]): Classified | null {
  const stated = urls.some((url) => WITHHELD_URL.test(url)) || WITHHELD_TEXT.test(text);
  if (!stated) return null;
  const handle = text.match(HANDLE_IN_TEXT)?.[1];
  const country = text.match(COUNTRY_WITHHELD)?.[1];
  return { message: text, ...(country ? { country } : {}), ...(isHandle(handle) ? { handle } : {}) };
}

function classifyResult(result: Json): Classified | null {
  if (result.__typename === "TweetTombstone") {
    const tombstone = isObject(result.tombstone) ? result.tombstone : {};
    const { text, urls } = richText(tombstone.text ?? tombstone.richText);
    return classifyWithheld(text, urls);
  }
  if (result.__typename === "TweetUnavailable") {
    return classifyWithheld(typeof result.reason === "string" ? result.reason : "", []);
  }
  return null;
}

function idFromVariables(ctx: RequestContext, key: string, index: number | undefined): string | undefined {
  if (key === "tweetResult") {
    const single = ctx.variables.tweetId ?? ctx.variables.restId;
    if (isSnowflake(single)) return single;
  }
  if (index !== undefined && Array.isArray(ctx.variables.tweetIds)) {
    const candidate: unknown = ctx.variables.tweetIds[index];
    if (isSnowflake(candidate)) return candidate;
  }
  return undefined;
}

/**
 * Walks a GraphQL payload and returns every slot that is empty because of a legal
 * hold (classic client: `TweetTombstone`) or that came back without any post
 * (Relay client: a `{ id, rest_id }` stub with no `result`).
 */
export function findHits(payload: unknown, ctx: RequestContext): TombstoneHit[] {
  const hits: TombstoneHit[] = [];

  const visit = (node: unknown, key: string, parent: Json | null, index: number | undefined, entryId?: string) => {
    if (Array.isArray(node)) {
      node.forEach((child, childIndex) => visit(child, key, parent, childIndex, entryId));
      return;
    }
    if (!isObject(node)) return;

    const ownEntry = typeof node.entryId === "string" ? node.entryId.match(ENTRY_TWEET_ID)?.[1] : undefined;
    const currentEntry = ownEntry ?? entryId;

    if (node.itemType === "TimelineTombstone" && currentEntry) {
      const info = isObject(node.tombstoneInfo) ? node.tombstoneInfo : {};
      const { text, urls } = richText(info.richText);
      const classified = classifyWithheld(text || (typeof info.text === "string" ? info.text : ""), urls);
      if (classified) {
        hits.push({
          id: currentEntry,
          kind: "withheld",
          quoted: false,
          ...classified,
          fill(result) {
            for (const existing of Object.keys(node)) delete node[existing];
            Object.assign(node, {
              itemType: "TimelineTweet",
              __typename: "TimelineTweet",
              tweet_results: { result },
              tweetDisplayType: "Tweet",
            });
          },
        });
      }
      return;
    }

    const quoted = /quoted/i.test(key);
    const slotResult = node.result;

    if (isObject(slotResult)) {
      const classified = classifyResult(slotResult);
      if (classified) {
        const legacy = parent && isObject(parent.legacy) ? parent.legacy : parent;
        const refId = quoted ? legacy?.quoted_status_id_str : /retweeted/i.test(key) ? legacy?.retweeted_status_id_str : undefined;
        const id = [node.rest_id, slotResult.rest_id, refId, quoted ? undefined : currentEntry, idFromVariables(ctx, key, index)].find(
          isSnowflake,
        );
        if (id) {
          hits.push({
            id,
            kind: "withheld",
            quoted,
            ...classified,
            fill(result) {
              node.result = result;
            },
          });
        }
        return;
      }
    } else if (
      slotResult === undefined &&
      MISSING_RESULT_KEYS.has(key) &&
      isSnowflake(node.rest_id) &&
      Object.keys(node).every((nodeKey) => STUB_KEYS.has(nodeKey))
    ) {
      hits.push({
        id: node.rest_id,
        kind: "missing",
        quoted: false,
        message: "",
        fill(result) {
          node.result = result;
        },
      });
      return;
    }

    for (const childKey of Object.keys(node)) {
      visit(node[childKey], childKey, node, undefined, currentEntry);
    }
  };

  visit(payload, "", null, undefined);
  return hits;
}

/** Sibling posts carry the conversation root, which sources do not report. */
export function findConversationId(payload: unknown): string | undefined {
  const stack: unknown[] = [payload];
  while (stack.length > 0) {
    const node = stack.pop();
    if (Array.isArray(node)) {
      stack.push(...node);
    } else if (isObject(node)) {
      if (isSnowflake(node.conversation_id_str)) return node.conversation_id_str;
      stack.push(...Object.values(node));
    }
  }
  return undefined;
}
