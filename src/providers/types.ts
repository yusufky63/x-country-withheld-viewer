import type { PostAuthor, PostRecord, ProviderId, RecoveryItem, RecoveryStatus } from "../core/types";

export interface Miss {
  kind: "miss";
  status: Exclude<RecoveryStatus, "found" | "disabled">;
  retryAfterMs?: number;
}

export type ProviderOutcome = { kind: "found"; post: PostRecord } | Miss;
export type ProfileOutcome = { kind: "found"; author: PostAuthor } | Miss;
export type PageOutcome = { kind: "found"; posts: PostRecord[]; nextCursor?: string } | Miss;

export interface UserRef {
  id: string;
  handle: string;
}

export interface UserPostsRequest extends UserRef {
  cursor?: string;
  withReplies: boolean;
}

export interface ConversationRequest {
  id: string;
  cursor?: string;
}

export interface Provider {
  id: ProviderId;
  fetchStatus(item: RecoveryItem): Promise<ProviderOutcome>;
  fetchProfile(user: UserRef): Promise<ProfileOutcome>;
  fetchUserPosts(request: UserPostsRequest): Promise<PageOutcome>;
  /** Only FxTwitter exposes reply pages, so this one is optional. */
  fetchConversation?(request: ConversationRequest): Promise<PageOutcome>;
}
