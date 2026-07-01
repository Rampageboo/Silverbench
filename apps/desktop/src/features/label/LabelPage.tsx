import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { useWorkspace } from "../../app/useWorkspace";
import { useVideoAnnotationSession } from "../video/useVideoAnnotationSession";
import { saveVideoFrame } from "../video/videoCaptureApi";
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
import { classBoxColor } from "../shared/classColors";
import { useWorkspaceClasses } from "../workspace/useWorkspaceClasses";
import { activeDetectClassDefs } from "../workspace/workspaceClassTaxonomy";
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
const RANDOM_MULTIPLIERS = [1, 5, 10] as const;
type RandomMultiplier = (typeof RANDOM_MULTIPLIERS)[number];

function workspaceRelativePath(workspaceRoot: string, absolutePath: string) {
  const root = workspaceRoot.replace(/\\/g, "/").replace(/\/+$/, "");
  const path = absolutePath.replace(/\\/g, "/");
  if (root && path.toLowerCase().startsWith(`${root.toLowerCase()}/`)) {
    return path.slice(root.length + 1);
  }
  return absolutePath;
}

type AnalysisClassBucket = {
  key: string;
  name: string;
  count: number;
};

type AnalysisDetectPoint = {
  classKey: string;
  className: string;
  x: number;
  y: number;
  area: number;
};

type AnalysisStats = {
  totalMedia: number;
  detectSamples: number;
  detectHits: number;
  clfLabels: number;
  proposals: number;
  reviewed: number;
  junk: number;
  detectClasses: AnalysisClassBucket[];
  clfClasses: AnalysisClassBucket[];
  detectPoints: AnalysisDetectPoint[];
};

const EMPTY_ANALYSIS_STATS: AnalysisStats = {
  totalMedia: 0,
  detectSamples: 0,
  detectHits: 0,
  clfLabels: 0,
  proposals: 0,
  reviewed: 0,
  junk: 0,
  detectClasses: [],
  clfClasses: [],
  detectPoints: [],
};

const HEATMAP_COLS = 8;
const HEATMAP_ROWS = 5;

function incrementBucket(map: Map<string, AnalysisClassBucket>, key: string, name: string, amount = 1) {
  const trimmedKey = key.trim();
  if (!trimmedKey) return;
  const existing = map.get(trimmedKey);
  if (existing) {
    existing.count += amount;
    if (existing.name === trimmedKey && name !== trimmedKey) existing.name = name;
    return;
  }
  map.set(trimmedKey, { key: trimmedKey, name: name || trimmedKey, count: amount });
}

function sortedBuckets(map: Map<string, AnalysisClassBucket>): AnalysisClassBucket[] {
  return [...map.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

function clampUnit(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function videoAnalysisStats(videoSession: ReturnType<typeof useVideoAnnotationSession>): AnalysisStats {
  const frames = Object.values(videoSession.manifest?.frames ?? {});
  const detectNames = new Map(videoSession.classes.map((item) => [String(item.id), item.name]));
  const clfNames = new Map(videoSession.clfClassOptions.map((item) => [item.key, item.name]));
  const detectBuckets = new Map<string, AnalysisClassBucket>();
  const clfBuckets = new Map<string, AnalysisClassBucket>();
  const detectPoints: AnalysisDetectPoint[] = [];
  let detectSamples = 0;
  let detectHits = 0;
  let clfLabels = 0;
  let proposals = 0;
  let reviewed = 0;

  for (const frame of frames) {
    const detect = frame.tasks.detect;
    const clf = frame.tasks.clf;
    const detectBoxCount = detect?.boxes.length ?? 0;
    const proposalCount = detect?.proposals?.length ?? 0;
    if (detect && (detectBoxCount > 0 || proposalCount > 0 || detect.reviewed || detect.empty)) {
      detectSamples += 1;
    }
    detectHits += detectBoxCount;
    proposals += proposalCount;
    for (const box of detect?.boxes ?? []) {
      const key = box.classKey || (typeof box.classId === "number" ? String(box.classId) : "");
      if (!key) continue;
      const name = detectNames.get(key) ?? `#${key}`;
      incrementBucket(detectBuckets, key, name);
      detectPoints.push({
        classKey: key,
        className: name,
        x: clampUnit(box.x),
        y: clampUnit(box.y),
        area: clampUnit(box.w) * clampUnit(box.h),
      });
    }
    if (clf?.classKey) {
      clfLabels += 1;
      incrementBucket(clfBuckets, clf.classKey, clfNames.get(clf.classKey) ?? clf.classKey);
    }
    if (detect?.reviewed || clf?.reviewed) reviewed += 1;
  }

  return {
    totalMedia: videoSession.videos.length,
    detectSamples,
    detectHits,
    clfLabels,
    proposals,
    reviewed,
    junk: 0,
    detectClasses: sortedBuckets(detectBuckets),
    clfClasses: sortedBuckets(clfBuckets),
    detectPoints,
  };
}

function combineBuckets(items: AnalysisClassBucket[][]): AnalysisClassBucket[] {
  const merged = new Map<string, AnalysisClassBucket>();
  for (const buckets of items) {
    for (const bucket of buckets) {
      incrementBucket(merged, bucket.key, bucket.name, bucket.count);
    }
  }
  return sortedBuckets(merged);
}

function combineAnalysisStats(...items: AnalysisStats[]): AnalysisStats {
  return items.reduce<AnalysisStats>(
    (total, item) => ({
      totalMedia: total.totalMedia + item.totalMedia,
      detectSamples: total.detectSamples + item.detectSamples,
      detectHits: total.detectHits + item.detectHits,
      clfLabels: total.clfLabels + item.clfLabels,
      proposals: total.proposals + item.proposals,
      reviewed: total.reviewed + item.reviewed,
      junk: total.junk + item.junk,
      detectClasses: combineBuckets([total.detectClasses, item.detectClasses]),
      clfClasses: combineBuckets([total.clfClasses, item.clfClasses]),
      detectPoints: [...total.detectPoints, ...item.detectPoints],
    }),
    EMPTY_ANALYSIS_STATS
  );
}

function analysisClassPanelSummaries(stats: AnalysisStats) {
  return {
    detect: {
      metrics: [
        { label: "Classes", value: stats.detectClasses.length },
        { label: "Samples", value: stats.detectSamples },
        { label: "Hits", value: stats.detectHits },
        { label: "Props", value: stats.proposals },
      ],
    },
    clf: {
      metrics: [
        { label: "Classes", value: stats.clfClasses.length },
        { label: "Labels", value: stats.clfLabels },
        { label: "Reviewed", value: stats.reviewed },
        { label: "Junk", value: stats.junk },
      ],
    },
  };
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

function VideoFrameControlsPanel({
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

function VideoBoxLabelSurface({
  workspaceRoot,
  videoSession,
  imagePool,
  activeMediaPosition,
  mediaCount,
  analysisStats,
  detectClassNames,
  onNavigateBoundary,
}: {
  workspaceRoot: string;
  videoSession: ReturnType<typeof useVideoAnnotationSession>;
  imagePool: ReturnType<typeof useBoxLabel>;
  activeMediaPosition: number;
  mediaCount: number;
  analysisStats: AnalysisStats;
  detectClassNames: Map<string, string>;
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
  const [randomMultiplier, setRandomMultiplier] = useState<RandomMultiplier>(1);
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
  const [autoLabelFramePath, setAutoLabelFramePath] = useState("");
  const autoLabelFrameBase64 = hasFrameRecord ? videoSession.previewBase64 : null;
  const classPanelSummaries = useMemo(() => analysisClassPanelSummaries(analysisStats), [analysisStats]);

  useEffect(() => {
    if (!hasFrameRecord || !autoLabelVideoPath || autoLabelFrameTime === null || !workspaceRoot.trim()) {
      setAutoLabelFramePath("");
      return;
    }
    let cancelled = false;
    const root = workspaceRoot.trim();
    const outputRoot = `${root.replace(/[\\/]+$/, "")}/.tmp-autolabel-frames`;
    saveVideoFrame(autoLabelVideoPath, outputRoot, autoLabelFrameTime, "autolabel", "jpg")
      .then((path) => {
        if (!cancelled) setAutoLabelFramePath(workspaceRelativePath(root, path));
      })
      .catch(() => {
        if (!cancelled) setAutoLabelFramePath("");
      });
    return () => {
      cancelled = true;
    };
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
          classPanelSummaries={classPanelSummaries}
          classificationClasses={videoSession.clfClassOptions}
          classificationClassesPortalId="lwbClassifyClassesSlot"
          currentClassificationKey={videoSession.clfTask?.classKey ?? null}
          onAssignClassificationClass={assignClassificationClass}
          imageUrlOverride={imageUrlOverride}
          loadLabelsOverride={loadLabelsOverride}
          saveLabelsOverride={saveLabelsOverride}
          disableProposals
          canvasOverlay={() => (
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
          )}
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
                sourceImageBase64={autoLabelFrameBase64}
                sourceImagePath={autoLabelFramePath}
                sourceUnavailableMessage={hasFrameRecord ? "Preparing marker frame..." : "Add a marker or use Random Next to run video Auto Label."}
                autoRunAllowed={hasFrameRecord && !videoSession.reviewed}
                onApplyDetectPredictions={applyAutoLabelPredictions}
                onAssignClassificationClass={assignOverlayClassificationClass}
                onClassesChanged={reloadWorkspaceClasses}
              />
              <AnalysisPanel stats={analysisStats} detectClassNames={detectClassNames} />
            </div>
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
  const [mediaRevealToken, setMediaRevealToken] = useState(0);
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
                detectClassNames={detectClassNames}
                onNavigateBoundary={handleMediaBoundaryNavigate}
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
