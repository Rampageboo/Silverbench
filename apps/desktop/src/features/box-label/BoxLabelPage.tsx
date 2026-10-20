import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useWorkspace } from "../../app/useWorkspace";
import { useToast } from "../../components/useToast";
import { errMessage } from "../../lib/errors";
import { isFlaggedFile, isNextTrainingFile, isReviewedFile } from "../image-pool/metadata";
import { LabelReviewActions, LabelWorkbenchInspector } from "../label/LabelWorkbenchInspector";
import type {
  LabelReviewStatus,
  LabelWorkbenchActionGroup,
  LabelWorkbenchInspectorState
} from "../label/labelWorkbenchTypes";
import { useArchivedClassIds } from "../workspace/useArchivedClassIds";
import { useWorkspaceClasses } from "../workspace/useWorkspaceClasses";
import {
  activeDetectClassDefs,
  chooseClassificationManifest,
  classificationOptionsForNewAnnotations
} from "../workspace/workspaceClassTaxonomy";
import { BoxLabelView } from "./BoxLabelView";
import type { BoxLabelCanvasOverlay, BoxLabelViewProps } from "./boxLabelTypes";
import type { BoxLabelModel } from "./useBoxLabel";
import { useBoxLabelEditor } from "./useBoxLabelEditor";
import "./boxLabel.css";

export type BoxLabelPageModel = BoxLabelModel;

type BoxLabelSurfaceProps = {
  pool: BoxLabelPageModel;
  onImageNavigate?: (index: number) => void;
  onNavigateBoundary?: (delta: -1 | 1) => void;
  classPanelSummaries?: BoxLabelViewProps["classPanelSummaries"];
  canvasOverlay?: BoxLabelCanvasOverlay;
  previewDock?: BoxLabelCanvasOverlay;
};

/** The image label surface inside the Label workbench. */
export function BoxLabelSurface({
  pool,
  onImageNavigate,
  onNavigateBoundary,
  classPanelSummaries,
  canvasOverlay,
  previewDock
}: BoxLabelSurfaceProps) {
  const { workspaceRoot } = useWorkspace();
  const { showToast } = useToast();
  const showError = useCallback(
    (err: unknown) => showToast(errMessage(err), { variant: "error" }),
    [showToast]
  );
  const { manifest: classManifest } = useArchivedClassIds(workspaceRoot);
  const {
    manifest: workspaceClassManifest,
    loading: workspaceClassesLoading,
    saving: workspaceClassesSaving,
    loadError: workspaceClassesLoadError,
    saveError: workspaceClassesSaveError,
    load: loadWorkspaceClasses,
    addClf,
    rename: renameWorkspaceClass
  } = useWorkspaceClasses(workspaceRoot);

  const currentMeta = pool.currentEntry ? pool.metadata.get(pool.currentEntry.basename) : undefined;
  const currentClassificationKey =
    currentMeta?.clf_enabled && currentMeta.clf_class ? currentMeta.clf_class : null;
  const currentReviewStatus = isFlaggedFile(currentMeta)
    ? ("flagged" as const)
    : isReviewedFile(currentMeta)
      ? ("approved" as const)
      : ("unreviewed" as const);
  const currentNextTraining = isNextTrainingFile(currentMeta);

  const classificationManifest = useMemo(
    () => chooseClassificationManifest(workspaceClassManifest, classManifest),
    [classManifest, workspaceClassManifest]
  );

  const imageClassificationClasses = useMemo(
    () =>
      classificationManifest
        ? classificationOptionsForNewAnnotations(classificationManifest).map((def) => ({
            key: def.key,
            name: def.name,
            aliases: def.aliases,
            archived: def.archived
          }))
        : [],
    [classificationManifest]
  );
  const detectClassKeysById = useMemo(() => {
    const manifest = workspaceClassManifest ?? classManifest;
    if (!manifest) return {};
    return activeDetectClassDefs(manifest).reduce<Record<number, string>>((acc, def) => {
      acc[def.yoloId] = def.key;
      return acc;
    }, {});
  }, [classManifest, workspaceClassManifest]);
  const workspaceClfClassCount = useMemo(
    () =>
      workspaceClassManifest ? classificationOptionsForNewAnnotations(workspaceClassManifest).length : null,
    [workspaceClassManifest]
  );
  const archivedClfClassCount = useMemo(
    () => (classManifest ? classificationOptionsForNewAnnotations(classManifest).length : null),
    [classManifest]
  );

  const classificationClassStatus = workspaceClassesLoading
    ? "Loading classification classes..."
    : workspaceClassesLoadError ||
      workspaceClassesSaveError ||
      (imageClassificationClasses.length === 0
        ? classificationManifest
          ? `Class manifest loaded, but it has 0 active clf classes. workspace=${workspaceClfClassCount ?? "not loaded"}, archive=${archivedClfClassCount ?? "not loaded"}`
          : "Class manifest is not loaded."
        : "");

  const handleAddClassificationClass = useCallback(
    async (name: string) => {
      const classKey = await addClf(name);
      if (!classKey) throw new Error("Classification class manifest is not available.");
      return classKey;
    },
    [addClf]
  );

  useEffect(() => {
    if (!workspaceRoot.trim()) return;
    void loadWorkspaceClasses();
  }, [loadWorkspaceClasses, workspaceRoot]);

  if (pool.pending && !pool.entries.length) {
    return (
      <>
        <div
          className={`app pool-label react-box-label-page react-box-label-page--loading react-box-label-page--embedded react-box-label-page--unified-media`}
        >
          <div className="page-loading" role="status" aria-live="polite">
            <span className="page-loading-spinner" aria-hidden="true" />
            <span className="page-loading-title">正在加载 Box Label</span>
            <span className="page-loading-detail">Loading media images...</span>
          </div>
        </div>
        <LabelWorkbenchInspector mode="image" inspectorState={null} actionGroups={[]} />
      </>
    );
  }

  if (!pool.currentEntry) {
    return (
      <>
        <div
          className={`app pool-label react-box-label-page react-box-label-page--empty react-box-label-page--embedded react-box-label-page--unified-media`}
        >
          <div className="empty">{pool.error || "No media images found."}</div>
        </div>
        <LabelWorkbenchInspector mode="image" inspectorState={null} actionGroups={[]} />
      </>
    );
  }

  const viewProps: BoxLabelViewProps = {
    workspaceRoot,
    datasetRoot: pool.datasetRoot,
    mediaDir: pool.mediaDir,
    entry: pool.currentEntry,
    entries: pool.entries,
    currentIndex: pool.currentIndex,
    selectedFilenames: pool.selectedBasenames,
    shiftSelectedFilenames: pool.shiftSelectedBasenames,
    onNavigate: (index) => {
      pool.navigate(index);
      onImageNavigate?.(index);
    },
    onNavigateBoundary,
    showSideStack: true,
    initialShortcutSlots: pool.initialShortcutSlots,
    initialFixedBoxSlots: pool.initialFixedBoxSlots,
    initialPointerToolEnabled: pool.initialPointerToolEnabled,
    initialAutoFitEnabled: pool.initialAutoFitEnabled,
    onShortcutSlotsChange: pool.onShortcutSlotsChange,
    onToolStateChange: pool.onToolStateChange,
    includeClasses: pool.includeClasses,
    excludeClasses: pool.excludeClasses,
    imageViewMode: pool.imageViewMode,
    metadata: pool.metadata,
    classImageCounts: pool.classImageCounts,
    onAddIncludeClass: pool.addIncludeClass,
    onAddExcludeClass: pool.addExcludeClass,
    onClearClassFilters: pool.clearClassFilters,
    onImageViewModeChange: pool.setImageViewMode,
    onToggleReviewed: pool.toggleReviewed,
    onToggleFlagged: pool.toggleFlagged,
    detectTaskEnabled: pool.currentDetectExportEnabled,
    clfTaskEnabled: pool.currentClfExportEnabled,
    onToggleDetectTaskEnabled: pool.toggleDetectExportEnabled,
    onToggleClfTaskEnabled: pool.toggleClfExportEnabled,
    classPanelSummaries,
    onLabelsChanged: pool.updateLabelIndexForFile,
    onMetadataChanged: pool.reloadMetadata,
    onStatusText: pool.setStatusText,
    onMarkJunk: pool.markJunk,
    classificationClasses: imageClassificationClasses,
    classificationClassesBusy: workspaceClassesLoading || workspaceClassesSaving,
    classificationClassesStatus: classificationClassStatus,
    detectClassKeysById,
    currentClassificationKey,
    onAssignClassificationClass: pool.assignClassificationClass,
    onAddClassificationClass: handleAddClassificationClass,
    onRenameClass: renameWorkspaceClass,
    onWorkspaceClassesChanged: loadWorkspaceClasses,
    canvasOverlay,
    previewDock
  };

  return (
    <ImageLabelEditor
      pool={pool}
      viewProps={viewProps}
      reviewStatus={currentReviewStatus}
      nextTraining={currentNextTraining}
      showError={showError}
    />
  );
}

type ImageLabelEditorProps = {
  pool: BoxLabelPageModel;
  viewProps: BoxLabelViewProps;
  reviewStatus: LabelReviewStatus;
  nextTraining: boolean;
  showError: (err: unknown) => void;
};

/**
 * The editor for the current image. It owns the editor state, so the review actions
 * and the inspector render straight from it.
 */
function ImageLabelEditor({ pool, viewProps, reviewStatus, nextTraining, showError }: ImageLabelEditorProps) {
  // State (not a ref) so the view re-renders once the inspector's slot element mounts.
  const [classificationSlot, setClassificationSlot] = useState<HTMLElement | null>(null);
  const editor = useBoxLabelEditor(viewProps);
  const { workspaceRoot, classificationClasses = [], currentClassificationKey = null } = viewProps;
  const {
    classes: detectClassDefs,
    currentClass,
    duplicateFlow,
    selectDuplicateItem,
    pauseDuplicateFlow,
    resumeDuplicateFlow,
    deleteDuplicateFlow,
    setError
  } = editor;
  const { classImageCounts, junkButtonLabel, markJunk, statusText, toggleNextTraining, toggleReviewed } =
    pool;

  const actionGroups = useMemo<LabelWorkbenchActionGroup[]>(() => {
    const reportError = (err: unknown) => setError(errMessage(err));
    return [
      {
        id: "image-review",
        label: "Review",
        actions: [
          {
            id: "review.markReviewed",
            label: reviewStatus === "approved" ? "Unmark Reviewed" : "Mark Reviewed",
            variant: "primary",
            run: () => void toggleReviewed().catch(showError)
          },
          {
            id: "review.markJunk",
            label: junkButtonLabel,
            variant: "danger",
            disabled: !workspaceRoot.trim(),
            unavailableReason: workspaceRoot.trim() ? undefined : "Open a workspace first.",
            run: () => void markJunk().catch(showError)
          }
        ]
      },
      {
        id: "image-next-training",
        label: "Next Training",
        description: "Star this image so it can be added to the next training batch.",
        actions: [
          {
            id: "training.toggleNext",
            label: nextTraining ? "★ Remove from Next Training" : "☆ Add to Next Training",
            variant: nextTraining ? "primary" : "default",
            run: () => void toggleNextTraining().catch(showError)
          }
        ]
      },
      {
        id: "image-duplicate",
        label: "Duplicate to Next Frame",
        description: duplicateFlow?.message ?? "Select a box and press T to add it to duplicate list.",
        items:
          duplicateFlow?.items.map((item, index) => ({
            id: item.id,
            label: `${index + 1}. ${item.className} x=${item.x.toFixed(3)} y=${item.y.toFixed(3)} w=${item.w.toFixed(3)} h=${item.h.toFixed(3)}`,
            detail: item.paused
              ? "Paused"
              : item.currentBoxIndex === null
                ? "Queued"
                : `Current box ${item.currentBoxIndex + 1}`,
            selected: item.selected,
            tone: item.paused ? "muted" : "default",
            run: () => selectDuplicateItem(item.id),
            onPause: item.paused ? undefined : () => pauseDuplicateFlow(item.id).catch(reportError),
            onResume: item.paused ? () => resumeDuplicateFlow(item.id).catch(reportError) : undefined,
            onDelete: () => deleteDuplicateFlow(item.id).catch(reportError)
          })) ?? [],
        actions: []
      }
    ];
  }, [
    deleteDuplicateFlow,
    duplicateFlow,
    junkButtonLabel,
    markJunk,
    nextTraining,
    pauseDuplicateFlow,
    resumeDuplicateFlow,
    reviewStatus,
    selectDuplicateItem,
    setError,
    showError,
    toggleNextTraining,
    toggleReviewed,
    workspaceRoot
  ]);

  const inspectorState = useMemo<LabelWorkbenchInspectorState>(() => {
    const detectClasses = detectClassDefs.map((item) => ({ id: item.id, name: item.name }));
    return {
      taskKind: "both",
      reviewStatus,
      classSummary: {
        activeDetectCount: detectClasses.length,
        activeClassificationCount: classificationClasses.length,
        observedClassCount: classImageCounts.size
      },
      classPalette: {
        detectClasses,
        classificationClasses,
        currentDetectClassId: currentClass,
        currentClassificationKey,
        readOnlyReason: null
      },
      proposalSummary: null,
      selectedProposal: null,
      warnings: /archived/i.test(statusText)
        ? [
            {
              id: "archived-class-reference",
              label: "Archived class reference",
              detail: statusText,
              tone: "warning"
            }
          ]
        : []
    };
  }, [
    classImageCounts.size,
    classificationClasses,
    currentClass,
    currentClassificationKey,
    detectClassDefs,
    reviewStatus,
    statusText
  ]);

  return (
    <>
      <div className="app pool-label react-box-label-page react-box-label-page--embedded react-box-label-page--unified-media">
        <main className="workspace pool-label-workspace" id="poolLabelWorkspace">
          <BoxLabelView
            {...viewProps}
            editor={editor}
            classificationSlot={classificationSlot}
            previewHeaderActions={<LabelReviewActions mode="image" actionGroups={actionGroups} />}
          />
        </main>
      </div>
      <LabelWorkbenchInspector
        mode="image"
        inspectorState={inspectorState}
        actionGroups={actionGroups}
        classificationSlotRef={setClassificationSlot}
      />
    </>
  );
}
