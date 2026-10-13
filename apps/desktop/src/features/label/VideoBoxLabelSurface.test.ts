import { describe, expect, it } from "vitest";
import { adjacentVideoMarkerTime } from "./useVideoPlaybackTimeline";
import {
  initialVideoAnnotationTargetTime,
  markerDrivenAnnotationTargetTime,
  nextVideoKeyboardTime,
  shouldClearActiveMarker,
  videoFrameKeyboardCommand,
  videoLabelsReloadKey,
  visibleVideoDetectBoxes,
  wrappedAdjacentVideoMarkerTime,
} from "./VideoBoxLabelSurface";

describe("VideoBoxLabelSurface keyboard policy", () => {
  it("lets selected boxes keep arrow-key movement", () => {
    expect(videoFrameKeyboardCommand({ key: "ArrowRight", selectedBoxId: 12 })).toBeNull();
    expect(videoFrameKeyboardCommand({ key: "ArrowLeft", selectedBoxId: 12 })).toBeNull();
  });

  it("uses arrow keys for video seek only when no box is selected", () => {
    expect(videoFrameKeyboardCommand({ key: "ArrowRight", selectedBoxId: null })).toBe("seek-forward");
    expect(videoFrameKeyboardCommand({ key: "ArrowLeft", selectedBoxId: null })).toBe("seek-backward");
  });

  it("does not treat numpad physical keys as video arrow seeks", () => {
    expect(videoFrameKeyboardCommand({ key: "ArrowRight", code: "Numpad6", selectedBoxId: null })).toBeNull();
    expect(videoFrameKeyboardCommand({ key: "ArrowLeft", code: "Numpad4", selectedBoxId: null })).toBeNull();
  });

  it("ignores text-editing targets and modified shortcuts", () => {
    expect(videoFrameKeyboardCommand({ key: "ArrowRight", targetTagName: "INPUT" })).toBeNull();
    expect(videoFrameKeyboardCommand({ key: "ArrowRight", targetEditable: true })).toBeNull();
    expect(videoFrameKeyboardCommand({ key: "ArrowRight", ctrlKey: true })).toBeNull();
  });

  it("toggles playback with space when no box is selected", () => {
    expect(videoFrameKeyboardCommand({ key: " ", code: "Space" })).toBe("toggle-playback");
    expect(videoFrameKeyboardCommand({ key: " ", code: "Space", selectedBoxId: 1 })).toBeNull();
  });

  it("clamps keyboard seek to the video duration", () => {
    expect(nextVideoKeyboardTime(0.05, 10, "seek-backward", 0.1, false)).toBe(0);
    expect(nextVideoKeyboardTime(9.95, 10, "seek-forward", 0.1, false)).toBe(10);
    expect(nextVideoKeyboardTime(1, 10, "seek-forward", 0.1, true)).toBe(2);
  });

  it("keeps annotation boxes on marker signals without clearing transient frame gaps", () => {
    expect(initialVideoAnnotationTargetTime(null)).toBeNull();
    expect(initialVideoAnnotationTargetTime(2.5)).toBe(2.5);
    expect(markerDrivenAnnotationTargetTime(2.5, null)).toBe(2.5);
    expect(markerDrivenAnnotationTargetTime(null, null)).toBeNull();
    expect(markerDrivenAnnotationTargetTime(null, 4)).toBeNull();
    expect(markerDrivenAnnotationTargetTime(2.5, 4)).toBe(4);
  });

  it("clears active marker only after player leaves the marker timestamp", () => {
    expect(shouldClearActiveMarker(2.5, null)).toBe(false);
    expect(shouldClearActiveMarker(2.51, 2.5)).toBe(false);
    expect(shouldClearActiveMarker(2.6, 2.5)).toBe(true);
  });

  it("finds adjacent markers from the visible playback time", () => {
    const markers = [5, 1, 3];
    expect(adjacentVideoMarkerTime(markers, 2, 1)).toBe(3);
    expect(adjacentVideoMarkerTime(markers, 4, -1)).toBe(3);
    expect(adjacentVideoMarkerTime(markers, 5, 1)).toBeNull();
    expect(adjacentVideoMarkerTime(markers, 1, -1)).toBeNull();
  });

  it("wraps marker navigation at video marker boundaries", () => {
    const markers = [1, 3, 5];
    expect(wrappedAdjacentVideoMarkerTime(markers, 5, 1)).toBe(1);
    expect(wrappedAdjacentVideoMarkerTime(markers, 1, -1)).toBe(5);
    expect(wrappedAdjacentVideoMarkerTime([], 1, 1)).toBeNull();
  });
});

describe("VideoBoxLabelSurface label visibility", () => {
  it("hides detect boxes when the marker is inactive or detect export is disabled", () => {
    const boxes = [{ classId: 36, x: 0.5, y: 0.5, w: 0.2, h: 0.2 }];

    expect(visibleVideoDetectBoxes(boxes, true, true)).toBe(boxes);
    expect(visibleVideoDetectBoxes(boxes, true, false)).toEqual([]);
    expect(visibleVideoDetectBoxes(boxes, false, true)).toEqual([]);
  });

  it("changes the label reload key when detect is toggled or the frame record is cleared", () => {
    const enabledKey = videoLabelsReloadKey({
      annotationTime: 1.234,
      detectEnabled: true,
      frameUpdatedAt: "2026-01-01T00:00:00Z",
      visibleBoxCount: 5,
    });
    const disabledKey = videoLabelsReloadKey({
      annotationTime: 1.234,
      detectEnabled: false,
      frameUpdatedAt: "2026-01-01T00:00:00Z",
      visibleBoxCount: 0,
    });
    const clearedKey = videoLabelsReloadKey({
      annotationTime: 1.234,
      detectEnabled: true,
      frameUpdatedAt: undefined,
      visibleBoxCount: 0,
    });

    expect(disabledKey).not.toBe(enabledKey);
    expect(clearedKey).not.toBe(enabledKey);
    expect(clearedKey).toContain("no-frame");
  });
});
