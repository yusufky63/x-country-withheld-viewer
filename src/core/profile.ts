import { isHandle, isSnowflake } from "./normalize";
import { buildUser } from "./synthesize";
import type { PostAuthor } from "./types";

type Json = Record<string, unknown>;

export interface BlockedUser {
  id: string;
  handle: string;
  /** ISO region code, as X reports it. Left out when X does not say which one applies. */
  country?: string;
  fill(author: PostAuthor): void;
}

const WITHHELD_IN = /withheld in ([A-Z]{2})\b/;

/**
 * What X strips for a blocked viewer, or what carries the legal notice. Everything else
 * in X's response is kept, because it is real: who the viewer follows, counts, badges.
 */
const REPLACED_FIELDS = ["avatar", "banner", "core", "legacy", "location", "profile_bio", "website"];

const REST_VIEWER_FIELDS = [
  "blocked_by",
  "blocking",
  "can_dm",
  "can_media_tag",
  "follow_request_sent",
  "followed_by",
  "following",
  "muting",
  "notifications",
  "want_retweets",
];

const isObject = (value: unknown): value is Json =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const asObject = (value: unknown): Json => (isObject(value) ? value : {});

export function mightContainBlockedUser(text: string): boolean {
  return /"withheld_in_countries"\s*:\s*\[\s*"/.test(text);
}

function descriptionUrls(entities: unknown): string[] {
  const urls = asObject(asObject(entities).description).urls;
  return (Array.isArray(urls) ? urls : []).flatMap((url: unknown) =>
    isObject(url) && typeof url.expanded_url === "string" ? [url.expanded_url] : [],
  );
}

/** The legal notice, wherever this client keeps it. */
function noticeText(user: Json): string {
  const legacy = asObject(user.legacy);
  const bio = asObject(user.profile_bio);
  return [bio.description, bio.withheld_description, legacy.description, legacy.withheld_description]
    .filter((text): text is string => typeof text === "string")
    .join(" ");
}

/** Signed-in responses keep these under `profile_bio`, and have no `legacy` user at all. */
function withheldCountries(user: Json): unknown[] {
  const countries = asObject(user.profile_bio).withheld_in_countries ?? asObject(user.legacy).withheld_in_countries;
  return Array.isArray(countries) ? countries : [];
}

/**
 * Being listed is not enough: an account withheld somewhere else lists its countries
 * while being fully visible here. For a blocked viewer X adds the legal notice and
 * empties the display name, while keeping real numbers such as the follower count.
 */
function isBlockedForViewer(user: Json): boolean {
  const legacy = asObject(user.legacy);
  const bio = asObject(user.profile_bio);
  const hasDescriptionField = [bio.withheld_description, legacy.withheld_description].some((text) => typeof text === "string" && text !== "");
  const scoped = bio.with_held_scope === "user" || legacy.withheld_scope === "user";
  if (!hasDescriptionField && !scoped && withheldCountries(user).length === 0) return false;
  if (hasDescriptionField) return true;

  const urls = [
    ...descriptionUrls(bio.entities),
    ...descriptionUrls(bio.withheld_entities),
    ...descriptionUrls(legacy.entities),
    ...descriptionUrls(legacy.withheld_entities),
  ];
  if (/withheld/i.test(noticeText(user)) || urls.some((url) => /withheld/i.test(url))) return true;
  return !(asObject(user.core).name || legacy.name);
}

function userId(user: Json): string | undefined {
  const legacy = asObject(user.legacy);
  if (isSnowflake(user.rest_id)) return user.rest_id;
  if (isSnowflake(legacy.id_str)) return legacy.id_str;
  if (typeof user.id !== "string") return undefined;
  try {
    return atob(user.id).match(/^User:(\d+)$/)?.[1];
  } catch {
    return undefined;
  }
}

function countryOf(user: Json): string | undefined {
  const named = noticeText(user).match(WITHHELD_IN)?.[1];
  if (named) return named;
  const countries = withheldCountries(user);
  // With several listed, X has not said which one applies to this viewer.
  return countries.length === 1 && typeof countries[0] === "string" ? countries[0] : undefined;
}

/** Keeps X's own data, and replaces only what it stripped or used to carry the notice. */
function fillUser(user: Json, author: PostAuthor): void {
  const built = buildUser(author);
  for (const field of REPLACED_FIELDS) {
    // X's empty banner stays when the source has none either.
    if (field in built) delete user[field];
  }
  Object.assign(user, { ...built, ...user });
}

/** Any trace of the hold, in the field names of the GraphQL and REST APIs alike. */
function hasWithheldFlag(node: Json): boolean {
  return [node, asObject(node.profile_bio), asObject(node.legacy)].some((source) => {
    const countries = source.withheld_in_countries;
    return (
      (Array.isArray(countries) && countries.length > 0) ||
      source.with_held_scope === "user" ||
      source.withheld_scope === "user" ||
      (typeof source.withheld_description === "string" && source.withheld_description !== "")
    );
  });
}

/** A REST user is flat, and its viewer-specific fields are real, so they stay. */
function fillRestUser(node: Json, author: PostAuthor): void {
  const kept = Object.fromEntries(REST_VIEWER_FIELDS.filter((field) => field in node).map((field) => [field, node[field]]));
  delete node.withheld_description;
  delete node.withheld_entities;
  Object.assign(node, asObject(buildUser(author).legacy), kept);
}

/**
 * X's classic client keeps one record per user and overwrites it from every response,
 * over GraphQL and REST alike. Any copy of a recovered account that still carries the
 * hold would flip its profile back to the withheld page, so every copy gets filled.
 * Returns how many were found.
 */
export function fillKnownUsers(payload: unknown, authors: ReadonlyMap<string, PostAuthor>): number {
  let filled = 0;
  const stack: unknown[] = [payload];
  while (stack.length > 0) {
    const node = stack.pop();
    if (Array.isArray(node)) {
      stack.push(...node);
    } else if (isObject(node)) {
      const isGraphqlUser = node.__typename === "User" || isObject(node.profile_bio);
      const graphqlAuthor = isGraphqlUser && typeof node.rest_id === "string" ? authors.get(node.rest_id) : undefined;
      const restAuthor = typeof node.id_str === "string" && typeof node.screen_name === "string" ? authors.get(node.id_str) : undefined;
      if (graphqlAuthor && (hasWithheldFlag(node) || asObject(node.core).name === "")) {
        fillUser(node, graphqlAuthor);
        filled += 1;
      } else if (restAuthor && (hasWithheldFlag(node) || node.name === "")) {
        fillRestUser(node, restAuthor);
        filled += 1;
      } else {
        stack.push(...Object.values(node));
      }
    }
  }
  return filled;
}

/**
 * Only `data.<slot>.result` counts: authors nested inside timelines stay untouched.
 * `requestedHandle` covers a response that leaves the handle out.
 */
export function findBlockedUsers(payload: unknown, requestedHandle?: unknown): BlockedUser[] {
  if (!isObject(payload) || !isObject(payload.data)) return [];
  const blocked: BlockedUser[] = [];
  for (const slot of Object.values(payload.data)) {
    if (!isObject(slot) || !isObject(slot.result)) continue;
    const user = slot.result;
    if (user.__typename !== "User" || !isBlockedForViewer(user)) continue;
    const id = userId(user);
    const handle = asObject(user.core).screen_name ?? asObject(user.legacy).screen_name ?? requestedHandle;
    if (!id || !isHandle(handle)) continue;
    const country = countryOf(user);
    blocked.push({
      id,
      handle,
      ...(country ? { country } : {}),
      fill(author) {
        fillUser(user, author);
      },
    });
  }
  return blocked;
}
