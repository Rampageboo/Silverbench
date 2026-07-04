import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ensureVideoProxy, saveVideoFrame, videoSourceUrl } from "../video/videoCaptureApi";
import { useVideoSampling, type SamplingMode } from "../video/useVideoSampling";
import type { VideoAnnotationSession } from "../video/useVideoAnnotationSession";
import { formatVideoClock } from "../video/videoAnnotationDomain";
import { BoxLabelView } from "../box-label/BoxLabelView";
import type { BoxLabelEntry } from "../box-label/boxLabelCore";
import type { BoxLabelModel } from "../box-label/useBoxLabel";
import { AutoLabelModelPanel } from "./AutoLabelModelPanel";
import { analysisClassPanelSummaries, type AnalysisStats } from "./labelAnalysisStats";
import { adjacentVideoMarkerTime, useVideoPlaybackTimeline } from "./useVideoPlaybackTimeline";

export {
  initialVideoAnnotationTargetTime,
  markerDrivenAnnotationTargetTime,
  nextVideoKeyboardTime,
  shouldClearActiveMarker,
  videoFrameKeyboardCommand,
  wrappedAdjacentVideoMarkerTime,
  type VideoFrameKeyboardCommand,
} from "./useVideoPlaybackTimeline";

const SAMPLING_MODE_LABELS: Record<SamplingMode, string> = {
  "whole-video": "Whole video",
  "segments-preferred": "Segments preferred",
  "segments-only": "Segments only",
};

const SAMPLING_MODES: SamplingMode[] = ["whole-video", "segments-preferred", "segments-only"];
const RANDOM_MULTIPLIERS = [1, 5, 10] as const;
const AUTO_LABEL_FRAME_SAVE_TIMEOUT_MS = 15000;
type RandomMultiplier = (typeof RANDOM_MULTIPLIERS)[number];

function withVideoFrameTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error(message)), timeoutMs);
    promise.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        window.clearTimeout(timer);
        reject(error);
      }
    );
  });
}

function waitForVideoPreviewCapture(
  capture: ((options?: { expectedTime?: number; toleranceSeconds?: number }) => string | null) | undefined,
  expectedTime: number,
  attempts = 10
): Promise<string | null> {
  const value = capture?.({ expectedTime, toleranceSeconds: 0.04 }) ?? null;
  if (value || attempts <= 1) return Promise.resolve(value);
  return new Promise((resolve) => {
    window.setTimeout(() => {
      resolve(waitForVideoPreviewCapture(capture, expectedTime, attempts - 1));
    }, 50);
  });
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

export function visibleVideoDetectBoxes<T>(boxes: T[], markerIsActive: boolean, detectEnabled: boolean) {
  return markerIsActive && detectEnabled ? boxes : [];
}

export function videoLabelsReloadKey({
  annotationTime,
  detectEnabled,
  frameUpdatedAt,
  visibleBoxCount,
}: {
  annotationTime: number | null;
  detectEnabled: boolean;
  frameUpdatedAt?: string;
  visibleBoxCount: number;
}) {
  return [
    annotationTime === null ? "none" : Math.round(annotationTime * 1000),
    detectEnabled ? "detect-on" : "detect-off",
    frameUpdatedAt || "no-frame",
    visibleBoxCount,
  ].join(":");
}

export function VideoFrameControlsPanel({
  segmentCount,
  samplingMode,
  minSpacingMs,
  randomMultiplier,
  current,
  disabled = false,
  canDuplicateToNext,
  hasFrameRecord,
  videoDurationMs,
  onSamplingModeChange,
  onMinSpacingMsChange,
  onRandomMultiplierChange,
  onRandom,
  onRandomNext,
  onAddMarker,
  onDuplicateToNext,
  onMarkEmpty,
  onClearRecord,
}: {
  segmentCount: number;
  samplingMode: SamplingMode;
  minSpacingMs: number;
  randomMultiplier: RandomMultiplier;
  current: boolean;
  disabled?: boolean;
  canDuplicateToNext: boolean;
  hasFrameRecord: boolean;
  videoDurationMs: number;
  onSamplingModeChange: (mode: SamplingMode) => void;
  onMinSpacingMsChange: (value: number) => void;
  onRandomMultiplierChange: (value: RandomMultiplier) => void;
  onRandom: () => void;
  onRandomNext: () => void;
  onAddMarker: () => void;
  onDuplicateToNext: () => void;
  onMarkEmpty: () => void;
  onClearRecord: () => void;
}) {
  const controlsDisabled = disabled || !current;
  return (
    <section className={`video-frame-controls-panel${controlsDisabled ? " is-disabled" : ""}`}>
      <div className="video-frame-controls-head">
        <span>Video Controls</span>
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
        <button type="button" onClick={onDuplicateToNext} disabled={controlsDisabled || !canDuplicateToNext}>
          Duplicate to Next
        </button>
        <button type="button" onClick={onRandomNext} disabled={controlsDisabled || videoDurationMs <= 0}>
          Random Next
        </button>
        <button type="button" onClick={onMarkEmpty} disabled={controlsDisabled || !hasFrameRecord}>
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
  const [videoProxyByPath, setVideoProxyByPath] = useState<Map<string, string>>(() => new Map());
  const [videoProxyPendingPaths, setVideoProxyPendingPaths] = useState<Set<string>>(() => new Set());
  const [videoProxyFailedPaths, setVideoProxyFailedPaths] = useState<Set<string>>(() => new Set());
  const [nativeFailedVideoPaths, setNativeFailedVideoPaths] = useState<Set<string>>(() => new Set());
  const [randomMultiplier, setRandomMultiplier] = useState<RandomMultiplier>(1);
  const selectedBoxIdRef = useRef<number | null>(null);
  const autoLabelFramePathCacheRef = useRef<Map<string, Promise<string | null>>>(new Map());
  const root = workspaceRoot.trim();
  const proxiedVideoPath = currentVideoPath ? videoProxyByPath.get(currentVideoPath) ?? null : null;
  const nativeVideoPath = currentVideoPath && !nativeFailedVideoPaths.has(proxiedVideoPath ?? currentVideoPath)
    ? (proxiedVideoPath ?? currentVideoPath)
    : null;
  const nativeVideoUrl = useMemo(
    () => nativeVideoPath && root
      ? videoSourceUrl(root, nativeVideoPath)
      : null,
    [nativeVideoPath, root]
  );
  const hasPreviewImage = Boolean(nativeVideoUrl || videoSession.previewUrl || videoSession.previewBase64);
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
  const {
    annotationTime,
    markerIsActive,
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
  } = useVideoPlaybackTimeline({
    videoSession,
    currentVideoPath,
    currentFrameTime,
    nativeVideoUrl,
    proxiedVideoPath,
    selectedBoxIdRef,
    onNavigateBoundary,
    setLastSource: sampling.setLastSource,
  });
  const entryTime = annotationTime ?? 0;
  const entry = useMemo(
    () => videoSession.current && hasPreviewImage
      ? videoFrameEntry(videoSession.current.name, entryTime, activeMediaPosition, mediaCount)
      : null,
    [activeMediaPosition, entryTime, hasPreviewImage, mediaCount, videoSession.current]
  );
  const entries = useMemo(() => entry ? [entry] : [], [entry]);
  const selected = useMemo(() => entry ? new Set([entry.basename]) : new Set<string>(), [entry]);
  const metadata = useMemo(() => new Map(), []);
  const activeFrame = markerIsActive ? videoSession.currentFrame : null;
  const activeBoxes = useMemo(
    () => markerIsActive ? videoSession.boxes : [],
    [markerIsActive, videoSession.boxes]
  );
  const activeReviewed = markerIsActive ? videoSession.reviewed : false;
  const activeDetectExportEnabled = markerIsActive ? videoSession.detectExportEnabled : true;
  const activeClfExportEnabled = markerIsActive ? videoSession.clfExportEnabled : true;
  const activeClfTask = markerIsActive ? videoSession.clfTask : undefined;
  const visibleDetectBoxes = visibleVideoDetectBoxes(activeBoxes, markerIsActive, activeDetectExportEnabled);
  const labelsReloadKey = videoLabelsReloadKey({
    annotationTime,
    detectEnabled: activeDetectExportEnabled,
    frameUpdatedAt: activeFrame?.updatedAt,
    visibleBoxCount: visibleDetectBoxes.length,
  });
  const classImageCounts = useMemo(() => {
    const counts = new Map<number, number>();
    for (const box of visibleDetectBoxes) counts.set(box.classId, (counts.get(box.classId) ?? 0) + 1);
    return counts;
  }, [visibleDetectBoxes]);
  const imageUrlOverride = videoSession.previewUrl || (videoSession.previewBase64 ? `data:image/jpeg;base64,${videoSession.previewBase64}` : null);
  const hasFrameRecord = markerIsActive && Boolean(videoSession.current);
  const autoLabelFrameTime = activeFrame?.time ?? annotationTime;
  const autoLabelVideoPath = videoSession.current?.path ?? "";
  const classPanelSummaries = useMemo(() => analysisClassPanelSummaries(analysisStats), [analysisStats]);
  const nextMarkerTime = useMemo(
    () => annotationTime === null
      ? null
      : adjacentVideoMarkerTime(videoSession.timelineMarkers.map((marker) => marker.time), annotationTime, 1),
    [annotationTime, videoSession.timelineMarkers]
  );
  const canDuplicateToNextMarker = hasFrameRecord && activeBoxes.length > 0 && nextMarkerTime !== null;
  const previewMediaIndexText = activeMediaPosition >= 0 && mediaCount > 0
    ? `${activeMediaPosition + 1} / ${mediaCount}`
    : `0 / ${mediaCount}`;
  const previewReviewLabel = activeReviewed ? "Reviewed" : "Unreviewed";
  const previewStatusItems = useMemo(
    () => [
      formatVideoClock(annotationTime ?? videoSession.time),
      sourceLabel,
    ],
    [annotationTime, sourceLabel, videoSession.time]
  );

  const handleDuplicateToNextMarker = useCallback(() => {
    if (!videoSession.current || annotationTime === null) {
      videoSession.showError("Select or add a marker before duplicating boxes.", "video.duplicate-next");
      return;
    }
    if (!activeBoxes.length) {
      videoSession.showError("Current marker has no boxes to duplicate.", "video.duplicate-next");
      return;
    }
    if (nextMarkerTime === null) {
      videoSession.showError("No next marker to duplicate into.", "video.duplicate-next");
      return;
    }
    videoSession.updateFrameAtTime(nextMarkerTime, activeBoxes, true);
    selectMarkerTime(nextMarkerTime);
  }, [activeBoxes, annotationTime, nextMarkerTime, selectMarkerTime, videoSession]);

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
    const pending = withVideoFrameTimeout(
      saveVideoFrame(autoLabelVideoPath, outputRoot, targetTime, "autolabel", "jpg"),
      AUTO_LABEL_FRAME_SAVE_TIMEOUT_MS,
      "Preparing auto-label frame timed out."
    )
      .then((path) => workspaceRelativePath(root, path))
      .catch((error) => {
        autoLabelFramePathCacheRef.current.delete(key);
        throw error;
      });
    autoLabelFramePathCacheRef.current.set(key, pending);
    return pending;
  }, [autoLabelFrameTime, autoLabelVideoPath, hasFrameRecord, workspaceRoot]);

  const loadBoxesAtVideoTime = videoSession.loadBoxesAtTime;
  const updateVideoFrameAtTime = videoSession.updateFrameAtTime;
  const loadLabelsOverride = useCallback(async (target: BoxLabelEntry) => {
    if (annotationTime === null || !activeDetectExportEnabled) return [];
    const targetTime = videoFrameEntryTime(target);
    if (targetTime === null || Math.round(targetTime * 1000) !== Math.round(annotationTime * 1000)) return [];
    return targetTime === null ? [] : loadBoxesAtVideoTime(targetTime);
  }, [activeDetectExportEnabled, annotationTime, loadBoxesAtVideoTime]);
  const saveLabelsOverride = useCallback(async (target: BoxLabelEntry, boxes: Parameters<typeof videoSession.updateCurrentFrame>[0]) => {
    if (annotationTime === null) throw new Error("Select or add a marker before saving video labels.");
    const targetTime = videoFrameEntryTime(target);
    if (targetTime === null) throw new Error("Cannot resolve video timestamp for label save.");
    if (Math.round(targetTime * 1000) !== Math.round(annotationTime * 1000)) {
      throw new Error("Video marker changed before labels could be saved.");
    }
    return updateVideoFrameAtTime(targetTime, boxes, true);
  }, [annotationTime, updateVideoFrameAtTime]);
  const assignClassificationClass = useCallback(async (classKey: string | null) => {
    if (annotationTime === null) {
      videoSession.showError("Select or add a marker before assigning classification.", "video.clf.assign");
      return;
    }
    if (classKey) videoSession.setClfClass(classKey);
    else videoSession.clearClfLabel();
  }, [annotationTime, videoSession]);
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
  const handleNativeVideoLoadError = useCallback((error?: { code?: number; message: string }) => {
    const originalPath = videoSession.current?.path ?? "";
    const failedPath = nativeVideoPath ?? originalPath;
    if (!originalPath || !failedPath) return;
    stopPlayback();
    setNativeFailedVideoPaths((paths) => {
      if (paths.has(failedPath)) return paths;
      const next = new Set(paths);
      next.add(failedPath);
      return next;
    });
    if (failedPath !== originalPath || videoProxyByPath.has(originalPath) || videoProxyPendingPaths.has(originalPath) || videoProxyFailedPaths.has(originalPath) || !root) {
      return;
    }
    setVideoProxyPendingPaths((paths) => {
      const next = new Set(paths);
      next.add(originalPath);
      return next;
    });
    ensureVideoProxy(root, originalPath)
      .then((result) => {
        setVideoProxyByPath((items) => {
          const next = new Map(items);
          next.set(originalPath, result.path);
          return next;
        });
        setNativeFailedVideoPaths((paths) => {
          const next = new Set(paths);
          next.delete(result.path);
          return next;
        });
      })
      .catch((reason) => {
        setVideoProxyFailedPaths((paths) => {
          const next = new Set(paths);
          next.add(originalPath);
          return next;
        });
        videoSession.showError(error?.message ? `${error.message} Proxy unavailable: ${reason}` : reason, "video.proxy");
      })
      .finally(() => {
        setVideoProxyPendingPaths((paths) => {
          const next = new Set(paths);
          next.delete(originalPath);
          return next;
        });
      });
  }, [nativeVideoPath, root, stopPlayback, videoProxyByPath, videoProxyFailedPaths, videoProxyPendingPaths, videoSession]);

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
            if (videoSession.current && annotationTime !== null) videoSession.updateCurrentFrame(activeBoxes, !activeReviewed);
          }}
          onToggleFlagged={async () => {}}
          detectTaskEnabled={activeDetectExportEnabled}
          clfTaskEnabled={activeClfExportEnabled}
          onToggleDetectTaskEnabled={async () => {
            if (annotationTime !== null) videoSession.toggleDetectExportEnabled();
          }}
          onToggleClfTaskEnabled={async () => {
            if (annotationTime !== null) videoSession.toggleClfExportEnabled();
          }}
          onLabelsChanged={() => {}}
          onStatusText={() => {}}
          classPanelSummaries={classPanelSummaries}
          classificationClasses={videoSession.clfClassOptions}
          classificationClassesPortalId="lwbClassifyClassesSlot"
          currentClassificationKey={activeClfTask?.classKey ?? null}
          onAssignClassificationClass={assignClassificationClass}
          imageUrlOverride={imageUrlOverride}
          reloadLabelsOnImageUrlChange={false}
          labelsReloadKey={labelsReloadKey}
          previewSourceName={videoSession.current?.name ?? "No video selected"}
          previewIndexText={previewMediaIndexText}
          previewReviewLabel={previewReviewLabel}
          previewStatusItems={previewStatusItems}
          videoUrlOverride={nativeVideoUrl}
          videoPlaybackTime={playbackTime}
          videoSeekTime={playbackTime}
          videoSeekToken={videoSeekToken}
          videoPlaying={Boolean(nativeVideoUrl && playing)}
          hideAnnotationsWhilePlaying
          onVideoPlaybackTimeChange={handleVideoPlaybackTimeChange}
          onVideoEnded={handleVideoEnded}
          onVideoLoadError={handleNativeVideoLoadError}
          loadLabelsOverride={loadLabelsOverride}
          saveLabelsOverride={saveLabelsOverride}
          disableProposals
          canvasOverlayPlacement="zoom-side"
          canvasOverlay={({ selectedBoxId }) => {
            selectedBoxIdRef.current = selectedBoxId;
            return (
              <div className="video-frame-timeline-overlay">
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
                        selectMarkerTime(marker.time);
                      }}
                    />
                  ))}
                </div>
                <input
                  type="range"
                  min="0"
                  max={videoSession.maxTime}
                  step="0.001"
                  value={Math.min(playbackTime, videoSession.maxTime)}
                  disabled={!videoSession.current}
                  onInput={(event) => seekPlayerToTime(Number(event.currentTarget.value))}
                  onChange={(event) => seekPlayerToTime(Number(event.target.value))}
                  onKeyDown={handleTimelineRangeKeyDown}
                  onPointerUp={(event) => event.currentTarget.blur()}
                  aria-label="Video timestamp"
                />
                <div className="video-frame-timeline-controls">
                  <button
                    type="button"
                    className="video-frame-playback-btn"
                    disabled={!videoSession.current || !nativeVideoUrl}
                    aria-pressed={playing}
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      togglePlayback();
                    }}
                  >
                    {playing ? "Pause" : "Play"}
                  </button>
                </div>
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
            capturePreviewBase64,
          }) => (
            <div className="lwb-workbench-dock">
              <VideoFrameControlsPanel
                segmentCount={sampling.segmentCount}
                samplingMode={sampling.samplingMode}
                minSpacingMs={sampling.minSpacingMs}
                randomMultiplier={randomMultiplier}
                current={Boolean(videoSession.current)}
                canDuplicateToNext={canDuplicateToNextMarker}
                hasFrameRecord={hasFrameRecord}
                videoDurationMs={videoDurationMs}
                onSamplingModeChange={sampling.setMode}
                onMinSpacingMsChange={sampling.setMinSpacingMs}
                onRandomMultiplierChange={setRandomMultiplier}
                onRandom={handleRandom}
                onRandomNext={handleRandomNext}
                onAddMarker={handleAddMarker}
                onDuplicateToNext={() => {
                  handleDuplicateToNextMarker();
                }}
                onMarkEmpty={() => {
                  if (annotationTime !== null) videoSession.markEmptyReviewed();
                }}
                onClearRecord={() => {
                  if (annotationTime !== null) videoSession.clearFrameRecord();
                }}
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
                prepareSourceImageBase64={hasFrameRecord ? (target) => {
                  const targetTime = videoFrameEntryTime(target) ?? annotationTime;
                  return targetTime === null ? null : waitForVideoPreviewCapture(capturePreviewBase64, targetTime);
                } : undefined}
                prepareSourceImagePath={hasFrameRecord ? prepareAutoLabelFramePath : undefined}
                requireSourceImageBase64={hasFrameRecord}
                sourceUnavailableMessage={hasFrameRecord ? "Cannot confirm Auto Label frame matches the visible label frame." : "Add a marker or use Random Next to run video Auto Label."}
                autoRunAllowed={hasFrameRecord && !activeReviewed}
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
