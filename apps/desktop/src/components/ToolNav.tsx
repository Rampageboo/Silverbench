import { useRef, useState } from "react";
import { WORKBENCH_TOOLS, type ToolTab } from "../types/tools";

const TOOL_NAV_ICONS: Record<string, string> = {
  "image-pool":
    '<rect x="3" y="4" width="8" height="8" rx="1.5"/><rect x="13" y="4" width="8" height="8" rx="1.5"/><rect x="3" y="14" width="8" height="8" rx="1.5"/><rect x="13" y="14" width="8" height="8" rx="1.5"/>',
  "pool-label":
    '<rect x="4" y="5" width="16" height="14" rx="2"/><circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none"/><path d="M12 9v6M9 12h6"/>',
  video: '<rect x="3" y="6" width="13" height="12" rx="2"/><path d="M16 10l5-3v10l-5-3"/>',
  "video-capture": '<rect x="3" y="6" width="13" height="12" rx="2"/><path d="M16 10l5-3v10l-5-3"/><line x1="7" y1="20" x2="17" y2="20"/><line x1="12" y1="18" x2="12" y2="22"/>',
  "train-prep": '<path d="M6 4v16"/><path d="M18 4v16"/><path d="M6 12h12"/>',
  train: '<path d="M12 3l2.2 6.8H21l-5.6 4.1 2.1 6.6L12 16.3l-5.5 4.2 2.1-6.6L3 9.8h6.8z"/>',
  crop: '<path d="M6 3v3H3"/><path d="M18 3v3h3"/><path d="M6 21v-3H3"/><path d="M18 21v-3h3"/><rect x="7" y="7" width="10" height="10" rx="1"/>',
  "mask-noise": '<path d="M7 7h10v10H7z"/><path d="M4 4l4 4M20 4l-4 4M4 20l4-4M20 20l-4-4"/>',
  merge: '<rect x="3" y="8" width="8" height="12" rx="1.5"/><rect x="13" y="4" width="8" height="12" rx="1.5"/><path d="M11 14h2v6"/>',
  settings:
    '<circle cx="12" cy="12" r="3"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>'
};

function toolNavIconSvg(tab: string, size = 20) {
  const body = TOOL_NAV_ICONS[tab] || TOOL_NAV_ICONS["image-pool"];
  return `<svg class="tool-nav-svg" viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
}

type ToolNavProps = {
  activeTab: ToolTab;
  imagePoolNewCount?: number;
  onSelectTab: (tab: ToolTab) => void;
  onOpenSettings: () => void;
};

export function ToolNav({ activeTab, imagePoolNewCount = 0, onSelectTab, onOpenSettings }: ToolNavProps) {
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

  return (
    <nav
      className={`tabbar tabbar--rail ${expanded ? "tabbar--expanded" : ""}`}
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
        <div className="tool-nav-list" role="listbox" aria-label="功能列表">
          {WORKBENCH_TOOLS.map((tool) => {
            const badge =
              tool.tab === "image-pool" && imagePoolNewCount > 0
                ? imagePoolNewCount > 99
                  ? "99+"
                  : String(imagePoolNewCount)
                : "";
            return (
            <button
              key={tool.tab}
              type="button"
              className={`tool-nav-item ${activeTab === tool.tab ? "active" : ""}`}
              title={`${tool.labelZh} · ${tool.label}${badge ? ` (${badge} NEW)` : ""}`}
              onClick={() => handleSelectTab(tool.tab)}
            >
              <span className="tool-nav-item-icon" dangerouslySetInnerHTML={{ __html: toolNavIconSvg(tool.tab) }} />
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
        <button
          type="button"
          className="tabbar-settings-btn"
          title="设置"
          onClick={() => {
            onOpenSettings();
            collapseNav();
          }}
        >
          <span className="tabbar-settings-icon" dangerouslySetInnerHTML={{ __html: toolNavIconSvg("settings", 18) }} />
          <span className="tabbar-settings-label">设置</span>
        </button>
      </div>
    </nav>
  );
}
