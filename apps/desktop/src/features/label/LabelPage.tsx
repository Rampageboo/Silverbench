import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useWorkspace } from "../../app/useWorkspace";
import { useVideoAnnotationSession } from "../video/useVideoAnnotationSession";
import { BoxLabelSurface } from "../box-label/BoxLabelPage";
import { useBoxLabel } from "../box-label/useBoxLabel";
import { LabelWorkbenchContext } from "./LabelWorkbenchContext";
import { LabelWorkbenchHeader } from "./LabelWorkbenchHeader";
import { LabelWorkbenchInspector } from "./LabelWorkbenchInspector";
import { LabelMediaGrid, type LabelMediaSelection } from "./LabelMediaGrid";
import { AutoLabelModelPanel } from "./AutoLabelModelPanel";
import { VideoBoxLabelSurface, VideoFrameControlsPanel } from "./VideoBoxLabelSurface";
import { classBoxColor } from "../shared/classColors";
import { useWorkspaceClasses } from "../workspace/useWorkspaceClasses";
import { activeDetectClassDefs } from "../workspace/workspaceClassTaxonomy";
import {
  HEATMAP_COLS,
  HEATMAP_ROWS,
  analysisClassPanelSummaries,
  clampUnit,
  combineAnalysisStats,
  videoAnalysisStats,
  type AnalysisClassBucket,
  type AnalysisStats,
} from "./labelAnalysisStats";
import { buildMediaOrder, normalizeMediaSelection, shouldSelectNewlyLoadedVideo } from "./labelMediaSelection";
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

function AnalysisPanel({
  stats,
  detectClassNames,
}: {
  stats: AnalysisStats;
  detectClassNames?: Map<string, string>;
}) {
  const [heatmapClassKey, setHeatmapClassKey] = useState("all");
  const heatmapPoints = heatmapClassKey === "all"
    ? stats.detectPoints
    : stats.detectPoints.filter((point) => point.classKey === heatmapClassKey);
  const heatmapCells = Array.from({ length: HEATMAP_COLS * HEATMAP_ROWS }, (_, index) => ({
    index,
    col: index % HEATMAP_COLS,
    row: Math.floor(index / HEATMAP_COLS),
    count: 0,
    weight: 0,
  }));
  for (const point of heatmapPoints) {
    const col = Math.min(HEATMAP_COLS - 1, Math.floor(clampUnit(point.x) * HEATMAP_COLS));
    const row = Math.min(HEATMAP_ROWS - 1, Math.floor(clampUnit(point.y) * HEATMAP_ROWS));
    const cell = heatmapCells[row * HEATMAP_COLS + col];
    cell.count += 1;
    cell.weight += 1 + Math.sqrt(Math.max(0, point.area));
  }
  const heatmapMax = Math.max(1, ...heatmapCells.map((cell) => cell.weight));

  useEffect(() => {
    if (heatmapClassKey === "all") return;
    if (!stats.detectClasses.some((bucket) => bucket.key === heatmapClassKey)) setHeatmapClassKey("all");
  }, [heatmapClassKey, stats.detectClasses]);

  const colorForBucket = (bucket: AnalysisClassBucket, index: number, tone: "detect" | "clf") => {
    if (tone === "detect") {
      const classId = Number(bucket.key);
      if (Number.isFinite(classId)) return classBoxColor(Math.max(0, Math.trunc(classId)));
    }
    const hue = (188 + index * 137.508) % 360;
    return `hsl(${hue} 78% 58%)`;
  };

  const bucketName = (bucket: AnalysisClassBucket, tone: "detect" | "clf") => {
    if (tone === "detect") return detectClassNames?.get(bucket.key) ?? bucket.name;
    return bucket.name;
  };

  const renderClassBarGroup = (
    title: string,
    summary: string,
    buckets: AnalysisClassBucket[],
    tone: "detect" | "clf"
  ) => {
    const maxCount = Math.max(1, ...buckets.map((bucket) => bucket.count));
    return (
    <div className={`lwb-analysis-chart lwb-analysis-chart--${tone}`}>
      <div className="lwb-analysis-chart-title">
        <span>{title}</span>
        <strong>{summary}</strong>
      </div>
      <div className="lwb-analysis-class-bars">
        {buckets.length ? buckets.map((bucket, index) => {
          const percent = Math.max(4, (bucket.count / maxCount) * 100);
          const barColor = colorForBucket(bucket, index, tone);
          const name = bucketName(bucket, tone);
          return (
            <div
              key={bucket.key}
              className="lwb-analysis-class-bar-row"
              style={{
                "--bar-color": barColor,
              } as CSSProperties}
              title={`${name}: ${bucket.count}`}
            >
              <span>{name}</span>
              <div className="lwb-analysis-bar-track" aria-hidden="true">
                <div className="lwb-analysis-bar-fill" style={{ width: `${percent}%` }} />
              </div>
              <strong>{bucket.count}</strong>
            </div>
          );
        }) : (
          <div className="lwb-analysis-empty">No classes.</div>
        )}
      </div>
    </div>
  );
  };

  return (
    <section className="lwb-analysis-panel" aria-label="Analysis">
      {renderClassBarGroup("Detect Classes", `${stats.detectClasses.length} cls`, stats.detectClasses, "detect")}
      {renderClassBarGroup("Clf Classes", `${stats.clfClasses.length} cls`, stats.clfClasses, "clf")}
      <div className="lwb-analysis-heatmap">
        <div className="lwb-analysis-heatmap-head">
          <span>Det heatmap</span>
          <select
            value={heatmapClassKey}
            onChange={(event) => setHeatmapClassKey(event.target.value)}
            aria-label="Detect heatmap class"
          >
            <option value="all">All classes</option>
            {stats.detectClasses.slice(0, 80).map((bucket) => (
              <option key={bucket.key} value={bucket.key}>
                {detectClassNames?.get(bucket.key) ?? bucket.name}
              </option>
            ))}
          </select>
        </div>
        <div className="lwb-analysis-heatmap-grid">
          {heatmapPoints.length ? heatmapCells.map((cell) => {
            const heat = cell.weight / heatmapMax;
            return (
              <div
                key={cell.index}
                className="lwb-analysis-heatmap-cell"
                style={{
                  "--heat": heat,
                } as CSSProperties}
                title={`row ${cell.row + 1}, col ${cell.col + 1}: ${cell.count} box(es)`}
              >
                <span>{cell.count ? cell.count : ""}</span>
              </div>
            );
          }) : (
            <div className="lwb-analysis-empty">No detect boxes.</div>
          )}
        </div>
      </div>
    </section>
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
  const [mediaRevealToken, setMediaRevealToken] = useState(0);
  const previousVideoCountRef = useRef(0);
  const pendingVideoEntryDirectionRef = useRef<-1 | 1 | null>(null);
  const mode: LabelWorkbenchMode = selection.kind === "video" ? "video" : "image";
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
    previewMode: "url",
    loadMarkerBase64: false
  });
  const {
    manifest: workspaceClassManifest,
    load: loadWorkspaceClasses,
  } = useWorkspaceClasses(workspaceRoot);
  const analysisStats = useMemo(
    () => combineAnalysisStats(imagePool.datasetStats, videoAnalysisStats(videoSession)),
    [imagePool.datasetStats, videoSession.classes, videoSession.clfClassOptions, videoSession.manifest, videoSession.videos.length]
  );
  const detectClassNames = useMemo(() => {
    const names = new Map<string, string>();
    for (const item of videoSession.classes) names.set(String(item.id), item.name);
    for (const item of inspectorState?.classPalette?.detectClasses ?? []) {
      if (typeof item.id === "number" && item.name) names.set(String(item.id), item.name);
    }
    if (workspaceClassManifest) {
      for (const item of activeDetectClassDefs(workspaceClassManifest)) {
        names.set(String(item.yoloId), item.name);
      }
    }
    return names;
  }, [inspectorState?.classPalette?.detectClasses, videoSession.classes, workspaceClassManifest]);
  const classPanelSummaries = useMemo(() => analysisClassPanelSummaries(analysisStats), [analysisStats]);
  const mediaCatalogLoading = Boolean(workspaceRoot.trim()) && (
    !videoSession.videosLoaded ||
    (imagePool.pending && imagePool.entries.length === 0)
  );
  const mediaCatalogReady = !mediaCatalogLoading;

  useEffect(() => {
    if (!workspaceRoot.trim()) return;
    void loadWorkspaceClasses();
  }, [loadWorkspaceClasses, workspaceRoot]);

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

  const revealActiveMediaTile = useCallback(() => {
    setMediaRevealToken((token) => token + 1);
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
    return buildMediaOrder(videoSession.videos.length, imagePool.entries.length);
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
      revealActiveMediaTile();
      if (activeMediaPosition < 0) return;
      selectMediaAtPosition(activeMediaPosition + delta, delta);
    },
    [activeMediaPosition, revealActiveMediaTile, selectMediaAtPosition]
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
    if (!mediaCatalogReady) return;
    const nextSelection = normalizeMediaSelection({
      selection,
      imageCount: imagePool.entries.length,
      videoCount: videoSession.videos.length,
      currentImageIndex: imagePool.currentIndex,
      currentVideoIndex: videoSession.currentIndex,
    });
    if (nextSelection) handleSelectionChange(nextSelection);
  }, [
    handleSelectionChange,
    imagePool.currentIndex,
    imagePool.entries.length,
    mediaCatalogReady,
    selection.index,
    selection.kind,
    videoSession.currentIndex,
    videoSession.videos.length,
  ]);

  useEffect(() => {
    if (!mediaCatalogReady) return;
    const previousCount = previousVideoCountRef.current;
    previousVideoCountRef.current = videoSession.videos.length;
    if (!shouldSelectNewlyLoadedVideo({ previousVideoCount: previousCount, nextVideoCount: videoSession.videos.length, selection })) return;
    const index = videoSession.currentIndex >= 0 ? videoSession.currentIndex : videoSession.videos.length - 1;
    handleSelectionChange({ kind: "video", index });
  }, [handleSelectionChange, mediaCatalogReady, selection, videoSession.currentIndex, videoSession.videos.length]);

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
      revealActiveMediaTile();
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
    revealActiveMediaTile,
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
      mode,
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
      mode,
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
            loading={mediaCatalogLoading}
            activeRevealToken={mediaRevealToken}
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
                analysisStats={analysisStats}
                onNavigateBoundary={handleMediaBoundaryNavigate}
                renderAnalysisPanel={() => <AnalysisPanel stats={analysisStats} detectClassNames={detectClassNames} />}
              />
            ) : (
              <BoxLabelSurface
                pool={imagePool}
                showGallery={false}
                showSideStack
                unifiedMedia
                onImageNavigate={(index) => {
                  revealActiveMediaTile();
                  handleSelectionChange({ kind: "image", index });
                }}
                onNavigateBoundary={handleMediaBoundaryNavigate}
                classPanelSummaries={classPanelSummaries}
                previewDock={({
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
                  <div className="lwb-workbench-dock">
                    <VideoFrameControlsPanel
                      sourceLabel="Image mode"
                      segmentCount={0}
                      samplingMode="segments-preferred"
                      minSpacingMs={2000}
                      randomMultiplier={1}
                      current={false}
                      disabled
                      annotatedFrameCount={0}
                      hasFrameRecord={false}
                      videoDurationMs={0}
                      onSamplingModeChange={() => {}}
                      onMinSpacingMsChange={() => {}}
                      onRandomMultiplierChange={() => {}}
                      onRandom={() => {}}
                      onRandomNext={() => {}}
                      onAddMarker={() => {}}
                      onCopyPreviousBoxes={() => {}}
                      onMarkEmpty={() => {}}
                      onClearRecord={() => {}}
                    />
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
                    <AnalysisPanel stats={analysisStats} detectClassNames={detectClassNames} />
                  </div>
                )}
              />
            )}
          </div>
          <LabelWorkbenchInspector
            mode={mode}
            sourceSummary={sourceSummary}
            inspectorState={inspectorState}
            actionGroups={actionGroups}
          />
        </div>
      </div>
    </LabelWorkbenchContext.Provider>
  );
}
