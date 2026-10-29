import { describe, expect, it } from "vitest";
import { boxPrediction, correctedTags } from "./aiApi";
import { draftFromAsset, draftPatch } from "../gallery/galleryDomain";

describe("human AI review transformations", () => {
  it("maps human-accepted corner proposals to YOLO centers", () => {
    expect(
      boxPrediction({
        class_id: 2,
        box: [0.1, 0.2, 0.7, 0.8],
        pixel_box: [64, 80, 448, 320],
        evidence: "car",
        review_status: "pending"
      })
    ).toEqual({ classId: 2, confidence: 1, x: 0.39999999999999997, y: 0.5, w: 0.6, h: 0.6000000000000001 });
  });
  it("removes only checked personal tags and preserves unrelated tags", () => {
    expect(correctedTags(["favorite", "wrong", "blue"], ["blue", "circle"], ["wrong"])).toEqual([
      "favorite",
      "blue",
      "circle"
    ]);
    expect(correctedTags(["favorite", "wrong"], ["circle"], [])).toEqual(["favorite", "wrong", "circle"]);
    expect(correctedTags(["wrong"], ["wrong", "circle"], ["wrong"])).toEqual(["circle"]);
  });
  it("persists the edited caption without replacing prompt metadata", () => {
    const asset = {
      rating: 0,
      collection: "",
      personalTags: ["favorite"],
      caption: "Old",
      notes: "Keep",
      userEdits: { anima: { positive: "human prompt" } }
    };
    const draft = draftFromAsset(asset);
    draft.caption = "Reviewed caption";
    draft.personalTags = "favorite, circle";
    expect(draftPatch(asset, draft)).toEqual({
      caption: "Reviewed caption",
      personalTags: ["favorite", "circle"]
    });
    expect(asset.caption).toBe("Old");
  });
});
