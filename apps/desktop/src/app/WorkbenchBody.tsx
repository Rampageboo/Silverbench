import { Suspense, useEffect, useMemo, useState } from "react";
import { FeatureErrorBoundary } from "../components/FeatureErrorBoundary";
import { ImageWorkspaceTopbar } from "../components/ImageWorkspaceTopbar";
import { KeepAlivePanel, KeepAliveProvider } from "../components/KeepAlivePanel";
import { SettingsModal } from "../components/SettingsModal";
import { ToolNav } from "../components/ToolNav";
import { ImagePoolBadgeProvider } from "../features/image-pool/ImagePoolBadgeProvider";
import { imageWorkspaceStatusFallback } from "../features/image-pool/imageWorkspaceMode";
import { useImagePoolBadge } from "../features/image-pool/useImagePoolBadge";
import type { ToolTab } from "../types/tools";
import { WorkspaceArchitectureProvider } from "../workspace/WorkspaceArchitectureProvider";
import { WORKBENCH_TOOL_DEFINITIONS, type WorkbenchToolDefinition } from "./toolRegistry";
import { useWorkspace } from "./useWorkspace";

type WorkbenchBodyProps = { onNativeTabReady?: () => void };

export function WorkbenchBody({ onNativeTabReady }: WorkbenchBodyProps) {
  const { workspaceRoot, setActiveTab } = useWorkspace();
  return (
    <WorkspaceArchitectureProvider
      workspaceRoot={workspaceRoot}
      onMigrated={() => setActiveTab("video")}
    >
      <ImagePoolBadgeProvider workspaceRoot={workspaceRoot}>
        <WorkbenchBodyContent onNativeTabReady={onNativeTabReady} />
      </ImagePoolBadgeProvider>
    </WorkspaceArchitectureProvider>
  );
}

function WorkspaceRequired({ onReady, onOpen }: { onReady?: () => void; onOpen: () => void }) {
  useEffect(() => {
    onReady?.();
  }, [onReady]);
  return (
    <div className="empty workbench-tool-empty">
      <strong>Open a workspace to use this tool.</strong>
      <button type="button" className="primary" onClick={onOpen}>
        Open Workspace
      </button>
    </div>
  );
}

function RegisteredToolPanel({
  definition,
  active,
  workspaceRoot,
  imageWorkspaceTab,
  onImageWorkspaceStatus,
  onReady,
  onOpenWorkspace
}: {
  definition: WorkbenchToolDefinition;
  active: boolean;
  workspaceRoot: string;
  imageWorkspaceTab: ReturnType<typeof useWorkspace>["imageWorkspaceTab"];
  onImageWorkspaceStatus: (text: string) => void;
  onReady?: () => void;
  onOpenWorkspace: () => void;
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
        <Suspense fallback={<div className="page-loading" role="status">Loading {definition.label}…</div>}>
          {requiresWorkspace ? (
            <WorkspaceRequired onReady={onReady} onOpen={onOpenWorkspace} />
          ) : (
            <ToolComponent
              active={active}
              workspaceRoot={workspaceRoot}
              onReady={onReady}
              imageWorkspaceTab={imageWorkspaceTab}
              onImageWorkspaceStatus={onImageWorkspaceStatus}
            />
          )}
        </Suspense>
      </FeatureErrorBoundary>
    </KeepAlivePanel>
  );
}

function WorkbenchBodyContent({ onNativeTabReady }: WorkbenchBodyProps) {
  const {
    workspaceRoot,
    activeTab,
    setActiveTab,
    imageWorkspaceTab,
    setImageWorkspaceTab,
    chooseWorkspaceFolder
  } = useWorkspace();
  const { imagePoolNewCount } = useImagePoolBadge();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [imageWorkspaceStatus, setImageWorkspaceStatus] = useState("");
  const showImageWorkspaceTopbar = activeTab === "image-pool";

  useEffect(() => {
    if (imageWorkspaceTab === "image-pool" && imageWorkspaceStatus) return;
    if (imageWorkspaceTab !== "image-pool" && !imageWorkspaceStatus) {
      setImageWorkspaceStatus(imageWorkspaceStatusFallback(imageWorkspaceTab, workspaceRoot));
    }
  }, [imageWorkspaceStatus, imageWorkspaceTab, workspaceRoot]);

  function selectTab(tab: ToolTab) {
    if (tab === "image-pool") setImageWorkspaceTab("image-pool");
    setActiveTab(tab);
  }

  const imageWorkspaceStatusText = useMemo(
    () => imageWorkspaceStatus || imageWorkspaceStatusFallback(imageWorkspaceTab, workspaceRoot),
    [imageWorkspaceStatus, imageWorkspaceTab, workspaceRoot]
  );

  return (
    <div className="workbench workbench--shell">
      <ToolNav
        activeTab={activeTab}
        imagePoolNewCount={imagePoolNewCount}
        onSelectTab={selectTab}
        onOpenSettings={() => setSettingsOpen(true)}
      />
      <div className={`workbench-content workbench-content--native${showImageWorkspaceTopbar ? " workbench-content--image-workspace" : ""}`}>
        {showImageWorkspaceTopbar ? (
          <ImageWorkspaceTopbar
            tab={imageWorkspaceTab}
            statusText={imageWorkspaceStatusText}
            imagePoolNewCount={imagePoolNewCount}
            onTabChange={setImageWorkspaceTab}
          />
        ) : null}
        <main className="workbench-page">
          <KeepAliveProvider>
            {WORKBENCH_TOOL_DEFINITIONS.map((definition) => (
              <RegisteredToolPanel
                key={definition.tab}
                definition={definition}
                active={activeTab === definition.tab}
                workspaceRoot={workspaceRoot}
                imageWorkspaceTab={imageWorkspaceTab}
                onImageWorkspaceStatus={setImageWorkspaceStatus}
                onReady={onNativeTabReady}
                onOpenWorkspace={() => void chooseWorkspaceFolder()}
              />
            ))}
          </KeepAliveProvider>
        </main>
      </div>
      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );
}
