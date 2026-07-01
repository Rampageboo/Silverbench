/**
 * Video Export Planner
 *
 * Pure planning module — derives export items from a v2 video annotation
 * manifest and a class list. No file I/O or frame decoding happens here.
 *
 * Policy:
 *  - Exported images are derived artifacts only. They do not become workspace
 *    source files and are never written during normal annotation.
 *  - A single timestamp can produce both a detect and a clf export item.
 *  - Missing video source is surfaced as a planning error, not a runtime crash.
 *  - YOLO numeric class ids are derived from the stable classKey order.
 */

import type { LabelClass } from "../../api";
import type { VideoAnnotationManifest, VideoSource } from "./videoAnnotationApi";
import { buildDetectClassKeyIndex, classKeyToClassId, classIdToKey, classNameToSafeKey } from "./videoClassKeys";
import type { BlackoutRectShape } from "../overlays/blackoutOverlayDomain";

// ---------------------------------------------------------------------------
// Output types
// ---------------------------------------------------------------------------

export type YoloBox = {
  classId: number;
  x: number;
  y: number;
  w: number;
  h: number;
};

export type DetectExportItem = {
  task: "detect";
  videoPath: string;
  timestampMs: number;
  imageOutputPath: string;
  labelOutputPath: string;
  yoloBoxes: YoloBox[];
  /** Blackout rects to apply when writing the export image (normalized, center-based). */
  blackouts: BlackoutRectShape[];
};

export type ClfExportItem = {
  task: "clf";
  videoPath: string;
  timestampMs: number;
  imageOutputPath: string;
  classFolder: string;
  classKey: string;
  /** Blackout rects to apply when writing the export image (normalized, center-based). */
  blackouts: BlackoutRectShape[];
};

export type ExportItem = DetectExportItem | ClfExportItem;

export type ExportPlanError = {
  type: "missing-video-source" | "no-export-ready-frames" | "unknown";
  message: string;
  videoPath?: string;
  timestampMs?: number;
};

export type ExportPlanResult = {
  items: ExportItem[];
  errors: ExportPlanError[];
};

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export type ExportPlanOptions = {
  /** Root directory for all exported files. */
  exportRoot: string;
  /** Current workspace class list. */
  classes: LabelClass[];
  /** Include detect export items. Default: true. */
  includeDetect?: boolean;
  /** Include clf export items. Default: true. */
  includeClf?: boolean;
  /**
   * Detect export policy:
   *  - "reviewed": (default) export only timestamps where detect.reviewed === true.
   *  - "has-boxes": export any timestamp that has at least one detect box, reviewed or not.
   *
   * Default: "reviewed". Pass "has-boxes" explicitly to include unreviewed samples.
   * Proposals are NEVER exported regardless of policy.
   */
  detectPolicy?: "has-boxes" | "reviewed";
  /**
   * CLF export policy:
   *  - "reviewed": (default) export only timestamps where clf.reviewed === true.
   *  - "all": export any timestamp that has a classKey set.
   *
   * Default: "reviewed". Pass "all" explicitly to include unreviewed clf labels.
   */
  clfPolicy?: "reviewed" | "all";
  /**
   * Optional resolver for blackout rects to apply during export.
   * Called once per timestamp; returns rects that have applyOnExport=true.
   * If omitted, export items carry an empty blackouts array.
   */
  resolveBlackouts?: (timestampMs: number) => BlackoutRectShape[];
};

// ---------------------------------------------------------------------------
// Path derivation helpers
// ---------------------------------------------------------------------------

function videoStemId(video: VideoSource): string {
  const basename = video.path.replace(/\\/g, "/").split("/").pop() ?? video.name;
  const stem = basename.replace(/\.[^.]+$/, "").replace(/[^a-zA-Z0-9_-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40) || "video";
  // Short stable hash of the path
  let hash = 0x811c9dc5;
  for (let i = 0; i < video.path.length; i++) {
    hash ^= video.path.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `${stem}-${(hash >>> 0).toString(16).slice(0, 6)}`;
}

function frameBasename(stemId: string, timestampMs: number): string {
  return `${stemId}_${String(timestampMs).padStart(10, "0")}`;
}

// ---------------------------------------------------------------------------
// Planning logic
// ---------------------------------------------------------------------------

export function planVideoExport(
  manifest: VideoAnnotationManifest,
  options: ExportPlanOptions
): ExportPlanResult {
  const {
    exportRoot,
    classes,
    includeDetect = true,
    includeClf = true,
    detectPolicy = "reviewed",
    clfPolicy = "reviewed",
    resolveBlackouts
  } = options;

  const items: ExportItem[] = [];
  const errors: ExportPlanError[] = [];

  const video = manifest.video;

  if (!video.path || !video.ok) {
    errors.push({
      type: "missing-video-source",
      message: `Video source is unavailable or missing: "${video.path || "(no path)"}". Re-link the video before exporting.`,
      videoPath: video.path
    });
    return { items, errors };
  }

  const stemId = videoStemId(video);
  // Stable classKey ordering for YOLO detect numeric ids
  const classKeyIndex = buildDetectClassKeyIndex(classes);

  const frameEntries = Object.values(manifest.frames).sort((a, b) => a.timestampMs - b.timestampMs);

  for (const frame of frameEntries) {
    const { timestampMs, tasks } = frame;
    const basename = frameBasename(stemId, timestampMs);
    const blackouts = resolveBlackouts ? resolveBlackouts(timestampMs) : [];

    if (includeDetect && tasks.detect && tasks.detect.enabled !== false) {
      const detect = tasks.detect;
      const isExportReady =
        detectPolicy === "reviewed"
          ? detect.reviewed
          : detect.boxes.length > 0;

      if (isExportReady) {
        const yoloBoxes: YoloBox[] = detect.boxes.map((box) => {
          // Resolve classId: prefer classKey → classId mapping; fallback to stored classId
          let resolvedClassId: number;
          const key = box.classKey ?? (box.classId !== undefined ? classIdToKey(box.classId, classes) : undefined);
          if (key) {
            const idx = classKeyIndex.indexOf(key);
            resolvedClassId = idx >= 0 ? idx : (box.classId ?? 0);
          } else {
            resolvedClassId = box.classId ?? 0;
          }
          return { classId: resolvedClassId, x: box.x, y: box.y, w: box.w, h: box.h };
        });

        items.push({
          task: "detect",
          videoPath: video.path,
          timestampMs,
          imageOutputPath: `${exportRoot}/detect/images/${basename}.jpg`,
          labelOutputPath: `${exportRoot}/detect/labels/${basename}.txt`,
          yoloBoxes,
          blackouts
        });
      }
    }

    if (includeClf && tasks.clf?.enabled !== false && tasks.clf?.classKey) {
      const clfReady = clfPolicy === "reviewed" ? !!tasks.clf.reviewed : true;
      if (clfReady) {
        const classKey = tasks.clf.classKey;
        const classFolder = classNameToSafeKey(classKey);
        items.push({
          task: "clf",
          videoPath: video.path,
          timestampMs,
          imageOutputPath: `${exportRoot}/clf/${classFolder}/${basename}.jpg`,
          classFolder,
          classKey,
          blackouts
        });
      }
    }
  }

  if (items.length === 0) {
    errors.push({
      type: "no-export-ready-frames",
      message: "No export-ready frames found in the manifest.",
      videoPath: video.path
    });
  }

  return { items, errors };
}

/**
 * Resolve a classKey to the YOLO numeric id for a given class list.
 * Returns undefined if the key is not found.
 */
export function resolveDetectClassId(classKey: string, classes: LabelClass[]): number | undefined {
  const index = buildDetectClassKeyIndex(classes);
  const idx = index.indexOf(classKey);
  return idx >= 0 ? idx : classKeyToClassId(classKey, classes);
}
