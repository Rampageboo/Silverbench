import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { useWorkspace } from "../../app/useWorkspace";
import { useVideoAnnotationSession } from "../video/useVideoAnnotationSession";
import { BoxLabelSurface } from "../box-label/BoxLabelPage";
import { useBoxLabel } from "../box-label/useBoxLabel";
import { BoxLabelView } from "../box-label/BoxLabelView";
import type { BoxLabelEntry } from "../box-label/boxLabelCore";
import { useVideoSampling, type SamplingMode } from "../video/useVideoSampling";
import { LabelWorkbenchContext } from "./LabelWorkbenchContext";
import { LabelWorkbenchHeader } from "./LabelWorkbenchHeader";
import { LabelWorkbenchInspector } from "./LabelWorkbenchInspector";
import { LabelMediaGrid, type LabelMediaSelection } from "./LabelMediaGrid";
import { AutoLabelModelPanel } from "./AutoLabelModelPanel";
import type {
  LabelSourceSummary,
  LabelWorkbenchActionGroup,
  LabelWorkbenchContextValue,
  LabelWorkbenchInspectorState,
  LabelWorkbenchMode,
} from "./labelWorkbenchTypes";

type Props = {
  active?: boolean;
  onReady?: () => void;
};

const SAMPLING_MODE_LABELS: Record<SamplingMode, string> = {
  "whole-video": "Whole video",
  "segments-preferred": "Segments preferred",
  "segments-only": "Segments only",
};

const SAMPLING_MODES: SamplingMode[] = ["whole-video", "segments-preferred", "segments-only"];

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

function VideoFrameControlsPanel({
  sourceLabel,
  segmentCount,
  samplingMode,
  minSpacingMs,
  current,
  annotatedFrameCount,
  hasFrameRecord,
  reviewed,
  videoDurationMs,
  onSamplingModeChange,
  onMinSpacingMsChange,
  onRandomNext,
  onAddMarker,
  onCopyPreviousBoxes,
  onMarkReviewed,
  onMarkEmpty,
  onClearRecord,
}: {
  sourceLabel: string;
  segmentCount: number;
  samplingMode: SamplingMode;
  minSpacingMs: number;
  current: boolean;
  annotatedFrameCount: number;
  hasFrameRecord: boolean;
  reviewed: boolean;
  videoDurationMs: number;
  onSamplingModeChange: (mode: SamplingMode) => void;
  onMinSpacingMsChange: (value: number) => void;
  onRandomNext: () => void;
  onAddMarker: () => void;
  onCopyPreviousBoxes: () => void;
  onMarkReviewed: () => void;
  onMarkEmpty: () => void;
  onClearRecord: () => void;
}) {
  return (
    <section className="video-frame-controls-panel">
      <div className="video-frame-controls-head">
        <span>Video Controls</span>
        <span>{segmentCount} segment(s)</span>
      </div>
      <div className="video-frame-controls-form">
        <div className="video-frame-control-source" title={sourceLabel}>Source: {sourceLabel}</div>
        <label>
          <span>Sampling mode</span>
          <select value={samplingMode} onChange={(event) => onSamplingModeChange(event.target.value as SamplingMode)}>
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
            onChange={(event) => onMinSpacingMsChange(Math.max(0, Number(event.target.value) || 0))}
          />
        </label>
      </div>
      <div className="video-frame-controls-actions">
        <button type="button" className="primary" onClick={onRandomNext} disabled={!current || videoDurationMs <= 0}>
          Random Next
        </button>
        <button type="button" onClick={onAddMarker} disabled={!current}>
          Add Marker
        </button>
        <button type="button" onClick={onCopyPreviousBoxes} disabled={!current || annotatedFrameCount <= 0}>
          Copy Previous Boxes
        </button>
        <button type="button" onClick={onMarkReviewed} disabled={!current}>
          {reviewed ? "Unmark Reviewed" : "Mark Reviewed"}
        </button>
        <button type="button" onClick={onMarkEmpty} disabled={!current}>
          Mark Empty
        </button>
        <button type="button" className="danger" onClick={onClearRecord} disabled={!hasFrameRecord}>
          Clear Marker
        </button>
      </div>
    </section>
  );
}

function VideoBoxLabelSurface({
  workspaceRoot,
  videoSession,
  imagePool,
  activeMediaPosition,
  mediaCount,
  onNavigateBoundary,
}: {
  workspaceRoot: string;
  videoSession: ReturnType<typeof useVideoAnnotationSession>;
  imagePool: ReturnType<typeof useBoxLabel>;
  activeMediaPosition: number;
  mediaCount: number;
  onNavigateBoundary: (delta: -1 | 1) => void;
}) {
  const entry = useMemo(
    () => videoSession.current && (videoSession.previewUrl || videoSession.previewBase64)
      ? videoFrameEntry(videoSession.current.name, videoSession.time, activeMediaPosition, mediaCount)
      : null,
    [activeMediaPosition, mediaCount, videoSession.current, videoSession.previewBase64, videoSession.previewUrl, videoSession.time]
  );
  const entries = useMemo(() => entry ? [entry] : [], [entry]);
  const selected = useMemo(() => entry ? new Set([entry.basename]) : new Set<string>(), [entry]);
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
  const autoLabelFrameBase64 = hasFrameRecord ? videoSession.previewBase64 : null;

  const loadLabelsOverride = useCallback(async (target: BoxLabelEntry) => {
    const targetTime = videoFrameEntryTime(target);
    return targetTime === null ? [] : videoSession.loadBoxesAtTime(targetTime);
  }, [videoSession]);
  const saveLabelsOverride = useCallback(async (target: BoxLabelEntry, boxes: Parameters<typeof videoSession.updateCurrentFrame>[0]) => {
    const targetTime = videoFrameEntryTime(target);
    if (targetTime === null) throw new Error("Cannot resolve video timestamp for label save.");
    return videoSession.updateFrameAtTime(targetTime, boxes, true);
  }, [videoSession]);
  const assignClassificationClass = useCallback(async (classKey: string | null) => {
    if (classKey) videoSession.setClfClass(classKey);
    else videoSession.clearClfLabel();
  }, [videoSession]);
  const handleRandomNext = useCallback(() => {
    const candidate = sampling.randomNext();
    if (!candidate) return;
    const nextTime = candidate.timestampMs / 1000;
    videoSession.markTimestamp(nextTime, {
      kind: "random",
      samplingMode: sampling.samplingMode,
      segmentId: candidate.segmentId,
    });
    videoSession.gotoTime(nextTime);
  }, [sampling, videoSession]);
  const handleAddMarker = useCallback(() => {
    sampling.setLastSource("manual");
    videoSession.markCurrentTimestamp({ kind: "manual" });
  }, [sampling, videoSession]);
  const handleGotoTime = useCallback((nextTime: number) => {
    sampling.setLastSource("manual");
    videoSession.gotoTime(nextTime);
  }, [sampling, videoSession]);
  const handleMarkerPointerDown = useCallback((event: ReactPointerEvent<HTMLButtonElement>, markerTime: number) => {
    event.preventDefault();
    event.stopPropagation();
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
          detectTaskEnabled={videoSession.reviewed}
          clfTaskEnabled={Boolean(videoSession.clfTask?.reviewed)}
          onToggleDetectTaskEnabled={async () => {
            if (videoSession.current) videoSession.updateCurrentFrame(videoSession.boxes, !videoSession.reviewed);
          }}
          onToggleClfTaskEnabled={async () => {
            videoSession.toggleClfReviewed();
          }}
          onLabelsChanged={() => {}}
          onStatusText={() => {}}
          classificationClasses={videoSession.clfClassOptions}
          classificationClassesPortalId="lwbClassifyClassesSlot"
          currentClassificationKey={videoSession.clfTask?.classKey ?? null}
          onAssignClassificationClass={assignClassificationClass}
          imageUrlOverride={imageUrlOverride}
          loadLabelsOverride={loadLabelsOverride}
          saveLabelsOverride={saveLabelsOverride}
          disableProposals
          canvasOverlay={({
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
            <>
              <div className="video-frame-overlay-stack">
                <VideoFrameControlsPanel
                  sourceLabel={sourceLabel}
                  segmentCount={sampling.segmentCount}
                  samplingMode={sampling.samplingMode}
                  minSpacingMs={sampling.minSpacingMs}
                  current={Boolean(videoSession.current)}
                  annotatedFrameCount={videoSession.annotatedFrames.length}
                  hasFrameRecord={hasFrameRecord}
                  reviewed={videoSession.reviewed}
                  videoDurationMs={videoDurationMs}
                  onSamplingModeChange={sampling.setMode}
                  onMinSpacingMsChange={sampling.setMinSpacingMs}
                  onRandomNext={handleRandomNext}
                  onAddMarker={handleAddMarker}
                  onCopyPreviousBoxes={videoSession.copyPreviousBoxes}
                  onMarkReviewed={() => {
                    if (videoSession.current) videoSession.updateCurrentFrame(videoSession.boxes, !videoSession.reviewed);
                  }}
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
                  sourceImageBase64={autoLabelFrameBase64}
                  sourceUnavailableMessage={hasFrameRecord ? "Loading marker frame..." : "Add a marker or use Random Next to run video Auto Label."}
                  autoRunAllowed={hasFrameRecord && !videoSession.reviewed}
                  onApplyDetectPredictions={applyAutoLabelPredictions}
                  onAssignClassificationClass={assignOverlayClassificationClass}
                  onClassesChanged={reloadWorkspaceClasses}
                />
              </div>
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
                        handleGotoTime(marker.time);
                      }}
                    />
                  ))}
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
            </>
          )}
        />
      </main>
    </div>
  );
}

/**
 * Label Workbench shell — Phase 3A.
 *
 * Responsibilities:
 *   - Manage mode state (image / video).
 *   - Provide LabelWorkbenchContext to all descendant components.
 *   - Render the unified workbench header (LabelWorkbenchHeader).
 *   - Delegate canvas rendering to VideoLabelPage (video mode) or
 *     BoxLabelPage (image mode) — both unchanged.
 *
 * Phase 3B will wire child pages up to reportSourceSummary so the
 * header can show live source/review status.
 */
export function LabelPage({ active = true, onReady }: Props) {
  const { workspaceRoot, poolLabelFocusFilename, clearPoolLabelFocus } = useWorkspace();
  const [selection, setSelection] = useState<LabelMediaSelection>({ kind: "video", index: 0 });
  const [sourceSummary, setSourceSummary] = useState<LabelSourceSummary | null>(null);
  const [inspectorState, setInspectorState] = useState<LabelWorkbenchInspectorState | null>(null);
  const [actionGroups, setActionGroups] = useState<LabelWorkbenchActionGroup[]>([]);
  const previousVideoCountRef = useRef(0);
  const pendingVideoEntryDirectionRef = useRef<-1 | 1 | null>(null);
  const mode: LabelWorkbenchMode = selection.kind === "video" ? "video" : "image";
  const shellMode: LabelWorkbenchMode = "image";
  const imagePool = useBoxLabel({
    workspaceRoot,
    focusFilename: poolLabelFocusFilename,
    onFocusConsumed: clearPoolLabelFocus,
    onReady
  });
  const videoSession = useVideoAnnotationSession({
    workspaceRoot,
    active: active && selection.kind === "video",
    onReady,
    previewMode: "url"
  });

  const clearWorkbenchActions = useCallback(() => {
    setActionGroups([]);
  }, []);

  const reportSourceSummary = useCallback((summary: LabelSourceSummary | null) => {
    setSourceSummary(summary);
  }, []);

  const reportInspectorState = useCallback((state: LabelWorkbenchInspectorState | null) => {
    setInspectorState(state);
  }, []);

  const registerWorkbenchActions = useCallback((groups: LabelWorkbenchActionGroup[] | null) => {
    setActionGroups(groups ?? []);
  }, []);

  const handleSelectionChange = useCallback((nextSelection: LabelMediaSelection) => {
    if (nextSelection.kind === "image") {
      const index = Math.max(0, Math.min(nextSelection.index, imagePool.entries.length - 1));
      setSelection({ kind: "image", index });
    } else {
      const index = Math.max(0, Math.min(nextSelection.index, videoSession.videos.length - 1));
      setSelection({ kind: "video", index });
    }
    setSourceSummary(null);
    setInspectorState(null);
    setActionGroups([]);
  }, [imagePool.entries.length, videoSession.videos.length]);

  const mediaOrder = useMemo(() => {
    return [
      ...videoSession.videos.map((_, index) => ({ kind: "video" as const, index })),
      ...imagePool.entries.map((_, index) => ({ kind: "image" as const, index }))
    ];
  }, [imagePool.entries, videoSession.videos]);

  const activeMediaPosition = useMemo(
    () => mediaOrder.findIndex((item) => item.kind === selection.kind && item.index === selection.index),
    [mediaOrder, selection]
  );

  const selectMediaAtPosition = useCallback(
    (position: number, videoEntryDirection: -1 | 1 | null = null) => {
      const item = mediaOrder[position];
      if (!item) return;
      if (item.kind === "image") {
        pendingVideoEntryDirectionRef.current = null;
        imagePool.navigate(item.index);
      } else {
        pendingVideoEntryDirectionRef.current = videoEntryDirection;
        videoSession.setCurrentIndex(item.index);
      }
      handleSelectionChange(item);
    },
    [handleSelectionChange, imagePool, mediaOrder, videoSession]
  );

  const handleMediaBoundaryNavigate = useCallback(
    (delta: -1 | 1) => {
      if (activeMediaPosition < 0) return;
      selectMediaAtPosition(activeMediaPosition + delta, delta);
    },
    [activeMediaPosition, selectMediaAtPosition]
  );

  const handleModeChange = useCallback(
    (nextMode: LabelWorkbenchMode) => {
      if (nextMode === "image") {
        const index = Math.max(0, Math.min(imagePool.currentIndex, imagePool.entries.length - 1));
        imagePool.navigate(index);
        handleSelectionChange({ kind: "image", index });
        return;
      }
      const index = Math.max(0, Math.min(videoSession.currentIndex, videoSession.videos.length - 1));
      videoSession.setCurrentIndex(index);
      handleSelectionChange({ kind: "video", index });
    },
    [handleSelectionChange, imagePool, videoSession]
  );

  useEffect(() => {
    if (selection.kind === "image") {
      if (imagePool.entries.length) {
        if (selection.index >= imagePool.entries.length) {
          handleSelectionChange({ kind: "image", index: imagePool.entries.length - 1 });
        }
        return;
      }
      if (videoSession.videos.length) handleSelectionChange({ kind: "video", index: Math.max(0, videoSession.currentIndex) });
      return;
    }
    if (videoSession.videos.length) {
      if (selection.index >= videoSession.videos.length) {
        handleSelectionChange({ kind: "video", index: videoSession.videos.length - 1 });
      }
      return;
    }
    if (imagePool.entries.length) handleSelectionChange({ kind: "image", index: Math.max(0, imagePool.currentIndex) });
  }, [
    handleSelectionChange,
    imagePool.currentIndex,
    imagePool.entries.length,
    selection.index,
    selection.kind,
    videoSession.currentIndex,
    videoSession.videos.length,
  ]);

  useEffect(() => {
    const previousCount = previousVideoCountRef.current;
    previousVideoCountRef.current = videoSession.videos.length;
    if (videoSession.videos.length <= previousCount) return;
    const index = videoSession.currentIndex >= 0 ? videoSession.currentIndex : videoSession.videos.length - 1;
    handleSelectionChange({ kind: "video", index });
  }, [handleSelectionChange, videoSession.currentIndex, videoSession.videos.length]);

  useEffect(() => {
    if (selection.kind !== "video" || !videoSession.current || !videoSession.manifest) return;
    if (videoSession.manifest.video.path !== videoSession.current.path) return;
    const direction = pendingVideoEntryDirectionRef.current;
    if (!direction) return;
    pendingVideoEntryDirectionRef.current = null;
    const markerTimes = videoSession.timelineMarkers
      .map((marker) => marker.time)
      .filter((time) => Number.isFinite(time))
      .sort((a, b) => a - b);
    const targetTime = direction < 0 ? markerTimes.at(-1) ?? 0 : markerTimes[0] ?? 0;
    videoSession.gotoTime(targetTime);
  }, [
    selection.kind,
    selection.index,
    videoSession,
  ]);

  useEffect(() => {
    if (!active || selection.kind !== "video" || !videoSession.current) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select" || target?.isContentEditable) return;
      if (event.ctrlKey || event.altKey || event.metaKey) return;
      const key = event.key.toLowerCase();
      const delta = key === "a" ? -1 : key === "d" ? 1 : 0;
      if (!delta) return;
      event.preventDefault();
      const epsilon = 0.0005;
      const markerTimes = videoSession.timelineMarkers
        .map((marker) => marker.time)
        .filter((time) => Number.isFinite(time))
        .sort((a, b) => a - b);
      const targetTime = delta > 0
        ? markerTimes.find((time) => time > videoSession.time + epsilon)
        : [...markerTimes].reverse().find((time) => time < videoSession.time - epsilon);
      if (targetTime !== undefined) {
        videoSession.gotoTime(targetTime);
        return;
      }
      handleMediaBoundaryNavigate(delta < 0 ? -1 : 1);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    active,
    handleMediaBoundaryNavigate,
    selection.kind,
    videoSession,
  ]);

  useEffect(() => {
    if (selection.kind !== "video" || !videoSession.current) return;
    const filename = `${videoSession.current.name} @ ${Math.round(videoSession.time * 1000)}ms`;
    reportSourceSummary({
      kind: "image",
      totalImages: mediaOrder.length,
      currentIndex: activeMediaPosition >= 0 ? activeMediaPosition : null,
      filename,
      reviewStatus: videoSession.reviewed ? "approved" : "unreviewed",
    });
    reportInspectorState({
      taskKind: "both",
      reviewStatus: videoSession.reviewed ? "approved" : "unreviewed",
      classSummary: {
        activeDetectCount: videoSession.activeDetectClasses.length,
        activeClassificationCount: videoSession.clfClassOptions.length,
        observedClassCount: new Set(videoSession.boxes.map((box) => box.classId)).size,
      },
      classPalette: {
        detectClasses: videoSession.activeDetectClasses,
        classificationClasses: videoSession.clfClassOptions,
        currentDetectClassId: videoSession.currentClass,
        currentClassificationKey: videoSession.clfTask?.classKey ?? null,
        readOnlyReason: null,
      },
    });
    registerWorkbenchActions([
      {
        id: "image-review",
        label: "Review",
        actions: [
          {
            id: "review.markReviewed",
            label: videoSession.reviewed ? "Unmark Reviewed" : "Mark Reviewed",
            variant: "primary",
            run: () => {
              if (videoSession.current) videoSession.updateCurrentFrame(videoSession.boxes, !videoSession.reviewed);
            },
          },
          {
            id: "review.markEmpty",
            label: "Mark Empty",
            variant: "danger",
            run: videoSession.markEmptyReviewed,
          },
        ],
      },
    ]);
  }, [
    activeMediaPosition,
    mediaOrder.length,
    registerWorkbenchActions,
    reportInspectorState,
    reportSourceSummary,
    selection.kind,
    videoSession,
  ]);

  const ctxValue = useMemo<LabelWorkbenchContextValue>(
    () => ({
      mode: shellMode,
      setMode: handleModeChange,
      renderMode: "workbench-embedded",
      reportSourceSummary,
      reportInspectorState,
      registerWorkbenchActions,
      clearWorkbenchActions,
    }),
    [
      clearWorkbenchActions,
      handleModeChange,
      shellMode,
      reportInspectorState,
      reportSourceSummary,
      registerWorkbenchActions,
    ]
  );

  if (!workspaceRoot.trim()) {
    return (
      <div className="label-page label-page--no-workspace">
        <div className="empty">
          <strong>Open a workspace to start labeling.</strong>
        </div>
      </div>
    );
  }

  const wsName = workspaceRoot.replace(/[/\\]+$/, "").split(/[/\\]/).at(-1) || workspaceRoot;

  return (
    <LabelWorkbenchContext.Provider value={ctxValue}>
      <div className="label-page label-page--workbench">
        <LabelWorkbenchHeader
          mode={mode}
          workspaceName={wsName}
          workspacePath={workspaceRoot}
          sourceSummary={sourceSummary}
        />
        <div className="label-workbench-body label-workbench-body--unified-media">
          <LabelMediaGrid
            pool={imagePool}
            videoSession={videoSession}
            selection={selection}
            onSelectionChange={handleSelectionChange}
          />
          <div className="label-content">
            {mode === "video" ? (
              <VideoBoxLabelSurface
                workspaceRoot={workspaceRoot}
                videoSession={videoSession}
                imagePool={imagePool}
                activeMediaPosition={activeMediaPosition}
                mediaCount={mediaOrder.length}
                onNavigateBoundary={handleMediaBoundaryNavigate}
              />
            ) : (
              <BoxLabelSurface
                pool={imagePool}
                showGallery={false}
                showSideStack
                unifiedMedia
                onImageNavigate={(index) => handleSelectionChange({ kind: "image", index })}
                onNavigateBoundary={handleMediaBoundaryNavigate}
                canvasOverlay={({
                  entry,
                  entries,
                  currentIndex,
                  boxes,
                  proposals,
                  classificationClasses,
                  currentClassificationKey,
                  applyAutoLabelPredictions,
                  assignClassificationClass,
                  reloadWorkspaceClasses,
                }) => (
                  <AutoLabelModelPanel
                    workspaceRoot={workspaceRoot}
                    currentImage={entry}
                    entries={entries}
                    currentIndex={currentIndex}
                    boxCount={boxes.length}
                    proposalCount={proposals.length}
                    classificationClasses={classificationClasses}
                    currentClassificationKey={currentClassificationKey}
                    onApplyDetectPredictions={applyAutoLabelPredictions}
                    onAssignClassificationClass={assignClassificationClass}
                    onClassesChanged={reloadWorkspaceClasses}
                  />
                )}
              />
            )}
          </div>
          <LabelWorkbenchInspector
            mode={shellMode}
            sourceSummary={sourceSummary}
            inspectorState={inspectorState}
            actionGroups={actionGroups}
          />
        </div>
      </div>
    </LabelWorkbenchContext.Provider>
  );
}
