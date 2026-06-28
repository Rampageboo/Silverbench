import { useState } from "react";
import { useWorkspace } from "../../app/useWorkspace";
import { VideoLabelPage } from "../video/VideoLabelPage";
import { BoxLabelPage } from "../box-label/BoxLabelPage";

type LabelMode = "video" | "image";

type Props = {
  active?: boolean;
  onReady?: () => void;
};

export function LabelPage({ active = true, onReady }: Props) {
  const { workspaceRoot } = useWorkspace();
  const [mode, setMode] = useState<LabelMode>("video");

  if (!workspaceRoot.trim()) {
    return (
      <div className="label-page label-page--no-workspace">
        <div className="empty">
          <strong>Open a workspace to start labeling.</strong>
        </div>
      </div>
    );
  }

  return (
    <div className="label-page">
      <div className="label-mode-bar">
        <div className="label-mode-tabs">
          <button
            type="button"
            className={`label-mode-tab${mode === "video" ? " active" : ""}`}
            onClick={() => setMode("video")}
          >
            <svg className="label-mode-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="3" y="6" width="13" height="12" rx="2"/><path d="M16 10l5-3v10l-5-3"/>
            </svg>
            Video
          </button>
          <button
            type="button"
            className={`label-mode-tab${mode === "image" ? " active" : ""}`}
            onClick={() => setMode("image")}
          >
            <svg className="label-mode-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="4" y="5" width="16" height="14" rx="2"/><circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none"/>
            </svg>
            Image
          </button>
        </div>
      </div>
      <div className="label-content">
        {mode === "video" ? (
          <VideoLabelPage active={active} onReady={onReady} />
        ) : (
          <BoxLabelPage onReady={onReady} />
        )}
      </div>
    </div>
  );
}
