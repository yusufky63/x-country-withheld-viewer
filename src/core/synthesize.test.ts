import { describe, expect, it } from "vitest";
import photo from "./__fixtures__/fx-status-photo.json";
import video from "./__fixtures__/fx-status-video.json";
import withheld from "./__fixtures__/fx-status-withheld-reply.json";
import { normalizeStatus } from "./normalize";
import { buildTweetResult, buildUser } from "./synthesize";

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

function build(raw: unknown): Json {
  const post = normalizeStatus(raw, "fxtwitter", 0);
  if (!post) throw new Error("fixture did not normalize");
  return buildTweetResult(post);
}

describe("buildTweetResult", () => {
  const reply = build(withheld.status);

  it("fills the fields the classic client reads", () => {
    expect(reply.__typename).toBe("Tweet");
    expect(reply.rest_id).toBe("1900000000000000002");
    expect(reply.legacy.id_str).toBe("1900000000000000002");
    expect(reply.legacy.full_text).toContain("Sample reply text");
    expect(reply.legacy.display_text_range).toEqual([15, 133]);
    expect(reply.legacy.in_reply_to_status_id_str).toBe("1900000000000000001");
    expect(reply.legacy.in_reply_to_screen_name).toBe("ExampleAuthor");
    expect(reply.legacy.entities.user_mentions[0].screen_name).toBe("ExampleAuthor");
    expect(reply.core.user_results.result.legacy.screen_name).toBe("example_replier");
    expect(reply.core.user_results.result.legacy.profile_image_url_https).toMatch(/_normal\.jpg$/);
    expect(reply.views).toEqual({ count: "2424", state: "EnabledWithCount" });
  });

  it("fills the fields the Relay client reads", () => {
    expect(reply.id).toBe(btoa("Tweet:1900000000000000002"));
    expect(reply.details.full_text).toContain("Sample reply text");
    expect(reply.details.created_at_ms).toBe(1793648911000);
    expect(reply.counts).toMatchObject({ reply_count: 0, favorite_count: 0 });
    expect(reply.mention_entities[0]).toEqual({ id_str: "1800000000000000001", indices: [0, 14], screen_name: "ExampleAuthor" });
    expect(reply.reply_to_results.rest_id).toBe("1900000000000000001");
    expect(reply.reply_to_user_results.result.core.screen_name).toBe("ExampleAuthor");
    expect(reply.core.user_results.result.avatar.image_url).toMatch(/_normal\.jpg$/);
    expect(reply.core.user_results.rest_id).toBe("1800000000000000002");
  });

  it("keeps IDs as strings", () => {
    expect(typeof reply.rest_id).toBe("string");
    expect(typeof reply.core.user_results.result.rest_id).toBe("string");
  });

  it("builds photo entities for both clients", () => {
    const tweet = build(photo.status);
    const entity = tweet.legacy.extended_entities.media[0];
    expect(entity).toMatchObject({
      type: "photo",
      id_str: "1900000000000000010",
      media_url_https: "https://pbs.twimg.com/media/SampleMediaKey.jpg",
      indices: [83, 106],
      original_info: { height: 800, width: 1233 },
      media_key: "3_1900000000000000010",
    });
    expect(entity.expanded_url).toBe("https://x.com/ExampleAuthor/status/1900000000000000001/photo/1");
    expect(tweet.media_entities2[0]).toBe(entity);
    expect(tweet.legacy.entities.media[0]).toBe(entity);
  });

  it("builds video entities the native player can stream", () => {
    const tweet = build(video.status);
    const entity = tweet.media_entities2[0];
    expect(entity.type).toBe("video");
    expect(entity.video_info.aspect_ratio).toEqual([16, 9]);
    expect(entity.video_info.duration_millis).toBeGreaterThan(0);
    expect(entity.video_info.variants[0].content_type).toBe("application/x-mpegURL");
    expect(tweet.url_entities[0].display_url).toBe("go.nasa.gov/4iuD8FZ");
  });

  it("nests a quoted post in the shape both clients unwrap", () => {
    const tweet = build({ ...withheld.status, quote: photo.status });
    expect(tweet.legacy.is_quote_status).toBe(true);
    expect(tweet.legacy.quoted_status_id_str).toBe("1900000000000000001");
    expect(tweet.quoted_status_result.result.rest_id).toBe("1900000000000000001");
  });

  it("does not offer X's translate action, which fails on withheld posts", () => {
    expect(reply.is_translatable).toBe(false);
  });
});

describe("buildUser", () => {
  it("clears the withheld flags so X renders a normal profile", () => {
    const post = normalizeStatus(withheld.status, "fxtwitter", 0);
    if (!post) throw new Error("fixture did not normalize");
    const user = buildUser(post.author) as Json;
    expect(user.legacy.withheld_in_countries).toEqual([]);
    expect(user.legacy.withheld_scope).toBe("");
    expect(user.relationship_counts).toEqual({ followers: 270, following: 45 });
    expect(user.core.name).toBe("Example Replier");
    expect(user.banner.image_url).toMatch(/^https:\/\/pbs\.twimg\.com\/profile_banners\//);
  });
});
