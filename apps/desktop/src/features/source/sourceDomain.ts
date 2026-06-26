/**
 * Source domain — workspace source model.
 *
 * A "source" is a file that the workspace knows about. Sources fall into two
 * types: video and image. Video sources are referenced by path; frames are
 * decoded on demand and are never persisted during normal annotation workflow.
 *
 * Important: there is NO persistent "frame" source type for video-derived
 * timestamps. Normal video-derived samples remain timestamp records that
 * reference a video source + timestampMs. Frames are decoded only for:
 *   1. Preview in the UI (in-memory, not written to disk)
 *   2. Explicit export to a YOLO training dataset
 */

export type SourceFingerprint = {
  /** File size in bytes (used to detect replacement). */
  size?: number;
  /** File mtime as Unix ms (used to detect replacement). */
  mtime?: number;
  /** SHA-256 or similar content hash (optional, expensive). */
  hash?: string;
};

/**
 * A video source. Frames are never stored in the workspace during normal
 * annotation workflow. Annotation records reference this source by `id` plus
 * a `timestampMs`.
 *
 * `storage: "managed"` — file is inside `workspace/media/video/`; the path is
 * workspace-relative and portable.
 *
 * `storage: "linked"` — file is outside the workspace; the path is an absolute
 * OS path that may require relinking if the file moves.
 */
export type VideoSource = {
  id: string;
  type: "video";
  storage: "managed" | "linked";
  /** Workspace-relative for managed; absolute OS path for linked. */
  path: string;
  /** Original absolute path recorded at import time (for managed sources). */
  originalPath?: string;
  fingerprint?: SourceFingerprint;
  addedAt: string;
};

/**
 * A manually imported image source (screenshot, photograph, etc.).
 *
 * Manual images are distinct from video-derived timestamp samples. They may
 * carry both detect and clf task annotation layers, same as a video timestamp,
 * but they are stored as persistent image files rather than decoded on demand.
 *
 * The legacy `image_pool` is treated as imported image source compatibility.
 */
export type ImageSource = {
  id: string;
  type: "image";
  storage: "managed" | "linked";
  path: string;
  originalPath?: string;
  fingerprint?: SourceFingerprint;
  addedAt: string;
};

export type Source = VideoSource | ImageSource;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function isVideoSource(source: Source): source is VideoSource {
  return source.type === "video";
}

export function isImageSource(source: Source): source is ImageSource {
  return source.type === "image";
}

export function isLinkedSource(source: Source): boolean {
  return source.storage === "linked";
}

/**
 * Returns true when a linked source's path is likely missing (i.e. absolute
 * path no longer matches a known file). Callers must pass in current path
 * existence from the OS — this function only checks whether the source *type*
 * requires a relink check.
 */
export function requiresRelinkCheck(source: Source): boolean {
  return source.storage === "linked";
}
