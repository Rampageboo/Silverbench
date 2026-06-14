import { useEffect, useMemo, useRef, useState } from "react";
import { useBackend } from "../hooks/useBackend";
import { useWorkspace } from "./WorkspaceProvider";
import { ToolNav } from "../components/ToolNav";
import { Topbar } from "../components/Topbar";
import { ImageWorkspaceTopbar } from "../components/ImageWorkspaceTopbar";
import { LegacyWorkbenchHost } from "../components/LegacyWorkbenchHost";
import { KeepAlivePanel } from "../components/KeepAlivePanel";
import { ImagePoolPage } from "../features/image-pool/ImagePoolPage";
import { ImageAssignPage } from "../features/inbox/ImageAssignPage";
import { DatasetReviewPage } from "../features/dataset-review/DatasetReviewPage";
import { BoxLabelPage } from "../features/box-label/BoxLabelPage";
import {
  imageWorkspaceStatusFallback,
  normalizeImageWorkspaceTab,
  type ImageWorkspaceTab
} from "../features/image-pool/imageWorkspaceMode";
import { LEGACY_WORKBENCH_ORIGIN } from "../lib/legacyWorkbench";
import { tabUsesNativeReact, usesEmbeddedToolChrome, WORKBENCH_TOOLS, type ToolTab } from "../types/tools";

type WorkbenchBodyProps = {
  onNativeTabReady?: () => void;
};

export function WorkbenchBody({ onNativeTabReady }: WorkbenchBodyProps) {
  const {
    workspaceRoot,
    setWorkspaceRootInput,
    activeTab,
    setActiveTab,
    imageWorkspaceTab,
    setImageWorkspaceTab,
    openWorkspacePath,
    chooseWorkspaceFolder,
    imagePoolNewCount
  } = useWorkspace();
  const { connected, health, error } = useBackend();
  const [reloadKey, setReloadKey] = useState(0);
  const [imageWorkspaceStatus, setImageWorkspaceStatus] = useState("");
  const lastWorkspaceRef = useRef(workspaceRoot);
  const useEmbeddedChrome = usesEmbeddedToolChrome(activeTab);
  const useNativeReact = tabUsesNativeReact(activeTab);
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
  }, [imageWorkspaceTab, workspaceRoot]);

  function selectTab(tab: ToolTab) {
    if (tab === "image-pool") {
      setImageWorkspaceTab("image-pool");
    }
    setActiveTab(tab);
  }

  function handleImageWorkspaceTabChange(tab: ImageWorkspaceTab) {
    setImageWorkspaceTab(tab);
  }

  function openSettingsInEmbed() {
    const frame = document.querySelector<HTMLIFrameElement>(".legacy-workbench-frame");
    frame?.contentWindow?.postMessage({ type: "ywb-open-settings" }, LEGACY_WORKBENCH_ORIGIN);
  }

  const shellSyncedRef = useRef(false);

  useEffect(() => {
    function onEmbedMessage(event: MessageEvent) {
      if (event.origin !== LEGACY_WORKBENCH_ORIGIN) return;
      const payload = event.data;
      if (!payload || typeof payload !== "object") return;

      if (payload.type === "ywb-embed-ready" && payload.syncShellTab === true && !shellSyncedRef.current) {
        shellSyncedRef.current = true;
        const tab = String(payload.tab || "");
        if (tab === "inbox" || tab === "yolo" || tab === "image-pool") {
          setActiveTab("image-pool");
          setImageWorkspaceTab(normalizeImageWorkspaceTab(tab));
          return;
        }
        if (WORKBENCH_TOOLS.some((tool) => tool.tab === tab)) {
          setActiveTab(tab as ToolTab);
        }
        return;
      }

      if (payload.type !== "ywb-embed-tab" || payload.fromUser !== true) return;
      const tab = String(payload.tab || "");
      if (tab === "inbox" || tab === "yolo" || tab === "image-pool") {
        setActiveTab("image-pool");
        setImageWorkspaceTab(normalizeImageWorkspaceTab(tab));
        return;
      }
      if (!WORKBENCH_TOOLS.some((tool) => tool.tab === tab)) return;
      setActiveTab(tab as ToolTab);
    }
    window.addEventListener("message", onEmbedMessage);
    return () => window.removeEventListener("message", onEmbedMessage);
  }, [setActiveTab, setImageWorkspaceTab]);

  const imageWorkspaceStatusText = useMemo(() => {
    if (imageWorkspaceStatus) return imageWorkspaceStatus;
    return imageWorkspaceStatusFallback(imageWorkspaceTab, workspaceRoot);
  }, [imageWorkspaceStatus, imageWorkspaceTab, workspaceRoot]);

  return (
    <div className="workbench workbench--legacy-shell">
      <ToolNav activeTab={activeTab} imagePoolNewCount={imagePoolNewCount} onSelectTab={selectTab} onOpenSettings={openSettingsInEmbed} />
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
            onLoadWorkspace={() => openWorkspacePath(workspaceRoot).catch(() => {})}
            onChooseFolder={() => chooseWorkspaceFolder().catch(() => {})}
          />
        ) : null}
        <main className="workbench-page">
          <KeepAlivePanel
            panelKey="image-pool"
            active={activeTab === "image-pool" && imageWorkspaceTab === "image-pool"}
          >
            <ImagePoolPage onReady={onNativeTabReady} onStatusText={setImageWorkspaceStatus} />
          </KeepAlivePanel>
          <KeepAlivePanel panelKey="inbox" active={activeTab === "image-pool" && imageWorkspaceTab === "inbox"}>
            <ImageAssignPage onReady={onNativeTabReady} onStatusText={setImageWorkspaceStatus} />
          </KeepAlivePanel>
          <KeepAlivePanel panelKey="yolo" active={activeTab === "image-pool" && imageWorkspaceTab === "yolo"}>
            <DatasetReviewPage onReady={onNativeTabReady} onStatusText={setImageWorkspaceStatus} />
          </KeepAlivePanel>
          <KeepAlivePanel panelKey="pool-label" active={activeTab === "pool-label"}>
            <BoxLabelPage onReady={onNativeTabReady} />
          </KeepAlivePanel>
          {useEmbeddedChrome && activeTab !== "image-pool" && !tabUsesNativeReact(activeTab) ? (
            <LegacyWorkbenchHost activeTab={activeTab} workspaceRoot={workspaceRoot} reloadKey={reloadKey} />
          ) : null}
        </main>
      </div>
    </div>
  );
}
