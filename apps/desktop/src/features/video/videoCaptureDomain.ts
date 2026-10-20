import type { VideoSegment } from "./videoCaptureApi";

function clamp(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

export function commitNumberDraft(draft: string, current: number, min: number, max = Number.POSITIVE_INFINITY) {
  if (!draft.trim()) return current;
  const value = Number(draft);
  return Number.isFinite(value) ? clamp(value, min, max) : current;
}

export function updateVideoCaptureSegment(
  segment: VideoSegment,
  patch: Partial<VideoSegment>,
  duration: number
): VideoSegment {
  const next = { ...segment, ...patch };
  next.start = clamp(Number(next.start), 0, duration);
  next.end = clamp(Number(next.end), 0, duration);
  if (patch.start !== undefined) next.start = Math.min(next.start, next.end);
  if (patch.end !== undefined) next.end = Math.max(next.end, next.start);
  next.interval = Math.max(0.001, Number(next.interval) || 0.001);
  return next;
}
