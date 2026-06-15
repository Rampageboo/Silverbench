import { useCallback, useEffect, useState } from "react";
import { useWorkspace } from "../../app/useWorkspace";
import { useToast } from "../../components/useToast";
import { errMessage } from "../../lib/errors";
import { ImagePoolDuplicates } from "./ImagePoolDuplicates";
import { ImagePoolGrid } from "./ImagePoolGrid";
import { ImagePoolPreview } from "./ImagePoolPreview";
import { ImagePoolToolbar } from "./ImagePoolToolbar";
import { useImagePool } from "./useImagePool";
import { useImagePoolBadge } from "./useImagePoolBadge";
import type { FilteredItem } from "./types";

type ImagePoolPageProps = {
  onReady?: () => void;
  onStatusText?: (text: string) => void;
};

export function ImagePoolPage({ onReady, onStatusText }: ImagePoolPageProps) {
  const { workspaceRoot, openBoxLabel, chooseWorkspaceFolder } = useWorkspace();
  const { setImagePoolNewCount } = useImagePoolBadge();
  const { showToast } = useToast();
  const showError = useCallback(
    (err: unknown) => showToast(errMessage(err), { variant: "error" }),
    [showToast]
  );
  const pool = useImagePool({
    workspaceRoot,
    onReady,
    onScanUpdate: (scan) => setImagePoolNewCount(scan?.newCount ?? 0)
  });
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);

  useEffect(() => {
    onStatusText?.(pool.statsText || pool.status || pool.error);
  }, [onStatusText, pool.statsText, pool.status, pool.error]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName.toLowerCase();
      if (tag === "input" || tag === "textarea" || target?.isContentEditable) return;
      const key = event.key.toLowerCase();
      if (previewIndex !== null) {
        if (key === "j" && !event.ctrlKey && !event.metaKey && !event.altKey) {
          event.preventDefault();
          const item = pool.items[previewIndex];
          if (item) pool.markJunkFiles([item.filename]);
        }
        return;
      }
      if (key === "j" && !event.ctrlKey && !event.metaKey && !event.altKey) {
        event.preventDefault();
        pool.markJunk();
        return;
      }
      if (event.ctrlKey && event.shiftKey && key === "z") {
        event.preventDefault();
        pool.undoJunk();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [pool, previewIndex]);

  const handleCardClick = useCallback(
    (event: React.MouseEvent, index: number, item: FilteredItem) => {
      if (event.shiftKey) {
        pool.rangeSelect(index);
        return;
      }
      if (event.ctrlKey || event.metaKey) {
        pool.toggleSelect(index, item.filename);
        return;
      }
      pool.selectSingle(index, item.filename);
    },
    [pool]
  );

  const handleOpenBoxLabel = useCallback(() => {
    const filename = pool.selectedFilenames[0];
    if (!filename || !pool.scan) return;
    const item = pool.scan.files.find((entry) => entry.filename === filename);
    if (item) openBoxLabel(item);
  }, [pool.selectedFilenames, pool.scan, openBoxLabel]);

  const handleDeleteSingle = useCallback(
    (filename: string) => {
      pool.deleteFilenames([filename]);
    },
    [pool]
  );

  return (
    <div className="react-image-pool-page">
      <main className="image-pool-workspace">
        <section className="panel image-pool-panel">
          <div className="panel-body image-pool-body">
            <ImagePoolToolbar
              statsText={pool.statsText}
              status={pool.status}
              error={pool.error}
              filter={pool.filter}
              junkScope={pool.junkScope}
              hideJunk={pool.hideJunk}
              pending={pool.pending}
              deleting={pool.deleting}
              selectedCount={pool.selected.size}
              canUndoJunk={pool.canUndoJunk}
              junkSelection={pool.junkSelection}
              onOpenWorkspace={() => chooseWorkspaceFolder().catch(showError)}
              onRefresh={() => pool.runScan({ force: true })}
              onMarkSeen={() => pool.markSeen()}
              onSelectAll={pool.selectAllVisible}
              onClearSelection={pool.clearSelection}
              onOpenBoxLabel={handleOpenBoxLabel}
              onDelete={() => pool.deleteSelected()}
              onFilterChange={pool.changeFilter}
              onJunkScopeChange={pool.changeJunkScope}
              onToggleHideJunk={pool.toggleHideJunk}
              onMarkJunk={() => pool.markJunk()}
              onClearJunk={() => pool.clearJunk()}
              onUndoJunk={() => pool.undoJunk()}
            />
            <ImagePoolGrid
              workspaceRoot={workspaceRoot}
              items={pool.items}
              metadata={pool.metadata}
              junkScope={pool.junkScope}
              selected={pool.selected}
              restoreScrollTop={pool.restoreScrollTop}
              restoreImagePath={pool.restoreImagePath}
              emptyMessage={pool.emptyGridMessage}
              cardExtraClasses={pool.cardExtraClasses}
              junkLabelForFile={pool.junkLabelForFile}
              onCardClick={handleCardClick}
              onCardDoubleClick={(index) => setPreviewIndex(index)}
              onScrollChange={pool.queueSessionSave}
              onViewportRestored={pool.clearRestoreViewport}
            />
          </div>
        </section>
        <ImagePoolDuplicates
          workspaceRoot={workspaceRoot}
          scan={pool.duplicateScan}
          pending={pool.duplicatePending}
          onFind={() => pool.scanDuplicates()}
          onClear={() => pool.clearDuplicates()}
          onDeleteFile={(filename) => handleDeleteSingle(filename)}
        />
      </main>
      <ImagePoolPreview
        open={previewIndex !== null}
        workspaceRoot={workspaceRoot}
        items={pool.items}
        metadata={pool.metadata}
        junkScope={pool.junkScope}
        index={previewIndex ?? 0}
        onClose={() => setPreviewIndex(null)}
        onIndexChange={setPreviewIndex}
        onMarkJunk={(filename) => pool.markJunkFiles([filename])}
        onClearJunk={(filename) => pool.clearJunkFiles([filename])}
      />
    </div>
  );
}
