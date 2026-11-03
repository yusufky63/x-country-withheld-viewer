import type {
  PostAuthor,
  PostHashtag,
  PostMedia,
  PostMediaVariant,
  PostMention,
  PostRecord,
  PostUrl,
  ProviderId,
  TextRange,
} from "./types";
import { isAllowedMediaUrl, isWebUrl } from "./url-policy";

type Json = Record<string, unknown>;

const SNOWFLAKE = /^\d{1,25}$/;
const HANDLE = /^[A-Za-z0-9_]{1,50}$/;
const DEFAULT_AVATAR = "https://abs.twimg.com/sticky/default_profile_images/default_profile_normal.png";
const CONTAINER_TYPES: Record<string, string> = {
  m3u8: "application/x-mpegURL",
  mp4: "video/mp4",
  webm: "video/webm",
};

const isObject = (value: unknown): value is Json =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const asString = (value: unknown): string => (typeof value === "string" ? value : "");
const asNumber = (value: unknown): number => (typeof value === "number" && Number.isFinite(value) ? value : 0);
const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

export const isSnowflake = (value: unknown): value is string => typeof value === "string" && SNOWFLAKE.test(value);
export const isHandle = (value: unknown): value is string => typeof value === "string" && HANDLE.test(value);

function asRange(value: unknown): TextRange | undefined {
  if (!Array.isArray(value) || value.length !== 2) return undefined;
  const [start, end] = value as unknown[];
  return typeof start === "number" && typeof end === "number" ? [start, end] : undefined;
}

function escapeEntities(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** X's client derives every avatar size from the `_normal` file name. */
function toNormalAvatar(url: string): string {
  return url.replace(/_(?:\d+x\d+|bigger|mini|x96|reasonably_small)(\.[a-z]+)$/i, "_normal$1");
}

export function normalizeAuthor(raw: unknown): PostAuthor | null {
  if (!isObject(raw) || !isSnowflake(raw.id) || !isHandle(raw.screen_name)) return null;
  const verification = isObject(raw.verification) ? raw.verification : {};
  const verifiedType =
    verification.type === "government" ? "Government" : verification.type === "organization" ? "Business" : undefined;
  const website = isObject(raw.website) && isWebUrl(raw.website.url) ? raw.website : undefined;
  const joinedAt = asString(raw.joined);
  return {
    id: raw.id,
    handle: raw.screen_name,
    name: asString(raw.name) || raw.screen_name,
    avatarUrl: isAllowedMediaUrl(raw.avatar_url) ? toNormalAvatar(raw.avatar_url) : DEFAULT_AVATAR,
    bannerUrl: isAllowedMediaUrl(raw.banner_url) ? raw.banner_url : undefined,
    description: asString(raw.description),
    location: asString(raw.location),
    followers: asNumber(raw.followers),
    following: asNumber(raw.following),
    statuses: asNumber(raw.statuses),
    mediaCount: asNumber(raw.media_count),
    likes: asNumber(raw.likes),
    joinedAt,
    joinedAtMs: Date.parse(joinedAt) || 0,
    ...(website ? { website: { url: website.url as string, displayUrl: asString(website.display_url) || (website.url as string) } } : {}),
    blueVerified: verification.verified === true,
    verifiedType,
  };
}

function normalizeVariants(raw: Json): PostMediaVariant[] {
  const variants: PostMediaVariant[] = [];
  for (const format of asArray(raw.formats)) {
    if (!isObject(format) || !isAllowedMediaUrl(format.url)) continue;
    const contentType = CONTAINER_TYPES[asString(format.container)];
    if (!contentType) continue;
    variants.push({
      contentType,
      url: format.url,
      ...(typeof format.bitrate === "number" ? { bitrate: format.bitrate } : {}),
    });
  }
  if (variants.length === 0 && isAllowedMediaUrl(raw.url)) {
    variants.push({ contentType: "video/mp4", url: raw.url });
  }
  return variants;
}

function normalizeMedia(status: Json, facets: Json[]): PostMedia[] {
  const container = isObject(status.media) ? status.media : {};
  const mediaFacets = new Map<string, Json>();
  for (const facet of facets) {
    if (facet.type === "media" && typeof facet.id === "string") mediaFacets.set(facet.id, facet);
  }

  const out: PostMedia[] = [];
  for (const raw of asArray(container.all)) {
    if (!isObject(raw) || !isSnowflake(raw.id)) continue;
    const facet = mediaFacets.get(raw.id);
    const shared = {
      id: raw.id,
      width: asNumber(raw.width),
      height: asNumber(raw.height),
      shortUrl: typeof facet?.original === "string" && isWebUrl(facet.original) ? facet.original : undefined,
      displayUrl: typeof facet?.display === "string" ? facet.display : undefined,
      indices: facet ? asRange(facet.indices) : undefined,
    };

    if (raw.type === "photo") {
      if (!isAllowedMediaUrl(raw.url)) continue;
      const altText = asString(raw.altText);
      out.push({
        ...shared,
        type: "photo",
        // X appends its own size query, so the source's `?name=orig` must go.
        url: raw.url.split("?")[0] as string,
        ...(altText ? { altText } : {}),
      });
    } else if (raw.type === "video" || raw.type === "gif") {
      const poster = raw.thumbnail_url;
      const variants = normalizeVariants(raw);
      if (!isAllowedMediaUrl(poster) || variants.length === 0) continue;
      out.push({
        ...shared,
        type: raw.type === "gif" ? "animated_gif" : "video",
        url: poster,
        durationMs: Math.round(asNumber(raw.duration) * 1000),
        variants,
      });
    }
  }
  return out;
}

function pollLines(raw: unknown): string {
  if (!isObject(raw)) return "";
  const lines = asArray(raw.choices).flatMap((choice) =>
    isObject(choice) ? [`${asString(choice.label)}: ${asNumber(choice.percentage)}%`] : [],
  );
  return lines.join("\n");
}

function parseFacets(facets: Json[]): Pick<PostRecord, "mentions" | "urls" | "hashtags"> {
  const mentions: PostMention[] = [];
  const urls: PostUrl[] = [];
  const hashtags: PostHashtag[] = [];
  for (const facet of facets) {
    const indices = asRange(facet.indices);
    if (!indices) continue;
    if (facet.type === "mention" && isHandle(facet.original)) {
      mentions.push({ id: isSnowflake(facet.id) ? facet.id : "0", handle: facet.original, indices });
    } else if (facet.type === "url" && isWebUrl(facet.original)) {
      const expanded = isWebUrl(facet.replacement) ? facet.replacement : facet.original;
      urls.push({
        url: facet.original,
        expandedUrl: expanded,
        displayUrl: asString(facet.display) || expanded,
        indices,
      });
    } else if (facet.type === "hashtag" && typeof facet.original === "string") {
      hashtags.push({ text: facet.original.replace(/^#/, ""), indices });
    }
  }
  return { mentions, urls, hashtags };
}

/**
 * Converts one FxTwitter-shaped status (x.md uses the same shape) into a record.
 * Returns null for tombstones and anything malformed, so a provider's HTTP 200
 * never counts as recovered content by itself.
 */
export function normalizeStatus(raw: unknown, source: ProviderId, fetchedAt: number): PostRecord | null {
  if (!isObject(raw) || raw.type !== "status" || !isSnowflake(raw.id)) return null;
  const author = normalizeAuthor(raw.author);
  if (!author) return null;

  const rawText = isObject(raw.raw_text) ? raw.raw_text : {};
  const facets = asArray(rawText.facets).filter(isObject);
  let text = typeof rawText.text === "string" ? rawText.text : escapeEntities(asString(raw.text));
  let displayRange = asRange(rawText.display_text_range) ?? ([0, [...text].length] as TextRange);

  const poll = pollLines(raw.poll);
  if (poll) {
    text = `${text}\n\n${poll}`;
    displayRange = [displayRange[0], [...text].length];
  }

  const createdAt = asString(raw.created_at);
  const createdAtMs =
    typeof raw.created_timestamp === "number" ? raw.created_timestamp * 1000 : Date.parse(createdAt);
  if (!createdAt || !Number.isFinite(createdAtMs)) return null;

  const { mentions, urls, hashtags } = parseFacets(facets);
  const replyingTo = isObject(raw.replying_to) ? raw.replying_to : undefined;
  const parentHandle = isHandle(replyingTo?.screen_name) ? replyingTo.screen_name : undefined;
  const quote = normalizeStatus(raw.quote, source, fetchedAt);
  const reposter = isObject(raw.reposted_by) ? raw.reposted_by : undefined;

  return {
    id: raw.id,
    author,
    text,
    displayRange,
    createdAt,
    createdAtMs,
    lang: asString(raw.lang) || "und",
    parentId: isSnowflake(replyingTo?.status) ? replyingTo.status : undefined,
    parentHandle,
    parentUserId: mentions.find((mention) => mention.handle === parentHandle)?.id,
    possiblySensitive: raw.possibly_sensitive === true,
    counts: {
      replies: asNumber(raw.replies),
      reposts: asNumber(raw.reposts),
      likes: asNumber(raw.likes),
      quotes: asNumber(raw.quotes),
      bookmarks: asNumber(raw.bookmarks),
      ...(typeof raw.views === "number" ? { views: raw.views } : {}),
    },
    mentions,
    urls,
    hashtags,
    media: normalizeMedia(raw, facets),
    ...(quote ? { quote } : {}),
    ...(isHandle(reposter?.screen_name)
      ? { repostedBy: { handle: reposter.screen_name, name: asString(reposter.name) || reposter.screen_name } }
      : {}),
    source,
    sourceUrl: isWebUrl(raw.url) ? raw.url : `https://x.com/${author.handle}/status/${raw.id}`,
    fetchedAt,
  };
}

export function isProtectedAuthor(raw: unknown): boolean {
  return isObject(raw) && isObject(raw.author) && raw.author.protected === true;
}

/** Reads a list of statuses, dropping anything protected or malformed. */
export function normalizeStatusList(raw: unknown, source: ProviderId, fetchedAt: number): PostRecord[] {
  return asArray(raw).flatMap((status) => {
    if (isProtectedAuthor(status)) return [];
    const post = normalizeStatus(status, source, fetchedAt);
    return post ? [post] : [];
  });
}
