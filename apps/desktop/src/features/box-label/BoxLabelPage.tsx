import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useWorkspace } from "../../app/useWorkspace";
import { useToast } from "../../components/useToast";
import { errMessage } from "../../lib/errors";
import { isFlaggedFile, isNextTrainingFile, isReviewedFile } from "../image-pool/metadata";
import { useLabelWorkbench } from "../label/useLabelWorkbench";
import type { LabelWorkbenchActionGroup } from "../label/labelWorkbenchTypes";
import { useArchivedClassIds } from "../workspace/useArchivedClassIds";
import { useWorkspaceClasses } from "../workspace/useWorkspaceClasses";
import { activeDetectClassDefs, chooseClassificationManifest, classificationOptionsForNewAnnotations } from "../workspace/workspaceClassTaxonomy";
import { BoxLabelView } from "./BoxLabelView";
import type { BoxLabelCanvasOverlay, BoxLabelViewProps, BoxLabelWorkbenchBridge } from "./boxLabelTypes";
import type { BoxLabelModel } from "./useBoxLabel";
import "./boxLabel.css";

export type BoxLabelPageModel = BoxLabelModel;

type BoxLabelSurfaceProps = {
  pool: BoxLabelPageModel;
  onImageNavigate?: (index: number) => void;
  onNavigateBoundary?: (delta: -1 | 1) => void;
  classPanelSummaries?: BoxLabelViewProps["classPanelSummaries"];
  canvasOverlay?: BoxLabelCanvasOverlay;
  previewDock?: BoxLabelCanvasOverlay;
  previewHeaderActions?: BoxLabelViewProps["previewHeaderActions"];
};

/** The image label surface inside the Label workbench. */
export function BoxLabelSurface({
  pool,
  onImageNavigate,
  onNavigateBoundary,
  classPanelSummaries,
  canvasOverlay,
  previewDock,
  previewHeaderActions,
}: BoxLabelSurfaceProps) {
  const { workspaceRoot } = useWorkspace();
  const { showToast } = useToast();
  const showError = useCallback((err: unknown) => showToast(errMessage(err), { variant: "error" }), [showToast]);
  const [workbenchBridge, setWorkbenchBridge] = useState<BoxLabelWorkbenchBridge | null>(null);
  const { manifest: classManifest } = useArchivedClassIds(workspaceRoot);
  const {
    manifest: workspaceClassManifest,
    loading: workspaceClassesLoading,
    saving: workspaceClassesSaving,
    loadError: workspaceClassesLoadError,
    saveError: workspaceClassesSaveError,
    load: loadWorkspaceClasses,
    addClf,
    rename: renameWorkspaceClass,
  } = useWorkspaceClasses(workspaceRoot);

  const workbench = useLabelWorkbench();
  const currentMeta = pool.currentEntry ? pool.metadata.get(pool.currentEntry.basename) : undefined;
  const currentClassificationKey =
    currentMeta?.clf_enabled && currentMeta.clf_class ? currentMeta.clf_class : null;
  const currentReviewStatus = isFlaggedFile(currentMeta)
    ? "flagged" as const
    : isReviewedFile(currentMeta)
      ? "approved" as const
      : "unreviewed" as const;
  const currentNextTraining = isNextTrainingFile(currentMeta);

  const imageActionGroups = useMemo<LabelWorkbenchActionGroup[]>(() => {
    const duplicateFlow = workbenchBridge?.duplicateFlow ?? null;
    return [
      {
        id: "image-review",
        label: "Review",
        actions: [
          {
            id: "review.markReviewed",
            label: currentReviewStatus === "approved" ? "Unmark Reviewed" : "Mark Reviewed",
            variant: "primary",
            disabled: !pool.currentEntry,
            unavailableReason: pool.currentEntry ? undefined : "No image selected.",
            run: () => void pool.toggleReviewed().catch(showError),
          },
          {
            id: "review.markJunk",
            label: pool.junkButtonLabel,
            variant: "danger",
            disabled: !workspaceRoot.trim() || !pool.currentEntry,
            unavailableReason: !workspaceRoot.trim()
              ? "Open a workspace first."
              : pool.currentEntry
                ? undefined
                : "No image selected.",
            run: () => void pool.markJunk().catch(showError),
          },
        ],
      },
      {
        id: "image-next-training",
        label: "Next Training",
        description: "Star this image so it can be added to the next training batch.",
        actions: [
          {
            id: "training.toggleNext",
            label: currentNextTraining ? "★ Remove from Next Training" : "☆ Add to Next Training",
            variant: currentNextTraining ? "primary" : "default",
            disabled: !pool.currentEntry,
            unavailableReason: pool.currentEntry ? undefined : "No image selected.",
            run: () => void pool.toggleNextTraining().catch(showError),
          },
        ],
      },
      {
        id: "image-duplicate",
        label: "Duplicate to Next Frame",
        description: duplicateFlow?.message ?? "Select a box and press T to add it to duplicate list.",
        items: duplicateFlow?.items.map((item, index) => ({
          id: item.id,
          label: `${index + 1}. ${item.className} x=${item.x.toFixed(3)} y=${item.y.toFixed(3)} w=${item.w.toFixed(3)} h=${item.h.toFixed(3)}`,
          detail: item.paused ? "Paused" : item.currentBoxIndex === null ? "Queued" : `Current box ${item.currentBoxIndex + 1}`,
          selected: item.selected,
          tone: item.paused ? "muted" : "default",
          run: workbenchBridge?.selectDuplicateItem ? () => workbenchBridge.selectDuplicateItem?.(item.id) : undefined,
          onPause: !item.paused && workbenchBridge?.pauseDuplicateFlow
            ? () => workbenchBridge.pauseDuplicateFlow?.(item.id)
            : undefined,
          onResume: item.paused && workbenchBridge?.resumeDuplicateFlow
            ? () => workbenchBridge.resumeDuplicateFlow?.(item.id)
            : undefined,
          onDelete: workbenchBridge?.deleteDuplicateFlow
            ? () => workbenchBridge.deleteDuplicateFlow?.(item.id)
            : undefined,
        })) ?? [],
        actions: [],
      }
    ];
  }, [
    currentReviewStatus,
    currentNextTraining,
    pool.currentEntry,
    pool.junkButtonLabel,
    pool.markJunk,
    pool.toggleReviewed,
    pool.toggleNextTraining,
    showError,
    workbenchBridge,
    workspaceRoot,
  ]);

  const classificationManifest = useMemo(
    () => chooseClassificationManifest(workspaceClassManifest, classManifest),
    [classManifest, workspaceClassManifest]
  );

  const imageClassificationClasses = useMemo(
    () => classificationManifest
      ? classificationOptionsForNewAnnotations(classificationManifest).map((def) => ({
          key: def.key,
          name: def.name,
          aliases: def.aliases,
          archived: def.archived,
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
    () => workspaceClassManifest ? classificationOptionsForNewAnnotations(workspaceClassManifest).length : null,
    [workspaceClassManifest]
  );
  const archivedClfClassCount = useMemo(
    () => classManifest ? classificationOptionsForNewAnnotations(classManifest).length : null,
    [classManifest]
  );

  const classificationClassStatus =
    workspaceClassesLoading
      ? "Loading classification classes..."
      : workspaceClassesLoadError || workspaceClassesSaveError ||
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

  useEffect(() => {
    if (!workbench) return;
    if (!pool.currentEntry) {
      workbench.reportSourceSummary?.(null);
      workbench.reportInspectorState?.(null);
      workbench.clearWorkbenchActions?.();
      setWorkbenchBridge(null);
      return;
    }
    const basename = pool.currentEntry.basename;
    workbench.reportSourceSummary?.({
      kind: "image",
      totalImages: pool.entries.length,
      currentIndex: pool.currentIndex,
      filename: basename,
      reviewStatus: currentReviewStatus,
    });
    workbench.reportInspectorState?.({
      taskKind: "both",
      reviewStatus: currentReviewStatus,
      classSummary: {
        activeDetectCount: workbenchBridge?.activeDetectClasses.length ?? null,
        activeClassificationCount: imageClassificationClasses.length,
        observedClassCount: pool.classImageCounts.size,
      },
      classPalette: workbenchBridge
        ? {
            detectClasses: workbenchBridge.activeDetectClasses,
            classificationClasses: imageClassificationClasses,
            currentDetectClassId: workbenchBridge.currentClassId,
            currentClassificationKey,
            readOnlyReason: null,
          }
        : null,
      proposalSummary: null,
      selectedProposal: null,
      warnings: [
        ...(/archived/i.test(pool.statusText)
          ? [{
            id: "archived-class-reference",
            label: "Archived class reference",
            detail: pool.statusText,
            tone: "warning",
          } as const]
          : []),
      ],
    });
    workbench.registerWorkbenchActions?.(imageActionGroups);
    return () => {
      workbench.reportSourceSummary?.(null);
      workbench.reportInspectorState?.(null);
      workbench.clearWorkbenchActions?.();
    };
  }, [
    workbench,
    pool.currentEntry,
    pool.entries.length,
    pool.currentIndex,
    pool.metadata,
    pool.classImageCounts.size,
    currentClassificationKey,
    currentReviewStatus,
    pool.statusText,
    workbenchBridge,
    imageClassificationClasses,
    imageActionGroups,
  ]);

  if (pool.pending && !pool.entries.length) {
    return (
      <div className={`app pool-label react-box-label-page react-box-label-page--loading react-box-label-page--embedded react-box-label-page--unified-media`}>
        <div className="page-loading" role="status" aria-live="polite">
          <span className="page-loading-spinner" aria-hidden="true" />
          <span className="page-loading-title">正在加载 Box Label</span>
          <span className="page-loading-detail">Loading media images...</span>
        </div>
      </div>
    );
  }

  if (!pool.currentEntry) {
    return (
      <div className={`app pool-label react-box-label-page react-box-label-page--empty react-box-label-page--embedded react-box-label-page--unified-media`}>
        <div className="empty">{pool.error || "No media images found."}</div>
      </div>
    );
  }

  return (
    <div className={`app pool-label react-box-label-page react-box-label-page--embedded react-box-label-page--unified-media`}>
      <main className="workspace pool-label-workspace" id="poolLabelWorkspace">
        <BoxLabelView
          workspaceRoot={workspaceRoot}
          datasetRoot={pool.datasetRoot}
          mediaDir={pool.mediaDir}
          entry={pool.currentEntry}
          entries={pool.entries}
          currentIndex={pool.currentIndex}
          selectedFilenames={pool.selectedBasenames}
          shiftSelectedFilenames={pool.shiftSelectedBasenames}
          onNavigate={(index) => {
            pool.navigate(index);
            onImageNavigate?.(index);
          }}
          onNavigateBoundary={onNavigateBoundary}
          showSideStack
          initialShortcutSlots={pool.initialShortcutSlots}
          initialFixedBoxSlots={pool.initialFixedBoxSlots}
          initialPointerToolEnabled={pool.initialPointerToolEnabled}
          initialAutoFitEnabled={pool.initialAutoFitEnabled}
          onShortcutSlotsChange={pool.onShortcutSlotsChange}
          onToolStateChange={pool.onToolStateChange}
          includeClasses={pool.includeClasses}
          excludeClasses={pool.excludeClasses}
          imageViewMode={pool.imageViewMode}
          metadata={pool.metadata}
          classImageCounts={pool.classImageCounts}
          onAddIncludeClass={pool.addIncludeClass}
          onAddExcludeClass={pool.addExcludeClass}
          onClearClassFilters={pool.clearClassFilters}
          onImageViewModeChange={pool.setImageViewMode}
          onToggleReviewed={pool.toggleReviewed}
          onToggleFlagged={pool.toggleFlagged}
          detectTaskEnabled={pool.currentDetectExportEnabled}
          clfTaskEnabled={pool.currentClfExportEnabled}
          onToggleDetectTaskEnabled={pool.toggleDetectExportEnabled}
          onToggleClfTaskEnabled={pool.toggleClfExportEnabled}
          classPanelSummaries={classPanelSummaries}
          onLabelsChanged={pool.updateLabelIndexForFile}
          onMetadataChanged={pool.reloadMetadata}
          onStatusText={pool.setStatusText}
          onWorkbenchBridgeChange={setWorkbenchBridge}
          onMarkJunk={pool.markJunk}
          classificationClasses={imageClassificationClasses}
          classificationClassesBusy={workspaceClassesLoading || workspaceClassesSaving}
          classificationClassesStatus={classificationClassStatus}
          classificationClassesInWorkbenchSlot
          detectClassKeysById={detectClassKeysById}
          currentClassificationKey={currentClassificationKey}
          onAssignClassificationClass={pool.assignClassificationClass}
          onAddClassificationClass={handleAddClassificationClass}
          onRenameClass={renameWorkspaceClass}
          onWorkspaceClassesChanged={loadWorkspaceClasses}
          canvasOverlay={canvasOverlay}
          previewDock={previewDock}
          previewHeaderActions={previewHeaderActions}
        />
      </main>
    </div>
  );
}
