import { KeepAlivePanel, KeepAliveProvider } from "../../components/KeepAlivePanel";
import { FeatureErrorBoundary } from "../../components/FeatureErrorBoundary";
import { DatasetReviewPage } from "../dataset-review/DatasetReviewPage";
import { ImagePoolPage } from "../image-pool/ImagePoolPage";
import type { ImageWorkspaceTab } from "../image-pool/imageWorkspaceMode";
import { ImageAssignPage } from "../inbox/ImageAssignPage";
import "./imageWorkspace.css";

type Props = {
  active: boolean;
  tab: ImageWorkspaceTab;
  onReady?: () => void;
  onStatusText?: (text: string) => void;
};

/**
 * Keeps the three image-oriented subtools behind one top-level registry entry.
 * Image support remains complete, but it no longer dictates the application shell.
 */
export function ImageWorkspaceToolPage({ active, tab, onReady, onStatusText }: Props) {
  return (
    <KeepAliveProvider>
      <KeepAlivePanel panelKey="image-pool" active={active && tab === "image-pool"}>
        <FeatureErrorBoundary label="Image Pool">
          <ImagePoolPage onReady={onReady} onStatusText={onStatusText} />
        </FeatureErrorBoundary>
      </KeepAlivePanel>
      <KeepAlivePanel panelKey="inbox" active={active && tab === "inbox"}>
        <FeatureErrorBoundary label="Inbox">
          <ImageAssignPage onReady={onReady} onStatusText={onStatusText} />
        </FeatureErrorBoundary>
      </KeepAlivePanel>
      <KeepAlivePanel panelKey="dataset-review" active={active && tab === "yolo"}>
        <FeatureErrorBoundary label="Dataset Review">
          <DatasetReviewPage onReady={onReady} onStatusText={onStatusText} />
        </FeatureErrorBoundary>
      </KeepAlivePanel>
    </KeepAliveProvider>
  );
}
