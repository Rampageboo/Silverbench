import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MutableRefObject,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { isNumpadCode } from "../box-label/boxLabelKeyboardShortcuts";
import type { VideoAnnotationSession } from "../video/useVideoAnnotationSession";

export type VideoFrameKeyboardCommand = "seek-backward" | "seek-forward" | "toggle-playback";

export function videoFrameKeyboardCommand({
  key,
  code = "",
  ctrlKey = false,
  altKey = false,
  metaKey = false,
  targetTagName = "",
  targetEditable = false,
  selectedBoxId = null,
}: {
  key: string;
  code?: string;
  ctrlKey?: boolean;
  altKey?: boolean;
  metaKey?: boolean;
  targetTagName?: string;
  targetEditable?: boolean;
  selectedBoxId?: number | null;
}): VideoFrameKeyboardCommand | null {
  const tag = targetTagName.toLowerCase();
  if (tag === "input" || tag === "select" || tag === "textarea" || targetEditable) return null;
  if (ctrlKey || altKey || metaKey) return null;
  if (selectedBoxId !== null) return null;
  if (isNumpadCode(code)) return null;
  if (key === "ArrowLeft") return "seek-backward";
  if (key === "ArrowRight") return "seek-forward";
  if (key === " " || key === "Spacebar" || code === "Space") return "toggle-playback";
  return null;
}

export function nextVideoKeyboardTime(currentTime: number, maxTime: number, command: VideoFrameKeyboardCommand, stepSeconds: number, fast: boolean) {
  if (command !== "seek-backward" && command !== "seek-forward") return currentTime;
  const direction = command === "seek-forward" ? 1 : -1;
  const step = Math.max(0.001, Number.isFinite(stepSeconds) ? stepSeconds : 0.1);
  const amount = fast ? Math.max(1, step * 10) : step;
  return Math.max(0, Math.min(maxTime, Math.round((currentTime + direction * amount) * 1000) / 1000));
}

export function initialVideoAnnotationTargetTime(currentFrameTime: number | null) {
  return currentFrameTime;
}

export function markerDrivenAnnotationTargetTime(currentTargetTime: number | null, currentFrameTime: number | null) {
  if (currentTargetTime === null) return null;
  if (currentFrameTime === null) return currentTargetTime;
  return currentFrameTime;
}

export function shouldClearActiveMarker(playerTime: number, activeMarkerTime: number | null, toleranceSeconds = 0.04) {
  return activeMarkerTime !== null && Math.abs(playerTime - activeMarkerTime) > toleranceSeconds;
}

export function adjacentVideoMarkerTime(markerTimes: number[], currentTime: number, direction: -1 | 1, epsilon = 0.0005) {
  const sorted = markerTimes
    .filter((time) => Number.isFinite(time))
    .sort((a, b) => a - b);
  return direction > 0
    ? sorted.find((time) => time > currentTime + epsilon) ?? null
    : [...sorted].reverse().find((time) => time < currentTime - epsilon) ?? null;
}

export function wrappedAdjacentVideoMarkerTime(markerTimes: number[], currentTime: number, direction: -1 | 1, epsilon = 0.0005) {
  const sorted = markerTimes
    .filter((time) => Number.isFinite(time))
    .sort((a, b) => a - b);
  if (!sorted.length) return null;
  return adjacentVideoMarkerTime(sorted, currentTime, direction, epsilon) ?? (direction > 0 ? sorted[0] : sorted[sorted.length - 1]);
}

type UseVideoPlaybackTimelineOptions = {
  videoSession: VideoAnnotationSession;
  currentVideoPath: string;
  currentFrameTime: number | null;
  nativeVideoUrl: string | null;
  proxiedVideoPath: string | null;
  selectedBoxIdRef: MutableRefObject<number | null>;
  onNavigateBoundary: (delta: -1 | 1) => void;
  setLastSource: (source: "manual") => void;
};

export function useVideoPlaybackTimeline({
  videoSession,
  currentVideoPath,
  currentFrameTime,
  nativeVideoUrl,
  proxiedVideoPath,
  selectedBoxIdRef,
  onNavigateBoundary,
  setLastSource,
}: UseVideoPlaybackTimelineOptions) {
  const [activeMarkerTime, setActiveMarkerTime] = useState<number | null>(null);
  const [playbackTime, setPlaybackTime] = useState(0);
  const playbackTimeRef = useRef(0);
  const suppressNextSessionMarkerSyncRef = useRef(false);
  const playbackSessionSyncTimeRef = useRef<number | null>(null);
  const [videoSeekToken, setVideoSeekToken] = useState(0);
  const [playing, setPlaying] = useState(false);

  const seekPlayerToTime = useCallback((nextTime: number) => {
    const clamped = Math.max(0, Math.min(videoSession.maxTime, Number.isFinite(nextTime) ? nextTime : 0));
    setLastSource("manual");
    setActiveMarkerTime(null);
    playbackTimeRef.current = clamped;
    setPlaybackTime(clamped);
    setVideoSeekToken((value) => value + 1);
    suppressNextSessionMarkerSyncRef.current = true;
    playbackSessionSyncTimeRef.current = clamped;
    videoSession.gotoTime(clamped);
  }, [setLastSource, videoSession]);

  const selectMarkerTime = useCallback((nextTime: number) => {
    const clamped = Math.max(0, Math.min(videoSession.maxTime, Number.isFinite(nextTime) ? nextTime : 0));
    setLastSource("manual");
    setActiveMarkerTime(clamped);
    playbackTimeRef.current = clamped;
    setPlaybackTime(clamped);
    setVideoSeekToken((value) => value + 1);
    playbackSessionSyncTimeRef.current = clamped;
    videoSession.gotoTime(clamped);
  }, [setLastSource, videoSession]);

  useEffect(() => {
    setActiveMarkerTime(null);
    playbackTimeRef.current = 0;
    playbackSessionSyncTimeRef.current = null;
    setPlaybackTime(0);
    setVideoSeekToken((value) => value + 1);
    setPlaying(false);
  }, [currentVideoPath]);

  useEffect(() => {
    const nextTarget = markerDrivenAnnotationTargetTime(activeMarkerTime, currentFrameTime);
    setActiveMarkerTime(nextTarget);
    if (nextTarget !== null) {
      playbackTimeRef.current = nextTarget;
      setPlaybackTime(nextTarget);
      setVideoSeekToken((value) => value + 1);
    }
    // Only session frame changes should drive marker retargeting. Depending on
    // activeMarkerTime here can revert a just-clicked marker to the previous frame.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentFrameTime]);

  useEffect(() => {
    const clamped = Math.max(0, Math.min(videoSession.maxTime, Number.isFinite(videoSession.time) ? videoSession.time : 0));
    if (Math.abs(playbackTimeRef.current - clamped) >= 0.005) {
      playbackTimeRef.current = clamped;
      setPlaybackTime(clamped);
      setVideoSeekToken((value) => value + 1);
    }
    if (suppressNextSessionMarkerSyncRef.current) {
      suppressNextSessionMarkerSyncRef.current = false;
      return;
    }
    if (currentFrameTime !== null && Math.round(currentFrameTime * 1000) === Math.round(clamped * 1000)) {
      setActiveMarkerTime(currentFrameTime);
    }
  }, [currentFrameTime, videoSession.maxTime, videoSession.time]);

  useEffect(() => {
    if (proxiedVideoPath) {
      setVideoSeekToken((value) => value + 1);
    }
  }, [proxiedVideoPath]);

  useEffect(() => {
    if (!nativeVideoUrl) {
      setPlaying(false);
    }
  }, [nativeVideoUrl]);

  const handleAddMarker = useCallback(() => {
    setLastSource("manual");
    const nextTime = playbackTimeRef.current;
    setActiveMarkerTime(nextTime);
    videoSession.markTimestamp(nextTime, { kind: "manual" });
    videoSession.gotoTime(nextTime);
  }, [setLastSource, videoSession]);

  const handleVideoPlaybackTimeChange = useCallback((nextTime: number) => {
    const clamped = Math.max(0, Math.min(videoSession.maxTime, nextTime));
    if (Math.abs(playbackTimeRef.current - clamped) < 0.005) return;
    playbackTimeRef.current = clamped;
    if (shouldClearActiveMarker(clamped, activeMarkerTime)) setActiveMarkerTime(null);
    setPlaybackTime(clamped);
    const lastSessionSync = playbackSessionSyncTimeRef.current;
    const shouldSyncSession =
      !playing ||
      lastSessionSync === null ||
      Math.abs(lastSessionSync - clamped) >= 0.12 ||
      clamped >= videoSession.maxTime - 0.02;
    if (shouldSyncSession) {
      suppressNextSessionMarkerSyncRef.current = true;
      playbackSessionSyncTimeRef.current = clamped;
      videoSession.gotoTime(clamped);
    }
  }, [activeMarkerTime, playing, videoSession]);

  const stopPlayback = useCallback(() => {
    setPlaying(false);
  }, []);

  const syncSessionToPlaybackTime = useCallback(() => {
    const clamped = Math.max(0, Math.min(videoSession.maxTime, playbackTimeRef.current));
    suppressNextSessionMarkerSyncRef.current = true;
    playbackSessionSyncTimeRef.current = clamped;
    videoSession.gotoTime(clamped);
  }, [videoSession]);

  const togglePlayback = useCallback(() => {
    if (!nativeVideoUrl) return;
    setPlaying((value) => {
      if (value) {
        syncSessionToPlaybackTime();
        return false;
      }
      playbackSessionSyncTimeRef.current = playbackTimeRef.current;
      return true;
    });
  }, [nativeVideoUrl, syncSessionToPlaybackTime]);

  const handleVideoEnded = useCallback(() => {
    setPlaying(false);
    syncSessionToPlaybackTime();
  }, [syncSessionToPlaybackTime]);

  useEffect(() => {
    if (!videoSession.current) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const command = videoFrameKeyboardCommand({
        key: event.key,
        code: event.code,
        ctrlKey: event.ctrlKey,
        altKey: event.altKey,
        metaKey: event.metaKey,
        targetTagName: target?.tagName,
        targetEditable: Boolean(target?.isContentEditable),
        selectedBoxId: selectedBoxIdRef.current,
      });
      if (!command) return;
      event.preventDefault();
      if (command === "toggle-playback") {
        togglePlayback();
        return;
      }
      seekPlayerToTime(
        nextVideoKeyboardTime(playbackTime, videoSession.maxTime, command, videoSession.stepSeconds, event.shiftKey)
      );
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [playbackTime, seekPlayerToTime, selectedBoxIdRef, togglePlayback, videoSession, videoSession.current, videoSession.maxTime, videoSession.stepSeconds]);

  const handleMarkerPointerDown = useCallback((event: ReactPointerEvent<HTMLButtonElement>, markerTime: number) => {
    event.preventDefault();
    event.stopPropagation();
    selectMarkerTime(markerTime);
  }, [selectMarkerTime]);

  const handleTimelinePointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (!videoSession.current || videoSession.maxTime <= 0) return;
    const target = event.target as HTMLElement | null;
    if (target?.closest(".video-frame-timeline-marker")) return;
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width <= 0) return;
    const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    event.preventDefault();
    event.stopPropagation();
    seekPlayerToTime(Math.round(ratio * videoSession.maxTime * 1000) / 1000);
  }, [seekPlayerToTime, videoSession, videoSession.current, videoSession.maxTime]);

  const handleTimelineRangeKeyDown = useCallback((event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.ctrlKey || event.altKey || event.metaKey) return;
    const key = event.key.toLowerCase();
    const direction = key === "a" ? -1 : key === "d" ? 1 : 0;
    if (!direction) return;
    event.preventDefault();
    event.stopPropagation();
    const targetTime = wrappedAdjacentVideoMarkerTime(
      videoSession.timelineMarkers.map((marker) => marker.time),
      playbackTimeRef.current,
      direction
    );
    if (targetTime !== null) {
      selectMarkerTime(targetTime);
      return;
    }
    onNavigateBoundary(direction < 0 ? -1 : 1);
  }, [onNavigateBoundary, selectMarkerTime, videoSession.timelineMarkers]);

  const markerLeftPercent = useCallback((markerTime: number) => {
    if (videoSession.maxTime <= 0) return 0;
    return Math.max(0, Math.min(100, (markerTime / videoSession.maxTime) * 100));
  }, [videoSession.maxTime]);

  return {
    activeMarkerTime,
    annotationTime: activeMarkerTime,
    markerIsActive: activeMarkerTime !== null,
    playbackTime,
    videoSeekToken,
    playing,
    seekPlayerToTime,
    selectMarkerTime,
    stopPlayback,
    togglePlayback,
    handleAddMarker,
    handleVideoPlaybackTimeChange,
    handleVideoEnded,
    handleMarkerPointerDown,
    handleTimelinePointerDown,
    handleTimelineRangeKeyDown,
    markerLeftPercent,
  };
}
