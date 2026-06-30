import { describe, expect, it } from "vitest";
import {
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

  it("only auto-runs either model when the sample has neither detect nor clf labels", () => {
    expect(shouldAutoRunForEmptySample(0, 0, null)).toBe(true);
    expect(shouldAutoRunForEmptySample(1, 0, null)).toBe(false);
    expect(shouldAutoRunForEmptySample(0, 1, null)).toBe(false);
    expect(shouldAutoRunForEmptySample(0, 0, "chat")).toBe(false);
  });
});
