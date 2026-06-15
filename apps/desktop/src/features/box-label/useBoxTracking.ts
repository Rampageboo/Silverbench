import { useCallback, useRef, type MutableRefObject } from "react";
import * as api from "../../api";
import type { LabelClass } from "../../api";
import { loadEntryLabels, type BoxLabelEntry } from "./boxLabelCore";
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
  shiftSelectedFilenamesRef: MutableRefObject<Set<string>>;
  persistEntryLabels: (target: BoxLabelEntry, boxes: api.LabelBox[]) => Promise<api.LabelBox[]>;
  onNavigate: (index: number) => void;
  setSelectedBoxId: (id: number | null) => void;
  setCurrentClass: (classId: number) => void;
  setTracking: (tracking: boolean) => void;
  setStatus: (status: string) => void;
  pushBatchUndo: (action: string, snapshots: Array<{ filename: string; boxes: api.LabelBox[] }>) => void;
};

export function useBoxTracking({
  datasetRoot,
  entry,
  filename,
  entries,
  currentIndex,
  classes,
  boxesRef,
  selectedRef,
  shiftSelectedFilenamesRef,
  persistEntryLabels,
  onNavigate,
  setSelectedBoxId,
  setCurrentClass,
  setTracking,
  setStatus,
  pushBatchUndo
}: UseBoxTrackingOptions) {
  const pendingBoxSelectionRef = useRef<{ boxIndex: number; classId: number } | null>(null);
  const pendingNearestBoxRef = useRef<api.LabelBox | null>(null);

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
      setStatus("Select a box before Copy Next.");
      return;
    }
    if (currentIndex < 0 || currentIndex + 1 >= entries.length) {
      setStatus("No next image.");
      return;
    }
    const box = boxesRef.current[index];
    if (!box || !entry) return;
    await persistEntryLabels(entry, boxesRef.current);
    const nextEntry = entries[currentIndex + 1];
    const nextLabels = await loadEntryLabels(datasetRoot, nextEntry);
    const merged = mergeCopiedBoxWithIndex(nextLabels, box);
    await persistEntryLabels(nextEntry, merged.boxes);
    pendingBoxSelectionRef.current = { boxIndex: merged.index, classId: box.classId };
    setStatus(`Copied ${classNameFor(classes, box.classId)} box to next image. Adjust it, then press T again.`);
    onNavigate(currentIndex + 1);
  }, [
    boxesRef,
    classes,
    currentIndex,
    datasetRoot,
    entries,
    entry,
    onNavigate,
    persistEntryLabels,
    selectedRef,
    setStatus
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

  return {
    pendingBoxSelectionRef,
    pendingNearestBoxRef,
    syncBoxToSelected,
    copySelectedBoxToNext,
    trackCsrtForward
  };
}
