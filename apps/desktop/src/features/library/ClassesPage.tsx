import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useWorkspace } from "../../app/useWorkspace";
import { IconArchive, IconPencil, IconRefresh, IconSearch } from "../../ui/icons";
import type { ClassDef } from "../video/classDomain";
import { useWorkspaceClasses } from "../workspace/useWorkspaceClasses";
import {
  activeClfClassDefs,
  allDetectClassDefs,
  archivedClassDefs,
  derivedTaskType,
  type WorkspaceClassSummary
} from "../workspace/workspaceClassTaxonomy";
import "./library.css";

type Props = { onReady?: () => void };

const TASK_LABELS: Record<WorkspaceClassSummary["taskType"], string> = {
  detect: "Detect",
  classify: "Classify",
  both: "Detect + Classify"
};

type ClassRowProps = {
  /** YOLO id for detect classes, folder key for classification classes. */
  code: string;
  def: ClassDef;
  disabled: boolean;
  archiveHint: string;
  onRename: (classKey: string, newName: string) => Promise<void>;
  onArchive: (classKey: string) => Promise<void>;
  onUnarchive: (classKey: string) => Promise<void>;
};

function ClassRow({ code, def, disabled, archiveHint, onRename, onArchive, onUnarchive }: ClassRowProps) {
  const [mode, setMode] = useState<"view" | "rename" | "confirm">("view");
  const [draft, setDraft] = useState(def.name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (mode === "rename") inputRef.current?.select();
  }, [mode]);

  async function act(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await action();
      setMode("view");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  function saveRename() {
    const name = draft.trim();
    if (!name || name === def.name) {
      setMode("view");
      return;
    }
    void act(() => onRename(def.key, name));
  }

  function onRenameKey(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") saveRename();
    if (event.key === "Escape") setMode("view");
  }

  return (
    <div className={`cls-row${def.archived ? " is-archived" : ""}${mode !== "view" ? " is-editing" : ""}`}>
      <span className="cls-row__code" title={code}>
        {code}
      </span>
      {mode === "rename" ? (
        <div className="cls-row__edit">
          <input
            ref={inputRef}
            value={draft}
            onChange={(event) => {
              setDraft(event.target.value);
              setError("");
            }}
            onKeyDown={onRenameKey}
            disabled={busy}
            aria-label={`Rename ${def.name}`}
          />
          <button
            type="button"
            className="primary ui-btn--sm"
            onClick={saveRename}
            disabled={busy || !draft.trim()}
          >
            Save
          </button>
          <button
            type="button"
            className="ui-btn--ghost ui-btn--sm"
            onClick={() => setMode("view")}
            disabled={busy}
          >
            Cancel
          </button>
        </div>
      ) : mode === "confirm" ? (
        <div className="cls-row__edit">
          <span className="cls-row__confirm">{archiveHint}</span>
          <button
            type="button"
            className="danger ui-btn--sm"
            onClick={() => void act(() => onArchive(def.key))}
            disabled={busy}
          >
            Archive
          </button>
          <button
            type="button"
            className="ui-btn--ghost ui-btn--sm"
            onClick={() => setMode("view")}
            disabled={busy}
          >
            Cancel
          </button>
        </div>
      ) : (
        <>
          <span className="cls-row__name">{def.name}</span>
          {def.archived ? <span className="ui-badge">archived</span> : null}
          <span className="cls-row__actions">
            {def.archived ? (
              <button
                type="button"
                className="ui-btn--ghost ui-btn--sm"
                onClick={() => void act(() => onUnarchive(def.key))}
                disabled={disabled || busy}
              >
                <IconRefresh size={13} /> Restore
              </button>
            ) : (
              <>
                <button
                  type="button"
                  className="ui-btn--ghost ui-btn--sm ui-btn--icon"
                  onClick={() => {
                    setDraft(def.name);
                    setMode("rename");
                  }}
                  disabled={disabled || busy}
                  title="Rename"
                  aria-label={`Rename ${def.name}`}
                >
                  <IconPencil size={13} />
                </button>
                <button
                  type="button"
                  className="ui-btn--ghost ui-btn--sm ui-btn--icon"
                  onClick={() => setMode("confirm")}
                  disabled={disabled || busy}
                  title="Archive"
                  aria-label={`Archive ${def.name}`}
                >
                  <IconArchive size={13} />
                </button>
              </>
            )}
          </span>
        </>
      )}
      {error ? <span className="cls-row__error">{error}</span> : null}
    </div>
  );
}

function AddClassRow({
  placeholder,
  disabled,
  onAdd
}: {
  placeholder: string;
  disabled: boolean;
  onAdd: (name: string) => Promise<void>;
}) {
  const [value, setValue] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function add() {
    const name = value.trim();
    if (!name) return;
    setBusy(true);
    setError("");
    try {
      await onAdd(name);
      setValue("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="cls-add">
      <div className="ui-input-row">
        <input
          value={value}
          placeholder={placeholder}
          disabled={disabled || busy}
          onChange={(event) => {
            setValue(event.target.value);
            setError("");
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") void add();
          }}
        />
        <button type="button" onClick={() => void add()} disabled={disabled || busy || !value.trim()}>
          Add
        </button>
      </div>
      {error ? <div className="ui-error">{error}</div> : null}
    </div>
  );
}

function matches(def: ClassDef, code: string, query: string) {
  if (!query) return true;
  const q = query.toLowerCase();
  return def.name.toLowerCase().includes(q) || code.toLowerCase().includes(q);
}

export function ClassesPage({ onReady }: Props) {
  const { workspaceRoot } = useWorkspace();
  const classes = useWorkspaceClasses(workspaceRoot);
  const { manifest, loading, saving, loadError, saveError, load } = classes;
  const [query, setQuery] = useState("");

  useEffect(() => {
    onReady?.();
  }, [onReady]);

  useEffect(() => {
    void load();
  }, [load]);

  const taskType = manifest ? derivedTaskType(manifest) : null;
  const showDetect = !taskType || taskType !== "classify";
  const showClf = !taskType || taskType !== "detect";
  const disabled = loading || saving;

  const detectDefs = useMemo(() => (manifest ? allDetectClassDefs(manifest) : []), [manifest]);
  const clfDefs = useMemo(() => {
    if (!manifest) return [];
    const archivedClf = archivedClassDefs(manifest).filter(
      (def) => !manifest.tasks.detect.classKeys.includes(def.key)
    );
    return [...activeClfClassDefs(manifest), ...archivedClf];
  }, [manifest]);

  const visibleDetect = detectDefs.filter((def) => matches(def, String(def.yoloId), query));
  const visibleClf = clfDefs.filter((def) => matches(def, def.key, query));
  const detectArchived = detectDefs.filter((def) => def.archived).length;
  const clfArchived = clfDefs.filter((def) => def.archived).length;

  return (
    <div className="ui-page">
      <div className="ui-page__inner cls-page">
        <header className="ui-page__head">
          <div>
            <div className="ui-eyebrow">Workspace</div>
            <h1 className="ui-page__title">Classes</h1>
            <p className="ui-page__sub">
              Single source of class names for labeling, review, export and the orchestrator.
            </p>
          </div>
          <div className="cls-page__tools">
            {taskType ? <span className="ui-badge ui-badge--accent">{TASK_LABELS[taskType]}</span> : null}
            {saving ? <span className="ui-badge">Saving…</span> : null}
            <label className="cls-search">
              <IconSearch size={14} />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Filter classes"
                aria-label="Filter classes"
              />
            </label>
          </div>
        </header>

        {loadError ? <div className="ui-error">{loadError}</div> : null}
        {saveError ? <div className="ui-error">{saveError}</div> : null}

        {loading && !manifest ? <div className="page-loading">Loading classes…</div> : null}
        {!loading && !manifest && !loadError ? (
          <div className="ui-empty-state">No class information found for this workspace.</div>
        ) : null}

        {manifest ? (
          <div className="cls-grid">
            {showDetect ? (
              <section className="ui-card cls-card">
                <div className="ui-card__head">
                  <div>
                    <div className="ui-card__title">Detection</div>
                    <div className="ui-field__hint">
                      {detectDefs.length - detectArchived} active
                      {detectArchived ? ` · ${detectArchived} archived` : ""}
                    </div>
                  </div>
                  <span className="ui-eyebrow">YOLO id</span>
                </div>
                <div className="cls-list">
                  {visibleDetect.length ? (
                    visibleDetect.map((def) => (
                      <ClassRow
                        key={def.key}
                        code={String(def.yoloId)}
                        def={def}
                        disabled={disabled}
                        archiveHint={`Archive? ID ${def.yoloId} stays reserved.`}
                        onRename={classes.rename}
                        onArchive={classes.archiveDetect}
                        onUnarchive={classes.unarchiveDetect}
                      />
                    ))
                  ) : (
                    <div className="cls-list__empty">
                      {query ? "No matches." : "No detection classes yet."}
                    </div>
                  )}
                </div>
                <AddClassRow
                  placeholder="New detection class"
                  disabled={loading || saving}
                  onAdd={(name) => classes.addDetect(name).then(() => {})}
                />
                <p className="cls-card__note">
                  IDs are positional: new classes are appended and archived classes keep their slot, so
                  existing label files stay valid.
                </p>
              </section>
            ) : null}

            {showClf ? (
              <section className="ui-card cls-card">
                <div className="ui-card__head">
                  <div>
                    <div className="ui-card__title">Classification</div>
                    <div className="ui-field__hint">
                      {clfDefs.length - clfArchived} active{clfArchived ? ` · ${clfArchived} archived` : ""}
                    </div>
                  </div>
                  <span className="ui-eyebrow">Folder key</span>
                </div>
                <div className="cls-list">
                  {visibleClf.length ? (
                    visibleClf.map((def) => (
                      <ClassRow
                        key={def.key}
                        code={def.key}
                        def={def}
                        disabled={disabled}
                        archiveHint="Archive this class?"
                        onRename={classes.rename}
                        onArchive={classes.archiveClf}
                        onUnarchive={classes.unarchiveClf}
                      />
                    ))
                  ) : (
                    <div className="cls-list__empty">
                      {query ? "No matches." : "No classification classes yet."}
                    </div>
                  )}
                </div>
                <AddClassRow
                  placeholder="New classification class"
                  disabled={loading || saving}
                  onAdd={(name) => classes.addClf(name).then(() => {})}
                />
                <p className="cls-card__note">
                  Names become folder-safe keys. Renaming changes the display name only; the key stays stable.
                </p>
              </section>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
