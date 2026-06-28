import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useWorkspace } from "../../app/useWorkspace";
import { VideoLabelSurface } from "../video/VideoLabelPage";
import { useVideoAnnotationSession } from "../video/useVideoAnnotationSession";
import { BoxLabelSurface } from "../box-label/BoxLabelPage";
import { useBoxLabel } from "../box-label/useBoxLabel";
import { LabelWorkbenchContext } from "./LabelWorkbenchContext";
import { LabelWorkbenchHeader } from "./LabelWorkbenchHeader";
import { LabelWorkbenchInspector } from "./LabelWorkbenchInspector";
import { LabelMediaGrid, type LabelMediaSelection } from "./LabelMediaGrid";
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
  const { workspaceRoot, poolLabelFocusFilename, clearPoolLabelFocus, chooseWorkspaceFolder } = useWorkspace();
  const [selection, setSelection] = useState<LabelMediaSelection>({ kind: "image", index: 0 });
  const [sourceSummary, setSourceSummary] = useState<LabelSourceSummary | null>(null);
  const [inspectorState, setInspectorState] = useState<LabelWorkbenchInspectorState | null>(null);
  const [actionGroups, setActionGroups] = useState<LabelWorkbenchActionGroup[]>([]);
  const previousVideoCountRef = useRef(0);
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
    onReady
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
    (position: number) => {
      const item = mediaOrder[position];
      if (!item) return;
      if (item.kind === "image") {
        imagePool.navigate(item.index);
      } else {
        videoSession.setCurrentIndex(item.index);
      }
      handleSelectionChange(item);
    },
    [handleSelectionChange, imagePool, mediaOrder, videoSession]
  );

  const handleMediaBoundaryNavigate = useCallback(
    (delta: -1 | 1) => {
      if (activeMediaPosition < 0) return;
      selectMediaAtPosition(activeMediaPosition + delta);
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
      const nextTime = videoSession.time + delta * videoSession.stepSeconds;
      if (nextTime < 0 || nextTime > videoSession.maxTime) {
        handleMediaBoundaryNavigate(delta < 0 ? -1 : 1);
        return;
      }
      videoSession.gotoTime(nextTime);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    active,
    handleMediaBoundaryNavigate,
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
            onSelectionChange={handleSelectionChange}
          />
          <div className="label-content">
            {mode === "video" ? (
              <VideoLabelSurface
                session={videoSession}
                workspaceRoot={workspaceRoot}
                chooseWorkspaceFolder={chooseWorkspaceFolder}
                active={active}
                showVideoList={false}
                showSourceToolbar={false}
                unifiedMedia
              />
            ) : (
              <BoxLabelSurface
                pool={imagePool}
                showGallery={false}
                showSideStack
                unifiedMedia
                onImageNavigate={(index) => handleSelectionChange({ kind: "image", index })}
                onNavigateBoundary={handleMediaBoundaryNavigate}
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
