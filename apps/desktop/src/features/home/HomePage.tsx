import { useEffect, useState } from "react";
import * as api from "../../api";
import { chooseDirectory } from "../../lib/tauri";
import { useWorkspace } from "../../app/useWorkspace";
import { CreateWorkspaceDialog, type CreateWorkspaceOptions } from "./CreateWorkspaceDialog";

const RECENT_KEY = "ywb.recentWorkspaces";
const MAX_RECENT = 8;

function loadRecent(): string[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) || "[]");
  } catch {
    return [];
  }
}

function pushRecent(path: string) {
  const list = loadRecent().filter((p) => p !== path);
  list.unshift(path);
  localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, MAX_RECENT)));
}

function workspaceName(path: string) {
  return path.replace(/[/\\]+$/, "").split(/[/\\]/).at(-1) || path;
}

type Props = {
  onReady?: () => void;
};

export function HomePage({ onReady }: Props) {
  const { openWorkspacePath, setActiveTab } = useWorkspace();
  const [creating, setCreating] = useState(false);
  const [recent, setRecent] = useState<string[]>(loadRecent);
  const [openError, setOpenError] = useState("");

  useEffect(() => {
    onReady?.();
    setRecent(loadRecent());
  }, [onReady]);

  async function handleCreateWorkspace(opts: CreateWorkspaceOptions) {
    const root = `${opts.location.replace(/[/\\]+$/, "")}/${opts.name.trim()}`;
    await openWorkspacePath(root);
    pushRecent(root);
    setRecent(loadRecent());
    setCreating(false);
    setActiveTab("label");
  }

  async function handleOpen() {
    setOpenError("");
    const dir = await chooseDirectory("Choose YOLO workspace folder");
    if (!dir) return;
    try {
      await openWorkspacePath(dir);
      pushRecent(dir);
      setRecent(loadRecent());
      setActiveTab("label");
    } catch (err) {
      setOpenError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleOpenRecent(path: string) {
    setOpenError("");
    try {
      await openWorkspacePath(path);
      pushRecent(path);
      setRecent(loadRecent());
      setActiveTab("label");
    } catch (err) {
      setOpenError(err instanceof Error ? err.message : String(err));
    }
  }

  function handleRemoveRecent(path: string) {
    const updated = loadRecent().filter((p) => p !== path);
    localStorage.setItem(RECENT_KEY, JSON.stringify(updated));
    setRecent(updated);
  }

  return (
    <div className="home-page">
      <div className="home-hero">
        <div className="home-brand">
          <img src="/assets/app-icon.svg" width={40} height={40} alt="" className="home-brand-icon" />
          <div>
            <h1 className="home-title">YoloWorkBench</h1>
            <p className="home-subtitle">Object detection annotation workbench</p>
          </div>
        </div>
        <div className="home-actions">
          <button
            type="button"
            className="glass-btn glass-btn--primary home-action-btn"
            onClick={() => setCreating(true)}
          >
            <span className="home-action-icon">＋</span>
            Create Workspace
          </button>
          <button
            type="button"
            className="glass-btn home-action-btn"
            onClick={() => void handleOpen()}
          >
            <span className="home-action-icon">📂</span>
            Open Workspace
          </button>
        </div>
        {openError && <p className="glass-error home-error">{openError}</p>}
      </div>

      {recent.length > 0 && (
        <div className="home-section">
          <h2 className="home-section-title">Recent Workspaces</h2>
          <div className="home-recent-list">
            {recent.map((path) => (
              <div key={path} className="home-recent-item glass-card">
                <button
                  type="button"
                  className="home-recent-btn"
                  onClick={() => void handleOpenRecent(path)}
                  title={path}
                >
                  <span className="home-recent-icon">🗂</span>
                  <span className="home-recent-body">
                    <span className="home-recent-name">{workspaceName(path)}</span>
                    <span className="home-recent-path">{path}</span>
                  </span>
                </button>
                <button
                  type="button"
                  className="home-recent-remove"
                  onClick={() => handleRemoveRecent(path)}
                  title="Remove from recent"
                  aria-label="Remove from recent"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {recent.length === 0 && (
        <div className="home-empty">
          <p>Create or open a workspace to get started.</p>
        </div>
      )}

      <CreateWorkspaceDialog
        open={creating}
        onCreate={handleCreateWorkspace}
        onClose={() => setCreating(false)}
      />
    </div>
  );
}
