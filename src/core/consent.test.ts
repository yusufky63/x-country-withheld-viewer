import { describe, expect, it } from "vitest";
import { applyConsent, consentFrom } from "./consent";
import { DEFAULT_SETTINGS } from "./types";

describe("consent", () => {
  it("reads only the two answers", () => {
    expect(consentFrom("accepted")).toBe("accepted");
    expect(consentFrom("declined")).toBe("declined");
    expect(consentFrom(undefined)).toBeUndefined();
    expect(consentFrom(true)).toBeUndefined();
  });

  it("keeps the extension off until the answer is yes", () => {
    expect(applyConsent(DEFAULT_SETTINGS, undefined).enabled).toBe(false);
    expect(applyConsent(DEFAULT_SETTINGS, "declined").enabled).toBe(false);
    expect(applyConsent(DEFAULT_SETTINGS, "accepted").enabled).toBe(true);
  });

  it("does not turn on what the user switched off", () => {
    expect(applyConsent({ ...DEFAULT_SETTINGS, enabled: false }, "accepted").enabled).toBe(false);
  });
});
