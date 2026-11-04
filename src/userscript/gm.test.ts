import { describe, expect, it } from "vitest";
import { runsInPageWorld } from "./gm";

describe("runsInPageWorld", () => {
  it("accepts the page world as each manager names it", () => {
    expect(runsInPageWorld({ sandboxMode: "raw" })).toBe(true);
    expect(runsInPageWorld({ injectInto: "page" })).toBe(true);
  });

  it("refuses a separate sandbox, where hooks could not reach X's code", () => {
    expect(runsInPageWorld({ sandboxMode: "dom" })).toBe(false);
    expect(runsInPageWorld({ sandboxMode: "js" })).toBe(false);
    expect(runsInPageWorld({ injectInto: "content" })).toBe(false);
  });

  it("gives a manager that reports no mode the chance to work", () => {
    expect(runsInPageWorld({})).toBe(true);
  });
});
