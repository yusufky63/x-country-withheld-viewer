import { describe, expect, it } from "vitest";
import detail from "./__fixtures__/x-tweetdetail-withheld.json";
import { findConversationId, findHits, mightContainHits, type RequestContext } from "./withheld-detector";

const ctx: RequestContext = { operation: "TweetDetail", variables: {} };

function tombstone(text: string, url?: string) {
  return {
    __typename: "TweetTombstone",
    tombstone: {
      __typename: "TextTombstone",
      text: { text, ...(url ? { entities: [{ ref: { url } }] } : {}) },
    },
  };
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

describe("findHits", () => {
  it("finds the withheld reply from the real TweetDetail sample", () => {
    const hits = findHits(clone(detail), ctx);
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({
      id: "1900000000000000002",
      kind: "withheld",
      country: "Turkey",
      handle: "example_replier",
      quoted: false,
    });
  });

  it("writes the recovered tweet into the same slot", () => {
    const payload = clone(detail);
    findHits(payload, ctx)[0]?.fill({ __typename: "Tweet", rest_id: "1900000000000000002" });
    expect(JSON.stringify(payload)).not.toContain("TweetTombstone");
    expect(JSON.stringify(payload)).toContain('"tweetDisplayType":"Tweet"');
  });

  it("ignores tombstones that are not a legal hold", () => {
    const payload = {
      entryId: "tweet-123",
      item: { itemContent: { tweet_results: { result: tombstone("This Post was deleted by the Post author. Learn more") } } },
    };
    expect(findHits(payload, ctx)).toEqual([]);
  });

  it("recognizes a translated tombstone by its help link", () => {
    const payload = {
      entryId: "tweet-123",
      item: {
        itemContent: {
          tweet_results: {
            result: tombstone("Dieser Post ist nicht verfügbar.", "https://help.x.com/en/rules-and-policies/post-withheld-by-country"),
          },
        },
      },
    };
    expect(findHits(payload, ctx)).toMatchObject([{ id: "123", kind: "withheld" }]);
  });

  it("recognizes a Turkish tombstone by its wording", () => {
    const payload = {
      entryId: "tweet-123",
      item: { itemContent: { tweet_results: { result: tombstone("Bu Gönderi yasal bir talep nedeniyle Türkiye'de gizlendi.") } } },
    };
    expect(findHits(payload, ctx)).toMatchObject([{ id: "123" }]);
  });

  it("takes a quoted tombstone's ID from the quoting tweet, not the entry", () => {
    const payload = {
      entryId: "tweet-999",
      content: {
        tweet_results: {
          result: {
            __typename: "Tweet",
            rest_id: "999",
            legacy: { quoted_status_id_str: "555" },
            quoted_status_result: { result: tombstone("This Post has been withheld in Turkey in response to a legal demand.") },
          },
        },
      },
    };
    expect(findHits(payload, ctx)).toMatchObject([{ id: "555", quoted: true }]);
  });

  it("handles the older TimelineTombstone item shape", () => {
    const itemContent = {
      itemType: "TimelineTombstone",
      tombstoneInfo: { richText: { text: "This Post is withheld.", entities: [] } },
    };
    const hits = findHits({ entryId: "tweet-77", content: { itemContent } }, ctx);
    expect(hits).toMatchObject([{ id: "77", kind: "withheld" }]);
    hits[0]?.fill({ __typename: "Tweet" });
    expect(itemContent).toMatchObject({ itemType: "TimelineTweet", tweet_results: { result: { __typename: "Tweet" } } });
  });

  it("reads a single-post lookup's ID from the request variables", () => {
    const payload = { data: { tweetResult: { result: tombstone("This Post has been withheld in Turkey in response to a legal demand.") } } };
    expect(findHits(payload, { operation: "TweetResultByRestId", variables: { tweetId: "42" } })).toMatchObject([{ id: "42" }]);
  });

  it("treats the Relay client's result-less stub as missing, not as withheld", () => {
    const payload = { data: { tweet_result_by_rest_id: { id: "abc", rest_id: "1900000000000000002" } } };
    expect(findHits(payload, ctx)).toMatchObject([{ id: "1900000000000000002", kind: "missing" }]);
  });

  it("does not treat a reply reference as a missing post", () => {
    const payload = { reply_to_results: { __typename: "TweetResults", id: "abc", rest_id: "1" } };
    expect(findHits(payload, ctx)).toEqual([]);
  });

  it("leaves real tweets alone", () => {
    const payload = { tweet_results: { result: { __typename: "Tweet", rest_id: "1", legacy: { full_text: "hello" } } } };
    expect(findHits(payload, ctx)).toEqual([]);
  });
});

describe("mightContainHits", () => {
  it("catches both clients' shapes without parsing", () => {
    expect(mightContainHits(JSON.stringify(detail))).toBe(true);
    expect(mightContainHits('{"data":{"tweet_result_by_rest_id":{"id":"a","rest_id":"1"}}}')).toBe(true);
    expect(mightContainHits('{"data":{"tweet_result_by_rest_id":{"id":"a","rest_id":"1","result":{"__typename":"Tweet"}}}}')).toBe(false);
  });
});

describe("findConversationId", () => {
  it("reads the root from a sibling post", () => {
    expect(findConversationId(detail)).toBe("1900000000000000001");
  });
});
