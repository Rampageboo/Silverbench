import { useEffect, useState } from "react";
import { appSettings, writeAppSettings } from "../api";
import {
  normalizeStartupOverlayMode,
  readStartupOverlayMode,
  writeStartupOverlayMode,
  type StartupOverlayMode
} from "../app/startupOverlayMode";
import { APP_THEME_OPTIONS, readAppTheme, writeAppTheme, type AppTheme } from "../app/appTheme";
import { useWorkspaceArchitecture } from "../workspace/WorkspaceArchitectureProvider";
import { GallerySettingsSection } from "../features/gallery/GallerySettingsSection";
import "./settings.css";

type SettingsModalProps = {
  open: boolean;
  onClose: () => void;
};

type StartupOption = {
  value: StartupOverlayMode;
  title: string;
  desc: string;
};

const STARTUP_OPTIONS: StartupOption[] = [
  { value: "overview", title: "功能概览", desc: "展示核心功能与简介" },
  { value: "minimal", title: "简洁式", desc: "仅图标、标题与加载进度" }
];

export function SettingsModal({ open, onClose }: SettingsModalProps) {
  const [mode, setMode] = useState<StartupOverlayMode>(readStartupOverlayMode);
  const [theme, setTheme] = useState<AppTheme>(readAppTheme);
  const [render, setRender] = useState(open);
  const [visible, setVisible] = useState(false);
  const { workspaceRoot, manifest, phase, error, migrated, refresh } = useWorkspaceArchitecture();

  useEffect(() => {
    if (open) {
      setRender(true);
      const frame = window.requestAnimationFrame(() => setVisible(true));
      return () => window.cancelAnimationFrame(frame);
    }
    setVisible(false);
    const timer = window.setTimeout(() => setRender(false), 200);
    return () => window.clearTimeout(timer);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setMode(readStartupOverlayMode());
    setTheme(readAppTheme());
    let cancelled = false;
    appSettings()
      .then((settings) => {
        if (cancelled) return;
        if (settings.startupOverlayMode) {
          setMode(normalizeStartupOverlayMode(settings.startupOverlayMode));
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  function selectMode(next: StartupOverlayMode) {
    setMode(next);
    writeStartupOverlayMode(next);
    void writeAppSettings({ startupOverlayMode: next }).catch(() => {});
  }

  function selectTheme(next: AppTheme) {
    setTheme(next);
    writeAppTheme(next);
  }

  if (!render) return null;

  const manifestRows: Array<[string, string]> = manifest
    ? [
        ["Name", manifest.name],
        ["Manifest", `v${manifest.version}`],
        ["App mode", "video-first · timestamp manifest · no extracted frames"],
        ["Video annotations", String(manifest.paths.video_annotations)],
        ["Video segments", String(manifest.paths.video_segments)],
        ["Structured logs", String(manifest.paths.logs)],
        ["Disposable cache", String(manifest.paths.cache)]
      ]
    : [];

  return (
    <div
      className={`ui-dialog-scrim settings-scrim${visible ? " is-visible" : ""}`}
      role="presentation"
      onClick={onClose}
    >
      <section
        className="ui-dialog ui-dialog--wide settings-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="app-settings-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="ui-dialog__head">
          <h2 id="app-settings-title" className="ui-dialog__title">
            Settings <span className="settings-dialog__zh">设置</span>
          </h2>
          <button type="button" className="ui-btn--ghost ui-btn--sm" aria-label="关闭" onClick={onClose}>
            Close
          </button>
        </header>
        <div className="ui-dialog__body settings-dialog__body">
          <section className="settings-group">
            <div className="settings-group__head">
              <h3>Appearance</h3>
              <p>Color system for the whole workbench.</p>
            </div>
            <div className="settings-choices">
              {APP_THEME_OPTIONS.map((option) => (
                <label
                  key={option.value}
                  className={`settings-choice${theme === option.value ? " is-selected" : ""}`}
                >
                  <input
                    type="radio"
                    name="appTheme"
                    value={option.value}
                    checked={theme === option.value}
                    onChange={() => selectTheme(option.value)}
                  />
                  <span className={`settings-swatch settings-swatch--${option.value}`} aria-hidden="true">
                    <i />
                    <i />
                    <i />
                  </span>
                  <span className="settings-choice__copy">
                    <strong>{option.title}</strong>
                    <span>{option.desc}</span>
                  </span>
                </label>
              ))}
            </div>
          </section>

          <section className="settings-group">
            <div className="settings-group__head">
              <h3>Startup screen</h3>
              <p>选择应用启动时加载遮罩的样式。</p>
            </div>
            <div className="ui-seg" role="radiogroup" aria-label="Startup screen">
              {STARTUP_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  role="radio"
                  aria-checked={mode === option.value}
                  aria-pressed={mode === option.value}
                  title={option.desc}
                  onClick={() => selectMode(option.value)}
                >
                  {option.title}
                </button>
              ))}
            </div>
          </section>

          <GallerySettingsSection open={open} />

          <section className="settings-group">
            <div className="settings-group__head settings-group__head--row">
              <div>
                <h3>Workspace architecture</h3>
                <p>Read from the open workspace manifest.</p>
              </div>
              <button
                type="button"
                className="ui-btn--sm"
                onClick={() => void refresh()}
                disabled={!workspaceRoot.trim() || phase === "loading"}
              >
                Refresh
              </button>
            </div>
            {!workspaceRoot.trim() ? (
              <p className="settings-muted">No workspace is open.</p>
            ) : manifest ? (
              <dl className="settings-kv">
                {manifestRows.map(([key, value]) => (
                  <div key={key}>
                    <dt>{key}</dt>
                    <dd>{value}</dd>
                  </div>
                ))}
                {migrated ? (
                  <div>
                    <dt>Note</dt>
                    <dd>Manifest upgraded during this session.</dd>
                  </div>
                ) : null}
              </dl>
            ) : (
              <p className="settings-muted">
                {phase === "loading"
                  ? "Loading workspace manifest…"
                  : error || "Workspace manifest unavailable."}
              </p>
            )}
          </section>
        </div>
      </section>
    </div>
  );
}
