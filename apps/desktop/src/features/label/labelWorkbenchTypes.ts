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

/** What kind of source is being labeled. */
export type LabelSourceKind = "image" | "video-timestamp";

/** Which annotation task(s) are active in the current context. */
export type LabelTaskKind = "detect" | "classify" | "both";

/** Which surface the workbench is currently showing. */
export type LabelWorkbenchMode = "image" | "video";

/** Review state of the current source or frame. */
export type LabelReviewStatus = "unreviewed" | "approved" | "flagged" | "unknown";

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
  /**
   * Children call this to push their current source summary to the workbench header.
   * Pass null when the child has no active source (e.g. empty workspace).
   * Not wired in Phase 3A — infrastructure for Phase 3B.
   */
  reportSourceSummary: (summary: LabelSourceSummary | null) => void;
};
