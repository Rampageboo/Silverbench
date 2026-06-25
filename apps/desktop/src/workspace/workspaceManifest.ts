import { readTextFile, writeTextFile } from "../api";

export const WORKSPACE_MANIFEST_VERSION = 2 as const;
export const WORKSPACE_MANIFEST_PATH = "workspace/workspace.json";
const LEGACY_WORKSPACE_MANIFEST_PATH = "workspace.json";

export type WorkspaceManifestPaths = {
  image_pool: string;
  detect_labels: string;
  metadata: string;
  detect_dataset: string;
  clf_dataset: string;
  video_annotations: string;
  exports: string;
  cache: string;
  logs: string;
  [key: string]: unknown;
};

export type WorkspaceManifest = {
  version: typeof WORKSPACE_MANIFEST_VERSION;
  type: "yolo-workbench";
  name: string;
  createdAt: string;
  updatedAt: string;
  paths: WorkspaceManifestPaths;
  tools: Record<string, unknown> & {
    videoLabel: {
      enabled: boolean;
      primary: boolean;
      persistence: "timestamp-manifest";
      saveExtractedFrames: false;
    };
    imageLabel: {
      enabled: boolean;
      secondary: boolean;
    };
  };
  [key: string]: unknown;
};

export type WorkspaceManifestLoadResult = {
  manifest: WorkspaceManifest;
  migrated: boolean;
  sourcePath: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function nonEmptyString(value: unknown, fallback: string) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function workspaceNameFromPath(workspaceRoot: string) {
  const parts = workspaceRoot.replace(/[\\/]+$/, "").split(/[\\/]/);
  return parts.at(-1) || "YoloWorkBench Workspace";
}

function defaultPaths(): WorkspaceManifestPaths {
  return {
    image_pool: "image_pool",
    detect_labels: "detect_labels",
    metadata: "metadata.csv",
    detect_dataset: "detect_dataset",
    clf_dataset: "clf_dataset",
    video_annotations: "workspace/video_annotations",
    exports: "exports",
    cache: ".cache",
    logs: "workspace/logs"
  };
}

function defaultTools() {
  return {
    videoLabel: {
      enabled: true,
      primary: true,
      persistence: "timestamp-manifest" as const,
      saveExtractedFrames: false as const
    },
    imageLabel: {
      enabled: true,
      secondary: true
    },
    imagePool: { enabled: true, secondary: true },
    datasetPrep: { enabled: true },
    autoLabel: { enabled: true },
    crop: { enabled: true },
    maskCleanup: { enabled: true },
    merge: { enabled: true }
  };
}

function manifestNeedsMigration(source: Record<string, unknown>) {
  const paths = isRecord(source.paths) ? source.paths : {};
  const tools = isRecord(source.tools) ? source.tools : {};
  const videoLabel = isRecord(tools.videoLabel) ? tools.videoLabel : {};
  const imageLabel = isRecord(tools.imageLabel) ? tools.imageLabel : {};
  const requiredPathKeys = Object.keys(defaultPaths());
  return (
    source.version !== WORKSPACE_MANIFEST_VERSION ||
    source.type !== "yolo-workbench" ||
    typeof source.createdAt !== "string" ||
    typeof source.updatedAt !== "string" ||
    requiredPathKeys.some((key) => typeof paths[key] !== "string" || !String(paths[key]).trim()) ||
    videoLabel.enabled !== true ||
    videoLabel.primary !== true ||
    videoLabel.persistence !== "timestamp-manifest" ||
    videoLabel.saveExtractedFrames !== false ||
    imageLabel.enabled !== true ||
    imageLabel.secondary !== true
  );
}

export function normalizeWorkspaceManifest(
  value: unknown,
  workspaceRoot: string,
  now = new Date().toISOString()
): { manifest: WorkspaceManifest; migrated: boolean } {
  const source = isRecord(value) ? value : {};
  const migrated = manifestNeedsMigration(source);
  const sourcePaths = isRecord(source.paths) ? source.paths : {};
  const sourceTools = isRecord(source.tools) ? source.tools : {};
  const sourceVideoLabel = isRecord(sourceTools.videoLabel) ? sourceTools.videoLabel : {};
  const sourceImageLabel = isRecord(sourceTools.imageLabel) ? sourceTools.imageLabel : {};
  const paths = { ...defaultPaths(), ...sourcePaths } as WorkspaceManifestPaths;
  const toolDefaults = defaultTools();
  const tools = {
    ...toolDefaults,
    ...sourceTools,
    videoLabel: {
      ...toolDefaults.videoLabel,
      ...sourceVideoLabel,
      enabled: true,
      primary: true,
      persistence: "timestamp-manifest" as const,
      saveExtractedFrames: false as const
    },
    imageLabel: {
      ...toolDefaults.imageLabel,
      ...sourceImageLabel,
      enabled: true,
      secondary: true
    }
  };
  const createdAt = nonEmptyString(source.createdAt, now);
  const updatedAt = migrated ? now : nonEmptyString(source.updatedAt, createdAt);
  const manifest: WorkspaceManifest = {
    ...source,
    version: WORKSPACE_MANIFEST_VERSION,
    type: "yolo-workbench",
    name: nonEmptyString(source.name, workspaceNameFromPath(workspaceRoot)),
    createdAt,
    updatedAt,
    paths,
    tools
  } as WorkspaceManifest;
  return { manifest, migrated };
}

async function readManifestCandidate(workspaceRoot: string, relativePath: string) {
  try {
    const text = await readTextFile(workspaceRoot, relativePath);
    if (!text.trim()) return null;
    const parsed = JSON.parse(text) as unknown;
    return { parsed, relativePath };
  } catch {
    return null;
  }
}

export async function loadWorkspaceManifest(workspaceRoot: string): Promise<WorkspaceManifestLoadResult> {
  const current = await readManifestCandidate(workspaceRoot, WORKSPACE_MANIFEST_PATH);
  const legacy = current || (await readManifestCandidate(workspaceRoot, LEGACY_WORKSPACE_MANIFEST_PATH));
  if (!legacy) {
    throw new Error("Workspace manifest is missing or invalid.");
  }
  const normalized = normalizeWorkspaceManifest(legacy.parsed, workspaceRoot);
  return {
    manifest: normalized.manifest,
    migrated: normalized.migrated || legacy.relativePath !== WORKSPACE_MANIFEST_PATH,
    sourcePath: legacy.relativePath
  };
}

export async function ensureWorkspaceManifest(workspaceRoot: string): Promise<WorkspaceManifestLoadResult> {
  const result = await loadWorkspaceManifest(workspaceRoot);
  if (result.migrated) {
    await writeTextFile(workspaceRoot, WORKSPACE_MANIFEST_PATH, `${JSON.stringify(result.manifest, null, 2)}\n`);
  }
  return result;
}
