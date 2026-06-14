import * as api from "../../api";
import type { LabelBox } from "../../api";

export const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".bmp", ".webp", ".tif", ".tiff"]);

export type DatasetPair = {
  imagePath: string;
  labelPath: string | null;
  classId: number | null;
  className: string;
};

export type DatasetTask = "detect" | "classify";

export function ext(path: string) {
  const index = path.lastIndexOf(".");
  return index >= 0 ? path.slice(index).toLowerCase() : "";
}

export function naturalCompare(a: string, b: string) {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

export function parseLabels(text: string): LabelBox[] {
  const boxes: LabelBox[] = [];
  for (const line of text.split(/\r?\n/)) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 5) continue;
    const nums = parts.slice(0, 5).map(Number);
    if (nums.some(Number.isNaN)) continue;
    boxes.push({ classId: Math.trunc(nums[0]), x: nums[1], y: nums[2], w: nums[3], h: nums[4] });
  }
  return boxes;
}

export function parseClassNameValue(raw: string) {
  const value = raw.split("#")[0].trim();
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    try {
      return JSON.parse(value) as string;
    } catch {
      return value.slice(1, -1);
    }
  }
  return value;
}

export async function readClassNamesFromDataset(datasetRoot: string, filePaths: Set<string>) {
  const names = new Map<number, string>();
  if (filePaths.has("classes.txt")) {
    const text = await api.readTextFile(datasetRoot, "classes.txt");
    text.split(/\r?\n/).forEach((raw, index) => {
      const name = raw.trim();
      if (name) names.set(index, name);
    });
    if (names.size) return names;
  }
  const yamlPath = filePaths.has("data.yaml") ? "data.yaml" : "";
  if (!yamlPath) return names;
  const text = await api.readTextFile(datasetRoot, yamlPath);
  let inNames = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    if (line === "names:") {
      inNames = true;
      continue;
    }
    if (inNames) {
      const match = line.match(/^(\d+)\s*:\s*(.+)$/);
      if (match) names.set(Number(match[1]), parseClassNameValue(match[2]));
      else if (!/^\s/.test(raw)) break;
    }
  }
  return names;
}

export function classificationClassNameForPath(imagePath: string) {
  const parts = imagePath.split("/");
  if (parts.length < 2) return "";
  if (["train", "val", "test"].includes(parts[0]) && parts.length >= 3) return parts[1];
  if (!["images", "labels"].includes(parts[0]) && parts.length >= 2) return parts[0];
  return "";
}

export function inferDatasetTask(filePaths: Set<string>) {
  const paths = [...filePaths];
  const hasDetectLayout = paths.some((path) => path.startsWith("labels/") || path.startsWith("images/"));
  if (hasDetectLayout) return "detect" as DatasetTask;
  return paths.some((path) => IMAGE_EXTENSIONS.has(ext(path)) && classificationClassNameForPath(path))
    ? ("classify" as DatasetTask)
    : ("detect" as DatasetTask);
}

export function labelPathFor(imagePath: string, filePaths: Set<string>, datasetRoot: string) {
  const stem = imagePath.split("/").pop()?.replace(/\.[^.]+$/, "") || "";
  const parts = imagePath.split("/");
  const candidates: string[] = [];
  if (parts[0] === "images") {
    candidates.push(["labels", ...parts.slice(1)].join("/").replace(/\.[^.]+$/, ".txt"));
  }
  candidates.push(`labels/train/${stem}.txt`, `labels/val/${stem}.txt`, `labels/${stem}.txt`, imagePath.replace(/\.[^.]+$/, ".txt"));
  const matched = candidates.find((path) => filePaths.has(path));
  if (matched) return matched;
  if (parts[0] === "images") {
    return ["labels", ...parts.slice(1)].join("/").replace(/\.[^.]+$/, ".txt");
  }
  return null;
}

export function findPairs(filePaths: Set<string>, datasetTask: DatasetTask): DatasetPair[] {
  const imagePaths = [...filePaths].filter((path) => IMAGE_EXTENSIONS.has(ext(path))).sort(naturalCompare);
  return imagePaths.map((imagePath) => ({
    imagePath,
    labelPath: datasetTask === "classify" ? null : labelPathFor(imagePath, filePaths, ""),
    classId: null,
    className: datasetTask === "classify" ? classificationClassNameForPath(imagePath) : ""
  }));
}

export async function buildLabelIndex(
  datasetRoot: string,
  pairs: DatasetPair[],
  datasetTask: DatasetTask,
  onProgress?: (done: number, total: number) => void
) {
  const labelCache = new Map<string, LabelBox[]>();
  const classIndex = new Map<number, Set<string>>();
  const imageClassSet = new Map<string, Set<number>>();

  if (datasetTask === "classify") {
    pairs.forEach((pair, index) => {
      const className = pair.className;
      const classId = className ? 0 : null;
      if (className) {
        const set = new Set<number>([0]);
        imageClassSet.set(pair.imagePath, set);
        if (!classIndex.has(0)) classIndex.set(0, new Set());
        classIndex.get(0)!.add(pair.imagePath);
      }
      if (index % 500 === 0) onProgress?.(index + 1, pairs.length);
    });
    return { labelCache, classIndex, imageClassSet };
  }

  const labelPaths = [...new Set(pairs.map((pair) => pair.labelPath).filter(Boolean) as string[])];
  const texts = new Map<string, string>();
  const batchSize = 1000;
  for (let offset = 0; offset < labelPaths.length; offset += batchSize) {
    const batch = labelPaths.slice(offset, offset + batchSize);
    const batchTexts = await api.readLabelTextsBatch(datasetRoot, batch);
    for (const [path, text] of Object.entries(batchTexts)) texts.set(path, text);
    onProgress?.(Math.min(offset + batch.length, labelPaths.length), labelPaths.length);
  }

  pairs.forEach((pair, index) => {
    const text = pair.labelPath ? texts.get(pair.labelPath) || "" : "";
    const boxes = parseLabels(text);
    labelCache.set(pair.imagePath, boxes);
    const classSet = new Set(boxes.map((box) => box.classId));
    imageClassSet.set(pair.imagePath, classSet);
    for (const classId of classSet) {
      if (!classIndex.has(classId)) classIndex.set(classId, new Set());
      classIndex.get(classId)!.add(pair.imagePath);
    }
    if (index % 500 === 0) onProgress?.(index + 1, pairs.length);
  });

  return { labelCache, classIndex, imageClassSet };
}

export function classDisplay(classNames: Map<number, string>, classId: number) {
  return classNames.get(classId) || `class ${classId}`;
}

export function resolveClassificationTargetClass(rawInput: string, classNames: Map<number, string>) {
  const trimmed = String(rawInput || "").trim();
  if (!trimmed) return { folderName: "", classId: null as number | null, matched: false };
  if (/^\d+$/.test(trimmed)) {
    const classId = Number(trimmed);
    if (classNames.has(classId)) {
      return { folderName: classNames.get(classId) || trimmed, classId, matched: true };
    }
  }
  for (const [classId, folderName] of classNames.entries()) {
    if (folderName === trimmed) return { folderName, classId, matched: true };
  }
  return { folderName: trimmed, classId: null, matched: false };
}
