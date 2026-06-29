import { describe, expect, it } from "vitest";
import {
  createVideoAnnotationManifest,
  timestampKey,
  type VideoSource
} from "./videoAnnotationApi";
import {
  adjacentReviewedFrame,
  clampVideoTime,
  clearVideoFrameRecord,
  clearVideoClfLabel,
  frameAnnotationAt,
  getDetectTask,
  getClfTask,
  markVideoDetectEmpty,
  markVideoClfReviewed,
  moveVideoFrameRecord,
  setVideoClfClass,
  sortedVideoFrames,
  updateVideoDetectBoxes,
  updateVideoFrameAnnotation,
  videoTimelineMarkers,
  detectBoxesToLabelBoxes,
  labelBoxToDetectBox
} from "./videoAnnotationDomain";

const video: VideoSource = {
  path: "C:/video/source.mp4",
  name: "source.mp4",
  duration: 10,
  width: 1920,
  height: 1080
};

const box = { classId: 2, x: 0.5, y: 0.5, w: 0.2, h: 0.3 };

describe("clampVideoTime", () => {
  it("clamps negative values to 0", () => {
    expect(clampVideoTime(-2, 10)).toBe(0);
  });

  it("rounds to 3 decimal places", () => {
    expect(clampVideoTime(2.34567, 10)).toBe(2.346);
  });

  it("clamps to just below duration", () => {
    expect(clampVideoTime(12, 10)).toBe(9.999);
  });
});

// ---------------------------------------------------------------------------
// Task 3 — detect task helpers
// ---------------------------------------------------------------------------

describe("detect task helpers", () => {
  it("updateVideoDetectBoxes writes to tasks.detect only", () => {
    const source = createVideoAnnotationManifest(video);
    const annotated = updateVideoDetectBoxes(source, video, 1.234, [box], true, "2026-01-01T00:00:00Z");

    const frame = frameAnnotationAt(annotated, 1.234);
    expect(frame).not.toBeNull();
    expect(getDetectTask(frame)?.boxes).toHaveLength(1);
    expect(getDetectTask(frame)?.reviewed).toBe(true);
    expect(getClfTask(frame)).toBeUndefined();
    expect(Object.keys(annotated.frames)).toEqual(["1234"]);
  });

  it("clearing detect boxes removes the record when no clf task exists", () => {
    let manifest = createVideoAnnotationManifest(video);
    manifest = updateVideoDetectBoxes(manifest, video, 1.234, [box], true, "2026-01-01T00:00:00Z");
    const cleared = updateVideoDetectBoxes(manifest, video, 1.234, [], false, "2026-01-01T00:00:01Z");
    expect(frameAnnotationAt(cleared, 1.234)).toBeNull();
  });

  it("clearing detect boxes preserves clf task on the same timestamp", () => {
    let manifest = createVideoAnnotationManifest(video);
    manifest = updateVideoDetectBoxes(manifest, video, 2.0, [box], true);
    manifest = setVideoClfClass(manifest, video, 2.0, "dog");
    // Now clear detect
    const next = updateVideoDetectBoxes(manifest, video, 2.0, [], false);
    const frame = frameAnnotationAt(next, 2.0);
    expect(frame).not.toBeNull();
    expect(frame?.tasks.detect).toBeUndefined();
    expect(getClfTask(frame)?.classKey).toBe("dog");
  });

  it("markVideoDetectEmpty marks detect as empty+reviewed", () => {
    let manifest = createVideoAnnotationManifest(video);
    manifest = updateVideoDetectBoxes(manifest, video, 1.0, [box], true);
    manifest = markVideoDetectEmpty(manifest, video, 1.0);
    const detect = getDetectTask(frameAnnotationAt(manifest, 1.0));
    expect(detect?.reviewed).toBe(true);
    expect(detect?.empty).toBe(true);
    expect(detect?.boxes).toHaveLength(0);
  });

  it("markVideoDetectEmpty does NOT affect clf task", () => {
    let manifest = createVideoAnnotationManifest(video);
    manifest = setVideoClfClass(manifest, video, 1.0, "cat");
    manifest = markVideoDetectEmpty(manifest, video, 1.0);
    const clf = getClfTask(frameAnnotationAt(manifest, 1.0));
    expect(clf?.classKey).toBe("cat");
    // clf.reviewed remains unchanged
    expect(clf?.reviewed).toBe(false);
  });

  it("clearVideoFrameRecord removes both tasks", () => {
    let manifest = createVideoAnnotationManifest(video);
    manifest = updateVideoDetectBoxes(manifest, video, 3.0, [box], true);
    manifest = setVideoClfClass(manifest, video, 3.0, "person");
    const next = clearVideoFrameRecord(manifest, 3.0);
    expect(frameAnnotationAt(next, 3.0)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Task 3 — clf task helpers
// ---------------------------------------------------------------------------

describe("clf task helpers", () => {
  it("setVideoClfClass writes to tasks.clf only — does not affect detect", () => {
    let manifest = createVideoAnnotationManifest(video);
    manifest = updateVideoDetectBoxes(manifest, video, 1.0, [box], true);
    manifest = setVideoClfClass(manifest, video, 1.0, "cat");
    const frame = frameAnnotationAt(manifest, 1.0);
    expect(getClfTask(frame)?.classKey).toBe("cat");
    expect(getDetectTask(frame)?.boxes).toHaveLength(1);
  });

  it("markVideoClfReviewed sets clf.reviewed = true — does not affect detect", () => {
    let manifest = createVideoAnnotationManifest(video);
    manifest = updateVideoDetectBoxes(manifest, video, 1.0, [box], false);
    manifest = setVideoClfClass(manifest, video, 1.0, "cat");
    manifest = markVideoClfReviewed(manifest, video, 1.0);
    expect(getClfTask(frameAnnotationAt(manifest, 1.0))?.reviewed).toBe(true);
    expect(getDetectTask(frameAnnotationAt(manifest, 1.0))?.reviewed).toBe(false);
  });

  it("clearVideoClfLabel removes only clf task — preserves detect", () => {
    let manifest = createVideoAnnotationManifest(video);
    manifest = updateVideoDetectBoxes(manifest, video, 1.0, [box], true);
    manifest = setVideoClfClass(manifest, video, 1.0, "cat");
    manifest = clearVideoClfLabel(manifest, video, 1.0);
    const frame = frameAnnotationAt(manifest, 1.0);
    expect(frame).not.toBeNull();
    expect(getClfTask(frame)).toBeUndefined();
    expect(getDetectTask(frame)?.boxes).toHaveLength(1);
  });

  it("clearVideoClfLabel removes the record when no detect task remains", () => {
    let manifest = createVideoAnnotationManifest(video);
    manifest = setVideoClfClass(manifest, video, 1.0, "cat");
    manifest = clearVideoClfLabel(manifest, video, 1.0);
    expect(frameAnnotationAt(manifest, 1.0)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Task 3 — detect-only, clf-only, both
// ---------------------------------------------------------------------------

describe("task isolation", () => {
  it("timestamp can store detect only", () => {
    let manifest = createVideoAnnotationManifest(video);
    manifest = updateVideoDetectBoxes(manifest, video, 1.0, [box], true);
    const frame = frameAnnotationAt(manifest, 1.0);
    expect(getDetectTask(frame)).toBeDefined();
    expect(getClfTask(frame)).toBeUndefined();
  });

  it("timestamp can store clf only", () => {
    let manifest = createVideoAnnotationManifest(video);
    manifest = setVideoClfClass(manifest, video, 2.0, "dog");
    const frame = frameAnnotationAt(manifest, 2.0);
    expect(getClfTask(frame)?.classKey).toBe("dog");
    expect(getDetectTask(frame)).toBeUndefined();
  });

  it("timestamp can store both detect and clf", () => {
    let manifest = createVideoAnnotationManifest(video);
    manifest = updateVideoDetectBoxes(manifest, video, 3.0, [box], true);
    manifest = setVideoClfClass(manifest, video, 3.0, "person");
    const frame = frameAnnotationAt(manifest, 3.0);
    expect(getDetectTask(frame)?.boxes).toHaveLength(1);
    expect(getClfTask(frame)?.classKey).toBe("person");
  });

  it("updating detect boxes does not remove clf task", () => {
    let manifest = createVideoAnnotationManifest(video);
    manifest = setVideoClfClass(manifest, video, 1.0, "cat");
    manifest = updateVideoDetectBoxes(manifest, video, 1.0, [box], true);
    expect(getClfTask(frameAnnotationAt(manifest, 1.0))?.classKey).toBe("cat");
  });

  it("updating clf label does not remove detect task", () => {
    let manifest = createVideoAnnotationManifest(video);
    manifest = updateVideoDetectBoxes(manifest, video, 1.0, [box], true);
    manifest = setVideoClfClass(manifest, video, 1.0, "bird");
    expect(getDetectTask(frameAnnotationAt(manifest, 1.0))?.boxes).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Task 6 — legacy updateVideoFrameAnnotation adapter
// ---------------------------------------------------------------------------

describe("updateVideoFrameAnnotation legacy adapter", () => {
  it("writes detect task; preserves clf task", () => {
    let manifest = createVideoAnnotationManifest(video);
    manifest = setVideoClfClass(manifest, video, 1.234, "fox");
    manifest = updateVideoFrameAnnotation(manifest, video, 1.234, [box], true, "2026-01-01T00:00:00Z");
    const frame = frameAnnotationAt(manifest, 1.234);
    expect(getDetectTask(frame)?.boxes).toHaveLength(1);
    expect(getClfTask(frame)?.classKey).toBe("fox");
  });
});

// ---------------------------------------------------------------------------
// Frame navigation
// ---------------------------------------------------------------------------

describe("adjacent reviewed frame navigation", () => {
  it("finds adjacent detect-reviewed timestamps", () => {
    let manifest = createVideoAnnotationManifest(video);
    manifest = updateVideoDetectBoxes(manifest, video, 1, [box]);
    manifest = markVideoDetectEmpty(manifest, video, 3);
    manifest = updateVideoDetectBoxes(manifest, video, 5, [box]);
    const frames = sortedVideoFrames(manifest, (frame) => Boolean(frame.tasks.detect?.reviewed));

    expect(adjacentReviewedFrame(frames, 3000, -1)?.timestampMs).toBe(1000);
    expect(adjacentReviewedFrame(frames, 3000, 1)?.timestampMs).toBe(5000);
  });
});

// ---------------------------------------------------------------------------
// Timeline markers
// ---------------------------------------------------------------------------

describe("video timeline markers", () => {
  it("derives markers from detect and clf frame records", () => {
    let manifest = createVideoAnnotationManifest(video);
    manifest = markVideoDetectEmpty(manifest, video, 1);
    manifest = setVideoClfClass(manifest, video, 2, "day");
    manifest = updateVideoDetectBoxes(manifest, video, 3, [box], true);
    manifest = setVideoClfClass(manifest, video, 3, "night");

    const markers = videoTimelineMarkers(manifest);

    expect(markers.map((marker) => marker.key)).toEqual(["1000", "2000", "3000"]);
    expect(markers.map((marker) => marker.kind)).toEqual(["empty", "clf", "mixed"]);
    expect(markers[2]).toMatchObject({
      detectBoxCount: 1,
      hasDetect: true,
      hasClf: true
    });
  });

  it("does not emit undefined or NaN marker labels", () => {
    let manifest = createVideoAnnotationManifest(video);
    manifest = markVideoClfReviewed(manifest, video, 4);

    const labels = videoTimelineMarkers(manifest).map((marker) => marker.label).join(" ");

    expect(labels).not.toMatch(/undefined|NaN/);
  });
});

describe("moveVideoFrameRecord", () => {
  it("moves a frame record while preserving detect and clf tasks", () => {
    let manifest = createVideoAnnotationManifest(video);
    manifest = updateVideoDetectBoxes(manifest, video, 1, [box], true);
    manifest = setVideoClfClass(manifest, video, 1, "night");

    const moved = moveVideoFrameRecord(manifest, video, 1, 2.5, "2026-01-01T00:00:00Z");

    expect(frameAnnotationAt(moved, 1)).toBeNull();
    const frame = frameAnnotationAt(moved, 2.5);
    expect(frame?.timestampMs).toBe(2500);
    expect(getDetectTask(frame)?.boxes).toHaveLength(1);
    expect(getClfTask(frame)?.classKey).toBe("night");
  });

  it("refuses to overwrite another timestamp record", () => {
    let manifest = createVideoAnnotationManifest(video);
    manifest = updateVideoDetectBoxes(manifest, video, 1, [box], true);
    manifest = setVideoClfClass(manifest, video, 2, "day");

    expect(() => moveVideoFrameRecord(manifest, video, 1, 2)).toThrow(
      "Target timestamp already has an annotation record."
    );
  });
});

// ---------------------------------------------------------------------------
// Box conversion helpers
// ---------------------------------------------------------------------------

describe("box conversion helpers", () => {
  it("labelBoxToDetectBox preserves classId", () => {
    const detect = labelBoxToDetectBox({ classId: 3, x: 0.1, y: 0.2, w: 0.3, h: 0.4 });
    expect(detect.classId).toBe(3);
    expect(detect.x).toBe(0.1);
  });

  it("detectBoxesToLabelBoxes uses classId 0 fallback", () => {
    const boxes = detectBoxesToLabelBoxes([{ x: 0.5, y: 0.5, w: 0.1, h: 0.1 }]);
    expect(boxes[0].classId).toBe(0);
  });

  it("timestampKey is millisecond-stable", () => {
    expect(timestampKey(1.2344)).toBe("1234");
    expect(timestampKey(1.2345)).toBe("1235");
  });
});
