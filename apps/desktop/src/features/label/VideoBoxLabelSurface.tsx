import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { saveVideoFrame, videoSourceUrl } from "../video/videoCaptureApi";
import { useVideoSampling, type SamplingMode } from "../video/useVideoSampling";
import type { VideoAnnotationSession } from "../video/useVideoAnnotationSession";
import { getAnnotationFrameUrl } from "../video/videoAnnotationApi";
import { BoxLabelView } from "../box-label/BoxLabelView";
import type { BoxLabelEntry } from "../box-label/boxLabelCore";
import type { BoxLabelModel } from "../box-label/useBoxLabel";
import { AutoLabelModelPanel } from "./AutoLabelModelPanel";
import { analysisClassPanelSummaries, type AnalysisStats } from "./labelAnalysisStats";

const SAMPLING_MODE_LABELS: Record<SamplingMode, string> = {
  "whole-video": "Whole video",
  "segments-preferred": "Segments preferred",
  "segments-only": "Segments only",
};

const SAMPLING_MODES: SamplingMode[] = ["whole-video", "segments-preferred", "segments-only"];
const RANDOM_MULTIPLIERS = [1, 5, 10] as const;
const FALLBACK_PLAYBACK_INTERVAL_MS = 180;
const FALLBACK_PLAYBACK_STEP_SECONDS = FALLBACK_PLAYBACK_INTERVAL_MS / 1000;
type RandomMultiplier = (typeof RANDOM_MULTIPLIERS)[number];
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

export function initialVideoAnnotationTargetTime(currentFrameTime: number | null, playbackTime: number) {
  return currentFrameTime ?? playbackTime;
}

export function markerDrivenAnnotationTargetTime(currentTargetTime: number | null, currentFrameTime: number | null) {
  return currentFrameTime ?? currentTargetTime;
}

function workspaceRelativePath(workspaceRoot: string, absolutePath: string) {
  const root = workspaceRoot.replace(/\\/g, "/").replace(/\/+$/, "");
  const path = absolutePath.replace(/\\/g, "/");
  if (root && path.toLowerCase().startsWith(`${root.toLowerCase()}/`)) {
    return path.slice(root.length + 1);
  }
  return absolutePath;
}

function videoFrameEntry(videoName: string, time: number, mediaPosition: number, mediaCount: number): BoxLabelEntry {
  const stem = videoName.replace(/\.[^.]+$/, "") || "video-frame";
  const stamp = Math.max(0, Math.round(time * 1000));
  const positionText = mediaPosition >= 0 ? `${mediaPosition + 1} / ${mediaCount}` : `0 / ${mediaCount}`;
  return {
    imagePath: `video-frame/${stem}/${stamp}.jpg`,
    labelPath: `video-frame-labels/${stem}/${stamp}.txt`,
    basename: `${videoName} ${stamp}ms ${positionText}`,
  };
}

function videoFrameEntryTime(entry: BoxLabelEntry): number | null {
  const imageMatch = entry.imagePath.match(/\/(\d+)\.[^/.]+$/);
  const basenameMatch = entry.basename.match(/\s(\d+)ms(?:\s|$)/);
  const raw = imageMatch?.[1] ?? basenameMatch?.[1] ?? "";
  const timestampMs = Number(raw);
  return Number.isFinite(timestampMs) ? timestampMs / 1000 : null;
}

export function VideoFrameControlsPanel({
  sourceLabel,
  segmentCount,
  samplingMode,
  minSpacingMs,
  randomMultiplier,
  current,
  disabled = false,
  annotatedFrameCount,
  hasFrameRecord,
  videoDurationMs,
  onSamplingModeChange,
  onMinSpacingMsChange,
  onRandomMultiplierChange,
  onRandom,
  onRandomNext,
  onAddMarker,
  onCopyPreviousBoxes,
  onMarkEmpty,
  onClearRecord,
}: {
  sourceLabel: string;
  segmentCount: number;
  samplingMode: SamplingMode;
  minSpacingMs: number;
  randomMultiplier: RandomMultiplier;
  current: boolean;
  disabled?: boolean;
  annotatedFrameCount: number;
  hasFrameRecord: boolean;
  videoDurationMs: number;
  onSamplingModeChange: (mode: SamplingMode) => void;
  onMinSpacingMsChange: (value: number) => void;
  onRandomMultiplierChange: (value: RandomMultiplier) => void;
  onRandom: () => void;
  onRandomNext: () => void;
  onAddMarker: () => void;
  onCopyPreviousBoxes: () => void;
  onMarkEmpty: () => void;
  onClearRecord: () => void;
}) {
  const controlsDisabled = disabled || !current;
  return (
    <section className={`video-frame-controls-panel${controlsDisabled ? " is-disabled" : ""}`}>
      <div className="video-frame-controls-head">
        <span>
          Video Controls
          <small title={sourceLabel}>Source: {sourceLabel}</small>
        </span>
        <span>{segmentCount} segment(s)</span>
      </div>
      <div className="video-frame-controls-form">
        <div className="video-frame-controls-column">
          <label>
            <span>Sampling mode</span>
            <select
              value={samplingMode}
              disabled={controlsDisabled}
              onChange={(event) => onSamplingModeChange(event.target.value as SamplingMode)}
            >
              {SAMPLING_MODES.map((mode) => (
                <option key={mode} value={mode}>{SAMPLING_MODE_LABELS[mode]}</option>
              ))}
            </select>
          </label>
          <label>
            <span>Min spacing (ms)</span>
            <input
              type="number"
              min="0"
              step="100"
              value={minSpacingMs}
              disabled={controlsDisabled}
              onChange={(event) => onMinSpacingMsChange(Math.max(0, Number(event.target.value) || 0))}
            />
          </label>
        </div>
        <div className="video-frame-controls-column video-frame-controls-column--multiplier">
          <label>
            <span>Random multiplier</span>
            <select
              value={randomMultiplier}
              disabled={controlsDisabled}
              onChange={(event) => onRandomMultiplierChange(Number(event.target.value) as RandomMultiplier)}
            >
              {RANDOM_MULTIPLIERS.map((value) => (
                <option key={value} value={value}>{value}x</option>
              ))}
            </select>
          </label>
        </div>
      </div>
      <div className="video-frame-controls-actions">
        <button type="button" className="primary" onClick={onRandom} disabled={controlsDisabled || videoDurationMs <= 0}>
          Random
        </button>
        <button type="button" onClick={onAddMarker} disabled={controlsDisabled}>
          Add Marker
        </button>
        <button type="button" onClick={onCopyPreviousBoxes} disabled={controlsDisabled || annotatedFrameCount <= 0}>
          Copy Previous Boxes
        </button>
        <button type="button" onClick={onRandomNext} disabled={controlsDisabled || videoDurationMs <= 0}>
          Random Next
        </button>
        <button type="button" onClick={onMarkEmpty} disabled={controlsDisabled}>
          Mark Empty
        </button>
        <button type="button" className="danger" onClick={onClearRecord} disabled={controlsDisabled || !hasFrameRecord}>
          Clear Marker
        </button>
      </div>
    </section>
  );
}

export function VideoBoxLabelSurface({
  workspaceRoot,
  videoSession,
  imagePool,
  activeMediaPosition,
  mediaCount,
  analysisStats,
  onNavigateBoundary,
  renderAnalysisPanel,
}: {
  workspaceRoot: string;
  videoSession: VideoAnnotationSession;
  imagePool: BoxLabelModel;
  activeMediaPosition: number;
  mediaCount: number;
  analysisStats: AnalysisStats;
  onNavigateBoundary: (delta: -1 | 1) => void;
  renderAnalysisPanel: () => ReactNode;
}) {
  const currentVideoPath = videoSession.current?.path ?? "";
  const currentFrameTime = videoSession.currentFrame?.time ?? null;
  const [annotationTargetTime, setAnnotationTargetTime] = useState<number | null>(null);
  const [nativeUnsupportedVideoPaths, setNativeUnsupportedVideoPaths] = useState<Set<string>>(() => new Set());
  const entryTime = annotationTargetTime ?? videoSession.time;
  const fallbackPreviewTime = videoSession.time;
  const nativeVideoUrl = useMemo(
    () => videoSession.current && workspaceRoot.trim()
      ? videoSourceUrl(workspaceRoot.trim(), videoSession.current.path)
      : null,
    [videoSession.current, workspaceRoot]
  );
  const nativeVideoSupported = Boolean(
    nativeVideoUrl &&
    videoSession.current &&
    !nativeUnsupportedVideoPaths.has(videoSession.current.path)
  );
  const fallbackFrameUrl = useMemo(
    () => !nativeVideoSupported && videoSession.current && workspaceRoot.trim()
      ? getAnnotationFrameUrl(workspaceRoot.trim(), videoSession.current.path, fallbackPreviewTime, { fast: true })
      : null,
    [fallbackPreviewTime, nativeVideoSupported, videoSession.current, workspaceRoot]
  );
  const hasPreviewImage = Boolean(nativeVideoSupported || fallbackFrameUrl || videoSession.previewUrl || videoSession.previewBase64);
  const entry = useMemo(
    () => videoSession.current && hasPreviewImage
      ? videoFrameEntry(videoSession.current.name, entryTime, activeMediaPosition, mediaCount)
      : null,
    [activeMediaPosition, entryTime, hasPreviewImage, mediaCount, videoSession.current]
  );
  const entries = useMemo(() => entry ? [entry] : [], [entry]);
  const selected = useMemo(() => entry ? new Set([entry.basename]) : new Set<string>(), [entry]);
  const [randomMultiplier, setRandomMultiplier] = useState<RandomMultiplier>(1);
  const [playing, setPlaying] = useState(false);
  const selectedBoxIdRef = useRef<number | null>(null);
  const metadata = useMemo(() => new Map(), []);
  const classImageCounts = useMemo(() => {
    const counts = new Map<number, number>();
    for (const box of videoSession.boxes) counts.set(box.classId, (counts.get(box.classId) ?? 0) + 1);
    return counts;
  }, [videoSession.boxes]);
  const imageUrlOverride = videoSession.previewUrl || (videoSession.previewBase64 ? `data:image/jpeg;base64,${videoSession.previewBase64}` : null);
  const videoDurationMs = videoSession.current ? Math.round(videoSession.current.duration * 1000) : 0;
  const sampling = useVideoSampling({
    workspaceRoot,
    videoPath: videoSession.current?.path ?? null,
    videoDurationMs,
    annotationManifest: videoSession.manifest,
  });
  const sourceLabel = sampling.lastSource === "random-segment"
    ? "Random segment"
    : sampling.lastSource === "random-whole-video"
      ? "Random whole-video"
      : "Manual";
  const hasFrameRecord = Boolean(videoSession.currentFrame);
  const autoLabelFrameTime = videoSession.currentFrame?.time ?? null;
  const autoLabelVideoPath = videoSession.current?.path ?? "";
  const autoLabelFramePathCacheRef = useRef<Map<string, Promise<string | null>>>(new Map());
  const classPanelSummaries = useMemo(() => analysisClassPanelSummaries(analysisStats), [analysisStats]);
  const handleGotoTime = useCallback((nextTime: number) => {
    sampling.setLastSource("manual");
    videoSession.gotoTime(nextTime);
  }, [sampling, videoSession]);

  useEffect(() => {
    setAnnotationTargetTime(initialVideoAnnotationTargetTime(currentFrameTime, 0));
    setPlaying(false);
  }, [currentVideoPath]);

  useEffect(() => {
    setAnnotationTargetTime((currentTarget) => markerDrivenAnnotationTargetTime(currentTarget, currentFrameTime));
  }, [currentFrameTime]);

  useEffect(() => {
    autoLabelFramePathCacheRef.current.clear();
  }, [autoLabelVideoPath, workspaceRoot]);

  const prepareAutoLabelFramePath = useCallback(async (target: BoxLabelEntry) => {
    if (!hasFrameRecord || !autoLabelVideoPath || !workspaceRoot.trim()) return null;
    const targetTime = videoFrameEntryTime(target) ?? autoLabelFrameTime;
    if (targetTime === null) return null;
    const root = workspaceRoot.trim();
    const key = `${autoLabelVideoPath}:${Math.round(targetTime * 1000)}`;
    const cached = autoLabelFramePathCacheRef.current.get(key);
    if (cached) return cached;
    const outputRoot = `${root.replace(/[\\/]+$/, "")}/.tmp-autolabel-frames`;
    const pending = saveVideoFrame(autoLabelVideoPath, outputRoot, targetTime, "autolabel", "jpg")
      .then((path) => workspaceRelativePath(root, path))
      .catch(() => null);
    autoLabelFramePathCacheRef.current.set(key, pending);
    return pending;
  }, [autoLabelFrameTime, autoLabelVideoPath, hasFrameRecord, workspaceRoot]);

  const loadBoxesAtVideoTime = videoSession.loadBoxesAtTime;
  const updateVideoFrameAtTime = videoSession.updateFrameAtTime;
  const loadLabelsOverride = useCallback(async (target: BoxLabelEntry) => {
    const targetTime = videoFrameEntryTime(target);
    return targetTime === null ? [] : loadBoxesAtVideoTime(targetTime);
  }, [loadBoxesAtVideoTime]);
  const saveLabelsOverride = useCallback(async (target: BoxLabelEntry, boxes: Parameters<typeof videoSession.updateCurrentFrame>[0]) => {
    const targetTime = videoFrameEntryTime(target);
    if (targetTime === null) throw new Error("Cannot resolve video timestamp for label save.");
    return updateVideoFrameAtTime(targetTime, boxes, true);
  }, [updateVideoFrameAtTime]);
  const assignClassificationClass = useCallback(async (classKey: string | null) => {
    if (classKey) videoSession.setClfClass(classKey);
    else videoSession.clearClfLabel();
  }, [videoSession]);
  const handleRandomMarkers = useCallback((count: RandomMultiplier) => {
    const addedTimestamps: number[] = [];
    for (let i = 0; i < count; i++) {
      const candidate = sampling.randomNext(addedTimestamps);
      if (!candidate) break;
      addedTimestamps.push(candidate.timestampMs);
      videoSession.markTimestamp(candidate.timestampMs / 1000, {
        kind: "random",
        samplingMode: sampling.samplingMode,
        segmentId: candidate.segmentId,
      });
    }
  }, [sampling, videoSession]);
  const handleRandom = useCallback(() => {
    handleRandomMarkers(randomMultiplier);
  }, [handleRandomMarkers, randomMultiplier]);
  const handleRandomNext = useCallback(() => {
    handleRandomMarkers(1);
  }, [handleRandomMarkers]);
  const handleAddMarker = useCallback(() => {
    sampling.setLastSource("manual");
    setAnnotationTargetTime(videoSession.time);
    videoSession.markCurrentTimestamp({ kind: "manual" });
  }, [sampling, videoSession]);
  const handleVideoPlaybackTimeChange = useCallback((nextTime: number) => {
    videoSession.gotoTime(nextTime);
  }, [videoSession]);
  const handleNativeVideoLoadError = useCallback(() => {
    const failedPath = videoSession.current?.path;
    if (!failedPath) return;
    setPlaying(false);
    setNativeUnsupportedVideoPaths((paths) => {
      if (paths.has(failedPath)) return paths;
      const next = new Set(paths);
      next.add(failedPath);
      return next;
    });
  }, [videoSession.current?.path]);
  useEffect(() => {
    if (!videoSession.current) setPlaying(false);
  }, [videoSession.current]);
  useEffect(() => {
    if (!playing || nativeVideoSupported || !videoSession.current || videoSession.maxTime <= 0) return;
    const interval = window.setInterval(() => {
      const nextTime = nextVideoKeyboardTime(
        videoSession.time,
        videoSession.maxTime,
        "seek-forward",
        FALLBACK_PLAYBACK_STEP_SECONDS,
        false
      );
      handleGotoTime(nextTime);
      if (nextTime >= videoSession.maxTime) setPlaying(false);
    }, FALLBACK_PLAYBACK_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [handleGotoTime, nativeVideoSupported, playing, videoSession.current, videoSession.maxTime, videoSession.time]);
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
        setPlaying((value) => !value);
        return;
      }
      handleGotoTime(
        nextVideoKeyboardTime(videoSession.time, videoSession.maxTime, command, videoSession.stepSeconds, event.shiftKey)
      );
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handleGotoTime, nativeVideoSupported, videoSession.current, videoSession.maxTime, videoSession.stepSeconds, videoSession.time]);
  const handleMarkerPointerDown = useCallback((event: ReactPointerEvent<HTMLButtonElement>, markerTime: number) => {
    event.preventDefault();
    event.stopPropagation();
    setAnnotationTargetTime(markerTime);
    handleGotoTime(markerTime);
  }, [handleGotoTime]);
  const handleTimelinePointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (!videoSession.current || videoSession.maxTime <= 0) return;
    const target = event.target as HTMLElement | null;
    if (target?.closest(".video-frame-timeline-marker")) return;
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width <= 0) return;
    const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    event.preventDefault();
    event.stopPropagation();
    handleGotoTime(Math.round(ratio * videoSession.maxTime * 1000) / 1000);
  }, [handleGotoTime, videoSession.current, videoSession.maxTime]);
  const markerLeftPercent = useCallback((markerTime: number) => {
    if (videoSession.maxTime <= 0) return 0;
    return Math.max(0, Math.min(100, (markerTime / videoSession.maxTime) * 100));
  }, [videoSession.maxTime]);

  return (
    <div className="app pool-label react-box-label-page react-box-label-page--embedded react-box-label-page--unified-media video-frame-box-label-page">
      <main className="workspace pool-label-workspace" id="poolLabelWorkspace">
        <BoxLabelView
          workspaceRoot={workspaceRoot}
          datasetRoot={workspaceRoot}
          mediaDir="media"
          entry={entry}
          entries={entries}
          currentIndex={0}
          selectedFilenames={selected}
          shiftSelectedFilenames={new Set()}
          onNavigate={() => {}}
          onNavigateBoundary={onNavigateBoundary}
          disableMediaNavigationHotkeys
          showSideStack
          initialShortcutSlots={imagePool.initialShortcutSlots}
          initialFixedBoxSlots={imagePool.initialFixedBoxSlots}
          initialPointerToolEnabled={imagePool.initialPointerToolEnabled}
          initialAutoFitEnabled={imagePool.initialAutoFitEnabled}
          onShortcutSlotsChange={imagePool.onShortcutSlotsChange}
          onToolStateChange={imagePool.onToolStateChange}
          includeClasses={new Set()}
          excludeClasses={new Set()}
          imageViewMode="all"
          metadata={metadata}
          classImageCounts={classImageCounts}
          onAddIncludeClass={() => {}}
          onAddExcludeClass={() => {}}
          onClearClassFilters={() => {}}
          onImageViewModeChange={() => {}}
          onToggleReviewed={async () => {
            if (videoSession.current) videoSession.updateCurrentFrame(videoSession.boxes, !videoSession.reviewed);
          }}
          onToggleFlagged={async () => {}}
          detectTaskEnabled={videoSession.detectExportEnabled}
          clfTaskEnabled={videoSession.clfExportEnabled}
          onToggleDetectTaskEnabled={async () => {
            videoSession.toggleDetectExportEnabled();
          }}
          onToggleClfTaskEnabled={async () => {
            videoSession.toggleClfExportEnabled();
          }}
          onLabelsChanged={() => {}}
          onStatusText={() => {}}
          classPanelSummaries={classPanelSummaries}
          classificationClasses={videoSession.clfClassOptions}
          classificationClassesPortalId="lwbClassifyClassesSlot"
          currentClassificationKey={videoSession.clfTask?.classKey ?? null}
          onAssignClassificationClass={assignClassificationClass}
          imageUrlOverride={fallbackFrameUrl || imageUrlOverride}
          reloadLabelsOnImageUrlChange={false}
          videoUrlOverride={nativeVideoSupported ? nativeVideoUrl : null}
          videoPlaybackTime={videoSession.time}
          videoPlaying={nativeVideoSupported && playing}
          onVideoPlaybackTimeChange={handleVideoPlaybackTimeChange}
          onVideoEnded={() => setPlaying(false)}
          onVideoLoadError={handleNativeVideoLoadError}
          loadLabelsOverride={loadLabelsOverride}
          saveLabelsOverride={saveLabelsOverride}
          disableProposals
          canvasOverlayPlacement="zoom-side"
          canvasOverlay={({ selectedBoxId }) => {
            selectedBoxIdRef.current = selectedBoxId;
            return (
              <div className="video-frame-timeline-overlay">
                <div className="video-frame-timeline-top">
                  <button
                    type="button"
                    className="video-frame-playback-btn"
                    disabled={!videoSession.current}
                    aria-pressed={playing}
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      setPlaying((value) => !value);
                    }}
                  >
                    {playing ? "Pause" : "Play"}
                  </button>
                  <div
                    className="video-frame-timeline-marker-row"
                    aria-label="Video markers"
                    onPointerDown={handleTimelinePointerDown}
                  >
                    {videoSession.timelineMarkers.map((marker) => (
                      <button
                        key={marker.key}
                        type="button"
                        className={`video-frame-timeline-marker video-frame-timeline-marker--${marker.kind}`}
                        style={{ left: `${markerLeftPercent(marker.time)}%` }}
                        title={marker.label}
                        aria-label={`Go to ${marker.label}`}
                        onPointerDown={(event) => handleMarkerPointerDown(event, marker.time)}
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          setAnnotationTargetTime(marker.time);
                          handleGotoTime(marker.time);
                        }}
                      />
                    ))}
                  </div>
                </div>
                <input
                  type="range"
                  min="0"
                  max={videoSession.maxTime}
                  step="0.001"
                  value={Math.min(videoSession.time, videoSession.maxTime)}
                  disabled={!videoSession.current}
                  onInput={(event) => handleGotoTime(Number(event.currentTarget.value))}
                  onChange={(event) => handleGotoTime(Number(event.target.value))}
                  aria-label="Video timestamp"
                />
              </div>
            );
          }}
          previewDock={({
            entry: overlayEntry,
            entries: overlayEntries,
            currentIndex,
            boxes,
            proposals,
            classificationClasses,
            currentClassificationKey,
            applyAutoLabelPredictions,
            assignClassificationClass: assignOverlayClassificationClass,
            reloadWorkspaceClasses,
          }) => (
            <div className="lwb-workbench-dock">
              <VideoFrameControlsPanel
                sourceLabel={sourceLabel}
                segmentCount={sampling.segmentCount}
                samplingMode={sampling.samplingMode}
                minSpacingMs={sampling.minSpacingMs}
                randomMultiplier={randomMultiplier}
                current={Boolean(videoSession.current)}
                annotatedFrameCount={videoSession.annotatedFrames.length}
                hasFrameRecord={hasFrameRecord}
                videoDurationMs={videoDurationMs}
                onSamplingModeChange={sampling.setMode}
                onMinSpacingMsChange={sampling.setMinSpacingMs}
                onRandomMultiplierChange={setRandomMultiplier}
                onRandom={handleRandom}
                onRandomNext={handleRandomNext}
                onAddMarker={handleAddMarker}
                onCopyPreviousBoxes={videoSession.copyPreviousBoxes}
                onMarkEmpty={videoSession.markEmptyReviewed}
                onClearRecord={videoSession.clearFrameRecord}
              />
              <AutoLabelModelPanel
                workspaceRoot={workspaceRoot}
                currentImage={overlayEntry}
                entries={overlayEntries}
                currentIndex={currentIndex}
                boxCount={boxes.length}
                proposalCount={proposals.length}
                classificationClasses={classificationClasses}
                currentClassificationKey={currentClassificationKey}
                sourceImageBase64={null}
                sourceImagePath={null}
                prepareSourceImagePath={hasFrameRecord ? prepareAutoLabelFramePath : undefined}
                sourceUnavailableMessage={hasFrameRecord ? "Preparing marker frame..." : "Add a marker or use Random Next to run video Auto Label."}
                autoRunAllowed={hasFrameRecord && !videoSession.reviewed}
                onApplyDetectPredictions={applyAutoLabelPredictions}
                onAssignClassificationClass={assignOverlayClassificationClass}
                onClassesChanged={reloadWorkspaceClasses}
              />
              {renderAnalysisPanel()}
            </div>
          )}
        />
      </main>
    </div>
  );
}
