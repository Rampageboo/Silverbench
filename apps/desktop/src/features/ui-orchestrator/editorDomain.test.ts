import { describe, expect, it } from "vitest";
import { imageRectFromPixelBox, relRectFromReferenceBoxes } from "./editorDomain";
import type { ImageRect } from "../box-label/geometry";

describe("imageRectFromPixelBox", () => {
  it("converts a §12 pixel box to a normalized ImageRect", () => {
    expect(imageRectFromPixelBox([400, 360, 600, 440], [1000, 800])).toEqual({
      x1: 0.4,
      y1: 0.45,
      x2: 0.6,
      y2: 0.55
    });
  });

  it("clamps out-of-frame coordinates into [0, 1]", () => {
    expect(imageRectFromPixelBox([-50, -10, 1200, 900], [1000, 800])).toEqual({
      x1: 0,
      y1: 0,
      x2: 1,
      y2: 1
    });
  });

  it("guards against a zero image size", () => {
    const rect = imageRectFromPixelBox([10, 10, 20, 20], [0, 0]);
    expect(rect.x1).toBe(1);
    expect(rect.x2).toBe(1);
  });
});

describe("relRectFromReferenceBoxes", () => {
  it("expresses a child box as ratios of its parent box", () => {
    const parent: ImageRect = { x1: 0.2, y1: 0.2, x2: 0.6, y2: 0.6 };
    const child: ImageRect = { x1: 0.3, y1: 0.3, x2: 0.5, y2: 0.5 };
    // parent is 0.4 wide/tall; child offset 0.1 -> 0.25, extent 0.2 -> 0.5..0.75
    expect(relRectFromReferenceBoxes(child, parent)).toEqual([0.25, 0.25, 0.75, 0.75]);
  });

  it("returns null for a degenerate parent box", () => {
    const parent: ImageRect = { x1: 0.5, y1: 0.5, x2: 0.5, y2: 0.9 };
    const child: ImageRect = { x1: 0.5, y1: 0.6, x2: 0.5, y2: 0.7 };
    expect(relRectFromReferenceBoxes(child, parent)).toBeNull();
  });
});
