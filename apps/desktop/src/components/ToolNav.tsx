import { useRef, useState } from "react";
import { PRIMARY_NAV_TOOLS, type ToolTab } from "../types/tools";

const NAV_ICONS: Record<string, string> = {
  home: '<path d="M3 9.5L12 3l9 6.5V20a1 1 0 01-1 1H5a1 1 0 01-1-1V9.5z"/><path d="M9 21V12h6v9"/>',
  library:
    '<rect x="3" y="3" width="6" height="18" rx="1"/><rect x="11" y="3" width="4" height="18" rx="1"/><rect x="17" y="3" width="4" height="18" rx="1"/>',
  label:
    '<rect x="4" y="5" width="16" height="14" rx="2"/><path d="M9 12h6M12 9v6"/><circle cx="12" cy="12" r="0.5" fill="currentColor"/>',
  review:
    '<path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/>',
  export:
    '<path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
  settings:
    '<circle cx="12" cy="12" r="3"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>'
};

function navIconSvg(tab: string, size = 20) {
  const body = NAV_ICONS[tab] || NAV_ICONS["home"];
  return `<svg class="tool-nav-svg" viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
}

type ToolNavProps = {
  activeTab: ToolTab;
  imagePoolNewCount?: number;
  onSelectTab: (tab: ToolTab) => void;
  onOpenSettings: () => void;
};

export function ToolNav({ activeTab, imagePoolNewCount = 0, onSelectTab }: ToolNavProps) {
  const [expanded, setExpanded] = useState(false);
  const suppressHoverExpandRef = useRef(false);

  function collapseNav() {
    suppressHoverExpandRef.current = true;
    setExpanded(false);
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
  }

  function handleSelectTab(tab: ToolTab) {
    onSelectTab(tab);
    collapseNav();
  }

  // Determine which primary nav tab is visually "active" — map legacy tabs to their primary parent.
  function isNavActive(tab: ToolTab): boolean {
    if (activeTab === tab) return true;
    // Legacy tabs that live under Label
    if (tab === "label" && (activeTab === "video" || activeTab === "pool-label")) return true;
    // Legacy tabs that live under Export
    if (tab === "export" && (activeTab === "train-prep" || activeTab === "train" || activeTab === "video-capture")) return true;
    // Legacy tabs that live under Review
    if (tab === "review" && activeTab === "image-pool") return true;
    // Legacy tabs that live under Library
    if (tab === "library" && (activeTab === "image-pool")) return false; // image-pool handled by review above
    return false;
  }

  return (
    <nav
      className={`tabbar tabbar--rail tabbar--glass ${expanded ? "tabbar--expanded" : ""}`}
      aria-label="Workbench navigation"
      onMouseEnter={() => {
        if (!suppressHoverExpandRef.current) setExpanded(true);
      }}
      onMouseLeave={() => {
        suppressHoverExpandRef.current = false;
        setExpanded(false);
      }}
    >
      <div className="tabbar-surface">
        <div className="tabbar-head">
          <div className="brand" title="YoloWorkBench">
            <img
              className="brand-icon"
              src="/assets/app-icon.svg"
              width={22}
              height={22}
              alt=""
            />
            <span className="brand-text">YoloWorkBench</span>
          </div>
        </div>
        <div className="tool-nav-list" role="listbox" aria-label="Navigation">
          {PRIMARY_NAV_TOOLS.map((tool) => {
            const active = isNavActive(tool.tab);
            const badge =
              tool.tab === "review" && imagePoolNewCount > 0
                ? imagePoolNewCount > 99 ? "99+" : String(imagePoolNewCount)
                : "";
            return (
              <button
                key={tool.tab}
                type="button"
                className={`tool-nav-item ${active ? "active" : ""}`}
                title={`${tool.label} · ${tool.labelZh}${badge ? ` (${badge})` : ""}`}
                onClick={() => handleSelectTab(tool.tab)}
              >
                <span
                  className="tool-nav-item-icon"
                  dangerouslySetInnerHTML={{ __html: navIconSvg(tool.tab) }}
                />
                <span className="tool-nav-item-body">
                  <span className="tool-nav-item-title">
                    {tool.label}
                    {badge ? ` (${badge})` : ""}
                  </span>
                  <span className="tool-nav-item-sub">{tool.labelZh}</span>
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </nav>
  );
}
