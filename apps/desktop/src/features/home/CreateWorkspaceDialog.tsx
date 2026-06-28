import { useEffect, useRef, useState } from "react";
import { chooseDirectory } from "../../lib/tauri";
import {
  validateClassSetup,
  type WorkspaceTaskType,
  type WorkspaceMediaMode,
} from "../workspace/workspaceClassTaxonomy";

export type CreateWorkspaceOptions = {
  name: string;
  location: string;
  taskType: WorkspaceTaskType;
  mediaMode: WorkspaceMediaMode;
  /** Ordered detect class names. Order = YOLO class ID (0, 1, 2…). */
  detectClasses: string[];
  /** Classification class names. */
  clfClasses: string[];
};

type Props = {
  open: boolean;
  onCreate: (opts: CreateWorkspaceOptions) => Promise<void>;
  onClose: () => void;
};

// ---------------------------------------------------------------------------
// ClassListEditor
// ---------------------------------------------------------------------------

type ClassListEditorProps = {
  label: string;
  hint: string;
  classes: string[];
  onChange: (next: string[]) => void;
  disabled: boolean;
  placeholder: string;
  showIds?: boolean;
};

function ClassListEditor({
  label,
  hint,
  classes,
  onChange,
  disabled,
  placeholder,
  showIds = false,
}: ClassListEditorProps) {
  const [input, setInput] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  function tryAdd() {
    const name = input.trim();
    if (!name) return;
    if (classes.map((c) => c.toLowerCase()).includes(name.toLowerCase())) return;
    onChange([...classes, name]);
    setInput("");
    inputRef.current?.focus();
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      tryAdd();
    }
  }

  return (
    <div className="glass-field">
      <label className="glass-label">{label}</label>
      <p className="glass-hint cw-class-hint">{hint}</p>
      <div className="glass-input-row">
        <input
          ref={inputRef}
          className="glass-input glass-input--flex"
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={disabled}
        />
        <button
          type="button"
          className="glass-btn glass-btn--sm"
          onClick={tryAdd}
          disabled={disabled || !input.trim()}
        >
          Add
        </button>
      </div>
      {classes.length > 0 ? (
        <div className="cw-class-pills">
          {classes.map((name, i) => (
            <span key={i} className="cw-class-pill">
              {showIds && <span className="cw-class-pill-id">{i}</span>}
              <span className="cw-class-pill-name">{name}</span>
              <button
                type="button"
                className="cw-class-pill-remove"
                onClick={() => onChange(classes.filter((_, j) => j !== i))}
                aria-label={`Remove ${name}`}
                disabled={disabled}
              >
                <svg viewBox="0 0 10 10" width="8" height="8" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                  <path d="M2 2l6 6M8 2L2 8"/>
                </svg>
              </button>
            </span>
          ))}
        </div>
      ) : (
        <p className="glass-hint cw-class-empty-hint">
          {showIds
            ? 'No detect classes added — workspace will use a default "object" class.'
            : 'No classification classes added — workspace will use a default "object" class.'}
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// CreateWorkspaceDialog
// ---------------------------------------------------------------------------

export function CreateWorkspaceDialog({ open, onCreate, onClose }: Props) {
  const [name, setName] = useState("My Workspace");
  const [location, setLocation] = useState("");
  const [taskType, setTaskType] = useState<WorkspaceTaskType>("detect");
  const [mediaMode, setMediaMode] = useState<WorkspaceMediaMode>("videos");
  const [detectClasses, setDetectClasses] = useState<string[]>([]);
  const [clfClasses, setClfClasses] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setError("");
      setCreating(false);
      setDetectClasses([]);
      setClfClasses([]);
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

    const validationErrors = validateClassSetup({
      taskType,
      mediaMode,
      detectClasses: detectClasses.map((n) => ({ name: n })),
      clfClasses: clfClasses.map((n) => ({ name: n })),
      setupMode: "manual",
    });
    if (validationErrors.length > 0) {
      setError(validationErrors[0]);
      return;
    }

    setCreating(true);
    setError("");
    try {
      await onCreate({
        name: trimmedName,
        location: trimmedLoc,
        taskType,
        mediaMode,
        detectClasses,
        clfClasses,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setCreating(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") onClose();
  }

  if (!open) return null;

  const needDetect = taskType !== "classify";
  const needClf = taskType !== "detect";

  return (
    <div
      className="glass-dialog-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Create Workspace"
      onKeyDown={handleKeyDown}
    >
      <div className="glass-dialog glass-dialog--wide">
        <div className="glass-dialog-header">
          <h2 className="glass-dialog-title">Create Workspace</h2>
          <button type="button" className="glass-dialog-close" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className="glass-dialog-body">
          {/* ── Workspace identity ─────────────────────────────────────── */}
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
              <button
                type="button"
                className="glass-btn glass-btn--sm"
                onClick={() => void handlePickLocation()}
                disabled={creating}
              >
                Browse
              </button>
            </div>
            {location && name.trim() && (
              <span className="glass-hint">
                Will create: {location.replace(/[/\\]+$/, "")}/{name.trim()}
              </span>
            )}
          </div>

          {/* ── Task type + media mode ────────────────────────────────── */}
          <div className="glass-field-row">
            <div className="glass-field">
              <label className="glass-label">Task Type</label>
              <div className="glass-segmented">
                {(["detect", "classify", "both"] as WorkspaceTaskType[]).map((t) => (
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
                {(["images", "videos", "mixed"] as WorkspaceMediaMode[]).map((m) => (
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

          {/* ── Class setup ───────────────────────────────────────────── */}
          {(needDetect || needClf) && (
            <div className="cw-class-section">
              <div className="cw-class-section-header">
                <span className="cw-class-section-title">Classes</span>
                <span className="cw-class-section-hint">Optional — add classes now or set them up later in the workspace.</span>
              </div>
              {needDetect && (
                <ClassListEditor
                  label="Detect Classes"
                  hint="Order matters — the first class is YOLO id 0, second is id 1, etc."
                  classes={detectClasses}
                  onChange={setDetectClasses}
                  disabled={creating}
                  placeholder="e.g. person, car, truck…"
                  showIds
                />
              )}
              {needClf && (
                <ClassListEditor
                  label="Classification Classes"
                  hint="Names become folder-safe keys. They can be updated later."
                  classes={clfClasses}
                  onChange={setClfClasses}
                  disabled={creating}
                  placeholder="e.g. day, night, indoor…"
                />
              )}
            </div>
          )}

          {error && <p className="glass-error">{error}</p>}
        </div>

        <div className="glass-dialog-footer">
          <button type="button" className="glass-btn" onClick={onClose} disabled={creating}>
            Cancel
          </button>
          <button
            type="button"
            className="glass-btn glass-btn--primary"
            onClick={() => void handleCreate()}
            disabled={creating}
          >
            {creating ? "Creating…" : "Create Workspace"}
          </button>
        </div>
      </div>
    </div>
  );
}
