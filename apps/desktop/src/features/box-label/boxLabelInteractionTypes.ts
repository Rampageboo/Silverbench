import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import * as api from "../../api";
import type { BoxLabelEntry } from "./boxLabelCore";
import type { BoxAdjustMode, DragState, ToolMode } from "./geometry";

export type UseBoxLabelInteractionOptions = {
  workspaceRoot: string;
  datasetRoot: string;
  entry: BoxLabelEntry | null;
  entries: BoxLabelEntry[];
  currentIndex: number;
  filename: string;
  onNavigate: (index: number) => void;
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
  trackCsrtForward: () => Promise<void>;
  setBoxes: (boxes: api.LabelBox[]) => void;
  setSelectedBoxId: (id: number | null) => void;
  setStatus: (status: string) => void;
  setError: (status: string) => void;
  setImageVersion: Dispatch<SetStateAction<number>>;
};
