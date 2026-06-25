import { useEffect, useMemo, useState } from "react";
import { useWorkspace } from "./useWorkspace";
import { ToolNav } from "../components/ToolNav";
import { SettingsModal } from "../components/SettingsModal";
import { ImageWorkspaceTopbar } from "../components/ImageWorkspaceTopbar";
import { KeepAlivePanel, KeepAliveProvider } from "../components/KeepAlivePanel";
import { FeatureErrorBoundary } from "../components/FeatureErrorBoundary";
import { ImagePoolPage } from "../features/image-pool/ImagePoolPage";
import { ImageAssignPage } from "../features/inbox/ImageAssignPage";
import { DatasetReviewPage } from "../features/dataset-review/DatasetReviewPage";
import { BoxLabelPage } from "../features/box-label/BoxLabelPage";
import { VideoLabelPage } from "../features/video/VideoLabelPage";
import { TrainPrepPage } from "../features/train-prep/TrainPrepPage";
import { AutoLabelPage } from "../features/auto-label/AutoLabelPage";
import { CropPage } from "../features/crop/CropPage";
import { MergePage } from "../features/merge/MergePage";
import { MaskNoisePage } from "../features/mask-noise/MaskNoisePage";
import { ImagePoolBadgeProvider } from "../features/image-pool/ImagePoolBadgeProvider";
import { useImagePoolBadge } from "../features/image-pool/useImagePoolBadge";
import {
  imageWorkspaceStatusFallback
} from "../features/image-pool/imageWorkspaceMode";
import { type ToolTab } from "../types/tools";

type WorkbenchBodyProps = { onNativeTabReady?: () => void };

export function WorkbenchBody({ onNativeTabReady }: WorkbenchBodyProps) {
  const { workspaceRoot } = useWorkspace();
  return (
    <ImagePoolBadgeProvider workspaceRoot={workspaceRoot}>
      <WorkbenchBodyContent onNativeTabReady={onNativeTabReady} />
    </ImagePoolBadgeProvider>
  );
}

function WorkbenchBodyContent({ onNativeTabReady }: WorkbenchBodyProps) {
  const { workspaceRoot, activeTab, setActiveTab, imageWorkspaceTab, setImageWorkspaceTab } = useWorkspace();
  const { imagePoolNewCount } = useImagePoolBadge();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [imageWorkspaceStatus, setImageWorkspaceStatus] = useState("");
  const showImageWorkspaceTopbar = activeTab === "image-pool";

  useEffect(() => {
    if (imageWorkspaceTab === "image-pool" && imageWorkspaceStatus) return;
    if (imageWorkspaceTab !== "image-pool" && !imageWorkspaceStatus) setImageWorkspaceStatus(imageWorkspaceStatusFallback(imageWorkspaceTab, workspaceRoot));
  }, [imageWorkspaceTab, workspaceRoot, imageWorkspaceStatus]);

  function selectTab(tab: ToolTab) {
    if (tab === "image-pool") setImageWorkspaceTab("image-pool");
    setActiveTab(tab);
  }

  const imageWorkspaceStatusText = useMemo(() => imageWorkspaceStatus || imageWorkspaceStatusFallback(imageWorkspaceTab, workspaceRoot), [imageWorkspaceStatus, imageWorkspaceTab, workspaceRoot]);

  return (
    <div className="workbench workbench--shell">
      <ToolNav activeTab={activeTab} imagePoolNewCount={imagePoolNewCount} onSelectTab={selectTab} onOpenSettings={() => setSettingsOpen(true)} />
      <div className={`workbench-content workbench-content--native${showImageWorkspaceTopbar ? " workbench-content--image-workspace" : ""}`}>
        {showImageWorkspaceTopbar ? <ImageWorkspaceTopbar tab={imageWorkspaceTab} statusText={imageWorkspaceStatusText} imagePoolNewCount={imagePoolNewCount} onTabChange={setImageWorkspaceTab} /> : null}
        <main className="workbench-page">
          <KeepAliveProvider>
            <KeepAlivePanel panelKey="image-pool" active={activeTab === "image-pool" && imageWorkspaceTab === "image-pool"}><FeatureErrorBoundary label="Image Pool"><ImagePoolPage onReady={onNativeTabReady} onStatusText={setImageWorkspaceStatus} /></FeatureErrorBoundary></KeepAlivePanel>
            <KeepAlivePanel panelKey="inbox" active={activeTab === "image-pool" && imageWorkspaceTab === "inbox"}><FeatureErrorBoundary label="Inbox"><ImageAssignPage onReady={onNativeTabReady} onStatusText={setImageWorkspaceStatus} /></FeatureErrorBoundary></KeepAlivePanel>
            <KeepAlivePanel panelKey="yolo" active={activeTab === "image-pool" && imageWorkspaceTab === "yolo"}><FeatureErrorBoundary label="Dataset Review"><DatasetReviewPage onReady={onNativeTabReady} onStatusText={setImageWorkspaceStatus} /></FeatureErrorBoundary></KeepAlivePanel>
            <KeepAlivePanel panelKey="pool-label" active={activeTab === "pool-label"}><FeatureErrorBoundary label="Image Box Label"><BoxLabelPage onReady={onNativeTabReady} /></FeatureErrorBoundary></KeepAlivePanel>
            <KeepAlivePanel panelKey="video" active={activeTab === "video"}><FeatureErrorBoundary label="Video Label"><VideoLabelPage active={activeTab === "video"} onReady={onNativeTabReady} /></FeatureErrorBoundary></KeepAlivePanel>
            <KeepAlivePanel panelKey="train-prep" active={activeTab === "train-prep"}><FeatureErrorBoundary label="Dataset Prep"><TrainPrepPage onReady={onNativeTabReady} /></FeatureErrorBoundary></KeepAlivePanel>
            <KeepAlivePanel panelKey="train" active={activeTab === "train"}><FeatureErrorBoundary label="Auto Label"><AutoLabelPage onReady={onNativeTabReady} /></FeatureErrorBoundary></KeepAlivePanel>
            <KeepAlivePanel panelKey="crop" active={activeTab === "crop"}><FeatureErrorBoundary label="Batch Crop"><CropPage onReady={onNativeTabReady} /></FeatureErrorBoundary></KeepAlivePanel>
            <KeepAlivePanel panelKey="merge" active={activeTab === "merge"}><FeatureErrorBoundary label="Dataset Merge"><MergePage onReady={onNativeTabReady} /></FeatureErrorBoundary></KeepAlivePanel>
            <KeepAlivePanel panelKey="mask-noise" persist={false} active={activeTab === "mask-noise"}><FeatureErrorBoundary label="Mask Cleanup"><MaskNoisePage onReady={onNativeTabReady} /></FeatureErrorBoundary></KeepAlivePanel>
          </KeepAliveProvider>
        </main>
      </div>
      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );
}
