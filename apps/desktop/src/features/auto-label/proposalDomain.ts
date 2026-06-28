/**
 * Proposal domain: pure functions for the assisted auto-label workflow.
 *
 * Core rules:
 *  - boxes[]    = accepted labels (exported after review)
 *  - proposals[] = model suggestions (NEVER exported until materialized)
 *
 * Auto Label generates reviewable annotations: high-confidence predictions
 * become accepted auto boxes, medium-confidence predictions become dashed
 * proposals, and proposals are never exported until materialized.
 */

import type { DetectBoxAnnotation, DetectProposal } from "../video/videoAnnotationApi";

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

export const DEFAULT_HIGH_CONFIDENCE = 0.80;
export const DEFAULT_MEDIUM_CONFIDENCE = 0.40;
export const DEFAULT_DEDUP_IOU_THRESHOLD = 0.85;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RawPrediction = {
  classId?: number;
  classKey?: string;
  x: number;
  y: number;
  w: number;
  h: number;
  confidence: number;
};

export type ProposalThresholdResult = {
  /** High-confidence predictions: placed in boxes[] with origin="auto". */
  accepted: DetectBoxAnnotation[];
  /** Medium-confidence predictions: placed in proposals[]. */
  proposals: DetectProposal[];
  /** Count of predictions below the medium threshold (ignored). */
  ignored: number;
  /** Count of predictions skipped because their class is archived. */
  skippedArchived: number;
  total: number;
};

export type ArchivedDetectClassFilter = {
  archivedClassIds?: ReadonlySet<number>;
  archivedClassKeys?: ReadonlySet<string>;
};

/**
 * A cluster of near-duplicate images grouped by perceptual hash distance.
 * The review queue shows the representative first; members can be expanded.
 */
export type DuplicateCluster = {
  id: string;
  representativeKey: string;
  memberKeys: string[];
  method: "ahash" | "dhash" | "phash";
  threshold: number;
};

export type ReviewQueueEntry = {
  index: number;
  key: string;
  hasProposals: boolean;
  hasAutoBoxes: boolean;
  isEmpty: boolean;
  isReviewed: boolean;
  isJunk: boolean;
};

export type ReviewQueueOptions = {
  /** Skip already-reviewed entries. Default: true. */
  skipReviewed?: boolean;
  /** Skip junk-marked entries. Default: true. */
  skipJunk?: boolean;
};

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

/** IoU between two center-based normalized rects. */
export function predictionIou(
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

// ---------------------------------------------------------------------------
// Threshold classification
// ---------------------------------------------------------------------------

/**
 * Apply high/medium confidence thresholds to raw model predictions.
 *
 * confidence >= highConfidence  → accepted auto box (not yet reviewed)
 * mediumConfidence <= conf < high → proposal (dashed, not exported)
 * confidence < mediumConfidence  → ignored
 */
export function applyDetectThresholds(
  predictions: RawPrediction[],
  highConfidence: number = DEFAULT_HIGH_CONFIDENCE,
  mediumConfidence: number = DEFAULT_MEDIUM_CONFIDENCE,
  now = new Date().toISOString(),
  archivedFilter: ArchivedDetectClassFilter = {}
): ProposalThresholdResult {
  const accepted: DetectBoxAnnotation[] = [];
  const proposals: DetectProposal[] = [];
  let ignored = 0;
  let skippedArchived = 0;

  for (const pred of predictions) {
    if (detectPredictionUsesArchivedClass(pred, archivedFilter)) {
      skippedArchived++;
      continue;
    }
    const { x, y, w, h, confidence } = pred;
    if (confidence >= highConfidence) {
      const box: DetectBoxAnnotation = { x, y, w, h, origin: "auto", confidence };
      if (pred.classId !== undefined) box.classId = pred.classId;
      if (pred.classKey) box.classKey = pred.classKey;
      accepted.push(box);
    } else if (confidence >= mediumConfidence) {
      const proposal: DetectProposal = {
        id: `prop_${Math.random().toString(36).slice(2, 10)}`,
        x, y, w, h,
        confidence,
        createdAt: now
      };
      if (pred.classId !== undefined) proposal.classId = pred.classId;
      if (pred.classKey) proposal.classKey = pred.classKey;
      proposals.push(proposal);
    } else {
      ignored++;
    }
  }

  return { accepted, proposals, ignored, skippedArchived, total: predictions.length };
}

export function detectPredictionUsesArchivedClass(
  prediction: Pick<RawPrediction, "classId" | "classKey">,
  filter: ArchivedDetectClassFilter
): boolean {
  return (
    (prediction.classId !== undefined && filter.archivedClassIds?.has(prediction.classId)) ||
    (Boolean(prediction.classKey) && filter.archivedClassKeys?.has(prediction.classKey!)) ||
    false
  );
}

export function proposalUsesArchivedDetectClass(
  proposal: Pick<DetectProposal, "classId" | "classKey">,
  filter: ArchivedDetectClassFilter
): boolean {
  return detectPredictionUsesArchivedClass(proposal, filter);
}

// ---------------------------------------------------------------------------
// Deduplication
// ---------------------------------------------------------------------------

/**
 * Filter out incoming predictions that overlap with existing boxes above
 * the IoU threshold. Preserves manual work: existing accepted boxes are
 * never removed or replaced.
 *
 * Returns { kept, skipped } — `skipped` is the count of duplicates.
 */
export function dedupPredictions<T extends { x: number; y: number; w: number; h: number }>(
  incoming: T[],
  existing: { x: number; y: number; w: number; h: number }[],
  iouThreshold: number = DEFAULT_DEDUP_IOU_THRESHOLD
): { kept: T[]; skipped: number } {
  const kept: T[] = [];
  let skipped = 0;
  for (const pred of incoming) {
    const isDup = existing.some((ex) => predictionIou(pred, ex) >= iouThreshold);
    if (isDup) {
      skipped++;
    } else {
      kept.push(pred);
    }
  }
  return { kept, skipped };
}

// ---------------------------------------------------------------------------
// Materialization
// ---------------------------------------------------------------------------

/**
 * Convert a proposal into an accepted box. The resulting box has
 * origin="manual" because the user explicitly confirmed it.
 * Does NOT touch the reviewed flag — the user must still review the sample.
 */
export function materializeProposal(proposal: DetectProposal): DetectBoxAnnotation {
  const box: DetectBoxAnnotation = {
    x: proposal.x, y: proposal.y, w: proposal.w, h: proposal.h,
    origin: "manual"
  };
  if (proposal.classId !== undefined) box.classId = proposal.classId;
  if (proposal.classKey) box.classKey = proposal.classKey;
  return box;
}

// ---------------------------------------------------------------------------
// Review queue
// ---------------------------------------------------------------------------

/**
 * Sort score for the review queue. Lower = review sooner.
 * Junk and already-reviewed entries sink to the bottom.
 */
export function reviewQueueScore(entry: ReviewQueueEntry): number {
  if (entry.isJunk) return 10000;
  if (entry.isReviewed) return 9000;
  if (entry.hasProposals) return 0;      // proposals need user decision
  if (entry.hasAutoBoxes) return 1;      // auto boxes need user review
  if (!entry.isEmpty) return 2;          // manual labels, needs review
  return 3;                              // empty, no labels
}

/**
 * Find the next index that needs review (forward search, wraps around).
 * Skips reviewed and junk entries by default.
 * Returns null if every entry has been handled.
 */
export function nextNeedsReviewIndex(
  entries: ReviewQueueEntry[],
  currentIndex: number,
  options: ReviewQueueOptions = {}
): number | null {
  const { skipReviewed = true, skipJunk = true } = options;
  const count = entries.length;
  if (count === 0) return null;
  for (let offset = 1; offset < count; offset++) {
    const idx = (currentIndex + offset) % count;
    const entry = entries[idx];
    if (skipJunk && entry.isJunk) continue;
    if (skipReviewed && entry.isReviewed) continue;
    return idx;
  }
  return null;
}

/**
 * Find the previous index that needs review (backward search, wraps around).
 */
export function prevNeedsReviewIndex(
  entries: ReviewQueueEntry[],
  currentIndex: number,
  options: ReviewQueueOptions = {}
): number | null {
  const { skipReviewed = true, skipJunk = true } = options;
  const count = entries.length;
  if (count === 0) return null;
  for (let offset = 1; offset < count; offset++) {
    const idx = ((currentIndex - offset) + count) % count;
    const entry = entries[idx];
    if (skipJunk && entry.isJunk) continue;
    if (skipReviewed && entry.isReviewed) continue;
    return idx;
  }
  return null;
}
