import type { ImageWorkspaceTab } from "../features/image-pool/imageWorkspaceMode";
import { imageWorkspaceTitle } from "../features/image-pool/imageWorkspaceMode";

type ImageWorkspaceTopbarProps = {
  tab: ImageWorkspaceTab;
  statusText: string;
  imagePoolNewCount?: number;
  onTabChange: (tab: ImageWorkspaceTab) => void;
};

const MODES: Array<{ tab: ImageWorkspaceTab; label: string; showNewBadge?: boolean }> = [
  { tab: "image-pool", label: "Pool" },
  { tab: "inbox", label: "Legacy Assign", showNewBadge: true },
  { tab: "yolo", label: "Review" }
];

export function ImageWorkspaceTopbar({
  tab,
  statusText,
  imagePoolNewCount = 0,
  onTabChange
}: ImageWorkspaceTopbarProps) {
  return (
    <header className="image-workspace-topbar">
      <div className="brand">{imageWorkspaceTitle(tab)}</div>
      <div className="topbar-actions">
        <div className="inbox-target-toggle image-workspace-mode-toggle" role="group" aria-label="Image workspace mode">
          {MODES.map((entry) => (
            <button
              key={entry.tab}
              type="button"
              className={`inbox-target-option${tab === entry.tab ? " active" : ""}`}
              onClick={() => onTabChange(entry.tab)}
            >
              {entry.label}
              {entry.showNewBadge && imagePoolNewCount > 0 ? (
                <span className="image-pool-badge inbox-tab-badge">{imagePoolNewCount}</span>
              ) : null}
            </button>
          ))}
        </div>
      </div>
      <div className="status">{statusText}</div>
    </header>
  );
}
