/**
 * View-model types for the label workbench inspector and review actions.
 *
 * These are UI-facing adapter types — not storage formats.
 * YOLO label files, workspace manifest, and domain data models are unchanged.
 */

// ---------------------------------------------------------------------------
// Enum-like literals
// ---------------------------------------------------------------------------

/** Which annotation task(s) are active in the current context. */
export type LabelTaskKind = "detect" | "classify" | "both";

/** Which surface the workbench is currently showing. */
export type LabelWorkbenchMode = "image" | "video";

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
