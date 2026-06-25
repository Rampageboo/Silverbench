import { useEffect, useState } from "react";
import { appSettings, writeAppSettings } from "../api";
import {
  normalizeStartupOverlayMode,
  readStartupOverlayMode,
  writeStartupOverlayMode,
  type StartupOverlayMode
} from "../app/startupOverlayMode";
import { useWorkspaceArchitecture } from "../workspace/WorkspaceArchitectureProvider";

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

  if (!render) return null;

  return (
    <div
      className={`app-settings-backdrop${visible ? " is-visible" : ""}`}
      role="presentation"
      onClick={onClose}
    >
      <section
        className={`app-settings-dialog${visible ? " is-visible" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="app-settings-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="app-settings-header">
          <h2 id="app-settings-title">设置</h2>
          <button type="button" className="app-settings-close" aria-label="关闭" onClick={onClose}>
            ×
          </button>
        </header>
        <div className="app-settings-body">
          <div className="app-settings-section">
            <h3>启动加载样式</h3>
            <p className="app-settings-hint">选择应用启动时加载遮罩的样式。</p>
            <div className="app-settings-options">
              {STARTUP_OPTIONS.map((option) => (
                <label
                  key={option.value}
                  className={`app-settings-option${mode === option.value ? " selected" : ""}`}
                >
                  <input
                    type="radio"
                    name="startupOverlayMode"
                    value={option.value}
                    checked={mode === option.value}
                    onChange={() => selectMode(option.value)}
                  />
                  <span className="app-settings-option-copy">
                    <strong>{option.title}</strong>
                    <span>{option.desc}</span>
                  </span>
                </label>
              ))}
            </div>
          </div>

          <div className="app-settings-section">
            <div className="row">
              <h3 style={{ margin: 0 }}>Workspace Architecture</h3>
              <button type="button" onClick={() => void refresh()} disabled={!workspaceRoot.trim() || phase === "loading"}>
                Refresh
              </button>
            </div>
            {!workspaceRoot.trim() ? (
              <p className="app-settings-hint">No workspace is open.</p>
            ) : manifest ? (
              <div className="app-settings-options">
                <div className="app-settings-option selected">
                  <span className="app-settings-option-copy">
                    <strong>{manifest.name} · manifest v{manifest.version}</strong>
                    <span>Video Label is primary. Extracted screenshots are disabled.</span>
                    <span>Image Box Label and Image Pool remain enabled as secondary workflows.</span>
                    <span>Video metadata: {String(manifest.paths.video_annotations)}</span>
                    <span>Structured logs: {String(manifest.paths.logs)}</span>
                    <span>Disposable cache: {String(manifest.paths.cache)}</span>
                    {migrated ? <span>Manifest upgraded during this session.</span> : null}
                  </span>
                </div>
              </div>
            ) : (
              <p className="app-settings-hint">
                {phase === "loading" ? "Loading workspace manifest…" : error || "Workspace manifest unavailable."}
              </p>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
