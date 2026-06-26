import { useCallback, useEffect, useRef, useState } from "react";
import { type SampleCandidate, type SamplingMode, sampleTimestamp } from "./videoSamplingDomain";
import { loadVideoSegmentManifest, type VideoSegmentManifest } from "./videoSegmentApi";
import type { VideoAnnotationManifest } from "./videoAnnotationApi";

export type { SamplingMode, SampleCandidate };

export type TimestampSource = "manual" | "random-whole-video" | "random-segment";

type UseVideoSamplingOptions = {
  workspaceRoot: string;
  videoPath: string | null;
  videoDurationMs: number;
  annotationManifest: VideoAnnotationManifest | null;
  avoidReviewed?: boolean;
  avoidAnnotated?: boolean;
};

export function useVideoSampling({
  workspaceRoot,
  videoPath,
  videoDurationMs,
  annotationManifest,
  avoidReviewed = true,
  avoidAnnotated = false
}: UseVideoSamplingOptions) {
  const [samplingMode, setMode] = useState<SamplingMode>("segments-preferred");
  const [minSpacingMs, setMinSpacingMs] = useState(2000);
  const [lastCandidate, setLastCandidate] = useState<SampleCandidate | null>(null);
  const [lastSource, setLastSource] = useState<TimestampSource>("manual");
  const [segmentManifest, setSegmentManifest] = useState<VideoSegmentManifest | null>(null);

  const segmentLoadRef = useRef(0);

  // Load segment manifest whenever video changes
  useEffect(() => {
    if (!workspaceRoot.trim() || !videoPath) {
      setSegmentManifest(null);
      return;
    }
    const requestId = ++segmentLoadRef.current;
    loadVideoSegmentManifest(workspaceRoot, videoPath, videoDurationMs)
      .then((manifest) => {
        if (requestId === segmentLoadRef.current) {
          setSegmentManifest(manifest);
        }
      })
      .catch(() => {
        if (requestId === segmentLoadRef.current) {
          setSegmentManifest(null);
        }
      });
  }, [workspaceRoot, videoPath, videoDurationMs]);

  const randomNext = useCallback((): SampleCandidate | null => {
    if (videoDurationMs <= 0) return null;

    const existingTimestamps = annotationManifest
      ? Object.values(annotationManifest.frames).map((frame) => ({
          timestampMs: frame.timestampMs,
          reviewed: frame.reviewed,
          boxes: frame.boxes
        }))
      : [];

    const enabledSegments = (segmentManifest?.segments ?? [])
      .filter((seg) => seg.enabled)
      .map((seg) => ({ id: seg.id, startMs: seg.startMs, endMs: seg.endMs }));

    const candidate = sampleTimestamp({
      mode: samplingMode,
      minSpacingMs,
      avoidReviewed,
      avoidAnnotated,
      maxAttempts: 50,
      videoDurationMs,
      enabledSegments,
      existingTimestamps
    });

    if (candidate) {
      setLastCandidate(candidate);
      const source: TimestampSource =
        candidate.source === "segment" ? "random-segment" : "random-whole-video";
      setLastSource(source);
    }

    return candidate;
  }, [
    videoDurationMs,
    annotationManifest,
    segmentManifest,
    samplingMode,
    minSpacingMs,
    avoidReviewed,
    avoidAnnotated
  ]);

  const segmentCount = segmentManifest?.segments.filter((s) => s.enabled).length ?? 0;

  return {
    samplingMode,
    setMode,
    minSpacingMs,
    setMinSpacingMs,
    lastCandidate,
    lastSource,
    setLastSource,
    segmentManifest,
    segmentCount,
    randomNext
  };
}
