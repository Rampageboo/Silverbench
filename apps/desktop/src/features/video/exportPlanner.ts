/**
 * Export planner — pure functions that map timestamp annotations to YOLO
 * training dataset output paths.
 *
 * Core principle:
 *   Export is the ONLY point at which frames are decoded to disk.
 *   These functions produce an export plan (paths + label content) without
 *   touching the filesystem. The caller is responsible for:
 *     1. Checking that the source video file exists.
 *     2. Decoding each frame at plan.timestampMs from the source video.
 *     3. Writing the decoded image to plan.outputImagePath.
 *     4. Writing plan.labelLines to plan.outputLabelPath (detect only).
 *
 * If the source video is missing, the caller must fail clearly with:
 *   "Missing video source — relink required before export."
 *
 * Exported images are derived artifacts. They can be deleted and regenerated
 * from the source video at any time. They are NOT added to sources.json.
 */

import type { ClassDef } from "./classDomain";
import { classKeyToClfFolder, classKeyToDetectId } from "./classDomain";
import type { VideoTimestampAnnotation } from "./videoAnnotationTaskDomain";

// ---------------------------------------------------------------------------
// Plan types
// ---------------------------------------------------------------------------

export type ExportSampleDetect = {
  task: "detect";
  videoSourceId: string;
  timestampMs: number;
  /** Absolute or workspace-relative output path for the decoded JPEG. */
  outputImagePath: string;
  /** Absolute or workspace-relative output path for the YOLO label txt. */
  outputLabelPath: string;
  /**
   * YOLO detect label lines in format:
   *   `class_id x_center y_center width height`
   * Values are normalized 0–1. One line per box.
   */
  labelLines: string[];
};

export type ExportSampleClf = {
  task: "clf";
  videoSourceId: string;
  timestampMs: number;
  classKey: string;
  /** The class folder name (safe filesystem slug). */
  outputFolder: string;
  /** Full path to the output JPEG inside the class folder. */
  outputImagePath: string;
};

export type ExportSample = ExportSampleDetect | ExportSampleClf;

export type ExportError = {
  type: "missing-source" | "invalid-class" | "internal";
  message: string;
};

export type ExportPlan = {
  videoSourceId: string;
  /** All planned output items. Empty if videoSource is missing. */
  samples: ExportSample[];
  /** Set if the source video cannot be located. Export must be aborted. */
  error?: ExportError;
};

// ---------------------------------------------------------------------------
// Detect export planning
// ---------------------------------------------------------------------------

/**
 * Build detect export plan for all reviewed detect-task frames.
 *
 * @param videoSourceId — source identifier (used to build unique sample names)
 * @param frames        — timestamp annotations from the v2 manifest
 * @param classDefs     — workspace class definitions (for key → id mapping)
 * @param detectClassKeys — ordered list of class keys that defines YOLO id order
 * @param outputBase    — base directory, e.g. "exports/detect_dataset"
 *
 * Output structure:
 *   <outputBase>/images/train/<stem>.jpg
 *   <outputBase>/labels/train/<stem>.txt
 */
export function planDetectExports(
  videoSourceId: string,
  frames: Record<string, VideoTimestampAnnotation>,
  classDefs: ClassDef[],
  detectClassKeys: string[],
  outputBase: string
): ExportSampleDetect[] {
  const samples: ExportSampleDetect[] = [];
  for (const frame of Object.values(frames)) {
    const detect = frame.tasks?.detect;
    if (!detect?.reviewed || detect.enabled === false) continue;
    const stem = sampleStem(videoSourceId, frame.timestampMs);
    const outputImagePath = `${outputBase}/images/train/${stem}.jpg`;
    const outputLabelPath = `${outputBase}/labels/train/${stem}.txt`;
    const labelLines = (detect.boxes || []).map((box) => {
      const classId = classKeyToDetectId(box.classKey, detectClassKeys);
      return `${classId} ${fmt(box.x)} ${fmt(box.y)} ${fmt(box.w)} ${fmt(box.h)}`;
    });
    samples.push({
      task: "detect",
      videoSourceId,
      timestampMs: frame.timestampMs,
      outputImagePath,
      outputLabelPath,
      labelLines
    });
  }
  return samples;
}

// ---------------------------------------------------------------------------
// Clf export planning
// ---------------------------------------------------------------------------

/**
 * Build clf export plan for all reviewed clf-task frames.
 *
 * @param videoSourceId — source identifier
 * @param frames        — timestamp annotations from the v2 manifest
 * @param classDefs     — workspace class definitions (for key → folder mapping)
 * @param outputBase    — base directory, e.g. "exports/clf_dataset"
 *
 * Output structure:
 *   <outputBase>/train/<class_name>/<stem>.jpg
 */
export function planClfExports(
  videoSourceId: string,
  frames: Record<string, VideoTimestampAnnotation>,
  classDefs: ClassDef[],
  outputBase: string
): ExportSampleClf[] {
  const samples: ExportSampleClf[] = [];
  for (const frame of Object.values(frames)) {
    const clf = frame.tasks?.clf;
    if (!clf?.reviewed || clf.enabled === false || !clf.classKey) continue;
    const folderName = classKeyToClfFolder(clf.classKey, classDefs);
    const stem = sampleStem(videoSourceId, frame.timestampMs);
    const outputFolder = `${outputBase}/train/${folderName}`;
    const outputImagePath = `${outputFolder}/${stem}.jpg`;
    samples.push({
      task: "clf",
      videoSourceId,
      timestampMs: frame.timestampMs,
      classKey: clf.classKey,
      outputFolder,
      outputImagePath
    });
  }
  return samples;
}

// ---------------------------------------------------------------------------
// Combined plan
// ---------------------------------------------------------------------------

/**
 * Build a full export plan for a video source, covering both detect and clf
 * tasks in a single pass.
 *
 * If `videoSourceExists` is false, the plan is returned with an error and an
 * empty sample list. The caller must not attempt to decode frames.
 *
 * The same timestamp may appear in both detect and clf samples. This is
 * intentional: the frame is decoded once per output task. The duplication is
 * acceptable because export is an explicit one-time action.
 */
export function buildExportPlan(opts: {
  videoSourceId: string;
  videoSourceExists: boolean;
  frames: Record<string, VideoTimestampAnnotation>;
  classDefs: ClassDef[];
  detectClassKeys: string[];
  detectOutputBase: string;
  clfOutputBase: string;
}): ExportPlan {
  const {
    videoSourceId,
    videoSourceExists,
    frames,
    classDefs,
    detectClassKeys,
    detectOutputBase,
    clfOutputBase
  } = opts;

  if (!videoSourceExists) {
    return {
      videoSourceId,
      samples: [],
      error: {
        type: "missing-source",
        message: "Missing video source — relink required before export."
      }
    };
  }

  const detectSamples = planDetectExports(
    videoSourceId,
    frames,
    classDefs,
    detectClassKeys,
    detectOutputBase
  );
  const clfSamples = planClfExports(videoSourceId, frames, classDefs, clfOutputBase);

  return {
    videoSourceId,
    samples: [...detectSamples, ...clfSamples]
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sampleStem(videoSourceId: string, timestampMs: number): string {
  const safeId = videoSourceId.replace(/[^a-zA-Z0-9_-]/g, "_");
  return `${safeId}_${timestampMs}`;
}

function fmt(value: number): string {
  return value.toFixed(6);
}
