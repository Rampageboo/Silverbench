/** Gallery REST contract for Claude's frontend. No UI or workspace dependency. */
import { backendBaseUrl } from "../../lib/backendConfig";

export type JsonObject = Record<string, unknown>;
export type GalleryRoot = { id: string; path: string; source: string; recursive: boolean };
export type GalleryMetadata = {
  format: "a1111" | "comfyui" | "novelai" | "none";
  source: "metadata" | "none";
  positive: string;
  negative: string;
  parameters: JsonObject;
  model: string;
  loras: JsonObject[];
  warnings: string[];
  raw?: JsonObject;
};
export type TagCategory = "quality" | "rating" | "count" | "character" | "copyright" | "artist" | "general";
export type GalleryTag = {
  name: string;
  category: TagCategory;
  probability: number | null;
  source: string;
  selected: boolean;
  probabilities: Record<string, number>;
  categorySources: Record<string, string>;
  metadata: boolean;
};
export type PromptValue = { positive?: string; negative?: string };
export type GalleryUserEdits = {
  noobai?: PromptValue;
  anima?: PromptValue;
  positive?: string;
  negative?: string;
};
export type GalleryPrompt = {
  positive: string;
  negative: string;
  parameters: JsonObject;
  source: string;
  negativeSource: string;
  recommendations: JsonObject;
};
export type ModelTagResult = JsonObject & {
  tags: Array<{ name: string; category: TagCategory; probability: number }>;
};
export type GalleryPrompts = {
  noobai: GalleryPrompt;
  anima: GalleryPrompt;
  tags: GalleryTag[];
  warnings: string[];
  originalMetadata: GalleryMetadata;
  modelTags: Record<string, ModelTagResult>;
};
export type GalleryAsset = {
  id: string;
  path: string;
  filename: string;
  width: number;
  height: number;
  format: string;
  source: string;
  rating: number;
  personalTags: string[];
  notes: string;
  collection: string;
  missing: boolean;
  hasMetadata: boolean;
  contentRating: string | null;
  userEdits: GalleryUserEdits;
  modelTags: Record<string, ModelTagResult>;
  caption: string;
  createdAt: string;
  modifiedAt: string;
  metadata: GalleryMetadata;
};
export type GalleryAssetDetail = GalleryAsset & { prompts: GalleryPrompts };
/** List projection deliberately excludes prompts, notes, scores, edits and large graphs. */
export type GalleryAssetSummary = Omit<
  GalleryAsset,
  "metadata" | "notes" | "userEdits" | "modelTags" | "caption"
> & {
  metadata: Pick<GalleryMetadata, "format" | "source" | "model">;
  personalTagsCount: number;
};
export type GalleryJob = {
  id: string;
  type: "scan" | "wd" | "control";
  rootIds: string[];
  status: "queued" | "running" | "paused" | "completed" | "cancelled" | "failed";
  processed: number;
  createdAt: string;
  modifiedAt: string;
  progress: {
    scanned: number;
    processed: number;
    imported: number;
    skipped: number;
    errors: string[];
    missing?: number;
    currentPath?: string;
    completedRoots?: string[];
    nextIndex?: number;
    total?: number;
  };
};
export type GalleryCapabilities = JsonObject & {
  localLibrary: boolean;
  originalMetadata: boolean;
  backgroundScanning: boolean;
  persistentJobs: boolean;
  fullTextSearch: boolean;
  exactDuplicateRelinking: boolean;
  watcher: boolean;
  semanticSearch: boolean;
  nearDuplicateSearch: boolean;
  artistReferences: boolean;
  dualComputerWorkers: boolean;
  gpuScheduling: boolean;
  comfyuiRoundtrip: boolean;
  available: boolean;
  runtimeVerified: boolean;
  networkTransfers: boolean;
  cpuFallback: boolean;
  adapters: Record<
    string,
    {
      implemented: boolean;
      ready: boolean;
      runtimeVerified: boolean;
      blockers: string[];
      [key: string]: unknown;
    }
  >;
  selectionValidated: boolean;
  selectionBlockers: string[];
  unimplemented: string[];
};
export type GallerySettings = JsonObject & {
  wdModelPath?: string;
  wdTagsPath?: string;
  wdModelId?: string;
  wdProfile?: "wd-v3";
  wdModelSha256?: string;
  wdTagsSha256?: string;
  deviceId?: number;
  pixaiModelPath?: string;
  captionModelPath?: string;
  rules?: JsonObject;
  /** This computer's ComfyUI folder (portable bundle or the ComfyUI folder itself). */
  comfyuiPath?: string;
  /** Queue images without generation metadata for reverse inference after each scan (default on). */
  autoReverse?: boolean;
  /** ComfyUI server that runs the preprocessors: this computer or the other one on the LAN. */
  comfyuiUrl?: string;
  /** Control maps to make for images without metadata. */
  controlKinds?: ControlKind[];
};
export type ControlKind = "pose" | "depth" | "lineart" | "canny";
export const CONTROL_KIND_LABELS: Record<ControlKind, string> = {
  pose: "Pose",
  depth: "Depth",
  lineart: "Lineart",
  canny: "Canny"
};
export type ComfyServerCheck = {
  ok: boolean;
  url?: string;
  version?: string;
  error?: string;
  warning?: string;
  preprocessors: Partial<Record<ControlKind, string | null>>;
};
export type ControlMap = { kind: ControlKind; preprocessor: string; createdAt: string };
export type ComfyUiCheck = {
  ok: boolean;
  configured: boolean;
  error?: string;
  root?: string;
  portable?: boolean;
  inputDir?: string;
  outputDir?: string;
  modelsDir?: string;
};
export type ReferenceImage = { node: string; filename: string; found: boolean; path: string } | null;
export type GalleryBreakdown = {
  format: GalleryMetadata["format"];
  hasMetadata: boolean;
  comfyuiConfigured: boolean;
  workflowAvailable: boolean;
  nodeCount?: number;
  nodeTypes?: Record<string, number>;
  checkpoints?: Array<{ node: string; name: string; loader: string }>;
  vae?: Array<{ node: string; name: string }>;
  loras?: Array<{ node: string; name: string; strength_model?: number; strength_clip?: number }>;
  samplers?: Array<JsonObject & { node: string; type: string }>;
  controlnets?: Array<
    JsonObject & {
      node?: string;
      unit?: number;
      type?: string;
      model: string;
      preprocessor?: string;
      preprocessors?: string[];
      strength?: number;
      weight?: string;
      start_percent?: number;
      end_percent?: number;
      start?: string;
      end?: string;
      image: ReferenceImage;
    }
  >;
  ipadapters?: Array<
    JsonObject & { node: string; type: string; preprocessors: string[]; image: ReferenceImage }
  >;
  upscalers?: Array<{ node: string; name: string }>;
  inputImages?: Array<{ node: string; filename: string; found: boolean; path: string }>;
  adetailer?: Record<string, string>;
  hires?: Record<string, string>;
};
export type ReverseStatus = {
  pending: number;
  queued: number;
  auto: boolean;
  /** WD tagger stage. */
  ready: boolean;
  blockers: string[];
  tags: { pending: number; queued: number };
  controls: {
    enabled: boolean;
    url: string;
    kinds: ControlKind[];
    pending: number;
    queued: number;
    ready: boolean;
    error: string;
    preprocessors: Partial<Record<ControlKind, string | null>>;
  };
};
export type GalleryStatus = {
  total: number;
  roots: GalleryRoot[];
  collections: string[];
  jobs: GalleryJob[];
  capabilities: GalleryCapabilities;
};
export type PromptOptions = {
  mode?: "prompt" | "train";
  trigger?: string;
  outfitTrigger?: string;
  removeTags?: string[];
  corrections?: Record<string, string>;
  generalThreshold?: number;
  characterThreshold?: number;
  captionStyle?: "mixed" | "tags" | "natural";
  trainingKind?: "character" | "style";
  sourceTag?: string;
};
export type AssetQuery = {
  q?: string;
  rootId?: string;
  collection?: string;
  minRating?: number;
  hasMetadata?: boolean;
  needsReverse?: boolean;
  offset?: number;
  limit?: number;
};
export type GalleryPageResult = {
  items: GalleryAssetSummary[];
  total: number;
  offset: number;
  limit: number;
};
export type GallerySummary = {
  count: number;
  tagFrequencies: Array<{ name: string; category: TagCategory; count: number; frequency: number }>;
  sharedTags: string[];
  sharedPrefix: { noobai: string; anima: string };
  warnings: string[];
};
export type GalleryExportRequest = PromptOptions & {
  ids: string[];
  destination: string;
  format: "noobai" | "anima";
  extension?: ".txt" | ".atxt";
  copyImages?: boolean;
  artifact?: "all" | "captions" | "json" | "csv" | "dataset";
};
export type GalleryExportResult = { count: number; destination: string; files: string[]; warnings: string[] };
export type GalleryAssetPatch = Partial<
  Pick<
    GalleryAsset,
    "rating" | "personalTags" | "notes" | "collection" | "userEdits" | "modelTags" | "caption"
  >
>;

/** Caller can distinguish an actionable HTTP error from fetch/abort failures. */
export class GalleryApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly detail: unknown
  ) {
    super(
      typeof detail === "string" ? detail : `Gallery request failed (${status}): ${JSON.stringify(detail)}`
    );
    this.name = "GalleryApiError";
  }
}

export async function galleryRequest<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`${backendBaseUrl()}/api/gallery${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal
  });
  const result: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = result && typeof result === "object" && "detail" in result ? result.detail : result;
    throw new GalleryApiError(response.status, detail ?? response.statusText);
  }
  return result as T;
}

const assetPath = (id: string) => `/assets/${encodeURIComponent(id)}`;
export function galleryImageUrl(id: string, full = false) {
  return `${backendBaseUrl()}/api/gallery${assetPath(id)}/${full ? "image" : "thumbnail"}`;
}
export function galleryControlUrl(id: string, kind: ControlKind, version = "") {
  return `${backendBaseUrl()}/api/gallery${assetPath(id)}/controls/${kind}${version ? `?v=${encodeURIComponent(version)}` : ""}`;
}
/** workflow.json download: drop it into ComfyUI to get the nodes back. */
export function galleryWorkflowUrl(id: string) {
  return `${backendBaseUrl()}/api/gallery${assetPath(id)}/workflow`;
}
/** A ControlNet / IPAdapter / img2img input image found in this computer's ComfyUI input folder. */
export function galleryReferenceUrl(id: string, node: string) {
  return `${backendBaseUrl()}/api/gallery${assetPath(id)}/reference/${encodeURIComponent(node)}`;
}

/** Thin typed calls only. State, selection, polling, drafts and layout belong to the frontend. */
export const galleryApi = {
  status: (signal?: AbortSignal) => galleryRequest<GalleryStatus>("/status", undefined, signal),
  capabilities: (signal?: AbortSignal) =>
    galleryRequest<GalleryCapabilities>("/capabilities", undefined, signal),
  settings: (signal?: AbortSignal) => galleryRequest<GallerySettings>("/settings", undefined, signal),
  saveSettings: (settings: GallerySettings, signal?: AbortSignal) =>
    galleryRequest<GallerySettings>("/settings", settings, signal),
  addRoot: (root: Omit<GalleryRoot, "id">, signal?: AbortSignal) =>
    galleryRequest<GalleryRoot & { job: GalleryJob }>("/roots", root, signal),
  scan: (rootId?: string, signal?: AbortSignal) =>
    galleryRequest<GalleryJob>("/scan", rootId ? { rootId } : {}, signal),
  assets: (query: AssetQuery = {}, signal?: AbortSignal) => {
    const params = new URLSearchParams();
    Object.entries(query).forEach(([key, value]) => {
      if (value !== undefined) params.set(key, String(value));
    });
    return galleryRequest<GalleryPageResult>(`/assets?${params}`, undefined, signal);
  },
  asset: (id: string, signal?: AbortSignal) =>
    galleryRequest<GalleryAssetDetail>(assetPath(id), undefined, signal),
  editAsset: (id: string, patch: GalleryAssetPatch, signal?: AbortSignal) =>
    galleryRequest<GalleryAssetDetail>(assetPath(id), patch, signal),
  preview: (id: string, options: PromptOptions = {}, signal?: AbortSignal) =>
    galleryRequest<GalleryPrompts>(`${assetPath(id)}/preview`, options, signal),
  previewSelected: (ids: string[], options: PromptOptions = {}, signal?: AbortSignal) =>
    galleryRequest<{ items: GalleryAssetDetail[]; count: number }>("/preview", { ids, options }, signal),
  collections: (signal?: AbortSignal) =>
    galleryRequest<{ collections: string[] }>("/collections", undefined, signal),
  addCollection: (name: string, signal?: AbortSignal) =>
    galleryRequest<{ collections: string[] }>("/collections", { name }, signal),
  jobs: (signal?: AbortSignal) => galleryRequest<GalleryJob[]>("/jobs", undefined, signal),
  controlJob: (id: string, action: "pause" | "resume" | "cancel", signal?: AbortSignal) =>
    galleryRequest<GalleryJob>(`/jobs/${encodeURIComponent(id)}/${action}`, {}, signal),
  process: (ids: string[], signal?: AbortSignal) =>
    galleryRequest<GalleryJob>("/process", { ids, model: "wd" }, signal),
  summary: (ids: string[], options: PromptOptions = {}, signal?: AbortSignal) =>
    galleryRequest<GallerySummary>("/summary", { ids, options }, signal),
  export: (request: GalleryExportRequest, signal?: AbortSignal) =>
    galleryRequest<GalleryExportResult>("/export", request, signal),
  breakdown: (id: string, signal?: AbortSignal) =>
    galleryRequest<GalleryBreakdown>(`${assetPath(id)}/breakdown`, undefined, signal),
  workflow: (id: string, signal?: AbortSignal) =>
    galleryRequest<JsonObject>(`${assetPath(id)}/workflow`, undefined, signal),
  checkComfyUi: (path?: string, signal?: AbortSignal) =>
    galleryRequest<ComfyUiCheck>(
      `/comfyui${path === undefined ? "" : `?${new URLSearchParams({ path })}`}`,
      undefined,
      signal
    ),
  reverseStatus: (signal?: AbortSignal) => galleryRequest<ReverseStatus>("/reverse", undefined, signal),
  queueReverse: (signal?: AbortSignal) =>
    galleryRequest<ReverseStatus & { jobs: GalleryJob[]; blocked: string[] }>("/reverse", {}, signal),
  checkComfyServer: (url?: string, signal?: AbortSignal) =>
    galleryRequest<ComfyServerCheck>(
      `/comfyui/server${url === undefined ? "" : `?${new URLSearchParams({ url })}`}`,
      undefined,
      signal
    ),
  queueControls: (ids: string[], kinds?: ControlKind[], signal?: AbortSignal) =>
    galleryRequest<GalleryJob>("/controls", { ids, kinds }, signal),
  controls: (id: string, signal?: AbortSignal) =>
    galleryRequest<ControlMap[]>(`${assetPath(id)}/controls`, undefined, signal),
  controlToComfyUi: (id: string, kind: ControlKind, signal?: AbortSignal) =>
    galleryRequest<{ name: string }>(`${assetPath(id)}/controls/${kind}/to-comfyui`, {}, signal)
};
