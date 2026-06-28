import { useEffect } from "react";
import { useWorkspace } from "../../app/useWorkspace";

type Props = {
  active?: boolean;
  onReady?: () => void;
};

const ChevronRight = () => (
  <svg className="library-section-chevron" viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M6 3l5 5-5 5"/>
  </svg>
);

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
            <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="3" y="3" width="7" height="18" rx="1"/><rect x="14" y="3" width="7" height="18" rx="1"/>
              <line x1="10" y1="12" x2="14" y2="12"/>
            </svg>
          </div>
          <div className="library-section-main">
            <div className="library-section-title">Dataset Prep</div>
            <div className="library-section-desc">Split detect/classify datasets and generate data.yaml</div>
          </div>
          <ChevronRight />
        </button>

        <button
          type="button"
          className="glass-card library-section-card"
          onClick={() => setActiveTab("train")}
        >
          <div className="library-section-icon">
            <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
            </svg>
          </div>
          <div className="library-section-main">
            <div className="library-section-title">Auto Label</div>
            <div className="library-section-desc">Run detection or classification with a trained model</div>
          </div>
          <ChevronRight />
        </button>

        <button
          type="button"
          className="glass-card library-section-card"
          onClick={() => setActiveTab("video-capture")}
        >
          <div className="library-section-icon">
            <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
              <polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
            </svg>
          </div>
          <div className="library-section-main">
            <div className="library-section-title">Video Export</div>
            <div className="library-section-desc">Export frame samples from video segments</div>
          </div>
          <ChevronRight />
        </button>
      </div>
    </div>
  );
}
