import { describe, expect, it } from "vitest";
import { boxesToText, resolveLabelPathForWrite, updateLabelsForCrop } from "./labelUtils";
import type { DatasetPair } from "./datasetCore";

describe("boxesToText", () => {
  it("returns empty string for no boxes", () => {
    expect(boxesToText([])).toBe("");
  });

  it("serializes a single box with trailing newline", () => {
    expect(boxesToText([{ classId: 1, x: 0.5, y: 0.5, w: 0.2, h: 0.3 }])).toBe("1 0.5 0.5 0.2 0.3\n");
  });

  it("joins multiple boxes on separate lines", () => {
    const text = boxesToText([
      { classId: 0, x: 0.1, y: 0.2, w: 0.3, h: 0.4 },
      { classId: 2, x: 0.5, y: 0.6, w: 0.1, h: 0.1 }
    ]);
    expect(text).toBe("0 0.1 0.2 0.3 0.4\n2 0.5 0.6 0.1 0.1\n");
  });
});

describe("resolveLabelPathForWrite", () => {
  const pair: DatasetPair = {
    imagePath: "images/train/a.jpg",
    labelPath: null,
    classId: null,
    className: ""
  };

  it("returns empty for classify task", () => {
    expect(resolveLabelPathForWrite(pair, "classify")).toBe("");
  });

  it("prefers existing labelPath on detect task", () => {
    expect(resolveLabelPathForWrite({ ...pair, labelPath: "labels/train/a.txt" }, "detect")).toBe(
      "labels/train/a.txt"
    );
  });

  it("maps images/ prefix to labels/ for detect task", () => {
    expect(resolveLabelPathForWrite(pair, "detect")).toBe("labels/train/a.txt");
  });

  it("falls back to sibling txt for non-images paths", () => {
    expect(
      resolveLabelPathForWrite({ ...pair, imagePath: "custom/foo.png", labelPath: null }, "detect")
    ).toBe("custom/foo.txt");
  });
});

describe("updateLabelsForCrop", () => {
  const imageW = 100;
  const imageH = 100;

  it("returns empty when crop has zero area", () => {
    const boxes = [{ classId: 0, x: 0.5, y: 0.5, w: 0.2, h: 0.2 }];
    expect(updateLabelsForCrop(boxes, { x1: 10, y1: 10, x2: 10, y2: 50 }, imageW, imageH)).toEqual([]);
  });

  it("keeps a box fully inside the crop", () => {
    const boxes = [{ classId: 1, x: 0.5, y: 0.5, w: 0.2, h: 0.2 }];
    const crop = { x1: 20, y1: 20, x2: 80, y2: 80 };
    const [next] = updateLabelsForCrop(boxes, crop, imageW, imageH);
    expect(next.classId).toBe(1);
    expect(next.x).toBeCloseTo(0.5, 5);
    expect(next.y).toBeCloseTo(0.5, 5);
    expect(next.w).toBeCloseTo(1 / 3, 5);
    expect(next.h).toBeCloseTo(1 / 3, 5);
  });

  it("drops boxes with no intersection", () => {
    const boxes = [{ classId: 0, x: 0.1, y: 0.1, w: 0.1, h: 0.1 }];
    const crop = { x1: 50, y1: 50, x2: 90, y2: 90 };
    expect(updateLabelsForCrop(boxes, crop, imageW, imageH)).toEqual([]);
  });

  it("clips a partially overlapping box to crop bounds", () => {
    const boxes = [{ classId: 2, x: 0.45, y: 0.5, w: 0.3, h: 0.2 }];
    const crop = { x1: 50, y1: 0, x2: 100, y2: 100 };
    const [next] = updateLabelsForCrop(boxes, crop, imageW, imageH);
    expect(next.x).toBeGreaterThan(0);
    expect(next.x).toBeLessThan(1);
    expect(next.w).toBeLessThan(0.3);
  });

  it("maps multiple surviving boxes into crop-normalized space", () => {
    const boxes = [
      { classId: 0, x: 0.25, y: 0.25, w: 0.1, h: 0.1 },
      { classId: 1, x: 0.75, y: 0.75, w: 0.1, h: 0.1 }
    ];
    const crop = { x1: 0, y1: 0, x2: 50, y2: 50 };
    const updated = updateLabelsForCrop(boxes, crop, imageW, imageH);
    expect(updated).toHaveLength(1);
    expect(updated[0].classId).toBe(0);
  });
});
