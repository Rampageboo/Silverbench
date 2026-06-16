import { callJson, getWorkspaceInfo, type BackendMethod, type WorkspaceInfo } from "../../api";

export type CropAnchor = "center" | "top" | "bottom" | "skip";

export type BatchCropResult = {
  inputDir?: string;
  outputDir?: string;
  targetWidth?: number;
  targetHeight?: number;
  anchor?: CropAnchor;
  workers?: number;
  perClass?: Record<string, { anchor?: string; total?: number; cropped?: number; skipped?: number }>;
  total?: number;
  cropped?: number;
  skipped?: number;
  errors?: Array<{ path?: string; error?: string }>;
};

export type BatchCropFileItem = {
  absPath: string;
  relPath?: string;
  className: string;
};

function rpc<T>(method: BackendMethod, args: unknown[] = []) {
  return callJson<T>(method, args);
}

export async function loadCropWorkspace(workspaceRoot: string): Promise<WorkspaceInfo> {
  return getWorkspaceInfo(workspaceRoot);
}

export async function chooseCropDirectory(title: string) {
  return rpc<string>("chooseDirectory", [title]);
}

export async function runBatchCropImages(
  inputRoot: string,
  outputRoot: string,
  width: number,
  height: number,
  anchor: CropAnchor,
  classAnchors: Record<string, CropAnchor>,
  workers?: number
) {
  return rpc<BatchCropResult>("batchCropImages", [
    inputRoot,
    outputRoot,
    width,
    height,
    anchor,
    JSON.stringify(classAnchors),
    workers && workers > 0 ? workers : ""
  ]);
}

export async function runBatchCropFiles(
  outputRoot: string,
  width: number,
  height: number,
  anchor: CropAnchor,
  classAnchors: Record<string, CropAnchor>,
  items: BatchCropFileItem[],
  workers?: number
) {
  return rpc<BatchCropResult>("batchCropFiles", [
    outputRoot,
    width,
    height,
    anchor,
    JSON.stringify(classAnchors),
    JSON.stringify(items),
    workers && workers > 0 ? workers : ""
  ]);
}

export function formatBatchCropResult(result: BatchCropResult, outputRoot: string) {
  const errors = (result.errors || []).slice(0, 10).map((item) => `SKIP ${item.path}: ${item.error}`).join("\n");
  const classSummary = Object.entries(result.perClass || {})
    .filter(([name]) => name)
    .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
    .map(([name, item]) => `${name}: ${item.cropped || 0}/${item.total || 0} (${item.anchor || result.anchor || "center"})`)
    .join("\n");
  return [
    `Output: ${outputRoot}`,
    `Cropped ${result.cropped || 0}/${result.total || 0}, skipped ${result.skipped || 0}`,
    classSummary ? `Per class:\n${classSummary}` : "",
    errors ? `Errors:\n${errors}` : ""
  ]
    .filter(Boolean)
    .join("\n");
}

export function defaultBatchCropOutput(datasetRoot: string) {
  const root = datasetRoot.replace(/[\\/]$/, "");
  const sep = root.includes("\\") ? "\\" : "/";
  const runId = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 15);
  return `${root}${sep}batch_crops_${runId}${sep}train`;
}
