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

export function ReviewHubPage({ active, onReady }: Props) {
  const { workspaceRoot, setActiveTab, setImageWorkspaceTab } = useWorkspace();

  useEffect(() => {
    onReady?.();
  }, [onReady]);

  if (!workspaceRoot.trim()) {
    return (
      <div className="review-hub-page">
        <div className="empty">
          <strong>Open a workspace to start reviewing.</strong>
        </div>
      </div>
    );
  }

  function openReviewQueue() {
    setActiveTab("image-pool");
    setImageWorkspaceTab("yolo");
  }

  function openInbox() {
    setActiveTab("image-pool");
    setImageWorkspaceTab("inbox");
  }

  return (
    <div className="review-hub-page">
      <div className="library-header">
        <h2 className="library-title">Review</h2>
        <p className="library-subtitle">Review annotated images and proposals</p>
      </div>
      <div className="library-sections">
        <button type="button" className="glass-card library-section-card" onClick={openReviewQueue}>
          <div className="library-section-icon">
            <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/>
            </svg>
          </div>
          <div className="library-section-main">
            <div className="library-section-title">Dataset Review</div>
            <div className="library-section-desc">Review labelled images, filter by class</div>
          </div>
          <ChevronRight />
        </button>

        <button type="button" className="glass-card library-section-card" onClick={openInbox}>
          <div className="library-section-icon">
            <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/>
              <path d="M5.45 5.11L2 12v6a2 2 0 002 2h16a2 2 0 002-2v-6l-3.45-6.89A2 2 0 0016.76 4H7.24a2 2 0 00-1.79 1.11z"/>
            </svg>
          </div>
          <div className="library-section-main">
            <div className="library-section-title">Inbox / Assign</div>
            <div className="library-section-desc">Process new images from the image pool</div>
          </div>
          <ChevronRight />
        </button>

        <div className="glass-card library-section-card library-section-card--soon">
          <div className="library-section-icon library-section-icon--muted">
            <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="10"/><path d="M12 8v4l3 3"/>
            </svg>
          </div>
          <div className="library-section-main">
            <div className="library-section-title">Proposal Queue <span className="library-badge">Soon</span></div>
            <div className="library-section-desc">Review and accept auto-label proposals</div>
          </div>
        </div>
      </div>
    </div>
  );
}
