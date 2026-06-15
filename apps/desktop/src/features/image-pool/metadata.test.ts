import { describe, expect, it, vi } from "vitest";
import {
  assignVisualState,
  INBOX_JUNK_CLASS,
  isClfJunk,
  isDetectJunk,
  isFlaggedFile,
  isJunkFile,
  isReviewedFile,
  junkLabelForFile,
  loadMetadataMap,
  passesHideJunk,
  truthyFlag
} from "./metadata";
import type { MetadataRow } from "./types";

vi.mock("../../api", () => ({
  callJson: vi.fn()
}));

import { callJson } from "../../api";

describe("metadata flags", () => {
  it("truthyFlag accepts legacy and boolean values", () => {
    expect(truthyFlag(true)).toBe(true);
    expect(truthyFlag("1")).toBe(true);
    expect(truthyFlag(1)).toBe(true);
    expect(truthyFlag(false)).toBe(false);
    expect(truthyFlag("0")).toBe(false);
  });

  it("detect and clf junk helpers", () => {
    const detectJunk: MetadataRow = { filename: "a.jpg", detect_junk: true };
    const clfJunk: MetadataRow = { filename: "b.jpg", clf_class: INBOX_JUNK_CLASS };
    expect(isDetectJunk(detectJunk)).toBe(true);
    expect(isClfJunk(clfJunk)).toBe(true);
    expect(isJunkFile(detectJunk, "detect")).toBe(true);
    expect(isJunkFile(clfJunk, "clf")).toBe(true);
    expect(isJunkFile(detectJunk, "any")).toBe(true);
  });

  it("reviewed and flagged helpers", () => {
    const row: MetadataRow = { filename: "c.jpg", reviewed: true, flagged: true };
    expect(isReviewedFile(row)).toBe(true);
    expect(isFlaggedFile(row)).toBe(true);
  });

  it("junkLabelForFile describes scope", () => {
    expect(
      junkLabelForFile({ filename: "d.jpg", detect_junk: true, clf_class: INBOX_JUNK_CLASS })
    ).toBe("Both junk");
    expect(junkLabelForFile({ filename: "e.jpg", detect_junk: true })).toBe("Detect junk");
  });

  it("passesHideJunk respects hide mode", () => {
    const junk: MetadataRow = { filename: "f.jpg", detect_junk: true };
    expect(passesHideJunk(junk, null)).toBe(true);
    expect(passesHideJunk(junk, "detect")).toBe(false);
    expect(passesHideJunk({ filename: "g.jpg" }, "detect")).toBe(true);
  });

  it("assignVisualState marks active detect assignment", () => {
    const row: MetadataRow = {
      filename: "h.jpg",
      detect_enabled: true,
      detect_junk: false
    };
    const visual = assignVisualState(row, "detect");
    expect(visual.currentInUse).toBe(true);
    expect(visual.overlay).toBe("active");
  });
});

describe("loadMetadataMap", () => {
  it("normalizes boolean fields from backend rows", async () => {
    vi.mocked(callJson).mockResolvedValueOnce({
      ok: true,
      rows: [
        {
          filename: "img.jpg",
          reviewed: "1",
          flagged: 1,
          detect_junk: "1",
          detect_enabled: true,
          clf_enabled: 0,
          clf_class: "cat"
        }
      ]
    });

    const map = await loadMetadataMap("/workspace");
    const row = map.get("img.jpg");
    expect(row).toEqual({
      filename: "img.jpg",
      detect_junk: true,
      clf_class: "cat",
      detect_enabled: true,
      clf_enabled: false,
      reviewed: true,
      flagged: true
    });
  });
});
