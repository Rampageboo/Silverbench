import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  assignVisualState,
  INBOX_JUNK_CLASS,
  isClfJunk,
  isDetectJunk,
  isFlaggedFile,
  isJunkFile,
  isNextTrainingFile,
  isReviewedFile,
  isTaskExportEnabled,
  junkLabelForFile,
  loadMetadataMap,
  markJunkFilenames,
  passesHideJunk,
  truthyFlag
} from "./metadata";
import type { MetadataRow } from "./types";

vi.mock("../../api", () => ({
  callJson: vi.fn()
}));

import { callJson } from "../../api";

beforeEach(() => {
  vi.clearAllMocks();
});

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
    const row: MetadataRow = { filename: "c.jpg", reviewed: true, flagged: true, next_train: true };
    expect(isReviewedFile(row)).toBe(true);
    expect(isFlaggedFile(row)).toBe(true);
    expect(isNextTrainingFile(row)).toBe(true);
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

  it("task export flags default to enabled and can be disabled per side", () => {
    expect(isTaskExportEnabled(undefined, "detect")).toBe(true);
    expect(isTaskExportEnabled({ filename: "i.jpg" }, "clf")).toBe(true);
    expect(isTaskExportEnabled({ filename: "j.jpg", detect_export_enabled: false }, "detect")).toBe(false);
    expect(isTaskExportEnabled({ filename: "k.jpg", clf_export_enabled: false }, "clf")).toBe(false);
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
          next_train: "1",
          detect_junk: "1",
          detect_enabled: true,
          detect_export_enabled: "0",
          clf_enabled: 0,
          clf_export_enabled: "1",
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
      detect_export_enabled: false,
      clf_export_enabled: true,
      reviewed: true,
      flagged: true,
      next_train: true
    });
  });
});

describe("markJunkFilenames", () => {
  it("can mark both detect and clf junk in one metadata update", async () => {
    vi.mocked(callJson).mockResolvedValue({});

    await markJunkFilenames("/workspace", ["img.jpg"], "both");

    expect(callJson).toHaveBeenNthCalledWith(1, "upsertMetadataRows", [
      "/workspace",
      JSON.stringify([
        {
          filename: "img.jpg",
          detect_junk: true,
          detect_enabled: false,
          detect_export_enabled: false,
          clf_enabled: false,
          clf_class: INBOX_JUNK_CLASS,
          clf_export_enabled: false,
        },
      ]),
    ]);
    expect(callJson).toHaveBeenNthCalledWith(2, "removeDetectDatasetLinks", [
      "/workspace",
      JSON.stringify(["img.jpg"]),
    ]);
    expect(callJson).toHaveBeenNthCalledWith(3, "removeClfDatasetLinks", [
      "/workspace",
      JSON.stringify(["img.jpg"]),
    ]);
  });
});
