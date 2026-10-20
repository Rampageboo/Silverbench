import { useCallback, useEffect, useMemo, useState } from "react";
import { useWorkspace } from "../../app/useWorkspace";
import { useToast } from "../../components/useToast";
import { errMessage } from "../../lib/errors";
import { ImagePoolPreview } from "../image-pool/ImagePoolPreview";
import type { FilteredItem } from "../image-pool/types";
import { BuildProgressOverlay } from "./BuildProgressOverlay";
import { ImageAssignGrid } from "./ImageAssignGrid";
import { ImageAssignPanel } from "./ImageAssignPanel";
import { useImageAssign } from "./useImageAssign";
import { useImagePoolBadge } from "../image-pool/useImagePoolBadge";
import "./inbox.css";

type ImageAssignPageProps = {
  onReady?: () => void;
  onStatusText?: (text: string) => void;
};

export function ImageAssignPage({ onReady, onStatusText }: ImageAssignPageProps) {
  const { workspaceRoot, chooseWorkspaceFolder } = useWorkspace();
  const { setImagePoolNewCount } = useImagePoolBadge();
  const { showToast } = useToast();
  const showError = useCallback(
    (err: unknown) => showToast(errMessage(err), { variant: "error" }),
    [showToast]
  );
  const onScanUpdate = useCallback(
    (count: number) => setImagePoolNewCount(count),
    [setImagePoolNewCount]
  );
  const assign = useImageAssign({
    workspaceRoot,
    onReady,
    onScanUpdate
  });
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);

  useEffect(() => {
    onStatusText?.(assign.statsText || assign.log || assign.error);
  }, [assign.statsText, assign.log, assign.error, onStatusText]);

  const previewItems: FilteredItem[] = useMemo(
    () => assign.items.map((item) => ({ ...item, imagePath: item.imagePath })),
    [assign.items]
  );

  const previewSubset = useMemo(() => {
    if (previewIndex === null) return previewItems;
    const current = assign.items[previewIndex];
    if (!current || assign.selected.size <= 1 || !assign.selected.has(current.filename)) {
      return previewItems;
    }
    return previewItems.filter((item) => assign.selected.has(item.filename));
  }, [assign.items, assign.selected, previewIndex, previewItems]);

  const handleApply = useCallback(
    (newClass?: string) => {
      const run = newClass ? assign.applyWithNewClass(newClass) : assign.applyAssignment();
      run.catch(showError);
    },
    [assign, showError]
  );

  return (
    <div className="react-image-assign-page">
      <main className="inbox-workspace">
        <section className="panel inbox-gallery-panel">
          <div className="panel-header">
            <span>Images to Assign</span>
            <span id="inboxStats" className="status">
              {assign.statsText}
            </span>
          </div>
          <div className="panel-body inbox-body">
            <div className="row inbox-toolbar">
              <button type="button" className="primary" id="inboxOpenFolderBtn" onClick={() => chooseWorkspaceFolder().catch(showError)}>
                Open Workspace
              </button>
              <button type="button" id="inboxRefreshBtn" disabled={assign.pending} onClick={() => assign.refresh()}>
                Refresh
              </button>
              <button type="button" id="inboxSelectAllBtn" onClick={assign.selectAllVisible}>
                Select Visible
              </button>
              <button type="button" id="inboxClearSelectionBtn" onClick={assign.clearSelection}>
                Clear Selection
              </button>
              <button
                type="button"
                className="danger"
                id="inboxMarkJunkBtn"
                disabled={!assign.junkSelection.pendingMark || assign.assigning}
                onClick={() => assign.markJunk()}
              >
                {assign.junkSelection.markLabel}
              </button>
              <button
                type="button"
                id="inboxClearJunkBtn"
                disabled={!assign.junkSelection.pendingClear || assign.assigning}
                onClick={() => assign.clearJunk()}
              >
                {assign.junkSelection.clearLabel}
              </button>
              <button type="button" id="inboxUndoJunkBtn" disabled={!assign.canUndoJunk || assign.assigning} onClick={() => assign.undoJunk()}>
                撤回废片
              </button>
            </div>
            <div className="inbox-filters">
              {(
                [
                  ["new", "NEW"],
                  ["unassigned", "No Metadata"],
                  ["random-unused", "Random 100"],
                  ["all", "All"]
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  id={`inboxFilter${key === "new" ? "New" : key === "unassigned" ? "Unassigned" : key === "random-unused" ? "RandomUnused" : "All"}Btn`}
                  className={assign.filter === key ? "active" : ""}
                  onClick={() => assign.changeFilter(key)}
                >
                  {label}
                </button>
              ))}
            </div>
            {assign.error ? <div className="error-banner">{assign.error}</div> : null}
            <ImageAssignGrid
              workspaceRoot={workspaceRoot}
              items={assign.items}
              metadata={assign.metadata}
              junkScope={assign.junkScope}
              selected={assign.selected}
              pendingFilenames={assign.pendingFilenames}
              restoreScrollTop={assign.restoreGalleryScrollTop}
              onSelect={assign.handleSelect}
              onDoubleClick={setPreviewIndex}
              onScrollChange={assign.onGalleryScroll}
              onViewportRestored={assign.clearGalleryRestore}
            />
          </div>
        </section>
        <ImageAssignPanel
          selectedCount={assign.selected.size}
          workflowStatus={assign.workflowStatus}
          assignTarget={assign.assignTarget}
          assigning={assign.assigning}
          log={assign.log}
          pendingFiles={assign.pendingFiles}
          rebuild={assign.rebuild}
          clfClasses={assign.clfClasses}
          detectClasses={assign.detectClasses}
          clfClassCounts={assign.clfClassCounts}
          detectClassCounts={assign.detectClassCounts}
          clfDatasetPath={assign.clfDatasetPath}
          detectDatasetPath={assign.detectDatasetPath}
          selectedClass={assign.selectedClass}
          selectedDetectClassId={assign.selectedDetectClassId}
          classSearch={assign.classSearch}
          detectClassSearch={assign.detectClassSearch}
          canQuickAssign={assign.selected.size > 0 && !assign.assigning}
          onAssignTargetChange={assign.changeAssignTarget}
          onClassSearchChange={assign.setClassSearch}
          onDetectClassSearchChange={assign.setDetectClassSearch}
          onSelectClass={assign.setSelectedClass}
          onQuickAssignClass={(className) => assign.quickAssignClass(className).catch(showError)}
          onSelectDetectClass={assign.setSelectedDetectClassId}
          onQuickAssignDetect={() => assign.quickAssignDetect().catch(showError)}
          onApplySelected={handleApply}
          onBuildPending={() => assign.buildLinks("pending").catch(showError)}
          onBuildAll={() => assign.buildLinks("all").catch(showError)}
          onRebuildChange={assign.setRebuild}
        />
      </main>
      <ImagePoolPreview
        open={previewIndex !== null}
        workspaceRoot={workspaceRoot}
        items={previewSubset}
        metadata={assign.metadata}
        junkScope={assign.junkScope}
        index={
          previewIndex !== null && previewSubset.length !== previewItems.length
            ? Math.max(
                0,
                previewSubset.findIndex(
                  (item) => item.filename === assign.items[previewIndex ?? 0]?.filename
                )
              )
            : previewIndex ?? 0
        }
        onClose={() => setPreviewIndex(null)}
        onIndexChange={(index) => {
          const item = previewSubset[index];
          if (!item) return;
          const fullIndex = assign.items.findIndex((entry) => entry.filename === item.filename);
          setPreviewIndex(fullIndex >= 0 ? fullIndex : index);
        }}
        onMarkJunk={(filename) => {
          assign.handleSelect(
            assign.items.findIndex((item) => item.filename === filename),
            {}
          );
          assign.markJunk();
        }}
        onClearJunk={(filename) => {
          assign.handleSelect(
            assign.items.findIndex((item) => item.filename === filename),
            {}
          );
          assign.clearJunk();
        }}
      />
      <BuildProgressOverlay
        open={assign.buildProgress.open}
        done={assign.buildProgress.done}
        total={assign.buildProgress.total}
        detail={assign.buildProgress.detail}
      />
    </div>
  );
}
