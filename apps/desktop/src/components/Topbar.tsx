import { WORKBENCH_TOOLS, type ToolTab } from "../types/tools";

type TopbarProps = {
  connected: boolean;
  backendName: string;
  backendError: string;
  activeTab: ToolTab;
  workspaceRoot: string;
  statusText: string;
  imagePoolPending: boolean;
  onWorkspaceRootChange: (value: string) => void;
  onLoadWorkspace: () => void;
  onChooseFolder: () => void;
};

export function Topbar({
  connected,
  backendName,
  backendError,
  activeTab,
  workspaceRoot,
  statusText,
  imagePoolPending,
  onWorkspaceRootChange,
  onLoadWorkspace,
  onChooseFolder
}: TopbarProps) {
  const tool = WORKBENCH_TOOLS.find((item) => item.tab === activeTab);

  return (
    <header className="workbench-topbar">
      <div className="workbench-topbar-main">
        <div className={`status-dot ${connected ? "connected" : "disconnected"}`} />
        <div className="workbench-topbar-copy">
          <h1>{tool ? `${tool.labelZh} · ${tool.label}` : "YoloWorkBench"}</h1>
          <p>{statusText || (connected ? `Backend: ${backendName}` : backendError || "Waiting for FastAPI...")}</p>
        </div>
      </div>
      <div className="workspace-bar">
        <label htmlFor="workspace-root">Workspace</label>
        <input
          id="workspace-root"
          value={workspaceRoot}
          onChange={(event) => onWorkspaceRootChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") onLoadWorkspace();
          }}
          placeholder="D:\\path\\to\\workspace"
        />
        <button type="button" onClick={onChooseFolder} disabled={!connected}>
          Browse
        </button>
        <button type="button" onClick={onLoadWorkspace} disabled={!connected || imagePoolPending}>
          {imagePoolPending ? "Loading..." : "Load"}
        </button>
      </div>
    </header>
  );
}
