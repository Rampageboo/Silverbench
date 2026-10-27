import { useMultimodalControls } from "../../input/MultimodalControlProvider";
import { ModelMemoryStatus } from "./ModelMemoryStatus";
import { UpdateStatus } from "../../features/update/AppUpdate";
import type { ImageWorkspaceTab } from "../../features/image-pool/imageWorkspaceMode";
import type { ToolTab } from "../../types/tools";
import { IconMic, IconSearch, IconSettings, IconSidebar } from "../../ui/icons";
import { NAV_GROUPS, isNavItemActive, type NavItem } from "../navigation";
import { WorkspaceSwitcher } from "./WorkspaceSwitcher";

type SidebarProps = {
  collapsed: boolean;
  onToggleCollapsed: () => void;
  activeTab: ToolTab;
  imageTab: ImageWorkspaceTab;
  isItemEnabled: (item: NavItem) => boolean;
  imagePoolNewCount: number;
  backendConnected: boolean;
  controlsOpen: boolean;
  onNavigate: (item: NavItem) => void;
  onOpenPalette: () => void;
  onOpenSettings: () => void;
  onToggleControls: () => void;
};

function badgeText(count: number) {
  if (count <= 0) return "";
  return count > 99 ? "99+" : String(count);
}

export function Sidebar({
  collapsed,
  onToggleCollapsed,
  activeTab,
  imageTab,
  isItemEnabled,
  imagePoolNewCount,
  backendConnected,
  controlsOpen,
  onNavigate,
  onOpenPalette,
  onOpenSettings,
  onToggleControls
}: SidebarProps) {
  const controls = useMultimodalControls();
  const inputsOn = controls.voiceEnabled || controls.gestureEnabled;
  const controlsLabel = controls.armed
    ? "Controls armed"
    : inputsOn
      ? "Controls locked"
      : "Voice & gesture off";

  return (
    <nav className={`shell-sidebar${collapsed ? " is-collapsed" : ""}`} aria-label="Workbench navigation">
      <div className="shell-brand">
        <img className="shell-brand__icon" src="/assets/app-icon.png" width={20} height={20} alt="" />
        {collapsed ? null : <span className="shell-brand__name">Silverbench</span>}
        <button
          type="button"
          className="ui-btn--ghost ui-btn--icon ui-btn--sm shell-brand__toggle"
          onClick={onToggleCollapsed}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          <IconSidebar size={15} />
        </button>
      </div>

      <WorkspaceSwitcher collapsed={collapsed} />

      <button
        type="button"
        className="shell-search"
        onClick={onOpenPalette}
        title="Search tools and actions (Ctrl+K)"
      >
        <IconSearch size={14} />
        {collapsed ? null : (
          <>
            <span>Go to…</span>
            <kbd className="ui-kbd">Ctrl K</kbd>
          </>
        )}
      </button>

      <div className="shell-nav">
        {NAV_GROUPS.map((group) => (
          <div key={group.id} className="shell-nav__group">
            {group.label ? (
              collapsed ? (
                <div className="shell-nav__rule" aria-hidden="true" />
              ) : (
                <div className="shell-nav__label ui-eyebrow">{group.label}</div>
              )
            ) : null}
            {group.items.map((item) => {
              const active = isNavItemActive(item, activeTab, imageTab);
              const badge = item.badge === "image-pool-new" ? badgeText(imagePoolNewCount) : "";
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  type="button"
                  className={`shell-nav__item${active ? " is-active" : ""}`}
                  aria-current={active ? "page" : undefined}
                  disabled={!isItemEnabled(item)}
                  title={collapsed ? item.label : undefined}
                  onClick={() => onNavigate(item)}
                >
                  <Icon size={16} />
                  {collapsed ? null : <span className="shell-nav__text">{item.label}</span>}
                  {badge ? <span className="shell-nav__badge">{badge}</span> : null}
                </button>
              );
            })}
          </div>
        ))}
      </div>

      <div className="shell-foot">
        <button
          type="button"
          className="shell-nav__item"
          onClick={onOpenSettings}
          title={collapsed ? "Settings" : undefined}
        >
          <IconSettings size={16} />
          {collapsed ? null : <span className="shell-nav__text">Settings</span>}
        </button>
        <div className="shell-status">
          <span
            className="shell-status__item"
            title={backendConnected ? "Backend connected" : "Backend disconnected — retrying"}
          >
            <span className={`ui-dot ${backendConnected ? "ui-dot--ok" : "ui-dot--danger"}`} />
            {collapsed ? null : <span>{backendConnected ? "Backend" : "Offline"}</span>}
          </span>
          <ModelMemoryStatus connected={backendConnected} collapsed={collapsed} />
          <UpdateStatus collapsed={collapsed} />
          <button
            type="button"
            className={`shell-status__item shell-status__btn${controls.armed ? " is-armed" : ""}${controlsOpen ? " is-open" : ""}`}
            onClick={onToggleControls}
            title={`${controlsLabel} — voice & gesture controls`}
            aria-expanded={controlsOpen}
          >
            <IconMic size={13} />
            {collapsed ? null : <span>{controls.armed ? "Armed" : inputsOn ? "Locked" : "Off"}</span>}
          </button>
        </div>
      </div>
    </nav>
  );
}
