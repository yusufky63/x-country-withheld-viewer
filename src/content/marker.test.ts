// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppliedMark } from "../core/types";
import { Marker, markTitle, profileMarkTitle } from "./marker";

const CREATED_AT = 1793648911000;
const ISO = new Date(CREATED_AT).toISOString();

const mark: AppliedMark = {
  id: "1900000000000000002",
  handle: "example_replier",
  createdAtMs: CREATED_AT,
  source: "fxtwitter",
  kind: "withheld",
  country: "Turkey",
  quoted: false,
};

function marks() {
  return document.querySelectorAll<HTMLElement>(".xcwv-mark");
}

describe("markTitle", () => {
  it("names the place and the source", () => {
    expect(markTitle(mark)).toBe("Withheld in Turkey. Shown from FxTwitter.");
    expect(markTitle({ ...mark, country: undefined, source: "xmd" })).toBe("Withheld in your country. Shown from x.md.");
  });

  it("does not claim a legal hold it has no evidence for", () => {
    expect(markTitle({ ...mark, kind: "missing" })).toBe("Not available on X here. Shown from FxTwitter.");
  });

  it("spells out X's ISO country codes on profiles", () => {
    expect(profileMarkTitle({ handle: "a", source: "fxtwitter", country: "TR" })).toMatch(/^Account withheld in (Türkiye|Turkey)\. Shown from FxTwitter\.$/);
  });
});

describe("Marker", () => {
  let marker: Marker;

  beforeEach(() => {
    document.body.innerHTML = "<main></main>";
    marker = new Marker(document);
  });

  function article(id: string, handle = "example_replier") {
    return `<article><a href="/${handle}/status/${id}/analytics">stats</a><a id="time" href="/${handle}/status/${id}"><time datetime="${ISO}">3h</time></a><a href="/${handle}/status/${id}">views</a></article>`;
  }

  it("adds one icon right after the post's first permalink", () => {
    document.querySelector("main")!.innerHTML = article(mark.id);
    marker.add([mark], []);
    marker.scan();
    expect(marks()).toHaveLength(1);
    expect(marks()[0]?.previousElementSibling?.id).toBe("time");
    expect(marks()[0]?.title).toBe("Withheld in Turkey. Shown from FxTwitter.");
    expect(marks()[0]?.getAttribute("aria-label")).toBe("Withheld in Turkey. Shown from FxTwitter.");
  });

  it("accepts the query X's mobile links carry, but not media links", () => {
    document.querySelector("main")!.innerHTML = `<article><a href="/a/status/${mark.id}/photo/1">photo</a><a id="time" href="https://m.x.com/a/status/${mark.id}?launch_app_store=true">3h</a></article>`;
    marker.add([mark], []);
    marker.scan();
    marker.scan();
    expect(marks()).toHaveLength(1);
    expect(marks()[0]?.previousElementSibling?.id).toBe("time");
  });

  it("makes the recovered post's border glow, and only that post's", () => {
    document.querySelector("main")!.innerHTML = article("1") + article(mark.id);
    marker.add([mark], []);
    marker.scan();
    const glowing = document.querySelectorAll("[data-xcwv-recovered]");
    expect(glowing).toHaveLength(1);
    expect(glowing[0]?.tagName).toBe("ARTICLE");
    expect(glowing[0]?.innerHTML).toContain(mark.id);
  });

  it("puts the glow on the full row when the article is narrower than it", () => {
    document.querySelector("main")!.innerHTML = `<li><div id="row">${article(mark.id)}</div></li>`;
    const widths: Record<string, number> = { ARTICLE: 523, DIV: 555, LI: 555 };
    const original = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = function () {
      return { width: widths[this.tagName] ?? 557 } as DOMRect;
    };
    try {
      marker.add([mark], []);
      marker.scan();
    } finally {
      Element.prototype.getBoundingClientRect = original;
    }
    expect(document.querySelector("#row")?.getAttribute("data-xcwv-recovered")).toBe(mark.id);
    expect(document.querySelector("article")?.hasAttribute("data-xcwv-recovered")).toBe(false);
  });

  it("keeps the eye but drops the glow when the setting is off, and restores it", () => {
    document.querySelector("main")!.innerHTML = article(mark.id);
    marker.add([mark], []);
    marker.scan();
    expect(document.querySelectorAll("[data-xcwv-recovered]")).toHaveLength(1);

    marker.setGlow(false);
    expect(document.querySelectorAll("[data-xcwv-recovered]")).toHaveLength(0);
    expect(marks()).toHaveLength(1);
    marker.scan();
    expect(document.querySelectorAll("[data-xcwv-recovered]")).toHaveLength(0);

    marker.setGlow(true);
    expect(document.querySelectorAll("[data-xcwv-recovered]")).toHaveLength(1);
  });

  it("measures a post once, not on every scan", () => {
    document.querySelector("main")!.innerHTML = `<li><div id="row">${article(mark.id)}</div></li>`;
    const original = Element.prototype.getBoundingClientRect;
    let measurements = 0;
    Element.prototype.getBoundingClientRect = function () {
      measurements += 1;
      return { width: this.tagName === "ARTICLE" ? 523 : 555 } as DOMRect;
    };
    try {
      marker.add([mark], []);
      marker.scan();
      const afterFirst = measurements;
      expect(afterFirst).toBeGreaterThan(0);
      for (let index = 0; index < 5; index += 1) marker.scan();
      expect(measurements).toBe(afterFirst);
    } finally {
      Element.prototype.getBoundingClientRect = original;
    }
  });

  it("stays fast and correct with many remembered posts and few on screen", () => {
    const many = Array.from({ length: 2_500 }, (_, index) => ({ ...mark, id: String(10_000 + index) }));
    document.querySelector("main")!.innerHTML = article("12499");
    marker.add(many, []);
    const query = vi.spyOn(document, "querySelectorAll");
    marker.scan();
    // One query per kind of element, however many posts were recovered this session.
    expect(query.mock.calls.length).toBeLessThan(10);
    query.mockRestore();
    expect(marks()).toHaveLength(1);
  });

  it("forgets the oldest posts past its limit", () => {
    const many = Array.from({ length: 2_001 }, (_, index) => ({ ...mark, id: String(10_000 + index) }));
    document.querySelector("main")!.innerHTML = article("10000") + article("12000");
    marker.add(many, []);
    marker.scan();
    expect([...marks()].map((element) => element.dataset.xcwvId)).toEqual(["12000"]);
  });

  it("walks text for failure notes at most once a second", () => {
    const message = "This Post from @a has been withheld in Turkey";
    document.querySelector("main")!.innerHTML = `<div><div dir="auto"><span>${message}</span></div></div>`;
    const notes = () => document.querySelectorAll(".xcwv-note");
    vi.useFakeTimers();
    try {
      marker.add([], [{ id: "1", status: "not_found", message }]);
      marker.scan();
      expect(notes()).toHaveLength(1);

      // A note that goes missing is only put back by the next walk, which proves when that runs.
      notes()[0]?.remove();
      marker.scan();
      expect(notes()).toHaveLength(0);

      vi.advanceTimersByTime(1_100);
      expect(notes()).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("stops the glow when X reuses the node for another post", () => {
    document.querySelector("main")!.innerHTML = article(mark.id);
    marker.add([mark], []);
    marker.scan();
    for (const anchor of document.querySelectorAll("a")) anchor.setAttribute("href", "/someone/status/1");
    marker.scan();
    expect(document.querySelectorAll("[data-xcwv-recovered]")).toHaveLength(0);
  });

  it("glows only the quote card when the quote is what was recovered", () => {
    document.querySelector("main")!.innerHTML = `<article id="outer"><div role="link" id="card"><span>@example_replier</span><time datetime="${ISO}">3h</time></div></article>`;
    marker.add([{ ...mark, quoted: true }], []);
    marker.scan();
    expect(document.querySelector("#card")?.hasAttribute("data-xcwv-recovered")).toBe(true);
    expect(document.querySelector("#outer")?.hasAttribute("data-xcwv-recovered")).toBe(false);
  });

  it("does not add the icon twice on repeated scans", () => {
    document.querySelector("main")!.innerHTML = article(mark.id);
    marker.add([mark], []);
    marker.scan();
    marker.scan();
    expect(marks()).toHaveLength(1);
  });

  it("leaves other posts unmarked", () => {
    document.querySelector("main")!.innerHTML = article("1") + article(mark.id);
    marker.add([mark], []);
    marker.scan();
    expect(marks()).toHaveLength(1);
    expect(marks()[0]?.closest("article")?.innerHTML).toContain(mark.id);
  });

  it("removes the icon when X reuses the node for another post", () => {
    document.querySelector("main")!.innerHTML = article(mark.id);
    marker.add([mark], []);
    marker.scan();
    for (const anchor of document.querySelectorAll("a")) anchor.setAttribute("href", "/someone/status/1");
    marker.scan();
    expect(marks()).toHaveLength(0);
  });

  it("finds a quoted card by its time and author, since it has no permalink", () => {
    document.querySelector("main")!.innerHTML = `<article><div role="link"><span>@Example_replieR</span><time datetime="${ISO}">3h</time></div></article>`;
    marker.add([{ ...mark, quoted: true }], []);
    marker.scan();
    expect(marks()).toHaveLength(1);
    expect(marks()[0]?.previousElementSibling?.tagName).toBe("TIME");
  });

  it("does not mark a different author's quote that shares the time", () => {
    document.querySelector("main")!.innerHTML = `<article><div role="link"><span>@someone</span><time datetime="${ISO}">3h</time></div></article>`;
    marker.add([{ ...mark, quoted: true }], []);
    marker.scan();
    expect(marks()).toHaveLength(0);
  });

  it("marks the profile header beside the handle, not a post", () => {
    window.history.pushState({}, "", "/BlockedSample");
    document.querySelector("main")!.innerHTML = `<article><span>@BlockedSample</span></article><div><span>Sample</span><span>@BlockedSample</span></div>`;
    marker.add([], [], [{ handle: "BlockedSample", source: "fxtwitter", country: "TR" }]);
    marker.scan();
    marker.scan();
    expect(marks()).toHaveLength(1);
    expect(marks()[0]?.closest("article")).toBeNull();
    expect(marks()[0]?.previousElementSibling?.textContent).toBe("@BlockedSample");
  });

  it("does not mark another profile's header", () => {
    window.history.pushState({}, "", "/someone");
    document.querySelector("main")!.innerHTML = `<div><span>@someone</span></div>`;
    marker.add([], [], [{ handle: "BlockedSample", source: "fxtwitter" }]);
    marker.scan();
    expect(marks()).toHaveLength(0);
  });

  it("adds a plain note under X's tombstone when nothing was recovered", () => {
    const message = "This Post from @example_replier has been withheld in Turkey in response to a legal demand. Learn more";
    document.querySelector("main")!.innerHTML = `<div id="cell"><div dir="auto"><span>This Post from @example_replier has been withheld in Turkey in response to a legal demand. </span><a href="https://help.x.com/withheld">Learn more</a></div></div>`;
    marker.add([], [{ id: mark.id, status: "not_found", message }]);
    marker.scan();
    marker.scan();
    const notes = document.querySelectorAll(".xcwv-note");
    expect(notes).toHaveLength(1);
    expect(notes[0]?.textContent).toBe("Not found in alternative sources.");
    expect(document.querySelector("#cell")?.textContent).toContain("has been withheld");
  });

  it("never reports a missing source answer as a deletion", () => {
    const message = "This Post from @a has been withheld in Turkey";
    document.querySelector("main")!.innerHTML = `<div><div dir="auto"><span>${message}</span></div></div>`;
    marker.add([], [{ id: "1", status: "provider_unavailable", message }]);
    marker.scan();
    expect(document.querySelector(".xcwv-note")?.textContent).toBe("Alternative sources did not respond. Reload later to try again.");
  });
});
