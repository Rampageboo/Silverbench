import { classificationClassNameForPath, naturalCompare } from "../dataset-review/datasetCore";
import type { MergeTask } from "./mergeApi";

export const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".bmp", ".webp", ".tif", ".tiff"]);

export function ext(path: string) {
  const index = path.lastIndexOf(".");
  return index >= 0 ? path.slice(index).toLowerCase() : "";
}

export function safeDatasetFilename(filename: string) {
  return String(filename || "image").replace(/[<>:"/\\|?*\x00-\x1F]/g, "_").replace(/\s+/g, "_");
}

export function safeDatasetPathSegment(segment: string) {
  return String(segment || "class").trim().replace(/[<>:"/\\|?*\x00-\x1F]/g, "_") || "class";
}

export function normalizeDatasetRoot<T>(sourceFiles: Map<string, T>, task: MergeTask = "detect") {
  const paths = [...sourceFiles.keys()];
  if (!paths.length) return sourceFiles;
  const firstParts = new Set(paths.map((path) => path.split("/")[0]).filter(Boolean));
  if (firstParts.size !== 1) return sourceFiles;
  const root = [...firstParts][0];
  const stripped = paths.filter((path) => path.startsWith(`${root}/`)).map((path) => path.slice(root.length + 1));
  if (stripped.length !== paths.length) return sourceFiles;
  const hasDatasetShape =
    stripped.some((path) => path === "data.yaml" || /(^|\/)dataset\.ya?ml$/i.test(path) || /^(images|labels|train|val|test)\//.test(path)) ||
    (task === "classify" && stripped.some((path) => IMAGE_EXTENSIONS.has(ext(path)) && classificationClassNameForPath(path)));
  if (!hasDatasetShape) return sourceFiles;
  const normalized = new Map<string, T>();
  for (const [path, source] of sourceFiles.entries()) normalized.set(path.slice(root.length + 1), source);
  return normalized;
}

export function trainLabelPathForImage(imagePath: string) {
  const filename = imagePath.split("/").pop()?.replace(/\.[^.]+$/, ".txt") || "image.txt";
  return `labels/train/${filename}`;
}

export function possibleLabelPathsForImage(imagePath: string) {
  const stem = imagePath.split("/").pop()?.replace(/\.[^.]+$/, "") || "";
  const parts = imagePath.split("/");
  const candidates: string[] = [];
  if (parts[0] === "images") candidates.push(["labels", ...parts.slice(1)].join("/").replace(/\.[^.]+$/, ".txt"));
  candidates.push(`labels/train/${stem}.txt`, `labels/val/${stem}.txt`, `labels/${stem}.txt`, imagePath.replace(/\.[^.]+$/, ".txt"));
  return [...new Set(candidates)];
}

export function labelSourceForImage(imagePath: string, sourceFiles: Map<string, unknown>) {
  return possibleLabelPathsForImage(imagePath).find((labelPath) => sourceFiles.has(labelPath)) || "";
}

export function chooseTrainImageDestination(path: string, prefix: string, existing: Set<string>, reserved: Set<string>, autoRename: boolean) {
  const filename = safeDatasetFilename(path.split("/").pop() || "image");
  const dot = filename.lastIndexOf(".");
  const stem = dot > 0 ? filename.slice(0, dot) : filename;
  const suffix = dot > 0 ? filename.slice(dot) : "";
  let index = 1;
  while (index < 10000) {
    const renamed = index === 1 ? `${prefix}${stem}${suffix}` : `${prefix}${stem}_${index}${suffix}`;
    const candidate = `images/train/${renamed}`;
    const labelCandidate = trainLabelPathForImage(candidate);
    const hasConflict = [candidate, labelCandidate].some((p) => existing.has(p.toLowerCase()) || reserved.has(p.toLowerCase()));
    if (!hasConflict) return candidate;
    if (!autoRename) return null;
    index += 1;
  }
  return null;
}

export function chooseClassifyImageDestination(path: string, prefix: string, existing: Set<string>, reserved: Set<string>, autoRename: boolean) {
  const className = classificationClassNameForPath(path);
  if (!className) return null;
  const classFolder = safeDatasetPathSegment(className);
  const filename = safeDatasetFilename(path.split("/").pop() || "image");
  const dot = filename.lastIndexOf(".");
  const stem = dot > 0 ? filename.slice(0, dot) : filename;
  const suffix = dot > 0 ? filename.slice(dot) : "";
  let index = 1;
  while (index < 10000) {
    const renamed = index === 1 ? `${prefix}${stem}${suffix}` : `${prefix}${stem}_${index}${suffix}`;
    const candidate = `train/${classFolder}/${renamed}`;
    const hasConflict = existing.has(candidate.toLowerCase()) || reserved.has(candidate.toLowerCase());
    if (!hasConflict) return candidate;
    if (!autoRename) return null;
    index += 1;
  }
  return null;
}

export function findDatasetYamlPath(sourceFiles: Map<string, unknown>) {
  const paths = [...sourceFiles.keys()].filter((path) => /\.(ya?ml)$/i.test(path));
  return paths.find((path) => path.split("/").pop()?.toLowerCase() === "data.yaml") || paths.find((path) => /(^|\/)dataset\.ya?ml$/i.test(path)) || paths[0] || "";
}

export function sortPaths(paths: string[]) {
  return [...paths].sort(naturalCompare);
}
