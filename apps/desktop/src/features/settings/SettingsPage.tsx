import { useEffect, useState } from "react";
import { appSettings, writeAppSettings } from "../../api";
import {
  normalizeStartupOverlayMode,
  readStartupOverlayMode,
  writeStartupOverlayMode,
  type StartupOverlayMode
} from "../../app/startupOverlayMode";
import { useWorkspaceArchitecture } from "../../workspace/WorkspaceArchitectureProvider";

type Props = {
  active?: boolean;
  onReady?: () => void;
};

const STARTUP_OPTIONS = [
  { value: "overview" as StartupOverlayMode, title: "功能概览", desc: "展示核心功能与简介" },
  { value: "minimal" as StartupOverlayMode, title: "简洁式", desc: "仅图标、标题与加载进度" }
];

export function SettingsPage({ onReady }: Props) {
  const [mode, setMode] = useState<StartupOverlayMode>(readStartupOverlayMode);
  const { workspaceRoot, manifest, phase, error, migrated, refresh } = useWorkspaceArchitecture();

  useEffect(() => {
    onReady?.();
    setMode(readStartupOverlayMode());
    let cancelled = false;
    appSettings()
      .then((settings) => {
        if (cancelled || !settings.startupOverlayMode) return;
        setMode(normalizeStartupOverlayMode(settings.startupOverlayMode));
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [onReady]);

  function selectMode(next: StartupOverlayMode) {
    setMode(next);
    writeStartupOverlayMode(next);
    void writeAppSettings({ startupOverlayMode: next }).catch(() => {});
  }

  return (
    <div className="settings-page">
      <div className="settings-header">
        <h2 className="settings-title">Settings</h2>
      </div>
      <div className="settings-body">
        <section className="settings-section glass-card">
          <h3 className="settings-section-title">Startup Screen</h3>
          <p className="settings-hint">Choose the loading overlay style on startup.</p>
          <div className="settings-options">
            {STARTUP_OPTIONS.map((opt) => (
              <label key={opt.value} className={`settings-option${mode === opt.value ? " selected" : ""}`}>
                <input
                  type="radio"
                  name="startupOverlayMode"
                  value={opt.value}
                  checked={mode === opt.value}
                  onChange={() => selectMode(opt.value)}
                />
                <span className="settings-option-copy">
                  <strong>{opt.title}</strong>
                  <span>{opt.desc}</span>
                </span>
              </label>
            ))}
          </div>
        </section>

        <section className="settings-section glass-card">
          <div className="settings-section-header">
            <h3 className="settings-section-title" style={{ margin: 0 }}>Workspace</h3>
            <button
              type="button"
              className="glass-btn glass-btn--sm"
              onClick={() => void refresh()}
              disabled={!workspaceRoot.trim() || phase === "loading"}
            >
              Refresh
            </button>
          </div>
          {!workspaceRoot.trim() ? (
            <p className="settings-hint">No workspace is open.</p>
          ) : manifest ? (
            <div className="settings-manifest">
              <div className="settings-manifest-row">
                <span className="settings-manifest-key">Name</span>
                <span className="settings-manifest-val">{manifest.name}</span>
              </div>
              <div className="settings-manifest-row">
                <span className="settings-manifest-key">Manifest version</span>
                <span className="settings-manifest-val">v{manifest.version}</span>
              </div>
              <div className="settings-manifest-row">
                <span className="settings-manifest-key">Video annotations</span>
                <span className="settings-manifest-val settings-manifest-path">{String(manifest.paths.video_annotations)}</span>
              </div>
              <div className="settings-manifest-row">
                <span className="settings-manifest-key">Video segments</span>
                <span className="settings-manifest-val settings-manifest-path">{String(manifest.paths.video_segments)}</span>
              </div>
              <div className="settings-manifest-row">
                <span className="settings-manifest-key">Logs</span>
                <span className="settings-manifest-val settings-manifest-path">{String(manifest.paths.logs)}</span>
              </div>
              <div className="settings-manifest-row">
                <span className="settings-manifest-key">Cache</span>
                <span className="settings-manifest-val settings-manifest-path">{String(manifest.paths.cache)}</span>
              </div>
              {migrated && (
                <div className="settings-manifest-row">
                  <span className="settings-manifest-key">Notice</span>
                  <span className="settings-manifest-val">Manifest upgraded this session.</span>
                </div>
              )}
            </div>
          ) : (
            <p className="settings-hint">
              {phase === "loading" ? "Loading workspace manifest…" : error || "Workspace manifest unavailable."}
            </p>
          )}
        </section>
      </div>
    </div>
  );
}
