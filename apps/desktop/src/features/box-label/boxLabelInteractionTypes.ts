import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import * as api from "../../api";
import type { BoxLabelEntry } from "./boxLabelCore";
import type { BoxLabelDuplicateFlow } from "./boxLabelTypes";
import type { BoxAdjustMode, DragState, ProposalShape, ToolMode } from "./geometry";

export type UseBoxLabelInteractionOptions = {
  workspaceRoot: string;
  datasetRoot: string;
  mediaImagePath: string;
  entry: BoxLabelEntry | null;
  entries: BoxLabelEntry[];
  currentIndex: number;
  filename: string;
  onNavigate: (index: number) => void;
  onNavigateBoundary?: (delta: -1 | 1) => void;
  onToggleReviewed: () => Promise<void>;
  onToggleFlagged: () => Promise<void>;
  onMarkJunk?: () => Promise<void>;
  onUndoJunk?: () => Promise<void>;
  onLabelsChanged: (basename: string, boxes: api.LabelBox[]) => void;
  persistEntryLabels: (target: BoxLabelEntry, nextBoxes: api.LabelBox[]) => Promise<api.LabelBox[]>;
  boxesRef: MutableRefObject<api.LabelBox[]>;
  selectedRef: MutableRefObject<number | null>;
  classRef: MutableRefObject<number>;
  dragRef: MutableRefObject<DragState>;
  modeRef: MutableRefObject<ToolMode>;
  showGridRef: MutableRefObject<boolean>;
  boxAdjustModeRef: MutableRefObject<BoxAdjustMode>;
  classesRef: MutableRefObject<api.LabelClass[]>;
  pointerToolEnabled: boolean;
  autoFitEnabled: boolean;
  blackBoxEnabled: boolean;
  fixedBoxSlots: Array<api.LabelBox | null>;
  setCurrentClass: (classId: number) => void;
  setClassSearch: (search: string) => void;
  archivedDetectIdsRef?: MutableRefObject<Set<number>>;
  setBoxAdjustMode: (mode: BoxAdjustMode) => void;
  recordFixedBoxFromBox: (box: api.LabelBox) => string;
  selectClassShortcut: (slot: number, useSlot?: boolean) => void;
  togglePointerTool: () => void;
  toggleAutoFitTool: () => void;
  toggleBlackBoxTool: () => void;
  pushUndo: (action: string) => void;
  pushImageUndo: (action: string, imageBase64: string) => void;
  undoLast: () => Promise<void>;
  redoLast: () => Promise<void>;
  syncBoxToSelected: (
    box: api.LabelBox | undefined,
    action: string,
    options?: { pushUndo?: boolean }
  ) => Promise<number>;
  copySelectedBoxToNext: () => Promise<void>;
  advanceDuplicateToNext: () => Promise<void>;
  trackCsrtForward: () => Promise<void>;
  duplicateFlow: BoxLabelDuplicateFlow;
  setBoxes: (boxes: api.LabelBox[]) => void;
  setSelectedBoxId: (id: number | null) => void;
  setStatus: (status: string) => void;
  setError: (status: string) => void;
  setImageVersion: Dispatch<SetStateAction<number>>;
  proposalsRef?: MutableRefObject<ProposalShape[]>;
  selectedProposalIdRef?: MutableRefObject<string | null>;
  setSelectedProposalId?: (id: string | null) => void;
  onMaterializeProposal?: (proposalId: string) => Promise<void>;
};
