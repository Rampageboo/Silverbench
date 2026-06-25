import { readTextFile, writeTextFile, type LabelBox } from "../../api";
import { chooseVideoFiles, getVideoFrameBase64, type VideoItem } from "./videoCaptureApi";

export const DEFAULT_VIDEO_ANNOTATIONS_ROOT = "workspace/video_annotations";

export type VideoSource = Pick<VideoItem, "path" | "name" | "duration" | "width" | "height"> & {
  ok?: boolean;
};

export type VideoFrameAnnotation = {
  timestampMs: number;
  time: number;
  boxes: LabelBox[];
  reviewed: boolean;
  updatedAt: string;
};

export type VideoAnnotationManifest = {
  version: 1;
  video: VideoSource;
  createdAt: string;
  updatedAt: string;
  frames: Record<string, VideoFrameAnnotation>;
};

function clamp01(value: unknown) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(1, number));
}

function normalizeBox(value: unknown): LabelBox | null {
  if (!value || typeof value !== "object") return null;
  const box = value as Partial<LabelBox>;
  const w = clamp01(box.w);
  const h = clamp01(box.h);
  if (w <= 0 || h <= 0) return null;
  const x = Math.max(w / 2, Math.min(1 - w / 2, clamp01(box.x)));
  const y = Math.max(h / 2, Math.min(1 - h / 2, clamp01(box.y)));
  return {
    classId: Math.max(0, Math.trunc(Number(box.classId) || 0)),
    x,
    y,
    w,
    h
  };
}

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

export function createVideoAnnotationManifest(video: VideoSource): VideoAnnotationManifest {
  const now = new Date().toISOString();
  return {
    version: 1,
    video,
    createdAt: now,
    updatedAt: now,
    frames: {}
  };
}

export function normalizeVideoAnnotationManifest(value: unknown, video: VideoSource): VideoAnnotationManifest {
  if (!value || typeof value !== "object") throw new Error("Video annotation manifest is not an object.");
  const data = value as Partial<VideoAnnotationManifest>;
  if (data.version !== 1) throw new Error(`Unsupported video annotation manifest version: ${String(data.version)}`);
  const frames: Record<string, VideoFrameAnnotation> = {};
  for (const [rawKey, rawFrame] of Object.entries(data.frames || {})) {
    if (!rawFrame || typeof rawFrame !== "object") continue;
    const source = rawFrame as Partial<VideoFrameAnnotation>;
    const timestampMs = Math.max(0, Math.round(Number(source.timestampMs ?? rawKey) || 0));
    const boxes = Array.isArray(source.boxes)
      ? source.boxes.map(normalizeBox).filter((box): box is LabelBox => box !== null)
      : [];
    frames[String(timestampMs)] = {
      timestampMs,
      time: timestampMs / 1000,
      boxes,
      reviewed: Boolean(source.reviewed || boxes.length),
      updatedAt: typeof source.updatedAt === "string" ? source.updatedAt : new Date().toISOString()
    };
  }
  return {
    version: 1,
    video,
    createdAt: typeof data.createdAt === "string" ? data.createdAt : new Date().toISOString(),
    updatedAt: typeof data.updatedAt === "string" ? data.updatedAt : new Date().toISOString(),
    frames
  };
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
  const next = { ...manifest, updatedAt: new Date().toISOString() };
  await writeTextFile(workspaceRoot, videoManifestRelativePath(next.video, annotationsRoot), `${JSON.stringify(next, null, 2)}\n`);
  return next;
}
