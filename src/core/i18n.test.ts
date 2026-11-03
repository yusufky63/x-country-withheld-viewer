import { describe, expect, it } from "vitest";
import { copiedLines, failureNote, markTitle, POPUP_TEXT, profileMarkTitle } from "./i18n";
import type { AppliedMark } from "./types";

const mark: AppliedMark = {
  id: "1",
  handle: "a",
  createdAtMs: 0,
  source: "fxtwitter",
  kind: "withheld",
  country: "Turkey",
  quoted: false,
};

describe("markTitle", () => {
  it("names the place and the source in English", () => {
    expect(markTitle(mark, "en")).toBe("Withheld in Turkey. Shown from FxTwitter.");
    expect(markTitle({ ...mark, country: undefined, source: "xmd" }, "en")).toBe("Withheld in your country. Shown from x.md.");
  });

  it("names them in Turkish, turning X's English country name into Turkish", () => {
    expect(markTitle(mark, "tr")).toBe("Gizlendiği ülke: Türkiye. Kaynak: FxTwitter.");
    expect(markTitle({ ...mark, country: "Germany" }, "tr")).toBe("Gizlendiği ülke: Almanya. Kaynak: FxTwitter.");
    expect(markTitle({ ...mark, country: undefined, source: "xmd" }, "tr")).toBe("Ülkende gizlenmiş. Kaynak: x.md.");
  });

  it("keeps a country name it cannot place rather than dropping it", () => {
    expect(markTitle({ ...mark, country: "Atlantis" }, "tr")).toBe("Gizlendiği ülke: Atlantis. Kaynak: FxTwitter.");
  });

  it("does not claim a legal hold it has no evidence for", () => {
    expect(markTitle({ ...mark, kind: "missing" }, "en")).toBe("Not available on X here. Shown from FxTwitter.");
    expect(markTitle({ ...mark, kind: "missing" }, "tr")).toBe("X'te burada görünmüyor. Kaynak: FxTwitter.");
  });
});

describe("profileMarkTitle", () => {
  const profile = { handle: "a", source: "fxtwitter" as const, country: "TR" };

  it("spells out X's ISO country codes", () => {
    expect(profileMarkTitle(profile, "tr")).toBe("Hesabın gizlendiği ülke: Türkiye. Kaynak: FxTwitter.");
    expect(profileMarkTitle(profile, "en")).toMatch(/^Account withheld in (Türkiye|Turkey)\. Shown from FxTwitter\.$/);
  });

  it("does not name a country X did not name", () => {
    expect(profileMarkTitle({ ...profile, country: undefined }, "tr")).toBe("Hesap ülkende gizlenmiş. Kaynak: FxTwitter.");
    expect(profileMarkTitle({ ...profile, country: undefined }, "en")).toBe("Account withheld in your country. Shown from FxTwitter.");
  });
});

describe("texts", () => {
  it("covers the same popup texts in both languages, with nothing left empty", () => {
    expect(Object.keys(POPUP_TEXT.en).sort()).toEqual(Object.keys(POPUP_TEXT.tr).sort());
    for (const texts of Object.values(POPUP_TEXT)) {
      for (const text of Object.values(texts)) expect(text.length).toBeGreaterThan(0);
    }
  });

  it("explains every failure a post can show, in both languages", () => {
    for (const status of ["not_found", "deleted", "private", "suspended", "rate_limited", "provider_unavailable"] as const) {
      expect(failureNote(status, "tr")).toBeTruthy();
      expect(failureNote(status, "en")).toBeTruthy();
    }
    expect(failureNote("provider_unavailable", "tr")).toContain("yanıt vermedi");
  });

  it("never reports a missing answer as a deletion", () => {
    expect(failureNote("not_found", "tr")).not.toContain("silin");
    expect(failureNote("provider_unavailable", "en")).not.toContain("deleted");
  });

  it("counts copied lines in each language", () => {
    expect(copiedLines(3, "tr")).toBe("3 satır kopyalandı");
    expect(copiedLines(3, "en")).toBe("Copied 3 lines");
  });
});
