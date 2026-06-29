import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent
} from "react";
import { createPortal } from "react-dom";
import { useWorkspace } from "../../app/useWorkspace";
import { useWorkbenchCommands } from "../../input/MultimodalControlProvider";
import { isLabelWorkbenchEmbedded, useLabelWorkbench } from "../label/useLabelWorkbench";
import { VideoAnnotationCanvas, type RemotePointerState } from "./VideoAnnotationCanvas";
import { formatVideoClock, type VideoTimelineMarker } from "./videoAnnotationDomain";
import { useVideoAnnotationSession } from "./useVideoAnnotationSession";
import { useVideoSampling, type SamplingMode } from "./useVideoSampling";
import {
  addBlackoutOverlay,
  loadBlackoutOverlays,
  removeBlackoutOverlay,
  toggleBlackoutExport,
  toggleBlackoutPreview,
  videoBlackoutSourceKey
} from "../overlays/blackoutOverlayApi";
import {
  emptyBlackoutManifest,
  findOverlaysForVideoTimestamp,
  visibleRectsForTimestamp,
  type BlackoutOverlay,
  type BlackoutOverlayManifest,
  type BlackoutRectShape
} from "../overlays/blackoutOverlayDomain";
import "./VideoLabelPage.css";

type Props = {
  onReady?: () => void;
  active?: boolean;
};

export type VideoLabelSession = ReturnType<typeof useVideoAnnotationSession>;

type VideoLabelSurfaceProps = {
  session: VideoLabelSession;
  workspaceRoot: string;
  chooseWorkspaceFolder: () => Promise<void>;
  active?: boolean;
  showVideoList?: boolean;
  showSourceToolbar?: boolean;
  unifiedMedia?: boolean;
  classificationClassesPortalId?: string;
};

const SAMPLING_MODE_LABELS: Record<SamplingMode, string> = {
  "whole-video": "Whole video",
  "segments-preferred": "Segments preferred",
  "segments-only": "Segments only"
};

const SAMPLING_MODES: SamplingMode[] = ["whole-video", "segments-preferred", "segments-only"];

type MarkerDragState = {
  key: string;
  sourceTime: number;
  pointerId: number;
  startX: number;
  moved: boolean;
  rect: DOMRect;
};

export function VideoLabelPage({ onReady, active = true }: Props) {
  const { workspaceRoot, chooseWorkspaceFolder } = useWorkspace();
  const session = useVideoAnnotationSession({ workspaceRoot, active, onReady });

  return (
    <VideoLabelSurface
      session={session}
      workspaceRoot={workspaceRoot}
      chooseWorkspaceFolder={chooseWorkspaceFolder}
      active={active}
    />
  );
}

export function VideoLabelSurface({
  session,
  workspaceRoot,
  chooseWorkspaceFolder,
  active = true,
  showVideoList = true,
  showSourceToolbar = true,
  unifiedMedia = false,
  classificationClassesPortalId
}: VideoLabelSurfaceProps) {
  const [remotePointer, setRemotePointer] = useState<RemotePointerState | null>(null);
  const [classificationPortalTarget, setClassificationPortalTarget] = useState<HTMLElement | null>(null);
  const timelineTrackRef = useRef<HTMLDivElement | null>(null);
  const markerDragRef = useRef<MarkerDragState | null>(null);
  const suppressNextMarkerClickRef = useRef(false);
  const [markerDragPreview, setMarkerDragPreview] = useState<{ key: string; time: number } | null>(null);

  const workbench = useLabelWorkbench();
  const embedded = isLabelWorkbenchEmbedded(workbench);

  useEffect(() => {
    if (!classificationClassesPortalId || typeof document === "undefined") {
      setClassificationPortalTarget(null);
      return;
    }
    setClassificationPortalTarget(document.getElementById(classificationClassesPortalId));
  }, [classificationClassesPortalId]);

  useEffect(() => {
    if (!workbench) return;
    if (!session.current) {
      workbench.reportSourceSummary?.(null);
      return;
    }
    const videoName =
      session.current.path.split(/[/\\]/).at(-1)?.replace(/\.[^.]+$/, "") ?? null;
    workbench.reportSourceSummary?.({
      kind: "video-timestamp",
      videoName,
      timestampMs: Math.round(session.time * 1000),
      reviewed: session.reviewed,
      hasDetectTask: Boolean(session.detectTask),
      hasClfTask: Boolean(session.clfTask),
    });
    return () => { workbench.reportSourceSummary?.(null); };
  }, [workbench, session.current, session.time, session.reviewed, session.detectTask, session.clfTask]);

  // ---------- Blackout overlay state ----------
  const [blackoutManifest, setBlackoutManifest] = useState<BlackoutOverlayManifest>(emptyBlackoutManifest);
  const [showBlackouts, setShowBlackouts] = useState(true);
  const blackoutSourceKey = session.current ? videoBlackoutSourceKey(session.current.path) : null;
  const blackoutKeyRef = useRef<string | null>(null);

  useEffect(() => {
    const key = session.current ? videoBlackoutSourceKey(session.current.path) : null;
    blackoutKeyRef.current = key;
    if (!key || !workspaceRoot.trim()) {
      setBlackoutManifest(emptyBlackoutManifest());
      return;
    }
    void loadBlackoutOverlays(workspaceRoot, key).then((m) => {
      if (blackoutKeyRef.current === key) setBlackoutManifest(m);
    });
  }, [session.current, workspaceRoot]);

  const currentTimestampMs = Math.round(session.time * 1000);

  const currentBlackouts: BlackoutOverlay[] = session.current
    ? findOverlaysForVideoTimestamp(blackoutManifest, currentTimestampMs, session.current.path)
    : [];

  const visibleBlackoutRects: BlackoutRectShape[] = session.current
    ? visibleRectsForTimestamp(blackoutManifest, currentTimestampMs, session.current.path)
    : [];

  const handleBlackoutDraw = useCallback(
    (rect: BlackoutRectShape) => {
      if (!session.current || !workspaceRoot.trim() || !blackoutSourceKey) return;
      const now = new Date().toISOString();
      const overlay: BlackoutOverlay = {
        id: `blk_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        target: { type: "video-timestamp", videoPath: session.current.path, timestampMs: currentTimestampMs },
        shape: rect,
        mode: "black",
        visibleInPreview: true,
        applyOnExport: true,
        createdBy: "manual",
        createdAt: now,
        updatedAt: now
      };
      void addBlackoutOverlay(workspaceRoot, blackoutSourceKey, overlay).then(setBlackoutManifest);
    },
    [blackoutSourceKey, currentTimestampMs, session.current, workspaceRoot]
  );

  const handleRemoveBlackout = useCallback(
    (id: string) => {
      if (!blackoutSourceKey || !workspaceRoot.trim()) return;
      void removeBlackoutOverlay(workspaceRoot, blackoutSourceKey, id).then(setBlackoutManifest);
    },
    [blackoutSourceKey, workspaceRoot]
  );

  const handleToggleBlackoutPreview = useCallback(
    (id: string) => {
      if (!blackoutSourceKey || !workspaceRoot.trim()) return;
      void toggleBlackoutPreview(workspaceRoot, blackoutSourceKey, id).then(setBlackoutManifest);
    },
    [blackoutSourceKey, workspaceRoot]
  );

  const handleToggleBlackoutExport = useCallback(
    (id: string) => {
      if (!blackoutSourceKey || !workspaceRoot.trim()) return;
      void toggleBlackoutExport(workspaceRoot, blackoutSourceKey, id).then(setBlackoutManifest);
    },
    [blackoutSourceKey, workspaceRoot]
  );

  const videoDurationMs = session.current ? Math.round(session.current.duration * 1000) : 0;

  const sampling = useVideoSampling({
    workspaceRoot,
    videoPath: session.current?.path ?? null,
    videoDurationMs,
    annotationManifest: session.manifest
  });

  useEffect(() => {
    setRemotePointer(null);
  }, [active, session.current?.path]);

  const handleGotoTime = useCallback((nextTime: number) => {
    sampling.setLastSource("manual");
    session.gotoTime(nextTime);
  }, [sampling.setLastSource, session.gotoTime]);

  const markerLeftPercent = useCallback((markerTime: number) => {
    if (session.maxTime <= 0) return 0;
    return Math.max(0, Math.min(100, (markerTime / session.maxTime) * 100));
  }, [session.maxTime]);

  const markerTimeFromClientX = useCallback((clientX: number, rect: DOMRect) => {
    if (!session.current || session.maxTime <= 0 || rect.width <= 0) return 0;
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    return Math.round(ratio * session.maxTime * 1000) / 1000;
  }, [session.current, session.maxTime]);

  const suppressNextMarkerClick = useCallback(() => {
    suppressNextMarkerClickRef.current = true;
    window.setTimeout(() => {
      suppressNextMarkerClickRef.current = false;
    }, 0);
  }, []);

  const handleMarkerPointerDown = useCallback((
    event: ReactPointerEvent<HTMLButtonElement>,
    marker: VideoTimelineMarker
  ) => {
    if (!session.current || session.maxTime <= 0) return;
    const rect = timelineTrackRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    markerDragRef.current = {
      key: marker.key,
      sourceTime: marker.time,
      pointerId: event.pointerId,
      startX: event.clientX,
      moved: false,
      rect
    };
    setMarkerDragPreview({ key: marker.key, time: marker.time });
  }, [session.current, session.maxTime]);

  const handleMarkerPointerMove = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = markerDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    if (Math.abs(event.clientX - drag.startX) > 3) drag.moved = true;
    const nextTime = markerTimeFromClientX(event.clientX, drag.rect);
    setMarkerDragPreview({ key: drag.key, time: nextTime });
  }, [markerTimeFromClientX]);

  const handleMarkerPointerUp = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = markerDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    const wasMoved = drag.moved || Math.abs(event.clientX - drag.startX) > 3;
    const nextTime = markerTimeFromClientX(event.clientX, drag.rect);
    markerDragRef.current = null;
    setMarkerDragPreview(null);
    suppressNextMarkerClick();
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (wasMoved) {
      session.moveFrameRecord(drag.sourceTime, nextTime);
    } else {
      handleGotoTime(drag.sourceTime);
    }
  }, [handleGotoTime, markerTimeFromClientX, session.moveFrameRecord, suppressNextMarkerClick]);

  const handleMarkerPointerCancel = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = markerDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    markerDragRef.current = null;
    setMarkerDragPreview(null);
    suppressNextMarkerClick();
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }, [suppressNextMarkerClick]);

  const handleMarkerClick = useCallback((
    event: ReactMouseEvent<HTMLButtonElement>,
    marker: VideoTimelineMarker
  ) => {
    event.preventDefault();
    event.stopPropagation();
    if (suppressNextMarkerClickRef.current) return;
    handleGotoTime(marker.time);
  }, [handleGotoTime]);

  // Random Next seeks to a new timestamp only; it does NOT create an annotation record.
  const handleRandomNext = useCallback(() => {
    const candidate = sampling.randomNext();
    if (candidate) {
      session.gotoTime(candidate.timestampMs / 1000);
    }
  }, [sampling.randomNext, session.gotoTime]);

  const sourceLabel =
    sampling.lastSource === "random-segment"
      ? "Random segment"
      : sampling.lastSource === "random-whole-video"
        ? "Random whole-video"
        : "Manual";

  useEffect(() => {
    if (!workbench) return;
    const selectedBox = session.selectedIndex !== null ? session.boxes[session.selectedIndex] : null;
    const warnings = [];
    if (selectedBox && session.isArchivedDetectClass(selectedBox.classId)) {
      warnings.push({
        id: "archived-detect-class",
        label: "Archived detect class",
        detail: "The selected box references an archived class.",
        tone: "warning" as const,
      });
    }
    if (session.clfTask?.classKey && session.isArchivedClfClass(session.clfTask.classKey)) {
      warnings.push({
        id: "archived-classification-class",
        label: "Archived classification class",
        detail: "The current classification label references an archived class.",
        tone: "warning" as const,
      });
    }
    workbench.reportInspectorState?.({
      taskKind: "both",
      reviewStatus: session.reviewed ? "approved" : "unreviewed",
      timestampLabel: formatVideoClock(session.time),
      sourceDetail: sourceLabel,
      classSummary: {
        activeDetectCount: session.activeDetectClasses.length,
        totalDetectCount: session.classes.length,
        activeClassificationCount: session.clfClassOptions.length,
      },
      classPalette: {
        detectClasses: session.activeDetectClasses.map((item) => ({ id: item.id, name: item.name })),
        classificationClasses: session.clfClassOptions.map((item) => ({ key: item.key, name: item.name })),
        currentDetectClassId: session.currentClass,
        currentClassificationKey: session.clfTask?.classKey ?? null,
        readOnlyReason: "Class selection remains owned by the Video Label task panels in v1.",
      },
      overlaySummary: { activeCount: currentBlackouts.length },
      segmentSummary: sampling.segmentCount > 0
        ? { label: `${sampling.segmentCount} enabled`, startMs: null, endMs: null }
        : null,
      warnings,
    });
    workbench.registerWorkbenchActions?.([
      {
        id: "video-navigation",
        label: "Navigation",
        actions: [
          {
            id: "video.randomNext",
            label: "Random Next",
            variant: "primary",
            disabled: !session.current || videoDurationMs <= 0,
            unavailableReason: !session.current
              ? "No video selected."
              : videoDurationMs <= 0
                ? "Video duration is unavailable."
                : undefined,
            run: handleRandomNext,
          },
          {
            id: "video.copyPreviousBoxes",
            label: "Copy Previous Boxes",
            disabled: !session.annotatedFrames.length || !session.current,
            unavailableReason: !session.current
              ? "No video selected."
              : !session.annotatedFrames.length
                ? "No earlier annotated frame to copy from."
                : undefined,
            run: session.copyPreviousBoxes,
          },
        ],
      },
      {
        id: "video-review",
        label: "Review",
        actions: [
          {
            id: "review.markReviewed",
            label: "Mark Reviewed",
            disabled: !session.current,
            unavailableReason: session.current ? undefined : "No video selected.",
            run: () => {
              if (session.current) session.updateCurrentFrame(session.boxes, true);
            },
          },
          {
            id: "review.markEmpty",
            label: "Mark Empty",
            disabled: !session.current,
            unavailableReason: session.current ? undefined : "No video selected.",
            run: session.markEmptyReviewed,
          },
          {
            id: "review.clearRecord",
            label: "Clear Frame Record",
            variant: "danger",
            disabled: !session.currentFrame,
            unavailableReason: session.currentFrame ? undefined : "No annotation record exists for this timestamp.",
            run: session.clearFrameRecord,
          },
        ],
      },
    ]);
    return () => {
      workbench.reportInspectorState?.(null);
      workbench.clearWorkbenchActions?.();
    };
  }, [
    workbench,
    currentBlackouts.length,
    handleRandomNext,
    sampling.segmentCount,
    session.activeDetectClasses,
    session.activeDetectClasses.length,
    session.annotatedFrames.length,
    session.boxes,
    session.classes.length,
    session.clearFrameRecord,
    session.clfClassOptions.length,
    session.clfClassOptions,
    session.clfTask,
    session.copyPreviousBoxes,
    session.current,
    session.currentClass,
    session.currentFrame,
    session.isArchivedClfClass,
    session.isArchivedDetectClass,
    session.markEmptyReviewed,
    session.reviewed,
    session.selectedIndex,
    session.time,
    session.updateCurrentFrame,
    sourceLabel,
    videoDurationMs,
  ]);

  useWorkbenchCommands((envelope) => {
    if (!active) return;
    const command = envelope.command;
    switch (command.type) {
      case "video.seekBy":
        sampling.setLastSource("manual");
        session.gotoTime(session.time + command.seconds);
        break;
      case "video.copyPreviousBoxes":
        session.copyPreviousBoxes();
        break;
      case "video.markReviewed":
        if (session.current) session.updateCurrentFrame(session.boxes, true);
        break;
      case "video.clearFrameRecord":
        session.clearFrameRecord();
        break;
      case "video.selectClass":
        session.assignClass(command.classId);
        break;
      case "pointer.move": {
        const { x, y } = command;
        setRemotePointer((previous) => ({
          x,
          y,
          pressed: previous?.pressed ?? false,
          sequence: (previous?.sequence ?? 0) + 1
        }));
        break;
      }
      case "pointer.press": {
        const { x, y } = command;
        setRemotePointer((previous) => ({
          x,
          y,
          pressed: true,
          sequence: (previous?.sequence ?? 0) + 1
        }));
        break;
      }
      case "pointer.release": {
        const { x, y } = command;
        setRemotePointer((previous) => ({
          x,
          y,
          pressed: false,
          sequence: (previous?.sequence ?? 0) + 1
        }));
        break;
      }
      default:
        break;
    }
  });

  const saveLabel =
    session.saveState === "saving"
      ? "Saving…"
      : session.saveState === "saved"
        ? "Saved"
        : session.saveState === "error"
          ? "Save failed"
          : "Not edited";
  const videoMeta = session.current
    ? `${session.current.width}×${session.current.height} · ${formatVideoClock(session.current.duration)}`
    : "No video loaded";

  // Detect task status text
  const detectStatus = session.detectTask
    ? session.detectTask.empty
      ? "empty / reviewed"
      : `${session.boxes.length} box(es)${session.reviewed ? " / reviewed" : ""}`
    : "none";

  // Clf task status text
  const clfStatus = session.clfTask
    ? session.clfTask.classKey
      ? `${session.clfDisplayName(session.clfTask.classKey)}${session.isArchivedClfClass(session.clfTask.classKey) ? " / archived" : ""}${session.clfTask.reviewed ? " / reviewed" : ""}`
      : session.clfTask.reviewed
        ? "reviewed (no class)"
        : "pending"
    : "pending";

  const classificationPanel = (
    <section className="panel video-label-classify-panel">
      <div className="panel-header">
        <span>Classification</span>
        <span className="status">{clfStatus}</span>
      </div>
      <div className="panel-body video-label-action-stack">
        <div className="video-label-class-list">
          {session.clfClassOptions.map((item) => {
            const key = item.key;
            const isSelected = session.clfTask?.classKey === key;
            return (
              <button
                type="button"
                key={item.key}
                className={isSelected ? "selected" : ""}
                onClick={() => session.setClfClass(key)}
                disabled={!session.current}
              >
                {item.name}
              </button>
            );
          })}
        </div>
        <button
          type="button"
          onClick={session.markClfReviewed}
          disabled={!session.current}
        >
          Mark Clf Reviewed
        </button>
        <button
          type="button"
          onClick={session.clearClfLabel}
          disabled={!session.clfTask}
        >
          Clear Clf Label
        </button>
      </div>
    </section>
  );

  const classificationPanelPortal =
    classificationClassesPortalId && classificationPortalTarget
      ? createPortal(classificationPanel, classificationPortalTarget)
      : null;

  return (
    <main className={`video-label-workspace${embedded ? " video-label-workspace--embedded" : ""}${unifiedMedia ? " video-label-workspace--unified-media" : ""}`}>
      {classificationPanelPortal}
    <section className="panel video-label-main-panel">
        {!embedded ? (
          <div className="panel-header">
            <span>Video Label</span>
            <span className="status">{videoMeta}</span>
          </div>
        ) : null}
        <div className="panel-body video-label-main-body">
          {showSourceToolbar ? (
          <div className="row workspace-toolbar">
            {!embedded ? (
              <button
                className="primary"
                type="button"
                onClick={() => chooseWorkspaceFolder().catch((reason) => session.showError(reason, "workspace.open"))}
              >
                Open Workspace
              </button>
            ) : null}
            <button
              className="primary"
              type="button"
              onClick={() => void session.addVideos()}
              disabled={!workspaceRoot.trim()}
            >
              Add Video
            </button>
            <span className="status">{saveLabel}</span>
          </div>
          ) : null}

          <div className="video-label-stage">
            {session.current && session.previewBase64 ? (
              <VideoAnnotationCanvas
                imageBase64={session.previewBase64}
                boxes={session.boxes}
                classes={session.classes}
                archivedClassIds={session.archivedDetectClassIds}
                currentClass={session.currentClass}
                selectedIndex={session.selectedIndex}
                disabled={session.previewLoading || session.manifestLoading}
                remotePointer={remotePointer}
                blackouts={visibleBlackoutRects}
                showBlackouts={showBlackouts}
                onBlackoutDraw={handleBlackoutDraw}
                onChange={(next) => session.updateCurrentFrame(next, true)}
                onSelectedIndexChange={session.setSelectedIndex}
              />
            ) : (
              <div className="empty video-label-empty">
                {session.previewLoading || session.manifestLoading
                  ? "Loading video frame…"
                  : "Add a video to begin direct frame annotation."}
              </div>
            )}
          </div>

          <div className="video-label-timeline">
            <div className="video-label-timeline-track" ref={timelineTrackRef}>
              <input
                className="video-label-range"
                type="range"
                min="0"
                max={session.maxTime}
                step="0.001"
                value={Math.min(session.time, session.maxTime)}
                disabled={!session.current}
                onChange={(event) => handleGotoTime(Number(event.target.value))}
                aria-label="Video timestamp"
              />
              <div className="video-label-markers" aria-label="Annotated timestamps">
                {session.timelineMarkers.map((marker) => {
                  const displayTime = markerDragPreview?.key === marker.key ? markerDragPreview.time : marker.time;
                  return (
                    <button
                      key={marker.key}
                      type="button"
                      className={`video-label-marker video-label-marker--${marker.kind}${markerDragPreview?.key === marker.key ? " dragging" : ""}`}
                      style={{ left: `${markerLeftPercent(displayTime)}%` }}
                      title={marker.label}
                      aria-label={`Go to ${marker.label}`}
                      onPointerDown={(event) => handleMarkerPointerDown(event, marker)}
                      onPointerMove={handleMarkerPointerMove}
                      onPointerUp={handleMarkerPointerUp}
                      onPointerCancel={handleMarkerPointerCancel}
                      onClick={(event) => handleMarkerClick(event, marker)}
                    >
                      <span className="sr-only">{marker.label}</span>
                    </button>
                  );
                })}
                {markerDragPreview ? (
                  <div
                    className="video-label-marker-preview"
                    style={{ left: `${markerLeftPercent(markerDragPreview.time)}%` }}
                  >
                    {formatVideoClock(markerDragPreview.time)}
                  </div>
                ) : null}
              </div>
            </div>
            <div className="row video-label-time-row">
              <button
                type="button"
                onClick={() => handleGotoTime(session.time - session.stepSeconds)}
                disabled={!session.current}
              >
                Previous
              </button>
              <button
                type="button"
                onClick={() => handleGotoTime(session.time + session.stepSeconds)}
                disabled={!session.current}
              >
                Next
              </button>
              <button
                type="button"
                onClick={session.clearFrameRecord}
                disabled={!session.currentFrame}
              >
                Clear Marker
              </button>
              <label>
                Time (s)
                <input
                  type="number"
                  min="0"
                  max={session.maxTime}
                  step="0.001"
                  value={session.time}
                  onChange={(event) => handleGotoTime(Number(event.target.value))}
                  disabled={!session.current}
                />
              </label>
              <label>
                Step (s)
                <input
                  type="number"
                  min="0.001"
                  step="0.001"
                  value={session.stepSeconds}
                  onChange={(event) => session.setStepSeconds(Math.max(0.001, Number(event.target.value) || 0.1))}
                />
              </label>
              <span className="video-label-clock">
                {formatVideoClock(session.time)} / {formatVideoClock(session.current?.duration || 0)}
              </span>
            </div>
          </div>
        </div>
      </section>

      <aside className="side-stack video-label-side-stack">
        {showVideoList ? (
        <section className="panel">
          <div className="panel-header">
            <span>Videos</span>
            <span className="status">{session.videos.length}</span>
          </div>
          <div className="panel-body">
            <div className="video-list">
              {session.videos.length ? (
                session.videos.map((video, index) => (
                  <div
                    className={`video-list-item${index === session.currentIndex ? " active" : ""}`}
                    key={video.path}
                  >
                    <button
                      type="button"
                      className="video-list-select"
                      onClick={() => session.setCurrentIndex(index)}
                    >
                      {video.name}
                    </button>
                    <button
                      type="button"
                      className="video-list-remove"
                      onClick={() => session.removeVideo(index)}
                      aria-label={`Remove ${video.name}`}
                    >
                      Remove
                    </button>
                  </div>
                ))
              ) : (
                <div className="empty">No videos added.</div>
              )}
            </div>
          </div>
        </section>
        ) : null}

        <section className="panel">
          <div className="panel-header">
            <span>Random Sampling</span>
            <span className="status">{sampling.segmentCount} segment(s)</span>
          </div>
          <div className="panel-body video-label-action-stack">
            {!embedded ? (
              <button
                type="button"
                className="primary"
                onClick={handleRandomNext}
                disabled={!session.current || videoDurationMs <= 0}
              >
                Random Next
              </button>
            ) : null}
            <div className="video-label-stats">
              <span>Source: {sourceLabel}</span>
            </div>
            <label>
              Sampling mode
              <select
                value={sampling.samplingMode}
                onChange={(event) => sampling.setMode(event.target.value as SamplingMode)}
              >
                {SAMPLING_MODES.map((mode) => (
                  <option key={mode} value={mode}>
                    {SAMPLING_MODE_LABELS[mode]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Min spacing (ms)
              <input
                type="number"
                min="0"
                step="100"
                value={sampling.minSpacingMs}
                onChange={(event) =>
                  sampling.setMinSpacingMs(Math.max(0, Number(event.target.value) || 0))
                }
              />
            </label>
          </div>
        </section>

        <section className="panel">
          <div className="panel-header">
            <span>Detect</span>
            <span className="status">{detectStatus}</span>
          </div>
          <div className="panel-body video-label-action-stack">
            <div className="row">
              <button
                type="button"
                onClick={() => session.gotoReviewed(-1)}
                disabled={!session.reviewedFrames.length}
              >
                Previous Reviewed
              </button>
              <button
                type="button"
                onClick={() => session.gotoReviewed(1)}
                disabled={!session.reviewedFrames.length}
              >
                Next Reviewed
              </button>
            </div>
            {!embedded ? (
              <>
                <button
                  type="button"
                  onClick={session.copyPreviousBoxes}
                  disabled={!session.annotatedFrames.length || !session.current}
                >
                  Copy Previous Boxes
                </button>
                <button type="button" onClick={session.markEmptyReviewed} disabled={!session.current}>
                  Mark Empty / Reviewed
                </button>
                <button
                  type="button"
                  className="danger"
                  onClick={session.clearFrameRecord}
                  disabled={!session.currentFrame}
                >
                  Clear Frame Record
                </button>
              </>
            ) : null}
            <div className="video-label-stats">
              <span>{session.reviewedFrames.length} reviewed timestamp(s)</span>
              <span>{session.annotatedFrames.length} with boxes</span>
            </div>
          </div>
        </section>

        {/* Classification panel shares timestamps with detect; independent reviewed state. */}
        {classificationClassesPortalId ? null : classificationPanel}

        {/* Blackout Overlays panel — non-destructive overlay metadata for current timestamp */}
        <section className="panel">
          <div className="panel-header">
            <span>Blackout Overlays</span>
            <span className="status">{currentBlackouts.length}</span>
          </div>
          <div className="panel-body video-label-action-stack">
            <label>
              <input
                type="checkbox"
                checked={showBlackouts}
                onChange={(e) => setShowBlackouts(e.target.checked)}
              />
              {" Show overlays"}
            </label>
            {currentBlackouts.length === 0 && (
              <div className="hint">No blackouts for this timestamp. Use the canvas Blackout tool to draw one.</div>
            )}
            {currentBlackouts.map((overlay) => {
              const shape = overlay.shape.type === "rect" ? overlay.shape : null;
              const shapeDesc = shape
                ? `rect ${(shape.w * 100).toFixed(0)}×${(shape.h * 100).toFixed(0)}%`
                : overlay.shape.type;
              return (
                <div key={overlay.id} className="blackout-overlay-row">
                  <span className="blackout-overlay-desc" title={overlay.id}>{shapeDesc}</span>
                  <button
                    type="button"
                    title={overlay.visibleInPreview ? "Hide in preview" : "Show in preview"}
                    onClick={() => handleToggleBlackoutPreview(overlay.id)}
                  >
                    {overlay.visibleInPreview ? "👁" : "👁‍🗨"}
                  </button>
                  <button
                    type="button"
                    title={overlay.applyOnExport ? "Disable on export" : "Enable on export"}
                    onClick={() => handleToggleBlackoutExport(overlay.id)}
                  >
                    {overlay.applyOnExport ? "Exp✓" : "Exp✗"}
                  </button>
                  <button
                    type="button"
                    className="danger"
                    onClick={() => handleRemoveBlackout(overlay.id)}
                  >
                    Remove
                  </button>
                </div>
              );
            })}
          </div>
        </section>

        <section className="panel video-label-class-panel">
          <div className="panel-header">
            <span>Detect Classes</span>
            <span className="status">{session.currentClass}</span>
          </div>
          <div className="panel-body">
            <div className="video-label-class-list">
              {session.activeDetectClasses.map((item) => (
                <button
                  type="button"
                  key={item.id}
                  className={item.id === session.currentClass ? "selected" : ""}
                  onClick={() => session.assignClass(item.id)}
                >
                  {item.id}: {item.name}
                </button>
              ))}
            </div>
          </div>
        </section>

        <section className="panel">
          <div className="panel-body">
            <div className="hint">{session.status}</div>
            <div className="hint">
              Timestamp/task metadata: {session.annotationsRoot}. Preview frames remain in memory and are never added to media.
            </div>
            <div className="hint">Image-based annotation remains available in Image Box Label.</div>
          </div>
        </section>
      </aside>
    </main>
  );
}
