import { describe, expect, it } from "vitest";
import {
  autoLabelMediaKey,
  autoLabelRunButtonText,
  autoLabelRunCanClearBusy,
  autoLabelRunIsCurrent,
  classifyPredictionIsConfident,
  modelRunId,
  shouldAutoRunClassify,
  shouldAutoRunDetect,
  shouldAutoRunForEmptySample,
} from "./AutoLabelModelPanel";

describe("AutoLabelModelPanel helpers", () => {
  it("includes model update stamps in auto-run identity", () => {
    expect(modelRunId("models/autolabel/classify/best.pt", "2026-06-30T00:00:00.000Z")).toBe(
      "models/autolabel/classify/best.pt@2026-06-30T00:00:00.000Z"
    );
  });

  it("falls back to model path when no update stamp is available", () => {
    expect(modelRunId("models/autolabel/classify/best.pt", "")).toBe("models/autolabel/classify/best.pt");
  });

  it("rejects low-confidence classification predictions", () => {
    expect(classifyPredictionIsConfident(0.54)).toBe(false);
    expect(classifyPredictionIsConfident(undefined)).toBe(false);
    expect(classifyPredictionIsConfident(0.55)).toBe(true);
  });

  it("only auto-runs detect on images without existing boxes or proposals", () => {
    expect(shouldAutoRunDetect(0, 0)).toBe(true);
    expect(shouldAutoRunDetect(1, 0)).toBe(false);
    expect(shouldAutoRunDetect(0, 1)).toBe(false);
  });

  it("only auto-runs classify on images without an existing class", () => {
    expect(shouldAutoRunClassify(null)).toBe(true);
    expect(shouldAutoRunClassify("")).toBe(true);
    expect(shouldAutoRunClassify("chat")).toBe(false);
  });

  it("keeps detect and classify auto-run eligibility independent", () => {
    expect(shouldAutoRunForEmptySample(0, 0, null)).toBe(true);
    expect(shouldAutoRunForEmptySample(1, 0, null)).toBe(false);
    expect(shouldAutoRunForEmptySample(0, 1, null)).toBe(false);
    expect(shouldAutoRunForEmptySample(0, 0, "chat")).toBe(false);
    expect(shouldAutoRunDetect(1, 0)).toBe(false);
    expect(shouldAutoRunClassify(null)).toBe(true);
  });

  it("uses image path before basename for auto-label media identity", () => {
    expect(autoLabelMediaKey({ imagePath: "images/a.png", labelPath: "labels/a.txt", basename: "A" })).toBe(
      "images/a.png"
    );
    expect(autoLabelMediaKey({ imagePath: "", labelPath: "labels/a.txt", basename: "A" })).toBe("A");
    expect(autoLabelMediaKey(null)).toBe("");
  });

  it("rejects stale auto-label runs by cancellation, run id, or media key", () => {
    const current = {
      cancelled: false,
      token: 4,
      activeToken: 4,
      targetMediaKey: "images/a.png",
      currentMediaKey: "images/a.png",
    };
    expect(autoLabelRunIsCurrent(current)).toBe(true);
    expect(autoLabelRunIsCurrent({ ...current, cancelled: true })).toBe(false);
    expect(autoLabelRunIsCurrent({ ...current, activeToken: 5 })).toBe(false);
    expect(autoLabelRunIsCurrent({ ...current, currentMediaKey: "images/b.png" })).toBe(false);
  });

  it("lets only the active run token clear busy state", () => {
    expect(autoLabelRunCanClearBusy(4, 4)).toBe(true);
    expect(autoLabelRunCanClearBusy(4, 5)).toBe(false);
  });

  it("surfaces auto-label run phases in the run button", () => {
    expect(autoLabelRunButtonText("detect", false, null)).toBe("Run Detect");
    expect(autoLabelRunButtonText("classify", false, null)).toBe("Run Clf");
    expect(autoLabelRunButtonText("detect", true, "Detect: preparing source...")).toBe("Preparing...");
    expect(autoLabelRunButtonText("detect", true, "Detect: starting backend job...")).toBe("Starting...");
    expect(autoLabelRunButtonText("detect", true, "Detect: Running detect...")).toBe("Detecting...");
    expect(autoLabelRunButtonText("classify", true, "Clf: Running classify...")).toBe("Classifying...");
    expect(autoLabelRunButtonText("classify", true, "Clf: applying result...")).toBe("Applying...");
  });
});
