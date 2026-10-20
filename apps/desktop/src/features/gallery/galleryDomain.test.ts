import { describe, expect, it } from "vitest";
import type { GalleryJob } from "./galleryApi";
import {
  DEFAULT_RULES,
  buildPromptOptions,
  draftFromAsset,
  draftPatch,
  formatProbability,
  isDefaultPromptOptions,
  jobProgressText,
  jobsSignature,
  parseCorrections,
  parsePersonalTags,
  shouldObscure,
  withPromptOverride
} from "./galleryDomain";

const asset = {
  rating: 3,
  collection: "角色参考",
  personalTags: ["待核对"],
  notes: "",
  userEdits: { anima: { positive: "@artist, 1girl" } }
};

function job(partial: Partial<GalleryJob>): GalleryJob {
  return {
    id: "j1",
    type: "scan",
    rootIds: [],
    status: "running",
    processed: 0,
    createdAt: "t0",
    modifiedAt: "t0",
    progress: { scanned: 0, processed: 0, imported: 0, skipped: 0, errors: [] },
    ...partial
  };
}

describe("shouldObscure", () => {
  it("hides unknown and adult ratings by default, shows only general", () => {
    expect(shouldObscure(null, false)).toBe(true);
    expect(shouldObscure("sensitive", false)).toBe(true);
    expect(shouldObscure("explicit", false)).toBe(true);
    expect(shouldObscure("general", false)).toBe(false);
  });

  it("reveals everything when the user switches the filter off", () => {
    expect(shouldObscure("explicit", true)).toBe(false);
    expect(shouldObscure(null, true)).toBe(false);
  });
});

describe("formatProbability", () => {
  it("never turns a missing probability into 0% or 100%", () => {
    expect(formatProbability(null)).toBeNull();
    expect(formatProbability(undefined)).toBeNull();
    expect(formatProbability(0)).toBe("0%");
    expect(formatProbability(0.876)).toBe("88%");
  });
});

describe("withPromptOverride", () => {
  it("edits one format without touching the other", () => {
    const next = withPromptOverride(asset.userEdits, "noobai", "positive", "1girl, solo");
    expect(next).toEqual({ anima: { positive: "@artist, 1girl" }, noobai: { positive: "1girl, solo" } });
    expect(asset.userEdits).toEqual({ anima: { positive: "@artist, 1girl" } });
  });

  it("keeps an explicit empty string as a real override", () => {
    expect(withPromptOverride({}, "noobai", "positive", "")).toEqual({ noobai: { positive: "" } });
  });

  it("removes the override (and the empty format object) when cleared back to automatic", () => {
    const edits = { noobai: { positive: "x", negative: "y" }, anima: { positive: "z" } };
    const one = withPromptOverride(edits, "noobai", "positive", undefined);
    expect(one).toEqual({ noobai: { negative: "y" }, anima: { positive: "z" } });
    expect(withPromptOverride(one, "noobai", "negative", undefined)).toEqual({ anima: { positive: "z" } });
  });
});

describe("draftPatch", () => {
  it("is empty when nothing changed", () => {
    expect(draftPatch(asset, draftFromAsset(asset))).toEqual({});
  });

  it("sends userEdits whole so the other format survives", () => {
    const draft = draftFromAsset(asset);
    draft.userEdits = withPromptOverride(draft.userEdits, "noobai", "negative", "lowres");
    draft.rating = 5;
    expect(draftPatch(asset, draft)).toEqual({
      rating: 5,
      userEdits: { anima: { positive: "@artist, 1girl" }, noobai: { negative: "lowres" } }
    });
  });

  it("normalizes personal tags before comparing", () => {
    const draft = draftFromAsset(asset);
    draft.personalTags = " 待核对 ,待核对，  新标签 ";
    expect(draftPatch(asset, draft)).toEqual({ personalTags: ["待核对", "新标签"] });
  });

  it("does not let the draft alias the asset's edits", () => {
    const draft = draftFromAsset(asset);
    draft.userEdits.anima!.positive = "changed";
    expect(asset.userEdits.anima.positive).toBe("@artist, 1girl");
  });
});

describe("prompt options", () => {
  it("prompt mode with defaults matches what the plain asset endpoint renders", () => {
    expect(isDefaultPromptOptions(buildPromptOptions("prompt", DEFAULT_RULES))).toBe(true);
  });

  it("omits training-only fields outside training mode", () => {
    const options = buildPromptOptions("prompt", { ...DEFAULT_RULES, trigger: "remielle", removeTags: "wings" });
    expect(options.trigger).toBeUndefined();
    expect(options.removeTags).toBeUndefined();
  });

  it("builds training options from the rules form", () => {
    const options = buildPromptOptions("train", {
      ...DEFAULT_RULES,
      generalThreshold: 0.5,
      trigger: " remielle ",
      outfitTrigger: "remielle white outfit",
      removeTags: "wings, white wings",
      corrections: "cross = star (symbol)\nbad line",
      sourceTag: "3d"
    });
    expect(options).toEqual({
      mode: "train",
      generalThreshold: 0.5,
      captionStyle: "mixed",
      trigger: "remielle",
      outfitTrigger: "remielle white outfit",
      removeTags: ["wings", "white wings"],
      corrections: { cross: "star (symbol)" },
      trainingKind: "character",
      sourceTag: "3d"
    });
  });

  it("parses correction lines with several arrow styles", () => {
    expect(parseCorrections("a = b\nc => d\ne → f\n\nnoise")).toEqual({ a: "b", c: "d", e: "f" });
  });

  it("splits personal tags on ASCII and full-width commas", () => {
    expect(parsePersonalTags("a，b, a\nc")).toEqual(["a", "b", "c"]);
  });
});

describe("jobs", () => {
  it("signature changes on completion, not only while running", () => {
    const running = jobsSignature([job({ status: "running", processed: 10 })], 10);
    const done = jobsSignature([job({ status: "completed", processed: 10, modifiedAt: "t1" })], 12);
    expect(done).not.toBe(running);
  });

  it("reports counts without inventing a percentage", () => {
    const text = jobProgressText(
      job({ progress: { scanned: 40, processed: 40, imported: 30, skipped: 10, errors: ["bad.png"] } })
    );
    expect(text).toBe("已处理 40 · 新增 30 · 跳过 10 · 错误 1");
    expect(text).not.toContain("%");
  });
});
