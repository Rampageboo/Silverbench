import type * as api from "../../api";
import type { LabelClass } from "../../api";
import {
  boxCenterPixel,
  classBoxColor,
  drawBoxes,
  drawCenteredText,
  drawCrosshair,
  drawGrid,
  drawImageRect,
  drawPointerClassLabel,
  drawProposals,
  drawZoomBoxes,
  drawZoomGrid,
  imageDisplayRect,
  imagePixelPointToNormalized,
  imagePixelToZoomCanvas,
  intersectRect,
  normalizedImageRect,
  zoomSourceRect,
  type DisplayRect,
  type DragState,
  type ImagePixelPoint,
  type ProposalShape,
  type Viewport
} from "./geometry";

export type MainCanvasRenderInput = {
  canvas: HTMLCanvasElement;
  image: HTMLImageElement | null;
  boxes: api.LabelBox[];
  selectedIndex: number | null;
  classes: LabelClass[];
  currentClassId: number;
  showGrid: boolean;
  viewport: Viewport;
  drag: DragState;
  zoomPoint: ImagePixelPoint | null;
  pointerToolEnabled: boolean;
  autoFitEnabled: boolean;
  blackBoxEnabled: boolean;
  proposals?: ProposalShape[];
  selectedProposalId?: string | null;
};

export function renderMainCanvas(input: MainCanvasRenderInput): DisplayRect | null {
  const {
    canvas,
    image,
    boxes,
    selectedIndex,
    classes,
    currentClassId,
    showGrid,
    viewport,
    drag,
    zoomPoint,
    pointerToolEnabled,
    autoFitEnabled,
    blackBoxEnabled,
    proposals,
    selectedProposalId
  } = input;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#0b1220";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  if (!image) {
    drawCenteredText(ctx, canvas, "Loading image...");
    return null;
  }

  const display = imageDisplayRect(canvas, image, viewport);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(image, display.x, display.y, display.w, display.h);
  if (showGrid) drawGrid(ctx, display);
  const crosshairPoint = zoomPoint
    ? imagePixelPointToNormalized(zoomPoint, image.naturalWidth, image.naturalHeight)
    : null;
  if (!pointerToolEnabled && !autoFitEnabled) {
    drawCrosshair(ctx, display, crosshairPoint);
  }
  drawBoxes(ctx, display, boxes, selectedIndex, classes);
  if (proposals?.length) drawProposals(ctx, display, proposals, selectedProposalId ?? null, classes);

  if (drag?.type === "draw") {
    drawImageRect(ctx, display, normalizedImageRect(drag.start, drag.current), classBoxColor(currentClassId, true), true);
  }

  if (zoomPoint && !pointerToolEnabled && !blackBoxEnabled) {
    drawPointerClassLabel(
      ctx,
      canvas,
      display,
      zoomPoint,
      image.naturalWidth,
      image.naturalHeight,
      currentClassId,
      classes
    );
  }
  return display;
}

export type ZoomCanvasRenderInput = {
  canvas: HTMLCanvasElement;
  image: HTMLImageElement;
  display: DisplayRect;
  boxes: api.LabelBox[];
  selectedIndex: number | null;
  drag: DragState;
  currentClassId: number;
  zoomPoint: ImagePixelPoint | null;
  lastZoomCenter: ImagePixelPoint | null;
};

function drawZoomImageRect(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  sourceRect: { x1: number; y1: number; x2: number; y2: number },
  rect: { x1: number; y1: number; x2: number; y2: number },
  color: string,
  dashed: boolean,
  lineWidth = 2
) {
  const overlap = intersectRect(rect, sourceRect);
  if (!overlap) return;
  const sourceW = sourceRect.x2 - sourceRect.x1;
  const sourceH = sourceRect.y2 - sourceRect.y1;
  const x1 = ((overlap.x1 - sourceRect.x1) / sourceW) * canvas.width;
  const y1 = ((overlap.y1 - sourceRect.y1) / sourceH) * canvas.height;
  const x2 = ((overlap.x2 - sourceRect.x1) / sourceW) * canvas.width;
  const y2 = ((overlap.y2 - sourceRect.y1) / sourceH) * canvas.height;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.setLineDash(dashed ? [6, 4] : []);
  ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
  ctx.restore();
}

export function renderZoomCanvas(input: ZoomCanvasRenderInput) {
  const { canvas, image, display, boxes, selectedIndex, drag, currentClassId, zoomPoint, lastZoomCenter } = input;
  if (drag?.type === "pan") return;

  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#111827";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const imageW = image.naturalWidth;
  const imageH = image.naturalHeight;
  const dragCurrentPoint =
    drag?.type === "draw"
      ? { x: drag.current.x * imageW, y: drag.current.y * imageH }
      : null;
  const center =
    dragCurrentPoint ??
    zoomPoint ??
    lastZoomCenter ??
    (selectedIndex !== null ? boxCenterPixel(boxes[selectedIndex], imageW, imageH) : { x: imageW / 2, y: imageH / 2 });
  const sourceRectPx = zoomSourceRect(center, display, imageW, imageH);
  const sourceRect = {
    x1: sourceRectPx.x1 / imageW,
    y1: sourceRectPx.y1 / imageH,
    x2: sourceRectPx.x2 / imageW,
    y2: sourceRectPx.y2 / imageH
  };
  const srcW = sourceRectPx.x2 - sourceRectPx.x1;
  const srcH = sourceRectPx.y2 - sourceRectPx.y1;

  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(image, sourceRectPx.x1, sourceRectPx.y1, srcW, srcH, 0, 0, canvas.width, canvas.height);
  drawZoomGrid(ctx, canvas);
  drawZoomBoxes(ctx, canvas, sourceRect, boxes, selectedIndex);
  if (drag?.type === "draw") {
    drawZoomImageRect(
      ctx,
      canvas,
      sourceRect,
      normalizedImageRect(drag.start, drag.current),
      classBoxColor(currentClassId, true),
      true
    );
  }
  const cross = imagePixelToZoomCanvas(center, sourceRectPx, canvas.width, canvas.height);
  ctx.strokeStyle = "#ef4444";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(cross.x, 0);
  ctx.lineTo(cross.x, canvas.height);
  ctx.moveTo(0, cross.y);
  ctx.lineTo(canvas.width, cross.y);
  ctx.stroke();
}
