import { useCallback, useEffect, useState } from "react";
import { loadLabelClasses, readTextFile } from "../../api";
import { normalizeClassesManifest } from "../video/classDomain";
import { useWorkspace } from "../../app/useWorkspace";
import {
  workspaceClassSummary,
  workspaceClassSummaryFromLegacy,
  type WorkspaceClassSummary,
} from "../workspace/workspaceClassTaxonomy";

type Props = {
  active?: boolean;
  onReady?: () => void;
};

type LibraryView = "overview" | "classes";

const ChevronRight = () => (
  <svg className="library-section-chevron" viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M6 3l5 5-5 5"/>
  </svg>
);

// ---------------------------------------------------------------------------
// WorkspaceClassesView
// ---------------------------------------------------------------------------

type TaskBadgeProps = { taskType: WorkspaceClassSummary["taskType"] };

const TASK_LABELS: Record<WorkspaceClassSummary["taskType"], string> = {
  detect: "Detect",
  classify: "Classify",
  both: "Detect + Classify",
};

function TaskBadge({ taskType }: TaskBadgeProps) {
  return (
    <span className={`library-task-badge library-task-badge--${taskType}`}>
      {TASK_LABELS[taskType]}
    </span>
  );
}

type WorkspaceClassesViewProps = {
  summary: WorkspaceClassSummary | null;
  loading: boolean;
  onBack: () => void;
};

function WorkspaceClassesView({ summary, loading, onBack }: WorkspaceClassesViewProps) {
  return (
    <div className="library-classes-detail">
      <div className="library-classes-header">
        <button type="button" className="library-classes-back glass-btn glass-btn--sm" onClick={onBack}>
          <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M10 3L5 8l5 5"/>
          </svg>
          Library
        </button>
        <h3 className="library-classes-title">Classes</h3>
        {summary && <TaskBadge taskType={summary.taskType} />}
      </div>

      {loading && (
        <div className="library-classes-loading">
          <span className="page-loading-spinner" aria-hidden="true" />
          Loading classes…
        </div>
      )}

      {!loading && !summary && (
        <div className="library-classes-empty">
          No class information found for this workspace.
        </div>
      )}

      {!loading && summary && (
        <div className="library-classes-body">
          {/* Detect classes */}
          {summary.taskType !== "classify" && (
            <div className="library-class-group">
              <div className="library-class-group-header">
                <span className="library-class-group-title">Detect Classes</span>
                <span className="library-class-group-count">{summary.detectClassCount}</span>
              </div>
              {summary.detectClassCount === 0 ? (
                <p className="library-class-empty">No detect classes — using default "object" class.</p>
              ) : (
                <div className="library-detect-list">
                  {summary.detectClassNames.map((name, i) => (
                    <div key={i} className="library-detect-item">
                      <span className="library-detect-id">{i}</span>
                      <span className="library-detect-name">{name}</span>
                    </div>
                  ))}
                </div>
              )}
              <p className="library-class-note">
                YOLO class ID = list position. Do not reorder after creating labels.
              </p>
            </div>
          )}

          {/* Classification classes */}
          {summary.taskType !== "detect" && (
            <div className="library-class-group">
              <div className="library-class-group-header">
                <span className="library-class-group-title">Classification Classes</span>
                <span className="library-class-group-count">{summary.clfClassCount}</span>
              </div>
              {summary.clfClassCount === 0 ? (
                <p className="library-class-empty">No classification classes defined.</p>
              ) : (
                <div className="library-clf-list">
                  {summary.clfClassNames.map((name, i) => (
                    <div key={i} className="library-clf-item">
                      <span className="library-clf-name">{name}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <p className="library-class-readonly-note">
            Class editing is read-only in this release. Update classes by editing
            <code className="library-class-code">workspace/classes.json</code> or
            <code className="library-class-code">classes.txt</code> directly.
          </p>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// LibraryPage
// ---------------------------------------------------------------------------

export function LibraryPage({ onReady }: Props) {
  const { workspaceRoot, setActiveTab } = useWorkspace();
  const [view, setView] = useState<LibraryView>("overview");
  const [classSummary, setClassSummary] = useState<WorkspaceClassSummary | null>(null);
  const [classesLoading, setClassesLoading] = useState(false);

  useEffect(() => {
    onReady?.();
  }, [onReady]);

  // Reset to overview when workspace changes.
  useEffect(() => {
    setView("overview");
    setClassSummary(null);
  }, [workspaceRoot]);

  const loadClasses = useCallback(async () => {
    const root = workspaceRoot.trim();
    if (!root) return;
    setClassesLoading(true);
    try {
      // Prefer workspace/classes.json (new system).
      let summary: WorkspaceClassSummary | null = null;
      try {
        const text = await readTextFile(root, "workspace/classes.json");
        const manifest = normalizeClassesManifest(JSON.parse(text));
        summary = workspaceClassSummary(manifest);
      } catch {
        // Fall back to legacy /api/labels/classes (classes.txt / data.yaml).
        try {
          const legacy = await loadLabelClasses(root);
          summary = workspaceClassSummaryFromLegacy(legacy);
        } catch {
          summary = null;
        }
      }
      setClassSummary(summary);
    } finally {
      setClassesLoading(false);
    }
  }, [workspaceRoot]);

  function handleClassesClick() {
    setView("classes");
    void loadClasses();
  }

  if (!workspaceRoot.trim()) {
    return (
      <div className="library-page library-page--empty">
        <div className="empty">
          <strong>Open a workspace to view the library.</strong>
        </div>
      </div>
    );
  }

  if (view === "classes") {
    return (
      <div className="library-page">
        <WorkspaceClassesView
          summary={classSummary}
          loading={classesLoading}
          onBack={() => setView("overview")}
        />
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
            <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="3" y="4" width="8" height="8" rx="1.5"/><rect x="13" y="4" width="8" height="8" rx="1.5"/>
              <rect x="3" y="14" width="8" height="8" rx="1.5"/><rect x="13" y="14" width="8" height="8" rx="1.5"/>
            </svg>
          </div>
          <div className="library-section-main">
            <div className="library-section-title">Image Pool</div>
            <div className="library-section-desc">Browse and manage images in the workspace</div>
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
              <rect x="3" y="6" width="13" height="12" rx="2"/><path d="M16 10l5-3v10l-5-3"/>
            </svg>
          </div>
          <div className="library-section-main">
            <div className="library-section-title">Video Segments</div>
            <div className="library-section-desc">Manage video sources and segment annotations</div>
          </div>
          <ChevronRight />
        </button>

        <button
          type="button"
          className="glass-card library-section-card"
          onClick={handleClassesClick}
        >
          <div className="library-section-icon">
            <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="3"/><path d="M2 12h3M19 12h3M12 2v3M12 19v3"/>
            </svg>
          </div>
          <div className="library-section-main">
            <div className="library-section-title">Classes</div>
            <div className="library-section-desc">View detection and classification class setup</div>
          </div>
          <ChevronRight />
        </button>
      </div>
    </div>
  );
}
