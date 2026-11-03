export type ProviderId = "fxtwitter" | "xmd";

export type RecoveryStatus =
  | "found"
  | "deleted"
  | "private"
  | "suspended"
  | "not_found"
  | "rate_limited"
  | "provider_unavailable"
  | "disabled";

export interface PostAuthor {
  id: string;
  handle: string;
  name: string;
  avatarUrl: string;
  bannerUrl?: string;
  description: string;
  location: string;
  followers: number;
  following: number;
  statuses: number;
  mediaCount: number;
  likes: number;
  joinedAt: string;
  joinedAtMs: number;
  website?: { url: string; displayUrl: string };
  blueVerified: boolean;
  verifiedType?: "Business" | "Government";
}

export type TextRange = [number, number];

export interface PostMention {
  id: string;
  handle: string;
  indices: TextRange;
}

export interface PostUrl {
  url: string;
  expandedUrl: string;
  displayUrl: string;
  indices: TextRange;
}

export interface PostHashtag {
  text: string;
  indices: TextRange;
}

export interface PostMediaVariant {
  contentType: string;
  url: string;
  bitrate?: number;
}

export interface PostMedia {
  id: string;
  type: "photo" | "video" | "animated_gif";
  /** Image URL for photos, poster URL for videos. */
  url: string;
  width: number;
  height: number;
  altText?: string;
  shortUrl?: string;
  displayUrl?: string;
  indices?: TextRange;
  durationMs?: number;
  variants?: PostMediaVariant[];
}

export interface PostCounts {
  replies: number;
  reposts: number;
  likes: number;
  quotes: number;
  bookmarks: number;
  views?: number;
}

/**
 * A post as recovered from an alternative source. IDs stay strings because they
 * are 64-bit snowflakes. `text` keeps X's own entity escaping (`&amp;`) so the
 * entity indices supplied by the source still line up.
 */
export interface PostRecord {
  id: string;
  author: PostAuthor;
  text: string;
  displayRange: TextRange;
  createdAt: string;
  createdAtMs: number;
  lang: string;
  parentId?: string;
  parentHandle?: string;
  parentUserId?: string;
  conversationId?: string;
  possiblySensitive: boolean;
  counts: PostCounts;
  mentions: PostMention[];
  urls: PostUrl[];
  hashtags: PostHashtag[];
  media: PostMedia[];
  quote?: PostRecord;
  /** Set when this post appears on a timeline because the profile owner reposted it. */
  repostedBy?: { handle: string; name: string };
  source: ProviderId;
  sourceUrl: string;
  fetchedAt: number;
}

export interface RecoveryResult {
  id: string;
  status: RecoveryStatus;
  post?: PostRecord;
}

export interface ProfileResult {
  status: RecoveryStatus;
  author?: PostAuthor;
  source?: ProviderId;
}

export interface PostsPage {
  status: RecoveryStatus;
  posts: PostRecord[];
  nextCursor?: string;
  source?: ProviderId;
}

export interface RecoveryItem {
  id: string;
  /** Handle read from X's tombstone text. x.md uses it in its URL when known. */
  handle?: string;
}

/** Why a slot in X's response has no post: a stated legal hold, or simply no data. */
export type HitKind = "withheld" | "missing";

export interface AppliedMark {
  id: string;
  handle: string;
  createdAtMs: number;
  source: ProviderId;
  kind: HitKind;
  country?: string;
  /** Quoted cards have no permalink anchor, so the marker finds them by time. */
  quoted: boolean;
}

export interface ProfileMark {
  handle: string;
  source: ProviderId;
  /** ISO region code from X, such as TR. */
  country?: string;
}

export interface FailedMark {
  id: string;
  status: RecoveryStatus;
  message: string;
}

export interface Settings {
  enabled: boolean;
  useXmdFallback: boolean;
  glowBorder: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  enabled: true,
  useXmdFallback: true,
  glowBorder: true,
};

export interface SessionStats {
  shown: number;
  missed: number;
}
