import { describe, expect, it } from "vitest";
import { isLabelWorkbenchEmbedded } from "./useLabelWorkbench";
import type { LabelWorkbenchContextValue } from "./labelWorkbenchTypes";

const baseContext: LabelWorkbenchContextValue = {
  mode: "image",
  setMode: () => {},
};

describe("label workbench render mode helpers", () => {
  it("treats missing context as standalone", () => {
    expect(isLabelWorkbenchEmbedded(null)).toBe(false);
    expect(isLabelWorkbenchEmbedded(undefined)).toBe(false);
  });

  it("detects embedded workbench rendering", () => {
    expect(isLabelWorkbenchEmbedded({ ...baseContext, renderMode: "workbench-embedded" })).toBe(true);
    expect(isLabelWorkbenchEmbedded({ ...baseContext, renderMode: "standalone" })).toBe(false);
    expect(isLabelWorkbenchEmbedded(baseContext)).toBe(false);
  });
});
