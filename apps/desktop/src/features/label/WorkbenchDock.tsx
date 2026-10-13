import { useState, type ReactNode } from "react";
import { IconChevronDown } from "../../ui/icons";

export type WorkbenchDockSection = { id: string; label: string; content: ReactNode };

const ACTIVE_KEY = "ywb.label.dockTab";
const COLLAPSED_KEY = "ywb.label.dockCollapsed";

function read(key: string) {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // UI preference only.
  }
}

/**
 * Tabbed tool dock under the label canvas. Every section stays mounted so
 * in-progress state (auto-label runs, sampling inputs) survives tab switches.
 */
export function WorkbenchDock({ sections }: { sections: WorkbenchDockSection[] }) {
  const [activeId, setActiveId] = useState(() => read(ACTIVE_KEY) ?? sections[0]?.id ?? "");
  const [collapsed, setCollapsed] = useState(() => read(COLLAPSED_KEY) === "1");
  const active = sections.some((section) => section.id === activeId) ? activeId : sections[0]?.id;

  function select(id: string) {
    if (id === active && !collapsed) {
      setCollapsed(true);
      write(COLLAPSED_KEY, "1");
      return;
    }
    setActiveId(id);
    write(ACTIVE_KEY, id);
    setCollapsed(false);
    write(COLLAPSED_KEY, "0");
  }

  function toggle() {
    setCollapsed((value) => {
      write(COLLAPSED_KEY, value ? "0" : "1");
      return !value;
    });
  }

  return (
    <div className={`lwb-dock${collapsed ? " is-collapsed" : ""}`}>
      <div className="lwb-dock__tabs" role="tablist" aria-label="Workbench tools">
        {sections.map((section) => (
          <button
            key={section.id}
            type="button"
            role="tab"
            aria-selected={!collapsed && section.id === active}
            className="lwb-dock__tab"
            onClick={() => select(section.id)}
          >
            {section.label}
          </button>
        ))}
        <button
          type="button"
          className="ui-btn--ghost ui-btn--icon ui-btn--sm lwb-dock__toggle"
          onClick={toggle}
          title={collapsed ? "Show tools" : "Hide tools"}
          aria-label={collapsed ? "Show tools" : "Hide tools"}
          aria-expanded={!collapsed}
        >
          <IconChevronDown size={14} />
        </button>
      </div>
      {sections.map((section) => (
        <div
          key={section.id}
          role="tabpanel"
          className="lwb-dock__panel"
          hidden={collapsed || section.id !== active}
        >
          {section.content}
        </div>
      ))}
    </div>
  );
}
