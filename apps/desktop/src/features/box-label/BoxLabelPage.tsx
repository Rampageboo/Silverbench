import { useCallback, useEffect, useMemo, useState } from "react";
import { useWorkspace } from "../../app/useWorkspace";
import { useToast } from "../../components/useToast";
import { BoxLabelTopbar } from "../../components/BoxLabelTopbar";
import { errMessage } from "../../lib/errors";
import { isFlaggedFile, isReviewedFile } from "../image-pool/metadata";
import { isLabelWorkbenchEmbedded, useLabelWorkbench } from "../label/useLabelWorkbench";
import type { LabelWorkbenchActionGroup } from "../label/labelWorkbenchTypes";
import { BoxLabelGallery } from "./BoxLabelGallery";
import { BoxLabelView } from "./BoxLabelView";
import type { BoxLabelWorkbenchBridge } from "./boxLabelTypes";
import { useBoxLabel } from "./useBoxLabel";

type BoxLabelPageProps = {
  onReady?: () => void;
};

export function BoxLabelPage({ onReady }: BoxLabelPageProps) {
  const { workspaceRoot, poolLabelFocusFilename, clearPoolLabelFocus, chooseWorkspaceFolder } = useWorkspace();
  const { showToast } = useToast();
  const showError = useCallback((err: unknown) => showToast(errMessage(err), { variant: "error" }), [showToast]);
  const [workbenchBridge, setWorkbenchBridge] = useState<BoxLabelWorkbenchBridge | null>(null);
  const pool = useBoxLabel({
    workspaceRoot,
    focusFilename: poolLabelFocusFilename,
    onFocusConsumed: clearPoolLabelFocus,
    onReady
  });

  const workbench = useLabelWorkbench();
  const embedded = isLabelWorkbenchEmbedded(workbench);
  const currentMeta = pool.currentEntry ? pool.metadata.get(pool.currentEntry.basename) : undefined;
  const currentReviewStatus = isFlaggedFile(currentMeta)
    ? "flagged" as const
    : isReviewedFile(currentMeta)
      ? "approved" as const
      : "unreviewed" as const;

  const imageActionGroups = useMemo<LabelWorkbenchActionGroup[]>(() => {
    const proposalCount = workbenchBridge?.proposalCount ?? 0;
    const activeProposalCount = workbenchBridge?.activeProposalCount ?? 0;
    const noProposalReason = workbenchBridge ? "No proposals on the current image." : "Proposal panel is not mounted yet.";
    const noSelectedReason = proposalCount > 0 ? "Select a proposal in the Box Label panel first." : noProposalReason;
    const selectedArchivedReason = "Restore this class in Library before materializing the selected proposal.";
    const acceptAllReason =
      proposalCount > 0 && activeProposalCount <= 0
        ? "All proposals reference archived classes. Restore those classes before materializing."
        : noProposalReason;

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
        id: "image-proposals",
        label: "Proposals",
        actions: [
          {
            id: "proposal.acceptSelected",
            label: "Accept Selected",
            variant: "primary",
            disabled: !workbenchBridge?.acceptSelectedProposal || workbenchBridge.selectedProposalArchived,
            unavailableReason: workbenchBridge?.selectedProposalArchived
              ? selectedArchivedReason
              : workbenchBridge?.acceptSelectedProposal
                ? undefined
                : noSelectedReason,
            run: workbenchBridge?.acceptSelectedProposal ?? undefined,
          },
          {
            id: "proposal.rejectSelected",
            label: "Reject Selected",
            disabled: !workbenchBridge?.rejectSelectedProposal,
            unavailableReason: workbenchBridge?.rejectSelectedProposal ? undefined : noSelectedReason,
            run: workbenchBridge?.rejectSelectedProposal ?? undefined,
          },
          {
            id: "proposal.acceptAll",
            label: "Accept All",
            variant: "primary",
            disabled: !workbenchBridge || proposalCount <= 0 || activeProposalCount <= 0,
            unavailableReason: workbenchBridge && proposalCount > 0 && activeProposalCount > 0 ? undefined : acceptAllReason,
            run: workbenchBridge?.acceptAllProposals,
          },
          {
            id: "proposal.rejectAll",
            label: "Reject All",
            variant: "danger",
            disabled: !workbenchBridge || proposalCount <= 0,
            unavailableReason: workbenchBridge && proposalCount > 0 ? undefined : noProposalReason,
            run: workbenchBridge?.rejectAllProposals,
          },
        ],
      },
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
      taskKind: "detect",
      reviewStatus: currentReviewStatus,
      classSummary: {
        activeDetectCount: workbenchBridge?.activeDetectClasses.length ?? null,
        observedClassCount: pool.classImageCounts.size,
      },
      classPalette: workbenchBridge
        ? {
            detectClasses: workbenchBridge.activeDetectClasses,
            currentDetectClassId: workbenchBridge.currentClassId,
            readOnlyReason: "Class selection remains owned by the Box Label class panel in v1.",
          }
        : null,
      proposalSummary: workbenchBridge
        ? { pendingCount: workbenchBridge.proposalCount, totalCount: workbenchBridge.proposalCount }
        : null,
      selectedProposal: workbenchBridge?.selectedProposalId
        ? {
            id: workbenchBridge.selectedProposalId,
            classId: workbenchBridge.selectedProposalClassId,
            classKey: workbenchBridge.selectedProposalClassKey,
            className: workbenchBridge.selectedProposalClassName,
            confidence: workbenchBridge.selectedProposalConfidence,
            archived: workbenchBridge.selectedProposalArchived,
          }
        : null,
      warnings: [
        ...(/archived/i.test(pool.statusText)
          ? [{
            id: "archived-class-reference",
            label: "Archived class reference",
            detail: pool.statusText,
            tone: "warning",
          } as const]
          : []),
        ...(workbenchBridge?.selectedProposalArchived
          ? [{
              id: "archived-selected-proposal",
              label: "Selected proposal uses an archived class",
              detail: "Restore the class in Library before materializing this proposal.",
              tone: "warning" as const,
            }]
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
    currentReviewStatus,
    pool.statusText,
    workbenchBridge,
    imageActionGroups,
  ]);

  const topbarStatus =
    pool.statusText ||
    (workspaceRoot.trim()
      ? pool.entries.length
        ? `${pool.entries.length} image(s) in detect_dataset`
        : "detect_dataset is empty — send images to Detect first."
      : "Open a workspace with detect_dataset to label detection boxes.");

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
      <div className={`app pool-label react-box-label-page react-box-label-page--loading${embedded ? " react-box-label-page--embedded" : ""}`}>
        <div className="page-loading" role="status" aria-live="polite">
          <span className="page-loading-spinner" aria-hidden="true" />
          <span className="page-loading-title">正在加载 Box Label</span>
          <span className="page-loading-detail">读取 detect_dataset 中的图片…</span>
        </div>
      </div>
    );
  }

  if (!pool.currentEntry) {
    return (
      <div className={`app pool-label react-box-label-page react-box-label-page--empty${embedded ? " react-box-label-page--embedded" : ""}`}>
        {!embedded ? (
          <BoxLabelTopbar
            title="Box Label"
            statusText={pool.error || topbarStatus}
            canMarkJunk={Boolean(workspaceRoot.trim())}
            junkLabel={pool.junkButtonLabel}
            canUndoJunk={pool.canUndoJunk}
            onOpenWorkspace={() => chooseWorkspaceFolder().catch(showError)}
            onMarkJunk={() => pool.markJunk().catch(showError)}
            onUndoJunk={() => pool.undoJunk().catch(showError)}
            {...topbarCommon}
          />
        ) : null}
        <div className="empty">{pool.error || "No images in detect_dataset."}</div>
      </div>
    );
  }

  return (
    <div className={`app pool-label react-box-label-page${embedded ? " react-box-label-page--embedded" : ""}`}>
      {!embedded ? (
        <BoxLabelTopbar
          title="Box Label"
          statusText={topbarStatus}
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
        <BoxLabelView
          workspaceRoot={workspaceRoot}
          datasetRoot={pool.datasetRoot}
          entry={pool.currentEntry}
          entries={pool.entries}
          currentIndex={pool.currentIndex}
          selectedFilenames={pool.selectedBasenames}
          shiftSelectedFilenames={pool.shiftSelectedBasenames}
          onNavigate={pool.navigate}
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
        />
      </main>
    </div>
  );
}
