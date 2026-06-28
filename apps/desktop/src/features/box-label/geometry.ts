import type React from "react";
import type * as api from "../../api";

export type ToolMode = "select" | "draw" | "pan";
export type BoxAdjustMode = "grow" | "shrink";
export type DragHandle = "move" | "n" | "s" | "e" | "w" | "nw" | "ne" | "sw" | "se";
export type ImagePoint = { x: number; y: number };
export type ImageRect = { x1: number; y1: number; x2: number; y2: number };

export type Viewport = {
  zoom: number;
  panX: number;
  panY: number;
};

export type DisplayRect = {
  x: number;
  y: number;
  w: number;
  h: number;
};

export type DragState =
  | null
  | { type: "draw"; start: ImagePoint; current: ImagePoint }
  | { type: "pan"; button: number; pureClick: boolean; startClientX: number; startClientY: number; startPanX: number; startPanY: number }
  | {
      type: "box";
      index: number;
      handle: DragHandle;
      start: ImagePixelPoint;
      startRect: ImageRect;
      moved: boolean;
    };

export const SLOT_ORDER = [1, 2, 3, 4, 5, 6, 7, 8, 9, 0] as const;

export const POOL_LABEL_ZOOM = { width: 500, height: 600, factor: 2 } as const;

export type ImagePixelPoint = { x: number; y: number };

export function loadCanvasImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Failed to load preview image."));
    image.src = src;
  });
}

export function resizeCanvasToParent(canvas: HTMLCanvasElement | null) {
  if (!canvas) return;
  const parent = canvas.parentElement;
  const ratio = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  const cssWidth = rect.width || parent?.clientWidth || 1;
  const cssHeight = rect.height || parent?.clientHeight || 1;
  const nextWidth = Math.max(1, Math.floor(cssWidth * ratio));
  const nextHeight = Math.max(1, Math.floor(cssHeight * ratio));
  if (canvas.width !== nextWidth) canvas.width = nextWidth;
  if (canvas.height !== nextHeight) canvas.height = nextHeight;
}

export function imageDisplayRect(canvas: HTMLCanvasElement, image: HTMLImageElement, viewport: Viewport): DisplayRect {
  const baseScale = Math.min(canvas.width / image.naturalWidth, canvas.height / image.naturalHeight);
  const scale = baseScale * viewport.zoom;
  const w = image.naturalWidth * scale;
  const h = image.naturalHeight * scale;
  return {
    x: (canvas.width - w) / 2 + viewport.panX,
    y: (canvas.height - h) / 2 + viewport.panY,
    w,
    h
  };
}

/** Match legacy clampPreviewView() pan/zoom bounds. */
export function clampViewportPan(canvas: HTMLCanvasElement, image: HTMLImageElement, viewport: Viewport): Viewport {
  const zoom = clamp(viewport.zoom, 1, 12);
  const baseScale = Math.min(canvas.width / image.naturalWidth, canvas.height / image.naturalHeight);
  const w = image.naturalWidth * baseScale * zoom;
  const h = image.naturalHeight * baseScale * zoom;
  const maxPanX = Math.max(0, (w - canvas.width) / 2);
  const maxPanY = Math.max(0, (h - canvas.height) / 2);
  let panX = clamp(viewport.panX, -maxPanX, maxPanX);
  let panY = clamp(viewport.panY, -maxPanY, maxPanY);
  if (zoom <= 1) {
    panX = 0;
    panY = 0;
  }
  return { zoom, panX, panY };
}

export function eventCanvasPoint(
  event: React.PointerEvent<HTMLCanvasElement> | React.WheelEvent<HTMLCanvasElement>,
  canvas: HTMLCanvasElement
): ImagePoint {
  const rect = canvas.getBoundingClientRect();
  return {
    x: ((event.clientX - rect.left) * canvas.width) / rect.width,
    y: ((event.clientY - rect.top) * canvas.height) / rect.height
  };
}

export function canvasToImagePoint(point: ImagePoint, display: DisplayRect): ImagePoint | null {
  const x = (point.x - display.x) / display.w;
  const y = (point.y - display.y) / display.h;
  if (x < 0 || y < 0 || x > 1 || y > 1) return null;
  return { x: clamp01(x), y: clamp01(y) };
}

export function canvasPixelsToImagePixels(px: number, display: DisplayRect, imageWidth: number, imageHeight: number) {
  if (!display.w || !display.h) return px;
  return px * Math.max(imageWidth / display.w, imageHeight / display.h);
}

export function pointerImagePointFromCanvas(
  canvasPoint: ImagePoint,
  display: DisplayRect,
  imageWidth: number,
  imageHeight: number,
  options: { clamp?: boolean } = {}
): ImagePixelPoint | null {
  const rawX = (canvasPoint.x - display.x) * imageWidth / display.w;
  const rawY = (canvasPoint.y - display.y) * imageHeight / display.h;
  if (options.clamp) {
    return {
      x: Math.round(clamp(rawX, 0, imageWidth)),
      y: Math.round(clamp(rawY, 0, imageHeight))
    };
  }
  if (rawX < 0 || rawY < 0 || rawX > imageWidth || rawY > imageHeight) return null;
  return { x: Math.round(rawX), y: Math.round(rawY) };
}

export function pointerImagePointFromEvent(
  event: React.PointerEvent<HTMLCanvasElement>,
  canvas: HTMLCanvasElement,
  display: DisplayRect,
  imageWidth: number,
  imageHeight: number,
  options: { clamp?: boolean } = {}
) {
  return pointerImagePointFromCanvas(eventCanvasPoint(event, canvas), display, imageWidth, imageHeight, options);
}

export function imagePixelRectToCanvasRect(rect: ImageRect, display: DisplayRect, imageWidth: number, imageHeight: number): ImageRect {
  return {
    x1: display.x + (rect.x1 * display.w) / imageWidth,
    y1: display.y + (rect.y1 * display.h) / imageHeight,
    x2: display.x + (rect.x2 * display.w) / imageWidth,
    y2: display.y + (rect.y2 * display.h) / imageHeight
  };
}

export function boxToImagePixelRect(box: api.LabelBox, imageWidth: number, imageHeight: number): ImageRect {
  return {
    x1: Math.round((box.x - box.w / 2) * imageWidth),
    y1: Math.round((box.y - box.h / 2) * imageHeight),
    x2: Math.round((box.x + box.w / 2) * imageWidth),
    y2: Math.round((box.y + box.h / 2) * imageHeight)
  };
}

export function pixelRectToBox(rect: ImageRect, classId: number, imageWidth: number, imageHeight: number): api.LabelBox {
  const normalized = normalizeRect({
    x1: rect.x1 / imageWidth,
    y1: rect.y1 / imageHeight,
    x2: rect.x2 / imageWidth,
    y2: rect.y2 / imageHeight
  });
  return rectToBox(normalized, classId);
}

export function hitHandleAtImagePixelPoint(
  point: ImagePixelPoint,
  rect: ImageRect,
  display: DisplayRect
): DragHandle {
  const w = Math.max(1, rect.x2 - rect.x1);
  const h = Math.max(1, rect.y2 - rect.y1);
  const edge = Math.max(
    1,
    Math.min(Math.round(canvasPixelsToImagePixels(6, display, w, h)), Math.floor(Math.min(w, h) / 4))
  );
  const nearN = point.y >= rect.y1 && point.y - rect.y1 <= edge;
  const nearS = point.y <= rect.y2 && rect.y2 - point.y <= edge;
  const nearW = point.x >= rect.x1 && point.x - rect.x1 <= edge;
  const nearE = point.x <= rect.x2 && rect.x2 - point.x <= edge;
  if (!nearN && !nearS && !nearW && !nearE) return "move";
  if (nearN && nearW) return "nw";
  if (nearN && nearE) return "ne";
  if (nearS && nearW) return "sw";
  if (nearS && nearE) return "se";
  if (nearN) return "n";
  if (nearS) return "s";
  if (nearW) return "w";
  if (nearE) return "e";
  return "move";
}

function pointInPixelRect(point: ImagePixelPoint, rect: ImageRect, pad = 0) {
  return (
    point.x >= Math.min(rect.x1, rect.x2) - pad &&
    point.x <= Math.max(rect.x1, rect.x2) + pad &&
    point.y >= Math.min(rect.y1, rect.y2) - pad &&
    point.y <= Math.max(rect.y1, rect.y2) + pad
  );
}

export function hitTestAtImagePixel(
  point: ImagePixelPoint,
  boxes: api.LabelBox[],
  display: DisplayRect,
  imageWidth: number,
  imageHeight: number
): { index: number; handle: DragHandle } {
  let bestIndex = -1;
  let bestArea = Infinity;
  for (let index = boxes.length - 1; index >= 0; index -= 1) {
    const rect = boxToImagePixelRect(boxes[index], imageWidth, imageHeight);
    if (!pointInPixelRect(point, rect, 0)) continue;
    const area = Math.max(1, Math.abs((rect.x2 - rect.x1) * (rect.y2 - rect.y1)));
    if (area < bestArea) {
      bestArea = area;
      bestIndex = index;
    }
  }
  if (bestIndex < 0) return { index: -1, handle: "move" };
  const rect = boxToImagePixelRect(boxes[bestIndex], imageWidth, imageHeight);
  return { index: bestIndex, handle: hitHandleAtImagePixelPoint(point, rect, display) };
}

export function movePixelRect(rect: ImageRect, dx: number, dy: number, maxW: number, maxH: number): ImageRect {
  const next = { ...rect };
  const width = next.x2 - next.x1;
  const height = next.y2 - next.y1;
  next.x1 = Math.max(0, Math.min(maxW - width, next.x1 + dx));
  next.y1 = Math.max(0, Math.min(maxH - height, next.y1 + dy));
  next.x2 = next.x1 + width;
  next.y2 = next.y1 + height;
  return next;
}

export function resizePixelRectByHandle(
  rect: ImageRect,
  handle: DragHandle,
  dx: number,
  dy: number,
  maxW: number,
  maxH: number,
  minSize = 2
): ImageRect {
  const next = { ...rect };
  if (handle.includes("w")) next.x1 = Math.max(0, Math.min(next.x2 - minSize, next.x1 + dx));
  if (handle.includes("e")) next.x2 = Math.min(maxW, Math.max(next.x1 + minSize, next.x2 + dx));
  if (handle.includes("n")) next.y1 = Math.max(0, Math.min(next.y2 - minSize, next.y1 + dy));
  if (handle.includes("s")) next.y2 = Math.min(maxH, Math.max(next.y1 + minSize, next.y2 + dy));
  if (next.x1 > next.x2) [next.x1, next.x2] = [next.x2, next.x1];
  if (next.y1 > next.y2) [next.y1, next.y2] = [next.y2, next.y1];
  return next;
}

export function resizeOrMovePixelRect(
  rect: ImageRect,
  handle: DragHandle,
  start: ImagePixelPoint,
  current: ImagePixelPoint,
  maxW: number,
  maxH: number
): ImageRect {
  const dx = current.x - start.x;
  const dy = current.y - start.y;
  if (handle === "move") return movePixelRect(rect, dx, dy, maxW, maxH);
  return resizePixelRectByHandle(rect, handle, dx, dy, maxW, maxH);
}

export function zoomSourceRect(
  center: ImagePixelPoint,
  display: DisplayRect,
  imageWidth: number,
  imageHeight: number
): ImageRect {
  const displayScale = display.w / imageWidth;
  const viewScale = displayScale * POOL_LABEL_ZOOM.factor;
  let srcW = POOL_LABEL_ZOOM.width / viewScale;
  let srcH = POOL_LABEL_ZOOM.height / viewScale;
  srcW = Math.min(srcW, imageWidth);
  srcH = Math.min(srcH, imageHeight);
  let x1 = center.x - srcW / 2;
  let y1 = center.y - srcH / 2;
  x1 = Math.max(0, Math.min(imageWidth - srcW, x1));
  y1 = Math.max(0, Math.min(imageHeight - srcH, y1));
  return { x1, y1, x2: x1 + srcW, y2: y1 + srcH };
}

export function imagePixelToZoomCanvas(
  point: ImagePixelPoint,
  sourceRect: ImageRect,
  zoomWidth: number,
  zoomHeight: number
): ImagePoint {
  const srcW = sourceRect.x2 - sourceRect.x1;
  const srcH = sourceRect.y2 - sourceRect.y1;
  return {
    x: ((point.x - sourceRect.x1) / srcW) * zoomWidth,
    y: ((point.y - sourceRect.y1) / srcH) * zoomHeight
  };
}

export function imagePixelPointToNormalized(point: ImagePixelPoint, imageWidth: number, imageHeight: number): ImagePoint {
  return {
    x: clamp01(point.x / imageWidth),
    y: clamp01(point.y / imageHeight)
  };
}

export function boxCenterPixel(box: api.LabelBox | undefined, imageWidth: number, imageHeight: number): ImagePixelPoint {
  if (!box) return { x: Math.round(imageWidth / 2), y: Math.round(imageHeight / 2) };
  return {
    x: Math.round(clamp(box.x, 0, 1) * imageWidth),
    y: Math.round(clamp(box.y, 0, 1) * imageHeight)
  };
}

export function drawBoxes(
  ctx: CanvasRenderingContext2D,
  display: DisplayRect,
  boxes: api.LabelBox[],
  selected: number | null,
  classes: api.LabelClass[] = []
) {
  boxes.forEach((box, index) => {
    const color = selected === index ? "#2f81f7" : "#22c55e";
    drawImageRect(ctx, display, boxToRect(box), color, false);
    const rect = boxToCanvasRect(boxToRect(box), display);
    const label = classNameFor(classes, box.classId);
    ctx.font = "12px Segoe UI";
    const labelWidth = Math.ceil(ctx.measureText(label).width) + 12;
    ctx.fillStyle = color;
    ctx.fillRect(rect.x1, Math.max(0, rect.y1 - 18), Math.max(28, labelWidth), 18);
    ctx.fillStyle = "#ffffff";
    ctx.fillText(label, rect.x1 + 5, Math.max(12, rect.y1 - 5));
    if (selected === index) drawCornerHandles(ctx, rect);
  });
}

export type ProposalShape = { id: string; x: number; y: number; w: number; h: number; confidence: number };

/** Draw dashed proposal boxes. Proposals are model suggestions not yet accepted by the user. */
export function drawProposals(
  ctx: CanvasRenderingContext2D,
  display: DisplayRect,
  proposals: ProposalShape[],
  selectedId: string | null = null
) {
  if (!proposals.length) return;
  ctx.save();
  proposals.forEach((p) => {
    const isSelected = p.id === selectedId;
    const color = isSelected ? "#f59e0b" : "#fb923c";
    const rect: ImageRect = {
      x1: clamp01(p.x - p.w / 2),
      y1: clamp01(p.y - p.h / 2),
      x2: clamp01(p.x + p.w / 2),
      y2: clamp01(p.y + p.h / 2)
    };
    const cr = boxToCanvasRect(rect, display);
    ctx.setLineDash([6, 4]);
    ctx.strokeStyle = color;
    ctx.lineWidth = isSelected ? 3 : 2;
    ctx.strokeRect(cr.x1, cr.y1, cr.x2 - cr.x1, cr.y2 - cr.y1);
    ctx.setLineDash([]);
    ctx.font = "11px monospace";
    const confText = `${Math.round(p.confidence * 100)}%`;
    ctx.fillStyle = color;
    ctx.fillText(confText, cr.x1 + 3, Math.max(11, cr.y1 - 3));
  });
  ctx.restore();
}

/** Hit-test dashed proposals. Returns proposal index, -1 if none hit. */
export function hitTestProposals(
  canvasPoint: ImagePoint,
  display: DisplayRect,
  proposals: ProposalShape[],
  imageWidth: number,
  imageHeight: number
): number {
  if (!proposals.length) return -1;
  const point = pointerImagePointFromCanvas(canvasPoint, display, imageWidth, imageHeight, { clamp: true });
  if (!point) return -1;
  const asBoxes = proposals.map((p) => ({ classId: 0, x: p.x, y: p.y, w: p.w, h: p.h })) as api.LabelBox[];
  const { index } = hitTestAtImagePixel(point, asBoxes, display, imageWidth, imageHeight);
  return index;
}

export function drawGrid(ctx: CanvasRenderingContext2D, display: DisplayRect) {
  ctx.save();
  ctx.strokeStyle = "rgba(148, 163, 184, 0.28)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 1; i < 10; i += 1) {
    const x = display.x + (display.w * i) / 10;
    const y = display.y + (display.h * i) / 10;
    ctx.moveTo(x, display.y);
    ctx.lineTo(x, display.y + display.h);
    ctx.moveTo(display.x, y);
    ctx.lineTo(display.x + display.w, y);
  }
  ctx.stroke();
  ctx.strokeStyle = "rgba(59, 130, 246, 0.5)";
  ctx.beginPath();
  ctx.moveTo(display.x + display.w / 2, display.y);
  ctx.lineTo(display.x + display.w / 2, display.y + display.h);
  ctx.moveTo(display.x, display.y + display.h / 2);
  ctx.lineTo(display.x + display.w, display.y + display.h / 2);
  ctx.stroke();
  ctx.restore();
}

export function drawCrosshair(ctx: CanvasRenderingContext2D, display: DisplayRect, point: ImagePoint | null) {
  if (!point) return;
  const x = display.x + point.x * display.w;
  const y = display.y + point.y * display.h;
  ctx.save();
  ctx.strokeStyle = "rgba(239, 68, 68, 0.75)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x, display.y);
  ctx.lineTo(x, display.y + display.h);
  ctx.moveTo(display.x, y);
  ctx.lineTo(display.x + display.w, y);
  ctx.stroke();
  ctx.restore();
}

export function drawImageRect(ctx: CanvasRenderingContext2D, display: DisplayRect, rect: ImageRect, color: string, dashed: boolean) {
  const canvasRect = boxToCanvasRect(rect, display);
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.setLineDash(dashed ? [6, 4] : []);
  ctx.strokeRect(canvasRect.x1, canvasRect.y1, canvasRect.x2 - canvasRect.x1, canvasRect.y2 - canvasRect.y1);
  ctx.restore();
}

export function drawZoomGrid(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement) {
  ctx.save();
  ctx.strokeStyle = "rgba(15, 23, 42, 0.55)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 1; i < 4; i += 1) {
    const x = (canvas.width * i) / 4;
    const y = (canvas.height * i) / 4;
    ctx.moveTo(x, 0);
    ctx.lineTo(x, canvas.height);
    ctx.moveTo(0, y);
    ctx.lineTo(canvas.width, y);
  }
  ctx.stroke();
  ctx.restore();
}

export function drawZoomBoxes(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  sourceRect: ImageRect,
  boxes: api.LabelBox[],
  selected: number | null
) {
  boxes.forEach((box, index) => {
    const rect = boxToRect(box);
    const overlap = intersectRect(rect, sourceRect);
    if (!overlap) return;
    const x1 = ((overlap.x1 - sourceRect.x1) / (sourceRect.x2 - sourceRect.x1)) * canvas.width;
    const y1 = ((overlap.y1 - sourceRect.y1) / (sourceRect.y2 - sourceRect.y1)) * canvas.height;
    const x2 = ((overlap.x2 - sourceRect.x1) / (sourceRect.x2 - sourceRect.x1)) * canvas.width;
    const y2 = ((overlap.y2 - sourceRect.y1) / (sourceRect.y2 - sourceRect.y1)) * canvas.height;
    ctx.save();
    ctx.strokeStyle = selected === index ? "#2f81f7" : "#22c55e";
    ctx.lineWidth = 2;
    ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
    ctx.restore();
  });
}

export function drawCornerHandles(ctx: CanvasRenderingContext2D, rect: ImageRect) {
  const size = 6;
  ctx.save();
  ctx.fillStyle = "#ffffff";
  ctx.strokeStyle = "#2563eb";
  ctx.lineWidth = 2;
  for (const [x, y] of [
    [rect.x1, rect.y1],
    [rect.x2, rect.y1],
    [rect.x2, rect.y2],
    [rect.x1, rect.y2]
  ]) {
    ctx.fillRect(x - size, y - size, size * 2, size * 2);
    ctx.strokeRect(x - size, y - size, size * 2, size * 2);
  }
  ctx.restore();
}

export function drawHandles(ctx: CanvasRenderingContext2D, rect: ImageRect) {
  drawCornerHandles(ctx, rect);
}

export function drawCenteredText(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, text: string) {
  ctx.fillStyle = "#94a3b8";
  ctx.font = "14px Segoe UI";
  ctx.textAlign = "center";
  ctx.fillText(text, canvas.width / 2, canvas.height / 2);
}

export function boxToCanvasRect(rect: ImageRect, display: DisplayRect): ImageRect {
  return {
    x1: display.x + rect.x1 * display.w,
    y1: display.y + rect.y1 * display.h,
    x2: display.x + rect.x2 * display.w,
    y2: display.y + rect.y2 * display.h
  };
}

export function boxToRect(box: api.LabelBox): ImageRect {
  return {
    x1: clamp01(box.x - box.w / 2),
    y1: clamp01(box.y - box.h / 2),
    x2: clamp01(box.x + box.w / 2),
    y2: clamp01(box.y + box.h / 2)
  };
}

export function rectToBox(rect: ImageRect, classId: number): api.LabelBox {
  const normalized = normalizeRect(rect);
  return {
    classId,
    x: clamp01((normalized.x1 + normalized.x2) / 2),
    y: clamp01((normalized.y1 + normalized.y2) / 2),
    w: clamp01(normalized.x2 - normalized.x1),
    h: clamp01(normalized.y2 - normalized.y1)
  };
}

export function boxCenter(box: api.LabelBox | undefined): ImagePoint {
  if (!box) return { x: 0.5, y: 0.5 };
  return { x: clamp01(box.x), y: clamp01(box.y) };
}

export function normalizedImageRect(a: ImagePoint, b: ImagePoint): ImageRect {
  return normalizeRect({ x1: a.x, y1: a.y, x2: b.x, y2: b.y });
}

export function normalizeRect(rect: ImageRect): ImageRect {
  return {
    x1: clamp01(Math.min(rect.x1, rect.x2)),
    y1: clamp01(Math.min(rect.y1, rect.y2)),
    x2: clamp01(Math.max(rect.x1, rect.x2)),
    y2: clamp01(Math.max(rect.y1, rect.y2))
  };
}

export function enforceMinRect(rect: ImageRect, minW: number, minH: number): ImageRect {
  const normalized = normalizeRect(rect);
  const centerX = (normalized.x1 + normalized.x2) / 2;
  const centerY = (normalized.y1 + normalized.y2) / 2;
  const width = Math.max(minW, normalized.x2 - normalized.x1);
  const height = Math.max(minH, normalized.y2 - normalized.y1);
  const x1 = clamp(centerX - width / 2, 0, 1 - width);
  const y1 = clamp(centerY - height / 2, 0, 1 - height);
  return {
    x1,
    y1,
    x2: x1 + Math.min(width, 1),
    y2: y1 + Math.min(height, 1)
  };
}

export function intersectRect(a: ImageRect, b: ImageRect): ImageRect | null {
  const x1 = Math.max(a.x1, b.x1);
  const y1 = Math.max(a.y1, b.y1);
  const x2 = Math.min(a.x2, b.x2);
  const y2 = Math.min(a.y2, b.y2);
  if (x2 <= x1 || y2 <= y1) return null;
  return { x1, y1, x2, y2 };
}

export function arrowKeyDelta(key: string): ImagePoint | null {
  if (key === "ArrowLeft") return { x: -1, y: 0 };
  if (key === "ArrowRight") return { x: 1, y: 0 };
  if (key === "ArrowUp") return { x: 0, y: -1 };
  if (key === "ArrowDown") return { x: 0, y: 1 };
  return null;
}

export function mergeCopiedBox(boxes: api.LabelBox[], box: api.LabelBox) {
  return mergeCopiedBoxWithIndex(boxes, box).boxes;
}

export function mergeCopiedBoxWithIndex(boxes: api.LabelBox[], box: api.LabelBox) {
  const next = boxes.slice();
  let bestIndex = -1;
  let bestDistance = Infinity;
  let bestOverlap = 0;
  for (let index = 0; index < next.length; index += 1) {
    const existing = next[index];
    if (existing.classId !== box.classId) continue;
    const distance = Math.hypot(existing.x - box.x, existing.y - box.y);
    const overlap = boxIou(existing, box);
    if (distance < bestDistance) {
      bestIndex = index;
      bestDistance = distance;
      bestOverlap = overlap;
    }
  }
  const maxReplaceDistance = Math.max(0.08, Math.hypot(box.w, box.h) * 0.75);
  if (bestIndex >= 0 && (bestDistance <= maxReplaceDistance || bestOverlap >= 0.1)) {
    next[bestIndex] = { ...box };
    return { boxes: next, index: bestIndex };
  }
  next.push({ ...box });
  return { boxes: next, index: next.length - 1 };
}

export function findNearestBoxIndex(boxes: api.LabelBox[], box: api.LabelBox) {
  let bestIndex = -1;
  let bestDistance = Infinity;
  for (let index = 0; index < boxes.length; index += 1) {
    const existing = boxes[index];
    if (existing.classId !== box.classId) continue;
    const distance = Math.hypot(existing.x - box.x, existing.y - box.y);
    if (distance < bestDistance) {
      bestIndex = index;
      bestDistance = distance;
    }
  }
  return bestIndex;
}

export function boxIou(a: api.LabelBox, b: api.LabelBox) {
  const ra = boxToRect(a);
  const rb = boxToRect(b);
  const intersection = intersectRect(ra, rb);
  if (!intersection) return 0;
  const intersectionArea = (intersection.x2 - intersection.x1) * (intersection.y2 - intersection.y1);
  const areaA = (ra.x2 - ra.x1) * (ra.y2 - ra.y1);
  const areaB = (rb.x2 - rb.x1) * (rb.y2 - rb.y1);
  const union = areaA + areaB - intersectionArea;
  return union > 0 ? intersectionArea / union : 0;
}

export function shortcutStorageKey(workspaceRoot: string) {
  return `ywb.boxlabel.shortcuts.${workspaceRoot}`;
}

function migrateLocalShortcutEntry(value: unknown): import("./session").BoxLabelShortcutSlot | null {
  if (value == null) return null;
  if (typeof value === "object" && value !== null) {
    const obj = value as Record<string, unknown>;
    const classId = Number(obj.classId);
    if (!Number.isInteger(classId) || classId < 0) return null;
    const mode = obj.mode === "subject-select" ? "subject-select" as const : "draw" as const;
    return { classId, mode };
  }
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) {
    return { classId: value, mode: "draw" };
  }
  return null;
}

export function loadShortcutSlots(workspaceRoot: string): Array<import("./session").BoxLabelShortcutSlot | null> {
  try {
    const raw = window.localStorage.getItem(shortcutStorageKey(workspaceRoot));
    const parsed = raw ? JSON.parse(raw) : null;
    if (Array.isArray(parsed)) {
      return Array.from({ length: 10 }, (_, index) => migrateLocalShortcutEntry(parsed[index]));
    }
  } catch {
    // Ignore corrupt local shortcut settings.
  }
  return Array.from({ length: 10 }, (_, index) => ({ classId: index, mode: "draw" as const }));
}

export function saveShortcutSlots(workspaceRoot: string, slots: Array<import("./session").BoxLabelShortcutSlot | null>) {
  try {
    window.localStorage.setItem(shortcutStorageKey(workspaceRoot), JSON.stringify(slots));
  } catch {
    // Shortcut persistence is best-effort.
  }
}

export function hitTest(
  canvasPoint: ImagePoint,
  display: DisplayRect,
  boxes: api.LabelBox[],
  imageWidth: number,
  imageHeight: number
): { index: number; handle: DragHandle } {
  const point = pointerImagePointFromCanvas(canvasPoint, display, imageWidth, imageHeight, { clamp: true });
  if (!point) return { index: -1, handle: "move" };
  return hitTestAtImagePixel(point, boxes, display, imageWidth, imageHeight);
}

export function resizeOrMoveRect(rect: ImageRect, handle: DragHandle, start: ImagePoint, current: ImagePoint): ImageRect {
  const dx = current.x - start.x;
  const dy = current.y - start.y;
  const next = { ...rect };
  if (handle === "move") {
    const width = next.x2 - next.x1;
    const height = next.y2 - next.y1;
    next.x1 = clamp(next.x1 + dx, 0, 1 - width);
    next.y1 = clamp(next.y1 + dy, 0, 1 - height);
    next.x2 = next.x1 + width;
    next.y2 = next.y1 + height;
    return next;
  }
  if (handle.includes("n")) next.y1 += dy;
  if (handle.includes("s")) next.y2 += dy;
  if (handle.includes("w")) next.x1 += dx;
  if (handle.includes("e")) next.x2 += dx;
  return normalizeRect(next);
}

export const POOL_LABEL_SUBJECT_CURSOR = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24'%3E%3Crect x='5.5' y='5.5' width='13' height='13' fill='none' stroke='%23ef4444' stroke-width='2'/%3E%3C/svg%3E") 12 12, crosshair`;

export const POOL_LABEL_POINTER_CURSOR = `url("/assets/webview_cursor_default.png") 8 2, default`;
export const POOL_LABEL_POINTER_CURSOR_GROW = `url("/assets/webview_cursor_grow.png") 6 3, default`;
export const POOL_LABEL_POINTER_CURSOR_SHRINK = `url("/assets/webview_cursor_shrink.png") 6 3, default`;

function pointerCursor(adjustMode?: BoxAdjustMode | null): string {
  if (adjustMode === "grow") return POOL_LABEL_POINTER_CURSOR_GROW;
  if (adjustMode === "shrink") return POOL_LABEL_POINTER_CURSOR_SHRINK;
  return POOL_LABEL_POINTER_CURSOR;
}

export type PoolLabelToolState = {
  pointerToolEnabled: boolean;
  autoFitEnabled: boolean;
  blackBoxEnabled: boolean;
};

export function defaultPoolLabelCursor(tools: PoolLabelToolState, adjustMode?: BoxAdjustMode | null) {
  if (tools.pointerToolEnabled) return pointerCursor(adjustMode);
  if (tools.blackBoxEnabled) return "crosshair";
  return tools.autoFitEnabled ? POOL_LABEL_SUBJECT_CURSOR : "crosshair";
}

export function resolvePoolLabelCursor(
  canvasPoint: ImagePoint,
  display: DisplayRect,
  boxes: api.LabelBox[],
  mode: ToolMode,
  imageWidth: number,
  imageHeight: number,
  tools: PoolLabelToolState,
  adjustMode?: BoxAdjustMode | null
) {
  if (mode === "pan") return "grab";
  if (tools.pointerToolEnabled) {
    return cursorForPoint(canvasPoint, display, boxes, "select", imageWidth, imageHeight, adjustMode);
  }
  return defaultPoolLabelCursor(tools, adjustMode);
}

export function cursorForPoint(
  canvasPoint: ImagePoint,
  display: DisplayRect,
  boxes: api.LabelBox[],
  mode: ToolMode,
  imageWidth: number,
  imageHeight: number,
  adjustMode?: BoxAdjustMode | null
) {
  if (mode === "pan") return "grab";
  if (mode === "draw") return "crosshair";
  const hit = hitTest(canvasPoint, display, boxes, imageWidth, imageHeight);
  if (hit.index < 0) return pointerCursor(adjustMode);
  if (hit.handle === "move") return "move";
  if (hit.handle === "n" || hit.handle === "s") return "ns-resize";
  if (hit.handle === "e" || hit.handle === "w") return "ew-resize";
  if (hit.handle === "nw" || hit.handle === "se") return "nwse-resize";
  return "nesw-resize";
}

export function classNameFor(classes: api.LabelClass[], classId: number) {
  const found = classes.find((item) => item.id === classId);
  return found ? `${found.id}: ${found.name}` : `${classId}: class_${classId}`;
}

export function clamp01(value: number) {
  return clamp(value, 0, 1);
}

export function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}
