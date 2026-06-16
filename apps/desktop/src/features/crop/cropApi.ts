import { callJson, getWorkspaceInfo, type BackendMethod, type WorkspaceInfo } from "../../api";

export type CropAnchor = "center" | "top" | "bottom";

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

function rpc<T>(method: string, args: unknown[] = []) {
  return callJson<T>(method as BackendMethod, args);
}

export async function loadCropWorkspace(workspaceRoot: string): Promise<WorkspaceInfo> {
  return getWorkspaceInfo(workspaceRoot);
}

export async function chooseCropDirectory(title: string) {
  return rpc<string>("chooseDirectory", [title]);
}

export async function runBatchCropImages(inputRoot: string, outputRoot: string, width: number, height: number, anchor: CropAnchor, workers?: number) {
  return rpc<BatchCropResult>("batchCropImages", [inputRoot, outputRoot, width, height, anchor, "{}", workers && workers > 0 ? workers : ""]);
}
