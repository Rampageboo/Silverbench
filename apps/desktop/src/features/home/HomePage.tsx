import { useEffect, useState } from "react";
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
      <div className="home-inner">
        <div className="home-hero">
          <div className="home-brand">
            <img src="/assets/app-icon.svg" width={44} height={44} alt="" className="home-brand-icon" />
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
              <span className="home-action-icon">
                <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
                  <path d="M8 2v12M2 8h12"/>
                </svg>
              </span>
              New Workspace
            </button>
            <button
              type="button"
              className="glass-btn home-action-btn"
              onClick={() => void handleOpen()}
            >
              <span className="home-action-icon">
                <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M1.5 5A1.5 1.5 0 013 3.5h3.086a1.5 1.5 0 011.06.44l.915.914H13.5A1.5 1.5 0 0115 6.354V12.5A1.5 1.5 0 0113.5 14h-11A1.5 1.5 0 011 12.5V6a1.5 1.5 0 01.5-1.118"/>
                </svg>
              </span>
              Open Workspace
            </button>
          </div>
          {openError && <p className="glass-error home-error">{openError}</p>}
        </div>

        {recent.length > 0 ? (
          <div className="home-section">
            <h2 className="home-section-title">Recent</h2>
            <div className="home-recent-list">
              {recent.map((path) => (
                <div key={path} className="home-recent-item glass-card">
                  <button
                    type="button"
                    className="home-recent-btn"
                    onClick={() => void handleOpenRecent(path)}
                    title={path}
                  >
                    <span className="home-recent-icon">
                      <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M1.5 4.5A1.5 1.5 0 013 3h4.086a1.5 1.5 0 011.06.44l.915.914H13.5A1.5 1.5 0 0115 5.854V11.5A1.5 1.5 0 0113.5 13h-11A1.5 1.5 0 011 11.5V6a1.5 1.5 0 01.5-1.118"/>
                      </svg>
                    </span>
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
                    <svg viewBox="0 0 12 12" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
                      <path d="M2 2l8 8M10 2L2 10"/>
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="home-empty">
            <span>No recent workspaces.</span>
            <span>Create a new workspace or open an existing one to get started.</span>
          </div>
        )}
      </div>

      <CreateWorkspaceDialog
        open={creating}
        onCreate={handleCreateWorkspace}
        onClose={() => setCreating(false)}
      />
    </div>
  );
}
