import type { LabelBox } from "../../api";
import {
  timestampKey,
  type VideoAnnotationManifest,
  type VideoFrameAnnotation,
  type VideoSource
} from "./videoAnnotationApi";

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

export function frameAnnotationAt(manifest: VideoAnnotationManifest | null, seconds: number) {
  return manifest?.frames[timestampKey(seconds)] || null;
}

export function sortedVideoFrames(
  manifest: VideoAnnotationManifest | null,
  predicate: (frame: VideoFrameAnnotation) => boolean = () => true
) {
  return Object.values(manifest?.frames || {})
    .filter(predicate)
    .sort((a, b) => a.timestampMs - b.timestampMs);
}

export function cloneBoxes(boxes: LabelBox[]) {
  return boxes.map((box) => ({ ...box }));
}

export function updateVideoFrameAnnotation(
  manifest: VideoAnnotationManifest,
  video: VideoSource,
  seconds: number,
  boxes: LabelBox[],
  reviewed = true,
  now = new Date().toISOString()
): VideoAnnotationManifest {
  const timestampMs = Number(timestampKey(seconds));
  const frames = { ...manifest.frames };
  if (!reviewed && boxes.length === 0) {
    delete frames[String(timestampMs)];
  } else {
    frames[String(timestampMs)] = {
      timestampMs,
      time: timestampMs / 1000,
      boxes: cloneBoxes(boxes),
      reviewed: reviewed || boxes.length > 0,
      updatedAt: now
    };
  }
  return {
    ...manifest,
    video,
    updatedAt: now,
    frames
  };
}

export function adjacentReviewedFrame(
  frames: VideoFrameAnnotation[],
  currentTimestampMs: number,
  direction: -1 | 1
) {
  return direction < 0
    ? [...frames].reverse().find((frame) => frame.timestampMs < currentTimestampMs) || null
    : frames.find((frame) => frame.timestampMs > currentTimestampMs) || null;
}
