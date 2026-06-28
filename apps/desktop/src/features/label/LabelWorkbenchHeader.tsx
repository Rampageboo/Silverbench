import type { LabelSourceKind, LabelSourceSummary, LabelTaskKind, LabelWorkbenchMode } from "./labelWorkbenchTypes";

// ---------------------------------------------------------------------------
// Helpers: derive product-level context from mode
// ---------------------------------------------------------------------------

function sourceKindFromMode(mode: LabelWorkbenchMode): LabelSourceKind {
  return mode === "image" ? "image" : "video-timestamp";
}

function taskKindFromMode(mode: LabelWorkbenchMode): LabelTaskKind {
  // Video annotation supports both detect and classify layers.
  // Image (box label) is detect-focused.
  return mode === "video" ? "both" : "detect";
}

function sourceKindLabel(kind: LabelSourceKind): string {
  return kind === "image" ? "Image source" : "Video timestamp";
}

// ---------------------------------------------------------------------------
// LabelModeSwitch
// ---------------------------------------------------------------------------

type ModeSwitchProps = {
  mode: LabelWorkbenchMode;
  onChange: (mode: LabelWorkbenchMode) => void;
};

function LabelModeSwitch({ mode, onChange }: ModeSwitchProps) {
  return (
    <div className="lwb-mode-switch" role="tablist" aria-label="Label source type">
      <button
        type="button"
        role="tab"
        aria-selected={mode === "video"}
        className={`lwb-mode-tab${mode === "video" ? " active" : ""}`}
        onClick={() => onChange("video")}
      >
        <svg className="lwb-mode-icon" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="3" y="6" width="13" height="12" rx="2"/><path d="M16 10l5-3v10l-5-3"/>
        </svg>
        Video
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={mode === "image"}
        className={`lwb-mode-tab${mode === "image" ? " active" : ""}`}
        onClick={() => onChange("image")}
      >
        <svg className="lwb-mode-icon" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="4" y="5" width="16" height="14" rx="2"/>
          <circle cx="8.5" cy="9.5" r="1.5" fill="currentColor" stroke="none"/>
          <path d="M20 15l-4-4-8 8"/>
        </svg>
        Image
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// LabelSourceBadge
// ---------------------------------------------------------------------------

type SourceBadgeProps = { kind: LabelSourceKind };

function LabelSourceBadge({ kind }: SourceBadgeProps) {
  return (
    <span className="lwb-source-badge">
      {kind === "image" ? (
        <svg viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="2" y="3" width="12" height="10" rx="1.5"/>
          <circle cx="5.5" cy="6.5" r="1" fill="currentColor" stroke="none"/>
          <path d="M14 11l-3-3-5 5"/>
        </svg>
      ) : (
        <svg viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="2" y="4" width="9" height="8" rx="1.5"/><path d="M11 7l4-2v6l-4-2"/>
        </svg>
      )}
      {sourceKindLabel(kind)}
    </span>
  );
}

// ---------------------------------------------------------------------------
// LabelTaskChips
// ---------------------------------------------------------------------------

type TaskChipsProps = { taskKind: LabelTaskKind };

const TASK_LABELS: Record<"detect" | "classify", string> = {
  detect: "Detect",
  classify: "Classify"
};

function LabelTaskChips({ taskKind }: TaskChipsProps) {
  const tasks: Array<"detect" | "classify"> =
    taskKind === "both" ? ["detect", "classify"] : ["detect"];
  return (
    <div className="lwb-task-chips" aria-label="Active annotation tasks">
      {tasks.map((t) => (
        <span key={t} className="lwb-task-chip lwb-task-chip--active">
          {TASK_LABELS[t]}
        </span>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// LabelSourceSummaryBar  (Phase 3A: shows live data when children report it)
// ---------------------------------------------------------------------------

type SummaryBarProps = { summary: LabelSourceSummary };

function LabelSourceSummaryBar({ summary }: SummaryBarProps) {
  if (summary.kind === "image") {
    const { totalImages, currentIndex, filename, reviewStatus } = summary;
    return (
      <div className="lwb-summary-bar">
        {filename && <span className="lwb-summary-item lwb-summary-filename" title={filename}>{filename}</span>}
        {totalImages > 0 && currentIndex !== null && (
          <span className="lwb-summary-item lwb-summary-count">{currentIndex + 1} / {totalImages}</span>
        )}
        {reviewStatus !== "unknown" && reviewStatus !== "unreviewed" && (
          <span className={`lwb-summary-item lwb-review-chip lwb-review-chip--${reviewStatus}`}>
            {reviewStatus === "approved" ? "Reviewed" : "Flagged"}
          </span>
        )}
      </div>
    );
  }

  if (summary.kind === "video-timestamp") {
    const { videoName, timestampMs, reviewed, hasDetectTask, hasClfTask } = summary;
    const clock = timestampMs !== null ? formatMs(timestampMs) : null;
    return (
      <div className="lwb-summary-bar">
        {videoName && <span className="lwb-summary-item lwb-summary-filename" title={videoName}>{videoName}</span>}
        {clock !== null && <span className="lwb-summary-item lwb-summary-clock">{clock}</span>}
        {reviewed && <span className="lwb-summary-item lwb-review-chip lwb-review-chip--approved">Reviewed</span>}
      </div>
    );
  }

  return null;
}

function formatMs(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

// ---------------------------------------------------------------------------
// LabelWorkbenchHeader (main export)
// ---------------------------------------------------------------------------

type HeaderProps = {
  mode: LabelWorkbenchMode;
  onModeChange: (mode: LabelWorkbenchMode) => void;
  workspaceName: string;
  workspacePath: string;
  sourceSummary: LabelSourceSummary | null;
};

export function LabelWorkbenchHeader({
  mode,
  onModeChange,
  workspaceName,
  workspacePath,
  sourceSummary
}: HeaderProps) {
  const sourceKind = sourceKindFromMode(mode);
  const taskKind = taskKindFromMode(mode);

  return (
    <div className="lwb-header" role="toolbar" aria-label="Label workbench controls">
      {/* Left: mode switch */}
      <div className="lwb-section lwb-section--mode">
        <LabelModeSwitch mode={mode} onChange={onModeChange} />
      </div>

      {/* Center: source context */}
      <div className="lwb-section lwb-section--source">
        <LabelSourceBadge kind={sourceKind} />
        <LabelTaskChips taskKind={taskKind} />
        {sourceSummary && <LabelSourceSummaryBar summary={sourceSummary} />}
      </div>

      {/* Right: workspace */}
      <div className="lwb-section lwb-section--workspace">
        <span className="lwb-workspace-name" title={workspacePath}>{workspaceName}</span>
      </div>
    </div>
  );
}
