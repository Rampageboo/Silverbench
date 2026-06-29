import { describe, expect, it } from "vitest";
import {
  arrowKeyDelta,
  boxIou,
  boxToRect,
  classBoxColor,
  classNameFor,
  clamp,
  clamp01,
  enforceMinRect,
  findNearestBoxIndex,
  mergeCopiedBoxWithIndex,
  normalizeRect,
  normalizedImageRect,
  rectToBox
} from "./geometry";

describe("geometry clamp helpers", () => {
  it("clamp01 keeps values in [0, 1]", () => {
    expect(clamp01(-0.2)).toBe(0);
    expect(clamp01(0.5)).toBe(0.5);
    expect(clamp01(1.4)).toBe(1);
  });

  it("clamp respects min/max", () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-1, 0, 10)).toBe(0);
    expect(clamp(99, 0, 10)).toBe(10);
  });
});

describe("geometry box rect conversion", () => {
  const sample = { classId: 2, x: 0.5, y: 0.5, w: 0.2, h: 0.4 };

  it("boxToRect and rectToBox round-trip", () => {
    const rect = boxToRect(sample);
    expect(rect).toEqual({ x1: 0.4, y1: 0.3, x2: 0.6, y2: 0.7 });
    const roundTrip = rectToBox(rect, sample.classId);
    expect(roundTrip.classId).toBe(sample.classId);
    expect(roundTrip.x).toBeCloseTo(sample.x);
    expect(roundTrip.y).toBeCloseTo(sample.y);
    expect(roundTrip.w).toBeCloseTo(sample.w);
    expect(roundTrip.h).toBeCloseTo(sample.h);
  });

  it("normalizedImageRect orders corners", () => {
    expect(normalizedImageRect({ x: 0.8, y: 0.9 }, { x: 0.2, y: 0.1 })).toEqual({
      x1: 0.2,
      y1: 0.1,
      x2: 0.8,
      y2: 0.9
    });
  });

  it("normalizeRect clamps to unit square", () => {
    expect(normalizeRect({ x1: 1.2, y1: -0.1, x2: 0.3, y2: 0.8 })).toEqual({
      x1: 0.3,
      y1: 0,
      x2: 1,
      y2: 0.8
    });
  });

  it("enforceMinRect expands small rects", () => {
    const rect = enforceMinRect({ x1: 0.49, y1: 0.49, x2: 0.51, y2: 0.51 }, 0.1, 0.1);
    expect(rect.x2 - rect.x1).toBeGreaterThanOrEqual(0.1);
    expect(rect.y2 - rect.y1).toBeGreaterThanOrEqual(0.1);
  });
});

describe("geometry class colors", () => {
  it("assigns stable non-pale colors per class", () => {
    expect(classBoxColor(3)).toBe(classBoxColor(3));
    expect(classBoxColor(3)).not.toBe(classBoxColor(4));
    expect(classBoxColor(3)).toMatch(/^hsl\(\d+ 82% 48%\)$/);
    expect(classBoxColor(3, true)).toMatch(/^hsl\(\d+ 82% 56%\)$/);
  });
});

describe("geometry keyboard and merge helpers", () => {
  it("arrowKeyDelta maps arrow keys", () => {
    expect(arrowKeyDelta("ArrowLeft")).toEqual({ x: -1, y: 0 });
    expect(arrowKeyDelta("ArrowUp")).toEqual({ x: 0, y: -1 });
    expect(arrowKeyDelta("Enter")).toBeNull();
  });

  it("boxIou returns 1 for identical boxes", () => {
    const box = { classId: 0, x: 0.5, y: 0.5, w: 0.2, h: 0.2 };
    expect(boxIou(box, box)).toBeCloseTo(1);
  });

  it("mergeCopiedBoxWithIndex replaces nearby same-class box", () => {
    const boxes = [{ classId: 1, x: 0.5, y: 0.5, w: 0.2, h: 0.2 }];
    const copy = { classId: 1, x: 0.52, y: 0.51, w: 0.2, h: 0.2 };
    const merged = mergeCopiedBoxWithIndex(boxes, copy);
    expect(merged.boxes).toHaveLength(1);
    expect(merged.index).toBe(0);
    expect(merged.boxes[0].x).toBeCloseTo(0.52);
  });

  it("findNearestBoxIndex picks closest center", () => {
    const boxes = [
      { classId: 0, x: 0.2, y: 0.2, w: 0.1, h: 0.1 },
      { classId: 0, x: 0.8, y: 0.8, w: 0.1, h: 0.1 }
    ];
    const target = { classId: 0, x: 0.79, y: 0.81, w: 0.1, h: 0.1 };
    expect(findNearestBoxIndex(boxes, target)).toBe(1);
  });

  it("classNameFor resolves label or falls back", () => {
    const classes = [
      { id: 0, name: "person" },
      { id: 3, name: "car" }
    ];
    expect(classNameFor(classes, 3)).toBe("3: car");
    expect(classNameFor(classes, 9)).toBe("9: class_9");
  });
});
