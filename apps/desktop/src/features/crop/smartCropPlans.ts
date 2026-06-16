import type { LabelBox } from "../../api";

export type SmartCropSettings = {
  targetW: number;
  targetH: number;
  maxPerImage: number;
  boxMarginPx: number;
};

export type PixelRect = { x: number; y: number; w: number; h: number };

export type SmartCropPlan = {
  rect: PixelRect;
  boxes: LabelBox[];
  sourceBoxIndexes: number[];
  marginScore: number;
  emptyPenalty: number;
};

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

export function yoloBoxToPixelRect(box: LabelBox, imageW: number, imageH: number): PixelRect {
  const x1 = clamp01(box.x - box.w / 2) * imageW;
  const y1 = clamp01(box.y - box.h / 2) * imageH;
  const x2 = clamp01(box.x + box.w / 2) * imageW;
  const y2 = clamp01(box.y + box.h / 2) * imageH;
  return { x: x1, y: y1, w: Math.max(0, x2 - x1), h: Math.max(0, y2 - y1) };
}

function expandRect(rect: PixelRect, margin: number): PixelRect {
  return { x: rect.x - margin, y: rect.y - margin, w: rect.w + margin * 2, h: rect.h + margin * 2 };
}

function rectIntersection(a: PixelRect, b: PixelRect): PixelRect | null {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w);
  const y2 = Math.min(a.y + a.h, b.y + b.h);
  if (x2 <= x1 || y2 <= y1) return null;
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

function rectArea(rect: PixelRect) {
  return Math.max(0, rect.w) * Math.max(0, rect.h);
}

function rectIou(a: PixelRect, b: PixelRect) {
  const intersection = rectIntersection(a, b);
  if (!intersection) return 0;
  const area = rectArea(intersection);
  return area / Math.max(1, rectArea(a) + rectArea(b) - area);
}

function unionRects(rects: PixelRect[]): PixelRect {
  const x1 = Math.min(...rects.map((rect) => rect.x));
  const y1 = Math.min(...rects.map((rect) => rect.y));
  const x2 = Math.max(...rects.map((rect) => rect.x + rect.w));
  const y2 = Math.max(...rects.map((rect) => rect.y + rect.h));
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

function rectContainsWithMargin(crop: PixelRect, box: PixelRect, margin: number) {
  return (
    box.x >= crop.x + margin &&
    box.y >= crop.y + margin &&
    box.x + box.w <= crop.x + crop.w - margin &&
    box.y + box.h <= crop.y + crop.h - margin
  );
}

export function cropSizeForImage(imageW: number, imageH: number, targetW: number, targetH: number) {
  const aspect = targetW / targetH;
  let w = Math.min(targetW, imageW);
  let h = Math.round(w / aspect);
  if (h > imageH) {
    h = Math.min(targetH, imageH);
    w = Math.round(h * aspect);
  }
  return { w: Math.max(1, Math.min(imageW, w)), h: Math.max(1, Math.min(imageH, h)) };
}

type PixelBox = { index: number; classId: number; rect: PixelRect; marginRect: PixelRect };

function cropPlanForRect(rect: PixelRect, pixelBoxes: PixelBox[], marginPx: number): SmartCropPlan {
  const outBoxes: LabelBox[] = [];
  const sourceBoxIndexes: number[] = [];
  let marginScore = 0;
  for (const item of pixelBoxes) {
    if (!rectIntersection(rect, item.rect)) continue;
    if (!rectContainsWithMargin(rect, item.rect, marginPx)) {
      return { rect, boxes: [], sourceBoxIndexes: [], marginScore: 0, emptyPenalty: rectArea(rect) };
    }
    const edgeClearance = Math.min(
      item.rect.x - rect.x,
      item.rect.y - rect.y,
      rect.x + rect.w - item.rect.x - item.rect.w,
      rect.y + rect.h - item.rect.y - item.rect.h
    );
    outBoxes.push({
      classId: item.classId,
      x: (item.rect.x - rect.x + item.rect.w / 2) / rect.w,
      y: (item.rect.y - rect.y + item.rect.h / 2) / rect.h,
      w: item.rect.w / rect.w,
      h: item.rect.h / rect.h
    });
    sourceBoxIndexes.push(item.index);
    marginScore += Math.min(edgeClearance, marginPx * 2 || edgeClearance);
  }
  const keptRect = outBoxes.length
    ? unionRects(sourceBoxIndexes.map((index) => pixelBoxes.find((item) => item.index === index)!.rect))
    : { x: 0, y: 0, w: 0, h: 0 };
  const emptyPenalty = rectArea(keptRect) ? rectArea(rect) / Math.max(1, rectArea(keptRect)) : rectArea(rect);
  return { rect, boxes: outBoxes, sourceBoxIndexes, marginScore, emptyPenalty };
}

export function chooseSmartCropPlans(imageW: number, imageH: number, boxes: LabelBox[], settings: SmartCropSettings): SmartCropPlan[] {
  const size = cropSizeForImage(imageW, imageH, settings.targetW, settings.targetH);
  const pixelBoxes: PixelBox[] = boxes
    .map((box, index) => ({
      index,
      classId: box.classId,
      rect: yoloBoxToPixelRect(box, imageW, imageH),
      marginRect: { x: 0, y: 0, w: 0, h: 0 }
    }))
    .filter((item) => item.rect.w > 1 && item.rect.h > 1);
  for (const item of pixelBoxes) {
    item.marginRect = expandRect(item.rect, settings.boxMarginPx);
  }
  if (!pixelBoxes.length) return [];

  const candidates = new Map<string, SmartCropPlan>();
  const addCandidate = (x: number, y: number) => {
    const rect: PixelRect = {
      x: Math.round(Math.max(0, Math.min(imageW - size.w, x))),
      y: Math.round(Math.max(0, Math.min(imageH - size.h, y))),
      w: size.w,
      h: size.h
    };
    const key = `${rect.x},${rect.y},${rect.w},${rect.h}`;
    if (!candidates.has(key)) candidates.set(key, cropPlanForRect(rect, pixelBoxes, settings.boxMarginPx));
  };
  const addCentered = (cx: number, cy: number) => addCandidate(cx - size.w / 2, cy - size.h / 2);
  const allRect = unionRects(pixelBoxes.map((item) => item.marginRect));
  addCentered(allRect.x + allRect.w / 2, allRect.y + allRect.h / 2);
  addCandidate(allRect.x, allRect.y);
  addCandidate(allRect.x + allRect.w - size.w, allRect.y + allRect.h - size.h);
  addCandidate(allRect.x, allRect.y + allRect.h - size.h);
  addCandidate(allRect.x + allRect.w - size.w, allRect.y);
  addCentered(imageW / 2, imageH / 2);
  for (const item of pixelBoxes) {
    addCentered(item.rect.x + item.rect.w / 2, item.rect.y + item.rect.h / 2);
    addCandidate(item.marginRect.x, item.marginRect.y);
    addCandidate(item.marginRect.x + item.marginRect.w - size.w, item.marginRect.y + item.marginRect.h - size.h);
  }

  const plans = [...candidates.values()].filter((plan) => plan.boxes.length);
  const selected: SmartCropPlan[] = [];
  const covered = new Set<number>();
  while (selected.length < settings.maxPerImage) {
    let best: SmartCropPlan | null = null;
    let bestScore = -Infinity;
    for (const plan of plans) {
      if (selected.some((existing) => rectIou(plan.rect, existing.rect) > 0.82)) continue;
      const newBoxes = plan.sourceBoxIndexes.filter((index) => !covered.has(index)).length;
      if (!newBoxes && selected.length) continue;
      const score = newBoxes * 10000 + plan.boxes.length * 1000 + plan.marginScore - plan.emptyPenalty;
      if (score > bestScore) {
        best = plan;
        bestScore = score;
      }
    }
    if (!best) break;
    selected.push(best);
    for (const index of best.sourceBoxIndexes) covered.add(index);
  }
  return selected;
}

export function boxesToText(boxes: LabelBox[]) {
  return boxes.map((box) => `${box.classId} ${box.x} ${box.y} ${box.w} ${box.h}`).join("\n");
}

import { sanitizeFilename } from "../../lib/sanitizePathSegment";

export function sanitizeCropFilename(stem: string) {
  return sanitizeFilename(stem, "crop");
}

export function smallPathHash(path: string) {
  let hash = 0;
  for (let i = 0; i < path.length; i += 1) hash = (hash * 31 + path.charCodeAt(i)) >>> 0;
  return hash.toString(16).padStart(8, "0").slice(-8);
}

export function outputImageExtension(path: string) {
  const extension = (path.split(".").pop() || "png").toLowerCase();
  return extension === "jpeg" ? "jpg" : extension || "png";
}

export function mimeFor(path: string) {
  const ext = outputImageExtension(path);
  if (ext === "jpg") return "image/jpeg";
  if (ext === "webp") return "image/webp";
  if (ext === "bmp") return "image/bmp";
  return "image/png";
}

export function cropRunId() {
  const date = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}_${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}
