import { errMessage } from "./lib/errors";
import { backendBaseUrl } from "./lib/backendConfig";
import type { Predictions, UiOrchestrationDoc } from "./features/ui-orchestrator/schema";
import type { UiOrchestrationDocV2 } from "./features/ui-orchestrator/schemaV2";

export const API_BASE_URL = backendBaseUrl();
export const REQUIRED_API_SCHEMA_VERSION = 26;

export type BackendMethod =
  | "markImagePoolSeen"
  | "deletePoolImageCompletely"
  | "findImagePoolDuplicates"
  | "clearImagePoolDuplicates"
  | "ensureImagePoolBackup"
  | "restoreImagePoolBackup"
  | "getImagePoolBackupStats"
  | "ensureImagePoolLabelBackup"
  | "chooseClassifierModel"
  | "classifierModelInfo"
  | "ptModelInfo"
  | "classifyDatasetImages"
  | "createClassFolder"
  | "moveImagesToClass"
  | "writeFileBase64"
  | "trackYoloForward"
  | "getWorkspaceInfo"
  | "listDatasetFiles"
  | "readMetadataRows"
  | "upsertMetadataRows"
  | "readFileBase64"
  | "readFilePreviewBase64"
  | "readTextFile"
  | "writeTextFile"
  | "readLabelTextsBatch"
  | "listWorkspaceFiles"
  | "startExportDataset"
  | "getBuildJob"
  | "importMediaFiles"
  | "writeWorkspaceSession"
  | "readWorkspaceSession"
  | "listSnapshots"
  | "createSnapshot"
  | "restoreSnapshot"
  | "deleteSnapshot"
  | "createWorkspace"
  | "planWorkspaceMigration"
  | "migrateWorkspace"
  | "rollbackWorkspaceMigration"
  | "finishWorkspaceMigration"
  | "chooseDirectory"
  | "chooseImageFile"
  | "chooseImageFiles"
  | "chooseMediaFiles"
  | "chooseTrainModelFile"
  | "readImageFileBase64"
  | "getWorkspaceClasses"
  | "loadUiMap"
  | "saveUiMap"
  | "runReferencePredictions"
  | "chooseVideoFiles"
  | "listWorkspaceVideos"
  | "getVideoFrameBase64"
  | "saveVideoFrame"
  | "startCaptureVideoScreenshotJobs"
  | "getCaptureVideoScreenshotJob"
  | "cancelCaptureVideoScreenshotJob"
  | "prepareValidationSplit"
  | "prepareClassificationValidationSplit"
  | "ensureDataYaml"
  | "startDetectFolderWithPt"
  | "startClassifyFolderWithPt"
  | "startDetectImageWithPt"
  | "startClassifyImageWithPt"
  | "classifyImageWithPt"
  | "detectImageWithPt"
  | "classifyImageBase64WithPt"
  | "detectImageBase64WithPt"
  | "getPtJob"
  | "cancelPtJob"
  | "readAutoLabelModelRegistry"
  | "importAutoLabelModel"
  | "maskNoisePreview"
  | "maskNoiseSaveOne"
  | "maskNoiseExportFolder"
  | "saveMaskNoiseTempImage"
  | "duplicateImages"
  | "deleteImages"
  | "batchCropImages"
  | "batchCropFiles"
  | "openFolder"
  | "moveValBackToTrain"
  | "copyModelToWorkspace";

export type ApiCallResponse<T = unknown> =
  | {
      ok: true;
      method: string;
      result: T;
    }
  | {
      ok: false;
      method: string;
      error: {
        type: string;
        message: string;
      };
    };

/**
 * The backend currently emits three different error-body shapes:
 *   - RPC / _error_response:  { ok:false, error: { type, message } }
 *   - FastAPI HTTPException:   { detail: "..." }
 *   - legacy / openFolder:     { ok:false, error: "..." }
 * Collapse all of them to a single message here so call sites don't each
 * have to probe `data?.detail || data?.error?.message || ...`.
 */
function apiErrorMessage(data: unknown, status: number): string {
  const body = (data ?? {}) as { detail?: unknown; error?: unknown };
  if (typeof data === "string" && data.trim()) return data.trim();
  if (body.error && typeof body.error === "object") {
    const message = (body.error as { message?: unknown }).message;
    if (typeof message === "string" && message) return message;
  }
  if (typeof body.error === "string" && body.error) return body.error;
  if (typeof body.detail === "string" && body.detail) return body.detail;
  return `HTTP ${status}`;
}

/** Throw a unified Error when an HTTP/JSON response is not ok. */
function assertOk(data: unknown, response: Response): void {
  const ok = (data as { ok?: unknown } | null)?.ok;
  if (!response.ok || ok !== true) {
    throw new Error(apiErrorMessage(data, response.status));
  }
}

export async function call<T = unknown>(method: BackendMethod, args: unknown[] = []) {
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}/api/call`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ method, args })
    });
  } catch (error) {
    const message = errMessage(error);
    if (message === "Failed to fetch") {
      throw new Error(`Backend unreachable at ${API_BASE_URL}. Ensure FastAPI is running.`);
    }
    throw error instanceof Error ? error : new Error(message);
  }
  const text = await response.text();
  let data: unknown = text;
  if (text.trim()) {
    try {
      data = JSON.parse(text) as ApiCallResponse<T>;
    } catch {
      data = text;
    }
  }
  assertOk(data, response);
  return data as Extract<ApiCallResponse<T>, { ok: true }>;
}

export async function callBackend(method: BackendMethod, args: unknown[] = []) {
  const data = await call(method, args);
  const result = data.result;
  if (typeof result === "string") {
    try {
      return JSON.parse(result) as unknown;
    } catch {
      return result;
    }
  }
  return result;
}

export async function callJson<T>(method: BackendMethod, args: unknown[] = []): Promise<T> {
  // callBackend already JSON.parses string results when valid; plain text/base64 stay as strings.
  return (await callBackend(method, args)) as T;
}

export type BackendHealth = {
  ok: boolean;
  app: string;
  backend: string;
  ui?: string;
  apiSchemaVersion?: number;
};

export async function health() {
  const controller = new AbortController();
  const timer = globalThis.setTimeout(() => controller.abort(), 2500);
  try {
    const response = await fetch(`${API_BASE_URL}/health`, {
      cache: "no-store",
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json() as Promise<BackendHealth>;
  } finally {
    globalThis.clearTimeout(timer);
  }
}

export async function requireCurrentBackend() {
  const data = await health();
  const schema = Number(data.apiSchemaVersion || 0);
  if (!data.ok || schema < REQUIRED_API_SCHEMA_VERSION) {
    throw new Error(
      `Backend is out of date (API schema ${schema || "unknown"}; need ${REQUIRED_API_SCHEMA_VERSION}). Restart RampageWorkbench or the backend process before creating a workspace.`
    );
  }
  return data;
}

export type ImagePoolItem = {
  filename: string;
  imagePath?: string;
  isNew: boolean;
  isUsed: boolean;
};

/** App-level settings (in the user's app-data folder): the workspaces used, plus UI preferences. */
export type AppSettings = {
  ok: true;
  lastWorkspace: string;
  workspaces: string[];
  startupOverlayMode: "overview" | "minimal";
  sidebarCollapsed: boolean;
};

export type WorkspacePayload = {
  ok: true;
  kind: "workspace";
  root: string;
  id: string;
  name: string;
  formatVersion: number;
  paths: Record<string, string>;
  /** A migration finished but the user has not yet kept or undone it. */
  migrationPending?: boolean;
};

export type MigrationSummary = {
  ok: boolean;
  root: string;
  sourceKind: "snapshot" | "v2" | "v1";
  activeVersion: string | null;
  counts: Record<string, number>;
  steps?: Array<Record<string, unknown>>;
  warnings: string[];
  conflicts: string[];
  untouched: string[];
};

/** What a folder turned out to be when opened. Opening never creates anything. */
export type OpenWorkspaceResponse =
  | WorkspacePayload
  | { ok: true; kind: "legacy"; root: string; name: string; migration: MigrationSummary }
  | { ok: true; kind: "dataset"; root: string; name: string; task: "detect" | "classify" }
  | { ok: true; kind: "folder"; root: string; name: string; empty: boolean };

export type ImagePoolScan = {
  ok: true;
  workspaceRoot: string;
  mediaDir?: string;
  total: number;
  newCount: number;
  usedCount: number;
  unusedCount: number;
  snapshotUpdatedAt: string;
  fast: boolean;
  fromCache: boolean;
  usageScanned: boolean;
  files: ImagePoolItem[];
};

export type MediaImportMode = "copy" | "move";

export type MediaImportResult = {
  ok: true;
  workspaceRoot: string;
  mediaDir: string;
  mode: MediaImportMode;
  importedCount: number;
  skippedCount: number;
  failedCount: number;
  imported: Array<{
    source: string;
    filename: string;
    imagePath: string;
    mediaPath?: string;
    mediaType?: "image" | "video";
    action: MediaImportMode;
  }>;
  skipped: Array<{ source: string; reason: string }>;
  failed: Array<{ source: string; error: string }>;
};

export type LabelClass = {
  id: number;
  name: string;
  key?: string;
  aliases?: string[];
};

export type LabelBox = {
  classId: number;
  x: number;
  y: number;
  w: number;
  h: number;
};

function imagePoolParams(workspaceRoot: string, filename?: string) {
  const params = new URLSearchParams({ workspaceRoot });
  if (filename) params.set("filename", filename);
  return params;
}

export async function scanImagePool(workspaceRoot: string, options: { fast?: boolean } = {}) {
  const params = imagePoolParams(workspaceRoot);
  if (options.fast !== false) params.set("fast", "true");
  else params.set("fast", "false");
  const response = await fetch(`${API_BASE_URL}/api/image-pool?${params.toString()}`, {
    cache: "no-store"
  });
  const data = await response.json();
  assertOk(data, response);
  return data as ImagePoolScan;
}

export async function markImagePoolSeen(workspaceRoot: string) {
  return callJson<{ markedCount?: number }>("markImagePoolSeen", [workspaceRoot]);
}

export async function chooseImageFiles(title = "Choose Images to Import") {
  return callJson<string[]>("chooseImageFiles", [title]);
}

export async function readImageFileBase64(path: string) {
  return callJson<string>("readImageFileBase64", [path]);
}

export async function getWorkspaceClassNames(workspaceRoot: string) {
  const result = await callJson<{ ok: boolean; classes?: string[]; error?: string }>("getWorkspaceClasses", [
    workspaceRoot
  ]);
  if (!result.ok) throw new Error(result.error || "Failed to load workspace classifier classes.");
  return result.classes ?? [];
}

export type SaveUiMapResponse = {
  name: string;
  path: string;
};

export type UiMapDocument = UiOrchestrationDoc | UiOrchestrationDocV2;

export async function loadUiMap(name: string) {
  return callJson<UiMapDocument>("loadUiMap", [name]);
}

export async function saveUiMap(name: string, doc: UiMapDocument) {
  return callJson<SaveUiMapResponse>("saveUiMap", [name, doc]);
}

export async function chooseTrainModelFile(title = "Choose YOLO Model (.pt)") {
  return callJson<string>("chooseTrainModelFile", [title]);
}

export type ReferencePredictionOptions = { imageSize?: number; confidence?: number; device?: string };

export async function runReferencePredictions(
  imagePath: string,
  detModelPath: string | null,
  clfModelPath: string | null,
  options: ReferencePredictionOptions = {}
) {
  const result = await callJson<{ ok: boolean; predictions?: Predictions; error?: string }>(
    "runReferencePredictions",
    [imagePath, detModelPath, clfModelPath, options]
  );
  if (!result.ok || !result.predictions) throw new Error(result.error || "Reference prediction failed.");
  return result.predictions;
}

export async function chooseMediaFiles(title = "Choose Media to Import") {
  return callJson<string[]>("chooseMediaFiles", [title]);
}

export async function importMediaFiles(workspaceRoot: string, paths: string[], mode: MediaImportMode) {
  return callJson<MediaImportResult>("importMediaFiles", [workspaceRoot, JSON.stringify(paths), mode]);
}

export async function deletePoolImageCompletely(workspaceRoot: string, filename: string) {
  return callJson<{ failedPaths?: { error: string }[] }>("deletePoolImageCompletely", [
    workspaceRoot,
    filename
  ]);
}

export async function findImagePoolDuplicates(workspaceRoot: string) {
  return callJson<unknown>("findImagePoolDuplicates", [workspaceRoot]);
}

export async function clearImagePoolDuplicates(workspaceRoot: string) {
  return callJson<{
    removedCount?: number;
    failed?: unknown[];
    plan?: { remove?: string[] }[];
  }>("clearImagePoolDuplicates", [workspaceRoot]);
}

export async function ensureImagePoolBackup(workspaceRoot: string, imagePath: string) {
  return callJson<{ ok?: boolean; image?: string; label?: string; skipped?: boolean }>(
    "ensureImagePoolBackup",
    [workspaceRoot, imagePath]
  );
}

export async function restoreImagePoolBackup(workspaceRoot: string, imagePath: string) {
  return callJson<{ ok?: boolean; restored?: { image?: boolean; label?: boolean }; labelPath?: string }>(
    "restoreImagePoolBackup",
    [workspaceRoot, imagePath]
  );
}

export async function getImagePoolBackupStats(workspaceRoot: string) {
  return callJson<{ imageCount?: number }>("getImagePoolBackupStats", [workspaceRoot]);
}

export async function ensureImagePoolLabelBackup(workspaceRoot: string, labelPath: string) {
  return callJson<{ ok?: boolean }>("ensureImagePoolLabelBackup", [workspaceRoot, labelPath]);
}

export async function chooseClassifierModel(title = "Choose YOLO Classification ONNX Model") {
  return callJson<string>("chooseClassifierModel", [title]);
}

export async function classifierModelInfo(modelPath: string) {
  return callJson<{ classes?: string[] }>("classifierModelInfo", [modelPath]);
}

export type PtModelInfo = {
  ok: true;
  modelPath: string;
  task?: string;
  classes?: Array<{ id: number; name: string }>;
  classNames?: string[];
};

export async function ptModelInfo(modelPath: string): Promise<PtModelInfo>;
export async function ptModelInfo(workspaceRoot: string, relativePath: string): Promise<PtModelInfo>;
export async function ptModelInfo(pathOrRoot: string, relativePath?: string) {
  return callJson<PtModelInfo>(
    "ptModelInfo",
    relativePath === undefined ? [pathOrRoot] : [pathOrRoot, relativePath]
  );
}

export type ClassifierPrediction = {
  classId: number;
  name: string;
  confidence: number;
};

export type ClassifierImageResult = {
  relativePath: string;
  top?: ClassifierPrediction;
  predictions?: ClassifierPrediction[];
};

export type PtDetectPrediction = {
  classId: number;
  className?: string;
  confidence: number;
  x: number;
  y: number;
  w: number;
  h: number;
};

export type PtDetectImageResult = {
  ok: true;
  modelPath: string;
  imagePath: string;
  imageSize: number;
  confidence: number;
  predictions: PtDetectPrediction[];
};

export type PtJob = {
  id: string;
  kind?: string;
  status?: string;
  done?: number;
  total?: number;
  detail?: string;
  errors?: string[];
  result?: Record<string, unknown> | null;
};

export type PtClassifyPrediction = {
  classId: number;
  className?: string;
  name?: string;
  confidence: number;
};

export type PtClassifyImageResult = {
  ok: true;
  modelPath: string;
  imagePath: string;
  imageSize: number;
  top?: PtClassifyPrediction | null;
  predictions: PtClassifyPrediction[];
};

export async function classifyDatasetImages(
  datasetRoot: string,
  modelPath: string,
  imagePaths: string[],
  topK = 5
) {
  return callJson<{
    model?: { classes?: string[] };
    results?: ClassifierImageResult[];
    errors?: Array<{ relativePath: string; error: string }>;
  }>("classifyDatasetImages", [datasetRoot, modelPath, JSON.stringify(imagePaths), topK]);
}

export async function classifyImageWithPt(
  workspaceRoot: string,
  modelRelativePath: string,
  imageRelativePath: string,
  imageSize = 0,
  device = "0",
  topK = 5
) {
  return callJson<PtClassifyImageResult>("classifyImageWithPt", [
    workspaceRoot,
    modelRelativePath,
    imageRelativePath,
    imageSize,
    device,
    topK
  ]);
}

export async function startClassifyImageWithPt(
  workspaceRoot: string,
  modelRelativePath: string,
  imageRelativePath: string,
  imageSize = 0,
  device = "0",
  topK = 5
) {
  return callJson<PtJob>("startClassifyImageWithPt", [
    workspaceRoot,
    modelRelativePath,
    imageRelativePath,
    imageSize,
    device,
    topK
  ]);
}

export async function classifyImageBase64WithPt(
  workspaceRoot: string,
  modelRelativePath: string,
  imageBase64: string,
  imageSize = 0,
  device = "0",
  topK = 5
) {
  return callJson<PtClassifyImageResult>("classifyImageBase64WithPt", [
    workspaceRoot,
    modelRelativePath,
    imageBase64,
    imageSize,
    device,
    topK
  ]);
}

export async function detectImageWithPt(
  workspaceRoot: string,
  modelRelativePath: string,
  imageRelativePath: string,
  imageSize = 640,
  confidence = 0.25,
  device = "0"
) {
  return callJson<PtDetectImageResult>("detectImageWithPt", [
    workspaceRoot,
    modelRelativePath,
    imageRelativePath,
    imageSize,
    confidence,
    device
  ]);
}

export async function startDetectImageWithPt(
  workspaceRoot: string,
  modelRelativePath: string,
  imageRelativePath: string,
  imageSize = 640,
  confidence = 0.25,
  device = "0"
) {
  return callJson<PtJob>("startDetectImageWithPt", [
    workspaceRoot,
    modelRelativePath,
    imageRelativePath,
    imageSize,
    confidence,
    device
  ]);
}

export async function detectImageBase64WithPt(
  workspaceRoot: string,
  modelRelativePath: string,
  imageBase64: string,
  imageSize = 640,
  confidence = 0.25,
  device = "0"
) {
  return callJson<PtDetectImageResult>("detectImageBase64WithPt", [
    workspaceRoot,
    modelRelativePath,
    imageBase64,
    imageSize,
    confidence,
    device
  ]);
}

export async function getPtJob(jobId: string) {
  return callJson<PtJob>("getPtJob", [jobId]);
}

export async function cancelPtJob(jobId: string) {
  return callJson<PtJob>("cancelPtJob", [jobId]);
}

export async function createClassFolder(datasetRoot: string, folderName: string) {
  return callJson<{ ok?: boolean; relativePath?: string; className?: string }>("createClassFolder", [
    datasetRoot,
    folderName
  ]);
}

export async function moveImagesToClass(datasetRoot: string, imagePaths: string[], className: string) {
  return callJson<{
    moved?: Array<{ from: string; to: string }>;
    skipped?: string[];
  }>("moveImagesToClass", [datasetRoot, JSON.stringify(imagePaths), className]);
}

export async function writeFileBase64(root: string, relativePath: string, base64Data: string) {
  return callJson<boolean>("writeFileBase64", [root, relativePath, base64Data]);
}

export async function trackYoloForward(
  workspaceRoot: string,
  startImagePath: string,
  box: LabelBox,
  orderedImagePaths: string[],
  options: Record<string, unknown>
) {
  return callJson<{
    ok?: boolean;
    saved?: number;
    stoppedAt?: string;
    reason?: string;
    lastBox?: LabelBox;
  }>("trackYoloForward", [
    workspaceRoot,
    startImagePath,
    JSON.stringify(box),
    JSON.stringify(orderedImagePaths),
    JSON.stringify(options)
  ]);
}

export async function appSettings() {
  const response = await fetch(`${API_BASE_URL}/api/app-settings`, { cache: "no-store" });
  const data = await response.json();
  assertOk(data, response);
  return data as AppSettings;
}

export async function writeAppSettings(
  settings: Partial<Pick<AppSettings, "lastWorkspace" | "workspaces" | "startupOverlayMode" | "sidebarCollapsed">>
) {
  const response = await fetch(`${API_BASE_URL}/api/app-settings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(settings)
  });
  const data = await response.json();
  assertOk(data, response);
  return data as AppSettings;
}

export async function openWorkspace(workspaceRoot: string) {
  const response = await fetch(`${API_BASE_URL}/api/workspace/open`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ workspaceRoot })
  });
  const data = await response.json();
  assertOk(data, response);
  return data as OpenWorkspaceResponse;
}

/** Turn a new, empty or plain folder into a workspace (optionally with its classes.json document). */
export async function createWorkspace(folder: string, classes?: unknown) {
  return callJson<WorkspacePayload>("createWorkspace", classes ? [folder, JSON.stringify(classes)] : [folder]);
}

export async function planWorkspaceMigration(root: string) {
  return callJson<MigrationSummary>("planWorkspaceMigration", [root]);
}

export async function migrateWorkspace(root: string) {
  return callJson<{ ok: true; root: string; steps: number; workspace: WorkspacePayload }>("migrateWorkspace", [root]);
}

export async function rollbackWorkspaceMigration(root: string) {
  return callJson<{ ok: true; root: string; undone: number }>("rollbackWorkspaceMigration", [root]);
}

export async function finishWorkspaceMigration(root: string) {
  return callJson<{ ok: true }>("finishWorkspaceMigration", [root]);
}

/** An annotation snapshot in versions/ (labels and classes only, never media). */
export type WorkspaceSnapshot = {
  id: string;
  createdAt: string;
  note: string;
  imageLabels: number;
  videoLabels: number;
};

export type WorkspaceSnapshots = { ok: true; version: 1; snapshots: WorkspaceSnapshot[] };

export async function listSnapshots(workspaceRoot: string) {
  return callJson<WorkspaceSnapshots>("listSnapshots", [workspaceRoot]);
}

export async function createSnapshot(workspaceRoot: string, note = "") {
  return callJson<WorkspaceSnapshots & { created: WorkspaceSnapshot }>("createSnapshot", [workspaceRoot, note]);
}

export async function restoreSnapshot(workspaceRoot: string, snapshotId: string) {
  return callJson<WorkspaceSnapshots & { restored: string; backup: WorkspaceSnapshot }>("restoreSnapshot", [
    workspaceRoot,
    snapshotId
  ]);
}

export async function deleteSnapshot(workspaceRoot: string, snapshotId: string) {
  return callJson<WorkspaceSnapshots>("deleteSnapshot", [workspaceRoot, snapshotId]);
}

export function imagePoolThumbUrl(workspaceRoot: string, filename: string) {
  const params = imagePoolParams(workspaceRoot, filename);
  params.set("size", "180");
  return `${API_BASE_URL}/api/images/thumb?${params.toString()}`;
}

export function imagePoolPreviewUrl(workspaceRoot: string, filename: string) {
  const params = imagePoolParams(workspaceRoot, filename);
  params.set("maxEdge", "1600");
  return `${API_BASE_URL}/api/images/preview?${params.toString()}`;
}

export async function loadLabelClasses(workspaceRoot: string) {
  const params = imagePoolParams(workspaceRoot);
  const response = await fetch(`${API_BASE_URL}/api/labels/classes?${params.toString()}`, {
    cache: "no-store"
  });
  const data = await response.json();
  assertOk(data, response);
  return data.classes as LabelClass[];
}

export type WorkspaceInfo = {
  ok: boolean;
  root: string;
  name: string;
  detectDataset: string;
  clfDataset: string;
  imagePool?: string;
  mediaDir?: string;
  imageCount?: number;
  labelCount?: number;
  error?: string;
};

export type MetadataRowsResponse = {
  ok?: boolean;
  rows?: Array<Record<string, unknown>>;
  classes?: string[];
  clfClasses?: string[];
  metadataClasses?: string[];
  detectClasses?: Array<{ id: number; name: string }>;
  clfDataset?: string;
  detectDataset?: string;
  error?: string;
};

export type BuildJobState = {
  id: string;
  status: string;
  done?: number;
  total?: number;
  detail?: string;
  errors?: string[];
  result?: ExportResult;
};

export type ExportResult = {
  ok: boolean;
  exportRoot: string;
  detectDataset: string;
  clfDataset: string;
  builtFilenames?: string[];
  detectImages?: number;
  clfImages?: number;
  labelsPlaced?: number;
  skippedRows?: number;
  warnings?: string[];
  errors?: string[];
};

export type ExportOptions = {
  /** Folder name under exports/ (default "dataset"). */
  name?: string;
  /** Write somewhere outside the workspace instead (must be empty or an earlier export). */
  destination?: string;
  /** Only (re)place these images; the rest of the export stays as it is. */
  filenames?: string[];
  rebuild?: boolean;
  /** Hard-link images instead of copying them (same drive only; edits then reach media/). */
  link?: boolean;
};

export async function getWorkspaceInfo(workspaceRoot: string) {
  return callJson<WorkspaceInfo>("getWorkspaceInfo", [workspaceRoot]);
}

export async function listDatasetFiles(datasetRoot: string) {
  return callJson<string[]>("listDatasetFiles", [datasetRoot]);
}

export async function readMetadataRows(workspaceRoot: string) {
  return callJson<MetadataRowsResponse>("readMetadataRows", [workspaceRoot]);
}

export async function upsertMetadataRows(workspaceRoot: string, updates: unknown[]) {
  return callJson<{ ok?: boolean; created?: number; updated?: number; error?: string }>(
    "upsertMetadataRows",
    [workspaceRoot, JSON.stringify(updates)]
  );
}

export async function readFileBase64(root: string, relativePath: string) {
  return callJson<string>("readFileBase64", [root, relativePath]);
}

export async function readFilePreviewBase64(
  root: string,
  relativePath: string,
  maxEdge = 1280,
  quality = 60
) {
  return callJson<string>("readFilePreviewBase64", [root, relativePath, maxEdge, quality]);
}

export async function readTextFile(root: string, relativePath: string) {
  const data = await call<unknown>("readTextFile", [root, relativePath]);
  if (typeof data.result === "string") return data.result;
  return JSON.stringify(data.result ?? "", null, 2);
}

export async function writeTextFile(root: string, relativePath: string, text: string) {
  return callJson<boolean | string>("writeTextFile", [root, relativePath, text]);
}

export async function readLabelTextsBatch(datasetRoot: string, labelPaths: string[]) {
  return callJson<Record<string, string>>("readLabelTextsBatch", [datasetRoot, JSON.stringify(labelPaths)]);
}

/** Export the workspace's annotations as a YOLO dataset (runs as a background job). */
export async function startExportDataset(workspaceRoot: string, options: ExportOptions = {}) {
  return callJson<BuildJobState>("startExportDataset", [workspaceRoot, JSON.stringify(options)]);
}

export async function getBuildJob(jobId: string) {
  return callJson<BuildJobState>("getBuildJob", [jobId]);
}

export async function writeWorkspaceSession(workspaceRoot: string, session: Record<string, unknown>) {
  await callBackend("writeWorkspaceSession", [workspaceRoot, JSON.stringify(session)]);
}
