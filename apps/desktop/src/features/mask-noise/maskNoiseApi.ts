import { callJson, listDatasetFiles, type WorkspaceInfo } from "../../api";
import { getWorkspaceInfo } from "../../api";

export type MaskNoiseSettings = {
  threshold: number;
  noiseAmount: number;
  blurRadius: number;
  effectMix: number;
  grayMax: number;
  grayMix: number;
};

export type MaskNoisePreviewResult = {
  outputBase64: string;
  diffBase64: string;
  stats?: {
    affected?: number;
    changed?: number;
    grayChanged?: number;
    total?: number;
    meanDelta?: number;
    maxDelta?: number;
  };
};

export type MaskNoiseSaveResult = MaskNoisePreviewResult & {
  output: string;
};

export type MaskNoiseExportResult = {
  total: number;
  exported: number;
  failed: number;
  output: string;
  errors?: string[];
  firstPreview?: MaskNoisePreviewResult;
  firstStats?: MaskNoisePreviewResult["stats"];
};

export type DuplicateImagesResult = {
  sourceImages?: number;
  createdImages?: number;
  createdLabels?: number;
  created?: string[];
  skipped?: string[];
};

export type DeleteImagesResult = {
  deletedImages?: number;
  deletedLabels?: number;
  deleted?: string[];
  skipped?: string[];
};

const IMAGE_EXT = /\.(png|jpg|jpeg|bmp|webp|tif|tiff)$/i;

export function defaultMaskNoiseSettings(): MaskNoiseSettings {
  return {
    threshold: 80,
    noiseAmount: 6,
    blurRadius: 2,
    effectMix: 0.35,
    grayMax: 220,
    grayMix: 0.75
  };
}

export function serializeMaskNoiseSettings(settings: MaskNoiseSettings) {
  return JSON.stringify({
    threshold: Math.max(0, Math.min(255, Math.round(settings.threshold))),
    noiseAmount: Math.max(0, Math.min(255, Math.round(settings.noiseAmount))),
    blurRadius: Math.max(0, Math.min(40, Math.round(settings.blurRadius))),
    effectMix: Math.max(0, Math.min(1, Number(settings.effectMix) || 0)),
    grayMax: Math.max(0, Math.min(255, Math.round(settings.grayMax))),
    grayMix: Math.max(0, Math.min(1, Number(settings.grayMix) || 0))
  });
}

export function loadMaskNoiseWorkspace(workspaceRoot: string): Promise<WorkspaceInfo> {
  return getWorkspaceInfo(workspaceRoot);
}

export function chooseMaskDirectory(title: string) {
  return callJson<string>("chooseDirectory", [title]);
}

export function chooseMaskImageFile(title: string) {
  return callJson<string>("chooseImageFile", [title]);
}

export function readMaskImageBase64(path: string) {
  return callJson<string>("readImageFileBase64", [path]);
}

export function saveMaskNoiseTempImage(filename: string, base64: string, workspaceRoot = "") {
  return callJson<string>("saveMaskNoiseTempImage", [filename, base64, workspaceRoot]);
}

export function maskNoisePreview(photoPath: string, maskPath: string, settings: MaskNoiseSettings) {
  return callJson<MaskNoisePreviewResult>("maskNoisePreview", [photoPath, maskPath, serializeMaskNoiseSettings(settings)]);
}

export function maskNoiseSaveOne(photoPath: string, maskPath: string, outputRoot: string, settings: MaskNoiseSettings) {
  return callJson<MaskNoiseSaveResult>("maskNoiseSaveOne", [photoPath, maskPath, outputRoot, serializeMaskNoiseSettings(settings)]);
}

export function maskNoiseExportFolder(inputRoot: string, maskPath: string, outputRoot: string, settings: MaskNoiseSettings) {
  return callJson<MaskNoiseExportResult>("maskNoiseExportFolder", [inputRoot, maskPath, outputRoot, serializeMaskNoiseSettings(settings)]);
}

export async function listMaskFolderImages(root: string) {
  const files = await listDatasetFiles(root);
  return files.filter((path) => IMAGE_EXT.test(path)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

export function joinBackendPath(root: string, relativePath: string) {
  return `${String(root || "").replace(/[\\/]+$/, "")}/${String(relativePath || "").replace(/^[/\\]+/, "")}`;
}

export function duplicateMaskImages(folderRoot: string, paths: string[], minCopies: number, maxCopies: number) {
  return callJson<DuplicateImagesResult>("duplicateImages", [folderRoot, JSON.stringify(paths), minCopies, maxCopies]);
}

export function deleteMaskImages(folderRoot: string, paths: string[]) {
  return callJson<DeleteImagesResult>("deleteImages", [folderRoot, JSON.stringify(paths)]);
}

export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] || "");
    reader.onerror = () => reject(reader.error || new Error("Failed to read file."));
    reader.readAsDataURL(file);
  });
}
