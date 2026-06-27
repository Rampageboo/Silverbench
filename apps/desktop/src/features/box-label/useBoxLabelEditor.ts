import { useCallback, useEffect, useRef, useState } from "react";
import * as api from "../../api";
import { errMessage } from "../../lib/errors";
import { datasetImageUrl, invalidateDatasetImageUrl } from "../dataset-review/datasetAssets";
import { loadMetadataMap } from "../image-pool/metadata";
import type { MetadataRow } from "../image-pool/types";
import { loadEntryLabels, saveEntryLabels, type BoxLabelEntry } from "./boxLabelCore";
import type { BoxLabelViewProps } from "./boxLabelTypes";
import { findNearestBoxIndex, loadCanvasImage, type BoxAdjustMode, type DragState } from "./geometry";
import { useBoxLabelClasses } from "./useBoxLabelClasses";
import { useBoxLabelInteraction } from "./useBoxLabelInteraction";
import { useBoxTracking } from "./useBoxTracking";
import { useBoxUndo } from "./useBoxUndo";

export function useBoxLabelEditor({
  workspaceRoot,
  datasetRoot,
  entry,
  entries,
  currentIndex,
  selectedFilenames,
  shiftSelectedFilenames,
  onNavigate,
  initialShortcutSlots = null,
  initialFixedBoxSlots = null,
  initialPointerToolEnabled = false,
  initialAutoFitEnabled = false,
  onShortcutSlotsChange,
  onToolStateChange,
  includeClasses,
  excludeClasses,
  imageViewMode,
  metadata: _metadata,
  onAddIncludeClass,
  onAddExcludeClass,
  onClearClassFilters,
  onImageViewModeChange: _onImageViewModeChange,
  onToggleReviewed,
  onToggleFlagged,
  onLabelsChanged,
  onMetadataChanged: _onMetadataChanged,
  onStatusText,
  onMarkJunk,
  onUndoJunk
}: BoxLabelViewProps) {
  const boxesRef = useRef<api.LabelBox[]>([]);
  const selectedRef = useRef<number | null>(null);
  const classRef = useRef(0);
  const dragRef = useRef<DragState>(null);
  const showGridRef = useRef(true);
  const boxAdjustModeRef = useRef<BoxAdjustMode>("grow");
  const selectedFilenamesRef = useRef(selectedFilenames);
  const shiftSelectedFilenamesRef = useRef(shiftSelectedFilenames);
  const scheduleDrawRef = useRef<() => void>(() => {});
  const persistLabelsRef = useRef<(statusMessage?: string) => Promise<void>>(async () => {});
  const classesSetCurrentClassRef = useRef<(classId: number) => void>(() => {});

  const [boxes, setBoxes] = useState<api.LabelBox[]>([]);
  const [selectedBoxId, setSelectedBoxId] = useState<number | null>(null);
  const [showGrid] = useState(true);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [tracking, setTracking] = useState(false);
  const [imageVersion, setImageVersion] = useState(0);
  const metadataRef = useRef<Map<string, MetadataRow>>(new Map());
  const filename = entry?.basename || "";
  const entryImagePath = entry?.imagePath ?? "";

  const scheduleDraw = useCallback(() => scheduleDrawRef.current(), []);
  const persistLabelsProxy = useCallback(
    (statusMessage?: string) => persistLabelsRef.current(statusMessage),
    []
  );

  const findEntryByBasename = useCallback(
    (basename: string) => entries.find((item) => item.basename === basename) || null,
    [entries]
  );

  const persistEntryLabels = useCallback(
    async (target: BoxLabelEntry, nextBoxes: api.LabelBox[]) => {
      await saveEntryLabels(datasetRoot, target, nextBoxes);
      onLabelsChanged(target.basename, nextBoxes);
      return nextBoxes;
    },
    [datasetRoot, onLabelsChanged]
  );

  const { pushUndo, pushImageUndo, pushBatchUndo, undoLast, redoLast } = useBoxUndo({
    filename,
    entry,
    persistEntryLabels,
    boxesRef,
    selectedRef,
    classRef,
    setBoxes,
    setSelectedBoxId,
    setCurrentClass: (classId) => classesSetCurrentClassRef.current(classId),
    setStatus,
    scheduleDraw
  });

  const labelClasses = useBoxLabelClasses({
    datasetRoot,
    workspaceRoot,
    initialShortcutSlots,
    initialFixedBoxSlots,
    initialPointerToolEnabled,
    initialAutoFitEnabled,
    onShortcutSlotsChange,
    onToolStateChange,
    boxesRef,
    selectedRef,
    classRef,
    dragRef,
    pushUndo,
    persistLabels: persistLabelsProxy,
    scheduleDraw,
    setBoxes,
    setStatus
  });

  classesSetCurrentClassRef.current = labelClasses.setCurrentClass;

  const { pendingBoxSelectionRef, pendingNearestBoxRef, syncBoxToSelected, copySelectedBoxToNext, trackCsrtForward } =
    useBoxTracking({
      datasetRoot,
      entry,
      filename,
      entries,
      currentIndex,
      classes: labelClasses.classes,
      boxesRef,
      selectedRef,
      shiftSelectedFilenamesRef,
      persistEntryLabels,
      onNavigate,
      setSelectedBoxId,
      setCurrentClass: labelClasses.setCurrentClass,
      setTracking,
      setStatus,
      pushBatchUndo
    });

  const interaction = useBoxLabelInteraction({
    workspaceRoot,
    datasetRoot,
    entry,
    entries,
    currentIndex,
    filename,
    onNavigate,
    onToggleReviewed,
    onToggleFlagged,
    onMarkJunk,
    onUndoJunk,
    onLabelsChanged,
    persistEntryLabels,
    boxesRef,
    selectedRef,
    classRef,
    dragRef,
    modeRef: labelClasses.modeRef,
    showGridRef,
    boxAdjustModeRef,
    classesRef: labelClasses.classesRef,
    pointerToolEnabled: labelClasses.pointerToolEnabled,
    autoFitEnabled: labelClasses.autoFitEnabled,
    blackBoxEnabled: labelClasses.blackBoxEnabled,
    fixedBoxSlots: labelClasses.fixedBoxSlots,
    setCurrentClass: labelClasses.setCurrentClass,
    setBoxAdjustMode: labelClasses.setBoxAdjustMode,
    recordFixedBoxFromBox: labelClasses.recordFixedBoxFromBox,
    selectClassShortcut: labelClasses.selectClassShortcut,
    togglePointerTool: labelClasses.togglePointerTool,
    toggleAutoFitTool: labelClasses.toggleAutoFitTool,
    toggleBlackBoxTool: labelClasses.toggleBlackBoxTool,
    pushUndo,
    pushImageUndo,
    undoLast,
    redoLast,
    syncBoxToSelected,
    copySelectedBoxToNext,
    trackCsrtForward,
    setBoxes,
    setSelectedBoxId,
    setStatus,
    setError,
    setImageVersion
  });

  scheduleDrawRef.current = interaction.scheduleDraw;
  persistLabelsRef.current = interaction.persistLabels;

  useEffect(() => {
    selectedFilenamesRef.current = selectedFilenames;
    shiftSelectedFilenamesRef.current = shiftSelectedFilenames;
  }, [selectedFilenames, shiftSelectedFilenames]);

  useEffect(() => {
    onStatusText?.(status);
  }, [onStatusText, status]);

  useEffect(() => {
    boxesRef.current = boxes;
    scheduleDraw();
  }, [boxes, scheduleDraw]);

  useEffect(() => {
    selectedRef.current = selectedBoxId;
    scheduleDraw();
  }, [selectedBoxId, scheduleDraw]);

  useEffect(() => {
    showGridRef.current = showGrid;
    scheduleDraw();
  }, [showGrid, scheduleDraw]);

  useEffect(() => {
    boxAdjustModeRef.current = labelClasses.boxAdjustMode;
  }, [labelClasses.boxAdjustMode]);

  useEffect(() => {
    loadMetadataMap(workspaceRoot)
      .then((map) => {
        metadataRef.current = map;
      })
      .catch(() => {});
  }, [workspaceRoot]);

  // Reload labels when the active image changes; avoid deps that would re-fetch on every editor tick.
  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!datasetRoot || !entry) {
        setBoxes([]);
        return;
      }
      setError("");
      setStatus("Loading labels...");
      setSelectedBoxId(null);
      selectedRef.current = null;
      interaction.zoomPointRef.current = null;
      dragRef.current = null;
      interaction.viewportRef.current = { zoom: 1, panX: 0, panY: 0 };
      try {
        if (imageVersion > 0) invalidateDatasetImageUrl(datasetRoot, entry.imagePath);
        const [labelBoxes, imageUrl] = await Promise.all([
          loadEntryLabels(datasetRoot, entry),
          datasetImageUrl(datasetRoot, entry.imagePath)
        ]);
        const image = await loadCanvasImage(imageUrl);
        if (cancelled) return;
        interaction.imageRef.current = image;
        boxesRef.current = labelBoxes;
        setBoxes(labelBoxes);
        if (pendingBoxSelectionRef.current) {
          const pending = pendingBoxSelectionRef.current;
          pendingBoxSelectionRef.current = null;
          if (pending.boxIndex >= 0 && pending.boxIndex < labelBoxes.length) {
            setSelectedBoxId(pending.boxIndex);
            labelClasses.setCurrentClass(pending.classId);
            selectedRef.current = pending.boxIndex;
          }
        } else if (pendingNearestBoxRef.current && selectedRef.current === null) {
          const nearest = findNearestBoxIndex(labelBoxes, pendingNearestBoxRef.current);
          pendingNearestBoxRef.current = null;
          if (nearest >= 0) {
            setSelectedBoxId(nearest);
            labelClasses.setCurrentClass(labelBoxes[nearest].classId);
            selectedRef.current = nearest;
          }
        } else {
          setSelectedBoxId(null);
        }
        setStatus(`${labelBoxes.length} box(es) loaded.`);
        scheduleDraw();
      } catch (err) {
        if (cancelled) return;
        setBoxes([]);
        setError(errMessage(err));
        setStatus("Load failed.");
      }
    }
    load();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload only when image path or backup restore version changes
  }, [datasetRoot, entryImagePath, imageVersion]);

  const selectedBox = selectedBoxId !== null ? boxes[selectedBoxId] : null;
  const filterText = [
    includeClasses.size ? `include ${[...includeClasses].sort((a, b) => a - b).join(",")}` : "",
    excludeClasses.size ? `exclude ${[...excludeClasses].sort((a, b) => a - b).join(",")}` : "",
    imageViewMode !== "all" ? imageViewMode : ""
  ]
    .filter(Boolean)
    .join(" | ");

  return {
    canvasRef: interaction.canvasRef,
    stageRef: interaction.stageRef,
    zoomCanvasRef: interaction.zoomCanvasRef,
    boxes,
    classes: labelClasses.classes,
    currentClass: labelClasses.currentClass,
    selectedBoxId,
    selectedBox,
    shortcutSlots: labelClasses.shortcutSlots,
    fixedBoxSlots: labelClasses.fixedBoxSlots,
    fixedShortcutMode: labelClasses.fixedShortcutMode,
    activeShortcutSlot: labelClasses.activeShortcutSlot,
    recordingFixedBoxSlot: labelClasses.recordingFixedBoxSlot,
    pointerToolEnabled: labelClasses.pointerToolEnabled,
    autoFitEnabled: labelClasses.autoFitEnabled,
    blackBoxEnabled: labelClasses.blackBoxEnabled,
    boxAdjustMode: labelClasses.boxAdjustMode,
    tracking,
    error,
    status,
    filterText,
    shiftSelectedFilenames,
    classNameInput: labelClasses.classNameInput,
    setClassNameInput: labelClasses.setClassNameInput,
    classSearch: labelClasses.classSearch,
    setClassSearch: labelClasses.setClassSearch,
    filteredClasses: labelClasses.filteredClasses,
    includeClasses,
    excludeClasses,
    currentIndex,
    entries,
    onPointerDown: interaction.onPointerDown,
    onPointerMove: interaction.onPointerMove,
    onPointerUp: interaction.onPointerUp,
    onWheel: interaction.onWheel,
    togglePointerTool: labelClasses.togglePointerTool,
    toggleAutoFitTool: labelClasses.toggleAutoFitTool,
    toggleBlackBoxTool: labelClasses.toggleBlackBoxTool,
    setBoxAdjustMode: labelClasses.setBoxAdjustMode,
    restoreBackup: interaction.restoreBackup,
    copySelectedBoxToNext,
    trackCsrtForward,
    selectClassShortcut: labelClasses.selectClassShortcut,
    startFixedBoxRecording: labelClasses.startFixedBoxRecording,
    setShortcutSlots: labelClasses.setShortcutSlots,
    setStatus,
    setSelectedBoxId,
    setCurrentClass: labelClasses.setCurrentClass,
    classShortcutOptions: labelClasses.classShortcutOptions,
    fixedShortcutOptions: labelClasses.fixedShortcutOptions,
    assignClass: labelClasses.assignClass,
    applyClassToSelectedBox: labelClasses.applyClassToSelectedBox,
    addClass: labelClasses.addClass,
    onClearClassFilters,
    onAddIncludeClass,
    onAddExcludeClass,
    setError
  };
}
