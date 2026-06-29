import { describe, expect, it } from "vitest";
import { parseImagePoolUi } from "./session";

describe("image-pool session", () => {
  it("parseImagePoolUi returns defaults for missing data", () => {
    expect(parseImagePoolUi(null)).toEqual({});
    expect(parseImagePoolUi({})).toEqual({});
  });

  it("parseImagePoolUi normalizes filter and junk scope", () => {
    const parsed = parseImagePoolUi({
      imagePoolUi: {
        filter: "new",
        junkScope: "clf",
        hideJunk: "both",
        scrollTop: 42.2,
        viewportImagePath: "media/x.jpg"
      }
    });
    expect(parsed).toEqual({
      filter: "new",
      junkScope: "clf",
      hideJunk: "both",
      scrollTop: 42,
      viewportImagePath: "media/x.jpg"
    });
  });

  it("parseImagePoolUi falls back for invalid filter", () => {
    const parsed = parseImagePoolUi({
      imagePoolUi: {
        filter: "not-a-filter",
        junkScope: "detect"
      }
    });
    expect(parsed.filter).toBe("all");
    expect(parsed.junkScope).toBe("detect");
  });
});
