/**
 * Timestamp-first annotation model — v2 task-layer format.
 *
 * Core principle:
 *   "Video samples are timestamp annotations, not saved screenshots.
 *    Frames are decoded only for preview and export."
 *
 * Each video timestamp can carry two independent task layers:
 *   - tasks.detect — YOLO detection boxes (classKey-based)
 *   - tasks.clf    — YOLO classification label (classKey-based)
 *
 * The same timestamp can have detect-only, clf-only, or both.
 * Neither layer creates an image file. Image files are created only at
 * explicit YOLO dataset export time.
 *
 * Backward compatibility: v1 manifests use numeric LabelBox and a flat
 * `reviewed` flag. `migrateV1FrameToV2` converts these to the v2 task
 * layer, placing all boxes into `tasks.detect`.
 */

import type { LabelBox } from "../../api";
import type { ClassDef } from "./classDomain";
import { classIdToKey } from "./classDomain";

// ---------------------------------------------------------------------------
// V2 types
// ---------------------------------------------------------------------------

export type VideoTimestampDetectBox = {
  classKey: string;
  /** x center, normalized 0–1 */
  x: number;
  /** y center, normalized 0–1 */
  y: number;
  /** width, normalized 0–1 */
  w: number;
  /** height, normalized 0–1 */
  h: number;
};

export type VideoTimestampDetectTask = {
  reviewed: boolean;
  /** False means this timestamp is explicitly excluded from detect export/training. Missing means enabled. */
  enabled?: boolean;
  /** True when annotator explicitly confirmed no objects are present. */
  empty?: boolean;
  boxes: VideoTimestampDetectBox[];
};

export type VideoTimestampClfTask = {
  reviewed: boolean;
  /** False means this timestamp is explicitly excluded from clf export/training. Missing means enabled. */
  enabled?: boolean;
  /** Class key for the image-level classification label. */
  classKey?: string;
};

/**
 * Source metadata recorded when a timestamp is created via random sampling.
 * Stored in the manifest so the annotation record reflects how it was found.
 */
export type VideoTimestampSource = {
  kind: "manual" | "random";
  samplingMode?: "whole-video" | "segments-preferred" | "segments-only";
  segmentId?: string;
};

/**
 * A single timestamp annotation. Identifies the time within the source video
 * and the task-specific annotation data.
 *
 * No image file path is stored here. The frame is identified by
 *   (videoSourceId from the manifest) + timestampMs
 * and decoded on demand from the source video.
 */
export type VideoTimestampAnnotation = {
  timestampMs: number;
  source?: VideoTimestampSource;
  tasks: {
    detect?: VideoTimestampDetectTask;
    clf?: VideoTimestampClfTask;
  };
  updatedAt: string;
};

/**
 * V2 annotation manifest for a single video source.
 *
 * `videoSourceId` matches the `Source.id` in sources.json.
 */
export type VideoAnnotationManifestV2 = {
  version: 2;
  /** Matches Source.id in sources.json. */
  videoSourceId: string;
  createdAt: string;
  updatedAt: string;
  frames: Record<string, VideoTimestampAnnotation>;
};

// ---------------------------------------------------------------------------
// Migration: v1 → v2
// ---------------------------------------------------------------------------

/**
 * Migrate a single v1 frame (numeric boxes + flat reviewed) to the v2
 * task-layer format. All boxes go into tasks.detect.
 *
 * IMPORTANT: This does NOT write any image file. It only restructures the
 * annotation data in memory.
 */
export function migrateV1FrameToV2(
  v1Frame: {
    timestampMs: number;
    boxes: LabelBox[];
    reviewed: boolean;
    updatedAt?: string;
  },
  classDefs: ClassDef[]
): VideoTimestampAnnotation {
  const boxes: VideoTimestampDetectBox[] = v1Frame.boxes.map((box) => ({
    classKey: classIdToKey(box.classId, classDefs),
    x: box.x,
    y: box.y,
    w: box.w,
    h: box.h
  }));
  return {
    timestampMs: v1Frame.timestampMs,
    tasks: {
      detect: {
        reviewed: v1Frame.reviewed,
        empty: v1Frame.reviewed && v1Frame.boxes.length === 0,
        boxes
      }
    },
    updatedAt: v1Frame.updatedAt || new Date().toISOString()
  };
}

// ---------------------------------------------------------------------------
// Domain helpers
// ---------------------------------------------------------------------------

export function isDetectReady(frame: VideoTimestampAnnotation): boolean {
  return Boolean(frame.tasks.detect?.reviewed);
}

export function isClfReady(frame: VideoTimestampAnnotation): boolean {
  return Boolean(frame.tasks.clf?.reviewed && frame.tasks.clf.classKey);
}

export function detectBoxCount(frame: VideoTimestampAnnotation): number {
  return frame.tasks.detect?.boxes.length ?? 0;
}

export function clfClassName(frame: VideoTimestampAnnotation, classDefs: ClassDef[]): string | null {
  const key = frame.tasks.clf?.classKey;
  if (!key) return null;
  return classDefs.find((d) => d.key === key)?.name ?? key;
}

/**
 * Human-readable status line for the detect task of a timestamp.
 */
export function detectStatusLabel(frame: VideoTimestampAnnotation): string {
  const detect = frame.tasks.detect;
  if (!detect) return "pending";
  if (!detect.reviewed) return "pending";
  if (detect.empty || detect.boxes.length === 0) return "empty (reviewed)";
  return `${detect.boxes.length} box(es) (reviewed)`;
}

/**
 * Human-readable status line for the clf task of a timestamp.
 */
export function clfStatusLabel(frame: VideoTimestampAnnotation, classDefs: ClassDef[]): string {
  const clf = frame.tasks.clf;
  if (!clf) return "pending";
  if (!clf.reviewed) return "pending";
  const name = clfClassName(frame, classDefs);
  return name ? `${name} (reviewed)` : "reviewed (no class)";
}

/**
 * Update the detect task of a timestamp, returning a new annotation object.
 * Does not touch the clf layer.
 */
export function updateDetectTask(
  frame: VideoTimestampAnnotation,
  update: Partial<VideoTimestampDetectTask>,
  now = new Date().toISOString()
): VideoTimestampAnnotation {
  return {
    ...frame,
    tasks: {
      ...frame.tasks,
      detect: {
        reviewed: false,
        boxes: [],
        ...frame.tasks.detect,
        ...update
      }
    },
    updatedAt: now
  };
}

/**
 * Update the clf task of a timestamp, returning a new annotation object.
 * Does not touch the detect layer.
 */
export function updateClfTask(
  frame: VideoTimestampAnnotation,
  update: Partial<VideoTimestampClfTask>,
  now = new Date().toISOString()
): VideoTimestampAnnotation {
  return {
    ...frame,
    tasks: {
      ...frame.tasks,
      clf: {
        reviewed: false,
        ...frame.tasks.clf,
        ...update
      }
    },
    updatedAt: now
  };
}

/**
 * Normalize a raw V2 frame record, filtering invalid fields.
 */
export function normalizeV2Frame(raw: unknown): VideoTimestampAnnotation | null {
  if (!raw || typeof raw !== "object") return null;
  const data = raw as Partial<VideoTimestampAnnotation>;
  const timestampMs = Math.max(0, Math.round(Number(data.timestampMs) || 0));
  const detect = data.tasks?.detect;
  const clf = data.tasks?.clf;
  return {
    timestampMs,
    source: data.source ?? undefined,
    tasks: {
      detect: detect
        ? {
            reviewed: Boolean(detect.reviewed),
            empty: Boolean(detect.empty),
            boxes: (detect.boxes || []).filter(isValidBox)
          }
        : undefined,
      clf: clf
        ? {
            reviewed: Boolean(clf.reviewed),
            classKey: typeof clf.classKey === "string" ? clf.classKey : undefined
          }
        : undefined
    },
    updatedAt: typeof data.updatedAt === "string" ? data.updatedAt : new Date().toISOString()
  };
}

function isValidBox(box: unknown): box is VideoTimestampDetectBox {
  if (!box || typeof box !== "object") return false;
  const b = box as Partial<VideoTimestampDetectBox>;
  return typeof b.classKey === "string" && b.w! > 0 && b.h! > 0;
}
