import { useEffect, useState } from "react";
import { appSettings, writeAppSettings } from "../api";
import {
  normalizeStartupOverlayMode,
  readStartupOverlayMode,
  writeStartupOverlayMode,
  type StartupOverlayMode
} from "../app/startupOverlayMode";

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
  { value: "overview", title: "功能概览", desc: "展示 9 项核心功能与简介" },
  { value: "minimal", title: "简洁式", desc: "仅图标、标题与加载进度" }
];

export function SettingsModal({ open, onClose }: SettingsModalProps) {
  const [mode, setMode] = useState<StartupOverlayMode>(readStartupOverlayMode);
  const [render, setRender] = useState(open);
  const [visible, setVisible] = useState(false);

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
        </div>
      </section>
    </div>
  );
}
