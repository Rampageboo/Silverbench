import type { ImagePoolFilter, JunkScope } from "./types";
import "./imagePool.css";

type ImagePoolToolbarProps = {
  statsText: string;
  status: string;
  error: string;
  filter: ImagePoolFilter;
  junkScope: JunkScope;
  hideJunk: "detect" | "clf" | "both" | null;
  pending: boolean;
  deleting: boolean;
  importing: "copy" | "move" | null;
  selectedCount: number;
  canUndoJunk: boolean;
  junkSelection: { scopeLabel: string; pendingMark: number; pendingClear: number };
  onOpenWorkspace: () => void;
  onRefresh: () => void;
  onImportCopy: () => void;
  onImportMove: () => void;
  onMarkSeen: () => void;
  onSelectAll: () => void;
  onClearSelection: () => void;
  onOpenBoxLabel: () => void;
  onDelete: () => void;
  onFilterChange: (filter: ImagePoolFilter) => void;
  onJunkScopeChange: (scope: JunkScope) => void;
  onToggleHideJunk: (mode: "detect" | "clf" | "both") => void;
  onMarkJunk: () => void;
  onClearJunk: () => void;
  onUndoJunk: () => void;
};

export function ImagePoolToolbar({
  statsText,
  status,
  error,
  filter,
  junkScope,
  hideJunk,
  pending,
  deleting,
  importing,
  selectedCount,
  canUndoJunk,
  junkSelection,
  onOpenWorkspace,
  onRefresh,
  onImportCopy,
  onImportMove,
  onMarkSeen,
  onSelectAll,
  onClearSelection,
  onOpenBoxLabel,
  onDelete,
  onFilterChange,
  onJunkScopeChange,
  onToggleHideJunk,
  onMarkJunk,
  onClearJunk,
  onUndoJunk
}: ImagePoolToolbarProps) {
  const busy = pending || deleting || Boolean(importing);
  const scanning = pending && !importing;
  return (
    <>
      <div className="panel-header">
        <span>Image Library</span>
        <span className="status">{status || statsText}</span>
      </div>
      {error ? (
        <div className="hint" style={{ color: "#f87171" }}>
          {error}
        </div>
      ) : null}
      <div className="row image-pool-toolbar">
        <button type="button" className="primary" disabled={busy} onClick={onOpenWorkspace}>
          Open Workspace
        </button>
        <button type="button" disabled={busy} onClick={onRefresh}>
          {scanning ? "Scanning..." : "Refresh Scan"}
        </button>
        <button type="button" disabled={busy} onClick={onImportCopy}>
          {importing === "copy" ? "Copying..." : "Import Copy"}
        </button>
        <button type="button" disabled={busy} onClick={onImportMove}>
          {importing === "move" ? "Moving..." : "Import Move"}
        </button>
        <button type="button" disabled={busy} onClick={onMarkSeen}>
          Mark All Seen
        </button>
        <button type="button" disabled={busy} onClick={onSelectAll}>
          Select Visible
        </button>
        <button type="button" disabled={busy || !selectedCount} onClick={onClearSelection}>
          Clear Selection
        </button>
        <button type="button" disabled={busy || selectedCount !== 1} onClick={onOpenBoxLabel}>
          Box Label
        </button>
        <button type="button" className="danger" disabled={busy || !selectedCount} onClick={onDelete}>
          {selectedCount ? `Delete (${selectedCount})` : "Delete Selected"}
        </button>
      </div>
      <div className="row image-pool-junk-toolbar">
        <div className="inbox-target-toggle" role="group" aria-label="Junk scope">
          <button
            type="button"
            className={`inbox-target-option${junkScope === "detect" ? " active" : ""}`}
            onClick={() => onJunkScopeChange("detect")}
          >
            Detect
          </button>
          <button
            type="button"
            className={`inbox-target-option${junkScope === "clf" ? " active" : ""}`}
            onClick={() => onJunkScopeChange("clf")}
          >
            Clf
          </button>
        </div>
        <button
          type="button"
          className="danger"
          disabled={busy || !junkSelection.pendingMark}
          onClick={onMarkJunk}
        >
          {selectedCount && junkSelection.pendingMark
            ? `Mark ${junkSelection.scopeLabel} Junk (${junkSelection.pendingMark})`
            : `Mark ${junkSelection.scopeLabel} Junk`}
        </button>
        <button type="button" disabled={busy || !junkSelection.pendingClear} onClick={onClearJunk}>
          {selectedCount && junkSelection.pendingClear
            ? `Clear ${junkSelection.scopeLabel} Junk (${junkSelection.pendingClear})`
            : `Clear ${junkSelection.scopeLabel} Junk`}
        </button>
        <button type="button" disabled={busy || !canUndoJunk} onClick={onUndoJunk}>
          Undo Junk
        </button>
      </div>
      <div className="image-pool-hide-junk row">
        <button
          type="button"
          className={hideJunk === "detect" ? "active" : ""}
          onClick={() => onToggleHideJunk("detect")}
        >
          Hide Detect junk
        </button>
        <button
          type="button"
          className={hideJunk === "clf" ? "active" : ""}
          onClick={() => onToggleHideJunk("clf")}
        >
          Hide Clf junk
        </button>
        <button
          type="button"
          className={hideJunk === "both" ? "active" : ""}
          onClick={() => onToggleHideJunk("both")}
        >
          Hide shared junk
        </button>
      </div>
      <div className="image-pool-filters">
        {(
          [
            ["all", "All"],
            ["new", "NEW"],
            ["unused", "Unused"],
            ["used", "Used"],
            ["junk-detect", "Junk Detect"],
            ["junk-clf", "Junk Clf"],
            ["junk-both", "Junk Both"]
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            className={filter === key ? "active" : ""}
            onClick={() => onFilterChange(key)}
          >
            {label}
          </button>
        ))}
      </div>
    </>
  );
}
