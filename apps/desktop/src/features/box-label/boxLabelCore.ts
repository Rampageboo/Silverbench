import * as api from "../../api";
import { imageLabelPath } from "../../workspace/layout";
import type { LabelBox } from "../../api";
import { buildLabelIndex, parseLabels } from "../dataset-review/datasetCore";
import { boxesToText } from "../dataset-review/labelUtils";

export type BoxLabelEntry = {
  imagePath: string;
  labelPath: string;
  basename: string;
};

export function entryBasename(imagePath: string) {
  return imagePath.split("/").pop() || imagePath;
}

export function detectLabelPathForMediaFilename(filename: string) {
  return imageLabelPath(entryBasename(filename));
}

export function mediaBoxLabelEntry(mediaDir: string, filename: string, imagePath?: string): BoxLabelEntry {
  const safeMediaDir = mediaDir.trim().replace(/^\/+|\/+$/g, "") || "media";
  const basename = entryBasename(filename);
  return {
    imagePath: imagePath || `${safeMediaDir}/${basename}`,
    labelPath: detectLabelPathForMediaFilename(basename),
    basename
  };
}

export async function loadMediaBoxLabelEntries(workspaceRoot: string) {
  const info = await api.getWorkspaceInfo(workspaceRoot);
  if (!info.ok) {
    throw new Error(info.error || "Cannot read workspace info.");
  }
  const datasetRoot = info.root || workspaceRoot;
  const mediaDir = info.mediaDir || "media";
  const scan = await api.scanImagePool(workspaceRoot, { fast: true });
  const entries = scan.files.map((item) => mediaBoxLabelEntry(mediaDir, item.filename, item.imagePath));
  return {
    datasetRoot,
    mediaDir,
    entries,
    filePaths: new Set(entries.flatMap((entry) => [entry.imagePath, entry.labelPath])),
    datasetTask: "detect" as const
  };
}

export async function loadDetectDatasetClassIndex(
  datasetRoot: string,
  entries: BoxLabelEntry[],
  filePaths?: Set<string>
) {
  const paths = filePaths ?? new Set(await api.listDatasetFiles(datasetRoot));
  const pairs = entries.map((entry) => ({
    imagePath: entry.imagePath,
    labelPath: entry.labelPath,
    classId: null,
    className: ""
  }));
  const { imageClassSet } = await buildLabelIndex(datasetRoot, pairs, "detect");
  const index = new Map<string, Set<number>>();
  for (const [imagePath, classSet] of imageClassSet) {
    index.set(entryBasename(imagePath), classSet);
  }
  void paths;
  return index;
}

export async function loadEntryLabels(datasetRoot: string, entry: BoxLabelEntry) {
  try {
    return parseLabels(await api.readTextFile(datasetRoot, entry.labelPath));
  } catch {
    return [];
  }
}

export async function saveEntryLabels(datasetRoot: string, entry: BoxLabelEntry, boxes: LabelBox[]) {
  await api.writeTextFile(datasetRoot, entry.labelPath, boxesToText(boxes));
  return boxes;
}

