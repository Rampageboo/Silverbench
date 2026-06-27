import { readTextFile, writeTextFile } from "../../api";
import { chooseVideoFiles, getVideoFrameBase64, type VideoItem } from "./videoCaptureApi";

export const DEFAULT_VIDEO_ANNOTATIONS_ROOT = "workspace/video_annotations";

// ---------------------------------------------------------------------------
// Shared source types
// ---------------------------------------------------------------------------

export type VideoSource = Pick<VideoItem, "path" | "name" | "duration" | "width" | "height"> & {
  ok?: boolean;
};

export type SamplingMode = "whole-video" | "segments-preferred" | "segments-only";

export type VideoTimestampSource = {
  kind: "manual" | "random";
  samplingMode?: SamplingMode;
  segmentId?: string;
};

// ---------------------------------------------------------------------------
// Task-layer annotation types (v2)
// ---------------------------------------------------------------------------

export type DetectBoxAnnotation = {
  classKey?: string;
  classId?: number;
  x: number;
  y: number;
  w: number;
  h: number;
};

export type VideoDetectTask = {
  reviewed: boolean;
  empty?: boolean;
  boxes: DetectBoxAnnotation[];
};

export type VideoClfTask = {
  reviewed: boolean;
  classKey?: string;
};

export type VideoTimestampAnnotation = {
  timestampMs: number;
  time: number;
  source?: VideoTimestampSource;
  tasks: {
    detect?: VideoDetectTask;
    clf?: VideoClfTask;
  };
  updatedAt: string;
};

export type VideoAnnotationManifest = {
  version: 2;
  video: VideoSource;
  createdAt: string;
  updatedAt: string;
  frames: Record<string, VideoTimestampAnnotation>;
};

// ---------------------------------------------------------------------------
// Normalization helpers
// ---------------------------------------------------------------------------

function clamp01(value: unknown) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(1, number));
}

function normalizeDetectBox(value: unknown): DetectBoxAnnotation | null {
  if (!value || typeof value !== "object") return null;
  const box = value as Record<string, unknown>;
  const w = clamp01(box.w);
  const h = clamp01(box.h);
  if (w <= 0 || h <= 0) return null;
  const x = Math.max(w / 2, Math.min(1 - w / 2, clamp01(box.x)));
  const y = Math.max(h / 2, Math.min(1 - h / 2, clamp01(box.y)));
  const result: DetectBoxAnnotation = { x, y, w, h };
  if (typeof box.classId === "number") result.classId = Math.max(0, Math.trunc(box.classId));
  if (typeof box.classKey === "string" && box.classKey.trim()) result.classKey = box.classKey.trim();
  return result;
}

function normalizeDetectTask(value: unknown): VideoDetectTask | undefined {
  if (!value || typeof value !== "object") return undefined;
  const src = value as Record<string, unknown>;
  const boxes = Array.isArray(src.boxes)
    ? src.boxes.map(normalizeDetectBox).filter((b): b is DetectBoxAnnotation => b !== null)
    : [];
  const reviewed = Boolean(src.reviewed ?? boxes.length > 0);
  const empty = Boolean(src.empty);
  const task: VideoDetectTask = { reviewed, boxes };
  if (empty) task.empty = true;
  return task;
}

function normalizeClfTask(value: unknown): VideoClfTask | undefined {
  if (!value || typeof value !== "object") return undefined;
  const src = value as Record<string, unknown>;
  const classKey = typeof src.classKey === "string" ? src.classKey.trim() : undefined;
  return { reviewed: Boolean(src.reviewed), classKey: classKey || undefined };
}

// ---------------------------------------------------------------------------
// V1 → V2 migration
// ---------------------------------------------------------------------------

type FrameV1 = {
  timestampMs?: unknown;
  time?: unknown;
  boxes?: unknown;
  reviewed?: unknown;
  updatedAt?: unknown;
};

function migrateV1Frame(rawKey: string, rawFrame: FrameV1): VideoTimestampAnnotation {
  const timestampMs = Math.max(0, Math.round(Number(rawFrame.timestampMs ?? rawKey) || 0));
  const boxes = Array.isArray(rawFrame.boxes)
    ? rawFrame.boxes.map(normalizeDetectBox).filter((b): b is DetectBoxAnnotation => b !== null)
    : [];
  const oldReviewed = Boolean(rawFrame.reviewed ?? boxes.length > 0);
  const detect: VideoDetectTask = {
    boxes,
    reviewed: oldReviewed || boxes.length > 0,
    empty: oldReviewed && boxes.length === 0 ? true : undefined
  };
  if (!detect.empty) delete detect.empty;
  return {
    timestampMs,
    time: timestampMs / 1000,
    tasks: { detect },
    updatedAt: typeof rawFrame.updatedAt === "string" ? rawFrame.updatedAt : new Date().toISOString()
  };
}

function normalizeV1Manifest(
  data: Record<string, unknown>,
  video: VideoSource
): VideoAnnotationManifest {
  const frames: Record<string, VideoTimestampAnnotation> = {};
  const rawFrames = data.frames && typeof data.frames === "object" ? data.frames as Record<string, unknown> : {};
  for (const [rawKey, rawFrame] of Object.entries(rawFrames)) {
    if (!rawFrame || typeof rawFrame !== "object") continue;
    const annotated = migrateV1Frame(rawKey, rawFrame as FrameV1);
    frames[String(annotated.timestampMs)] = annotated;
  }
  return {
    version: 2,
    video,
    createdAt: typeof data.createdAt === "string" ? data.createdAt : new Date().toISOString(),
    updatedAt: typeof data.updatedAt === "string" ? data.updatedAt : new Date().toISOString(),
    frames
  };
}

function normalizeV2Manifest(
  data: Record<string, unknown>,
  video: VideoSource
): VideoAnnotationManifest {
  const frames: Record<string, VideoTimestampAnnotation> = {};
  const rawFrames = data.frames && typeof data.frames === "object" ? data.frames as Record<string, unknown> : {};
  for (const [rawKey, rawFrame] of Object.entries(rawFrames)) {
    if (!rawFrame || typeof rawFrame !== "object") continue;
    const src = rawFrame as Record<string, unknown>;
    const timestampMs = Math.max(0, Math.round(Number(src.timestampMs ?? rawKey) || 0));
    const rawTasks = src.tasks && typeof src.tasks === "object" ? src.tasks as Record<string, unknown> : {};
    const detect = normalizeDetectTask(rawTasks.detect);
    const clf = normalizeClfTask(rawTasks.clf);
    const source = src.source && typeof src.source === "object" ? src.source as VideoTimestampSource : undefined;
    const updatedAt = typeof src.updatedAt === "string" ? src.updatedAt : new Date().toISOString();
    const annotation: VideoTimestampAnnotation = {
      timestampMs,
      time: timestampMs / 1000,
      tasks: {},
      updatedAt
    };
    if (detect) annotation.tasks.detect = detect;
    if (clf) annotation.tasks.clf = clf;
    if (source) annotation.source = source;
    frames[String(timestampMs)] = annotation;
  }
  return {
    version: 2,
    video,
    createdAt: typeof data.createdAt === "string" ? data.createdAt : new Date().toISOString(),
    updatedAt: typeof data.updatedAt === "string" ? data.updatedAt : new Date().toISOString(),
    frames
  };
}

// ---------------------------------------------------------------------------
// Path utilities
// ---------------------------------------------------------------------------

function hashPath(value: string) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function safeStem(name: string) {
  return (
    String(name || "video")
      .replace(/\.[^.]+$/, "")
      .replace(/[^a-zA-Z0-9_-]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 80) || "video"
  );
}

export function normalizeVideoAnnotationsRoot(value: unknown) {
  const raw = String(value || DEFAULT_VIDEO_ANNOTATIONS_ROOT).trim().replace(/\\/g, "/");
  if (raw.startsWith("/") || raw.startsWith("//") || /^[a-zA-Z]:\//.test(raw)) {
    throw new Error("Video annotation storage path must be workspace-relative.");
  }
  const text = raw.replace(/^\/+|\/+$/g, "");
  const parts = text.split("/").filter(Boolean);
  if (!parts.length || parts.some((part) => part === "." || part === ".." || part.includes(":"))) {
    throw new Error("Video annotation storage path must stay inside the workspace.");
  }
  return parts.join("/");
}

export function timestampKey(seconds: number) {
  return String(Math.max(0, Math.round((Number(seconds) || 0) * 1000)));
}

export function videoManifestRelativePath(video: VideoSource, annotationsRoot = DEFAULT_VIDEO_ANNOTATIONS_ROOT) {
  const root = normalizeVideoAnnotationsRoot(annotationsRoot);
  return `${root}/${safeStem(video.name)}-${hashPath(video.path)}.json`;
}

export function normalizeVideoSource(item: VideoItem): VideoSource {
  return {
    ok: item.ok,
    path: String(item.path || ""),
    name: String(item.name || "video"),
    duration: Math.max(0, Number(item.duration) || 0),
    width: Math.max(0, Math.trunc(Number(item.width) || 0)),
    height: Math.max(0, Math.trunc(Number(item.height) || 0))
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function createVideoAnnotationManifest(video: VideoSource): VideoAnnotationManifest {
  const now = new Date().toISOString();
  return {
    version: 2,
    video,
    createdAt: now,
    updatedAt: now,
    frames: {}
  };
}

export function normalizeVideoAnnotationManifest(value: unknown, video: VideoSource): VideoAnnotationManifest {
  if (!value || typeof value !== "object") throw new Error("Video annotation manifest is not an object.");
  const data = value as Record<string, unknown>;
  const version = Number(data.version);
  if (version === 1) return normalizeV1Manifest(data, video);
  if (version === 2) return normalizeV2Manifest(data, video);
  throw new Error(`Unsupported video annotation manifest version: ${String(data.version)}`);
}

export async function chooseAnnotationVideos() {
  const selected = await chooseVideoFiles();
  return selected.filter((item) => item.ok !== false && item.path).map(normalizeVideoSource);
}

export function getAnnotationFrameBase64(videoPath: string, seconds: number) {
  return getVideoFrameBase64(videoPath, seconds, "jpg");
}

export async function loadVideoAnnotationManifest(
  workspaceRoot: string,
  video: VideoSource,
  annotationsRoot = DEFAULT_VIDEO_ANNOTATIONS_ROOT
) {
  const relativePath = videoManifestRelativePath(video, annotationsRoot);
  let text: string;
  try {
    text = await readTextFile(workspaceRoot, relativePath);
  } catch {
    return createVideoAnnotationManifest(video);
  }
  if (!text.trim()) return createVideoAnnotationManifest(video);
  try {
    return normalizeVideoAnnotationManifest(JSON.parse(text), video);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Cannot read ${relativePath}: ${message}`);
  }
}

export async function saveVideoAnnotationManifest(
  workspaceRoot: string,
  manifest: VideoAnnotationManifest,
  annotationsRoot = DEFAULT_VIDEO_ANNOTATIONS_ROOT
) {
  const next: VideoAnnotationManifest = { ...manifest, updatedAt: new Date().toISOString() };
  await writeTextFile(workspaceRoot, videoManifestRelativePath(next.video, annotationsRoot), `${JSON.stringify(next, null, 2)}\n`);
  return next;
}
