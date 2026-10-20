/**
 * Shared view-model types for the unified Label Workbench.
 *
 * These are UI-facing adapter types — not storage formats.
 * YOLO label files, workspace manifest, and domain data models are unchanged.
 *
 * Phase 3A: type system + context infrastructure only.
 * Phase 3B: child pages (BoxLabelPage, VideoLabelPage) wire up to reportSourceSummary.
 */

// ---------------------------------------------------------------------------
// Enum-like literals
// ---------------------------------------------------------------------------

/** Which annotation task(s) are active in the current context. */
export type LabelTaskKind = "detect" | "classify" | "both";

/** Which surface the workbench is currently showing. */
export type LabelWorkbenchMode = "image" | "video";

/** How a child label surface is currently rendered. */
export type LabelWorkbenchRenderMode = "standalone" | "workbench-embedded";

/** Review state of the current source or frame. */
export type LabelReviewStatus = "unreviewed" | "approved" | "flagged" | "unknown";

export type LabelWorkbenchActionId =
  | "review.markReviewed"
  | "review.markEmpty"
  | "review.markJunk"
  | "review.clearRecord"
  | "proposal.acceptSelected"
  | "proposal.rejectSelected"
  | "proposal.acceptAll"
  | "proposal.rejectAll"
  | "video.randomNext"
  | "video.copyPreviousBoxes"
  | "classes.openManagement"
  | "export.open"
  | (string & {});

export type LabelWorkbenchAction = {
  id: LabelWorkbenchActionId;
  label: string;
  title?: string;
  disabled?: boolean;
  busy?: boolean;
  unavailableReason?: string;
  variant?: "default" | "primary" | "danger";
  run?: () => void | Promise<void>;
};

export type LabelWorkbenchActionGroup = {
  id: string;
  label: string;
  description?: string;
  items?: Array<{
    id: string;
    label: string;
    detail?: string;
    selected?: boolean;
    tone?: "default" | "muted" | "warning";
    run?: () => void | Promise<void>;
    onPause?: () => void | Promise<void>;
    onResume?: () => void | Promise<void>;
    onDelete?: () => void | Promise<void>;
  }>;
  actions: LabelWorkbenchAction[];
};

// ---------------------------------------------------------------------------
// Source summary  (populated by children via context in Phase 3B)
// ---------------------------------------------------------------------------

/** Summary for an image source. */
export type ImageSourceSummary = {
  kind: "image";
  totalImages: number;
  currentIndex: number | null;
  /** Basename of the current image file. */
  filename: string | null;
  reviewStatus: LabelReviewStatus;
};

/** Summary for a video-timestamp source. */
export type VideoTimestampSummary = {
  kind: "video-timestamp";
  /** Display name (filename without extension) of the loaded video. */
  videoName: string | null;
  /** Current playhead position in milliseconds. */
  timestampMs: number | null;
  /** Whether the detect task for this frame is reviewed. */
  reviewed: boolean;
  /** Whether a detect task exists on this frame. */
  hasDetectTask: boolean;
  /** Whether a classify task exists on this frame. */
  hasClfTask: boolean;
};

/** Discriminated union: the current source description. */
export type LabelSourceSummary = ImageSourceSummary | VideoTimestampSummary;

// ---------------------------------------------------------------------------
// Ancillary summaries
// ---------------------------------------------------------------------------

/** Auto-label proposal summary. */
export type LabelProposalSummary = {
  pendingCount: number;
  totalCount: number;
};

/** Blackout overlay summary. */
export type LabelOverlaySummary = {
  activeCount: number;
};

/** Video segment context attached to a video-timestamp source. */
export type LabelSegmentSummary = {
  label: string;
  startMs: number | null;
  endMs: number | null;
};

export type LabelClassSummary = {
  activeDetectCount?: number | null;
  totalDetectCount?: number | null;
  activeClassificationCount?: number | null;
  totalClassificationCount?: number | null;
  observedClassCount?: number | null;
};

export type LabelWorkbenchClassItem = {
  id?: number | null;
  key?: string | null;
  name: string;
  archived?: boolean;
};

export type LabelWorkbenchClassPalette = {
  detectClasses?: LabelWorkbenchClassItem[];
  classificationClasses?: LabelWorkbenchClassItem[];
  currentDetectClassId?: number | null;
  currentClassificationKey?: string | null;
  readOnlyReason?: string | null;
  onSelectDetectClass?: (classId: number) => void | Promise<void>;
};

export type LabelWorkbenchOption = {
  value: string;
  label: string;
};

export type LabelWorkbenchSamplingControl = {
  sourceLabel: string;
  segmentCount: number;
  mode: string;
  modeOptions: LabelWorkbenchOption[];
  minSpacingMs: number;
  onModeChange?: (value: string) => void | Promise<void>;
  onMinSpacingMsChange?: (value: number) => void | Promise<void>;
};

export type LabelSelectedProposalSummary = {
  id: string;
  classId?: number | null;
  classKey?: string | null;
  className?: string | null;
  confidence?: number | null;
  archived?: boolean;
};

export type LabelWorkbenchWarning = {
  id: string;
  label: string;
  detail?: string;
  tone?: "warning" | "danger" | "info";
};

export type LabelWorkbenchInspectorState = {
  taskKind?: LabelTaskKind;
  reviewStatus?: LabelReviewStatus;
  classSummary?: LabelClassSummary;
  classPalette?: LabelWorkbenchClassPalette | null;
  proposalSummary?: LabelProposalSummary | null;
  selectedProposal?: LabelSelectedProposalSummary | null;
  overlaySummary?: LabelOverlaySummary | null;
  segmentSummary?: LabelSegmentSummary | null;
  samplingControl?: LabelWorkbenchSamplingControl | null;
  timestampLabel?: string | null;
  sourceDetail?: string | null;
  warnings?: LabelWorkbenchWarning[];
};

// ---------------------------------------------------------------------------
// Workbench context value
// ---------------------------------------------------------------------------

/**
 * Value exposed by LabelWorkbenchContext.
 *
 * Phase 3A: children may read mode / call setMode.
 * Phase 3B: children call reportSourceSummary to surface live status to the shell.
 */
export type LabelWorkbenchContextValue = {
  mode: LabelWorkbenchMode;
  setMode: (mode: LabelWorkbenchMode) => void;
  renderMode?: LabelWorkbenchRenderMode;
  /**
   * Children call this to push their current source summary to the workbench header.
   * Pass null when the child has no active source (e.g. empty workspace).
   * Not wired in Phase 3A — infrastructure for Phase 3B.
   */
  reportSourceSummary?: (summary: LabelSourceSummary | null) => void;
  reportInspectorState?: (state: LabelWorkbenchInspectorState | null) => void;
  registerWorkbenchActions?: (groups: LabelWorkbenchActionGroup[] | null) => void;
  clearWorkbenchActions?: () => void;
  /** Inspector element that hosts the classification class panel (null until mounted). */
  classificationSlot?: HTMLElement | null;
};
