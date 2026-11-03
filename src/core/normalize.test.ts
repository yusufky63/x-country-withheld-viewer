import { describe, expect, it } from "vitest";
import photo from "./__fixtures__/fx-status-photo.json";
import video from "./__fixtures__/fx-status-video.json";
import withheld from "./__fixtures__/fx-status-withheld-reply.json";
import { normalizeStatus, normalizeStatusList } from "./normalize";

const NOW = 1_800_000_000_000;

describe("normalizeStatus", () => {
  it("reads the real withheld reply", () => {
    const post = normalizeStatus(withheld.status, "fxtwitter", NOW);
    expect(post).toMatchObject({
      id: "1900000000000000002",
      parentId: "1900000000000000001",
      parentHandle: "ExampleAuthor",
      parentUserId: "1800000000000000001",
      displayRange: [15, 133],
      lang: "tr",
      source: "fxtwitter",
    });
    expect(post?.text).toContain("Sample reply text");
    expect(post?.author.handle).toBe("example_replier");
    expect(post?.mentions).toEqual([{ id: "1800000000000000001", handle: "ExampleAuthor", indices: [0, 14] }]);
  });

  it("converts the avatar to the file name X derives other sizes from", () => {
    const post = normalizeStatus(withheld.status, "fxtwitter", NOW);
    expect(post?.author.avatarUrl).toBe("https://pbs.twimg.com/profile_images/1000000000000000002/replier_normal.jpg");
  });

  it("strips the size query from photos so X can add its own", () => {
    const post = normalizeStatus(photo.status, "fxtwitter", NOW);
    expect(post?.media).toMatchObject([
      {
        type: "photo",
        id: "1900000000000000010",
        url: "https://pbs.twimg.com/media/SampleMediaKey.jpg",
        width: 1233,
        height: 800,
        shortUrl: "https://t.co/sampleLink",
      },
    ]);
  });

  it("maps video formats to X's variant content types", () => {
    const post = normalizeStatus(video.status, "fxtwitter", NOW);
    const media = post?.media[0];
    expect(media?.type).toBe("video");
    expect(media?.url).toMatch(/^https:\/\/pbs\.twimg\.com\//);
    expect(media?.durationMs).toBeGreaterThan(0);
    expect(media?.variants?.[0]).toMatchObject({ contentType: "application/x-mpegURL" });
    expect(media?.variants?.some((variant) => variant.contentType === "video/mp4" && variant.bitrate)).toBe(true);
  });

  it("keeps X's entity escaping so indices stay aligned", () => {
    const raw = { ...withheld.status, raw_text: { text: "Q&amp;A", display_text_range: [0, 7], facets: [] } };
    expect(normalizeStatus(raw, "fxtwitter", NOW)?.text).toBe("Q&amp;A");
  });

  it("escapes plain text when a source sends no raw text", () => {
    const raw = { ...withheld.status, raw_text: undefined, text: "a<b & c" };
    expect(normalizeStatus(raw, "fxtwitter", NOW)?.text).toBe("a&lt;b &amp; c");
  });

  it("refuses tombstones, so an HTTP 200 alone never counts as content", () => {
    expect(normalizeStatus({ type: "tombstone", reason: "deleted", id: "1" }, "fxtwitter", NOW)).toBeNull();
  });

  it("drops media hosted outside X's CDNs", () => {
    const raw = {
      ...photo.status,
      media: { all: [{ type: "photo", id: "1", url: "https://evil.example/x.jpg", width: 1, height: 1 }] },
    };
    expect(normalizeStatus(raw, "fxtwitter", NOW)?.media).toEqual([]);
  });

  it("drops script links from text entities", () => {
    const raw = {
      ...withheld.status,
      raw_text: {
        text: "link",
        display_text_range: [0, 4],
        facets: [{ type: "url", indices: [0, 4], original: "javascript:alert(1)", replacement: "javascript:alert(1)" }],
      },
    };
    expect(normalizeStatus(raw, "fxtwitter", NOW)?.urls).toEqual([]);
  });

  it("appends poll results as plain text", () => {
    const raw = { ...withheld.status, poll: { choices: [{ label: "Yes", count: 3, percentage: 75 }, { label: "No", count: 1, percentage: 25 }] } };
    expect(normalizeStatus(raw, "fxtwitter", NOW)?.text).toMatch(/Yes: 75%\nNo: 25%$/);
  });
});

describe("normalizeStatusList", () => {
  it("skips protected authors and malformed rows", () => {
    const hidden = { ...withheld.status, author: { ...withheld.status.author, protected: true } };
    const posts = normalizeStatusList([withheld.status, hidden, { type: "tombstone" }, null], "fxtwitter", NOW);
    expect(posts.map((post) => post.id)).toEqual(["1900000000000000002"]);
  });
});
