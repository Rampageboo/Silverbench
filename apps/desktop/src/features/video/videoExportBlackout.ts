/**
 * Export-time blackout rendering helpers.
 *
 * Core principle: blackout edits are non-destructive overlays.
 * They are applied to derived export images only.
 * Source video/image files are NEVER modified.
 *
 * Two entry points:
 *  1. applyBlackoutRectsToImageData — pure, testable, works on raw RGBA pixels.
 *  2. encodeImageWithBlackouts     — browser canvas, async, returns JPEG base64.
 */

import type { BlackoutRectShape } from "../overlays/blackoutOverlayDomain";

// ---------------------------------------------------------------------------
// Pure pixel helper (testable without Canvas)
// ---------------------------------------------------------------------------

/**
 * Fill blackout rects with black pixels directly in an RGBA Uint8ClampedArray.
 *
 * Mutates `pixels` in place. Does NOT touch the source image file.
 * Coordinates are center-based normalized 0–1 (same as LabelBox).
 * Rects that extend past image bounds are clamped.
 * Zero-size rects are skipped.
 */
export function applyBlackoutRectsToImageData(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  rects: BlackoutRectShape[]
): void {
  for (const rect of rects) {
    if (rect.w <= 0 || rect.h <= 0) continue;
    const x1 = Math.max(0, Math.floor((rect.x - rect.w / 2) * width));
    const y1 = Math.max(0, Math.floor((rect.y - rect.h / 2) * height));
    const x2 = Math.min(width, Math.ceil((rect.x + rect.w / 2) * width));
    const y2 = Math.min(height, Math.ceil((rect.y + rect.h / 2) * height));
    if (x2 <= x1 || y2 <= y1) continue;
    for (let py = y1; py < y2; py++) {
      for (let px = x1; px < x2; px++) {
        const i = (py * width + px) * 4;
        pixels[i] = 0;       // R
        pixels[i + 1] = 0;   // G
        pixels[i + 2] = 0;   // B
        // Alpha channel (pixels[i+3]) is left unchanged
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Canvas-based JPEG encoder (browser only)
// ---------------------------------------------------------------------------

/**
 * Apply blackout rects to a JPEG base64 image and re-encode as JPEG base64.
 *
 * Returns the original base64 unchanged when rects is empty.
 * Only the in-memory canvas is modified; no files are written here.
 * Callers must write the returned base64 to the export path, not the source.
 */
export function encodeImageWithBlackouts(
  imageBase64: string,
  rects: BlackoutRectShape[],
  quality = 0.92
): Promise<string> {
  if (rects.length === 0) return Promise.resolve(imageBase64);

  return new Promise<string>((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        reject(new Error("Cannot obtain 2D canvas context for blackout encoding"));
        return;
      }
      ctx.drawImage(img, 0, 0);

      ctx.fillStyle = "#000000";
      for (const rect of rects) {
        if (rect.w <= 0 || rect.h <= 0) continue;
        const px = (rect.x - rect.w / 2) * img.naturalWidth;
        const py = (rect.y - rect.h / 2) * img.naturalHeight;
        const pw = rect.w * img.naturalWidth;
        const ph = rect.h * img.naturalHeight;
        // Clamp to canvas bounds
        const x = Math.max(0, px);
        const y = Math.max(0, py);
        const w = Math.min(pw, img.naturalWidth - x);
        const h = Math.min(ph, img.naturalHeight - y);
        if (w > 0 && h > 0) ctx.fillRect(x, y, w, h);
      }

      const dataUrl = canvas.toDataURL("image/jpeg", quality);
      resolve(dataUrl.replace(/^data:[^;]+;base64,/, ""));
    };
    img.onerror = () => reject(new Error("Cannot load image for blackout encoding"));
    img.src = `data:image/jpeg;base64,${imageBase64}`;
  });
}

// ---------------------------------------------------------------------------
// Lightweight overlap warning (rect-only, no full overlay objects needed)
// ---------------------------------------------------------------------------

export type ExportBlackoutWarning = {
  boxIndex: number;
  iou: number;
};

function rectIouSimple(
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number }
): number {
  const ax1 = a.x - a.w / 2, ay1 = a.y - a.h / 2;
  const ax2 = a.x + a.w / 2, ay2 = a.y + a.h / 2;
  const bx1 = b.x - b.w / 2, by1 = b.y - b.h / 2;
  const bx2 = b.x + b.w / 2, by2 = b.y + b.h / 2;
  const ix1 = Math.max(ax1, bx1), iy1 = Math.max(ay1, by1);
  const ix2 = Math.min(ax2, bx2), iy2 = Math.min(ay2, by2);
  if (ix2 <= ix1 || iy2 <= iy1) return 0;
  const inter = (ix2 - ix1) * (iy2 - iy1);
  const unionArea = a.w * a.h + b.w * b.h - inter;
  return unionArea > 0 ? inter / unionArea : 0;
}

/**
 * Compute overlap between export blackout rects and detect boxes.
 * Emits a warning entry for each (rect, box) pair whose IoU exceeds threshold.
 * Does not block or modify labels — warn only.
 */
export function computeExportBlackoutWarnings(
  rects: BlackoutRectShape[],
  boxes: Array<{ x: number; y: number; w: number; h: number }>,
  threshold = 0.1
): ExportBlackoutWarning[] {
  const warnings: ExportBlackoutWarning[] = [];
  for (const rect of rects) {
    if (rect.w <= 0 || rect.h <= 0) continue;
    boxes.forEach((box, boxIndex) => {
      const iou = rectIouSimple(rect, box);
      if (iou >= threshold) warnings.push({ boxIndex, iou });
    });
  }
  return warnings;
}
