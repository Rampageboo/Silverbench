import { useEffect, useState, type ReactNode } from "react";
import * as api from "../../api";
import { errMessage } from "../../lib/errors";
import { IconClose } from "../../ui/icons";
import { workspaceDisplayName } from "../../workspace/layout";
import { useWorkspace } from "../useWorkspace";
import type { PendingFolder } from "../workspaceContext";

function Dialog({
  title,
  onClose,
  children,
  footer
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer: ReactNode;
}) {
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="ui-dialog-scrim" role="presentation" onPointerDown={onClose}>
      <section
        className="ui-dialog ui-dialog--wide"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <header className="ui-dialog__head">
          <h2 className="ui-dialog__title">{title}</h2>
          <button type="button" className="ui-btn--ghost ui-btn--icon ui-btn--sm" onClick={onClose} aria-label="关闭">
            <IconClose size={14} />
          </button>
        </header>
        <div className="ui-dialog__body pending-folder">{children}</div>
        <footer className="ui-dialog__foot">{footer}</footer>
      </section>
    </div>
  );
}

const SOURCE_LABEL: Record<api.MigrationSummary["sourceKind"], string> = {
  snapshot: "versioned workspace (V1/V2 full copies)",
  v2: "workspace (format 2)",
  v1: "workspace (format 1)"
};

function MigrationBody({ folder }: { folder: Extract<PendingFolder, { kind: "legacy" }> }) {
  const { migration } = folder;
  const moved = migration.counts.move ?? 0;
  const rewritten = (migration.counts.rewrite ?? 0) + (migration.counts.write ?? 0);
  return (
    <>
      <p>
        <strong>{folder.name}</strong> is an older {SOURCE_LABEL[migration.sourceKind]}
        {migration.activeVersion ? ` — the active version is ${migration.activeVersion}` : ""}. RampageWorkbench
        only opens the current format, so it needs to be migrated first.
      </p>
      <ul className="pending-folder__facts">
        <li>
          {moved} items are moved into the new layout (renamed, never copied — media stays where it is on disk).
        </li>
        <li>{rewritten} annotation files are rewritten to name files after their media instead of hashes.</li>
        <li>Old datasets and configs go to exports/legacy-… and .rwb/migrated — nothing is deleted.</li>
        <li>Right after migrating you can check the result and undo it completely.</li>
      </ul>
      {migration.warnings.length ? (
        <div className="pending-folder__list">
          <div className="ui-eyebrow">Notes</div>
          <ul>
            {migration.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {migration.conflicts.length ? (
        <div className="pending-folder__list ui-error">
          <div className="ui-eyebrow">Blocked</div>
          <ul>
            {migration.conflicts.map((conflict) => (
              <li key={conflict}>{conflict}</li>
            ))}
          </ul>
        </div>
      ) : null}
      <code className="pending-folder__path">{folder.root}</code>
    </>
  );
}

/** Resolves a folder that opened as something other than a workspace. */
export function PendingFolderDialog() {
  const { pendingFolder, dismissPendingFolder, adoptWorkspace, setActiveTab } = useWorkspace();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setBusy(false);
    setError("");
  }, [pendingFolder]);

  if (!pendingFolder) return null;
  const folder = pendingFolder;

  async function run(action: () => Promise<api.WorkspacePayload>) {
    setBusy(true);
    setError("");
    try {
      await adoptWorkspace(await action());
      setActiveTab("library");
    } catch (err) {
      setError(errMessage(err));
      setBusy(false);
    }
  }

  const cancel = (
    <button type="button" onClick={dismissPendingFolder} disabled={busy}>
      Cancel
    </button>
  );

  if (folder.kind === "legacy") {
    return (
      <Dialog
        title="Migrate workspace"
        onClose={busy ? () => {} : dismissPendingFolder}
        footer={
          <>
            {cancel}
            <button
              type="button"
              className="ui-btn--solid"
              disabled={busy || !folder.migration.ok}
              onClick={() => void run(async () => (await api.migrateWorkspace(folder.root)).workspace)}
            >
              {busy ? "Migrating…" : "Migrate"}
            </button>
          </>
        }
      >
        <MigrationBody folder={folder} />
        {error ? <p className="ui-error">{error}</p> : null}
      </Dialog>
    );
  }

  if (folder.kind === "dataset") {
    return (
      <Dialog
        title="This is a YOLO dataset"
        onClose={dismissPendingFolder}
        footer={
          <button type="button" className="ui-btn--solid" onClick={dismissPendingFolder}>
            OK
          </button>
        }
      >
        <p>
          <strong>{folder.name}</strong> looks like an exported {folder.task === "classify" ? "classification" : "detection"}{" "}
          dataset. Datasets are products of a workspace: work on the workspace and export again, or use the dataset
          tools (Train prep, Merge, Crop) directly on this folder.
        </p>
        <code className="pending-folder__path">{folder.root}</code>
      </Dialog>
    );
  }

  return (
    <Dialog
      title="Create a workspace here?"
      onClose={dismissPendingFolder}
      footer={
        <>
          {cancel}
          <button
            type="button"
            className="ui-btn--solid"
            disabled={busy}
            onClick={() => void run(() => api.createWorkspace(folder.root))}
          >
            {busy ? "Creating…" : "Create workspace"}
          </button>
        </>
      }
    >
      <p>
        <strong>{workspaceDisplayName(folder.root)}</strong> is not a workspace yet.
        {folder.empty
          ? " It is empty, so it can become one."
          : " Files already in it stay where they are; add images and videos to the workspace with Import."}
      </p>
      <code className="pending-folder__path">{folder.root}</code>
      {error ? <p className="ui-error">{error}</p> : null}
    </Dialog>
  );
}

/** Shown after a migration until the user keeps or undoes it. */
export function MigrationReviewBar() {
  const { workspace, adoptWorkspace, openWorkspacePath } = useWorkspace();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (!workspace?.migrationPending) return null;
  const root = workspace.root;

  async function keep() {
    setBusy(true);
    try {
      await api.finishWorkspaceMigration(root);
      await adoptWorkspace({ ...workspace!, migrationPending: false });
    } catch (err) {
      setError(errMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function undo() {
    setBusy(true);
    try {
      await api.rollbackWorkspaceMigration(root);
      await openWorkspacePath(root);
    } catch (err) {
      setError(errMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="shell-review" role="status">
      <span>
        This workspace was just migrated to the new format. Look around, then keep it — or undo to restore the
        old layout exactly.
      </span>
      {error ? <span className="ui-error">{error}</span> : null}
      <button type="button" className="ui-btn--sm" disabled={busy} onClick={() => void undo()}>
        Undo migration
      </button>
      <button type="button" className="ui-btn--sm ui-btn--solid" disabled={busy} onClick={() => void keep()}>
        Keep
      </button>
    </div>
  );
}
