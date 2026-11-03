import { beforeEach, describe, expect, it, vi } from "vitest";
import profileFixture from "./__fixtures__/fx-profile-withheld.json";
import photo from "./__fixtures__/fx-status-photo.json";
import withheld from "./__fixtures__/fx-status-withheld-reply.json";
import statuses from "./__fixtures__/fx-user-statuses.json";
import detail from "./__fixtures__/x-tweetdetail-withheld.json";
import loggedInUser from "./__fixtures__/x-user-withheld-logged-in.json";
import blockedUser from "./__fixtures__/x-user-withheld-relay.json";
import { normalizeAuthor, normalizeStatus, normalizeStatusList } from "./normalize";
import { ResponseRewriter, type RewriteDeps } from "./rewrite";
import { decodeCursor, encodeCursor } from "./timeline";
import type { PostRecord, RecoveryItem } from "./types";

const WITHHELD_ID = "1900000000000000002";
const USER_ID = "1800000000000000003";
const reply = normalizeStatus(withheld.status, "fxtwitter", 0) as PostRecord;
const parent = normalizeStatus(photo.status, "fxtwitter", 0) as PostRecord;
const timelinePosts = normalizeStatusList(statuses.results, "fxtwitter", 0);
const author = normalizeAuthor(profileFixture.user);

function makeDeps(overrides: Partial<RewriteDeps> = {}): RewriteDeps {
  return {
    recover: vi.fn(async (items: RecoveryItem[]) => items.map(({ id }) => ({ id, status: "found" as const, post: reply }))),
    recoverProfile: vi.fn(async () => ({ status: "found" as const, author: author ?? undefined, source: "fxtwitter" as const })),
    userPosts: vi.fn(async () => ({ status: "found" as const, posts: timelinePosts, nextCursor: "NEXT", source: "fxtwitter" as const })),
    conversation: vi.fn(async () => ({ status: "found" as const, posts: [parent], source: "fxtwitter" as const })),
    ...overrides,
  };
}

const tweetDetail = { operation: "TweetDetail", variables: {} };

describe("ResponseRewriter tombstones", () => {
  it("replaces the tombstone so X renders the post itself", async () => {
    const outcome = await new ResponseRewriter(makeDeps()).rewrite(JSON.stringify(detail), tweetDetail);
    expect(outcome.text).not.toContain("TweetTombstone");
    expect(outcome.text).toContain("Sample reply text");
    expect(outcome.applied).toMatchObject([
      { id: WITHHELD_ID, handle: "example_replier", source: "fxtwitter", kind: "withheld", country: "Turkey", quoted: false },
    ]);
  });

  it("takes the conversation root from sibling posts", async () => {
    const outcome = await new ResponseRewriter(makeDeps()).rewrite(JSON.stringify(detail), tweetDetail);
    expect(JSON.parse(outcome.text).data.threaded_conversation_with_injections_v2.instructions[0].entries[1].content.items[0].item.itemContent.tweet_results.result.legacy.conversation_id_str).toBe(
      "1900000000000000001",
    );
  });

  it("does not touch X's body when a source has nothing", async () => {
    const original = JSON.stringify(detail);
    const deps = makeDeps({ recover: vi.fn(async () => [{ id: WITHHELD_ID, status: "not_found" as const }]) });
    const outcome = await new ResponseRewriter(deps).rewrite(original, tweetDetail);
    expect(outcome.text).toBe(original);
    expect(outcome.failed).toEqual([{ id: WITHHELD_ID, status: "not_found", message: expect.stringContaining("withheld in Turkey") }]);
  });

  it("stays silent and untouched when the extension is switched off", async () => {
    const original = JSON.stringify(detail);
    const deps = makeDeps({ recover: vi.fn(async () => [{ id: WITHHELD_ID, status: "disabled" as const }]) });
    const outcome = await new ResponseRewriter(deps).rewrite(original, tweetDetail);
    expect(outcome).toMatchObject({ text: original, applied: [], failed: [], profiles: [] });
  });

  it("makes no source request for a response without gaps", async () => {
    const deps = makeDeps();
    const text = '{"data":{"tweetResult":{"result":{"__typename":"Tweet","rest_id":"1"}}}}';
    expect((await new ResponseRewriter(deps).rewrite(text, tweetDetail)).text).toBe(text);
    expect(deps.recover).not.toHaveBeenCalled();
  });

  it("does not parse or report a large timeline with nothing to do", async () => {
    const parse = vi.spyOn(JSON, "parse");
    const text = '{"data":{"user":{"result":{"timeline":{}}}}}';
    const outcome = await new ResponseRewriter(makeDeps()).rewrite(text, { operation: "UserTweets", variables: { userId: "9" } });
    expect(parse).not.toHaveBeenCalled();
    parse.mockRestore();
    expect(outcome.text).toBe(text);
    expect(outcome.diagnostic).toBeUndefined();
  });

  it("returns non-JSON bodies unchanged", async () => {
    const text = "TweetTombstone but not JSON";
    expect((await new ResponseRewriter(makeDeps()).rewrite(text, tweetDetail)).text).toBe(text);
  });

  it("asks once per ID even if a post appears twice", async () => {
    const deps = makeDeps();
    const entries = detail.data.threaded_conversation_with_injections_v2.instructions[0]?.entries ?? [];
    const payload = { data: { first: entries, second: entries } };
    await new ResponseRewriter(deps).rewrite(JSON.stringify(payload), tweetDetail);
    expect(deps.recover).toHaveBeenCalledWith([{ id: WITHHELD_ID, handle: "example_replier" }]);
  });

  it("marks a Relay stub as missing rather than claiming a legal hold", async () => {
    const text = JSON.stringify({ data: { tweet_result_by_rest_id: { id: "x", rest_id: WITHHELD_ID } } });
    const outcome = await new ResponseRewriter(makeDeps()).rewrite(text, { operation: "TweetResultByRestId", variables: {} });
    expect(outcome.applied[0]).toMatchObject({ id: WITHHELD_ID, kind: "missing" });
    expect(JSON.parse(outcome.text).data.tweet_result_by_rest_id.result.details.full_text).toContain("Sample reply");
  });
});

describe("ResponseRewriter conversations", () => {
  const focalDetail = {
    data: {
      threaded_conversation_with_injections_v2: {
        instructions: [
          {
            type: "TimelineAddEntries",
            entries: [
              {
                entryId: `tweet-${WITHHELD_ID}`,
                sortIndex: "7000000000000000000",
                content: {
                  itemContent: {
                    tweet_results: {
                      result: {
                        __typename: "TweetTombstone",
                        tombstone: { text: { text: "This Post has been withheld in Turkey in response to a legal demand." } },
                      },
                    },
                  },
                },
              },
            ],
          },
        ],
      },
    },
  };
  const focalCtx = { operation: "TweetDetail", variables: { focalTweetId: WITHHELD_ID } };

  it("adds source replies when X returned none, below the focal post", async () => {
    const deps = makeDeps();
    const outcome = await new ResponseRewriter(deps).rewrite(JSON.stringify(focalDetail), focalCtx);
    const entries = JSON.parse(outcome.text).data.threaded_conversation_with_injections_v2.instructions[0].entries;
    expect(entries).toHaveLength(2);
    expect(entries[1].entryId).toBe(`conversationthread-${parent.id}`);
    expect(BigInt(entries[1].sortIndex) < BigInt(entries[0].sortIndex)).toBe(true);
    expect(outcome.applied.map((mark) => mark.id)).toEqual([WITHHELD_ID, parent.id]);
  });

  it("keeps X's replies and asks for nothing when it returned some", async () => {
    const deps = makeDeps();
    const withReplies = JSON.parse(JSON.stringify(focalDetail));
    withReplies.data.threaded_conversation_with_injections_v2.instructions[0].entries.push({
      entryId: "conversationthread-1",
      sortIndex: "1",
      content: {},
    });
    await new ResponseRewriter(deps).rewrite(JSON.stringify(withReplies), focalCtx);
    expect(deps.conversation).not.toHaveBeenCalled();
  });
});

describe("ResponseRewriter profiles", () => {
  let rewriter: ResponseRewriter;
  let deps: RewriteDeps;

  beforeEach(() => {
    deps = makeDeps();
    rewriter = new ResponseRewriter(deps);
  });

  const userCtx = { operation: "UserByScreenName", variables: { screenName: "BlockedSample" } };
  const timelineCtx = { operation: "UserTweets", variables: { userId: USER_ID, count: 20 } };

  it("turns the real blocked-account response into a normal profile", async () => {
    const outcome = await rewriter.rewrite(JSON.stringify(blockedUser), userCtx);
    const user = JSON.parse(outcome.text).data.user_result_by_screen_name.result;
    expect(deps.recoverProfile).toHaveBeenCalledWith({ id: USER_ID, handle: "BlockedSample" });
    expect(user.legacy.withheld_in_countries).toEqual([]);
    expect(user.legacy.withheld_scope).toBe("");
    expect(user.core.name).toBe("Sample");
    expect(user.relationship_perspectives).toEqual({ muting: false });
    expect(outcome.profiles).toEqual([{ handle: "BlockedSample", source: "fxtwitter", country: "TR" }]);
  });

  it("leaves an account withheld elsewhere alone when it is visible here", async () => {
    const visible = {
      data: {
        user: {
          result: {
            __typename: "User",
            rest_id: "5",
            core: { screen_name: "someone", name: "Someone" },
            legacy: { withheld_in_countries: ["DE"] },
            profile_bio: { description: "Just a normal bio" },
          },
        },
      },
    };
    const text = JSON.stringify(visible);
    expect((await rewriter.rewrite(text, userCtx)).text).toBe(text);
    expect(deps.recoverProfile).not.toHaveBeenCalled();
  });

  it("recovers the real signed-in response and shows its posts", async () => {
    const outcome = await rewriter.rewrite(JSON.stringify(loggedInUser), {
      operation: "UserByScreenName",
      variables: { screen_name: "BlockedSample", withGrokTranslatedBio: false },
    });
    const user = JSON.parse(outcome.text).data.user.result;
    expect(user.core.name).toBe("Sample");
    expect(user.relationship_perspectives.following).toBe(true);
    expect(outcome.profiles).toEqual([{ handle: "BlockedSample", source: "fxtwitter", country: "TR" }]);
    expect(outcome.diagnostic).toContain("user:User,fields=with_held_scope+withheld_in_countries");

    expect(rewriter.takesOverErrors(timelineCtx)).toBe(true);
    const timeline = JSON.parse((await rewriter.rewrite("", timelineCtx)).text);
    expect(timeline.data.user.result.timeline.timeline.instructions[0].entries[0].entryId).toMatch(/^tweet-/);
  });

  it("answers repeat lookups from memory, so a failing source cannot flip the profile back", async () => {
    const recoverProfile = vi
      .fn<RewriteDeps["recoverProfile"]>()
      .mockResolvedValueOnce({ status: "found", author: author ?? undefined, source: "fxtwitter" })
      .mockResolvedValue({ status: "provider_unavailable" });
    const memory = new ResponseRewriter(makeDeps({ recoverProfile }));
    const ctx = { operation: "UserByScreenName", variables: { screen_name: "BlockedSample" } };
    await memory.rewrite(JSON.stringify(loggedInUser), ctx);
    const again = await memory.rewrite(JSON.stringify(loggedInUser), ctx);
    expect(recoverProfile).toHaveBeenCalledTimes(1);
    expect(JSON.parse(again.text).data.user.result.core.name).toBe("Sample");
    expect(again.profiles).toHaveLength(1);
  });

  it("fills a REST list that repeats the account, and reports it", async () => {
    await rewriter.rewrite(JSON.stringify(loggedInUser), { operation: "UserByScreenName", variables: { screen_name: "BlockedSample" } });
    expect(rewriter.watchesRestUsers()).toBe(true);
    const body = { users: [{ id_str: USER_ID, screen_name: "BlockedSample", name: "", following: true, withheld_scope: "user", withheld_in_countries: ["TR"] }] };
    const outcome = await rewriter.rewrite(JSON.stringify(body), { operation: "rest:friends/following/list", variables: {}, transport: "xhr", status: 200 });
    const user = JSON.parse(outcome.text).users[0];
    expect(user).toMatchObject({ name: "Sample", following: true, withheld_scope: "" });
    expect(outcome.diagnostic).toContain("rest:friends/following/list");
    expect(outcome.diagnostic).toContain("copies=1");
  });

  it("does not read REST bodies before any account is recovered", () => {
    expect(rewriter.watchesRestUsers()).toBe(false);
  });

  it("keeps a recovered profile from flipping back when another response repeats the blocked copy", async () => {
    await rewriter.rewrite(JSON.stringify(loggedInUser), { operation: "UserByScreenName", variables: { screen_name: "BlockedSample" } });
    const nested = { data: { spotlights: { user_results: { result: loggedInUser.data.user.result } } } };
    const outcome = await rewriter.rewrite(JSON.stringify(nested), { operation: "ProfileSpotlightsQuery", variables: {} });
    const user = JSON.parse(outcome.text).data.spotlights.user_results.result;
    expect(user.core.name).toBe("Sample");
    expect(user.profile_bio.with_held_scope).toBe("");
  });

  it("does not add a post X already returned, and uses only the source's cursor", async () => {
    await rewriter.rewrite(JSON.stringify(blockedUser), userCtx);
    const id = timelinePosts[0]?.id;
    const body = {
      data: {
        user: {
          result: {
            timeline: {
              timeline: {
                instructions: [
                  {
                    type: "TimelineAddEntries",
                    entries: [
                      { entryId: `tweet-${id}`, sortIndex: "5", content: {} },
                      { entryId: "cursor-bottom-1", sortIndex: "1", content: { value: "X_CURSOR" } },
                    ],
                  },
                ],
              },
            },
          },
        },
      },
    };
    const parsed = JSON.parse((await rewriter.rewrite(JSON.stringify(body), timelineCtx)).text);
    const entries = parsed.data.user.result.timeline.timeline.instructions[0].entries as Array<{ entryId: string; content: { value?: string } }>;
    expect(entries.filter((entry) => entry.entryId === `tweet-${id}`)).toHaveLength(1);
    expect(JSON.stringify(entries)).not.toContain("X_CURSOR");
    expect(entries.at(-1)?.content.value?.startsWith("xcwv:")).toBe(true);
  });

  it("recovers a classic blocked account and fills its timeline by user ID", async () => {
    const classic = {
      data: {
        user: {
          result: {
            __typename: "User",
            rest_id: USER_ID,
            legacy: {
              screen_name: "BlockedSample",
              description: "",
              withheld_in_countries: ["TR"],
              withheld_description: "@BlockedSample has been withheld in TR in response to a legal demand. Learn more.",
            },
          },
        },
      },
    };
    const outcome = await rewriter.rewrite(JSON.stringify(classic), { operation: "UserByScreenName", variables: { screen_name: "BlockedSample" } });
    const user = JSON.parse(outcome.text).data.user.result;
    expect(user.legacy.name).toBe("Sample");
    expect(user.legacy.withheld_description).toBeUndefined();
    expect(outcome.profiles).toEqual([{ handle: "BlockedSample", source: "fxtwitter", country: "TR" }]);
    expect(rewriter.takesOverErrors(timelineCtx)).toBe(true);
  });

  it("keeps X's notice when no source has the profile", async () => {
    const text = JSON.stringify(blockedUser);
    const failing = makeDeps({ recoverProfile: vi.fn(async () => ({ status: "not_found" as const })) });
    const outcome = await new ResponseRewriter(failing).rewrite(text, userCtx);
    expect(outcome.text).toBe(text);
    expect(outcome.profiles).toEqual([]);
  });

  it("does not take over a timeline until the account is known to be blocked", async () => {
    expect(rewriter.takesOverErrors(timelineCtx)).toBe(false);
    await rewriter.rewrite(JSON.stringify(blockedUser), userCtx);
    expect(rewriter.takesOverErrors(timelineCtx)).toBe(true);
  });

  it("fills an empty timeline response, and keeps source order", async () => {
    await rewriter.rewrite(JSON.stringify(blockedUser), userCtx);
    const outcome = await rewriter.rewrite("", timelineCtx);
    const parsed = JSON.parse(outcome.text);
    const entries = parsed.data.user.result.timeline.timeline.instructions[0].entries;
    expect(entries.map((entry: { entryId: string }) => entry.entryId.replace(/\d+$/, ""))).toEqual(["tweet-", "tweet-", "cursor-bottom-"]);
    expect(BigInt(entries[0].sortIndex) > BigInt(entries[1].sortIndex)).toBe(true);
    expect(BigInt(entries[1].sortIndex) > BigInt(entries[2].sortIndex)).toBe(true);
    expect(outcome.applied).toHaveLength(2);
    expect(outcome.applied[0]).toMatchObject({ kind: "withheld", country: "TR" });
  });

  it("shows a repost with X's own social context line", async () => {
    await rewriter.rewrite(JSON.stringify(blockedUser), userCtx);
    const parsed = JSON.parse((await rewriter.rewrite("{}", timelineCtx)).text);
    const entries = parsed.data.user.result.timeline.timeline.instructions[0].entries;
    expect(entries[1].content.itemContent.socialContext).toMatchObject({ contextType: "Retweet", text: "Sample reposted" });
    expect(entries[0].content.itemContent.socialContext).toBeUndefined();
  });

  it("writes the repost line in the language it is given", async () => {
    const turkish = new ResponseRewriter(makeDeps({ repostLabel: (name) => `${name} yeniden gönderdi` }));
    await turkish.rewrite(JSON.stringify(blockedUser), userCtx);
    const parsed = JSON.parse((await turkish.rewrite("{}", timelineCtx)).text);
    const entries = parsed.data.user.result.timeline.timeline.instructions[0].entries;
    expect(entries[1].content.itemContent.socialContext.text).toBe("Sample yeniden gönderdi");
  });

  it("adds to the entries X did return instead of replacing the structure", async () => {
    await rewriter.rewrite(JSON.stringify(blockedUser), userCtx);
    const existing = { data: { user: { result: { timeline: { timeline: { instructions: [{ type: "TimelineAddEntries", entries: [] }] } } } } } };
    const parsed = JSON.parse((await rewriter.rewrite(JSON.stringify(existing), timelineCtx)).text);
    expect(parsed.data.user.result.timeline.timeline.instructions).toHaveLength(1);
    expect(parsed.data.user.result.timeline.timeline.instructions[0].entries).toHaveLength(3);
    expect(parsed.data.user.result.timeline_v2).toBeUndefined();
  });

  it("pages through the source with a cursor X's client hands back", async () => {
    await rewriter.rewrite(JSON.stringify(blockedUser), userCtx);
    const first = JSON.parse((await rewriter.rewrite("", timelineCtx)).text);
    const cursor = first.data.user.result.timeline.timeline.instructions[0].entries.at(-1).content.value as string;
    expect(cursor.startsWith("xcwv:")).toBe(true);

    const nextCtx = { operation: "UserTweets", variables: { userId: USER_ID, cursor } };
    expect(rewriter.takesOverErrors(nextCtx)).toBe(true);
    const next = await rewriter.rewrite('{"errors":[{"message":"bad cursor"}]}', nextCtx);
    expect(deps.userPosts).toHaveBeenLastCalledWith({ id: USER_ID, handle: "BlockedSample", withReplies: false, cursor: "NEXT" });
    expect(next.text).not.toContain("bad cursor");
    expect(JSON.parse(next.text).data.user.result.timeline.timeline.instructions[0].entries.length).toBeGreaterThan(0);
  });

  it("pages after a browser reload, since the cursor carries what it needs", async () => {
    const cursor = encodeCursor({ kind: "user", id: USER_ID, handle: "BlockedSample", cursor: "NEXT", next: "100", withReplies: true, country: "TR" });
    const outcome = await new ResponseRewriter(deps).rewrite("", { operation: "UserTweetsAndReplies", variables: { cursor } });
    expect(deps.userPosts).toHaveBeenCalledWith({ id: USER_ID, handle: "BlockedSample", withReplies: true, cursor: "NEXT" });
    expect(outcome.applied[0]).toMatchObject({ country: "TR" });
  });

  it("keeps only posts with media on the media tab", async () => {
    await rewriter.rewrite(JSON.stringify(blockedUser), userCtx);
    const noMedia = { ...reply, media: [] };
    const media = makeDeps({ userPosts: vi.fn(async () => ({ status: "found" as const, posts: [noMedia, parent], source: "fxtwitter" as const })) });
    const mediaRewriter = new ResponseRewriter(media);
    await mediaRewriter.rewrite(JSON.stringify(blockedUser), userCtx);
    const outcome = await mediaRewriter.rewrite("", { operation: "UserMedia", variables: { userId: USER_ID } });
    expect(outcome.applied.map((mark) => mark.id)).toEqual([parent.id]);
  });

  describe("profile tabs on the classic client", () => {
    const original = timelinePosts[0] as PostRecord;
    const repost = timelinePosts[1] as PostRecord;
    const reply = { ...original, id: "301", parentId: "9", media: [], repostedBy: undefined };
    const video = { ...original, id: "302", media: [{ id: "5", type: "video" as const, url: "https://pbs.twimg.com/v.jpg", width: 1, height: 1 }] };
    const photoPost = { ...original, id: "303", media: [{ id: "6", type: "photo" as const, url: "https://pbs.twimg.com/p.jpg", width: 1, height: 1 }] };
    const all = [{ ...original, media: [] }, repost, reply, video, photoPost];

    async function tab(operation: string, posts: PostRecord[] = all) {
      const tabDeps = makeDeps({ userPosts: vi.fn(async () => ({ status: "found" as const, posts, source: "fxtwitter" as const })) });
      const tabRewriter = new ResponseRewriter(tabDeps);
      await tabRewriter.rewrite(JSON.stringify(loggedInUser), { operation: "UserByScreenName", variables: { screen_name: "BlockedSample" } });
      const ctx = { operation, variables: { userId: USER_ID, count: 20 } };
      expect(tabRewriter.takesOverErrors(ctx)).toBe(true);
      const outcome = await tabRewriter.rewrite('{"data":{"user":{"result":{"__typename":"User"}}}}', ctx);
      return { outcome, deps: tabDeps, parsed: JSON.parse(outcome.text) };
    }
    const ids = (outcome: { applied: { id: string }[] }) => outcome.applied.map((mark) => mark.id);

    it("answers the default Posts view in the shape the classic client reads", async () => {
      const { parsed, outcome } = await tab("UserOriginalsTimeline");
      expect(parsed.data.user.result.__typename).toBe("User");
      expect(parsed.data.user.result.timeline.timeline.instructions[0].entries[0].entryId).toMatch(/^tweet-/);
      expect(parsed.data.user_result_by_screen_name).toBeUndefined();
      expect(ids(outcome)).not.toContain(repost.id);
    });

    it("shows everything on All", async () => {
      expect(ids((await tab("UserTweets")).outcome)).toHaveLength(all.length);
    });

    it("shows only reposts on Reposts", async () => {
      expect(ids((await tab("UserRepostsTimeline")).outcome)).toEqual([repost.id]);
    });

    it("asks for replies and shows only replies on Replies", async () => {
      const { outcome, deps: tabDeps } = await tab("UserRepliesTimeline");
      expect(ids(outcome)).toEqual(["301"]);
      expect(tabDeps.userPosts).toHaveBeenCalledWith(expect.objectContaining({ withReplies: true }));
    });

    it("splits media by type", async () => {
      expect(ids((await tab("UserPhotoTimeline")).outcome)).toEqual(["303"]);
      expect(ids((await tab("UserVideoTimeline")).outcome)).toEqual(["302"]);
      expect(ids((await tab("UserMedia")).outcome)).toEqual(expect.arrayContaining(["302", "303"]));
    });

    it("reads more source pages when a filter leaves too few posts, and stops at the limit", async () => {
      const userPosts = vi.fn(async () => ({ status: "found" as const, posts: [repost], nextCursor: "MORE", source: "fxtwitter" as const }));
      const filterRewriter = new ResponseRewriter(makeDeps({ userPosts }));
      await filterRewriter.rewrite(JSON.stringify(loggedInUser), { operation: "UserByScreenName", variables: { screen_name: "BlockedSample" } });
      const outcome = await filterRewriter.rewrite("", { operation: "UserOriginalsTimeline", variables: { userId: USER_ID } });
      expect(userPosts).toHaveBeenCalledTimes(4);
      expect(outcome.applied).toEqual([]);
      expect(JSON.parse(outcome.text).data.user.result.timeline.timeline.instructions[0].entries.at(-1).content.value).toMatch(/^xcwv:/);
    });

    it("keeps what it read when a later source page fails", async () => {
      const userPosts = vi
        .fn<RewriteDeps["userPosts"]>()
        .mockResolvedValueOnce({ status: "found", posts: [original], nextCursor: "MORE", source: "fxtwitter" })
        .mockResolvedValueOnce({ status: "rate_limited", posts: [] });
      const filterRewriter = new ResponseRewriter(makeDeps({ userPosts }));
      await filterRewriter.rewrite(JSON.stringify(loggedInUser), { operation: "UserByScreenName", variables: { screen_name: "BlockedSample" } });
      const outcome = await filterRewriter.rewrite("", { operation: "UserOriginalsTimeline", variables: { userId: USER_ID } });
      expect(ids(outcome)).toEqual([original.id]);
    });

    it("keeps the same tab's filter when scrolling for more", async () => {
      const { parsed, deps: tabDeps } = await tab("UserRepostsTimeline");
      expect(parsed.data.user.result.timeline.timeline.instructions[0].entries).toHaveLength(1);
      const paging = makeDeps({ userPosts: vi.fn(async () => ({ status: "found" as const, posts: all, source: "fxtwitter" as const })) });
      const cursor = encodeCursor({ kind: "user", id: USER_ID, handle: "BlockedSample", cursor: "NEXT", next: "100", withReplies: false });
      const next = await new ResponseRewriter(paging).rewrite("", { operation: "UserRepostsTimeline", variables: { userId: USER_ID, cursor } });
      expect(ids(next)).toEqual([repost.id]);
      expect(tabDeps.userPosts).toHaveBeenCalled();
    });

    it("leaves tabs it cannot fill alone", async () => {
      const text = '{"data":{}}';
      const other = await rewriter.rewrite(text, { operation: "UserArticlesTweets", variables: { userId: USER_ID } });
      expect(other.text).toBe(text);
    });
  });

  describe("on the Relay client", () => {
    const relayCtx = {
      operation: "UserOriginalsTimeline",
      variables: { screenName: "blockedsample", count: 20, cursor: null, __relay_internal__pv__x: false },
    };

    it("answers X's 404 with the shape its query reads, matched by handle", async () => {
      await rewriter.rewrite(JSON.stringify(blockedUser), userCtx);
      expect(rewriter.takesOverErrors(relayCtx)).toBe(true);
      const outcome = await rewriter.rewrite("", relayCtx);
      const parsed = JSON.parse(outcome.text);
      const timeline = parsed.data.user_result_by_screen_name.result.profile_user_originals_timeline.timeline;
      expect(timeline.instructions[0].__typename).toBe("TimelineAddEntries");
      const entries = timeline.instructions[0].entries;
      const [first, cursor] = entries;
      expect(first.entry_id).toBe(`tweet-${timelinePosts[0]?.id}`);
      expect(BigInt(first.sort_index) > BigInt(cursor.sort_index)).toBe(true);
      expect(first.content.__typename).toBe("TimelineTimelineItem");
      expect(first.content.content.__typename).toBe("TimelineTweet");
      expect(first.content.content.tweet_results.result.details.full_text).toBeTruthy();
      expect(cursor.content).toMatchObject({ __typename: "TimelineTimelineCursor", cursor_type: "Bottom" });
      expect(outcome.applied.map((mark) => mark.id)).toEqual([timelinePosts[0]?.id]);
    });

    it("pages in the same shape", async () => {
      await rewriter.rewrite(JSON.stringify(blockedUser), userCtx);
      const first = JSON.parse((await rewriter.rewrite("", relayCtx)).text);
      const entries = first.data.user_result_by_screen_name.result.profile_user_originals_timeline.timeline.instructions[0].entries;
      const cursor = entries.at(-1).content.value as string;
      const next = await rewriter.rewrite("", { ...relayCtx, variables: { ...relayCtx.variables, cursor } });
      const parsed = JSON.parse(next.text);
      expect(parsed.data.user_result_by_screen_name.result.profile_user_originals_timeline.timeline.instructions[0].entries[0].entry_id).toMatch(/^tweet-/);
      expect(deps.userPosts).toHaveBeenLastCalledWith({ id: USER_ID, handle: "BlockedSample", withReplies: false, cursor: "NEXT" });
    });

    it("leaves a normal profile's failed timeline as X left it", async () => {
      expect(rewriter.takesOverErrors({ ...relayCtx, variables: { screenName: "jack" } })).toBe(false);
    });
  });

  describe("diagnostics", () => {
    it("reports the shape of a user lookup, including a blocked one", async () => {
      const outcome = await rewriter.rewrite(JSON.stringify(blockedUser), { ...userCtx, transport: "fetch", status: 200 });
      expect(outcome.diagnostic).toContain("fetch UserByScreenName status=200");
      expect(outcome.diagnostic).toContain("user_result_by_screen_name:User,legacy,fields=withheld_in_countries+withheld_scope");
      expect(outcome.diagnostic).toContain("blocked=1:found");
      expect(outcome.diagnostic).toContain("profiles=1");
    });

    it("names which withheld fields X sent and how the source answered", async () => {
      const text = JSON.stringify({
        data: { user: { result: { __typename: "User", rest_id: USER_ID, legacy: { screen_name: "BlockedSample", withheld_description: "x has been withheld" } } } },
      });
      const failing = makeDeps({ recoverProfile: vi.fn(async () => ({ status: "not_found" as const })) });
      const outcome = await new ResponseRewriter(failing).rewrite(text, { ...userCtx, transport: "xhr", status: 200 });
      expect(outcome.diagnostic).toContain("fields=withheld_description");
      expect(outcome.diagnostic).toContain("blocked=1:not_found");
    });

    it("reports a user lookup that came back without a withheld flag", async () => {
      const text = JSON.stringify({ data: { user: { result: { __typename: "UserUnavailable" } } } });
      const outcome = await rewriter.rewrite(text, { ...userCtx, transport: "xhr", status: 200 });
      expect(outcome.text).toBe(text);
      expect(outcome.diagnostic).toContain("xhr UserByScreenName");
      expect(outcome.diagnostic).toContain("user:UserUnavailable");
    });

    it("never carries post text", async () => {
      const outcome = await rewriter.rewrite(JSON.stringify(detail), tweetDetail);
      expect(outcome.diagnostic).not.toContain("Sample reply");
      expect(outcome.diagnostic).toContain("applied=1");
    });
  });

  it("leaves other accounts' timelines alone", async () => {
    await rewriter.rewrite(JSON.stringify(blockedUser), userCtx);
    const text = '{"data":{}}';
    expect((await rewriter.rewrite(text, { operation: "UserTweets", variables: { userId: "9" } })).text).toBe(text);
    expect(deps.userPosts).not.toHaveBeenCalled();
  });
});

describe("cursor encoding", () => {
  it("round-trips non-ASCII safely", () => {
    const cursor = { kind: "conversation", id: "1", cursor: "ğüş", next: "5" } as const;
    expect(decodeCursor(encodeCursor(cursor))).toEqual(cursor);
  });

  it("ignores X's own cursors and malformed values", () => {
    expect(decodeCursor("DAABCgABHWOU")).toBeNull();
    expect(decodeCursor("xcwv:not-base64!")).toBeNull();
    expect(decodeCursor(null)).toBeNull();
    expect(decodeCursor(`xcwv:${btoa(encodeURIComponent(JSON.stringify({ kind: "user", id: "abc", cursor: "", next: "1" })))}`)).toBeNull();
  });
});
