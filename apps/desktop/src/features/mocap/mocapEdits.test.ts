import { describe, expect, it } from "vitest";
import type { PoseData } from "./mocapApi";
import {
  EMPTY_EDITS,
  addDrag,
  deleteKeyframe,
  exclude,
  isPending,
  keyframes,
  rebuildRange,
  restoreAuto,
  setCurveAt,
  toggleSmoothing,
  trustCurrent
} from "./mocapEdits";

const pose: PoseData = {
  variant: "current",
  fps: 30,
  width: 100,
  height: 100,
  backend: "t",
  joints: ["a", "b"],
  parents: [-1, 0],
  times: [0, 1, 2],
  image: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
  position: Array.from({ length: 18 }, (_, i) => i / 10),
  confidence: [0.9, 0.8, 0.7, 0.6, 0.5, 0.4],
  valid: [1, 1, 1, 1, 1, 0],
  inferred: []
};

describe("drag keyframes", () => {
  it("adds, curves, smooths and deletes by keyframe", () => {
    let edits = addDrag(EMPTY_EDITS, 1, 2, [3, -4], "smooth");
    edits = addDrag(edits, 0, 2, [1, 1], "linear");
    edits = addDrag(edits, 0, 7, [1, 1], "linear");
    expect(keyframes(edits)).toEqual([2, 7]);
    edits = setCurveAt(edits, 2, "hold");
    expect(edits.corrections.filter((c) => c.keyframe === 2).every((c) => c.curve === "hold")).toBe(true);
    expect(toggleSmoothing(edits, 5)).toBe(edits); // no keyframe there
    edits = toggleSmoothing(edits, 7);
    expect(edits.smoothedKeyframes).toEqual([7]);
    edits = deleteKeyframe(edits, 7);
    expect(keyframes(edits)).toEqual([2]);
    expect(edits.smoothedKeyframes).toEqual([]);
    expect(EMPTY_EDITS.corrections).toEqual([]); // never mutated
  });

  it("a drag on a locked joint lets the lock follow the drag", () => {
    let edits = trustCurrent(EMPTY_EDITS, pose, 1, 2, "locked");
    expect(edits.review.marks[0].target).toEqual([1.5, 1.6, 1.7, 11, 12]);
    edits = addDrag(edits, 1, 2, [5, 5], "smooth");
    expect(edits.review.marks[0].target).toBeUndefined();
    expect(edits.review.marks[0].trust).toBe("locked");
  });
});

describe("joint review", () => {
  it("locks and weights the value on screen, replacing earlier marks", () => {
    let edits = trustCurrent(EMPTY_EDITS, pose, 0, 1, "locked");
    edits = trustCurrent(edits, pose, 0, 1, "weighted", 16);
    expect(edits.review.marks).toHaveLength(1);
    expect(edits.review.marks[0]).toMatchObject({
      trust: "weighted",
      weight: 16,
      confidence: 0.7,
      valid: true,
      target: [0.6, 0.7, 0.8, 5, 6]
    });
  });

  it("excluded and weighted marks are pending until a rebuild covers them", () => {
    let edits = trustCurrent(EMPTY_EDITS, pose, 0, 0, "locked");
    edits = trustCurrent(edits, pose, 0, 10, "locked");
    edits = exclude(edits, 0, 4, 6);
    expect(edits.review.marks.filter((m) => m.trust === "excluded").map((m) => m.frame)).toEqual([4, 5, 6]);
    expect(edits.review.marks.filter((m) => isPending(edits, m)).map((m) => m.frame)).toEqual([4, 5, 6]);
    edits = rebuildRange(edits, 0, 0, 10);
    expect(edits.review.marks.some((m) => isPending(edits, m))).toBe(false);
    edits = rebuildRange(edits, 0, 0, 10); // replaces, does not duplicate
    expect(edits.review.ranges).toEqual([[0, 10, 0]]);
  });

  it("restore auto drops marks and any rebuild that lost an endpoint", () => {
    let edits = trustCurrent(EMPTY_EDITS, pose, 0, 0, "locked");
    edits = trustCurrent(edits, pose, 0, 10, "locked");
    edits = trustCurrent(edits, pose, 1, 0, "locked");
    edits = trustCurrent(edits, pose, 1, 10, "locked");
    edits = rebuildRange(rebuildRange(edits, 0, 0, 10), 1, 0, 10);
    edits = restoreAuto(edits, 0, 8, 12);
    expect(edits.review.ranges).toEqual([[0, 10, 1]]);
    expect(edits.review.marks.map((m) => [m.joint, m.frame])).toEqual([
      [0, 0],
      [1, 0],
      [1, 10]
    ]);
  });
});
