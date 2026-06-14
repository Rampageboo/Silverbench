import type { ImagePoint, ImageRect } from "./geometry";
import { clamp } from "./geometry";

type PixelRect = { x1: number; y1: number; x2: number; y2: number };
type PixelPoint = { x: number; y: number };

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

function colorDistance(r: number, g: number, b: number, mean: number[]) {
  const dr = r - mean[0];
  const dg = g - mean[1];
  const db = b - mean[2];
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

function colorSelectionThreshold(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  sx: number,
  sy: number,
  seedColor: number[]
) {
  const distances: number[] = [];
  for (let y = Math.max(0, sy - 3); y <= Math.min(height - 1, sy + 3); y += 1) {
    for (let x = Math.max(0, sx - 3); x <= Math.min(width - 1, sx + 3); x += 1) {
      const index = (y * width + x) * 4;
      if (data[index + 3] < 16) continue;
      distances.push(colorDistance(data[index], data[index + 1], data[index + 2], seedColor));
    }
  }
  if (!distances.length) return 32;
  const avg = distances.reduce((sum, value) => sum + value, 0) / distances.length;
  const variance = distances.reduce((sum, value) => sum + (value - avg) ** 2, 0) / distances.length;
  return Math.max(24, Math.min(90, avg + Math.sqrt(variance) * 3 + 24));
}

function queueSimilarPixel(
  data: Uint8ClampedArray,
  width: number,
  visited: Uint8Array,
  queue: number[],
  index: number,
  seedColor: number[],
  threshold: number
) {
  if (visited[index]) return;
  visited[index] = 1;
  const dataIndex = index * 4;
  if (data[dataIndex + 3] < 16) return;
  if (colorDistance(data[dataIndex], data[dataIndex + 1], data[dataIndex + 2], seedColor) <= threshold) {
    queue.push(index);
  }
}

function floodSimilarColor(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  sx: number,
  sy: number,
  seedColor: number[],
  threshold: number
) {
  const start = sy * width + sx;
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
    area += 1;
    x1 = Math.min(x1, x);
    y1 = Math.min(y1, y);
    x2 = Math.max(x2, x);
    y2 = Math.max(y2, y);
    if (x > 0) queueSimilarPixel(data, width, visited, queue, p - 1, seedColor, threshold);
    if (x < width - 1) queueSimilarPixel(data, width, visited, queue, p + 1, seedColor, threshold);
    if (y > 0) queueSimilarPixel(data, width, visited, queue, p - width, seedColor, threshold);
    if (y < height - 1) queueSimilarPixel(data, width, visited, queue, p + width, seedColor, threshold);
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

/** Color flood-fill subject selection (legacy poolLabelColorSubjectRectFromBitmap). */
export function autoFitSubjectFromImage(
  image: HTMLImageElement,
  selection: ImageRect,
  seedNorm: ImagePoint
): ImageRect | null {
  const bitmapW = image.naturalWidth;
  const bitmapH = image.naturalHeight;
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
  const sx = Math.max(0, Math.min(w - 1, Math.round((seed.x - sourceRect.x1) * scale)));
  const sy = Math.max(0, Math.min(h - 1, Math.round((seed.y - sourceRect.y1) * scale)));
  const seedIndex = (sy * w + sx) * 4;
  if (data[seedIndex + 3] < 16) return null;
  const seedColor = [data[seedIndex], data[seedIndex + 1], data[seedIndex + 2]];
  const threshold = colorSelectionThreshold(data, w, h, sx, sy, seedColor);
  const component = floodSimilarColor(data, w, h, sx, sy, seedColor, threshold);
  if (!component) return null;

  const pad = Math.max(2, Math.round(Math.min(w, h) * 0.006));
  const x1 = Math.max(0, component.x1 - pad);
  const y1 = Math.max(0, component.y1 - pad);
  const x2 = Math.min(w, component.x2 + pad + 1);
  const y2 = Math.min(h, component.y2 + pad + 1);
  const fitted = clampRectToBitmap(
    {
      x1: Math.round(sourceRect.x1 + x1 / scale),
      y1: Math.round(sourceRect.y1 + y1 / scale),
      x2: Math.round(sourceRect.x1 + x2 / scale),
      y2: Math.round(sourceRect.y1 + y2 / scale)
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
  if (options?.allowAutoFitClick && w < 2 && h < 2) return false;
  return w < 2 || h < 2;
}
