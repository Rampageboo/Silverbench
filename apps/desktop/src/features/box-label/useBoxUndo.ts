import { useCallback, useRef, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import * as api from "../../api";
import type { BoxLabelEntry } from "./boxLabelCore";
import type { UndoSnapshot } from "./boxLabelTypes";

const UNDO_LIMIT = 50;

type UseBoxUndoOptions = {
  workspaceRoot: string;
  filename: string;
  findEntryByBasename: (basename: string) => BoxLabelEntry | null;
  persistEntryLabels: (target: BoxLabelEntry, boxes: api.LabelBox[]) => Promise<api.LabelBox[]>;
  onLabelsChanged: (filename: string, boxes: api.LabelBox[]) => void;
  boxesRef: MutableRefObject<api.LabelBox[]>;
  selectedRef: MutableRefObject<number | null>;
  classRef: MutableRefObject<number>;
  setBoxes: (boxes: api.LabelBox[]) => void;
  setSelectedBoxId: (id: number | null) => void;
  setCurrentClass: (classId: number) => void;
  setImageVersion: Dispatch<SetStateAction<number>>;
  setStatus: (status: string) => void;
  scheduleDraw: () => void;
};

export function useBoxUndo({
  workspaceRoot,
  filename,
  findEntryByBasename,
  persistEntryLabels,
  onLabelsChanged,
  boxesRef,
  selectedRef,
  classRef,
  setBoxes,
  setSelectedBoxId,
  setCurrentClass,
  setImageVersion,
  setStatus,
  scheduleDraw
}: UseBoxUndoOptions) {
  const undoRef = useRef<UndoSnapshot[]>([]);

  const pushUndo = useCallback(
    (action: string) => {
      undoRef.current.push({
        type: "labels",
        action,
        filename,
        boxes: boxesRef.current.map((box) => ({ ...box })),
        selectedBoxId: selectedRef.current,
        classId: classRef.current
      });
      if (undoRef.current.length > UNDO_LIMIT) undoRef.current.shift();
    },
    [boxesRef, classRef, filename, selectedRef]
  );

  const pushBatchUndo = useCallback((action: string, snapshots: Array<{ filename: string; boxes: api.LabelBox[] }>) => {
    undoRef.current.push({ type: "batch-labels", action, snapshots });
    if (undoRef.current.length > UNDO_LIMIT) undoRef.current.shift();
  }, []);

  const pushImageUndo = useCallback(
    (action: string, imageBase64: string) => {
      undoRef.current.push({ type: "image", action, filename, imageBase64 });
      if (undoRef.current.length > UNDO_LIMIT) undoRef.current.shift();
    },
    [filename]
  );

  const undoLast = useCallback(async () => {
    const snapshot = undoRef.current.pop();
    if (!snapshot) {
      setStatus("Nothing to undo.");
      return;
    }
    if (snapshot.type === "image") {
      await api.writeFileBase64(workspaceRoot, `image_pool/${snapshot.filename}`, snapshot.imageBase64);
      if (snapshot.filename === filename) {
        setImageVersion((value) => value + 1);
      }
      setStatus(`Undid ${snapshot.action}.`);
      return;
    }
    if (snapshot.type === "batch-labels") {
      for (const item of snapshot.snapshots) {
        const target = findEntryByBasename(item.filename);
        if (target) await persistEntryLabels(target, item.boxes);
      }
      if (snapshot.snapshots.some((item) => item.filename === filename)) {
        const current = snapshot.snapshots.find((item) => item.filename === filename);
        const next = current?.boxes || boxesRef.current;
        boxesRef.current = next;
        setBoxes(next);
        setSelectedBoxId(null);
      }
      setStatus(`Undid ${snapshot.action} on ${snapshot.snapshots.length} image(s).`);
      return;
    }
    const target = findEntryByBasename(snapshot.filename);
    if (target) await persistEntryLabels(target, snapshot.boxes);
    onLabelsChanged(snapshot.filename, snapshot.boxes);
    if (snapshot.filename === filename) {
      boxesRef.current = snapshot.boxes.map((box) => ({ ...box }));
      setBoxes(boxesRef.current);
      setSelectedBoxId(
        snapshot.selectedBoxId !== null && snapshot.selectedBoxId < boxesRef.current.length ? snapshot.selectedBoxId : null
      );
      setCurrentClass(snapshot.classId);
    }
    setStatus(`Undid ${snapshot.action}.`);
    scheduleDraw();
  }, [
    boxesRef,
    filename,
    findEntryByBasename,
    onLabelsChanged,
    persistEntryLabels,
    scheduleDraw,
    setBoxes,
    setCurrentClass,
    setImageVersion,
    setSelectedBoxId,
    setStatus,
    workspaceRoot
  ]);

  return { pushUndo, pushBatchUndo, pushImageUndo, undoLast };
}
