type BoxLabelTopbarProps = {
  title: string;
  statusText: string;
  canMarkJunk: boolean;
  junkLabel: string;
  canUndoJunk: boolean;
  reviewedLabel?: string;
  reviewedActive?: boolean;
  flagged?: boolean;
  onOpenWorkspace: () => void;
  onMarkJunk: () => void;
  onUndoJunk: () => void;
  onToggleReviewed?: () => void;
  onToggleFlagged?: () => void;
};

export function BoxLabelTopbar({
  title,
  statusText,
  canMarkJunk,
  junkLabel,
  canUndoJunk,
  reviewedLabel = "Reviewed",
  reviewedActive = false,
  flagged = false,
  onOpenWorkspace,
  onMarkJunk,
  onUndoJunk,
  onToggleReviewed,
  onToggleFlagged
}: BoxLabelTopbarProps) {
  return (
    <header className="topbar react-box-label-topbar">
      <div className="brand">{title}</div>
      <div className="topbar-actions">
        <button type="button" className="primary" onClick={onOpenWorkspace}>
          Open Workspace
        </button>
        {onToggleReviewed ? (
          <button
            type="button"
            id="markReviewedBtn"
            className={reviewedActive ? "primary" : ""}
            onClick={() => onToggleReviewed()}
          >
            {reviewedLabel}
          </button>
        ) : null}
        {onToggleFlagged ? (
          <button
            type="button"
            id="flagBtn"
            className={flagged ? "danger" : ""}
            onClick={() => onToggleFlagged()}
          >
            {flagged ? "Flagged" : "Flag"}
          </button>
        ) : null}
        {canMarkJunk ? (
          <>
            <button type="button" id="markJunkBtn" className="danger" onClick={onMarkJunk}>
              {junkLabel}
            </button>
            <button type="button" disabled={!canUndoJunk} onClick={onUndoJunk}>
              Undo Junk
            </button>
          </>
        ) : null}
      </div>
      <div className="status">{statusText}</div>
    </header>
  );
}
