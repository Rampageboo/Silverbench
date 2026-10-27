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
        title={`新版本 ${update.version} 可用`}
        aria-expanded={open}
      >
        <span className="ui-dot ui-dot--ok" />
        {collapsed ? null : <span>新版本 {update.version}</span>}
      </button>
      {open ? (
        <div ref={menuRef} className="ui-menu shell-models__menu" role="dialog">
          <div className="ui-menu__label ui-eyebrow">RampageWorkbench {update.version}</div>
          <UpdateDetails />
          <div className="ui-menu__sep" />
          <div className="shell-models__foot">
            <span className="ui-menu__item-sub">
              {progress
                ? `正在下载 ${progressText(progress)}…`
                : error || "下载并校验后自动安装、重启。未保存的编辑已自动保存。"}
            </span>
            <button type="button" className="ui-btn--sm" onClick={() => void install()} disabled={!!progress}>
              {progress ? "更新中…" : "更新并重启"}
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
        当前 {info?.version ?? update.currentVersion}
        {update.date ? ` · 发布于 ${update.date.slice(0, 10)}` : ""}
      </span>
      {update.body ? <pre className="update-notes__body">{update.body}</pre> : null}
    </div>
  );
}

/** Settings → 关于与更新. */
export function UpdateSettingsSection() {
  const { info, update, checking, progress, error, lastChecked, check, install } = useUpdateState();
  return (
    <section className="settings-group">
      <div className="settings-group__head">
        <h3>About &amp; updates</h3>
        <p>关于与更新 · 新版本从 GitHub Release 下载，签名校验后安装。</p>
      </div>
      <dl className="settings-kv">
        <div>
          <dt>Version</dt>
          <dd>{info ? info.version : "浏览器版"}</dd>
        </div>
        <div>
          <dt>Updates</dt>
          <dd>
            {!info?.packaged
              ? "源码运行：用 update.bat 更新"
              : update
                ? `新版本 ${update.version} 可用`
                : lastChecked
                  ? `已是最新（${lastChecked.toLocaleTimeString()} 检查）`
                  : "尚未检查"}
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
            {checking ? "检查中…" : "检查更新"}
          </button>
          {update ? (
            <button type="button" className="ui-btn--sm" onClick={() => void install()} disabled={!!progress}>
              {progress ? `下载中 ${progressText(progress)}` : "更新并重启"}
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
