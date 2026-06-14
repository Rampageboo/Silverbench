import * as api from "../../api";
import type { LabelBox, LabelClass } from "../../api";
import {
  buildLabelIndex,
  findPairs,
  inferDatasetTask,
  parseLabels,
  readClassNamesFromDataset
} from "../dataset-review/datasetCore";
import { boxesToText } from "../dataset-review/labelUtils";

export type BoxLabelEntry = {
  imagePath: string;
  labelPath: string;
  basename: string;
};

export function entryBasename(imagePath: string) {
  return imagePath.split("/").pop() || imagePath;
}

export async function loadDetectDatasetEntries(workspaceRoot: string) {
  const info = await api.getWorkspaceInfo(workspaceRoot);
  if (!info.ok) {
    throw new Error(info.error || "Cannot read workspace info.");
  }
  const datasetRoot = info.detectDataset;
  if (!datasetRoot) {
    throw new Error("detect_dataset path is missing for this workspace.");
  }
  const paths = await api.listDatasetFiles(datasetRoot);
  const filePaths = new Set(paths);
  const datasetTask = inferDatasetTask(filePaths);
  if (datasetTask !== "detect") {
    throw new Error("Box Label requires a YOLO detect dataset (images/ + labels/).");
  }
  const pairs = findPairs(filePaths, datasetTask);
  const entries: BoxLabelEntry[] = pairs
    .map((pair) => {
      const labelPath = pair.labelPath || defaultLabelPath(pair.imagePath);
      return {
        imagePath: pair.imagePath,
        labelPath,
        basename: entryBasename(pair.imagePath)
      };
    })
    .filter((entry) => entry.labelPath);
  return { datasetRoot, entries, filePaths, datasetTask };
}

function defaultLabelPath(imagePath: string) {
  const parts = imagePath.split("/");
  if (parts[0] === "images") {
    return ["labels", ...parts.slice(1)].join("/").replace(/\.[^.]+$/, ".txt");
  }
  const stem = entryBasename(imagePath).replace(/\.[^.]+$/, "");
  return `labels/train/${stem}.txt`;
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
  const text = await api.readTextFile(datasetRoot, entry.labelPath);
  return parseLabels(text);
}

export async function saveEntryLabels(datasetRoot: string, entry: BoxLabelEntry, boxes: LabelBox[]) {
  await api.writeTextFile(datasetRoot, entry.labelPath, boxesToText(boxes));
  return boxes;
}

export async function loadDatasetClassNames(datasetRoot: string, filePaths: Set<string>) {
  return readClassNamesFromDataset(datasetRoot, filePaths);
}

export function classMapToLabelClasses(classNames: Map<number, string>): LabelClass[] {
  return [...classNames.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([id, name]) => ({ id, name }));
}

export async function saveDatasetClassNames(datasetRoot: string, classNames: Map<number, string>) {
  const classes = classMapToLabelClasses(classNames);
  const lines = classes.map((item) => item.name).join("\n");
  await api.writeTextFile(datasetRoot, "classes.txt", lines ? `${lines}\n` : "");
  const yamlNames = classes.map((item) => `  ${item.id}: ${JSON.stringify(item.name)}`).join("\n");
  const yaml = `names:\n${yamlNames}\n`;
  if (classes.length) {
    await api.writeTextFile(datasetRoot, "data.yaml", yaml);
  }
  return classes;
}
