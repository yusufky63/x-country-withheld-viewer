import { createLimiter } from "../core/limiter";
import type { PostsPage, ProfileResult, ProviderId, RecoveryItem, RecoveryResult, RecoveryStatus, Settings } from "../core/types";
import type { ConversationRequest, Miss, PageOutcome, Provider, UserPostsRequest, UserRef } from "../providers/types";
import { NEGATIVE_TTL_MS, POSITIVE_TTL_MS, type ResultCache } from "./result-cache";

export const MAX_CONCURRENT_REQUESTS = 2;
export const MAX_RETRIES = 2;
export const RETRY_BASE_MS = 400;
export const RATE_LIMIT_COOLDOWN_MS = 60_000;
export const OUTAGE_COOLDOWN_MS = 30_000;

// A definite answer ends the search. x.md shares FxTwitter's upstream, so asking it
// after "private" or "deleted" would only spend another request on the same answer.
const DEFINITE: ReadonlySet<RecoveryStatus> = new Set(["deleted", "private", "suspended"]);
const TRANSIENT: ReadonlySet<RecoveryStatus> = new Set(["rate_limited", "provider_unavailable"]);
const STATUS_RANK: RecoveryStatus[] = ["private", "suspended", "deleted", "not_found", "rate_limited", "provider_unavailable"];

export interface RouterDeps {
  providers: Provider[];
  cache: ResultCache;
  getSettings: () => Promise<Settings>;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

type Found<T> = T extends { kind: "found" } ? T : never;

export class ProviderRouter {
  readonly #deps: RouterDeps;
  readonly #now: () => number;
  readonly #sleep: (ms: number) => Promise<void>;
  readonly #limit = createLimiter(MAX_CONCURRENT_REQUESTS);
  readonly #inFlight = new Map<string, Promise<unknown>>();
  readonly #cooldownUntil = new Map<ProviderId, number>();

  constructor(deps: RouterDeps) {
    this.#deps = deps;
    this.#now = deps.now ?? Date.now;
    this.#sleep = deps.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  async recover(items: RecoveryItem[]): Promise<RecoveryResult[]> {
    const settings = await this.#deps.getSettings();
    if (!settings.enabled) return items.map(({ id }) => ({ id, status: "disabled" }));
    return Promise.all(
      items.map((item) => this.#dedupe(`post:${item.id}`, () => this.#resolvePost(item, settings))),
    );
  }

  async recoverProfile(user: UserRef): Promise<ProfileResult> {
    const settings = await this.#deps.getSettings();
    if (!settings.enabled) return { status: "disabled" };
    return this.#dedupe(`user:${user.id}`, async () => {
      const key = `user:${user.id}`;
      const cached = await this.#deps.cache.get<ProfileResult>(key);
      if (cached) return cached;
      const outcome = await this.#firstFound(settings, (provider) => provider.fetchProfile(user));
      const result: ProfileResult =
        outcome.kind === "found"
          ? { status: "found", author: outcome.value.author, source: outcome.source }
          : { status: outcome.status };
      await this.#store(key, result.status, result);
      return result;
    });
  }

  async userPosts(request: UserPostsRequest): Promise<PostsPage> {
    const key = `posts:${request.id}:${request.withReplies ? "r" : "t"}:${request.cursor ?? ""}`;
    return this.#page(key, (provider) => provider.fetchUserPosts(request));
  }

  async conversation(request: ConversationRequest): Promise<PostsPage> {
    const key = `conversation:${request.id}:${request.cursor ?? ""}`;
    return this.#page(key, (provider) => provider.fetchConversation?.(request));
  }

  async #page(key: string, call: (provider: Provider) => Promise<PageOutcome> | undefined): Promise<PostsPage> {
    const settings = await this.#deps.getSettings();
    if (!settings.enabled) return { status: "disabled", posts: [] };
    return this.#dedupe(key, async () => {
      const cached = await this.#deps.cache.get<PostsPage>(key);
      if (cached) return cached;
      const outcome = await this.#firstFound(settings, call);
      const page: PostsPage =
        outcome.kind === "found"
          ? {
              status: "found",
              posts: outcome.value.posts,
              source: outcome.source,
              ...(outcome.value.nextCursor ? { nextCursor: outcome.value.nextCursor } : {}),
            }
          : { status: outcome.status, posts: [] };
      await this.#store(key, page.status, page, NEGATIVE_TTL_MS);
      return page;
    });
  }

  #dedupe<T>(key: string, task: () => Promise<T>): Promise<T> {
    const running = this.#inFlight.get(key);
    if (running) return running as Promise<T>;
    const started = task().finally(() => this.#inFlight.delete(key));
    this.#inFlight.set(key, started);
    return started;
  }

  async #resolvePost(item: RecoveryItem, settings: Settings): Promise<RecoveryResult> {
    const key = `post:${item.id}`;
    const cached = await this.#deps.cache.get<RecoveryResult>(key);
    if (cached) return cached;
    const outcome = await this.#firstFound(settings, (provider) => provider.fetchStatus(item));
    const result: RecoveryResult =
      outcome.kind === "found"
        ? { id: item.id, status: "found", post: outcome.value.post }
        : { id: item.id, status: outcome.status };
    await this.#store(key, result.status, result);
    await this.#deps.cache.recordOutcome(outcome.kind === "found" ? 1 : 0, outcome.kind === "found" ? 0 : 1);
    return result;
  }

  /** Transient failures are not stored: the next page load should try again. */
  async #store(key: string, status: RecoveryStatus, value: unknown, foundTtlMs = POSITIVE_TTL_MS): Promise<void> {
    if (TRANSIENT.has(status)) return;
    await this.#deps.cache.set(key, value, status === "found" ? foundTtlMs : NEGATIVE_TTL_MS);
  }

  async #firstFound<T extends { kind: "found" } | Miss>(
    settings: Settings,
    call: (provider: Provider) => Promise<T> | undefined,
  ): Promise<{ kind: "found"; value: Found<T>; source: ProviderId } | { kind: "miss"; status: RecoveryStatus }> {
    const providers = this.#deps.providers.filter((provider) => provider.id !== "xmd" || settings.useXmdFallback);
    const misses: RecoveryStatus[] = [];
    for (const provider of providers) {
      const outcome = await this.#ask(provider, call);
      if (outcome === undefined) continue;
      if (outcome.kind === "found") return { kind: "found", value: outcome as Found<T>, source: provider.id };
      misses.push((outcome as Miss).status);
      if (DEFINITE.has((outcome as Miss).status)) break;
    }
    return { kind: "miss", status: STATUS_RANK.find((candidate) => misses.includes(candidate)) ?? "provider_unavailable" };
  }

  async #ask<T extends { kind: "found" } | Miss>(
    provider: Provider,
    call: (provider: Provider) => Promise<T> | undefined,
  ): Promise<T | Miss | undefined> {
    if ((this.#cooldownUntil.get(provider.id) ?? 0) > this.#now()) {
      return { kind: "miss", status: "rate_limited" };
    }
    for (let attempt = 0; ; attempt += 1) {
      const pending = this.#limit(async () => call(provider));
      const outcome = await pending;
      if (outcome === undefined) return undefined;
      const miss = outcome.kind === "miss" ? (outcome as Miss) : undefined;
      if (!miss || miss.status !== "provider_unavailable" || attempt >= MAX_RETRIES) {
        if (miss) this.#applyCooldown(provider.id, miss);
        return outcome;
      }
      await this.#sleep(RETRY_BASE_MS * 2 ** attempt);
    }
  }

  #applyCooldown(id: ProviderId, miss: Miss): void {
    if (miss.status === "rate_limited") {
      this.#cooldownUntil.set(id, this.#now() + (miss.retryAfterMs ?? RATE_LIMIT_COOLDOWN_MS));
    } else if (miss.status === "provider_unavailable") {
      this.#cooldownUntil.set(id, this.#now() + OUTAGE_COOLDOWN_MS);
    }
  }

  async clear(): Promise<void> {
    this.#cooldownUntil.clear();
    await this.#deps.cache.clear();
  }
}
