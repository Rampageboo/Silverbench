import { describe, expect, it } from "vitest";
import {
  initialVideoAnnotationTargetTime,
  markerDrivenAnnotationTargetTime,
  nextVideoKeyboardTime,
  videoFrameKeyboardCommand,
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

  it("keeps annotation boxes driven by marker signals rather than playback ticks", () => {
    expect(initialVideoAnnotationTargetTime(null, 1.25)).toBe(1.25);
    expect(initialVideoAnnotationTargetTime(2.5, 1.25)).toBe(2.5);
    expect(markerDrivenAnnotationTargetTime(2.5, null)).toBe(2.5);
    expect(markerDrivenAnnotationTargetTime(2.5, 4)).toBe(4);
  });
});
