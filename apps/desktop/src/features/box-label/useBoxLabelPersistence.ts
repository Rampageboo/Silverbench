import {
  useCallback,
  useRef,
  type Dispatch,
  type MutableRefObject,
  type RefObject,
  type SetStateAction
} from "react";
import * as api from "../../api";
import { useConfirm } from "../../components/useConfirm";
import { errMessage } from "../../lib/errors";
import { invalidateDatasetImageUrl } from "../dataset-review/datasetAssets";
import { loadEntryLabels, type BoxLabelEntry } from "./boxLabelCore";
import {
  boxCenterPixel,
  boxToRect,
  clamp,
  enforceMinRect,
  rectToBox,
  type BoxAdjustMode,
  type DragState,
  type ImagePixelPoint,
  type ImageRect
} from "./geometry";

type UseBoxLabelPersistenceOptions = {
  workspaceRoot: string;
  datasetRoot: string;
  mediaImagePath: string;
  entry: BoxLabelEntry | null;
  entries: BoxLabelEntry[];
  currentIndex: number;
  filename: string;
  onNavigate: (index: number) => void;
  onNavigateBoundary?: (delta: -1 | 1) => void;
  persistEntryLabels: (target: BoxLabelEntry, nextBoxes: api.LabelBox[]) => Promise<api.LabelBox[]>;
  boxesRef: MutableRefObject<api.LabelBox[]>;
  selectedRef: MutableRefObject<number | null>;
  dragRef: MutableRefObject<DragState>;
  boxAdjustModeRef: MutableRefObject<BoxAdjustMode>;
  fixedBoxSlots: Array<api.LabelBox | null>;
  setCurrentClass: (classId: number) => void;
  pushUndo: (action: string) => void;
  pushImageUndo: (action: string, imageBase64: string) => void;
  syncBoxToSelected: (
    box: api.LabelBox | undefined,
    action: string,
    options?: { pushUndo?: boolean }
  ) => Promise<number>;
  setBoxes: (boxes: api.LabelBox[]) => void;
  setSelectedBoxId: (id: number | null) => void;
  setStatus: (status: string) => void;
  setError: (status: string) => void;
  setImageVersion: Dispatch<SetStateAction<number>>;
  imageRef: RefObject<HTMLImageElement | null>;
  zoomPointRef: MutableRefObject<ImagePixelPoint | null>;
  lastZoomCenterRef: MutableRefObject<ImagePixelPoint | null>;
  scheduleDraw: () => void;
};

export function useBoxLabelPersistence({
  workspaceRoot,
  datasetRoot,
  mediaImagePath,
  entry,
  entries,
  currentIndex,
  filename,
  onNavigate,
  onNavigateBoundary,
  persistEntryLabels,
  boxesRef,
  selectedRef,
  dragRef,
  boxAdjustModeRef,
  fixedBoxSlots,
  setCurrentClass,
  pushUndo,
  pushImageUndo,
  syncBoxToSelected,
  setBoxes,
  setSelectedBoxId,
  setStatus,
  setError,
  setImageVersion,
  imageRef,
  zoomPointRef,
  lastZoomCenterRef,
  scheduleDraw
}: UseBoxLabelPersistenceOptions) {
  const { confirm } = useConfirm();
  const keyboardAdjustingRef = useRef(false);
  const persistQueueRef = useRef<Promise<void>>(Promise.resolve());
  const latestPersistRequestRef = useRef(0);
  const currentEntryKeyRef = useRef("");
  currentEntryKeyRef.current = entry?.basename || "";

  const save = useCallback(async () => {
    if (!entry) return;
    const target = entry;
    const targetKey = target.basename;
    const snapshot = boxesRef.current.map((box) => ({ ...box }));
    const requestId = ++latestPersistRequestRef.current;
    const run = async () => {
      const next = await persistEntryLabels(target, snapshot);
      if (latestPersistRequestRef.current === requestId && currentEntryKeyRef.current === targetKey) {
        boxesRef.current = next;
        setBoxes(next);
        setStatus(`Saved ${snapshot.length} box(es) to ${target.labelPath}.`);
      }
    };
    try {
      setError("");
      const queued = persistQueueRef.current.catch(() => {}).then(run);
      persistQueueRef.current = queued;
      await queued;
    } catch (err) {
      setError(errMessage(err));
      setStatus("Save failed.");
    }
  }, [boxesRef, entry, persistEntryLabels, setBoxes, setError, setStatus]);

  const persistLabels = useCallback(
    async (statusMessage?: string) => {
      if (!entry) return;
      const target = entry;
      const targetKey = target.basename;
      const snapshot = boxesRef.current.map((box) => ({ ...box }));
      const requestId = ++latestPersistRequestRef.current;
      const run = async () => {
        const next = await persistEntryLabels(target, snapshot);
        if (latestPersistRequestRef.current !== requestId || currentEntryKeyRef.current !== targetKey) return;
        boxesRef.current = next;
        setBoxes(next);
        if (statusMessage) setStatus(statusMessage);
      };
      const queued = persistQueueRef.current.catch(() => {}).then(run);
      persistQueueRef.current = queued;
      try {
        await queued;
      } catch (err) {
        if (latestPersistRequestRef.current === requestId && currentEntryKeyRef.current === targetKey) {
          setError(errMessage(err));
          setStatus("Save failed.");
        }
      }
    },
    [boxesRef, entry, persistEntryLabels, setBoxes, setError, setStatus]
  );

  const deleteSelectedBox = useCallback(() => {
    const index = selectedRef.current;
    if (index === null) return;
    pushUndo("delete box");
    const next = boxesRef.current.filter((_, itemIndex) => itemIndex !== index);
    boxesRef.current = next;
    setBoxes(next);
    setSelectedBoxId(null);
    void persistLabels("Deleted selected box.");
    scheduleDraw();
  }, [boxesRef, persistLabels, pushUndo, scheduleDraw, selectedRef, setBoxes, setSelectedBoxId]);

  const updateSelectedBox = useCallback(
    (mutator: (box: api.LabelBox) => api.LabelBox, message: string, opts?: { skipZoomUpdate?: boolean }) => {
      const index = selectedRef.current;
      if (index === null) return;
      const current = boxesRef.current[index];
      if (!current) return;
      const next = boxesRef.current.slice();
      next[index] = mutator(current);
      boxesRef.current = next;
      setBoxes(next);
      if (!opts?.skipZoomUpdate) {
        const image = imageRef.current;
        if (image) {
          zoomPointRef.current = boxCenterPixel(next[index], image.naturalWidth, image.naturalHeight);
          lastZoomCenterRef.current = zoomPointRef.current;
        }
      }
      void persistLabels(message);
      scheduleDraw();
    },
    [boxesRef, imageRef, lastZoomCenterRef, persistLabels, scheduleDraw, selectedRef, setBoxes, zoomPointRef]
  );

  const moveSelectedBoxByKeyboard = useCallback(
    (dx: number, dy: number, fast: boolean) => {
      const image = imageRef.current;
      const factor = fast ? 10 : 1;
      const stepX = factor / Math.max(1, image?.naturalWidth ?? 1);
      const stepY = factor / Math.max(1, image?.naturalHeight ?? 1);
      if (!keyboardAdjustingRef.current) pushUndo("keyboard adjust box");
      keyboardAdjustingRef.current = true;
      updateSelectedBox((box) => {
        const rect = boxToRect(box);
        const width = rect.x2 - rect.x1;
        const height = rect.y2 - rect.y1;
        const nextX1 = clamp(rect.x1 + dx * stepX, 0, 1 - width);
        const nextY1 = clamp(rect.y1 + dy * stepY, 0, 1 - height);
        return rectToBox({ x1: nextX1, y1: nextY1, x2: nextX1 + width, y2: nextY1 + height }, box.classId);
      }, "Box moved with keyboard.", { skipZoomUpdate: true });
      const index = selectedRef.current;
      if (index !== null) syncBoxToSelected(boxesRef.current[index], "sync keyboard adjust", { pushUndo: false }).catch(() => {});
    },
    [boxesRef, imageRef, pushUndo, selectedRef, syncBoxToSelected, updateSelectedBox]
  );

  const resizeSelectedBoxByKeyboard = useCallback(
    (key: string, fast: boolean) => {
      const image = imageRef.current;
      const factor = fast ? 10 : 1;
      const stepX = factor / Math.max(1, image?.naturalWidth ?? 1);
      const stepY = factor / Math.max(1, image?.naturalHeight ?? 1);
      const sign = boxAdjustModeRef.current === "grow" ? 1 : -1;
      if (!keyboardAdjustingRef.current) pushUndo("keyboard resize box");
      keyboardAdjustingRef.current = true;
      updateSelectedBox((box) => {
        const rect = boxToRect(box);
        const next = { ...rect };
        if (key === "4" || key === "5") next.x1 -= sign * stepX;
        if (key === "6" || key === "5") next.x2 += sign * stepX;
        if (key === "8" || key === "5") next.y1 -= sign * stepY;
        if (key === "2" || key === "5") next.y2 += sign * stepY;
        const normalized = enforceMinRect(next, stepX * 2, stepY * 2);
        return rectToBox(normalized, box.classId);
      }, `Box resized with numpad (${boxAdjustModeRef.current}).`, { skipZoomUpdate: true });
      const index = selectedRef.current;
      if (index !== null) syncBoxToSelected(boxesRef.current[index], "sync keyboard resize", { pushUndo: false }).catch(() => {});
    },
    [boxAdjustModeRef, boxesRef, imageRef, pushUndo, selectedRef, syncBoxToSelected, updateSelectedBox]
  );

  const imageMimeForFilename = useCallback((name: string) => {
    const lower = name.toLowerCase();
    if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
    if (lower.endsWith(".webp")) return "image/webp";
    return "image/png";
  }, []);

  const applyBlackBox = useCallback(
    async (rect: ImageRect) => {
      const image = imageRef.current;
      if (!image) return;
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.drawImage(image, 0, 0);
      const mime = imageMimeForFilename(filename);
      const before = canvas.toDataURL(mime, 0.95).split(",")[1] || "";
      pushImageUndo("black box", before);
      await api.ensureImagePoolBackup(workspaceRoot, mediaImagePath);
      ctx.fillStyle = "#000000";
      ctx.fillRect(
        Math.round(rect.x1 * canvas.width),
        Math.round(rect.y1 * canvas.height),
        Math.round((rect.x2 - rect.x1) * canvas.width),
        Math.round((rect.y2 - rect.y1) * canvas.height)
      );
      const base64 = canvas.toDataURL(mime, 0.95).split(",")[1] || "";
      await api.writeFileBase64(workspaceRoot, mediaImagePath, base64);
      setImageVersion((value) => value + 1);
      setStatus("Applied black box to image.");
    },
    [filename, imageMimeForFilename, imageRef, mediaImagePath, pushImageUndo, setImageVersion, setStatus, workspaceRoot]
  );

  const createFixedBoxFromShortcut = useCallback(
    (slot: number) => {
      const template = fixedBoxSlots[slot];
      if (!template) {
        setStatus(`Fixed box ${slot} is empty. Record it in the Alt row first.`);
        return;
      }
      const box: api.LabelBox = { ...template };
      pushUndo("fixed box");
      const next = [...boxesRef.current, box];
      boxesRef.current = next;
      setBoxes(next);
      setSelectedBoxId(next.length - 1);
      setCurrentClass(box.classId);
      const image = imageRef.current;
      if (image) {
        zoomPointRef.current = boxCenterPixel(box, image.naturalWidth, image.naturalHeight);
        lastZoomCenterRef.current = zoomPointRef.current;
      }
      syncBoxToSelected(box, "sync fixed box", { pushUndo: false }).catch(() => {});
      void persistLabels(`Created fixed box from Alt+${slot}.`);
      scheduleDraw();
    },
    [
      boxesRef,
      fixedBoxSlots,
      imageRef,
      lastZoomCenterRef,
      persistLabels,
      pushUndo,
      scheduleDraw,
      setBoxes,
      setCurrentClass,
      setSelectedBoxId,
      setStatus,
      syncBoxToSelected,
      zoomPointRef
    ]
  );

  const navigateRelative = useCallback(
    (delta: number) => {
      if (currentIndex < 0) return;
      const nextIndex = currentIndex + delta;
      if (nextIndex < 0 || nextIndex >= entries.length) {
        if (onNavigateBoundary) {
          save()
            .catch(() => {})
            .finally(() => onNavigateBoundary(delta < 0 ? -1 : 1));
          return;
        }
        setStatus(delta < 0 ? "Already at first image." : "Already at last image.");
        return;
      }
      save()
        .catch(() => {})
        .finally(() => onNavigate(nextIndex));
    },
    [currentIndex, entries.length, onNavigate, onNavigateBoundary, save, setStatus]
  );

  const restoreBackup = useCallback(async () => {
    if (!entry) return;
    if (
      !(await confirm({
        title: "Restore backup",
        message: `Restore current image and label from image_pool_backup?\n\n${mediaImagePath}`,
        confirmLabel: "Restore",
        danger: true
      }))
    ) {
      return;
    }
    const result = await api.restoreImagePoolBackup(workspaceRoot, mediaImagePath);
    const parts: string[] = [];
    if (result.restored?.image) parts.push("image");
    if (result.restored?.label) parts.push("label");
    invalidateDatasetImageUrl(datasetRoot, entry.imagePath);
    setImageVersion((value) => value + 1);
    setSelectedBoxId(null);
    selectedRef.current = null;
    dragRef.current = null;
    const labelBoxes = await loadEntryLabels(datasetRoot, entry);
    boxesRef.current = labelBoxes;
    setBoxes(labelBoxes);
    setStatus(parts.length ? `Restored ${parts.join(" + ")} from backup.` : "No backup found for this image.");
  }, [
    boxesRef,
    confirm,
    datasetRoot,
    dragRef,
    entry,
    mediaImagePath,
    selectedRef,
    setBoxes,
    setImageVersion,
    setSelectedBoxId,
    setStatus,
    workspaceRoot
  ]);

  return {
    keyboardAdjustingRef,
    save,
    persistLabels,
    deleteSelectedBox,
    updateSelectedBox,
    moveSelectedBoxByKeyboard,
    resizeSelectedBoxByKeyboard,
    applyBlackBox,
    createFixedBoxFromShortcut,
    navigateRelative,
    restoreBackup
  };
}
