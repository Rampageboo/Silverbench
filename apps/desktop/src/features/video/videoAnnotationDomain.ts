import type { LabelBox } from "../../api";
import {
  timestampKey,
  type VideoAnnotationManifest,
  type VideoTimestampAnnotation,
  type VideoTimestampSource,
  type VideoSource,
  type VideoDetectTask,
  type VideoClfTask,
  type DetectBoxAnnotation
} from "./videoAnnotationApi";

// ---------------------------------------------------------------------------
// Time helpers
// ---------------------------------------------------------------------------

export function clampVideoTime(value: number, duration: number) {
  const max = duration > 0 ? Math.max(0, duration - 0.001) : 0;
  const number = Number.isFinite(value) ? value : 0;
  return Math.round(Math.max(0, Math.min(max, number)) * 1000) / 1000;
}

export function formatVideoClock(seconds: number) {
  const value = Math.max(0, Number(seconds) || 0);
  const whole = Math.floor(value);
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const secs = whole % 60;
  const millis = Math.round((value - whole) * 1000);
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}.${String(millis).padStart(3, "0")}`;
}

// ---------------------------------------------------------------------------
// Frame accessors
// ---------------------------------------------------------------------------

export function frameAnnotationAt(manifest: VideoAnnotationManifest | null, seconds: number) {
  return manifest?.frames[timestampKey(seconds)] || null;
}

export function sortedVideoFrames(
  manifest: VideoAnnotationManifest | null,
  predicate: (frame: VideoTimestampAnnotation) => boolean = () => true
) {
  return Object.values(manifest?.frames || {})
    .filter(predicate)
    .sort((a, b) => a.timestampMs - b.timestampMs);
}

// ---------------------------------------------------------------------------
// Task accessors
// ---------------------------------------------------------------------------

export function getDetectTask(frame: VideoTimestampAnnotation | null | undefined): VideoDetectTask | undefined {
  return frame?.tasks.detect;
}

export function getClfTask(frame: VideoTimestampAnnotation | null | undefined): VideoClfTask | undefined {
  return frame?.tasks.clf;
}

// ---------------------------------------------------------------------------
// Box conversion helpers (canvas ↔ detect task)
// ---------------------------------------------------------------------------

/** Convert a canvas LabelBox to a DetectBoxAnnotation for storage. */
export function labelBoxToDetectBox(box: LabelBox): DetectBoxAnnotation {
  return { classId: box.classId, x: box.x, y: box.y, w: box.w, h: box.h };
}

/** Convert a stored DetectBoxAnnotation to a LabelBox for the canvas. */
export function detectBoxToLabelBox(box: DetectBoxAnnotation): LabelBox {
  return { classId: box.classId ?? 0, x: box.x, y: box.y, w: box.w, h: box.h };
}

export function detectBoxesToLabelBoxes(boxes: DetectBoxAnnotation[]): LabelBox[] {
  return boxes.map(detectBoxToLabelBox);
}

export function cloneDetectBoxes(boxes: DetectBoxAnnotation[]): DetectBoxAnnotation[] {
  return boxes.map((box) => ({ ...box }));
}

/** @deprecated Use cloneDetectBoxes — kept for existing callers. */
export function cloneBoxes(boxes: DetectBoxAnnotation[]): DetectBoxAnnotation[] {
  return cloneDetectBoxes(boxes);
}

// ---------------------------------------------------------------------------
// Frame navigation
// ---------------------------------------------------------------------------

export function adjacentReviewedFrame(
  frames: VideoTimestampAnnotation[],
  currentTimestampMs: number,
  direction: -1 | 1
) {
  return direction < 0
    ? [...frames].reverse().find((frame) => frame.timestampMs < currentTimestampMs) || null
    : frames.find((frame) => frame.timestampMs > currentTimestampMs) || null;
}

// ---------------------------------------------------------------------------
// Detect task mutations — pure functions that return new manifests
// ---------------------------------------------------------------------------

export function updateVideoDetectBoxes(
  manifest: VideoAnnotationManifest,
  video: VideoSource,
  seconds: number,
  boxes: DetectBoxAnnotation[],
  reviewed = true,
  now = new Date().toISOString()
): VideoAnnotationManifest {
  const timestampMs = Number(timestampKey(seconds));
  const key = String(timestampMs);
  const frames = { ...manifest.frames };
  const existing = frames[key];

  // Detect task is effectively empty when not reviewed and no boxes
  if (!reviewed && boxes.length === 0) {
    if (!existing || !existing.tasks.clf) {
      // No clf task either — remove the whole record
      delete frames[key];
    } else {
      // Preserve clf, remove detect
      const { detect: _detect, ...otherTasks } = existing.tasks;
      frames[key] = { ...existing, tasks: { ...otherTasks }, updatedAt: now };
    }
    return { ...manifest, video, updatedAt: now, frames };
  }

  const detect: VideoDetectTask = {
    boxes: cloneDetectBoxes(boxes),
    reviewed
  };
  if (reviewed && boxes.length === 0) detect.empty = true;

  frames[key] = {
    ...(existing ?? {}),
    timestampMs,
    time: timestampMs / 1000,
    tasks: {
      ...(existing?.tasks ?? {}),
      detect
    },
    updatedAt: now
  };
  return { ...manifest, video, updatedAt: now, frames };
}

export function markVideoDetectReviewed(
  manifest: VideoAnnotationManifest,
  video: VideoSource,
  seconds: number,
  now = new Date().toISOString()
): VideoAnnotationManifest {
  const timestampMs = Number(timestampKey(seconds));
  const key = String(timestampMs);
  const frames = { ...manifest.frames };
  const existing = frames[key];
  const currentDetect = existing?.tasks.detect ?? { boxes: [], reviewed: false };
  frames[key] = {
    ...(existing ?? {}),
    timestampMs,
    time: timestampMs / 1000,
    tasks: {
      ...(existing?.tasks ?? {}),
      detect: { ...currentDetect, reviewed: true }
    },
    updatedAt: now
  };
  return { ...manifest, video, updatedAt: now, frames };
}

export function markVideoDetectEmpty(
  manifest: VideoAnnotationManifest,
  video: VideoSource,
  seconds: number,
  now = new Date().toISOString()
): VideoAnnotationManifest {
  const timestampMs = Number(timestampKey(seconds));
  const key = String(timestampMs);
  const frames = { ...manifest.frames };
  const existing = frames[key];
  frames[key] = {
    ...(existing ?? {}),
    timestampMs,
    time: timestampMs / 1000,
    tasks: {
      ...(existing?.tasks ?? {}),
      detect: { boxes: [], reviewed: true, empty: true }
    },
    updatedAt: now
  };
  return { ...manifest, video, updatedAt: now, frames };
}

export function clearVideoFrameRecord(
  manifest: VideoAnnotationManifest,
  seconds: number,
  now = new Date().toISOString()
): VideoAnnotationManifest {
  const key = timestampKey(seconds);
  const frames = { ...manifest.frames };
  delete frames[key];
  return { ...manifest, updatedAt: now, frames };
}

// ---------------------------------------------------------------------------
// Clf task mutations
// ---------------------------------------------------------------------------

export function setVideoClfClass(
  manifest: VideoAnnotationManifest,
  video: VideoSource,
  seconds: number,
  classKey: string,
  source?: VideoTimestampSource,
  now = new Date().toISOString()
): VideoAnnotationManifest {
  const timestampMs = Number(timestampKey(seconds));
  const key = String(timestampMs);
  const frames = { ...manifest.frames };
  const existing = frames[key];
  const currentClf = existing?.tasks.clf ?? { reviewed: false };
  frames[key] = {
    ...(existing ?? {}),
    timestampMs,
    time: timestampMs / 1000,
    tasks: {
      ...(existing?.tasks ?? {}),
      clf: { ...currentClf, classKey: classKey || undefined }
    },
    updatedAt: now
  };
  if (source && frames[key]) frames[key] = { ...frames[key], source };
  return { ...manifest, video, updatedAt: now, frames };
}

export function markVideoClfReviewed(
  manifest: VideoAnnotationManifest,
  video: VideoSource,
  seconds: number,
  now = new Date().toISOString()
): VideoAnnotationManifest {
  const timestampMs = Number(timestampKey(seconds));
  const key = String(timestampMs);
  const frames = { ...manifest.frames };
  const existing = frames[key];
  const currentClf = existing?.tasks.clf ?? { reviewed: false };
  frames[key] = {
    ...(existing ?? {}),
    timestampMs,
    time: timestampMs / 1000,
    tasks: {
      ...(existing?.tasks ?? {}),
      clf: { ...currentClf, reviewed: true }
    },
    updatedAt: now
  };
  return { ...manifest, video, updatedAt: now, frames };
}

export function clearVideoClfLabel(
  manifest: VideoAnnotationManifest,
  video: VideoSource,
  seconds: number,
  now = new Date().toISOString()
): VideoAnnotationManifest {
  const timestampMs = Number(timestampKey(seconds));
  const key = String(timestampMs);
  const frames = { ...manifest.frames };
  const existing = frames[key];
  if (!existing) return manifest;

  const { clf: _clf, ...otherTasks } = existing.tasks;

  if (!otherTasks.detect) {
    // Nothing left — remove the whole record
    delete frames[key];
  } else {
    frames[key] = { ...existing, tasks: { ...otherTasks }, updatedAt: now };
  }
  return { ...manifest, video, updatedAt: now, frames };
}

// ---------------------------------------------------------------------------
// Legacy adapter — updateVideoFrameAnnotation
// Writes detect task only; preserves existing clf task.
// ---------------------------------------------------------------------------

export function updateVideoFrameAnnotation(
  manifest: VideoAnnotationManifest,
  video: VideoSource,
  seconds: number,
  boxes: DetectBoxAnnotation[],
  reviewed = true,
  now = new Date().toISOString()
): VideoAnnotationManifest {
  return updateVideoDetectBoxes(manifest, video, seconds, boxes, reviewed, now);
}
