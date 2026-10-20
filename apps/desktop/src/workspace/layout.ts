/**
 * Where everything lives inside a workspace (format v3). Mirrors
 * backend/workspace_layout.py RELATIVE_PATHS; tests/test_layout_parity.py keeps
 * the two in step.
 *
 *   rwb.json, classes.json          identity and the class taxonomy
 *   media/                          source images and videos (never rewritten)
 *   labels/                         annotations — the only source of truth
 *   models/ runs/ exports/          products: weights, training runs, datasets
 *   backups/originals/ versions/    originals before edits, annotation snapshots
 *   .rwb/                           this machine's session and caches (safe to delete)
 *
 * Annotation files are named after the media file they belong to, never after
 * a hash of an absolute path, so a workspace can move between drives.
 */
export const WORKSPACE_PATHS = {
  manifest: "rwb.json",
  classes: "classes.json",
  media: "media",
  imageLabels: "labels/images",
  imageStatus: "labels/images.csv",
  videoLabels: "labels/videos",
  segments: "labels/segments",
  proposals: "labels/proposals",
  overlays: "labels/overlays",
  autolabelRuns: "labels/autolabel-runs.json",
  models: "models",
  modelRegistry: "models/registry.json",
  runs: "runs",
  exports: "exports",
  originals: "backups/originals",
  versions: "versions",
  state: ".rwb",
  session: ".rwb/session.json",
  cache: ".rwb/cache",
  thumbs: ".rwb/cache/thumbs",
  videoProxy: ".rwb/cache/video-proxy",
  frames: ".rwb/cache/frames",
  scanCache: ".rwb/cache/scan.json",
  logs: ".rwb/logs"
} as const;

export type WorkspacePathKey = keyof typeof WORKSPACE_PATHS;

export function fileName(path: string): string {
  return path.replace(/\\/g, "/").split("/").pop() || path;
}

export function fileStem(path: string): string {
  return fileName(path).replace(/\.[^.]+$/, "");
}

/** `media/<name>` for a media file name or path. */
export function mediaPath(nameOrPath: string): string {
  return `${WORKSPACE_PATHS.media}/${fileName(nameOrPath)}`;
}

/** YOLO label of a media image: `labels/images/<stem>.txt`. */
export function imageLabelPath(imageNameOrPath: string): string {
  return `${WORKSPACE_PATHS.imageLabels}/${fileStem(imageNameOrPath)}.txt`;
}

/** Box annotations of a media video: `labels/videos/<video file name>.json`. */
export function videoLabelPath(videoNameOrPath: string): string {
  return `${WORKSPACE_PATHS.videoLabels}/${fileName(videoNameOrPath)}.json`;
}

/** Classification segments of a media video: `labels/segments/<video file name>.json`. */
export function segmentLabelPath(videoNameOrPath: string): string {
  return `${WORKSPACE_PATHS.segments}/${fileName(videoNameOrPath)}.json`;
}

/** Pending model proposals for a media image: `labels/proposals/<image file name>.json`. */
export function proposalPath(imageNameOrPath: string): string {
  return `${WORKSPACE_PATHS.proposals}/${fileName(imageNameOrPath)}.json`;
}

/** Blackout overlays of a media file: `labels/overlays/<file name>.json`. */
export function overlayPath(mediaNameOrPath: string): string {
  return `${WORKSPACE_PATHS.overlays}/${fileName(mediaNameOrPath)}.json`;
}

/** Workspace-relative form of a path inside the workspace (videos are stored this way). */
export function workspaceRelative(workspaceRoot: string, path: string): string {
  const root = workspaceRoot.replace(/\\/g, "/").replace(/\/+$/, "");
  const normalized = path.replace(/\\/g, "/");
  if (normalized.toLowerCase().startsWith(`${root.toLowerCase()}/`)) return normalized.slice(root.length + 1);
  return normalized;
}

/** Absolute path for a workspace-relative path (absolute paths pass through). */
export function workspaceAbsolute(workspaceRoot: string, path: string): string {
  if (/^[A-Za-z]:[\\/]/.test(path) || path.startsWith("\\\\") || path.startsWith("/")) return path;
  const separator = workspaceRoot.includes("\\") ? "\\" : "/";
  return `${workspaceRoot.replace(/[\\/]+$/, "")}${separator}${path.replace(/[\\/]+/g, separator)}`;
}

export function sameWorkspacePath(a: string, b: string): boolean {
  const normalize = (value: string) => value.trim().replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
  return normalize(a) === normalize(b);
}

export function workspaceDisplayName(path: string): string {
  return path.replace(/[/\\]+$/, "").split(/[/\\]/).at(-1) || path;
}
