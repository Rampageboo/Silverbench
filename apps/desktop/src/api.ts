export const API_BASE_URL = "http://127.0.0.1:8765";

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

export async function call<T = unknown>(method: string, args: unknown[] = []) {
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
    const message = error instanceof Error ? error.message : String(error);
    if (message === "Failed to fetch") {
      throw new Error(`Backend unreachable at ${API_BASE_URL}. Ensure FastAPI is running.`);
    }
    throw error instanceof Error ? error : new Error(message);
  }
  const data = (await response.json()) as ApiCallResponse<T>;
  if (!response.ok || !data.ok) {
    const message = data.ok ? `HTTP ${response.status}` : data.error.message;
    throw new Error(message);
  }
  return data;
}

export async function callBackend(method: string, args: unknown[] = []) {
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
  if (!response.ok || !data.ok) {
    const message = data?.error?.message || `HTTP ${response.status}`;
    throw new Error(message);
  }
  return data as ImagePoolScan;
}

export async function markImagePoolSeen(workspaceRoot: string) {
  return callBackend("markImagePoolSeen", [workspaceRoot]) as Promise<{ markedCount?: number }>;
}

export async function deletePoolImageCompletely(workspaceRoot: string, filename: string) {
  return callBackend("deletePoolImageCompletely", [workspaceRoot, filename]) as Promise<{
    failedPaths?: { error: string }[];
  }>;
}

export async function findImagePoolDuplicates(workspaceRoot: string) {
  return callBackend("findImagePoolDuplicates", [workspaceRoot]);
}

export async function clearImagePoolDuplicates(workspaceRoot: string) {
  return callBackend("clearImagePoolDuplicates", [workspaceRoot]) as Promise<{
    removedCount?: number;
    failed?: unknown[];
    plan?: { remove?: string[] }[];
  }>;
}

export async function ensureImagePoolBackup(workspaceRoot: string, imagePath: string) {
  return callBackend("ensureImagePoolBackup", [workspaceRoot, imagePath]) as Promise<{
    ok?: boolean;
    image?: string;
    label?: string;
    skipped?: boolean;
  }>;
}

export async function restoreImagePoolBackup(workspaceRoot: string, imagePath: string) {
  return callBackend("restoreImagePoolBackup", [workspaceRoot, imagePath]) as Promise<{
    ok?: boolean;
    restored?: { image?: boolean; label?: boolean };
    labelPath?: string;
  }>;
}

export async function getImagePoolBackupStats(workspaceRoot: string) {
  const raw = await callBackend("getImagePoolBackupStats", [workspaceRoot]);
  if (typeof raw === "string") {
    return JSON.parse(raw) as { imageCount?: number };
  }
  return raw as { imageCount?: number };
}

export async function ensureImagePoolLabelBackup(workspaceRoot: string, labelPath: string) {
  return callBackend("ensureImagePoolLabelBackup", [workspaceRoot, labelPath]) as Promise<{ ok?: boolean }>;
}

export async function chooseClassifierModel(title = "Choose YOLO Classification ONNX Model") {
  return (await callBackend("chooseClassifierModel", [title])) as string;
}

export async function classifierModelInfo(modelPath: string) {
  const raw = await callBackend("classifierModelInfo", [modelPath]);
  if (typeof raw === "string") {
    return JSON.parse(raw) as { classes?: string[] };
  }
  return raw as { classes?: string[] };
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
  const raw = await callBackend("classifyDatasetImages", [
    datasetRoot,
    modelPath,
    JSON.stringify(imagePaths),
    topK
  ]);
  if (typeof raw === "string") {
    return JSON.parse(raw) as {
      model?: { classes?: string[] };
      results?: ClassifierImageResult[];
      errors?: Array<{ relativePath: string; error: string }>;
    };
  }
  return raw as {
    model?: { classes?: string[] };
    results?: ClassifierImageResult[];
    errors?: Array<{ relativePath: string; error: string }>;
  };
}

export async function createClassFolder(datasetRoot: string, folderName: string) {
  const raw = await callBackend("createClassFolder", [datasetRoot, folderName]);
  if (typeof raw === "string") {
    return JSON.parse(raw) as { ok?: boolean; relativePath?: string; className?: string };
  }
  return raw as { ok?: boolean; relativePath?: string; className?: string };
}

export async function moveImagesToClass(datasetRoot: string, imagePaths: string[], className: string) {
  const raw = await callBackend("moveImagesToClass", [datasetRoot, JSON.stringify(imagePaths), className]);
  if (typeof raw === "string") {
    return JSON.parse(raw) as {
      moved?: Array<{ from: string; to: string }>;
      skipped?: string[];
    };
  }
  return raw as {
    moved?: Array<{ from: string; to: string }>;
    skipped?: string[];
  };
}

export async function writeFileBase64(root: string, relativePath: string, base64Data: string) {
  return callBackend("writeFileBase64", [root, relativePath, base64Data]) as Promise<boolean>;
}

export async function trackYoloForward(
  workspaceRoot: string,
  startImagePath: string,
  box: LabelBox,
  orderedImagePaths: string[],
  options: Record<string, unknown>
) {
  const raw = await callBackend("trackYoloForward", [
    workspaceRoot,
    startImagePath,
    JSON.stringify(box),
    JSON.stringify(orderedImagePaths),
    JSON.stringify(options)
  ]);
  return raw as {
    ok?: boolean;
    saved?: number;
    stoppedAt?: string;
    reason?: string;
    lastBox?: LabelBox;
  };
}

export async function appSettings() {
  const response = await fetch(`${API_BASE_URL}/api/app-settings`, { cache: "no-store" });
  const data = await response.json();
  if (!response.ok || !data.ok) {
    throw new Error(data?.detail || data?.error?.message || `HTTP ${response.status}`);
  }
  return data as AppSettings;
}

export async function writeAppSettings(settings: Partial<Pick<AppSettings, "lastOpenedWorkspace" | "lastOpenedFolder" | "lastOpenedYoloFolder">>) {
  const response = await fetch(`${API_BASE_URL}/api/app-settings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(settings)
  });
  const data = await response.json();
  if (!response.ok || !data.ok) {
    throw new Error(data?.detail || data?.error?.message || `HTTP ${response.status}`);
  }
  return data as { ok: true };
}

export async function openWorkspace(workspaceRoot: string, initIfNeeded = true) {
  const response = await fetch(`${API_BASE_URL}/api/workspace/open`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ workspaceRoot, initIfNeeded })
  });
  const data = await response.json();
  if (!response.ok || !data.ok) {
    throw new Error(data?.error || data?.detail || `HTTP ${response.status}`);
  }
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
  if (!response.ok || !data.ok) {
    throw new Error(data?.detail || data?.error?.message || `HTTP ${response.status}`);
  }
  return data as LabelLoadResponse;
}

export async function loadLabelClasses(workspaceRoot: string) {
  const params = imagePoolParams(workspaceRoot);
  const response = await fetch(`${API_BASE_URL}/api/labels/classes?${params.toString()}`, {
    cache: "no-store"
  });
  const data = await response.json();
  if (!response.ok || !data.ok) {
    throw new Error(data?.detail || data?.error?.message || `HTTP ${response.status}`);
  }
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
  if (!response.ok || !data.ok) {
    throw new Error(data?.detail || data?.error?.message || `HTTP ${response.status}`);
  }
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
  if (!response.ok || !data.ok) {
    throw new Error(data?.detail || data?.error?.message || `HTTP ${response.status}`);
  }
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
  if (!response.ok || !data.ok) {
    throw new Error(data?.detail || data?.error?.message || `HTTP ${response.status}`);
  }
  return data as { ok: true; workspaceRoot: string; filename: string; detectJunk: boolean };
}

export type WorkspaceInfo = {
  ok: boolean;
  root: string;
  name: string;
  detectDataset: string;
  clfDataset: string;
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
  const raw = await callBackend("getWorkspaceInfo", [workspaceRoot]);
  return raw as WorkspaceInfo;
}

export async function listDatasetFiles(datasetRoot: string) {
  const raw = await callBackend("listDatasetFiles", [datasetRoot]);
  if (typeof raw === "string") {
    return JSON.parse(raw) as string[];
  }
  return raw as string[];
}

export async function readMetadataRows(workspaceRoot: string) {
  const raw = await callBackend("readMetadataRows", [workspaceRoot]);
  return raw as MetadataRowsResponse;
}

export async function upsertMetadataRows(workspaceRoot: string, updates: unknown[]) {
  const raw = await callBackend("upsertMetadataRows", [workspaceRoot, JSON.stringify(updates)]);
  return raw as { ok?: boolean; created?: number; updated?: number; error?: string };
}

export async function readFileBase64(root: string, relativePath: string) {
  return (await callBackend("readFileBase64", [root, relativePath])) as string;
}

export async function readTextFile(root: string, relativePath: string) {
  return (await callBackend("readTextFile", [root, relativePath])) as string;
}

export async function writeTextFile(root: string, relativePath: string, text: string) {
  return (await callBackend("writeTextFile", [root, relativePath, text])) as boolean | string;
}

export async function readLabelTextsBatch(datasetRoot: string, labelPaths: string[]) {
  const raw = await callBackend("readLabelTextsBatch", [datasetRoot, JSON.stringify(labelPaths)]);
  if (typeof raw === "string") {
    return JSON.parse(raw) as Record<string, string>;
  }
  return raw as Record<string, string>;
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
  const raw = await callBackend("listWorkspaceFiles", [workspaceRoot]);
  const files: string[] = typeof raw === "string" ? JSON.parse(raw) : (raw as string[]);
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
  const raw = await callBackend("startBuildYoloLinks", [workspaceRoot, rebuild, filenamesJson]);
  if (typeof raw === "string") {
    return JSON.parse(raw) as BuildJobState;
  }
  return raw as BuildJobState;
}

export async function getBuildJob(jobId: string) {
  const raw = await callBackend("getBuildJob", [jobId]);
  if (typeof raw === "string") {
    return JSON.parse(raw) as BuildJobState;
  }
  return raw as BuildJobState;
}

export async function writeWorkspaceSession(workspaceRoot: string, session: Record<string, unknown>) {
  await callBackend("writeWorkspaceSession", [workspaceRoot, JSON.stringify(session)]);
}
