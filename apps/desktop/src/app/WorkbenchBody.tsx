import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { FeatureErrorBoundary } from "../components/FeatureErrorBoundary";
import { KeepAlivePanel, KeepAliveProvider } from "../components/KeepAlivePanel";
import { SettingsModal } from "../components/SettingsModal";
import { ImagePoolBadgeProvider } from "../features/image-pool/ImagePoolBadgeProvider";
import { useImagePoolBadge } from "../features/image-pool/useImagePoolBadge";
import { MultimodalControlDock } from "../input/MultimodalControlDock";
import { MultimodalControlProvider } from "../input/MultimodalControlProvider";
import { ALL_TOOLS } from "../types/tools";
import { IconFolder, IconFolderPlus, IconHistory, IconSettings, IconSidebar } from "../ui/icons";
import { readAppTheme, writeAppTheme } from "./appTheme";
import { NAV_GROUPS, SECONDARY_NAV_ITEMS, type NavItem } from "./navigation";
import { sameWorkspacePath, workspaceDisplayName } from "../workspace/layout";
import { CommandPalette, type PaletteCommand } from "./shell/CommandPalette";
import { MigrationReviewBar } from "./shell/PendingFolderDialog";
import { Sidebar } from "./shell/Sidebar";
import { WorkspaceLauncherProvider, useWorkspaceLauncher } from "./shell/WorkspaceLauncher";
import { WORKBENCH_TOOL_DEFINITIONS, type WorkbenchToolDefinition } from "./toolRegistry";
import { useWorkspace } from "./useWorkspace";
import "./shell/shell.css";
import "./app.css";

type WorkbenchBodyProps = { onNativeTabReady?: () => void; backendConnected: boolean };

const SIDEBAR_KEY = "ywb.shell.sidebarCollapsed";

function readSidebarCollapsed() {
  try {
    return window.localStorage.getItem(SIDEBAR_KEY) === "1";
  } catch {
    return false;
  }
}

function toolRequiresWorkspace(tab: string) {
  return Boolean(ALL_TOOLS.find((tool) => tool.tab === tab)?.requiresWorkspace);
}

export function WorkbenchBody(props: WorkbenchBodyProps) {
  const { workspaceRoot } = useWorkspace();
  return (
    <MultimodalControlProvider>
      <ImagePoolBadgeProvider workspaceRoot={workspaceRoot}>
        <WorkspaceLauncherProvider>
          <WorkbenchShell {...props} />
        </WorkspaceLauncherProvider>
      </ImagePoolBadgeProvider>
    </MultimodalControlProvider>
  );
}

function WorkspaceRequired({ onReady }: { onReady?: () => void }) {
  const launcher = useWorkspaceLauncher();
  useEffect(() => {
    onReady?.();
  }, [onReady]);
  return (
    <div className="ui-empty-state shell-requires-ws">
      <span className="ui-empty-state__icon">
        <IconFolder size={20} />
      </span>
      <strong>No workspace open</strong>
      <span>This tool works inside a workspace folder.</span>
      <div className="shell-requires-ws__actions">
        <button type="button" className="ui-btn--solid" onClick={() => void launcher.openFolder()}>
          Open folder…
        </button>
        <button type="button" onClick={launcher.requestCreate}>
          New workspace…
        </button>
      </div>
    </div>
  );
}

function noop() {}

function RegisteredToolPanel({
  definition,
  active,
  workspaceRoot,
  imageWorkspaceTab,
  onReady
}: {
  definition: WorkbenchToolDefinition;
  active: boolean;
  workspaceRoot: string;
  imageWorkspaceTab: ReturnType<typeof useWorkspace>["imageWorkspaceTab"];
  onReady?: () => void;
}) {
  const ToolComponent = definition.component;
  const requiresWorkspace = definition.requiresWorkspace && !workspaceRoot.trim();
  return (
    <KeepAlivePanel
      panelKey={definition.tab}
      persist={definition.keepAlive}
      active={active}
      className={definition.heavy ? "workbench-panel--heavy" : undefined}
    >
      <FeatureErrorBoundary label={definition.label}>
        <Suspense
          fallback={
            <div className="page-loading" role="status">
              Loading {definition.label}…
            </div>
          }
        >
          {requiresWorkspace ? (
            <WorkspaceRequired onReady={onReady} />
          ) : (
            <ToolComponent
              active={active}
              workspaceRoot={workspaceRoot}
              onReady={onReady}
              imageWorkspaceTab={imageWorkspaceTab}
              onImageWorkspaceStatus={noop}
            />
          )}
        </Suspense>
      </FeatureErrorBoundary>
    </KeepAlivePanel>
  );
}

function WorkbenchShell({ onNativeTabReady, backendConnected }: WorkbenchBodyProps) {
  const { workspaceRoot, activeTab, setActiveTab, imageWorkspaceTab, setImageWorkspaceTab } = useWorkspace();
  const launcher = useWorkspaceLauncher();
  const { imagePoolNewCount } = useImagePoolBadge();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [controlsOpen, setControlsOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(readSidebarCollapsed);
  const hasWorkspace = Boolean(workspaceRoot.trim());

  const toggleCollapsed = useCallback(() => {
    setCollapsed((value) => {
      const next = !value;
      try {
        window.localStorage.setItem(SIDEBAR_KEY, next ? "1" : "0");
      } catch {
        // non-critical
      }
      return next;
    });
  }, []);

  // Without a workspace, the start page is the landing for workspace-bound tools.
  useEffect(() => {
    if (!hasWorkspace && activeTab !== "home" && toolRequiresWorkspace(activeTab)) setActiveTab("home");
  }, [activeTab, hasWorkspace, setActiveTab]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (
        (event.ctrlKey || event.metaKey) &&
        !event.altKey &&
        !event.shiftKey &&
        event.key.toLowerCase() === "k"
      ) {
        event.preventDefault();
        setPaletteOpen((value) => !value);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const isItemEnabled = useCallback(
    (item: NavItem) => hasWorkspace || !toolRequiresWorkspace(item.target.tab),
    [hasWorkspace]
  );

  const navigate = useCallback(
    (item: NavItem) => {
      if (item.target.imageTab) setImageWorkspaceTab(item.target.imageTab);
      setActiveTab(item.target.tab);
    },
    [setActiveTab, setImageWorkspaceTab]
  );

  const commands = useMemo<PaletteCommand[]>(() => {
    const list: PaletteCommand[] = [];
    const navCommand = (item: NavItem, section: string, hint: string): PaletteCommand => {
      const Icon = item.icon;
      return {
        id: `go-${item.id}`,
        section,
        label: item.label,
        hint,
        keywords: `${item.keywords} ${item.labelZh}`,
        icon: <Icon />,
        disabled: !isItemEnabled(item),
        run: () => navigate(item)
      };
    };
    for (const group of NAV_GROUPS) {
      for (const item of group.items) {
        list.push(navCommand(item, "Go to", group.label ? `${group.label} · ${item.labelZh}` : item.labelZh));
      }
    }
    for (const item of SECONDARY_NAV_ITEMS) list.push(navCommand(item, "More tools", item.labelZh));

    list.push(
      {
        id: "ws-open",
        section: "Workspace",
        label: "Open workspace folder…",
        keywords: "open folder workspace",
        icon: <IconFolder />,
        run: () => void launcher.openFolder()
      },
      {
        id: "ws-new",
        section: "Workspace",
        label: "New workspace…",
        keywords: "create new workspace",
        icon: <IconFolderPlus />,
        run: launcher.requestCreate
      }
    );
    for (const path of launcher.recent) {
      if (sameWorkspacePath(path, workspaceRoot)) continue;
      list.push({
        id: `ws-recent-${path}`,
        section: "Recent workspaces",
        label: workspaceDisplayName(path),
        hint: path,
        keywords: "recent workspace",
        icon: <IconHistory />,
        run: () => void launcher.openRecent(path)
      });
    }
    list.push(
      {
        id: "app-settings",
        section: "App",
        label: "Settings",
        keywords: "settings preferences 设置",
        icon: <IconSettings />,
        run: () => setSettingsOpen(true)
      },
      {
        id: "app-theme",
        section: "App",
        label: "Toggle light / dark theme",
        keywords: "theme dark light paper graphite",
        icon: <IconSettings />,
        run: () => writeAppTheme(readAppTheme() === "paper" ? "graphite" : "paper")
      },
      {
        id: "app-sidebar",
        section: "App",
        label: collapsed ? "Expand sidebar" : "Collapse sidebar",
        keywords: "sidebar collapse expand",
        icon: <IconSidebar />,
        run: toggleCollapsed
      }
    );
    return list;
  }, [collapsed, isItemEnabled, launcher, navigate, toggleCollapsed, workspaceRoot]);

  // workbench--shell / workbench-page keep the legacy tool layout rules applying.
  return (
    <div className={`shell workbench--shell${collapsed ? " shell--collapsed" : ""}`}>
      <Sidebar
        collapsed={collapsed}
        onToggleCollapsed={toggleCollapsed}
        activeTab={activeTab}
        imageTab={imageWorkspaceTab}
        isItemEnabled={isItemEnabled}
        imagePoolNewCount={imagePoolNewCount}
        backendConnected={backendConnected}
        controlsOpen={controlsOpen}
        onNavigate={navigate}
        onOpenPalette={() => setPaletteOpen(true)}
        onOpenSettings={() => setSettingsOpen(true)}
        onToggleControls={() => setControlsOpen((value) => !value)}
      />
      <main className="shell-main">
        <div className="shell-banners">
          {!backendConnected ? (
            <div className="shell-offline" role="status" aria-live="polite">
              后端连接已断开，正在重试…（若长时间无法恢复，请重启应用）
            </div>
          ) : null}
          <MigrationReviewBar />
        </div>
        <div className="shell-page workbench-page">
          <KeepAliveProvider>
            {WORKBENCH_TOOL_DEFINITIONS.map((definition) => (
              <RegisteredToolPanel
                key={definition.tab}
                definition={definition}
                active={activeTab === definition.tab}
                workspaceRoot={workspaceRoot}
                imageWorkspaceTab={imageWorkspaceTab}
                onReady={onNativeTabReady}
              />
            ))}
          </KeepAliveProvider>
        </div>
      </main>
      <CommandPalette open={paletteOpen} commands={commands} onClose={() => setPaletteOpen(false)} />
      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <MultimodalControlDock open={controlsOpen} onClose={() => setControlsOpen(false)} />
    </div>
  );
}
