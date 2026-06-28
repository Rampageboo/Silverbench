import { useCallback, useMemo, useState } from "react";
import { useWorkspace } from "../../app/useWorkspace";
import { VideoLabelPage } from "../video/VideoLabelPage";
import { BoxLabelPage } from "../box-label/BoxLabelPage";
import { LabelWorkbenchContext } from "./LabelWorkbenchContext";
import { LabelWorkbenchHeader } from "./LabelWorkbenchHeader";
import { LabelWorkbenchInspector } from "./LabelWorkbenchInspector";
import type {
  LabelSourceSummary,
  LabelWorkbenchActionGroup,
  LabelWorkbenchContextValue,
  LabelWorkbenchInspectorState,
  LabelWorkbenchMode,
} from "./labelWorkbenchTypes";

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
  const [inspectorState, setInspectorState] = useState<LabelWorkbenchInspectorState | null>(null);
  const [actionGroups, setActionGroups] = useState<LabelWorkbenchActionGroup[]>([]);

  const clearWorkbenchActions = useCallback(() => {
    setActionGroups([]);
  }, []);

  const reportSourceSummary = useCallback((summary: LabelSourceSummary | null) => {
    setSourceSummary(summary);
  }, []);

  const reportInspectorState = useCallback((state: LabelWorkbenchInspectorState | null) => {
    setInspectorState(state);
  }, []);

  const registerWorkbenchActions = useCallback((groups: LabelWorkbenchActionGroup[] | null) => {
    setActionGroups(groups ?? []);
  }, []);

  const handleModeChange = useCallback((nextMode: LabelWorkbenchMode) => {
    setMode(nextMode);
    setSourceSummary(null);
    setInspectorState(null);
    setActionGroups([]);
  }, []);

  const ctxValue = useMemo<LabelWorkbenchContextValue>(
    () => ({
      mode,
      setMode: handleModeChange,
      renderMode: "workbench-embedded",
      reportSourceSummary,
      reportInspectorState,
      registerWorkbenchActions,
      clearWorkbenchActions,
    }),
    [
      clearWorkbenchActions,
      handleModeChange,
      mode,
      reportInspectorState,
      reportSourceSummary,
      registerWorkbenchActions,
    ]
  );

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
          onModeChange={handleModeChange}
          workspaceName={wsName}
          workspacePath={workspaceRoot}
          sourceSummary={sourceSummary}
        />
        <div className="label-workbench-body">
          <div className="label-content">
            {mode === "video" ? (
              <VideoLabelPage active={active} onReady={onReady} />
            ) : (
              <BoxLabelPage onReady={onReady} />
            )}
          </div>
          <LabelWorkbenchInspector
            mode={mode}
            sourceSummary={sourceSummary}
            inspectorState={inspectorState}
            actionGroups={actionGroups}
          />
        </div>
      </div>
    </LabelWorkbenchContext.Provider>
  );
}
