import { useEffect } from "react";
import { useWorkspace } from "../../app/useWorkspace";

type Props = {
  active?: boolean;
  onReady?: () => void;
};

export function LibraryPage({ onReady }: Props) {
  const { workspaceRoot, setActiveTab } = useWorkspace();

  useEffect(() => {
    onReady?.();
  }, [onReady]);

  if (!workspaceRoot.trim()) {
    return (
      <div className="library-page library-page--empty">
        <div className="empty">
          <strong>Open a workspace to view the library.</strong>
        </div>
      </div>
    );
  }

  return (
    <div className="library-page">
      <div className="library-header">
        <h2 className="library-title">Library</h2>
        <p className="library-subtitle">{workspaceRoot}</p>
      </div>
      <div className="library-sections">
        <button
          type="button"
          className="glass-card library-section-card"
          onClick={() => setActiveTab("image-pool")}
        >
          <div className="library-section-icon">
            <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="3" y="4" width="8" height="8" rx="1.5"/><rect x="13" y="4" width="8" height="8" rx="1.5"/>
              <rect x="3" y="14" width="8" height="8" rx="1.5"/><rect x="13" y="14" width="8" height="8" rx="1.5"/>
            </svg>
          </div>
          <div>
            <div className="library-section-title">Image Pool</div>
            <div className="library-section-desc">Browse and manage images in the workspace</div>
          </div>
        </button>

        <button
          type="button"
          className="glass-card library-section-card"
          onClick={() => setActiveTab("video-capture")}
        >
          <div className="library-section-icon">
            <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="3" y="6" width="13" height="12" rx="2"/><path d="M16 10l5-3v10l-5-3"/>
              <line x1="7" y1="20" x2="17" y2="20"/><line x1="12" y1="18" x2="12" y2="22"/>
            </svg>
          </div>
          <div>
            <div className="library-section-title">Video Segments</div>
            <div className="library-section-desc">Manage video sources and segment annotations</div>
          </div>
        </button>

        <div className="glass-card library-section-card library-section-card--soon">
          <div className="library-section-icon library-section-icon--muted">
            <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="4"/><path d="M2 12h3M19 12h3M12 2v3M12 19v3"/>
            </svg>
          </div>
          <div>
            <div className="library-section-title">Classes <span className="library-badge">Soon</span></div>
            <div className="library-section-desc">Manage detection and classification classes</div>
          </div>
        </div>
      </div>
    </div>
  );
}
