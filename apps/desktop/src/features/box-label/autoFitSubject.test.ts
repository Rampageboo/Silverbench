import { describe, expect, it } from "vitest";
import { colorSubjectRectFromBitmap, selectionLooksLikeColorPick } from "./autoFitSubject";

function rgbaBitmap(width: number, height: number, rgba: [number, number, number, number]) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < width * height; index += 1) {
    const offset = index * 4;
    data[offset] = rgba[0];
    data[offset + 1] = rgba[1];
    data[offset + 2] = rgba[2];
    data[offset + 3] = rgba[3];
  }
  return data;
}

function fillRect(
  data: Uint8ClampedArray,
  width: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  rgba: [number, number, number, number]
) {
  for (let y = y1; y < y2; y += 1) {
    for (let x = x1; x < x2; x += 1) {
      const offset = (y * width + x) * 4;
      data[offset] = rgba[0];
      data[offset + 1] = rgba[1];
      data[offset + 2] = rgba[2];
      data[offset + 3] = rgba[3];
    }
  }
}

describe("auto fit color subject selection", () => {
  it("returns the clicked color component without merging separate same-color islands", () => {
    const width = 32;
    const height = 24;
    const data = rgbaBitmap(width, height, [245, 245, 245, 255]);

    fillRect(data, width, 10, 7, 16, 13, [220, 20, 20, 255]);
    fillRect(data, width, 24, 7, 29, 13, [220, 20, 20, 255]);
    fillRect(data, width, 18, 7, 22, 13, [20, 20, 220, 255]);

    const rect = colorSubjectRectFromBitmap(data, width, height, { x: 12, y: 9 });

    expect(rect).toEqual({ x1: 8, y1: 5, x2: 18, y2: 15 });
  });

  it("uses fixed per-channel tolerance instead of expanding to nearby colors", () => {
    const width = 32;
    const height = 24;
    const data = rgbaBitmap(width, height, [245, 245, 245, 255]);

    fillRect(data, width, 10, 6, 13, 12, [100, 100, 100, 255]);
    fillRect(data, width, 13, 6, 16, 12, [125, 125, 125, 255]);
    fillRect(data, width, 16, 6, 24, 12, [126, 126, 126, 255]);

    expect(colorSubjectRectFromBitmap(data, width, height, { x: 11, y: 8 }, { tolerance: 15 })).toEqual({
      x1: 8,
      y1: 4,
      x2: 15,
      y2: 14
    });
    expect(colorSubjectRectFromBitmap(data, width, height, { x: 11, y: 8 }, { tolerance: 25 })).toEqual({
      x1: 8,
      y1: 4,
      x2: 18,
      y2: 14
    });
  });

  it("bridges tiny color gaps so a clicked icon outline is boxed as one shape", () => {
    const width = 32;
    const height = 20;
    const data = rgbaBitmap(width, height, [250, 250, 250, 255]);

    fillRect(data, width, 5, 8, 10, 9, [0, 0, 0, 255]);
    fillRect(data, width, 10, 8, 12, 9, [40, 180, 240, 255]);
    fillRect(data, width, 12, 8, 20, 9, [0, 0, 0, 255]);

    expect(colorSubjectRectFromBitmap(data, width, height, { x: 6, y: 8 })).toEqual({
      x1: 3,
      y1: 6,
      x2: 22,
      y2: 11
    });
    expect(colorSubjectRectFromBitmap(data, width, height, { x: 6, y: 8 }, { bridgePixels: 0 })).toEqual({
      x1: 3,
      y1: 6,
      x2: 12,
      y2: 11
    });
  });

  it("does not bridge to a nearby separate edge just because it has the same color", () => {
    const width = 32;
    const height = 20;
    const data = rgbaBitmap(width, height, [250, 250, 250, 255]);

    fillRect(data, width, 5, 4, 7, 16, [0, 0, 0, 255]);
    fillRect(data, width, 9, 4, 11, 16, [0, 0, 0, 255]);

    expect(colorSubjectRectFromBitmap(data, width, height, { x: 6, y: 10 })).toEqual({
      x1: 3,
      y1: 2,
      x2: 9,
      y2: 18
    });
  });

  it("wraps a dark anti-aliased element when the clicked pixel is pure black", () => {
    const width = 36;
    const height = 20;
    const data = rgbaBitmap(width, height, [240, 240, 240, 255]);

    fillRect(data, width, 6, 5, 24, 15, [45, 45, 45, 255]);
    fillRect(data, width, 8, 7, 22, 13, [0, 0, 0, 255]);
    fillRect(data, width, 29, 5, 33, 15, [35, 35, 35, 255]);

    expect(colorSubjectRectFromBitmap(data, width, height, { x: 10, y: 9 })).toEqual({
      x1: 4,
      y1: 3,
      x2: 26,
      y2: 17
    });
  });

  it("treats small pointer movement as a color pick gesture", () => {
    expect(selectionLooksLikeColorPick({ x1: 0.5, y1: 0.5, x2: 0.505, y2: 0.5 }, 1000, 1000)).toBe(true);
    expect(selectionLooksLikeColorPick({ x1: 0.5, y1: 0.5, x2: 0.52, y2: 0.5 }, 1000, 1000)).toBe(false);
  });
});
