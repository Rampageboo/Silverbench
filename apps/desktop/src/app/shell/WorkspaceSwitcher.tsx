import { useCallback, useRef, useState } from "react";
import { setActiveSnapshotVersion } from "../../features/workspace-versioning/workspaceSnapshotVersionApi";
import {
  listSnapshotVersions,
  type WorkspaceVersionId
} from "../../features/workspace-versioning/workspaceSnapshotVersions";
import {
  IconCheck,
  IconChevronDown,
  IconFolder,
  IconFolderPlus,
  IconHistory,
  IconLayers
} from "../../ui/icons";
import { useDismiss } from "../../ui/useDismiss";
import { workspaceDisplayName } from "../recentWorkspaces";
import { useWorkspace } from "../useWorkspace";
import { useWorkspaceLauncher } from "./WorkspaceLauncher";

export function WorkspaceSwitcher({ collapsed }: { collapsed: boolean }) {
  const { workspaceRoot, workspaceRootPath, activeVersionId, snapshotVersions, openWorkspacePath } =
    useWorkspace();
  const launcher = useWorkspaceLauncher();
  const [open, setOpen] = useState(false);
  const [busyVersion, setBusyVersion] = useState<WorkspaceVersionId | null>(null);
  const [error, setError] = useState("");
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(open, [triggerRef, menuRef], close);

  const root = (workspaceRootPath || workspaceRoot).trim();
  const name = root ? workspaceDisplayName(root) : "No workspace";
  const versions = snapshotVersions ? listSnapshotVersions(snapshotVersions) : [];
  const activeVersion = activeVersionId || snapshotVersions?.activeVersion || null;
  const otherRecent = launcher.recent.filter((path) => path !== root).slice(0, 5);

  async function switchVersion(versionId: WorkspaceVersionId) {
    if (!root || versionId === activeVersion) return;
    setBusyVersion(versionId);
    setError("");
    try {
      await setActiveSnapshotVersion(root, versionId);
      await openWorkspacePath(root);
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyVersion(null);
    }
  }

  function run(action: () => void | Promise<void>) {
    setOpen(false);
    void action();
  }

  return (
    <div className="shell-ws">
      <button
        ref={triggerRef}
        type="button"
        className={`shell-ws__trigger${root ? "" : " is-empty"}`}
        aria-haspopup="menu"
        aria-expanded={open}
        title={root || "Open a workspace"}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="shell-ws__monogram" aria-hidden="true">
          {root ? name.slice(0, 2).toUpperCase() : "—"}
        </span>
        {collapsed ? null : (
          <>
            <span className="shell-ws__text">
              <span className="shell-ws__name">{name}</span>
              <span className="shell-ws__path">{root || "Open or create a workspace"}</span>
            </span>
            {activeVersion ? <span className="ui-badge ui-badge--outline">{activeVersion}</span> : null}
            <IconChevronDown size={14} className="shell-ws__chev" />
          </>
        )}
      </button>

      {open ? (
        <div ref={menuRef} className="ui-menu shell-ws__menu" role="menu">
          {root ? (
            <>
              <div className="ui-menu__label ui-eyebrow">Current</div>
              <div className="shell-ws__current">
                <strong>{name}</strong>
                <span>{root}</span>
              </div>
            </>
          ) : null}

          {versions.length > 1 ? (
            <>
              <div className="ui-menu__label ui-eyebrow">Version</div>
              {versions.map((version) => (
                <button
                  key={version.id}
                  type="button"
                  role="menuitemradio"
                  aria-checked={version.id === activeVersion}
                  className="ui-menu__item"
                  disabled={busyVersion !== null}
                  onClick={() => void switchVersion(version.id)}
                >
                  {version.id === activeVersion ? <IconCheck /> : <IconLayers />}
                  <span className="ui-menu__item-text">
                    <span>{version.id}</span>
                    <span className="ui-menu__item-sub">{version.source || "snapshot"}</span>
                  </span>
                  {busyVersion === version.id ? <span className="ui-menu__item-sub">Switching…</span> : null}
                </button>
              ))}
            </>
          ) : null}
          {error ? <div className="ui-error shell-ws__error">{error}</div> : null}

          <div className="ui-menu__sep" />
          <button
            type="button"
            role="menuitem"
            className="ui-menu__item"
            onClick={() => run(launcher.openFolder)}
          >
            <IconFolder />
            <span>Open folder…</span>
          </button>
          <button
            type="button"
            role="menuitem"
            className="ui-menu__item"
            onClick={() => run(launcher.requestCreate)}
          >
            <IconFolderPlus />
            <span>New workspace…</span>
          </button>

          {otherRecent.length ? (
            <>
              <div className="ui-menu__sep" />
              <div className="ui-menu__label ui-eyebrow">Recent</div>
              {otherRecent.map((path) => (
                <button
                  key={path}
                  type="button"
                  role="menuitem"
                  className="ui-menu__item"
                  title={path}
                  onClick={() => run(() => launcher.openRecent(path))}
                >
                  <IconHistory />
                  <span className="ui-menu__item-text">
                    <span>{workspaceDisplayName(path)}</span>
                    <span className="ui-menu__item-sub">{path}</span>
                  </span>
                </button>
              ))}
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
