import type { LabelBox } from "../../api";
import {
  timestampKey,
  type VideoAnnotationManifest,
  type VideoTimestampAnnotation,
  type VideoTimestampSource,
  type VideoSource,
  type VideoDetectTask,
  type VideoClfTask,
  type DetectBoxAnnotation,
  type DetectProposal
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

export type VideoTimelineMarkerKind = "detect" | "clf" | "mixed" | "empty" | "reviewed" | "marker";

export type VideoTimelineMarker = {
  key: string;
  timestampMs: number;
  time: number;
  kind: VideoTimelineMarkerKind;
  label: string;
  detectBoxCount: number;
  hasDetect: boolean;
  hasClf: boolean;
};

export function videoTimelineMarkers(manifest: VideoAnnotationManifest | null): VideoTimelineMarker[] {
  return sortedVideoFrames(manifest)
    .map((frame) => {
      const detect = frame.tasks.detect;
      const clf = frame.tasks.clf;
      const detectBoxCount = detect?.boxes.length ?? 0;
      const hasDetect = Boolean(detect && (detectBoxCount > 0 || detect.reviewed || detect.empty));
      const hasClf = Boolean(clf && (clf.classKey || clf.reviewed));
      const hasMarker = Boolean(frame.source);
      if (!hasDetect && !hasClf && !hasMarker) return null;

      const timestampMs = Number.isFinite(frame.timestampMs)
        ? Math.max(0, Math.round(frame.timestampMs))
        : Math.max(0, Math.round((Number(frame.time) || 0) * 1000));
      const time = timestampMs / 1000;
      const kind: VideoTimelineMarkerKind = hasDetect && hasClf
        ? "mixed"
        : hasClf
          ? "clf"
          : detect?.empty
            ? "empty"
            : detectBoxCount > 0
              ? "detect"
              : hasMarker
                ? "marker"
                : "reviewed";
      const details = [
        formatVideoClock(time),
        hasDetect
          ? detectBoxCount > 0
            ? `${detectBoxCount} box(es)`
            : detect?.empty
              ? "detect empty"
              : "detect reviewed"
          : hasMarker
            ? frame.source?.kind === "random" ? "random marker" : "manual marker"
          : "",
        clf?.classKey ? `clf ${clf.classKey}` : hasClf ? "clf reviewed" : ""
      ].filter(Boolean);

      return {
        key: String(timestampMs),
        timestampMs,
        time,
        kind,
        label: details.join(" | "),
        detectBoxCount,
        hasDetect,
        hasClf
      };
    })
    .filter((marker): marker is VideoTimelineMarker => marker !== null);
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

export function markVideoTimestamp(
  manifest: VideoAnnotationManifest,
  video: VideoSource,
  seconds: number,
  source: VideoTimestampSource = { kind: "manual" },
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
    source,
    tasks: {
      ...(existing?.tasks ?? {}),
      detect: currentDetect
    },
    updatedAt: now
  };
  return { ...manifest, video, updatedAt: now, frames };
}

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
  // Preserve existing proposals — updating boxes must not destroy proposals
  const existingProposals = existing?.tasks.detect?.proposals;
  if (existingProposals && existingProposals.length > 0) {
    detect.proposals = [...existingProposals];
  }

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

export function moveVideoFrameRecord(
  manifest: VideoAnnotationManifest,
  video: VideoSource,
  fromSeconds: number,
  toSeconds: number,
  now = new Date().toISOString()
): VideoAnnotationManifest {
  const fromKey = timestampKey(fromSeconds);
  const toTimestampMs = Number(timestampKey(toSeconds));
  const toKey = String(toTimestampMs);
  if (fromKey === toKey) return manifest;

  const existing = manifest.frames[fromKey];
  if (!existing) {
    throw new Error("No annotation record exists at the source timestamp.");
  }
  if (manifest.frames[toKey]) {
    throw new Error("Target timestamp already has an annotation record.");
  }

  const frames = { ...manifest.frames };
  delete frames[fromKey];
  frames[toKey] = {
    ...existing,
    timestampMs: toTimestampMs,
    time: toTimestampMs / 1000,
    updatedAt: now
  };
  return { ...manifest, video, updatedAt: now, frames };
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

export function setVideoClfReviewed(
  manifest: VideoAnnotationManifest,
  video: VideoSource,
  seconds: number,
  reviewed: boolean,
  now = new Date().toISOString()
): VideoAnnotationManifest {
  const timestampMs = Number(timestampKey(seconds));
  const key = String(timestampMs);
  const frames = { ...manifest.frames };
  const existing = frames[key];
  const currentClf = existing?.tasks.clf ?? { reviewed: false };

  if (!reviewed && !currentClf.classKey) {
    if (!existing) return manifest;
    const { clf: _clf, ...otherTasks } = existing.tasks;
    if (!otherTasks.detect) {
      delete frames[key];
    } else {
      frames[key] = { ...existing, tasks: { ...otherTasks }, updatedAt: now };
    }
    return { ...manifest, video, updatedAt: now, frames };
  }

  frames[key] = {
    ...(existing ?? {}),
    timestampMs,
    time: timestampMs / 1000,
    tasks: {
      ...(existing?.tasks ?? {}),
      clf: { ...currentClf, reviewed }
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

// ---------------------------------------------------------------------------
// Proposal mutations (pure — return new manifests)
// ---------------------------------------------------------------------------

function detectBoxIou(
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number }
): number {
  const ax1 = a.x - a.w / 2, ay1 = a.y - a.h / 2;
  const ax2 = a.x + a.w / 2, ay2 = a.y + a.h / 2;
  const bx1 = b.x - b.w / 2, by1 = b.y - b.h / 2;
  const bx2 = b.x + b.w / 2, by2 = b.y + b.h / 2;
  const ix1 = Math.max(ax1, bx1), iy1 = Math.max(ay1, by1);
  const ix2 = Math.min(ax2, bx2), iy2 = Math.min(ay2, by2);
  if (ix2 <= ix1 || iy2 <= iy1) return 0;
  const inter = (ix2 - ix1) * (iy2 - iy1);
  const union = a.w * a.h + b.w * b.h - inter;
  return union > 0 ? inter / union : 0;
}

/**
 * Add auto-placed accepted boxes from model output.
 *
 * - Does NOT replace existing boxes (preserves manual work).
 * - Skips incoming boxes whose IoU with an existing box exceeds iouThreshold.
 * - Does NOT mark the timestamp as reviewed (user still needs to review).
 * - Preserves existing proposals.
 */
export function addVideoAutoBoxes(
  manifest: VideoAnnotationManifest,
  video: VideoSource,
  seconds: number,
  autoBoxes: DetectBoxAnnotation[],
  iouThreshold = 0.85,
  now = new Date().toISOString()
): VideoAnnotationManifest {
  const timestampMs = Number(timestampKey(seconds));
  const key = String(timestampMs);
  const frames = { ...manifest.frames };
  const existing = frames[key];
  const currentDetect = existing?.tasks.detect ?? { reviewed: false, boxes: [] };

  const dedupedNew = autoBoxes.filter(
    (auto) => !currentDetect.boxes.some((ex) => detectBoxIou(auto, ex) >= iouThreshold)
  );

  const updatedDetect: VideoDetectTask = {
    ...currentDetect,
    boxes: [...currentDetect.boxes, ...dedupedNew]
    // reviewed stays as-is: high-confidence boxes do not auto-review the sample
  };

  frames[key] = {
    ...(existing ?? {}),
    timestampMs,
    time: timestampMs / 1000,
    tasks: { ...(existing?.tasks ?? {}), detect: updatedDetect },
    updatedAt: now
  };
  return { ...manifest, video, updatedAt: now, frames };
}

/**
 * Add medium-confidence proposals from model output.
 *
 * - Does NOT touch boxes[] or reviewed flag.
 * - Skips proposals whose IoU with an existing box or existing proposal
 *   exceeds iouThreshold (avoids duplication against accepted work).
 */
export function addVideoProposals(
  manifest: VideoAnnotationManifest,
  video: VideoSource,
  seconds: number,
  proposals: DetectProposal[],
  iouThreshold = 0.85,
  now = new Date().toISOString()
): VideoAnnotationManifest {
  const timestampMs = Number(timestampKey(seconds));
  const key = String(timestampMs);
  const frames = { ...manifest.frames };
  const existing = frames[key];
  const currentDetect = existing?.tasks.detect ?? { reviewed: false, boxes: [] };
  const existingProposals = currentDetect.proposals ?? [];

  const allExisting = [
    ...currentDetect.boxes,
    ...existingProposals.map((p) => ({ x: p.x, y: p.y, w: p.w, h: p.h }))
  ];

  const newProposals = proposals.filter(
    (prop) => !allExisting.some((ex) => detectBoxIou(prop, ex) >= iouThreshold)
  );

  const updatedDetect: VideoDetectTask = {
    ...currentDetect,
    proposals: [...existingProposals, ...newProposals]
    // boxes and reviewed are left completely untouched
  };

  frames[key] = {
    ...(existing ?? {}),
    timestampMs,
    time: timestampMs / 1000,
    tasks: { ...(existing?.tasks ?? {}), detect: updatedDetect },
    updatedAt: now
  };
  return { ...manifest, video, updatedAt: now, frames };
}

/**
 * Materialize a proposal: move it from proposals[] into boxes[].
 *
 * - The resulting box has origin="manual" (user confirmed it).
 * - Does NOT change the reviewed flag.
 * - No-op if the proposal id is not found.
 */
export function materializeVideoProposal(
  manifest: VideoAnnotationManifest,
  video: VideoSource,
  seconds: number,
  proposalId: string,
  now = new Date().toISOString()
): VideoAnnotationManifest {
  const timestampMs = Number(timestampKey(seconds));
  const key = String(timestampMs);
  const frames = { ...manifest.frames };
  const existing = frames[key];
  if (!existing?.tasks.detect) return manifest;

  const detect = existing.tasks.detect;
  const proposals = detect.proposals ?? [];
  const target = proposals.find((p) => p.id === proposalId);
  if (!target) return manifest;

  const materializedBox: DetectBoxAnnotation = {
    x: target.x, y: target.y, w: target.w, h: target.h,
    origin: "manual"
  };
  if (target.classId !== undefined) materializedBox.classId = target.classId;
  if (target.classKey) materializedBox.classKey = target.classKey;

  const updatedDetect: VideoDetectTask = {
    ...detect,
    boxes: [...detect.boxes, materializedBox],
    proposals: proposals.filter((p) => p.id !== proposalId)
  };
  if (updatedDetect.proposals!.length === 0) delete updatedDetect.proposals;

  frames[key] = {
    ...existing,
    tasks: { ...existing.tasks, detect: updatedDetect },
    updatedAt: now
  };
  return { ...manifest, video, updatedAt: now, frames };
}

/**
 * Reject a proposal: remove it from proposals[] without touching boxes[].
 * No-op if the proposal id is not found.
 */
export function rejectVideoProposal(
  manifest: VideoAnnotationManifest,
  video: VideoSource,
  seconds: number,
  proposalId: string,
  now = new Date().toISOString()
): VideoAnnotationManifest {
  const timestampMs = Number(timestampKey(seconds));
  const key = String(timestampMs);
  const frames = { ...manifest.frames };
  const existing = frames[key];
  if (!existing?.tasks.detect?.proposals) return manifest;

  const detect = existing.tasks.detect;
  const remaining = detect.proposals!.filter((p) => p.id !== proposalId);
  const updatedDetect: VideoDetectTask = {
    ...detect,
    proposals: remaining.length > 0 ? remaining : undefined
  };

  frames[key] = {
    ...existing,
    tasks: { ...existing.tasks, detect: updatedDetect },
    updatedAt: now
  };
  return { ...manifest, video, updatedAt: now, frames };
}

/**
 * Materialize ALL proposals for a timestamp into boxes[].
 * Clears proposals[]. Does not change reviewed flag.
 */
export function acceptAllVideoProposals(
  manifest: VideoAnnotationManifest,
  video: VideoSource,
  seconds: number,
  now = new Date().toISOString()
): VideoAnnotationManifest {
  const timestampMs = Number(timestampKey(seconds));
  const key = String(timestampMs);
  const frames = { ...manifest.frames };
  const existing = frames[key];
  if (!existing?.tasks.detect?.proposals?.length) return manifest;

  const detect = existing.tasks.detect;
  const materializedBoxes: DetectBoxAnnotation[] = detect.proposals!.map((p) => {
    const box: DetectBoxAnnotation = { x: p.x, y: p.y, w: p.w, h: p.h, origin: "manual" };
    if (p.classId !== undefined) box.classId = p.classId;
    if (p.classKey) box.classKey = p.classKey;
    return box;
  });

  const updatedDetect: VideoDetectTask = {
    ...detect,
    boxes: [...detect.boxes, ...materializedBoxes],
    proposals: undefined
  };

  frames[key] = {
    ...existing,
    tasks: { ...existing.tasks, detect: updatedDetect },
    updatedAt: now
  };
  return { ...manifest, video, updatedAt: now, frames };
}
