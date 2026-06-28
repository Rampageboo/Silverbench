import { useEffect } from "react";
import { useWorkspace } from "../../app/useWorkspace";

// Export hub: primary nav entry for export. Wraps existing train-prep and video export.
// Phase 2 will add a unified export surface with presets.

type Props = {
  active?: boolean;
  onReady?: () => void;
};

export function ExportHubPage({ active, onReady }: Props) {
  const { workspaceRoot, setActiveTab } = useWorkspace();

  useEffect(() => {
    onReady?.();
  }, [onReady]);

  if (!workspaceRoot.trim()) {
    return (
      <div className="export-hub-page">
        <div className="empty">
          <strong>Open a workspace to export.</strong>
        </div>
      </div>
    );
  }

  return (
    <div className="export-hub-page">
      <div className="library-header">
        <h2 className="library-title">Export</h2>
        <p className="library-subtitle">Prepare and export datasets for training</p>
      </div>
      <div className="library-sections">
        <button
          type="button"
          className="glass-card library-section-card"
          onClick={() => setActiveTab("train-prep")}
        >
          <div className="library-section-icon">
            <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M6 4v16M18 4v16M6 12h12"/>
            </svg>
          </div>
          <div>
            <div className="library-section-title">Dataset Prep</div>
            <div className="library-section-desc">Split detect/classify datasets and generate data.yaml</div>
          </div>
        </button>

        <button
          type="button"
          className="glass-card library-section-card"
          onClick={() => setActiveTab("train")}
        >
          <div className="library-section-icon">
            <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 3l2.2 6.8H21l-5.6 4.1 2.1 6.6L12 16.3l-5.5 4.2 2.1-6.6L3 9.8h6.8z"/>
            </svg>
          </div>
          <div>
            <div className="library-section-title">Auto Label</div>
            <div className="library-section-desc">Run detection or classification with a trained model</div>
          </div>
        </button>

        <button
          type="button"
          className="glass-card library-section-card"
          onClick={() => setActiveTab("video-capture")}
        >
          <div className="library-section-icon">
            <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
              <polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
            </svg>
          </div>
          <div>
            <div className="library-section-title">Video Export</div>
            <div className="library-section-desc">Export frame samples from video segments</div>
          </div>
        </button>
      </div>
    </div>
  );
}
