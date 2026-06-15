import type * as api from "../../api";
import type { MetadataRow } from "../image-pool/types";
import type { BoxLabelEntry } from "./boxLabelCore";
import type { FixedBoxSlot } from "./session";

export type UndoSnapshot =
  | {
      type: "labels";
      action: string;
      filename: string;
      boxes: api.LabelBox[];
      selectedBoxId: number | null;
      classId: number;
    }
  | {
      type: "batch-labels";
      action: string;
      snapshots: Array<{ filename: string; boxes: api.LabelBox[] }>;
    }
  | {
      type: "image";
      action: string;
      filename: string;
      imageBase64: string;
    };

export type BoxLabelViewProps = {
  workspaceRoot: string;
  datasetRoot: string;
  entry: BoxLabelEntry | null;
  entries: BoxLabelEntry[];
  currentIndex: number;
  selectedFilenames: Set<string>;
  shiftSelectedFilenames: Set<string>;
  onNavigate: (index: number) => void;
  initialShortcutSlots?: Array<number | null> | null;
  initialFixedBoxSlots?: Array<FixedBoxSlot | null> | null;
  initialPointerToolEnabled?: boolean;
  initialAutoFitEnabled?: boolean;
  onShortcutSlotsChange?: (slots: Array<number | null>, fixedSlots?: Array<FixedBoxSlot | null>) => void;
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
  onMarkJunk?: () => Promise<void>;
  onUndoJunk?: () => Promise<void>;
};
