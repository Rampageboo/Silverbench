import { useCallback, useState } from "react";
import { useWorkspace } from "../../app/useWorkspace";
import { VideoLabelPage } from "../video/VideoLabelPage";
import { BoxLabelPage } from "../box-label/BoxLabelPage";
import { LabelWorkbenchContext } from "./LabelWorkbenchContext";
import { LabelWorkbenchHeader } from "./LabelWorkbenchHeader";
import type { LabelSourceSummary, LabelWorkbenchContextValue, LabelWorkbenchMode } from "./labelWorkbenchTypes";

type Props = {
  active?: boolean;
  onReady?: () => void;
};

/**
 * Label Workbench shell — Phase 3A.
 *
 * Responsibilities:
 *   - Manage mode state (image / video).
 *   - Provide LabelWorkbenchContext to all descendant components.
 *   - Render the unified workbench header (LabelWorkbenchHeader).
 *   - Delegate canvas rendering to VideoLabelPage (video mode) or
 *     BoxLabelPage (image mode) — both unchanged.
 *
 * Phase 3B will wire child pages up to reportSourceSummary so the
 * header can show live source/review status.
 */
export function LabelPage({ active = true, onReady }: Props) {
  const { workspaceRoot } = useWorkspace();
  const [mode, setMode] = useState<LabelWorkbenchMode>("video");
  const [sourceSummary, setSourceSummary] = useState<LabelSourceSummary | null>(null);

  const reportSourceSummary = useCallback((summary: LabelSourceSummary | null) => {
    setSourceSummary(summary);
  }, []);

  const ctxValue: LabelWorkbenchContextValue = {
    mode,
    setMode,
    reportSourceSummary
  };

  if (!workspaceRoot.trim()) {
    return (
      <div className="label-page label-page--no-workspace">
        <div className="empty">
          <strong>Open a workspace to start labeling.</strong>
        </div>
      </div>
    );
  }

  const wsName = workspaceRoot.replace(/[/\\]+$/, "").split(/[/\\]/).at(-1) || workspaceRoot;

  return (
    <LabelWorkbenchContext.Provider value={ctxValue}>
      <div className="label-page label-page--workbench">
        <LabelWorkbenchHeader
          mode={mode}
          onModeChange={setMode}
          workspaceName={wsName}
          workspacePath={workspaceRoot}
          sourceSummary={sourceSummary}
        />
        <div className="label-content">
          {mode === "video" ? (
            <VideoLabelPage active={active} onReady={onReady} />
          ) : (
            <BoxLabelPage onReady={onReady} />
          )}
        </div>
      </div>
    </LabelWorkbenchContext.Provider>
  );
}
