import type { LabelBox } from "../../api";
import type { DatasetPair, DatasetTask } from "./datasetCore";

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
