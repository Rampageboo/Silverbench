import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import { useDismiss } from "../../ui/useDismiss";
import { useAppUpdate, type UpdateState } from "./useAppUpdate";

const UpdateContext = createContext<UpdateState | null>(null);

export function AppUpdateProvider({ children }: { children: ReactNode }) {
  return <UpdateContext.Provider value={useAppUpdate()}>{children}</UpdateContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useUpdateState() {
  const state = useContext(UpdateContext);
  if (!state) throw new Error("useUpdateState must be used within AppUpdateProvider.");
  return state;
}

function megabytes(bytes: number) {
  return `${(bytes / 2 ** 20).toFixed(1)} MB`;
}

function progressText(progress: NonNullable<UpdateState["progress"]>) {
  return progress.total ? `${Math.round((progress.done / progress.total) * 100)}%` : megabytes(progress.done);
}

/** Sidebar status item: appears only when a new version is available. */
export function UpdateStatus({ collapsed }: { collapsed: boolean }) {
  const { update, progress, error, install } = useUpdateState();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(open, [triggerRef, menuRef], close);
  if (!update) return null;
  return (
    <span className="shell-models">
      <button
        ref={triggerRef}
        type="button"
        className={`shell-status__item shell-status__btn${open ? " is-open" : ""}`}
        onClick={() => setOpen((value) => !value)}
        title={`Version ${update.version} available`}
        aria-expanded={open}
      >
        <span className="ui-dot ui-dot--ok" />
        {collapsed ? null : <span>Update {update.version}</span>}
      </button>
      {open ? (
        <div ref={menuRef} className="ui-menu shell-models__menu" role="dialog">
          <div className="ui-menu__label ui-eyebrow">Silverbench {update.version}</div>
          <UpdateDetails />
          <div className="ui-menu__sep" />
          <div className="shell-models__foot">
            <span className="ui-menu__item-sub">
              {progress ? `Downloading ${progressText(progress)}…` : error}
            </span>
            <button type="button" className="ui-btn--sm" onClick={() => void install()} disabled={!!progress}>
              {progress ? "Updating…" : "Update and restart"}
            </button>
          </div>
        </div>
      ) : null}
    </span>
  );
}

function UpdateDetails() {
  const { update, info } = useUpdateState();
  if (!update) return null;
  return (
    <div className="update-notes">
      <span className="ui-menu__item-sub">
        Current {info?.version ?? update.currentVersion}
        {update.date ? ` · Released ${update.date.slice(0, 10)}` : ""}
      </span>
      {update.body ? <pre className="update-notes__body">{update.body}</pre> : null}
    </div>
  );
}

/** Settings → About & updates. */
export function UpdateSettingsSection() {
  const { info, update, checking, progress, error, lastChecked, check, install } = useUpdateState();
  return (
    <section className="settings-group">
      <div className="settings-group__head">
        <h3>About &amp; updates</h3>
      </div>
      <dl className="settings-kv">
        <div>
          <dt>Version</dt>
          <dd>{info ? info.version : "Browser build"}</dd>
        </div>
        <div>
          <dt>Updates</dt>
          <dd>
            {!info?.packaged
              ? "Source build: update with update.bat"
              : update
                ? `Version ${update.version} available`
                : lastChecked
                  ? `Up to date (checked ${lastChecked.toLocaleTimeString()})`
                  : "Not checked yet"}
          </dd>
        </div>
      </dl>
      {update ? <UpdateDetails /> : null}
      {error ? <p className="ui-error">{error}</p> : null}
      {info?.packaged ? (
        <div className="settings-actions">
          <button
            type="button"
            className="ui-btn--sm"
            onClick={() => void check()}
            disabled={checking || !!progress}
          >
            {checking ? "Checking…" : "Check for updates"}
          </button>
          {update ? (
            <button type="button" className="ui-btn--sm" onClick={() => void install()} disabled={!!progress}>
              {progress ? `Downloading ${progressText(progress)}` : "Update and restart"}
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
