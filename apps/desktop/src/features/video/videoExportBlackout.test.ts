import { describe, expect, it } from "vitest";
import {
  applyBlackoutRectsToImageData,
  computeExportBlackoutWarnings,
  type ExportBlackoutWarning,
} from "./videoExportBlackout";
import type { BlackoutRectShape } from "../overlays/blackoutOverlayDomain";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a W×H white RGBA image (each channel = 255). */
function whitePixels(w: number, h: number): Uint8ClampedArray {
  const buf = new Uint8ClampedArray(w * h * 4).fill(255);
  return buf;
}

function pixelAt(pixels: Uint8ClampedArray, w: number, x: number, y: number) {
  const i = (y * w + x) * 4;
  return { r: pixels[i], g: pixels[i + 1], b: pixels[i + 2], a: pixels[i + 3] };
}

// ---------------------------------------------------------------------------
// applyBlackoutRectsToImageData
// ---------------------------------------------------------------------------

describe("applyBlackoutRectsToImageData", () => {
  it("leaves pixels unchanged when rects list is empty", () => {
    const pixels = whitePixels(4, 4);
    applyBlackoutRectsToImageData(pixels, 4, 4, []);
    // Every pixel must still be white
    for (let i = 0; i < 4 * 4; i++) {
      expect(pixels[i * 4]).toBe(255);
    }
  });

  it("blacks out a full-image rect (center 0.5/0.5, size 1.0×1.0)", () => {
    const pixels = whitePixels(4, 4);
    const rect: BlackoutRectShape = { type: "rect", x: 0.5, y: 0.5, w: 1.0, h: 1.0 };
    applyBlackoutRectsToImageData(pixels, 4, 4, [rect]);
    for (let i = 0; i < 4 * 4; i++) {
      const r = pixels[i * 4], g = pixels[i * 4 + 1], b = pixels[i * 4 + 2];
      expect(r).toBe(0);
      expect(g).toBe(0);
      expect(b).toBe(0);
    }
  });

  it("blacks out only the top-left quadrant", () => {
    // 4×4 image; top-left 2×2 = center (0.25, 0.25), size (0.5, 0.5)
    const pixels = whitePixels(4, 4);
    const rect: BlackoutRectShape = { type: "rect", x: 0.25, y: 0.25, w: 0.5, h: 0.5 };
    applyBlackoutRectsToImageData(pixels, 4, 4, [rect]);

    // Top-left 2×2 should be black
    expect(pixelAt(pixels, 4, 0, 0)).toMatchObject({ r: 0, g: 0, b: 0 });
    expect(pixelAt(pixels, 4, 1, 0)).toMatchObject({ r: 0, g: 0, b: 0 });
    expect(pixelAt(pixels, 4, 0, 1)).toMatchObject({ r: 0, g: 0, b: 0 });
    expect(pixelAt(pixels, 4, 1, 1)).toMatchObject({ r: 0, g: 0, b: 0 });

    // Bottom-right 2×2 should remain white
    expect(pixelAt(pixels, 4, 2, 2)).toMatchObject({ r: 255, g: 255, b: 255 });
    expect(pixelAt(pixels, 4, 3, 3)).toMatchObject({ r: 255, g: 255, b: 255 });
  });

  it("preserves alpha channel", () => {
    const pixels = whitePixels(4, 4);
    const rect: BlackoutRectShape = { type: "rect", x: 0.5, y: 0.5, w: 1.0, h: 1.0 };
    applyBlackoutRectsToImageData(pixels, 4, 4, [rect]);
    // Alpha must still be 255
    for (let i = 0; i < 4 * 4; i++) {
      expect(pixels[i * 4 + 3]).toBe(255);
    }
  });

  it("skips zero-width rect", () => {
    const pixels = whitePixels(4, 4);
    const rect: BlackoutRectShape = { type: "rect", x: 0.5, y: 0.5, w: 0, h: 0.5 };
    applyBlackoutRectsToImageData(pixels, 4, 4, [rect]);
    // Nothing should change
    expect(pixelAt(pixels, 4, 0, 0)).toMatchObject({ r: 255 });
  });

  it("skips zero-height rect", () => {
    const pixels = whitePixels(4, 4);
    const rect: BlackoutRectShape = { type: "rect", x: 0.5, y: 0.5, w: 0.5, h: 0 };
    applyBlackoutRectsToImageData(pixels, 4, 4, [rect]);
    expect(pixelAt(pixels, 4, 0, 0)).toMatchObject({ r: 255 });
  });

  it("clamps rect that extends past right/bottom edge", () => {
    // Rect whose right edge is at x=0.9+0.4/2=1.1 — exceeds width
    const pixels = whitePixels(4, 4);
    const rect: BlackoutRectShape = { type: "rect", x: 0.9, y: 0.9, w: 0.4, h: 0.4 };
    // Should not throw, should black out only the visible portion
    expect(() => applyBlackoutRectsToImageData(pixels, 4, 4, [rect])).not.toThrow();
    // Bottom-right corner should be black
    expect(pixelAt(pixels, 4, 3, 3)).toMatchObject({ r: 0, g: 0, b: 0 });
  });

  it("applies multiple rects independently", () => {
    const pixels = whitePixels(8, 8);
    // Top-left 4×4
    const tl: BlackoutRectShape = { type: "rect", x: 0.25, y: 0.25, w: 0.5, h: 0.5 };
    // Bottom-right 4×4
    const br: BlackoutRectShape = { type: "rect", x: 0.75, y: 0.75, w: 0.5, h: 0.5 };
    applyBlackoutRectsToImageData(pixels, 8, 8, [tl, br]);
    expect(pixelAt(pixels, 8, 0, 0)).toMatchObject({ r: 0 });  // tl black
    expect(pixelAt(pixels, 8, 7, 7)).toMatchObject({ r: 0 });  // br black
    expect(pixelAt(pixels, 8, 4, 0)).toMatchObject({ r: 255 }); // top-right untouched
    expect(pixelAt(pixels, 8, 0, 4)).toMatchObject({ r: 255 }); // bottom-left untouched
  });

  it("handles 1×1 image", () => {
    const pixels = whitePixels(1, 1);
    const rect: BlackoutRectShape = { type: "rect", x: 0.5, y: 0.5, w: 1, h: 1 };
    applyBlackoutRectsToImageData(pixels, 1, 1, [rect]);
    expect(pixelAt(pixels, 1, 0, 0)).toMatchObject({ r: 0, g: 0, b: 0 });
  });
});

// ---------------------------------------------------------------------------
// computeExportBlackoutWarnings
// ---------------------------------------------------------------------------

describe("computeExportBlackoutWarnings", () => {
  it("returns empty array when there are no rects", () => {
    const boxes = [{ x: 0.5, y: 0.5, w: 0.2, h: 0.2 }];
    expect(computeExportBlackoutWarnings([], boxes)).toHaveLength(0);
  });

  it("returns empty array when there are no boxes", () => {
    const rects: BlackoutRectShape[] = [{ type: "rect", x: 0.5, y: 0.5, w: 0.4, h: 0.4 }];
    expect(computeExportBlackoutWarnings(rects, [])).toHaveLength(0);
  });

  it("warns when a blackout rect fully overlaps a detect box (IoU near 1)", () => {
    const rects: BlackoutRectShape[] = [{ type: "rect", x: 0.5, y: 0.5, w: 0.2, h: 0.2 }];
    const boxes = [{ x: 0.5, y: 0.5, w: 0.2, h: 0.2 }];
    const warnings = computeExportBlackoutWarnings(rects, boxes, 0.1);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].boxIndex).toBe(0);
    expect(warnings[0].iou).toBeCloseTo(1.0);
  });

  it("does not warn when blackout and box do not overlap", () => {
    const rects: BlackoutRectShape[] = [{ type: "rect", x: 0.1, y: 0.1, w: 0.1, h: 0.1 }];
    const boxes = [{ x: 0.9, y: 0.9, w: 0.1, h: 0.1 }];
    expect(computeExportBlackoutWarnings(rects, boxes, 0.1)).toHaveLength(0);
  });

  it("does not warn when IoU is below threshold", () => {
    // Small overlap: blackout at edge of box
    const rects: BlackoutRectShape[] = [{ type: "rect", x: 0.1, y: 0.5, w: 0.1, h: 0.1 }];
    const boxes = [{ x: 0.5, y: 0.5, w: 0.6, h: 0.1 }];
    // These share left portion; let the IoU land below 0.5 threshold
    const warnings = computeExportBlackoutWarnings(rects, boxes, 0.5);
    // IoU = inter / union; inter is a small portion, won't reach 0.5
    expect(warnings).toHaveLength(0);
  });

  it("reports boxIndex correctly for multiple boxes", () => {
    const rects: BlackoutRectShape[] = [{ type: "rect", x: 0.8, y: 0.5, w: 0.2, h: 0.2 }];
    const boxes = [
      { x: 0.2, y: 0.5, w: 0.2, h: 0.2 }, // boxIndex 0 — no overlap
      { x: 0.8, y: 0.5, w: 0.2, h: 0.2 }, // boxIndex 1 — full overlap
    ];
    const warnings = computeExportBlackoutWarnings(rects, boxes, 0.1);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].boxIndex).toBe(1);
  });

  it("skips zero-size rects when computing warnings", () => {
    const rects: BlackoutRectShape[] = [{ type: "rect", x: 0.5, y: 0.5, w: 0, h: 0 }];
    const boxes = [{ x: 0.5, y: 0.5, w: 0.2, h: 0.2 }];
    expect(computeExportBlackoutWarnings(rects, boxes)).toHaveLength(0);
  });

  it("can produce multiple warnings for multiple (rect, box) pairs", () => {
    const rects: BlackoutRectShape[] = [
      { type: "rect", x: 0.3, y: 0.5, w: 0.2, h: 0.2 },
      { type: "rect", x: 0.7, y: 0.5, w: 0.2, h: 0.2 },
    ];
    const boxes = [
      { x: 0.3, y: 0.5, w: 0.2, h: 0.2 }, // overlaps rect[0]
      { x: 0.7, y: 0.5, w: 0.2, h: 0.2 }, // overlaps rect[1]
    ];
    const warnings = computeExportBlackoutWarnings(rects, boxes, 0.1);
    expect(warnings).toHaveLength(2);
  });

  it("uses threshold 0.1 by default", () => {
    // Tiny overlap just below 10%: should not warn with default threshold
    // Two rects that barely touch — IoU << 0.1
    const rects: BlackoutRectShape[] = [{ type: "rect", x: 0.105, y: 0.5, w: 0.01, h: 0.01 }];
    const boxes = [{ x: 0.5, y: 0.5, w: 0.8, h: 0.8 }];
    // inter is tiny (0.01×0.01), union is large (0.8×0.8) → IoU ≈ 0.000156
    expect(computeExportBlackoutWarnings(rects, boxes)).toHaveLength(0);
  });
});
