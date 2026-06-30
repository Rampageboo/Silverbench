import { useCallback, useMemo, useRef, useState, type MutableRefObject } from "react";
import * as api from "../../api";
import type { LabelClass } from "../../api";
import { loadEntryLabels, type BoxLabelEntry } from "./boxLabelCore";
import type { BoxLabelDuplicateFlow } from "./boxLabelTypes";
import { classNameFor, findNearestBoxIndex, mergeCopiedBox, mergeCopiedBoxWithIndex } from "./geometry";

type UseBoxTrackingOptions = {
  datasetRoot: string;
  entry: BoxLabelEntry | null;
  filename: string;
  entries: BoxLabelEntry[];
  currentIndex: number;
  classes: LabelClass[];
  boxesRef: MutableRefObject<api.LabelBox[]>;
  selectedRef: MutableRefObject<number | null>;
  selectedBoxId: number | null;
  shiftSelectedFilenamesRef: MutableRefObject<Set<string>>;
  persistEntryLabels: (target: BoxLabelEntry, boxes: api.LabelBox[]) => Promise<api.LabelBox[]>;
  onNavigate: (index: number) => void;
  setBoxes: (boxes: api.LabelBox[]) => void;
  setSelectedBoxId: (id: number | null) => void;
  setCurrentClass: (classId: number) => void;
  setTracking: (tracking: boolean) => void;
  setStatus: (status: string) => void;
  pushBatchUndo: (action: string, snapshots: Array<{ filename: string; boxes: api.LabelBox[] }>) => void;
};

type DuplicateInternalState = {
  items: Array<{
    id: string;
    box: api.LabelBox;
    frameIndex: number | null;
    currentBoxIndex: number | null;
    paused: boolean;
  }>;
  selectedItemId: string | null;
};

const emptyDuplicateState: DuplicateInternalState = {
  items: [],
  selectedItemId: null
};

function cloneBox(box: api.LabelBox): api.LabelBox {
  return { ...box };
}

function adjustCurrentBoxIndexes(
  items: DuplicateInternalState["items"],
  frameIndex: number,
  removedIndex: number
): DuplicateInternalState["items"] {
  return items.map((item) => {
    if (item.frameIndex !== frameIndex || item.currentBoxIndex === null) return item;
    if (item.currentBoxIndex === removedIndex) return { ...item, currentBoxIndex: null };
    if (item.currentBoxIndex > removedIndex) return { ...item, currentBoxIndex: item.currentBoxIndex - 1 };
    return item;
  });
}

export function useBoxTracking({
  datasetRoot,
  entry,
  filename,
  entries,
  currentIndex,
  classes,
  boxesRef,
  selectedRef,
  selectedBoxId,
  shiftSelectedFilenamesRef,
  persistEntryLabels,
  onNavigate,
  setBoxes,
  setSelectedBoxId,
  setCurrentClass,
  setTracking,
  setStatus,
  pushBatchUndo
}: UseBoxTrackingOptions) {
  const pendingBoxSelectionRef = useRef<{ boxIndex: number; classId: number } | null>(null);
  const pendingNearestBoxRef = useRef<api.LabelBox | null>(null);
  const duplicateIdCounterRef = useRef(0);
  const [duplicateState, setDuplicateState] = useState<DuplicateInternalState>(emptyDuplicateState);
  const duplicateStateRef = useRef<DuplicateInternalState>(emptyDuplicateState);

  const updateDuplicateState = useCallback((updater: DuplicateInternalState | ((state: DuplicateInternalState) => DuplicateInternalState)) => {
    setDuplicateState((state) => {
      const next = typeof updater === "function" ? updater(state) : updater;
      duplicateStateRef.current = next;
      return next;
    });
  }, []);

  const syncBoxToSelected = useCallback(
    async (box: api.LabelBox | undefined, action: string, options: { pushUndo?: boolean } = {}) => {
      if (!box) return 0;
      const targets = entries.filter(
        (item) => shiftSelectedFilenamesRef.current.has(item.basename) && item.basename !== filename
      );
      if (!targets.length) return 0;
      const snapshots: Array<{ filename: string; boxes: api.LabelBox[] }> = [];
      for (const target of targets) {
        const labels = await loadEntryLabels(datasetRoot, target);
        snapshots.push({ filename: target.basename, boxes: labels.map((item) => ({ ...item })) });
        const next = mergeCopiedBox(labels, box);
        await persistEntryLabels(target, next);
      }
      if (options.pushUndo !== false) {
        pushBatchUndo(action, snapshots);
      }
      setStatus(`Synced box to ${targets.length} selected image(s).`);
      return targets.length;
    },
    [datasetRoot, entries, filename, persistEntryLabels, pushBatchUndo, setStatus, shiftSelectedFilenamesRef]
  );

  const copySelectedBoxToNext = useCallback(async () => {
    const index = selectedRef.current;
    if (index === null) {
      setStatus("Select a box before adding it to duplicate.");
      return;
    }
    const box = boxesRef.current[index];
    if (!box || !entry) return;
    await persistEntryLabels(entry, boxesRef.current);
    const existing = duplicateStateRef.current.items.find(
      (item) => item.frameIndex === currentIndex && item.currentBoxIndex === index
    );
    const nextId = existing?.id ?? `duplicate-${duplicateIdCounterRef.current += 1}`;
    updateDuplicateState((state) => {
      const nextItem = {
        id: nextId,
        box: cloneBox(box),
        frameIndex: currentIndex,
        currentBoxIndex: index,
        paused: false
      };
      const items = existing
        ? state.items.map((item) => item.id === existing.id ? nextItem : item)
        : [...state.items, nextItem];
      return { items, selectedItemId: nextId };
    });
    const itemCount = existing ? duplicateStateRef.current.items.length : duplicateStateRef.current.items.length + 1;
    setStatus(`Added ${classNameFor(classes, box.classId)} to duplicate list (${itemCount}). Press D to copy list to next image.`);
  }, [
    boxesRef,
    classes,
    currentIndex,
    entry,
    persistEntryLabels,
    selectedRef,
    setStatus,
    updateDuplicateState
  ]);

  const advanceDuplicateToNext = useCallback(async () => {
    const state = duplicateStateRef.current;
    const activeItems = state.items.filter((item) => !item.paused);
    if (!activeItems.length) {
      setStatus(state.items.length ? "All duplicate boxes are paused." : "Add boxes to duplicate before continuing.");
      return;
    }
    if (currentIndex < 0 || currentIndex + 1 >= entries.length) {
      setStatus("No next image.");
      return;
    }
    if (!entry) return;
    await persistEntryLabels(entry, boxesRef.current);
    const nextEntry = entries[currentIndex + 1];
    let nextLabels = await loadEntryLabels(datasetRoot, nextEntry);
    let firstSelection: { boxIndex: number; classId: number } | null = null;
    let selectedSelection: { boxIndex: number; classId: number } | null = null;
    const nextItems = state.items.map((item) => {
      if (item.paused) return item;
      const sourceBox =
        item.frameIndex === currentIndex &&
        item.currentBoxIndex !== null &&
        item.currentBoxIndex >= 0 &&
        item.currentBoxIndex < boxesRef.current.length
          ? boxesRef.current[item.currentBoxIndex]
          : item.box;
      const merged = mergeCopiedBoxWithIndex(nextLabels, sourceBox);
      nextLabels = merged.boxes;
      if (!firstSelection) firstSelection = { boxIndex: merged.index, classId: sourceBox.classId };
      if (item.id === state.selectedItemId) {
        selectedSelection = { boxIndex: merged.index, classId: sourceBox.classId };
      }
      return {
        ...item,
        box: cloneBox(sourceBox),
        frameIndex: currentIndex + 1,
        currentBoxIndex: merged.index
      };
    });
    await persistEntryLabels(nextEntry, nextLabels);
    pendingBoxSelectionRef.current = selectedSelection ?? firstSelection;
    updateDuplicateState({
      items: nextItems,
      selectedItemId: selectedSelection ? state.selectedItemId : (activeItems[0]?.id ?? null)
    });
    setStatus(`Duplicated ${activeItems.length} box(es) to next image. Press T to add more, D to continue.`);
    onNavigate(currentIndex + 1);
  }, [
    boxesRef,
    currentIndex,
    datasetRoot,
    entries,
    entry,
    onNavigate,
    persistEntryLabels,
    setStatus,
    updateDuplicateState
  ]);

  const pauseDuplicateFlow = useCallback(async (itemId?: string) => {
    const state = duplicateStateRef.current;
    const item = state.items.find((candidate) => candidate.id === itemId)
      ?? state.items.find((candidate) => candidate.id === state.selectedItemId)
      ?? state.items[0];
    if (!item) {
      setStatus("Add a duplicate box before pausing.");
      return;
    }
    if (item.paused) {
      setStatus("Duplicate box is already paused.");
      return;
    }
    const currentDuplicateIndex = item.frameIndex === currentIndex ? item.currentBoxIndex : null;
    let removedBox: api.LabelBox | null = null;
    if (entry && currentDuplicateIndex !== null && currentDuplicateIndex >= 0 && currentDuplicateIndex < boxesRef.current.length) {
      removedBox = cloneBox(boxesRef.current[currentDuplicateIndex]);
      const nextBoxes = boxesRef.current.filter((_, index) => index !== currentDuplicateIndex);
      await persistEntryLabels(entry, nextBoxes);
      boxesRef.current = nextBoxes;
      setBoxes(nextBoxes);
      selectedRef.current = null;
      setSelectedBoxId(null);
    }
    updateDuplicateState((previous) => ({
      items: (currentDuplicateIndex === null
        ? previous.items
        : adjustCurrentBoxIndexes(previous.items, currentIndex, currentDuplicateIndex)
      ).map((candidate) =>
        candidate.id === item.id
          ? {
              ...candidate,
              box: removedBox ?? candidate.box,
              frameIndex: currentIndex,
              currentBoxIndex: null,
              paused: true
            }
          : candidate
      ),
      selectedItemId: item.id
    }));
    setStatus(removedBox ? "Duplicate box paused and removed from this image." : "Duplicate box paused.");
  }, [
    boxesRef,
    currentIndex,
    entry,
    persistEntryLabels,
    selectedRef,
    setBoxes,
    setSelectedBoxId,
    setStatus,
    updateDuplicateState
  ]);

  const resumeDuplicateFlow = useCallback(async (itemId?: string) => {
    const state = duplicateStateRef.current;
    const item = state.items.find((candidate) => candidate.id === itemId)
      ?? state.items.find((candidate) => candidate.id === state.selectedItemId)
      ?? state.items.find((candidate) => candidate.paused);
    if (!item || !item.paused) {
      setStatus("No paused duplicate box to resume.");
      return;
    }
    if (!entry) return;
    const merged = mergeCopiedBoxWithIndex(boxesRef.current, item.box);
    await persistEntryLabels(entry, merged.boxes);
    boxesRef.current = merged.boxes;
    setBoxes(merged.boxes);
    selectedRef.current = merged.index;
    setSelectedBoxId(merged.index);
    setCurrentClass(item.box.classId);
    updateDuplicateState((previous) => ({
      items: previous.items.map((candidate) =>
        candidate.id === item.id
          ? {
              ...candidate,
              box: cloneBox(item.box),
              frameIndex: currentIndex,
              currentBoxIndex: merged.index,
              paused: false
            }
          : candidate
      ),
      selectedItemId: item.id
    }));
    setStatus(`Duplicate resumed with ${classNameFor(classes, item.box.classId)}. Press D to continue.`);
  }, [
    boxesRef,
    classes,
    currentIndex,
    entry,
    persistEntryLabels,
    selectedRef,
    setBoxes,
    setCurrentClass,
    setSelectedBoxId,
    setStatus,
    updateDuplicateState
  ]);

  const deleteDuplicateFlow = useCallback(async (itemId?: string) => {
    const state = duplicateStateRef.current;
    const item = state.items.find((candidate) => candidate.id === itemId)
      ?? state.items.find((candidate) => candidate.id === state.selectedItemId)
      ?? state.items[0];
    if (!item) {
      setStatus("No duplicate box to delete.");
      return;
    }
    const currentDuplicateIndex = item.frameIndex === currentIndex ? item.currentBoxIndex : null;
    let removed = false;
    if (entry && currentDuplicateIndex !== null && currentDuplicateIndex >= 0 && currentDuplicateIndex < boxesRef.current.length) {
      const nextBoxes = boxesRef.current.filter((_, index) => index !== currentDuplicateIndex);
      await persistEntryLabels(entry, nextBoxes);
      boxesRef.current = nextBoxes;
      setBoxes(nextBoxes);
      selectedRef.current = null;
      setSelectedBoxId(null);
      removed = true;
    }
    updateDuplicateState((previous) => {
      const adjusted = (currentDuplicateIndex === null
        ? previous.items
        : adjustCurrentBoxIndexes(previous.items, currentIndex, currentDuplicateIndex)
      )
        .filter((candidate) => candidate.id !== item.id);
      return {
        items: adjusted,
        selectedItemId: adjusted[0]?.id ?? null
      };
    });
    setStatus(removed ? "Duplicate box deleted from this image." : "Duplicate box deleted.");
  }, [
    boxesRef,
    currentIndex,
    entry,
    persistEntryLabels,
    selectedRef,
    setBoxes,
    setSelectedBoxId,
    setStatus,
    updateDuplicateState
  ]);

  const trackCsrtForward = useCallback(async () => {
    const index = selectedRef.current;
    if (index === null) {
      setStatus("Select a box before CSRT tracking.");
      return;
    }
    const box = boxesRef.current[index];
    if (!box) return;
    setTracking(true);
    setStatus("CSRT tracking up to 5 frame(s)...");
    try {
      if (!entry) return;
      await persistEntryLabels(entry, boxesRef.current);
      const ordered = entries.slice(currentIndex).map((item) => item.imagePath);
      const result = await api.trackYoloForward(datasetRoot, entry.imagePath, box, ordered, {
        maxFrames: 5,
        areaMinRatio: 0.6,
        areaMaxRatio: 1.6,
        centerJumpRatio: 0.7,
        minConfidence: 0.05
      });
      const stoppedIndex = result.stoppedAt ? entries.findIndex((item) => item.imagePath === result.stoppedAt) : -1;
      if (result.lastBox) {
        pendingNearestBoxRef.current = result.lastBox;
        selectedRef.current = null;
        setSelectedBoxId(null);
      }
      if (stoppedIndex >= 0) onNavigate(stoppedIndex);
      else if (result.lastBox) {
        const nearest = findNearestBoxIndex(boxesRef.current, result.lastBox);
        if (nearest >= 0) {
          setSelectedBoxId(nearest);
          setCurrentClass(boxesRef.current[nearest].classId);
          selectedRef.current = nearest;
          pendingNearestBoxRef.current = null;
        }
      }
      setStatus(`CSRT saved ${result.saved || 0} frame(s). ${result.reason || ""}`);
    } finally {
      setTracking(false);
    }
  }, [
    boxesRef,
    currentIndex,
    datasetRoot,
    entries,
    entry,
    onNavigate,
    persistEntryLabels,
    selectedRef,
    setCurrentClass,
    setSelectedBoxId,
    setStatus,
    setTracking
  ]);

  const selectDuplicateItem = useCallback((id: string) => {
    const item = duplicateStateRef.current.items.find((candidate) => candidate.id === id);
    if (!item) return;
    updateDuplicateState((state) => ({ ...state, selectedItemId: id }));
    if (
      item.frameIndex === currentIndex &&
      item.currentBoxIndex !== null &&
      item.currentBoxIndex >= 0 &&
      item.currentBoxIndex < boxesRef.current.length
    ) {
      selectedRef.current = item.currentBoxIndex;
      setSelectedBoxId(item.currentBoxIndex);
      setCurrentClass(boxesRef.current[item.currentBoxIndex].classId);
    }
  }, [boxesRef, currentIndex, selectedRef, setCurrentClass, setSelectedBoxId, updateDuplicateState]);

  const selectedIndex = selectedBoxId;
  const selectedDuplicateItem =
    duplicateState.items.find((item) => item.id === duplicateState.selectedItemId) ?? duplicateState.items[0] ?? null;
  const activeDuplicateOnCurrentFrame =
    selectedDuplicateItem && !selectedDuplicateItem.paused && selectedDuplicateItem.frameIndex === currentIndex
      ? selectedDuplicateItem.currentBoxIndex
      : null;
  const activeDuplicateItems = duplicateState.items.filter((item) => !item.paused);
  const duplicateClassId = duplicateState.items.length === 1 ? duplicateState.items[0].box.classId : null;
  const boxesLength = boxesRef.current.length;
  const duplicateFlow: BoxLabelDuplicateFlow = useMemo(() => ({
    active: duplicateState.items.length > 0,
    paused: duplicateState.items.length > 0 && activeDuplicateItems.length === 0,
    className: duplicateClassId === null ? null : classNameFor(classes, duplicateClassId),
    frameIndex: selectedDuplicateItem?.frameIndex ?? null,
    currentBoxIndex: activeDuplicateOnCurrentFrame,
    items: duplicateState.items.map((item) => ({
      id: item.id,
      classId: item.box.classId,
      className: classNameFor(classes, item.box.classId),
      x: item.box.x,
      y: item.box.y,
      w: item.box.w,
      h: item.box.h,
      frameIndex: item.frameIndex,
      currentBoxIndex: item.currentBoxIndex,
      paused: item.paused,
      selected: item.id === (selectedDuplicateItem?.id ?? null)
    })),
    canStart:
      currentIndex >= 0 &&
      selectedIndex !== null &&
      Boolean(boxesRef.current[selectedIndex]),
    canAdvance: activeDuplicateItems.length > 0 && currentIndex >= 0 && currentIndex + 1 < entries.length,
    canPause: Boolean(selectedDuplicateItem && !selectedDuplicateItem.paused),
    canResume: Boolean(selectedDuplicateItem && selectedDuplicateItem.paused && entry),
    canDelete: Boolean(selectedDuplicateItem),
    message: duplicateState.items.length
      ? activeDuplicateItems.length
        ? `${activeDuplicateItems.length} duplicate box(es) ready. Press D to copy list to next image. Press T to add more.`
        : "Duplicate list is paused. Select an item and Resume on the frame where it should continue."
      : "Select a box and press T to add it to duplicate list."
  }), [
    activeDuplicateOnCurrentFrame,
    activeDuplicateItems.length,
    boxesLength,
    boxesRef,
    classes,
    currentIndex,
    duplicateClassId,
    duplicateState.items,
    entries.length,
    entry,
    selectedDuplicateItem,
    selectedIndex
  ]);

  return {
    pendingBoxSelectionRef,
    pendingNearestBoxRef,
    syncBoxToSelected,
    copySelectedBoxToNext,
    advanceDuplicateToNext,
    trackCsrtForward,
    duplicateFlow,
    selectDuplicateItem,
    pauseDuplicateFlow,
    resumeDuplicateFlow,
    deleteDuplicateFlow
  };
}
