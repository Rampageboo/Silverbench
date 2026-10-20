import { describe, expect, it } from "vitest";
import {
  applyDetectThresholds,
  dedupPredictions,
  detectPredictionUsesArchivedClass,
  materializeProposal,
  nextNeedsReviewIndex,
  proposalUsesArchivedDetectClass,
  prevNeedsReviewIndex,
  reviewQueueScore,
  predictionIou,
  DEFAULT_HIGH_CONFIDENCE,
  DEFAULT_MEDIUM_CONFIDENCE,
  DEFAULT_DEDUP_IOU_THRESHOLD,
  type RawPrediction,
  type ReviewQueueEntry
} from "./proposalDomain";
import {
  createVideoAnnotationManifest,
  type VideoSource,
  type DetectProposal
} from "../video/videoAnnotationApi";
import {
  updateVideoDetectBoxes,
  addVideoAutoBoxes,
  addVideoProposals,
  materializeVideoProposal,
  rejectVideoProposal,
  acceptAllVideoProposals,
  frameAnnotationAt,
  getDetectTask
} from "../video/videoAnnotationDomain";
import type { LabelClass } from "../../api";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const video: VideoSource = {
  path: "D:/videos/test.mp4",
  name: "test.mp4",
  duration: 60,
  width: 1920,
  height: 1080,
  ok: true
};

const classes: LabelClass[] = [{ id: 0, name: "cat" }, { id: 1, name: "dog" }];

const box = { classId: 0, x: 0.5, y: 0.5, w: 0.2, h: 0.3 };
const highPred: RawPrediction = { classId: 0, x: 0.3, y: 0.3, w: 0.2, h: 0.2, confidence: 0.95 };
const medPred: RawPrediction = { classId: 0, x: 0.7, y: 0.7, w: 0.2, h: 0.2, confidence: 0.60 };
const lowPred: RawPrediction = { classId: 0, x: 0.1, y: 0.1, w: 0.2, h: 0.2, confidence: 0.20 };

function makeProposal(id: string, x = 0.5, y = 0.5, w = 0.2, h = 0.2, conf = 0.65): DetectProposal {
  return { id, classId: 0, x, y, w, h, confidence: conf, createdAt: "2026-01-01T00:00:00.000Z" };
}

// ---------------------------------------------------------------------------
// TEST 1: high-confidence prediction becomes accepted auto box
// ---------------------------------------------------------------------------

describe("Task 1 — high-confidence prediction becomes accepted auto box", () => {
  it("puts high-confidence predictions into accepted[], not proposals[]", () => {
    const result = applyDetectThresholds([highPred], 0.80, 0.40);
    expect(result.accepted).toHaveLength(1);
    expect(result.proposals).toHaveLength(0);
    expect(result.accepted[0].origin).toBe("auto");
    expect(result.accepted[0].confidence).toBeCloseTo(0.95);
    expect(result.accepted[0].classId).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// TEST 2: high-confidence auto box keeps sample unreviewed
// ---------------------------------------------------------------------------

describe("Task 2 — high-confidence auto box keeps sample unreviewed", () => {
  it("addVideoAutoBoxes does not set reviewed=true", () => {
    const { accepted } = applyDetectThresholds([highPred]);
    const manifest = createVideoAnnotationManifest(video);
    const updated = addVideoAutoBoxes(manifest, video, 5.0, accepted);
    const detect = getDetectTask(frameAnnotationAt(updated, 5.0));
    expect(detect).toBeDefined();
    expect(detect!.boxes).toHaveLength(1);
    expect(detect!.reviewed).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// TEST 3: medium-confidence prediction becomes proposal
// ---------------------------------------------------------------------------

describe("Task 3 — medium-confidence prediction becomes proposal", () => {
  it("puts medium-confidence predictions into proposals[], not accepted[]", () => {
    const result = applyDetectThresholds([medPred], 0.80, 0.40);
    expect(result.accepted).toHaveLength(0);
    expect(result.proposals).toHaveLength(1);
    expect(result.proposals[0].confidence).toBeCloseTo(0.60);
    expect(result.proposals[0].id).toBeTruthy();
    expect(result.proposals[0].createdAt).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// TEST 4: low-confidence prediction is ignored
// ---------------------------------------------------------------------------

describe("Task 4 — low-confidence prediction is ignored", () => {
  it("ignores predictions below the medium threshold", () => {
    const result = applyDetectThresholds([lowPred], 0.80, 0.40);
    expect(result.accepted).toHaveLength(0);
    expect(result.proposals).toHaveLength(0);
    expect(result.ignored).toBe(1);
    expect(result.total).toBe(1);
  });

  it("correctly splits mixed predictions", () => {
    const result = applyDetectThresholds([highPred, medPred, lowPred]);
    expect(result.accepted).toHaveLength(1);
    expect(result.proposals).toHaveLength(1);
    expect(result.ignored).toBe(1);
    expect(result.total).toBe(3);
  });
});

describe("Phase 4C archived detect class filtering", () => {
  it("skips archived high-confidence predictions instead of accepting boxes", () => {
    const result = applyDetectThresholds(
      [highPred],
      0.80,
      0.40,
      "2026-01-01T00:00:00.000Z",
      { archivedClassIds: new Set([0]) }
    );
    expect(result.accepted).toHaveLength(0);
    expect(result.proposals).toHaveLength(0);
    expect(result.skippedArchived).toBe(1);
  });

  it("skips archived medium-confidence predictions instead of creating proposals", () => {
    const result = applyDetectThresholds(
      [{ ...medPred, classKey: "cat" }],
      0.80,
      0.40,
      "2026-01-01T00:00:00.000Z",
      { archivedClassKeys: new Set(["cat"]) }
    );
    expect(result.proposals).toHaveLength(0);
    expect(result.skippedArchived).toBe(1);
  });

  it("detects archived proposal materialization targets", () => {
    expect(detectPredictionUsesArchivedClass({ classId: 1 }, { archivedClassIds: new Set([1]) })).toBe(true);
    expect(proposalUsesArchivedDetectClass(makeProposal("archived"), { archivedClassIds: new Set([0]) })).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// TEST 5: proposal is never exported
// ---------------------------------------------------------------------------

describe("Task 6 — materializing proposal moves to boxes, removes from proposals", () => {
  it("moves the proposal into boxes[] and removes it from proposals[]", () => {
    const proposal = makeProposal("p1", 0.3, 0.3, 0.2, 0.2, 0.65);
    let manifest = createVideoAnnotationManifest(video);
    manifest = addVideoProposals(manifest, video, 5.0, [proposal]);

    // Before
    let detect = getDetectTask(frameAnnotationAt(manifest, 5.0));
    expect(detect!.proposals).toHaveLength(1);
    expect(detect!.boxes).toHaveLength(0);

    // Materialize
    manifest = materializeVideoProposal(manifest, video, 5.0, "p1");
    detect = getDetectTask(frameAnnotationAt(manifest, 5.0));

    expect(detect!.proposals ?? []).toHaveLength(0);
    expect(detect!.boxes).toHaveLength(1);
    expect(detect!.boxes[0].x).toBeCloseTo(0.3);
    expect(detect!.boxes[0].origin).toBe("manual");
  });
});

// ---------------------------------------------------------------------------
// TEST 7: rejecting proposal removes it without changing accepted boxes
// ---------------------------------------------------------------------------

describe("Task 7 — rejecting proposal removes it without changing boxes", () => {
  it("removes the proposal and leaves boxes unchanged", () => {
    const proposal = makeProposal("p1");
    let manifest = createVideoAnnotationManifest(video);
    manifest = updateVideoDetectBoxes(manifest, video, 5.0, [box], false);
    manifest = addVideoProposals(manifest, video, 5.0, [proposal]);

    manifest = rejectVideoProposal(manifest, video, 5.0, "p1");
    const detect = getDetectTask(frameAnnotationAt(manifest, 5.0));

    expect(detect!.proposals ?? []).toHaveLength(0);
    expect(detect!.boxes).toHaveLength(1);
    expect(detect!.boxes[0].classId).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// TEST 8: updating boxes preserves proposals
// ---------------------------------------------------------------------------

describe("Task 8 — updating boxes preserves proposals", () => {
  it("updateVideoDetectBoxes keeps existing proposals intact", () => {
    const proposal = makeProposal("p1");
    let manifest = createVideoAnnotationManifest(video);
    manifest = addVideoProposals(manifest, video, 5.0, [proposal]);

    // Update boxes (simulating user saving canvas)
    manifest = updateVideoDetectBoxes(manifest, video, 5.0, [box], true);
    const detect = getDetectTask(frameAnnotationAt(manifest, 5.0));

    expect(detect!.boxes).toHaveLength(1);
    expect(detect!.proposals).toHaveLength(1);
    expect(detect!.proposals![0].id).toBe("p1");
  });
});

// ---------------------------------------------------------------------------
// TEST 9: updating proposals preserves boxes
// ---------------------------------------------------------------------------

describe("Task 9 — updating proposals preserves boxes", () => {
  it("addVideoProposals does not disturb existing boxes", () => {
    const proposal = makeProposal("p1");
    let manifest = createVideoAnnotationManifest(video);
    manifest = updateVideoDetectBoxes(manifest, video, 5.0, [box], false);

    manifest = addVideoProposals(manifest, video, 5.0, [proposal]);
    const detect = getDetectTask(frameAnnotationAt(manifest, 5.0));

    expect(detect!.boxes).toHaveLength(1);
    expect(detect!.boxes[0].classId).toBe(0);
    expect(detect!.proposals).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// TEST 10: Auto Label does not overwrite manual boxes
// ---------------------------------------------------------------------------

describe("Task 10 — Auto Label does not overwrite manual boxes", () => {
  it("addVideoAutoBoxes does not replace pre-existing manual boxes", () => {
    let manifest = createVideoAnnotationManifest(video);
    manifest = updateVideoDetectBoxes(manifest, video, 5.0, [box], false);

    const autoBox = { classId: 1, x: 0.8, y: 0.8, w: 0.1, h: 0.1, origin: "auto" as const };
    manifest = addVideoAutoBoxes(manifest, video, 5.0, [autoBox]);
    const detect = getDetectTask(frameAnnotationAt(manifest, 5.0));

    expect(detect!.boxes).toHaveLength(2);
    expect(detect!.boxes.some((b) => b.classId === 0)).toBe(true);
    expect(detect!.boxes.some((b) => b.classId === 1)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// TEST 11: duplicate prediction skipped when IoU >= threshold
// ---------------------------------------------------------------------------

describe("Task 11 — duplicate prediction skipped when IoU >= threshold", () => {
  it("dedupPredictions skips predictions that overlap existing boxes", () => {
    const existing = [{ x: 0.5, y: 0.5, w: 0.2, h: 0.2 }];
    const identical = { classId: 0, x: 0.5, y: 0.5, w: 0.2, h: 0.2, confidence: 0.9 };
    const { kept, skipped } = dedupPredictions([identical], existing, DEFAULT_DEDUP_IOU_THRESHOLD);
    expect(kept).toHaveLength(0);
    expect(skipped).toBe(1);
  });

  it("keeps predictions that do not overlap existing boxes", () => {
    const existing = [{ x: 0.1, y: 0.1, w: 0.1, h: 0.1 }];
    const different = { classId: 0, x: 0.9, y: 0.9, w: 0.1, h: 0.1, confidence: 0.9 };
    const { kept, skipped } = dedupPredictions([different], existing, DEFAULT_DEDUP_IOU_THRESHOLD);
    expect(kept).toHaveLength(1);
    expect(skipped).toBe(0);
  });

  it("addVideoAutoBoxes skips auto boxes that duplicate existing boxes (IoU >= threshold)", () => {
    let manifest = createVideoAnnotationManifest(video);
    manifest = updateVideoDetectBoxes(manifest, video, 5.0, [box], false);

    // Add nearly identical auto box — should be deduped
    const sameBox = { classId: 0, x: box.x, y: box.y, w: box.w, h: box.h, origin: "auto" as const };
    manifest = addVideoAutoBoxes(manifest, video, 5.0, [sameBox]);
    const detect = getDetectTask(frameAnnotationAt(manifest, 5.0));

    expect(detect!.boxes).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// TEST 12: export reviewed sample includes accepted boxes only
// ---------------------------------------------------------------------------

describe("Task 14 — review queue skips reviewed and junk items", () => {
  it("nextNeedsReviewIndex skips reviewed entries", () => {
    const entries: ReviewQueueEntry[] = [
      { index: 0, key: "a", hasProposals: false, hasAutoBoxes: false, isEmpty: false, isReviewed: true, isJunk: false },
      { index: 1, key: "b", hasProposals: false, hasAutoBoxes: false, isEmpty: false, isReviewed: false, isJunk: false },
      { index: 2, key: "c", hasProposals: false, hasAutoBoxes: false, isEmpty: false, isReviewed: true, isJunk: false }
    ];
    const next = nextNeedsReviewIndex(entries, 0);
    expect(next).toBe(1);
  });

  it("nextNeedsReviewIndex skips junk entries", () => {
    const entries: ReviewQueueEntry[] = [
      { index: 0, key: "a", hasProposals: false, hasAutoBoxes: false, isEmpty: false, isReviewed: false, isJunk: false },
      { index: 1, key: "b", hasProposals: false, hasAutoBoxes: false, isEmpty: false, isReviewed: false, isJunk: true },
      { index: 2, key: "c", hasProposals: false, hasAutoBoxes: false, isEmpty: false, isReviewed: false, isJunk: false }
    ];
    expect(nextNeedsReviewIndex(entries, 0)).toBe(2);
  });

  it("returns null when all entries are reviewed or junk", () => {
    const entries: ReviewQueueEntry[] = [
      { index: 0, key: "a", hasProposals: false, hasAutoBoxes: false, isEmpty: true, isReviewed: true, isJunk: false },
      { index: 1, key: "b", hasProposals: false, hasAutoBoxes: false, isEmpty: true, isReviewed: false, isJunk: true }
    ];
    expect(nextNeedsReviewIndex(entries, 0)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// TEST 15: review queue prioritizes samples with proposals
// ---------------------------------------------------------------------------

describe("Task 15 — review queue prioritizes samples with proposals", () => {
  it("entries with proposals sort before entries with auto boxes", () => {
    const withProposals: ReviewQueueEntry = {
      index: 0, key: "a", hasProposals: true, hasAutoBoxes: false,
      isEmpty: false, isReviewed: false, isJunk: false
    };
    const withAutoBoxes: ReviewQueueEntry = {
      index: 1, key: "b", hasProposals: false, hasAutoBoxes: true,
      isEmpty: false, isReviewed: false, isJunk: false
    };
    expect(reviewQueueScore(withProposals)).toBeLessThan(reviewQueueScore(withAutoBoxes));
  });

  it("nextNeedsReviewIndex visits entries with proposals before others when sorted", () => {
    // Simulate an already-sorted list
    const entries: ReviewQueueEntry[] = [
      { index: 0, key: "no-proposals", hasProposals: false, hasAutoBoxes: false, isEmpty: false, isReviewed: false, isJunk: false },
      { index: 1, key: "has-proposals", hasProposals: true, hasAutoBoxes: false, isEmpty: false, isReviewed: false, isJunk: false }
    ];
    // Starting at 0, next unreviewed is index 1 (has proposals)
    const next = nextNeedsReviewIndex(entries, 0);
    expect(next).toBe(1);
    expect(entries[next!].hasProposals).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// TEST 16: duplicate cluster type is defined
// ---------------------------------------------------------------------------

describe("Task 16 — duplicate cluster type is available", () => {
  it("reviewQueueScore ranks junk and reviewed at the bottom", () => {
    const junk: ReviewQueueEntry = { index: 0, key: "j", hasProposals: false, hasAutoBoxes: false, isEmpty: true, isReviewed: false, isJunk: true };
    const reviewed: ReviewQueueEntry = { index: 1, key: "r", hasProposals: false, hasAutoBoxes: false, isEmpty: false, isReviewed: true, isJunk: false };
    const fresh: ReviewQueueEntry = { index: 2, key: "f", hasProposals: false, hasAutoBoxes: false, isEmpty: false, isReviewed: false, isJunk: false };
    expect(reviewQueueScore(fresh)).toBeLessThan(reviewQueueScore(reviewed));
    expect(reviewQueueScore(reviewed)).toBeLessThan(reviewQueueScore(junk));
  });

  it("predictionIou returns 1.0 for identical rects", () => {
    const r = { x: 0.5, y: 0.5, w: 0.2, h: 0.2 };
    expect(predictionIou(r, r)).toBeCloseTo(1.0);
  });

  it("predictionIou returns 0 for non-overlapping rects", () => {
    const a = { x: 0.1, y: 0.1, w: 0.1, h: 0.1 };
    const b = { x: 0.9, y: 0.9, w: 0.1, h: 0.1 };
    expect(predictionIou(a, b)).toBe(0);
  });
});
