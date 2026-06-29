import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useWorkspace } from "../../app/useWorkspace";
import { useToast } from "../../components/useToast";
import { BoxLabelTopbar } from "../../components/BoxLabelTopbar";
import { errMessage } from "../../lib/errors";
import { isFlaggedFile, isReviewedFile } from "../image-pool/metadata";
import { isLabelWorkbenchEmbedded, useLabelWorkbench } from "../label/useLabelWorkbench";
import type { LabelWorkbenchActionGroup } from "../label/labelWorkbenchTypes";
import { useArchivedClassIds } from "../workspace/useArchivedClassIds";
import { useWorkspaceClasses } from "../workspace/useWorkspaceClasses";
import { chooseClassificationManifest, classificationOptionsForNewAnnotations } from "../workspace/workspaceClassTaxonomy";
import { BoxLabelGallery } from "./BoxLabelGallery";
import { BoxLabelView } from "./BoxLabelView";
import type { BoxLabelCanvasOverlay, BoxLabelWorkbenchBridge } from "./boxLabelTypes";
import { useBoxLabel } from "./useBoxLabel";

type BoxLabelPageProps = {
  onReady?: () => void;
};

export type BoxLabelPageModel = ReturnType<typeof useBoxLabel>;

type BoxLabelSurfaceProps = {
  pool: BoxLabelPageModel;
  showGallery?: boolean;
  unifiedMedia?: boolean;
  showSideStack?: boolean;
  onImageNavigate?: (index: number) => void;
  onNavigateBoundary?: (delta: -1 | 1) => void;
  canvasOverlay?: BoxLabelCanvasOverlay;
};

export function BoxLabelPage({ onReady }: BoxLabelPageProps) {
  const { workspaceRoot, poolLabelFocusFilename, clearPoolLabelFocus, chooseWorkspaceFolder } = useWorkspace();
  const pool = useBoxLabel({
    workspaceRoot,
    focusFilename: poolLabelFocusFilename,
    onFocusConsumed: clearPoolLabelFocus,
    onReady
  });

  return <BoxLabelSurface pool={pool} />;
}

export function BoxLabelSurface({
  pool,
  showGallery = true,
  unifiedMedia = false,
  showSideStack = true,
  onImageNavigate,
  onNavigateBoundary,
  canvasOverlay,
}: BoxLabelSurfaceProps) {
  const { workspaceRoot, chooseWorkspaceFolder } = useWorkspace();
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
  } = useWorkspaceClasses(workspaceRoot);

  const workbench = useLabelWorkbench();
  const embedded = isLabelWorkbenchEmbedded(workbench);
  const currentMeta = pool.currentEntry ? pool.metadata.get(pool.currentEntry.basename) : undefined;
  const currentClassificationKey =
    currentMeta?.clf_enabled && currentMeta.clf_class ? currentMeta.clf_class : null;
  const currentReviewStatus = isFlaggedFile(currentMeta)
    ? "flagged" as const
    : isReviewedFile(currentMeta)
      ? "approved" as const
      : "unreviewed" as const;

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
        })) ?? [],
        actions: [
          {
            id: "duplicate.start",
            label: "Add",
            title: "Add selected box to duplicate list (T)",
            variant: "primary",
            disabled: !duplicateFlow?.canStart || !workbenchBridge?.startDuplicateToNext,
            unavailableReason: duplicateFlow?.canStart ? undefined : "Select a box to add.",
            run: workbenchBridge?.startDuplicateToNext ?? undefined,
          },
          {
            id: "duplicate.pause",
            label: "Pause",
            title: "Pause the selected duplicate box; remove it from this frame if present.",
            disabled: !duplicateFlow?.canPause || !workbenchBridge?.pauseDuplicateFlow,
            unavailableReason: duplicateFlow?.canPause ? undefined : "Select an active duplicate box.",
            run: workbenchBridge?.pauseDuplicateFlow ?? undefined,
          },
          {
            id: "duplicate.resume",
            label: "Resume",
            title: "Resume the paused duplicate on this frame.",
            disabled: !duplicateFlow?.canResume || !workbenchBridge?.resumeDuplicateFlow,
            unavailableReason: duplicateFlow?.canResume ? undefined : "Duplicate is not paused.",
            run: workbenchBridge?.resumeDuplicateFlow ?? undefined,
          },
          {
            id: "duplicate.delete",
            label: "Delete",
            title: "Delete the selected duplicate box.",
            variant: "danger",
            disabled: !duplicateFlow?.canDelete || !workbenchBridge?.deleteDuplicateFlow,
            unavailableReason: duplicateFlow?.canDelete ? undefined : "No duplicate box selected.",
            run: workbenchBridge?.deleteDuplicateFlow ?? undefined,
          },
        ],
      }
    ];
  }, [
    currentReviewStatus,
    pool.currentEntry,
    pool.junkButtonLabel,
    pool.markJunk,
    pool.toggleReviewed,
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
          archived: def.archived,
        }))
      : [],
    [classificationManifest]
  );
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

  const topbarStatus =
    pool.statusText ||
    (workspaceRoot.trim()
      ? pool.entries.length
        ? `${pool.entries.length} media image(s)`
        : "detect_dataset is empty — send images to Detect first."
      : "Open a workspace to label media.");

  const mediaTopbarStatus =
    pool.statusText ||
    (workspaceRoot.trim()
      ? pool.entries.length
        ? `${pool.entries.length} media image(s)`
        : "No media images found. Import images to start labeling."
      : "Open a workspace to label media.");

  const reviewNames =
    pool.selectedBasenames.size > 0
      ? [...pool.selectedBasenames]
      : pool.currentEntry
        ? [pool.currentEntry.basename]
        : [];
  const reviewedCount = reviewNames.filter((name) => isReviewedFile(pool.metadata.get(name))).length;
  const reviewedLabel =
    reviewNames.length > 1
      ? `Reviewed ${reviewedCount}/${reviewNames.length}`
      : pool.currentEntry && isReviewedFile(pool.metadata.get(pool.currentEntry.basename))
        ? "Reviewed: Yes"
        : "Reviewed";
  const reviewedActive = reviewNames.length > 0 && reviewedCount === reviewNames.length;
  const flagged =
    reviewNames.length > 0 && reviewNames.some((name) => isFlaggedFile(pool.metadata.get(name)));

  const topbarCommon = {
    reviewedLabel,
    reviewedActive,
    flagged,
    onToggleReviewed: () => pool.toggleReviewed().catch(showError),
    onToggleFlagged: () => pool.toggleFlagged().catch(showError)
  };

  if (pool.pending && !pool.entries.length) {
    return (
      <div className={`app pool-label react-box-label-page react-box-label-page--loading${embedded ? " react-box-label-page--embedded" : ""}${unifiedMedia ? " react-box-label-page--unified-media" : ""}`}>
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
      <div className={`app pool-label react-box-label-page react-box-label-page--empty${embedded ? " react-box-label-page--embedded" : ""}${unifiedMedia ? " react-box-label-page--unified-media" : ""}`}>
        {!embedded ? (
          <BoxLabelTopbar
            title="Box Label"
            statusText={pool.error || mediaTopbarStatus}
            canMarkJunk={Boolean(workspaceRoot.trim())}
            junkLabel={pool.junkButtonLabel}
            canUndoJunk={pool.canUndoJunk}
            onOpenWorkspace={() => chooseWorkspaceFolder().catch(showError)}
            onMarkJunk={() => pool.markJunk().catch(showError)}
            onUndoJunk={() => pool.undoJunk().catch(showError)}
            {...topbarCommon}
          />
        ) : null}
        <div className="empty">{pool.error || "No media images found."}</div>
      </div>
    );
  }

  return (
    <div className={`app pool-label react-box-label-page${embedded ? " react-box-label-page--embedded" : ""}${unifiedMedia ? " react-box-label-page--unified-media" : ""}`}>
      {!embedded ? (
        <BoxLabelTopbar
          title="Box Label"
          statusText={mediaTopbarStatus}
          canMarkJunk={Boolean(workspaceRoot.trim())}
          junkLabel={pool.junkButtonLabel}
          canUndoJunk={pool.canUndoJunk}
          onOpenWorkspace={() => chooseWorkspaceFolder().catch(showError)}
          onMarkJunk={() => pool.markJunk().catch(showError)}
          onUndoJunk={() => pool.undoJunk().catch(showError)}
          {...topbarCommon}
        />
      ) : null}
      <main className="workspace pool-label-workspace" id="poolLabelWorkspace">
        {showGallery ? (
          <BoxLabelGallery
            datasetRoot={pool.datasetRoot}
            entries={pool.entries}
            currentIndex={pool.currentIndex}
            shiftSelectedBasenames={pool.shiftSelectedBasenames}
            metadata={pool.metadata}
            imageViewMode={pool.imageViewMode}
            restoreScrollTop={pool.restoreScrollTop}
            restoreImagePath={pool.restoreImagePath}
            onSelect={pool.selectGalleryImage}
            onScrollChange={pool.onGalleryScroll}
            onViewportRestored={pool.clearRestoreViewport}
            onImageViewModeChange={pool.setImageViewMode}
          />
        ) : null}
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
          showSideStack={showSideStack}
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
          onLabelsChanged={pool.updateLabelIndexForFile}
          onMetadataChanged={pool.reloadMetadata}
          onStatusText={pool.setStatusText}
          onWorkbenchBridgeChange={setWorkbenchBridge}
          onMarkJunk={pool.markJunk}
          onUndoJunk={pool.undoJunk}
          classificationClasses={imageClassificationClasses}
          classificationClassesBusy={workspaceClassesLoading || workspaceClassesSaving}
          classificationClassesStatus={classificationClassStatus}
          classificationClassesPortalId={embedded ? "lwbClassifyClassesSlot" : undefined}
          currentClassificationKey={currentClassificationKey}
          onAssignClassificationClass={pool.assignClassificationClass}
          onAddClassificationClass={handleAddClassificationClass}
          onWorkspaceClassesChanged={loadWorkspaceClasses}
          canvasOverlay={canvasOverlay}
        />
      </main>
    </div>
  );
}
