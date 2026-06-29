import type { ReactNode } from "react";
import type * as api from "../../api";
import type { MetadataRow } from "../image-pool/types";
import type { DetectProposal } from "../video/videoAnnotationApi";
import type { BoxLabelEntry } from "./boxLabelCore";
import type { BoxLabelShortcutSlot, FixedBoxSlot } from "./session";

export type BoxLabelDuplicateFlow = {
  active: boolean;
  paused: boolean;
  className: string | null;
  frameIndex: number | null;
  currentBoxIndex: number | null;
  items: Array<{
    id: string;
    classId: number;
    className: string;
    x: number;
    y: number;
    w: number;
    h: number;
    frameIndex: number | null;
    currentBoxIndex: number | null;
    paused: boolean;
    selected: boolean;
  }>;
  canStart: boolean;
  canPause: boolean;
  canResume: boolean;
  canDelete: boolean;
  message: string;
};

export type BoxLabelWorkbenchBridge = {
  proposalCount: number;
  activeProposalCount: number;
  selectedProposalId: string | null;
  selectedProposalArchived: boolean;
  selectedProposalClassId: number | null;
  selectedProposalClassKey: string | null;
  selectedProposalClassName: string | null;
  selectedProposalConfidence: number | null;
  activeDetectClasses: Array<{ id: number; name: string }>;
  currentClassId: number | null;
  acceptSelectedProposal: (() => void) | null;
  rejectSelectedProposal: (() => void) | null;
  acceptAllProposals: () => void;
  rejectAllProposals: () => void;
  duplicateFlow: BoxLabelDuplicateFlow | null;
  startDuplicateToNext: (() => void) | null;
  selectDuplicateItem: ((id: string) => void) | null;
  pauseDuplicateFlow: (() => void) | null;
  resumeDuplicateFlow: (() => void) | null;
  deleteDuplicateFlow: (() => void) | null;
};

export type BoxLabelAutoLabelResult = {
  total: number;
  boxesAdded: number;
  proposalsAdded: number;
  skipped: number;
  ignored: number;
};

export type BoxLabelAutoLabelOptions = {
  highConfidence?: number;
  proposalConfidence?: number;
  modelId?: string;
  persistProposals?: boolean;
};

export type BoxLabelCanvasOverlayContext = {
  entry: BoxLabelEntry | null;
  entries: BoxLabelEntry[];
  currentIndex: number;
  boxes: api.LabelBox[];
  proposals: DetectProposal[];
  activeDetectClasses: Array<{ id: number; name: string }>;
  classificationClasses: Array<{ key: string; name: string; archived?: boolean }>;
  currentClassificationKey: string | null;
  addProposals: (
    proposals: DetectProposal[],
    options?: { replace?: boolean; statusMessage?: string }
  ) => Promise<{ added: number; skipped: number }>;
  applyAutoLabelPredictions: (
    target: BoxLabelEntry,
    predictions: api.PtDetectPrediction[],
    options?: BoxLabelAutoLabelOptions
  ) => Promise<BoxLabelAutoLabelResult>;
  assignClassificationClass?: (classKey: string | null, basename?: string) => Promise<void>;
  reloadWorkspaceClasses?: () => Promise<void>;
};

export type BoxLabelCanvasOverlay =
  | ReactNode
  | ((context: BoxLabelCanvasOverlayContext) => ReactNode);

export type BoxLabelViewProps = {
  workspaceRoot: string;
  datasetRoot: string;
  mediaDir?: string;
  entry: BoxLabelEntry | null;
  entries: BoxLabelEntry[];
  currentIndex: number;
  selectedFilenames: Set<string>;
  shiftSelectedFilenames: Set<string>;
  onNavigate: (index: number) => void;
  onNavigateBoundary?: (delta: -1 | 1) => void;
  showSideStack?: boolean;
  initialShortcutSlots?: Array<BoxLabelShortcutSlot | null> | null;
  initialFixedBoxSlots?: Array<FixedBoxSlot | null> | null;
  initialPointerToolEnabled?: boolean;
  initialAutoFitEnabled?: boolean;
  onShortcutSlotsChange?: (slots: Array<BoxLabelShortcutSlot | null>, fixedSlots?: Array<FixedBoxSlot | null>) => void;
  onToolStateChange?: (pointerToolEnabled: boolean, autoFitEnabled: boolean) => void;
  includeClasses: Set<number>;
  excludeClasses: Set<number>;
  imageViewMode: "all" | "hideReviewed" | "flagged";
  metadata: Map<string, MetadataRow>;
  classImageCounts: Map<number, number>;
  onAddIncludeClass: (classId: number) => void;
  onAddExcludeClass: (classId: number) => void;
  onClearClassFilters: () => void;
  onImageViewModeChange: (mode: "all" | "hideReviewed" | "flagged") => void;
  onToggleReviewed: () => Promise<void>;
  onToggleFlagged: () => Promise<void>;
  onLabelsChanged: (filename: string, boxes: api.LabelBox[]) => void;
  onMetadataChanged?: () => Promise<void>;
  onStatusText?: (text: string) => void;
  onWorkbenchBridgeChange?: (bridge: BoxLabelWorkbenchBridge | null) => void;
  onMarkJunk?: () => Promise<void>;
  onUndoJunk?: () => Promise<void>;
  classificationClasses?: Array<{ key: string; name: string; archived?: boolean }>;
  classificationClassesBusy?: boolean;
  classificationClassesStatus?: string;
  classificationClassesPortalId?: string;
  currentClassificationKey?: string | null;
  onAssignClassificationClass?: (classKey: string | null, basename?: string) => Promise<void>;
  onAddClassificationClass?: (name: string) => Promise<string | null>;
  onWorkspaceClassesChanged?: () => Promise<void>;
  canvasOverlay?: BoxLabelCanvasOverlay;
};
