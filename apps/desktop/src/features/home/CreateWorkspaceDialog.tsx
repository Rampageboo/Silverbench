import { useEffect, useRef, useState } from "react";
import { chooseDirectory } from "../../lib/tauri";

type TaskType = "detect" | "classify" | "both";
type MediaMode = "images" | "videos" | "mixed";

export type CreateWorkspaceOptions = {
  name: string;
  location: string;
  taskType: TaskType;
  mediaMode: MediaMode;
};

type Props = {
  open: boolean;
  onCreate: (opts: CreateWorkspaceOptions) => Promise<void>;
  onClose: () => void;
};

export function CreateWorkspaceDialog({ open, onCreate, onClose }: Props) {
  const [name, setName] = useState("My Workspace");
  const [location, setLocation] = useState("");
  const [taskType, setTaskType] = useState<TaskType>("detect");
  const [mediaMode, setMediaMode] = useState<MediaMode>("videos");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setError("");
      setCreating(false);
      setTimeout(() => nameRef.current?.select(), 60);
    }
  }, [open]);

  async function handlePickLocation() {
    const dir = await chooseDirectory("Choose workspace parent folder");
    if (dir) setLocation(dir);
  }

  async function handleCreate() {
    const trimmedName = name.trim();
    const trimmedLoc = location.trim();
    if (!trimmedName) { setError("Workspace name is required."); return; }
    if (!trimmedLoc) { setError("Location is required."); return; }
    setCreating(true);
    setError("");
    try {
      await onCreate({ name: trimmedName, location: trimmedLoc, taskType, mediaMode });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setCreating(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") onClose();
    if (e.key === "Enter" && !creating) void handleCreate();
  }

  if (!open) return null;

  return (
    <div className="glass-dialog-backdrop" role="dialog" aria-modal="true" aria-label="Create Workspace" onKeyDown={handleKeyDown}>
      <div className="glass-dialog">
        <div className="glass-dialog-header">
          <h2 className="glass-dialog-title">Create Workspace</h2>
          <button type="button" className="glass-dialog-close" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="glass-dialog-body">
          <div className="glass-field">
            <label className="glass-label" htmlFor="ws-name">Workspace Name</label>
            <input
              id="ws-name"
              ref={nameRef}
              className="glass-input"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My Workspace"
              disabled={creating}
            />
          </div>
          <div className="glass-field">
            <label className="glass-label" htmlFor="ws-location">Location</label>
            <div className="glass-input-row">
              <input
                id="ws-location"
                className="glass-input glass-input--flex"
                type="text"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder="Choose a parent folder…"
                disabled={creating}
                readOnly
              />
              <button type="button" className="glass-btn glass-btn--sm" onClick={() => void handlePickLocation()} disabled={creating}>
                Browse
              </button>
            </div>
            {location && name.trim() && (
              <span className="glass-hint">Will create: {location.replace(/[/\\]+$/, "")}/{name.trim()}</span>
            )}
          </div>
          <div className="glass-field-row">
            <div className="glass-field">
              <label className="glass-label">Task Type</label>
              <div className="glass-segmented">
                {(["detect", "classify", "both"] as TaskType[]).map((t) => (
                  <button
                    key={t}
                    type="button"
                    className={`glass-seg-btn${taskType === t ? " active" : ""}`}
                    onClick={() => setTaskType(t)}
                    disabled={creating}
                  >
                    {t === "detect" ? "Detect" : t === "classify" ? "Classify" : "Both"}
                  </button>
                ))}
              </div>
            </div>
            <div className="glass-field">
              <label className="glass-label">Media Mode</label>
              <div className="glass-segmented">
                {(["images", "videos", "mixed"] as MediaMode[]).map((m) => (
                  <button
                    key={m}
                    type="button"
                    className={`glass-seg-btn${mediaMode === m ? " active" : ""}`}
                    onClick={() => setMediaMode(m)}
                    disabled={creating}
                  >
                    {m.charAt(0).toUpperCase() + m.slice(1)}
                  </button>
                ))}
              </div>
            </div>
          </div>
          {error && <p className="glass-error">{error}</p>}
        </div>
        <div className="glass-dialog-footer">
          <button type="button" className="glass-btn" onClick={onClose} disabled={creating}>Cancel</button>
          <button type="button" className="glass-btn glass-btn--primary" onClick={() => void handleCreate()} disabled={creating}>
            {creating ? "Creating…" : "Create Workspace"}
          </button>
        </div>
      </div>
    </div>
  );
}
