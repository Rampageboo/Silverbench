/**
 * Edit-session operations (the edits.json document, docs/animocap-engine.md).
 * Each returns a new session; the engine applies it and is the only place any
 * motion maths happens. Rules follow the retired Studio (joint-review.md).
 */
import type { PoseData } from "./mocapApi";
import { imagePoint, sample, worldPoint } from "./mocapDomain";

export type CurvePreset = "linear" | "ease-in" | "ease-out" | "smooth" | "hold";
export type Trust = "locked" | "weighted" | "excluded";

export type DragCorrection = { joint: number; keyframe: number; dragPx: [number, number]; radius?: number; curve?: CurvePreset };

export type ReviewMark = {
  frame: number;
  joint: number;
  trust: Trust;
  weight?: number;
  /** [x, y, z, u, v]; omitted = taken from the corrected pose by the engine. */
  target?: [number, number, number, number, number];
  valid?: boolean;
  confidence?: number;
};

export type EditSession = {
  version: 1;
  corrections: DragCorrection[];
  smoothedKeyframes: number[];
  review: { marks: ReviewMark[]; ranges: [number, number, number][] };
};

export const EMPTY_EDITS: EditSession = { version: 1, corrections: [], smoothedKeyframes: [], review: { marks: [], ranges: [] } };

export const CURVE_LABELS: Record<CurvePreset, string> = {
  smooth: "平滑",
  linear: "线性",
  "ease-in": "缓入",
  "ease-out": "缓出",
  hold: "保持"
};

export function normalizeEdits(value: Partial<EditSession> | null | undefined): EditSession {
  return {
    version: 1,
    corrections: [...(value?.corrections ?? [])],
    smoothedKeyframes: [...(value?.smoothedKeyframes ?? [])],
    review: { marks: [...(value?.review?.marks ?? [])], ranges: [...(value?.review?.ranges ?? [])] }
  };
}

/** The value shown now, as an explicit review target (Studio locks what you see). */
function currentTarget(pose: PoseData, frame: number, joint: number) {
  const [x, y, z] = worldPoint(pose, frame, joint);
  const [u, v] = imagePoint(pose, frame, joint);
  const { confidence, valid } = sample(pose, frame, joint);
  return { target: [x, y, z, u, v] as ReviewMark["target"], valid, confidence };
}

/**
 * A joint dragged on the video at a keyframe. A lock or weight on that joint
 * at that frame follows the drag (its target is re-taken from the corrected pose).
 */
export function addDrag(edits: EditSession, joint: number, keyframe: number, dragPx: [number, number], curve: CurvePreset): EditSession {
  const marks = edits.review.marks.map((mark) =>
    mark.frame === keyframe && mark.joint === joint && mark.trust !== "excluded"
      ? { frame: mark.frame, joint: mark.joint, trust: mark.trust, weight: mark.weight }
      : mark
  );
  return {
    ...edits,
    corrections: [...edits.corrections, { joint, keyframe, dragPx, curve }],
    review: { ...edits.review, marks }
  };
}

export function keyframes(edits: EditSession) {
  return [...new Set(edits.corrections.map((correction) => correction.keyframe))].sort((a, b) => a - b);
}

/** Delete: remove every drag keyed at this frame (and its smoothing). */
export function deleteKeyframe(edits: EditSession, frame: number): EditSession {
  return {
    ...edits,
    corrections: edits.corrections.filter((correction) => correction.keyframe !== frame),
    smoothedKeyframes: edits.smoothedKeyframes.filter((value) => value !== frame)
  };
}

export function setCurveAt(edits: EditSession, frame: number, curve: CurvePreset): EditSession {
  return { ...edits, corrections: edits.corrections.map((c) => (c.keyframe === frame ? { ...c, curve } : c)) };
}

/** Local smoothing around an authored keyframe; the keyframe itself stays exact. */
export function toggleSmoothing(edits: EditSession, frame: number): EditSession {
  if (!edits.corrections.some((c) => c.keyframe === frame)) return edits;
  const has = edits.smoothedKeyframes.includes(frame);
  return {
    ...edits,
    smoothedKeyframes: has ? edits.smoothedKeyframes.filter((value) => value !== frame) : [...edits.smoothedKeyframes, frame].sort((a, b) => a - b)
  };
}

function withoutMarks(marks: ReviewMark[], joint: number, first: number, last: number) {
  return marks.filter((mark) => mark.joint !== joint || mark.frame < first || mark.frame > last);
}

/** 锁定此帧 / 可信权重: keep the current value as an exact (locked) or soft (weighted) target. */
export function trustCurrent(edits: EditSession, pose: PoseData, joint: number, frame: number, trust: "locked" | "weighted", weight = 8): EditSession {
  const mark: ReviewMark = { frame, joint, trust, weight: trust === "weighted" ? weight : 8, ...currentTarget(pose, frame, joint) };
  return { ...edits, review: { ...edits.review, marks: [...withoutMarks(edits.review.marks, joint, frame, frame), mark] } };
}

/** 排除此部位: the joint's observations in [first, last] are ignored by a range rebuild. */
export function exclude(edits: EditSession, joint: number, first: number, last: number): EditSession {
  const added: ReviewMark[] = [];
  for (let frame = first; frame <= last; frame++) added.push({ frame, joint, trust: "excluded" });
  return { ...edits, review: { ...edits.review, marks: [...withoutMarks(edits.review.marks, joint, first, last), ...added] } };
}

/** 重建区间: solve the joint between two locked frames. Overlapping ranges of the joint are replaced. */
export function rebuildRange(edits: EditSession, joint: number, first: number, last: number): EditSession {
  const ranges = edits.review.ranges.filter(([a, b, j]) => j !== joint || b < first || a > last);
  return { ...edits, review: { ...edits.review, ranges: [...ranges, [first, last, joint]] } };
}

/** 恢复自动: drop the joint's marks in [first, last] and any rebuild that lost an endpoint. */
export function restoreAuto(edits: EditSession, joint: number, first: number, last: number): EditSession {
  const marks = withoutMarks(edits.review.marks, joint, first, last);
  const locked = new Set(marks.filter((m) => m.joint === joint && m.trust === "locked").map((m) => m.frame));
  const ranges = edits.review.ranges.filter(([a, b, j]) => j !== joint || (locked.has(a) && locked.has(b)));
  return { ...edits, review: { marks, ranges } };
}

export function marksFor(edits: EditSession, joint: number) {
  return edits.review.marks.filter((mark) => mark.joint === joint).sort((a, b) => a.frame - b.frame);
}

export function rangesFor(edits: EditSession, joint: number) {
  return edits.review.ranges.filter(([, , j]) => j === joint);
}

/** Weighted/excluded marks act only inside a rebuild range of their joint; others are pending. */
export function isPending(edits: EditSession, mark: ReviewMark) {
  if (mark.trust === "locked") return false;
  return !edits.review.ranges.some(([first, last, joint]) => joint === mark.joint && mark.frame >= first && mark.frame <= last);
}
