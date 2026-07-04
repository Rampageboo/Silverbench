import type { CanvasPreviewSource, ImagePoint, ImageRect } from "./geometry";
import { clamp, previewSourceSize } from "./geometry";

type PixelRect = { x1: number; y1: number; x2: number; y2: number };
type PixelPoint = { x: number; y: number };

export const COLOR_PICK_MAX_DRAG_PX = 10;
export const COLOR_SELECT_TOLERANCE = 25;
export const COLOR_SELECT_BRIDGE_PX = 2;

function clampRectToBitmap(rect: PixelRect, width: number, height: number): PixelRect | null {
  const x1 = Math.max(0, Math.min(width, Math.round(Math.min(rect.x1, rect.x2))));
  const y1 = Math.max(0, Math.min(height, Math.round(Math.min(rect.y1, rect.y2))));
  const x2 = Math.max(0, Math.min(width, Math.round(Math.max(rect.x1, rect.x2))));
  const y2 = Math.max(0, Math.min(height, Math.round(Math.max(rect.y1, rect.y2))));
  if (x2 <= x1 || y2 <= y1) return null;
  return { x1, y1, x2, y2 };
}

function pointRectToBitmap(point: PixelPoint, width: number, height: number): PixelRect {
  const x = Math.max(0, Math.min(width - 1, Math.round(point.x)));
  const y = Math.max(0, Math.min(height - 1, Math.round(point.y)));
  return { x1: x, y1: y, x2: Math.min(width, x + 1), y2: Math.min(height, y + 1) };
}

function clampSeedPoint(point: PixelPoint, rect: PixelRect): PixelPoint {
  return {
    x: Math.max(rect.x1, Math.min(rect.x2 - 1, Math.round(point.x))),
    y: Math.max(rect.y1, Math.min(rect.y2 - 1, Math.round(point.y)))
  };
}

function colorWithinTolerance(r: number, g: number, b: number, seedColor: number[], tolerance: number) {
  return (
    Math.abs(r - seedColor[0]) <= tolerance &&
    Math.abs(g - seedColor[1]) <= tolerance &&
    Math.abs(b - seedColor[2]) <= tolerance
  );
}

function luminance(r: number, g: number, b: number) {
  return r * 0.299 + g * 0.587 + b * 0.114;
}

function darkColorWithinTolerance(r: number, g: number, b: number, seedColor: number[], tolerance: number) {
  const seedLuma = luminance(seedColor[0], seedColor[1], seedColor[2]);
  if (seedLuma > 70) return false;
  return luminance(r, g, b) <= Math.max(90, seedLuma + tolerance * 2);
}

function pixelMatchesSeedColor(r: number, g: number, b: number, seedColor: number[], tolerance: number) {
  return darkColorWithinTolerance(r, g, b, seedColor, tolerance) || colorWithinTolerance(r, g, b, seedColor, tolerance);
}

function buildSimilarColorMask(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  seedColor: number[],
  tolerance: number
) {
  const mask = new Uint8Array(width * height);
  for (let index = 0; index < width * height; index += 1) {
    const dataIndex = index * 4;
    if (data[dataIndex + 3] < 16) continue;
    if (pixelMatchesSeedColor(data[dataIndex], data[dataIndex + 1], data[dataIndex + 2], seedColor, tolerance)) {
      mask[index] = 1;
    }
  }
  return mask;
}

function queueSimilarPixel(
  similar: Uint8Array,
  visited: Uint8Array,
  queue: number[],
  index: number
) {
  if (visited[index]) return;
  visited[index] = 1;
  if (similar[index]) queue.push(index);
}

function isSimilarAt(similar: Uint8Array, width: number, height: number, x: number, y: number) {
  return x >= 0 && x < width && y >= 0 && y < height && similar[y * width + x] === 1;
}

function directionSupport(similar: Uint8Array, width: number, height: number, x: number, y: number, dx: -1 | 0 | 1, dy: -1 | 0 | 1) {
  return (
    (isSimilarAt(similar, width, height, x - dx, y - dy) ? 1 : 0) +
    (isSimilarAt(similar, width, height, x + dx, y + dy) ? 1 : 0)
  );
}

function axisRunSupport(
  similar: Uint8Array,
  width: number,
  height: number,
  x: number,
  y: number,
  dx: -1 | 0 | 1,
  dy: -1 | 0 | 1,
  maxDistance = 3
) {
  let count = 0;
  for (const direction of [-1, 1] as const) {
    for (let distance = 1; distance <= maxDistance; distance += 1) {
      if (!isSimilarAt(similar, width, height, x + dx * distance * direction, y + dy * distance * direction)) break;
      count += 1;
    }
  }
  return count;
}

function bridgeDirectionMatchesLocalStroke(
  similar: Uint8Array,
  width: number,
  height: number,
  x: number,
  y: number,
  dx: -1 | 0 | 1,
  dy: -1 | 0 | 1
) {
  const along = directionSupport(similar, width, height, x, y, dx, dy);
  const alongRun = axisRunSupport(similar, width, height, x, y, dx, dy);
  const acrossRun = axisRunSupport(similar, width, height, x, y, -dy as -1 | 0 | 1, dx);
  return along > 0 && alongRun >= 2 && alongRun > acrossRun;
}

function bridgeTargetIndex(
  similar: Uint8Array,
  width: number,
  height: number,
  x: number,
  y: number,
  dx: -1 | 0 | 1,
  dy: -1 | 0 | 1,
  radius: number
) {
  if (radius <= 0) return null;
  const hasSourceSupport = isSimilarAt(similar, width, height, x - dx, y - dy);
  if (!hasSourceSupport) return null;
  if (!bridgeDirectionMatchesLocalStroke(similar, width, height, x, y, dx, dy)) return null;
  for (let gap = 1; gap <= radius; gap += 1) {
    const gx = x + dx * gap;
    const gy = y + dy * gap;
    if (gx < 0 || gx >= width || gy < 0 || gy >= height) return null;
    if (similar[gy * width + gx]) return null;
    const tx = x + dx * (gap + 1);
    const ty = y + dy * (gap + 1);
    if (!isSimilarAt(similar, width, height, tx, ty)) continue;
    const hasTargetSupport = isSimilarAt(similar, width, height, tx + dx, ty + dy);
    if (!bridgeDirectionMatchesLocalStroke(similar, width, height, tx, ty, dx, dy)) return null;
    return hasTargetSupport ? ty * width + tx : null;
  }
  return null;
}

function floodSimilarColor(
  similar: Uint8Array,
  width: number,
  height: number,
  sx: number,
  sy: number,
  bridgePixels: number
) {
  const start = sy * width + sx;
  if (!similar[start]) return null;
  const visited = new Uint8Array(width * height);
  const queue = [start];
  visited[start] = 1;
  let area = 0;
  let x1 = width;
  let y1 = height;
  let x2 = 0;
  let y2 = 0;
  for (let head = 0; head < queue.length; head += 1) {
    const p = queue[head];
    const x = p % width;
    const y = Math.floor(p / width);
    if (similar[p]) {
      area += 1;
      x1 = Math.min(x1, x);
      y1 = Math.min(y1, y);
      x2 = Math.max(x2, x);
      y2 = Math.max(y2, y);
    }
    if (x > 0) queueSimilarPixel(similar, visited, queue, p - 1);
    if (x < width - 1) queueSimilarPixel(similar, visited, queue, p + 1);
    if (y > 0) queueSimilarPixel(similar, visited, queue, p - width);
    if (y < height - 1) queueSimilarPixel(similar, visited, queue, p + width);
    if (x > 0 && y > 0) queueSimilarPixel(similar, visited, queue, p - width - 1);
    if (x < width - 1 && y > 0) queueSimilarPixel(similar, visited, queue, p - width + 1);
    if (x > 0 && y < height - 1) queueSimilarPixel(similar, visited, queue, p + width - 1);
    if (x < width - 1 && y < height - 1) queueSimilarPixel(similar, visited, queue, p + width + 1);

    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const target = bridgeTargetIndex(similar, width, height, x, y, dx, dy, bridgePixels);
      if (target !== null) queueSimilarPixel(similar, visited, queue, target);
    }
  }
  return area >= 4 ? { x1, y1, x2, y2, area } : null;
}

function pixelRectToNormalized(rect: PixelRect, width: number, height: number): ImageRect {
  return {
    x1: clamp(rect.x1 / width, 0, 1),
    y1: clamp(rect.y1 / height, 0, 1),
    x2: clamp(rect.x2 / width, 0, 1),
    y2: clamp(rect.y2 / height, 0, 1)
  };
}

export function colorSubjectRectFromBitmap(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  seedPoint: PixelPoint,
  options: { tolerance?: number; bridgePixels?: number } = {}
): PixelRect | null {
  if (width <= 0 || height <= 0 || data.length < width * height * 4) return null;
  const tolerance = Math.max(0, Math.min(255, Math.round(options.tolerance ?? COLOR_SELECT_TOLERANCE)));
  const bridgePixels = Math.max(0, Math.min(6, Math.round(options.bridgePixels ?? COLOR_SELECT_BRIDGE_PX)));
  const seed = clampSeedPoint(seedPoint, { x1: 0, y1: 0, x2: width, y2: height });
  const sx = seed.x;
  const sy = seed.y;
  const seedIndex = (sy * width + sx) * 4;
  if (data[seedIndex + 3] < 16) return null;
  const seedColor = [data[seedIndex], data[seedIndex + 1], data[seedIndex + 2]];
  const similar = buildSimilarColorMask(data, width, height, seedColor, tolerance);
  const component = floodSimilarColor(similar, width, height, sx, sy, bridgePixels);
  if (!component) return null;

  const pad = Math.max(2, Math.round(Math.min(width, height) * 0.006));
  return {
    x1: Math.max(0, component.x1 - pad),
    y1: Math.max(0, component.y1 - pad),
    x2: Math.min(width, component.x2 + pad + 1),
    y2: Math.min(height, component.y2 + pad + 1)
  };
}

export function selectionLooksLikeColorPick(rect: ImageRect, imageWidth: number, imageHeight: number) {
  const w = Math.round(Math.abs(rect.x2 - rect.x1) * imageWidth);
  const h = Math.round(Math.abs(rect.y2 - rect.y1) * imageHeight);
  return Math.max(w, h) <= COLOR_PICK_MAX_DRAG_PX;
}

/** Color flood-fill subject selection (legacy poolLabelColorSubjectRectFromBitmap). */
export function autoFitSubjectFromImage(
  image: CanvasPreviewSource,
  selection: ImageRect,
  seedNorm: ImagePoint
): ImageRect | null {
  const { width: bitmapW, height: bitmapH } = previewSourceSize(image);
  const seedPx = { x: seedNorm.x * bitmapW, y: seedNorm.y * bitmapH };
  const selectionRect =
    clampRectToBitmap(
      {
        x1: selection.x1 * bitmapW,
        y1: selection.y1 * bitmapH,
        x2: selection.x2 * bitmapW,
        y2: selection.y2 * bitmapH
      },
      bitmapW,
      bitmapH
    ) || pointRectToBitmap(seedPx, bitmapW, bitmapH);
  const selectionW = selectionRect.x2 - selectionRect.x1;
  const selectionH = selectionRect.y2 - selectionRect.y1;
  const bounded = selectionW >= 3 && selectionH >= 3;
  const sourceRect = bounded ? selectionRect : { x1: 0, y1: 0, x2: bitmapW, y2: bitmapH };
  const seed = clampSeedPoint(seedPx, sourceRect);

  const sourceW = sourceRect.x2 - sourceRect.x1;
  const sourceH = sourceRect.y2 - sourceRect.y1;
  const maxEdge = 900;
  const scale = Math.min(1, maxEdge / Math.max(sourceW, sourceH));
  const w = Math.max(1, Math.round(sourceW * scale));
  const h = Math.max(1, Math.round(sourceH * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return null;
  context.drawImage(image, sourceRect.x1, sourceRect.y1, sourceW, sourceH, 0, 0, w, h);
  const data = context.getImageData(0, 0, w, h).data;
  const component = colorSubjectRectFromBitmap(data, w, h, {
    x: Math.round((seed.x - sourceRect.x1) * scale),
    y: Math.round((seed.y - sourceRect.y1) * scale)
  });
  if (!component) return null;

  const fitted = clampRectToBitmap(
    {
      x1: Math.round(sourceRect.x1 + component.x1 / scale),
      y1: Math.round(sourceRect.y1 + component.y1 / scale),
      x2: Math.round(sourceRect.x1 + component.x2 / scale),
      y2: Math.round(sourceRect.y1 + component.y2 / scale)
    },
    bitmapW,
    bitmapH
  );
  return fitted ? pixelRectToNormalized(fitted, bitmapW, bitmapH) : null;
}

export function selectionTooSmallPixels(
  rect: ImageRect,
  imageWidth: number,
  imageHeight: number,
  options?: { allowAutoFitClick?: boolean }
) {
  const w = Math.round((rect.x2 - rect.x1) * imageWidth);
  const h = Math.round((rect.y2 - rect.y1) * imageHeight);
  if (options?.allowAutoFitClick && selectionLooksLikeColorPick(rect, imageWidth, imageHeight)) return false;
  return w < 2 || h < 2;
}
