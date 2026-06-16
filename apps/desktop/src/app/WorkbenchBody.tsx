import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useBackend } from "../hooks/useBackend";
import { useToast } from "../components/useToast";
import { errMessage } from "../lib/errors";
import { useWorkspace } from "./useWorkspace";
import { ToolNav } from "../components/ToolNav";
import { Topbar } from "../components/Topbar";
import { SettingsModal } from "../components/SettingsModal";
import { ImageWorkspaceTopbar } from "../components/ImageWorkspaceTopbar";
import { LegacyWorkbenchHost } from "../components/LegacyWorkbenchHost";
import { KeepAlivePanel, KeepAliveProvider } from "../components/KeepAlivePanel";
import { FeatureErrorBoundary } from "../components/FeatureErrorBoundary";
import { ImagePoolPage } from "../features/image-pool/ImagePoolPage";
import { ImageAssignPage } from "../features/inbox/ImageAssignPage";
import { DatasetReviewPage } from "../features/dataset-review/DatasetReviewPage";
import { BoxLabelPage } from "../features/box-label/BoxLabelPage";
import { TrainPrepPage } from "../features/train-prep/TrainPrepPage";
import { CropPage } from "../features/crop/CropPage";
import { ImagePoolBadgeProvider } from "../features/image-pool/ImagePoolBadgeProvider";
import { useImagePoolBadge } from "../features/image-pool/useImagePoolBadge";
import {
  imageWorkspaceStatusFallback,
  type ImageWorkspaceTab
} from "../features/image-pool/imageWorkspaceMode";
import {
  applyShellTabSelection,
  mapLegacyTabToShell,
  subscribeLegacyMessages
} from "../lib/legacyBridge";
import { tabUsesNativeReact, usesEmbeddedToolChrome, type ToolTab } from "../types/tools";

type WorkbenchBodyProps = {
  onNativeTabReady?: () => void;
};

export function WorkbenchBody({ onNativeTabReady }: WorkbenchBodyProps) {
  const { workspaceRoot } = useWorkspace();
  return (
    <ImagePoolBadgeProvider workspaceRoot={workspaceRoot}>
      <WorkbenchBodyContent onNativeTabReady={onNativeTabReady} />
    </ImagePoolBadgeProvider>
  );
}

function WorkbenchBodyContent({ onNativeTabReady }: WorkbenchBodyProps) {
  const {
    workspaceRoot,
    setWorkspaceRootInput,
    activeTab,
    setActiveTab,
    imageWorkspaceTab,
    setImageWorkspaceTab,
    openWorkspacePath,
    chooseWorkspaceFolder
  } = useWorkspace();
  const { imagePoolNewCount, refreshImagePoolBadge } = useImagePoolBadge();
  const { connected, health, error } = useBackend();
  const { showToast } = useToast();
  const showError = useCallback(
    (err: unknown) => showToast(errMessage(err), { variant: "error" }),
    [showToast]
  );
  const [reloadKey, setReloadKey] = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [imageWorkspaceStatus, setImageWorkspaceStatus] = useState("");
  const lastWorkspaceRef = useRef(workspaceRoot);
  const cropIsNative = activeTab === "crop";
  const useEmbeddedChrome = cropIsNative ? false : usesEmbeddedToolChrome(activeTab);
  const useNativeReact = cropIsNative || tabUsesNativeReact(activeTab);
  const showImageWorkspaceTopbar = activeTab === "image-pool";

  useEffect(() => {
    const trimmed = workspaceRoot.trim();
    if (!trimmed || trimmed === lastWorkspaceRef.current.trim()) return;
    lastWorkspaceRef.current = workspaceRoot;
    setReloadKey((value) => value + 1);
  }, [workspaceRoot]);

  useEffect(() => {
    if (imageWorkspaceTab === "image-pool" && imageWorkspaceStatus) return;
    if (imageWorkspaceTab !== "image-pool" && !imageWorkspaceStatus) {
      setImageWorkspaceStatus(imageWorkspaceStatusFallback(imageWorkspaceTab, workspaceRoot));
    }
  }, [imageWorkspaceTab, workspaceRoot, imageWorkspaceStatus]);

  function selectTab(tab: ToolTab) {
    if (tab === "image-pool") {
      setImageWorkspaceTab("image-pool");
    }
    setActiveTab(tab);
  }

  function handleImageWorkspaceTabChange(tab: ImageWorkspaceTab) {
    setImageWorkspaceTab(tab);
  }

  function openSettings() {
    setSettingsOpen(true);
  }

  const shellSyncedRef = useRef(false);

  useEffect(() => {
    return subscribeLegacyMessages((message) => {
      if (message.type === "ywb-embed-ready" && message.syncShellTab === true && !shellSyncedRef.current) {
        shellSyncedRef.current = true;
        const selection = mapLegacyTabToShell(String(message.tab || ""));
        if (selection) applyShellTabSelection(selection, setActiveTab, setImageWorkspaceTab);
        return;
      }
      if (message.type !== "ywb-embed-tab" || message.fromUser !== true) return;
      const selection = mapLegacyTabToShell(String(message.tab || ""));
      if (selection) applyShellTabSelection(selection, setActiveTab, setImageWorkspaceTab);
    });
  }, [setActiveTab, setImageWorkspaceTab]);

  useEffect(() => {
    if (!connected || !workspaceRoot.trim()) return;
    if (tabUsesNativeReact(activeTab) || cropIsNative) return;
    void refreshImagePoolBadge();
  }, [activeTab, connected, cropIsNative, refreshImagePoolBadge, workspaceRoot]);

  const imageWorkspaceStatusText = useMemo(() => {
    if (imageWorkspaceStatus) return imageWorkspaceStatus;
    return imageWorkspaceStatusFallback(imageWorkspaceTab, workspaceRoot);
  }, [imageWorkspaceStatus, imageWorkspaceTab, workspaceRoot]);

  return (
    <div className="workbench workbench--legacy-shell">
      <ToolNav activeTab={activeTab} imagePoolNewCount={imagePoolNewCount} onSelectTab={selectTab} onOpenSettings={openSettings} />
      <div
        className={`workbench-content${useEmbeddedChrome ? " workbench-content--embedded" : ""}${useNativeReact ? " workbench-content--native" : ""}${showImageWorkspaceTopbar ? " workbench-content--image-workspace" : ""}`}
      >
        {showImageWorkspaceTopbar ? (
          <ImageWorkspaceTopbar
            tab={imageWorkspaceTab}
            statusText={imageWorkspaceStatusText}
            imagePoolNewCount={imagePoolNewCount}
            onTabChange={handleImageWorkspaceTabChange}
          />
        ) : null}
        {!useEmbeddedChrome && !useNativeReact ? (
          <Topbar
            connected={connected}
            backendName={health?.backend || "fastapi"}
            backendError={error}
            activeTab={activeTab}
            workspaceRoot={workspaceRoot}
            statusText={connected ? `Backend: ${health?.backend || "fastapi"}` : error || "Waiting for FastAPI..."}
            imagePoolPending={false}
            onWorkspaceRootChange={setWorkspaceRootInput}
            onLoadWorkspace={() => openWorkspacePath(workspaceRoot).catch(showError)}
            onChooseFolder={() => chooseWorkspaceFolder().catch(showError)}
          />
        ) : null}
        <main className="workbench-page">
          <KeepAliveProvider>
            <KeepAlivePanel panelKey="image-pool" active={activeTab === "image-pool" && imageWorkspaceTab === "image-pool"}>
              <FeatureErrorBoundary label="Image Pool"><ImagePoolPage onReady={onNativeTabReady} onStatusText={setImageWorkspaceStatus} /></FeatureErrorBoundary>
            </KeepAlivePanel>
            <KeepAlivePanel panelKey="inbox" active={activeTab === "image-pool" && imageWorkspaceTab === "inbox"}>
              <FeatureErrorBoundary label="Inbox"><ImageAssignPage onReady={onNativeTabReady} onStatusText={setImageWorkspaceStatus} /></FeatureErrorBoundary>
            </KeepAlivePanel>
            <KeepAlivePanel panelKey="yolo" active={activeTab === "image-pool" && imageWorkspaceTab === "yolo"}>
              <FeatureErrorBoundary label="Dataset Review"><DatasetReviewPage onReady={onNativeTabReady} onStatusText={setImageWorkspaceStatus} /></FeatureErrorBoundary>
            </KeepAlivePanel>
            <KeepAlivePanel panelKey="pool-label" active={activeTab === "pool-label"}>
              <FeatureErrorBoundary label="Box Label"><BoxLabelPage onReady={onNativeTabReady} /></FeatureErrorBoundary>
            </KeepAlivePanel>
            <KeepAlivePanel panelKey="train-prep" active={activeTab === "train-prep"}>
              <FeatureErrorBoundary label="Dataset Prep"><TrainPrepPage onReady={onNativeTabReady} /></FeatureErrorBoundary>
            </KeepAlivePanel>
            <KeepAlivePanel panelKey="crop" active={activeTab === "crop"}>
              <FeatureErrorBoundary label="Batch Crop"><CropPage onReady={onNativeTabReady} /></FeatureErrorBoundary>
            </KeepAlivePanel>
          </KeepAliveProvider>
          {useEmbeddedChrome && activeTab !== "image-pool" && activeTab !== "crop" && !tabUsesNativeReact(activeTab) ? (
            <LegacyWorkbenchHost activeTab={activeTab} workspaceRoot={workspaceRoot} reloadKey={reloadKey} />
          ) : null}
        </main>
      </div>
      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );
}
