import { useEffect, useRef, useState } from "react";
import { useWorkspace } from "../../app/useWorkspace";
import { useWorkspaceClasses } from "../workspace/useWorkspaceClasses";
import {
  allDetectClassDefs,
  activeDetectClassDefs,
  activeClfClassDefs,
  archivedClassDefs,
  derivedTaskType,
  type WorkspaceClassSummary,
} from "../workspace/workspaceClassTaxonomy";
import type { ClassDef, ClassesManifest } from "../video/classDomain";

type Props = {
  active?: boolean;
  onReady?: () => void;
};

type LibraryView = "overview" | "classes";

// ---------------------------------------------------------------------------
// Small shared components
// ---------------------------------------------------------------------------

const ChevronRight = () => (
  <svg
    className="library-section-chevron"
    viewBox="0 0 16 16"
    width="14"
    height="14"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M6 3l5 5-5 5" />
  </svg>
);

const TASK_LABELS: Record<WorkspaceClassSummary["taskType"], string> = {
  detect: "Detect",
  classify: "Classify",
  both: "Detect + Classify",
};

function TaskBadge({ taskType }: { taskType: WorkspaceClassSummary["taskType"] }) {
  return (
    <span className={`library-task-badge library-task-badge--${taskType}`}>
      {TASK_LABELS[taskType]}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Add-class row (shared by detect + clf)
// ---------------------------------------------------------------------------

type AddClassRowProps = {
  placeholder: string;
  disabled: boolean;
  onAdd: (name: string) => Promise<void>;
};

function AddClassRow({ placeholder, disabled, onAdd }: AddClassRowProps) {
  const [value, setValue] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleAdd() {
    const name = value.trim();
    if (!name) return;
    setBusy(true);
    setError("");
    try {
      await onAdd(name);
      setValue("");
      inputRef.current?.focus();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="library-class-add-row">
      <div className="glass-input-row">
        <input
          ref={inputRef}
          className="glass-input glass-input--flex glass-input--sm"
          type="text"
          value={value}
          onChange={(e) => { setValue(e.target.value); setError(""); }}
          onKeyDown={(e) => { if (e.key === "Enter") void handleAdd(); }}
          placeholder={placeholder}
          disabled={disabled || busy}
        />
        <button
          type="button"
          className="glass-btn glass-btn--sm glass-btn--primary"
          onClick={() => void handleAdd()}
          disabled={disabled || busy || !value.trim()}
        >
          Add
        </button>
      </div>
      {error && <p className="library-class-add-error">{error}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Inline rename row
// ---------------------------------------------------------------------------

type RenameRowProps = {
  currentName: string;
  onSave: (newName: string) => Promise<void>;
  onCancel: () => void;
};

function RenameRow({ currentName, onSave, onCancel }: RenameRowProps) {
  const [value, setValue] = useState(currentName);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.select();
  }, []);

  async function handleSave() {
    const name = value.trim();
    if (!name || name === currentName) { onCancel(); return; }
    setBusy(true);
    setError("");
    try {
      await onSave(name);
      onCancel();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") void handleSave();
    if (e.key === "Escape") onCancel();
  }

  return (
    <div className="library-class-rename-row">
      <input
        ref={inputRef}
        className="glass-input glass-input--flex glass-input--sm"
        type="text"
        value={value}
        onChange={(e) => { setValue(e.target.value); setError(""); }}
        onKeyDown={handleKeyDown}
        disabled={busy}
        autoFocus
      />
      <button
        type="button"
        className="glass-btn glass-btn--sm glass-btn--primary"
        onClick={() => void handleSave()}
        disabled={busy || !value.trim()}
      >
        Save
      </button>
      <button
        type="button"
        className="glass-btn glass-btn--sm"
        onClick={onCancel}
        disabled={busy}
      >
        Cancel
      </button>
      {error && <span className="library-class-rename-error">{error}</span>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Detect class row
// ---------------------------------------------------------------------------

type DetectClassRowProps = {
  def: ClassDef & { yoloId: number };
  disabled: boolean;
  onRename: (classKey: string, newName: string) => Promise<void>;
  onArchive: (classKey: string) => Promise<void>;
  onUnarchive: (classKey: string) => Promise<void>;
};

function DetectClassRow({ def, disabled, onRename, onArchive, onUnarchive }: DetectClassRowProps) {
  const [mode, setMode] = useState<"view" | "rename" | "confirm-archive">("view");
  const [busy, setBusy] = useState(false);

  async function handleArchive() {
    setBusy(true);
    try { await onArchive(def.key); } finally { setBusy(false); setMode("view"); }
  }

  async function handleUnarchive() {
    setBusy(true);
    try { await onUnarchive(def.key); } finally { setBusy(false); }
  }

  const isArchived = def.archived;

  if (mode === "rename") {
    return (
      <div className={`library-detect-item${isArchived ? " library-detect-item--archived" : ""}`}>
        <span className="library-detect-id">{def.yoloId}</span>
        <div className="library-detect-name-cell">
          <RenameRow
            currentName={def.name}
            onSave={(name) => onRename(def.key, name)}
            onCancel={() => setMode("view")}
          />
        </div>
      </div>
    );
  }

  if (mode === "confirm-archive") {
    return (
      <div className={`library-detect-item${isArchived ? " library-detect-item--archived" : ""}`}>
        <span className="library-detect-id">{def.yoloId}</span>
        <span className="library-detect-name">{def.name}</span>
        <div className="library-class-confirm">
          <span className="library-class-confirm-label">Archive? ID {def.yoloId} slot stays reserved.</span>
          <button
            type="button"
            className="glass-btn glass-btn--sm glass-btn--danger"
            onClick={() => void handleArchive()}
            disabled={busy}
          >
            Archive
          </button>
          <button
            type="button"
            className="glass-btn glass-btn--sm"
            onClick={() => setMode("view")}
            disabled={busy}
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={`library-detect-item${isArchived ? " library-detect-item--archived" : ""}`}>
      <span className="library-detect-id">{def.yoloId}</span>
      <span className="library-detect-name">{def.name}</span>
      {isArchived ? (
        <span className="library-archived-badge">archived</span>
      ) : null}
      <div className="library-class-actions">
        {!isArchived && (
          <>
            <button
              type="button"
              className="library-class-action-btn"
              onClick={() => setMode("rename")}
              disabled={disabled || busy}
              title="Rename class"
            >
              Rename
            </button>
            <button
              type="button"
              className="library-class-action-btn library-class-action-btn--danger"
              onClick={() => setMode("confirm-archive")}
              disabled={disabled || busy}
              title="Archive class (preserves YOLO ID slot)"
            >
              Archive
            </button>
          </>
        )}
        {isArchived && (
          <button
            type="button"
            className="library-class-action-btn"
            onClick={() => void handleUnarchive()}
            disabled={disabled || busy}
            title="Restore archived class"
          >
            Restore
          </button>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Classification class row
// ---------------------------------------------------------------------------

type ClfClassRowProps = {
  def: ClassDef;
  disabled: boolean;
  onRename: (classKey: string, newName: string) => Promise<void>;
  onArchive: (classKey: string) => Promise<void>;
  onUnarchive: (classKey: string) => Promise<void>;
};

function ClfClassRow({ def, disabled, onRename, onArchive, onUnarchive }: ClfClassRowProps) {
  const [mode, setMode] = useState<"view" | "rename" | "confirm-archive">("view");
  const [busy, setBusy] = useState(false);

  async function handleArchive() {
    setBusy(true);
    try { await onArchive(def.key); } finally { setBusy(false); setMode("view"); }
  }

  async function handleUnarchive() {
    setBusy(true);
    try { await onUnarchive(def.key); } finally { setBusy(false); }
  }

  const isArchived = def.archived;

  if (mode === "rename") {
    return (
      <div className={`library-clf-item library-clf-item--row${isArchived ? " library-clf-item--archived" : ""}`}>
        <span className="library-clf-key" title={`key: ${def.key}`}>{def.key}</span>
        <div className="library-clf-name-cell">
          <RenameRow
            currentName={def.name}
            onSave={(name) => onRename(def.key, name)}
            onCancel={() => setMode("view")}
          />
        </div>
      </div>
    );
  }

  if (mode === "confirm-archive") {
    return (
      <div className={`library-clf-item library-clf-item--row${isArchived ? " library-clf-item--archived" : ""}`}>
        <span className="library-clf-key">{def.key}</span>
        <span className="library-clf-name">{def.name}</span>
        <div className="library-class-confirm">
          <span className="library-class-confirm-label">Archive this class?</span>
          <button
            type="button"
            className="glass-btn glass-btn--sm glass-btn--danger"
            onClick={() => void handleArchive()}
            disabled={busy}
          >
            Archive
          </button>
          <button
            type="button"
            className="glass-btn glass-btn--sm"
            onClick={() => setMode("view")}
            disabled={busy}
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={`library-clf-item library-clf-item--row${isArchived ? " library-clf-item--archived" : ""}`}>
      <span className="library-clf-key" title={`key: ${def.key}`}>{def.key}</span>
      <span className="library-clf-name">{def.name}</span>
      {isArchived && <span className="library-archived-badge">archived</span>}
      <div className="library-class-actions">
        {!isArchived && (
          <>
            <button
              type="button"
              className="library-class-action-btn"
              onClick={() => setMode("rename")}
              disabled={disabled || busy}
              title="Rename class"
            >
              Rename
            </button>
            <button
              type="button"
              className="library-class-action-btn library-class-action-btn--danger"
              onClick={() => setMode("confirm-archive")}
              disabled={disabled || busy}
              title="Archive classification class"
            >
              Archive
            </button>
          </>
        )}
        {isArchived && (
          <button
            type="button"
            className="library-class-action-btn"
            onClick={() => void handleUnarchive()}
            disabled={disabled || busy}
            title="Restore archived class"
          >
            Restore
          </button>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// WorkspaceClassesView — the main editing panel
// ---------------------------------------------------------------------------

type WorkspaceClassesViewProps = {
  workspaceRoot: string;
  onBack: () => void;
};

function WorkspaceClassesView({ workspaceRoot, onBack }: WorkspaceClassesViewProps) {
  const {
    manifest,
    legacyMode,
    loading,
    saving,
    loadError,
    saveError,
    load,
    addDetect,
    addClf,
    rename,
    archiveDetect,
    unarchiveDetect,
    archiveClf,
    unarchiveClf,
    upgradeLegacy,
  } = useWorkspaceClasses(workspaceRoot);

  const [upgrading, setUpgrading] = useState(false);

  useEffect(() => {
    void load();
  }, [load]);

  const taskType = manifest ? derivedTaskType(manifest) : null;
  const needDetect = !taskType || taskType !== "classify";
  const needClf = !taskType || taskType !== "detect";
  const disabled = loading || saving;

  const detectDefs = manifest ? allDetectClassDefs(manifest) : [];
  const activeClfDefs = manifest ? activeClfClassDefs(manifest) : [];
  const archived = manifest ? archivedClassDefs(manifest) : [];
  const archivedClfDefs = archived.filter(
    (d) => !manifest!.tasks.detect.classKeys.includes(d.key)
  );

  async function handleUpgrade() {
    setUpgrading(true);
    try { await upgradeLegacy(); } finally { setUpgrading(false); }
  }

  return (
    <div className="library-classes-detail">
      {/* Header */}
      <div className="library-classes-header">
        <button
          type="button"
          className="library-classes-back glass-btn glass-btn--sm"
          onClick={onBack}
        >
          <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M10 3L5 8l5 5" />
          </svg>
          Library
        </button>
        <h3 className="library-classes-title">Classes</h3>
        {taskType && <TaskBadge taskType={taskType} />}
        {saving && <span className="library-saving-badge">Saving…</span>}
      </div>

      {/* Legacy mode notice */}
      {legacyMode && (
        <div className="library-legacy-notice">
          <div className="library-legacy-notice-body">
            <strong>Legacy class format</strong> — this workspace uses{" "}
            <code className="library-class-code">classes.txt</code> only. Class editing is
            read-only until you save as{" "}
            <code className="library-class-code">workspace/classes.json</code>.
          </div>
          <button
            type="button"
            className="glass-btn glass-btn--sm glass-btn--primary"
            onClick={() => void handleUpgrade()}
            disabled={upgrading || saving}
          >
            {upgrading ? "Saving…" : "Save as classes.json"}
          </button>
        </div>
      )}

      {/* Errors */}
      {loadError && <p className="glass-error">{loadError}</p>}
      {saveError && <p className="glass-error">{saveError}</p>}

      {loading && (
        <div className="library-classes-loading">
          <span className="page-loading-spinner" aria-hidden="true" />
          Loading classes…
        </div>
      )}

      {!loading && !manifest && !loadError && (
        <div className="library-classes-empty">
          No class information found for this workspace.
        </div>
      )}

      {!loading && manifest && (
        <div className="library-classes-body">
          {/* ── Detect classes ─────────────────────────────────────────── */}
          {needDetect && (
            <div className="library-class-group">
              <div className="library-class-group-header">
                <span className="library-class-group-title">Detect Classes</span>
                <span className="library-class-group-count">
                  {activeDetectClassDefs(manifest).length} active
                  {detectDefs.filter((d) => d.archived).length > 0
                    ? ` · ${detectDefs.filter((d) => d.archived).length} archived`
                    : ""}
                </span>
              </div>

              {detectDefs.length === 0 ? (
                <p className="library-class-empty">No detect classes defined.</p>
              ) : (
                <div className="library-detect-list">
                  {detectDefs.map((def) => (
                    <DetectClassRow
                      key={def.key}
                      def={def}
                      disabled={disabled || legacyMode}
                      onRename={rename}
                      onArchive={archiveDetect}
                      onUnarchive={unarchiveDetect}
                    />
                  ))}
                </div>
              )}

              {!legacyMode && (
                <AddClassRow
                  placeholder="New detect class name…"
                  disabled={disabled}
                  onAdd={(name) => addDetect(name).then(() => {})}
                />
              )}

              <div className="library-class-warning">
                <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="library-class-warning-icon" aria-hidden="true">
                  <path d="M8 2L1.5 14h13L8 2z" />
                  <path d="M8 6v4M8 11.5v.5" />
                </svg>
                <span>
                  Detect class order cannot be changed — YOLO label IDs depend on position.
                  New classes are always appended. Archiving a class keeps its ID slot reserved
                  so existing label files remain valid.
                </span>
              </div>
            </div>
          )}

          {/* ── Classification classes ──────────────────────────────────── */}
          {needClf && (
            <div className="library-class-group">
              <div className="library-class-group-header">
                <span className="library-class-group-title">Classification Classes</span>
                <span className="library-class-group-count">
                  {activeClfDefs.length} active
                  {archivedClfDefs.length > 0 ? ` · ${archivedClfDefs.length} archived` : ""}
                </span>
              </div>

              {activeClfDefs.length === 0 && archivedClfDefs.length === 0 ? (
                <p className="library-class-empty">No classification classes defined.</p>
              ) : (
                <div className="library-clf-list library-clf-list--rows">
                  {activeClfDefs.map((def) => (
                    <ClfClassRow
                      key={def.key}
                      def={def}
                      disabled={disabled || legacyMode}
                      onRename={rename}
                      onArchive={archiveClf}
                      onUnarchive={unarchiveClf}
                    />
                  ))}
                  {archivedClfDefs.map((def) => (
                    <ClfClassRow
                      key={def.key}
                      def={def}
                      disabled={disabled || legacyMode}
                      onRename={rename}
                      onArchive={archiveClf}
                      onUnarchive={unarchiveClf}
                    />
                  ))}
                </div>
              )}

              {!legacyMode && (
                <AddClassRow
                  placeholder="New classification class name…"
                  disabled={disabled}
                  onAdd={(name) => addClf(name).then(() => {})}
                />
              )}

              <div className="library-class-warning library-class-warning--info">
                <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="library-class-warning-icon" aria-hidden="true">
                  <circle cx="8" cy="8" r="6" />
                  <path d="M8 7v4M8 5.5v.5" />
                </svg>
                <span>
                  Classification class names become folder-safe keys (e.g.{" "}
                  <code className="library-class-code">day</code>). Renaming updates the
                  display name only — the key slug stays stable.
                </span>
              </div>
            </div>
          )}

          {/* ── Read-only source note ───────────────────────────────────── */}
          <p className="library-class-readonly-note">
            Changes are saved to{" "}
            <code className="library-class-code">workspace/classes.json</code> and synced to{" "}
            <code className="library-class-code">classes.txt</code>. Drag reorder and hard
            delete are not available in this release.
          </p>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// LibraryPage
// ---------------------------------------------------------------------------

export function LibraryPage({ onReady }: Props) {
  const { workspaceRoot, setActiveTab } = useWorkspace();
  const [view, setView] = useState<LibraryView>("overview");

  useEffect(() => {
    onReady?.();
  }, [onReady]);

  // Reset to overview when workspace changes.
  useEffect(() => {
    setView("overview");
  }, [workspaceRoot]);

  if (!workspaceRoot.trim()) {
    return (
      <div className="library-page library-page--empty">
        <div className="empty">
          <strong>Open a workspace to view the library.</strong>
        </div>
      </div>
    );
  }

  if (view === "classes") {
    return (
      <div className="library-page">
        <WorkspaceClassesView
          workspaceRoot={workspaceRoot}
          onBack={() => setView("overview")}
        />
      </div>
    );
  }

  return (
    <div className="library-page">
      <div className="library-header">
        <h2 className="library-title">Library</h2>
        <p className="library-subtitle">{workspaceRoot}</p>
      </div>
      <div className="library-sections">
        <button
          type="button"
          className="glass-card library-section-card"
          onClick={() => setActiveTab("image-pool")}
        >
          <div className="library-section-icon">
            <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="3" y="4" width="8" height="8" rx="1.5" />
              <rect x="13" y="4" width="8" height="8" rx="1.5" />
              <rect x="3" y="14" width="8" height="8" rx="1.5" />
              <rect x="13" y="14" width="8" height="8" rx="1.5" />
            </svg>
          </div>
          <div className="library-section-main">
            <div className="library-section-title">Image Pool</div>
            <div className="library-section-desc">Browse and manage images in the workspace</div>
          </div>
          <ChevronRight />
        </button>

        <button
          type="button"
          className="glass-card library-section-card"
          onClick={() => setActiveTab("video-capture")}
        >
          <div className="library-section-icon">
            <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="3" y="6" width="13" height="12" rx="2" />
              <path d="M16 10l5-3v10l-5-3" />
            </svg>
          </div>
          <div className="library-section-main">
            <div className="library-section-title">Video Segments</div>
            <div className="library-section-desc">Manage video sources and segment annotations</div>
          </div>
          <ChevronRight />
        </button>

        <button
          type="button"
          className="glass-card library-section-card"
          onClick={() => setView("classes")}
        >
          <div className="library-section-icon">
            <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="3" />
              <path d="M2 12h3M19 12h3M12 2v3M12 19v3" />
            </svg>
          </div>
          <div className="library-section-main">
            <div className="library-section-title">Classes</div>
            <div className="library-section-desc">Manage detection and classification classes</div>
          </div>
          <ChevronRight />
        </button>
      </div>
    </div>
  );
}
