import { describe, expect, it } from "vitest";
import type { LabelBox } from "../../api";
import { createVideoAnnotationManifest, type VideoSource } from "./videoAnnotationApi";
import {
  adjacentReviewedFrame,
  clampVideoTime,
  frameAnnotationAt,
  sortedVideoFrames,
  updateVideoFrameAnnotation
} from "./videoAnnotationDomain";

const video: VideoSource = {
  path: "C:/video/source.mp4",
  name: "source.mp4",
  duration: 10,
  width: 1920,
  height: 1080
};

const box: LabelBox = { classId: 2, x: 0.5, y: 0.5, w: 0.2, h: 0.3 };

describe("video annotation domain", () => {
  it("uses millisecond-stable timestamps and never exceeds duration", () => {
    expect(clampVideoTime(-2, 10)).toBe(0);
    expect(clampVideoTime(2.34567, 10)).toBe(2.346);
    expect(clampVideoTime(12, 10)).toBe(9.999);
  });

  it("creates, reads, and clears a frame annotation without image files", () => {
    const source = createVideoAnnotationManifest(video);
    const annotated = updateVideoFrameAnnotation(source, video, 1.2344, [box], true, "2026-01-01T00:00:00Z");

    expect(frameAnnotationAt(annotated, 1.234)?.boxes).toEqual([box]);
    expect(Object.keys(annotated.frames)).toEqual(["1234"]);

    const cleared = updateVideoFrameAnnotation(annotated, video, 1.234, [], false, "2026-01-01T00:00:01Z");
    expect(frameAnnotationAt(cleared, 1.234)).toBeNull();
  });

  it("finds adjacent reviewed timestamps", () => {
    let manifest = createVideoAnnotationManifest(video);
    manifest = updateVideoFrameAnnotation(manifest, video, 1, [box]);
    manifest = updateVideoFrameAnnotation(manifest, video, 3, [], true);
    manifest = updateVideoFrameAnnotation(manifest, video, 5, [box]);
    const frames = sortedVideoFrames(manifest, (frame) => frame.reviewed);

    expect(adjacentReviewedFrame(frames, 3000, -1)?.timestampMs).toBe(1000);
    expect(adjacentReviewedFrame(frames, 3000, 1)?.timestampMs).toBe(5000);
  });
});
