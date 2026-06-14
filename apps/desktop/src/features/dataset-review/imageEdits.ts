import * as api from "../../api";
import { invalidateDatasetImageUrl, mimeForPath } from "./datasetAssets";

export type PixelRect = { x1: number; y1: number; x2: number; y2: number };
export type ImageEdit = { mode: "black" | "crop"; rect: PixelRect };

export function normalizePixelRect(a: { x: number; y: number }, b: { x: number; y: number }): PixelRect {
  return {
    x1: Math.min(a.x, b.x),
    y1: Math.min(a.y, b.y),
    x2: Math.max(a.x, b.x),
    y2: Math.max(a.y, b.y)
  };
}

export function pendingBlackCount(pending: Map<string, ImageEdit[]>, imagePath: string) {
  return (pending.get(imagePath) || []).filter((edit) => edit.mode === "black").length;
}

export function cloneEdits(edits: ImageEdit[]) {
  return edits.map((edit) => ({ mode: edit.mode, rect: { ...edit.rect } }));
}

export async function applyBlackEditsToBase64(base64: string, mime: string, rects: PixelRect[]) {
  return new Promise<string>((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        reject(new Error("Canvas unavailable."));
        return;
      }
      ctx.drawImage(img, 0, 0);
      ctx.fillStyle = "#000000";
      for (const rect of rects) {
        const w = Math.max(1, rect.x2 - rect.x1);
        const h = Math.max(1, rect.y2 - rect.y1);
        ctx.fillRect(rect.x1, rect.y1, w, h);
      }
      canvas.toBlob(
        (blob) => {
          if (!blob) {
            reject(new Error("Failed to encode image."));
            return;
          }
          const reader = new FileReader();
          reader.onload = () => {
            const dataUrl = String(reader.result || "");
            resolve(dataUrl.split(",")[1] || "");
          };
          reader.onerror = () => reject(new Error("Failed to read encoded image."));
          reader.readAsDataURL(blob);
        },
        mime,
        0.95
      );
    };
    img.onerror = () => reject(new Error("Failed to decode image."));
    img.src = `data:${mime};base64,${base64}`;
  });
}

export async function applyBlackEditsForImage(
  datasetRoot: string,
  backupRoot: string,
  imagePath: string,
  edits: ImageEdit[]
) {
  const blacks = edits.filter((edit) => edit.mode === "black");
  if (!blacks.length) return 0;
  if (backupRoot) {
    await api.ensureImagePoolBackup(backupRoot, imagePath);
  }
  const base64 = await api.readFileBase64(datasetRoot, imagePath);
  const nextBase64 = await applyBlackEditsToBase64(
    base64,
    mimeForPath(imagePath),
    blacks.map((edit) => edit.rect)
  );
  await api.writeFileBase64(datasetRoot, imagePath, nextBase64);
  invalidateDatasetImageUrl(datasetRoot, imagePath);
  return blacks.length;
}

export async function cropImageToBase64(base64: string, mime: string, crop: PixelRect) {
  return new Promise<{ base64: string; sourceWidth: number; sourceHeight: number }>((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const sourceWidth = img.naturalWidth;
      const sourceHeight = img.naturalHeight;
      const x1 = Math.max(0, Math.min(crop.x1, sourceWidth - 1));
      const y1 = Math.max(0, Math.min(crop.y1, sourceHeight - 1));
      const x2 = Math.max(x1 + 1, Math.min(crop.x2, sourceWidth));
      const y2 = Math.max(y1 + 1, Math.min(crop.y2, sourceHeight));
      const outW = x2 - x1;
      const outH = y2 - y1;
      const canvas = document.createElement("canvas");
      canvas.width = outW;
      canvas.height = outH;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        reject(new Error("Canvas unavailable."));
        return;
      }
      ctx.drawImage(img, x1, y1, outW, outH, 0, 0, outW, outH);
      canvas.toBlob(
        (blob) => {
          if (!blob) {
            reject(new Error("Failed to encode cropped image."));
            return;
          }
          const reader = new FileReader();
          reader.onload = () => {
            const dataUrl = String(reader.result || "");
            resolve({
              base64: dataUrl.split(",")[1] || "",
              sourceWidth,
              sourceHeight
            });
          };
          reader.onerror = () => reject(new Error("Failed to read encoded image."));
          reader.readAsDataURL(blob);
        },
        mime,
        0.95
      );
    };
    img.onerror = () => reject(new Error("Failed to decode image."));
    img.src = `data:${mime};base64,${base64}`;
  });
}

export async function applyCropEditForImage(
  datasetRoot: string,
  backupRoot: string,
  imagePath: string,
  cropRect: PixelRect
) {
  if (backupRoot) {
    await api.ensureImagePoolBackup(backupRoot, imagePath);
  }
  const base64 = await api.readFileBase64(datasetRoot, imagePath);
  const mime = mimeForPath(imagePath);
  const cropped = await cropImageToBase64(base64, mime, cropRect);
  await api.writeFileBase64(datasetRoot, imagePath, cropped.base64);
  invalidateDatasetImageUrl(datasetRoot, imagePath);
  return cropped;
}
