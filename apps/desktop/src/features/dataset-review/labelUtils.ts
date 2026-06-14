import type { LabelBox } from "../../api";
import type { DatasetPair, DatasetTask } from "./datasetCore";
import type { PixelRect } from "./imageEdits";

export function boxesToText(boxes: LabelBox[]) {
  if (!boxes.length) return "";
  return `${boxes.map((box) => `${box.classId} ${box.x} ${box.y} ${box.w} ${box.h}`).join("\n")}\n`;
}

export function resolveLabelPathForWrite(pair: DatasetPair, datasetTask: DatasetTask) {
  if (datasetTask === "classify") return "";
  if (pair.labelPath) return pair.labelPath;
  const parts = pair.imagePath.split("/");
  if (parts[0] === "images") {
    return ["labels", ...parts.slice(1)].join("/").replace(/\.[^.]+$/, ".txt");
  }
  return pair.imagePath.replace(/\.[^.]+$/, ".txt");
}

export function updateLabelsForCrop(
  boxes: LabelBox[],
  crop: PixelRect,
  imageW: number,
  imageH: number
): LabelBox[] {
  const cropW = crop.x2 - crop.x1;
  const cropH = crop.y2 - crop.y1;
  if (cropW <= 0 || cropH <= 0) return [];
  const updated: LabelBox[] = [];
  for (const box of boxes) {
    const bx1 = (box.x - box.w / 2) * imageW;
    const by1 = (box.y - box.h / 2) * imageH;
    const bx2 = (box.x + box.w / 2) * imageW;
    const by2 = (box.y + box.h / 2) * imageH;
    const ix1 = Math.max(bx1, crop.x1);
    const iy1 = Math.max(by1, crop.y1);
    const ix2 = Math.min(bx2, crop.x2);
    const iy2 = Math.min(by2, crop.y2);
    if (ix2 <= ix1 || iy2 <= iy1) continue;
    const nx1 = ix1 - crop.x1;
    const ny1 = iy1 - crop.y1;
    const nx2 = ix2 - crop.x1;
    const ny2 = iy2 - crop.y1;
    updated.push({
      classId: box.classId,
      x: (nx1 + nx2) / 2 / cropW,
      y: (ny1 + ny2) / 2 / cropH,
      w: (nx2 - nx1) / cropW,
      h: (ny2 - ny1) / cropH
    });
  }
  return updated;
}
