import { useWorkspace } from "../../app/WorkspaceProvider";
import { BoxLabelTopbar } from "../../components/BoxLabelTopbar";
import { isFlaggedFile, isReviewedFile } from "../image-pool/metadata";
import { BoxLabelGallery } from "./BoxLabelGallery";
import { BoxLabelView } from "./BoxLabelView";
import { useBoxLabel } from "./useBoxLabel";

type BoxLabelPageProps = {
  onReady?: () => void;
};

export function BoxLabelPage({ onReady }: BoxLabelPageProps) {
  const { workspaceRoot, poolLabelFocusFilename, clearPoolLabelFocus, chooseWorkspaceFolder } = useWorkspace();
  const pool = useBoxLabel({
    workspaceRoot,
    focusFilename: poolLabelFocusFilename,
    onFocusConsumed: clearPoolLabelFocus,
    onReady
  });

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
    onToggleReviewed: () => pool.toggleReviewed().catch(() => {}),
    onToggleFlagged: () => pool.toggleFlagged().catch(() => {})
  };

  if (pool.pending && !pool.entries.length) {
    return (
      <div className="app pool-label react-box-label-page react-box-label-page--loading">
        <div className="empty">Loading detect_dataset for Box Label...</div>
      </div>
    );
  }

  if (!pool.currentEntry) {
    return (
      <div className="app pool-label react-box-label-page react-box-label-page--empty">
        <BoxLabelTopbar
          title="Box Label"
          statusText={pool.error || topbarStatus}
          canMarkJunk={Boolean(workspaceRoot.trim())}
          junkLabel={pool.junkButtonLabel}
          canUndoJunk={pool.canUndoJunk}
          onOpenWorkspace={() => chooseWorkspaceFolder().catch(() => {})}
          onMarkJunk={() => pool.markJunk().catch(() => {})}
          onUndoJunk={() => pool.undoJunk().catch(() => {})}
          {...topbarCommon}
        />
        <div className="empty">{pool.error || "No images in detect_dataset."}</div>
      </div>
    );
  }

  return (
    <div className="app pool-label react-box-label-page">
      <BoxLabelTopbar
        title="Box Label"
        statusText={topbarStatus}
        canMarkJunk={Boolean(workspaceRoot.trim())}
        junkLabel={pool.junkButtonLabel}
        canUndoJunk={pool.canUndoJunk}
        onOpenWorkspace={() => chooseWorkspaceFolder().catch(() => {})}
        onMarkJunk={() => pool.markJunk().catch(() => {})}
        onUndoJunk={() => pool.undoJunk().catch(() => {})}
        {...topbarCommon}
      />
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
          onAddIncludeClass={pool.addIncludeClass}
          onAddExcludeClass={pool.addExcludeClass}
          onClearClassFilters={pool.clearClassFilters}
          onImageViewModeChange={pool.setImageViewMode}
          onToggleReviewed={pool.toggleReviewed}
          onToggleFlagged={pool.toggleFlagged}
          onLabelsChanged={pool.updateLabelIndexForFile}
          onMetadataChanged={pool.reloadMetadata}
          onStatusText={pool.setStatusText}
          onMarkJunk={pool.markJunk}
          onUndoJunk={pool.undoJunk}
        />
      </main>
    </div>
  );
}
