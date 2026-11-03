import { describe, expect, it } from "vitest";
import loggedIn from "./__fixtures__/x-user-withheld-logged-in.json";
import relay from "./__fixtures__/x-user-withheld-relay.json";
import { fillKnownUsers, findBlockedUsers } from "./profile";
import type { PostAuthor } from "./types";

const NOTICE = "@BlockedSample has been withheld in TR in response to a legal demand. Learn more.";

const author: PostAuthor = {
  id: "1800000000000000003",
  handle: "BlockedSample",
  name: "Sample",
  avatarUrl: "https://pbs.twimg.com/profile_images/1/a_normal.jpg",
  description: "",
  location: "",
  followers: 10,
  following: 1,
  statuses: 2,
  mediaCount: 0,
  likes: 0,
  joinedAt: "Thu Dec 30 14:44:08 +0000 2021",
  joinedAtMs: 1640875448000,
  website: { url: "http://example.com/sample", displayUrl: "example.com/sample" },
  blueVerified: true,
};

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** The shape of a normal signed-in response, which has no `legacy` user. */
function visibleUser(extra: Record<string, unknown> = {}) {
  return {
    data: {
      user: {
        result: {
          __typename: "User",
          rest_id: "5",
          core: { name: "Someone", screen_name: "someone" },
          profile_bio: { description: "A normal bio", entities: { description: {} } },
          relationship_counts: { followers: 1200, following: 3 },
          ...extra,
        },
      },
    },
  };
}

describe("findBlockedUsers", () => {
  it("finds the real signed-in response, where the flags sit under profile_bio", () => {
    expect(findBlockedUsers(loggedIn)).toMatchObject([{ id: "1800000000000000003", handle: "BlockedSample", country: "TR" }]);
  });

  it("finds the real signed-out response", () => {
    expect(findBlockedUsers(relay)).toMatchObject([{ id: "1800000000000000003", handle: "BlockedSample", country: "TR" }]);
  });

  it("does not depend on the notice's language", () => {
    const payload = clone(loggedIn);
    payload.data.user.result.profile_bio.description = "Bu hesap yasal bir talep nedeniyle gizlendi.";
    expect(findBlockedUsers(payload)).toHaveLength(1);
    payload.data.user.result.profile_bio.entities = { description: { urls: [] } };
    expect(findBlockedUsers(payload)).toHaveLength(1);
  });

  it("finds an account whose notice sits in the classic withheld description field", () => {
    const payload = { data: { user: { result: { __typename: "User", rest_id: "1", legacy: { screen_name: "a", withheld_description: NOTICE } } } } };
    expect(findBlockedUsers(payload)).toMatchObject([{ id: "1", country: "TR" }]);
  });

  it("leaves an account withheld elsewhere alone when it is fully visible here", () => {
    const payload = visibleUser();
    Object.assign(payload.data.user.result.profile_bio, { withheld_in_countries: ["DE"], with_held_scope: "user" });
    expect(findBlockedUsers(payload)).toEqual([]);
  });

  it("leaves a normal signed-in account alone", () => {
    expect(findBlockedUsers(visibleUser())).toEqual([]);
  });

  it("does not count an unavailable result as blocked", () => {
    expect(findBlockedUsers({ data: { user: { result: { __typename: "UserUnavailable", reason: "Suspended" } } } })).toEqual([]);
  });

  it("does not claim a country when several are listed and X names none", () => {
    const payload = clone(loggedIn);
    payload.data.user.result.profile_bio.description = "";
    payload.data.user.result.profile_bio.withheld_in_countries = ["TR", "DE"];
    expect(findBlockedUsers(payload)[0]?.country).toBeUndefined();
  });

  it("prefers the country the notice names over the first one listed", () => {
    const payload = clone(loggedIn);
    payload.data.user.result.profile_bio.withheld_in_countries = ["DE", "TR"];
    expect(findBlockedUsers(payload)[0]?.country).toBe("TR");
  });

  it("falls back to the requested handle and the Relay ID when fields are missing", () => {
    const payload = { data: { user: { result: { __typename: "User", id: btoa("User:42"), legacy: { withheld_description: NOTICE } } } } };
    expect(findBlockedUsers(payload, "BlockedSample")).toMatchObject([{ id: "42", handle: "BlockedSample" }]);
    expect(findBlockedUsers(payload)).toEqual([]);
  });
});

describe("fillKnownUsers", () => {
  const known = new Map([["1800000000000000003", author]]);

  it("fills a blocked account's copy nested deep in another response", () => {
    const payload = { data: { timeline: [{ tweet_results: { result: { core: { user_results: { result: clone(loggedIn).data.user.result } } } } }] } };
    expect(fillKnownUsers(payload, known)).toBe(true);
    const user = payload.data.timeline[0]?.tweet_results.result.core.user_results.result as unknown as { core: { name: string }; profile_bio: { with_held_scope: string } };
    expect(user.core.name).toBe("Sample");
    expect(user.profile_bio.with_held_scope).toBe("");
  });

  it("leaves other users and already visible copies alone", () => {
    const other = clone(loggedIn);
    other.data.user.result.rest_id = "9";
    expect(fillKnownUsers(other, known)).toBe(false);
    expect(other.data.user.result.core.name).toBe("");
    expect(fillKnownUsers(visibleUser({ rest_id: "1800000000000000003" }), known)).toBe(false);
  });
});

describe("filling a blocked account", () => {
  function filled() {
    const payload = clone(loggedIn);
    findBlockedUsers(payload)[0]?.fill(author);
    return payload.data.user.result as unknown as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  }

  it("restores what X stripped", () => {
    const user = filled();
    expect(user.core.name).toBe("Sample");
    expect(user.core.screen_name).toBe("BlockedSample");
    expect(user.avatar.image_url).toBe(author.avatarUrl);
  });

  it("removes the notice, and sends every flag empty so X's stored record clears too", () => {
    const user = filled();
    expect(user.profile_bio.description).toBe("");
    expect(JSON.stringify(user.profile_bio.entities)).not.toContain("withheld");
    expect(user.profile_bio.with_held_scope).toBe("");
    expect(user.profile_bio.withheld_description).toBe("");
    expect(user.profile_bio.withheld_in_countries).toEqual([]);
    expect(user.legacy.withheld_in_countries).toEqual([]);
    expect(user.legacy.withheld_scope).toBe("");
  });

  it("keeps X's own data about the viewer and the account", () => {
    const user = filled();
    expect(user.relationship_perspectives.following).toBe(true);
    expect(user.relationship_counts).toEqual({ followers: 543623, following: 4 });
    expect(user.tweet_counts).toEqual({ media_tweets: 1090, tweets: 7807 });
    expect(user.is_blue_verified).toBe(true);
    expect(user.rest_id).toBe("1800000000000000003");
  });

  it("points the website link and its display entity at the same URL", () => {
    const user = filled();
    expect(user.website.url).toBe("http://example.com/sample");
    expect(user.profile_bio.entities.url.urls[0]).toMatchObject({ url: "http://example.com/sample", display_url: "example.com/sample" });
  });

  it("keeps X's empty banner when the source has none either", () => {
    expect(filled().banner).toEqual({ image_url: "" });
  });

  it("uses the source's banner when it has one", () => {
    const payload = clone(loggedIn);
    findBlockedUsers(payload)[0]?.fill({ ...author, bannerUrl: "https://pbs.twimg.com/profile_banners/1/2" });
    expect(payload.data.user.result.banner).toEqual({ image_url: "https://pbs.twimg.com/profile_banners/1/2" });
  });
});
