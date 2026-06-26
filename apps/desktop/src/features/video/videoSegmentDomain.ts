/**
 * Video Segment Domain
 *
 * Models time-range segments within a video for random-sampling workflows.
 *
 * Overlap policy: overlapping segments are explicitly allowed. The caller is
 * responsible for deduplication if needed. The union of all enabled segments
 * forms the sampling pool — a frame timestamp qualifies for sampling if it
 * falls within at least one enabled segment's [startMs, endMs) range.
 */

import type { VideoSource } from "./videoAnnotationApi";

export type { VideoSource };

// ---------------------------------------------------------------------------
// Core types
// ---------------------------------------------------------------------------

export type VideoSegment = {
  id: string;
  videoPath: string;
  startMs: number;
  endMs: number;
  label?: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};

export type VideoSegmentManifest = {
  version: 1;
  videoPath: string;
  videoName: string;
  videoDurationMs: number;
  createdAt: string;
  updatedAt: string;
  segments: VideoSegment[];
};

// ---------------------------------------------------------------------------
// Normalization helpers
// ---------------------------------------------------------------------------

function clampMs(value: unknown, lo: number, hi: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return lo;
  return Math.round(Math.max(lo, Math.min(hi, n)));
}

/**
 * Validate and normalize a raw segment object.
 *
 * - startMs and endMs are clamped to [0, videoDurationMs].
 * - Segments with zero or negative duration after clamping are rejected.
 * - id must be a non-empty string.
 * - createdAt and updatedAt must be strings (fall back to epoch string if absent).
 *
 * Returns null if the segment is structurally invalid.
 */
export function normalizeVideoSegment(
  raw: unknown,
  videoDurationMs: number
): VideoSegment | null {
  if (!raw || typeof raw !== "object") return null;
  const src = raw as Record<string, unknown>;

  const id = typeof src.id === "string" ? src.id.trim() : "";
  if (!id) return null;

  const videoPath = typeof src.videoPath === "string" ? src.videoPath : "";

  const hi = Math.max(0, videoDurationMs);
  const startMs = clampMs(src.startMs, 0, hi);
  const endMs = clampMs(src.endMs, 0, hi);

  if (endMs - startMs <= 0) return null;

  const createdAt =
    typeof src.createdAt === "string" && src.createdAt
      ? src.createdAt
      : new Date(0).toISOString();

  const updatedAt =
    typeof src.updatedAt === "string" && src.updatedAt
      ? src.updatedAt
      : new Date(0).toISOString();

  const label =
    typeof src.label === "string" && src.label.trim() ? src.label.trim() : undefined;

  const enabled = typeof src.enabled === "boolean" ? src.enabled : true;

  return { id, videoPath, startMs, endMs, label, enabled, createdAt, updatedAt };
}

/**
 * Validate and normalize a raw manifest object.
 *
 * - version must be exactly 1.
 * - Each segment is individually normalized; invalid segments are dropped silently.
 *
 * Returns null if the top-level structure is invalid.
 */
export function normalizeVideoSegmentManifest(raw: unknown): VideoSegmentManifest | null {
  if (!raw || typeof raw !== "object") return null;
  const src = raw as Record<string, unknown>;

  if (src.version !== 1) return null;

  const videoPath = typeof src.videoPath === "string" ? src.videoPath : "";
  const videoName = typeof src.videoName === "string" ? src.videoName : "";
  const videoDurationMs = Math.max(0, Number(src.videoDurationMs) || 0);

  const createdAt =
    typeof src.createdAt === "string" && src.createdAt
      ? src.createdAt
      : new Date(0).toISOString();

  const updatedAt =
    typeof src.updatedAt === "string" && src.updatedAt
      ? src.updatedAt
      : new Date(0).toISOString();

  const rawSegments = Array.isArray(src.segments) ? src.segments : [];
  const segments: VideoSegment[] = rawSegments
    .map((s) => normalizeVideoSegment(s, videoDurationMs))
    .filter((s): s is VideoSegment => s !== null);

  return {
    version: 1,
    videoPath,
    videoName,
    videoDurationMs,
    createdAt,
    updatedAt,
    segments
  };
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

function generateId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  // Simple fallback for environments without crypto.randomUUID
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Create a new VideoSegment with a generated id and the current timestamp.
 *
 * startMs and endMs are clamped to [0, videoDurationMs]; creation fails
 * (returns a zero-duration segment guard) if the resulting duration is
 * non-positive, so callers should validate the returned segment if needed.
 */
export function createVideoSegment(
  videoPath: string,
  startMs: number,
  endMs: number,
  videoDurationMs: number,
  label?: string
): VideoSegment {
  const hi = Math.max(0, videoDurationMs);
  const clampedStart = Math.round(Math.max(0, Math.min(hi, startMs)));
  const clampedEnd = Math.round(Math.max(0, Math.min(hi, endMs)));
  const now = new Date().toISOString();
  return {
    id: generateId(),
    videoPath,
    startMs: clampedStart,
    endMs: clampedEnd,
    label: label?.trim() || undefined,
    enabled: true,
    createdAt: now,
    updatedAt: now
  };
}

// ---------------------------------------------------------------------------
// Path derivation
// ---------------------------------------------------------------------------

/**
 * Derive a deterministic workspace-relative path for a video's segment manifest.
 *
 * Format: "video_segments/<safe-name>-<8char-hash>.json"
 *
 * safe-name: basename of videoPath with extension stripped, non-alphanumeric
 *   characters replaced with "_", trimmed and truncated to 80 chars.
 *
 * hash: first 8 alphanumeric characters of btoa(encodeURIComponent(videoPath)).
 */
export function videoSegmentManifestPath(videoPath: string): string {
  // Derive basename (handle both / and \ separators)
  const basename = videoPath.replace(/\\/g, "/").split("/").pop() ?? videoPath;
  // Strip extension
  const stem = basename.replace(/\.[^.]+$/, "");
  const safeName = (
    stem.replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 80) || "video"
  );

  const hash = btoa(encodeURIComponent(videoPath))
    .replace(/[^a-zA-Z0-9]/g, "")
    .slice(0, 8);

  return `video_segments/${safeName}-${hash}.json`;
}
