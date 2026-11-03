import { isHandle, isSnowflake } from "../core/normalize";
import type {
  AppliedMark,
  FailedMark,
  PostAuthor,
  PostMedia,
  PostRecord,
  PostsPage,
  ProfileMark,
  ProfileResult,
  RecoveryItem,
  RecoveryResult,
  RecoveryStatus,
} from "../core/types";
import { isAllowedMediaUrl, isWebUrl } from "../core/url-policy";
import type { ConversationRequest, UserPostsRequest, UserRef } from "../providers/types";

export const CHANNEL = "xcwv";
export const MAX_ITEMS_PER_REQUEST = 100;
const MAX_TEXT_LENGTH = 100_000;
const MAX_CURSOR_LENGTH = 2048;
const MAX_LOG_LINE_LENGTH = 400;

/** What the page world may ask for. Clearing the cache is reserved for the popup. */
export type PageRequest =
  | { type: "recover"; items: RecoveryItem[] }
  | { type: "recover-profile"; user: UserRef }
  | { type: "user-posts"; request: UserPostsRequest }
  | { type: "conversation"; request: ConversationRequest }
  | { type: "is-enabled" }
  | { type: "log"; line: string };

export type BackgroundRequest = PageRequest | { type: "clear-cache" };

export interface RequestMessage {
  channel: typeof CHANNEL;
  direction: "to-content";
  type: "request";
  requestId: string;
  request: PageRequest;
}

export interface ResponseMessage {
  channel: typeof CHANNEL;
  direction: "to-main";
  type: "response";
  requestId: string;
  response: unknown;
}

export interface MarksMessage {
  channel: typeof CHANNEL;
  direction: "to-content";
  type: "marks";
  applied: AppliedMark[];
  failed: FailedMark[];
  profiles: ProfileMark[];
}

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const isRequestId = (value: unknown): value is string => typeof value === "string" && /^[\w-]{1,64}$/.test(value);
const isProviderId = (value: unknown): boolean => value === "fxtwitter" || value === "xmd";
const isCursor = (value: unknown): boolean =>
  value === undefined || (typeof value === "string" && value.length <= MAX_CURSOR_LENGTH);
const RECOVERY_STATUSES: ReadonlySet<unknown> = new Set<RecoveryStatus>([
  "found",
  "deleted",
  "private",
  "suspended",
  "not_found",
  "rate_limited",
  "provider_unavailable",
  "disabled",
]);

export function isRecoveryItem(value: unknown): value is RecoveryItem {
  return isObject(value) && isSnowflake(value.id) && (value.handle === undefined || isHandle(value.handle));
}

function isUserRef(value: unknown): value is UserRef {
  return isObject(value) && isSnowflake(value.id) && isHandle(value.handle);
}

export function isPageRequest(value: unknown): value is PageRequest {
  if (!isObject(value)) return false;
  switch (value.type) {
    case "recover":
      return Array.isArray(value.items) && value.items.length <= MAX_ITEMS_PER_REQUEST && value.items.every(isRecoveryItem);
    case "recover-profile":
      return isUserRef(value.user);
    case "user-posts":
      return isUserRef(value.request) && isObject(value.request) && isCursor(value.request.cursor);
    case "conversation":
      return isObject(value.request) && isSnowflake(value.request.id) && isCursor(value.request.cursor);
    case "is-enabled":
      return true;
    case "log":
      return typeof value.line === "string" && value.line.length <= MAX_LOG_LINE_LENGTH;
    default:
      return false;
  }
}

export function isBackgroundRequest(value: unknown): value is BackgroundRequest {
  return (isObject(value) && value.type === "clear-cache") || isPageRequest(value);
}

function isSafeMedia(value: unknown): value is PostMedia {
  if (!isObject(value) || !isSnowflake(value.id) || !isAllowedMediaUrl(value.url)) return false;
  if (value.type !== "photo" && value.type !== "video" && value.type !== "animated_gif") return false;
  const variants = value.variants;
  return variants === undefined || (Array.isArray(variants) && variants.every((v) => isObject(v) && isAllowedMediaUrl(v.url)));
}

function isSafeAuthor(value: unknown): value is PostAuthor {
  return (
    isObject(value) &&
    isSnowflake(value.id) &&
    isHandle(value.handle) &&
    typeof value.name === "string" &&
    isAllowedMediaUrl(value.avatarUrl) &&
    (value.bannerUrl === undefined || isAllowedMediaUrl(value.bannerUrl)) &&
    (value.website === undefined || (isObject(value.website) && isWebUrl(value.website.url)))
  );
}

/**
 * `window.postMessage` can be forged by any script on the page, so everything is
 * re-validated on arrival in the page world, URLs and IDs included. This limits what
 * a forged message can inject. It does not make the channel trustworthy.
 */
export function isSafePost(value: unknown): value is PostRecord {
  if (!isObject(value) || !isSnowflake(value.id) || !isSafeAuthor(value.author) || !isObject(value.counts)) return false;
  const { urls, media, mentions, hashtags, quote } = value;
  return (
    typeof value.text === "string" &&
    value.text.length <= MAX_TEXT_LENGTH &&
    typeof value.createdAt === "string" &&
    typeof value.createdAtMs === "number" &&
    Array.isArray(value.displayRange) &&
    Array.isArray(mentions) &&
    mentions.every((mention) => isObject(mention) && isHandle(mention.handle)) &&
    Array.isArray(hashtags) &&
    Array.isArray(urls) &&
    urls.every((url) => isObject(url) && isWebUrl(url.url) && isWebUrl(url.expandedUrl)) &&
    Array.isArray(media) &&
    media.every(isSafeMedia) &&
    isProviderId(value.source) &&
    (quote === undefined || isSafePost(quote))
  );
}

function isRecoveryResult(value: unknown): value is RecoveryResult {
  if (!isObject(value) || !isSnowflake(value.id) || !RECOVERY_STATUSES.has(value.status)) return false;
  return value.status === "found" ? isSafePost(value.post) : value.post === undefined;
}

export function isRecoveryResults(value: unknown): value is RecoveryResult[] {
  return Array.isArray(value) && value.every(isRecoveryResult);
}

export function isEnabledResult(value: unknown): value is { enabled: boolean } {
  return isObject(value) && typeof value.enabled === "boolean";
}

export function isProfileResult(value: unknown): value is ProfileResult {
  if (!isObject(value) || !RECOVERY_STATUSES.has(value.status)) return false;
  return value.status === "found" ? isSafeAuthor(value.author) && isProviderId(value.source) : value.author === undefined;
}

export function isPostsPage(value: unknown): value is PostsPage {
  if (!isObject(value) || !RECOVERY_STATUSES.has(value.status) || !isCursor(value.nextCursor)) return false;
  return Array.isArray(value.posts) && value.posts.every(isSafePost);
}

export function isRequestMessage(value: unknown): value is RequestMessage {
  return (
    isObject(value) &&
    value.channel === CHANNEL &&
    value.direction === "to-content" &&
    value.type === "request" &&
    isRequestId(value.requestId) &&
    isPageRequest(value.request)
  );
}

export function isResponseMessage(value: unknown): value is ResponseMessage {
  return (
    isObject(value) &&
    value.channel === CHANNEL &&
    value.direction === "to-main" &&
    value.type === "response" &&
    isRequestId(value.requestId)
  );
}

function isAppliedMark(value: unknown): value is AppliedMark {
  return (
    isObject(value) &&
    isSnowflake(value.id) &&
    isHandle(value.handle) &&
    typeof value.createdAtMs === "number" &&
    isProviderId(value.source) &&
    (value.kind === "withheld" || value.kind === "missing") &&
    typeof value.quoted === "boolean" &&
    (value.country === undefined || typeof value.country === "string")
  );
}

function isFailedMark(value: unknown): value is FailedMark {
  return isObject(value) && isSnowflake(value.id) && RECOVERY_STATUSES.has(value.status) && typeof value.message === "string";
}

function isProfileMark(value: unknown): value is ProfileMark {
  return (
    isObject(value) &&
    isHandle(value.handle) &&
    isProviderId(value.source) &&
    (value.country === undefined || typeof value.country === "string")
  );
}

export function isMarksMessage(value: unknown): value is MarksMessage {
  return (
    isObject(value) &&
    value.channel === CHANNEL &&
    value.direction === "to-content" &&
    value.type === "marks" &&
    Array.isArray(value.applied) &&
    value.applied.every(isAppliedMark) &&
    Array.isArray(value.failed) &&
    value.failed.every(isFailedMark) &&
    Array.isArray(value.profiles) &&
    value.profiles.every(isProfileMark)
  );
}
