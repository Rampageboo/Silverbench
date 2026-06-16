import { errMessage } from "./lib/errors";
import { backendBaseUrl } from "./lib/backendConfig";

export const API_BASE_URL = backendBaseUrl();

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
  | "classifyDatasetImages"
  | "createClassFolder"
  | "moveImagesToClass"
  | "writeFileBase64"
  | "trackYoloForward"
  | "getWorkspaceInfo"
  | "listDatasetFiles"
  | "readMetadataRows"
  | "upsertMetadataRows"
  | "removeDetectDatasetLinks"
  | "removeClfDatasetLinks"
  | "readFileBase64"
  | "readTextFile"
  | "writeTextFile"
  | "readLabelTextsBatch"
  | "listWorkspaceFiles"
  | "startBuildYoloLinks"
  | "getBuildJob"
  | "writeWorkspaceSession"
  | "readWorkspaceSession"
  | "chooseDirectory"
  | "chooseImageFile"
  | "chooseTrainModelFile"
  | "readImageFileBase64"
  | "chooseVideoFiles"
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
  | "getPtJob"
  | "cancelPtJob"
  | "maskNoisePreview"
  | "maskNoiseSaveOne"
  | "maskNoiseExportFolder"
  | "saveMaskNoiseTempImage"
  | "duplicateImages"
  | "deleteImages"
  | "batchCropImages"
  | "batchCropFiles"
  | "openFolder"
  | "moveValBackToTrain";

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
  const data = (await response.json()) as ApiCallResponse<T>;
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

export async function health() {
  const response = await fetch(`${API_BASE_URL}/health`, { cache: "no-store" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json() as Promise<{ ok: boolean; app: string; backend: string }>;
}

export type ImagePoolItem = {
  filename: string;
  isNew: boolean;
  isUsed: boolean;
};

export type AppSettings = {
  ok: true;
  lastOpenedWorkspace: string;
  lastOpenedFolder: string;
  lastOpenedYoloFolder: string;
  startupOverlayMode?: "overview" | "minimal";
};

export type OpenWorkspaceResponse = {
  ok: boolean;
  kind?: string;
  root?: string;
  name?: string;
  initialized?: boolean;
  error?: string;
};

export type ImagePoolScan = {
  ok: true;
  workspaceRoot: string;
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

export type LabelClass = {
  id: number;
  name: string;
};

export type LabelBox = {
  classId: number;
  x: number;
  y: number;
  w: number;
  h: number;
};

export type LabelLoadResponse = {
  ok: true;
  workspaceRoot: string;
  filename: string;
  labelPath: string;
  sourceLabelPath: string;
  imageWidth: number;
  imageHeight: number;
  classes: LabelClass[];
  boxes: LabelBox[];
};

export type LabelSaveResponse = {
  ok: true;
  workspaceRoot: string;
  filename: string;
  labelPath: string;
  savedCount: number;
  boxes: LabelBox[];
};

export type LabelClassesSaveResponse = {
  ok: true;
  workspaceRoot: string;
  classes: LabelClass[];
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

export async function writeAppSettings(settings: Partial<Pick<AppSettings, "lastOpenedWorkspace" | "lastOpenedFolder" | "lastOpenedYoloFolder" | "startupOverlayMode">>) {
  const response = await fetch(`${API_BASE_URL}/api/app-settings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(settings)
  });
  const data = await response.json();
  assertOk(data, response);
  return data as { ok: true };
}

export async function openWorkspace(workspaceRoot: string, initIfNeeded = true) {
  const response = await fetch(`${API_BASE_URL}/api/workspace/open`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ workspaceRoot, initIfNeeded })
  });
  const data = await response.json();
  assertOk(data, response);
  return data as OpenWorkspaceResponse;
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

export async function loadLabels(workspaceRoot: string, filename: string) {
  const params = imagePoolParams(workspaceRoot, filename);
  const response = await fetch(`${API_BASE_URL}/api/labels/load?${params.toString()}`, {
    cache: "no-store"
  });
  const data = await response.json();
  assertOk(data, response);
  return data as LabelLoadResponse;
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

export async function saveLabelClasses(workspaceRoot: string, classes: LabelClass[]) {
  const response = await fetch(`${API_BASE_URL}/api/labels/classes`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ workspaceRoot, classes })
  });
  const data = await response.json();
  assertOk(data, response);
  return data as LabelClassesSaveResponse;
}

export async function saveLabels(workspaceRoot: string, filename: string, boxes: LabelBox[]) {
  const response = await fetch(`${API_BASE_URL}/api/labels/save`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ workspaceRoot, filename, boxes })
  });
  const data = await response.json();
  assertOk(data, response);
  return data as LabelSaveResponse;
}

export async function markDetectJunk(workspaceRoot: string, filename: string, detectJunk = true) {
  const response = await fetch(`${API_BASE_URL}/api/image-pool/junk`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ workspaceRoot, filename, detectJunk })
  });
  const data = await response.json();
  assertOk(data, response);
  return data as { ok: true; workspaceRoot: string; filename: string; detectJunk: boolean };
}

export type WorkspaceInfo = {
  ok: boolean;
  root: string;
  name: string;
  detectDataset: string;
  clfDataset: string;
  imagePool?: string;
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
  result?: {
    builtFilenames?: string[];
    detectImagesLinked?: number;
    clfImagesLinked?: number;
    labelsPlaced?: number;
    errors?: string[];
  };
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

export async function readTextFile(root: string, relativePath: string) {
  return callJson<string>("readTextFile", [root, relativePath]);
}

export async function writeTextFile(root: string, relativePath: string, text: string) {
  return callJson<boolean | string>("writeTextFile", [root, relativePath, text]);
}

export async function readLabelTextsBatch(datasetRoot: string, labelPaths: string[]) {
  return callJson<Record<string, string>>("readLabelTextsBatch", [
    datasetRoot,
    JSON.stringify(labelPaths)
  ]);
}

function parseClassIdsFromLabelText(text: string) {
  const ids = new Set<number>();
  for (const line of text.split(/\r?\n/)) {
    const parts = line.trim().split(/\s+/);
    if (!parts[0]) continue;
    const id = Number(parts[0]);
    if (!Number.isNaN(id)) ids.add(Math.trunc(id));
  }
  return ids;
}

export async function loadPoolLabelClassIndex(workspaceRoot: string) {
  const files = await callJson<string[]>("listWorkspaceFiles", [workspaceRoot]);
  const labelPaths = files.filter((path) => path.startsWith("detect_labels/") && path.endsWith(".txt"));
  if (!labelPaths.length) return new Map<string, Set<number>>();
  const texts = await readLabelTextsBatch(workspaceRoot, labelPaths);
  const index = new Map<string, Set<number>>();
  for (const [labelPath, text] of Object.entries(texts)) {
    const filename = labelPath.replace(/^detect_labels\//, "");
    index.set(filename, parseClassIdsFromLabelText(text));
  }
  return index;
}

export async function startBuildYoloLinks(
  workspaceRoot: string,
  rebuild: boolean,
  filenamesJson = ""
) {
  return callJson<BuildJobState>("startBuildYoloLinks", [workspaceRoot, rebuild, filenamesJson]);
}

export async function getBuildJob(jobId: string) {
  return callJson<BuildJobState>("getBuildJob", [jobId]);
}

export async function writeWorkspaceSession(workspaceRoot: string, session: Record<string, unknown>) {
  await callBackend("writeWorkspaceSession", [workspaceRoot, JSON.stringify(session)]);
}
