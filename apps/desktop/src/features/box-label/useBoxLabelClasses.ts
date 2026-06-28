import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import * as api from "../../api";
import { useArchivedClassIds } from "../workspace/useArchivedClassIds";
import {
  classMapToLabelClasses,
  loadDatasetClassNames,
  saveDatasetClassNames
} from "./boxLabelCore";
import { classNameFor, loadShortcutSlots, saveShortcutSlots, type DragState, type ToolMode } from "./geometry";
import type { BoxLabelShortcutSlot, FixedBoxSlot } from "./session";

type ShortcutOption = {
  value: string;
  label: string;
  searchText: string;
  selected: boolean;
};

type UseBoxLabelClassesOptions = {
  datasetRoot: string;
  workspaceRoot: string;
  initialShortcutSlots: Array<BoxLabelShortcutSlot | null> | null;
  initialFixedBoxSlots: Array<FixedBoxSlot | null> | null;
  initialPointerToolEnabled: boolean;
  initialAutoFitEnabled: boolean;
  onShortcutSlotsChange?: (slots: Array<BoxLabelShortcutSlot | null>, fixedSlots?: Array<FixedBoxSlot | null>) => void;
  onToolStateChange?: (pointerToolEnabled: boolean, autoFitEnabled: boolean) => void;
  boxesRef: MutableRefObject<api.LabelBox[]>;
  selectedRef: MutableRefObject<number | null>;
  classRef: MutableRefObject<number>;
  dragRef: MutableRefObject<DragState>;
  pushUndo: (action: string) => void;
  persistLabels: (statusMessage?: string) => Promise<void>;
  scheduleDraw: () => void;
  setBoxes: (boxes: api.LabelBox[]) => void;
  setStatus: (status: string) => void;
};

export function useBoxLabelClasses({
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
  persistLabels,
  scheduleDraw,
  setBoxes,
  setStatus
}: UseBoxLabelClassesOptions) {
  const { archivedDetectIds, archivedDetectIdsRef, archivedClassKeysRef } = useArchivedClassIds(workspaceRoot);

  const [classes, setClasses] = useState<api.LabelClass[]>([]);
  const classesRef = useRef(classes);
  classesRef.current = classes;

  const [currentClass, setCurrentClass] = useState(0);
  const [mode, setMode] = useState<ToolMode>("draw");
  const modeRef = useRef(mode);
  modeRef.current = mode;

  const [shortcutSlots, setShortcutSlotsState] = useState<Array<BoxLabelShortcutSlot | null>>(() => loadShortcutSlots(workspaceRoot));
  const [fixedBoxSlots, setFixedBoxSlotsState] = useState<Array<FixedBoxSlot | null>>(() =>
    Array.from({ length: 10 }, () => null)
  );
  const shortcutSlotsHydratedRef = useRef(false);
  const fixedBoxSlotsHydratedRef = useRef(false);
  const [recordingFixedBoxSlot, setRecordingFixedBoxSlot] = useState<number | null>(null);
  const [classNameInput, setClassNameInput] = useState("");
  const [classSearch, setClassSearch] = useState("");
  const [fixedShortcutMode, setFixedShortcutMode] = useState(false);
  const [activeShortcutSlot, setActiveShortcutSlot] = useState<number | null>(null);
  const [pointerToolEnabled, setPointerToolEnabled] = useState(initialPointerToolEnabled);
  const [autoFitEnabled, setAutoFitEnabled] = useState(initialAutoFitEnabled);
  const [blackBoxEnabled, setBlackBoxEnabled] = useState(false);
  const [boxAdjustMode, setBoxAdjustMode] = useState<"grow" | "shrink">("grow");

  // Set to true only by explicit user mutations (not hydration effects).
  // The sync effect below reads this flag to decide whether to propagate to
  // the session. Hydration effects must NOT set this flag.
  const userMutatedRef = useRef(false);

  const setShortcutSlots = useCallback(
    (next: Array<BoxLabelShortcutSlot | null>) => {
      shortcutSlotsHydratedRef.current = true;
      userMutatedRef.current = true;
      saveShortcutSlots(workspaceRoot, next);
      setShortcutSlotsState(next);
    },
    [workspaceRoot]
  );

  const setFixedBoxSlots = useCallback((next: Array<FixedBoxSlot | null>) => {
    fixedBoxSlotsHydratedRef.current = true;
    userMutatedRef.current = true;
    setFixedBoxSlotsState(next);
  }, []);

  useEffect(() => {
    classRef.current = currentClass;
  }, [classRef, currentClass]);

  const applyCurrentClass = useCallback(
    (classId: number) => {
      classRef.current = classId;
      setCurrentClass(classId);
    },
    [classRef]
  );

  const isArchivedClassId = useCallback(
    (classId: number) => archivedDetectIdsRef.current.has(classId),
    [archivedDetectIdsRef]
  );
  const isArchivedClassKey = useCallback(
    (classKey: string) => archivedClassKeysRef.current.has(classKey),
    [archivedClassKeysRef]
  );

  useEffect(() => {
    if (!datasetRoot) return;
    let cancelled = false;
    api
      .listDatasetFiles(datasetRoot)
      .then(async (paths) => {
        const names = await loadDatasetClassNames(datasetRoot, new Set(paths));
        if (!cancelled) setClasses(classMapToLabelClasses(names));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [datasetRoot]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.altKey) setFixedShortcutMode(true);
    }
    function onKeyUp(event: KeyboardEvent) {
      if (!event.altKey) setFixedShortcutMode(false);
    }
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, []);

  useEffect(() => {
    shortcutSlotsHydratedRef.current = false;
    fixedBoxSlotsHydratedRef.current = false;
    setShortcutSlotsState(loadShortcutSlots(workspaceRoot));
    setFixedBoxSlotsState(Array.from({ length: 10 }, () => null));
  }, [workspaceRoot]);

  useEffect(() => {
    if (!initialShortcutSlots) return;
    shortcutSlotsHydratedRef.current = true;
    saveShortcutSlots(workspaceRoot, initialShortcutSlots);
    setShortcutSlotsState(initialShortcutSlots);
  }, [workspaceRoot, initialShortcutSlots]);

  useEffect(() => {
    if (!initialFixedBoxSlots) return;
    fixedBoxSlotsHydratedRef.current = true;
    setFixedBoxSlotsState(initialFixedBoxSlots);
  }, [workspaceRoot, initialFixedBoxSlots]);

  // Sync shortcut/fixed-box state to localStorage and session ONLY when the
  // user explicitly mutated either value. Hydration effects must not trigger
  // this path because the session might have fixed boxes without shortcuts,
  // and propagating at that point would write unvalidated localStorage
  // shortcuts back into the session file.
  useEffect(() => {
    if (!userMutatedRef.current) return;
    userMutatedRef.current = false;
    saveShortcutSlots(workspaceRoot, shortcutSlots);
    onShortcutSlotsChange?.(shortcutSlots, fixedBoxSlots);
  }, [shortcutSlots, fixedBoxSlots, onShortcutSlotsChange, workspaceRoot]);

  useEffect(() => {
    setPointerToolEnabled(initialPointerToolEnabled);
    setAutoFitEnabled(initialAutoFitEnabled);
  }, [workspaceRoot, initialPointerToolEnabled, initialAutoFitEnabled]);

  useEffect(() => {
    onToolStateChange?.(pointerToolEnabled, autoFitEnabled);
  }, [pointerToolEnabled, autoFitEnabled, onToolStateChange]);

  const togglePointerTool = useCallback(() => {
    setPointerToolEnabled((value) => {
      const next = !value;
      if (next) {
        setAutoFitEnabled(false);
        setBlackBoxEnabled(false);
        setMode("select");
      } else {
        setMode("draw");
      }
      return next;
    });
  }, []);

  const toggleAutoFitTool = useCallback(() => {
    setAutoFitEnabled((value) => {
      const next = !value;
      if (next) {
        setPointerToolEnabled(false);
        setBlackBoxEnabled(false);
        setMode("draw");
      } else {
        setMode("draw");
      }
      return next;
    });
  }, []);

  const toggleBlackBoxTool = useCallback(() => {
    setBlackBoxEnabled((value) => {
      const next = !value;
      if (next) {
        setPointerToolEnabled(false);
        setAutoFitEnabled(false);
        setMode("draw");
      } else {
        setMode("draw");
      }
      return next;
    });
  }, []);

  // Single-click class from the class panel: set active class only.
  // Does NOT relabel the selected box — that requires an intentional double-click
  // (applyClassToSelectedBox) to prevent accidental relabeling.
  const assignClass = useCallback(
    async (classId: number) => {
      if (!Number.isInteger(classId) || classId < 0) return;
      if (isArchivedClassId(classId)) {
        setStatus(`Class ${classNameFor(classesRef.current, classId)} is archived. Restore it in Library before using it for new boxes.`);
        return;
      }
      setActiveShortcutSlot(null);
      applyCurrentClass(classId);
      const cls = classesRef.current.find((item) => item.id === classId);
      setClassNameInput(cls?.name || "");
      dragRef.current = null;
      const index = selectedRef.current;
      if (index !== null && boxesRef.current[index]) {
        // A box is selected: inform the user without mutating it.
        setStatus(
          `${classNameFor(classesRef.current, classId)} selected. Double-click to relabel selected box.`
        );
        return;
      }
      if (pointerToolEnabled) {
        setPointerToolEnabled(false);
        setMode("draw");
      }
      setStatus(`Class ${classNameFor(classesRef.current, classId)} selected for new boxes.`);
    },
    [applyCurrentClass, boxesRef, classesRef, dragRef, isArchivedClassId, pointerToolEnabled, selectedRef, setStatus]
  );

  // Double-click class from the class panel: intentionally relabel the selected box.
  const applyClassToSelectedBox = useCallback(
    async (classId: number) => {
      if (!Number.isInteger(classId) || classId < 0) return;
      if (isArchivedClassId(classId)) {
        setStatus(`Class ${classNameFor(classesRef.current, classId)} is archived. Restore it before relabeling boxes to it.`);
        return;
      }
      const index = selectedRef.current;
      if (index === null || !boxesRef.current[index]) return;
      applyCurrentClass(classId);
      const cls = classesRef.current.find((item) => item.id === classId);
      setClassNameInput(cls?.name || "");
      pushUndo("change class");
      const next = boxesRef.current.map((box, itemIndex) =>
        itemIndex === index ? { ...box, classId } : box
      );
      boxesRef.current = next;
      setBoxes(next);
      await persistLabels(`Relabeled selected box to ${classNameFor(classesRef.current, classId)}.`);
      scheduleDraw();
    },
    [applyCurrentClass, boxesRef, classesRef, isArchivedClassId, persistLabels, pushUndo, scheduleDraw, selectedRef, setBoxes, setStatus]
  );

  // Keyboard shortcut 1–0: apply stored class + mode. Does NOT relabel selected box.
  const selectClassShortcut = useCallback(
    (slot: number, useSlot = true) => {
      const slotData = useSlot ? shortcutSlots[slot] : null;
      const classId = slotData?.classId ?? (useSlot ? undefined : slot);
      if (classId == null || !classes.some((item) => item.id === classId) || isArchivedClassId(classId)) {
        if (classId != null && isArchivedClassId(classId)) {
          setStatus(`Shortcut ${slot} points to archived class ${classNameFor(classes, classId)}.`);
        }
        return;
      }

      // Apply the mode stored in the slot without touching selected box.
      if (slotData?.mode === "subject-select") {
        setAutoFitEnabled(true);
        setPointerToolEnabled(false);
        setBlackBoxEnabled(false);
        setMode("draw");
      } else {
        // "draw" mode or legacy (no stored mode)
        setAutoFitEnabled(false);
        if (pointerToolEnabled) {
          setPointerToolEnabled(false);
          setMode("draw");
        }
      }

      setActiveShortcutSlot(useSlot ? slot : null);
      applyCurrentClass(classId);
      const cls = classesRef.current.find((item) => item.id === classId);
      setClassNameInput(cls?.name || "");

      const modeName = slotData?.mode === "subject-select" ? "Subject Select" : "Draw";
      setStatus(
        useSlot
          ? `Shortcut ${slot}: ${classNameFor(classes, classId)} (${modeName}).`
          : `Class ${classNameFor(classes, classId)} selected.`
      );
    },
    [applyCurrentClass, classes, classesRef, isArchivedClassId, pointerToolEnabled, setStatus, shortcutSlots]
  );

  const startFixedBoxRecording = useCallback(
    (slot: number, classId: number | null = currentClass) => {
      const next = fixedBoxSlots.slice();
      if (classId === null || !Number.isInteger(classId)) {
        next[slot] = null;
        setFixedBoxSlots(next);
        if (recordingFixedBoxSlot === slot) setRecordingFixedBoxSlot(null);
        setStatus(`Fixed box ${slot} cleared.`);
        return;
      }
      if (isArchivedClassId(classId)) {
        setStatus(`Class ${classNameFor(classes, classId)} is archived. Restore it before recording a fixed box.`);
        return;
      }
      next[slot] = null;
      setFixedBoxSlots(next);
      applyCurrentClass(classId);
      setRecordingFixedBoxSlot(slot);
      setMode("draw");
      setStatus(
        `Draw one ${classNameFor(classes, classId)} box to record fixed box ${slot}. Hold Alt+${slot} to use it later.`
      );
    },
    [applyCurrentClass, classes, currentClass, fixedBoxSlots, isArchivedClassId, recordingFixedBoxSlot, setFixedBoxSlots, setStatus]
  );

  const recordFixedBoxFromBox = useCallback(
    (box: api.LabelBox) => {
      if (recordingFixedBoxSlot === null) return "";
      const next = fixedBoxSlots.slice();
      next[recordingFixedBoxSlot] = { ...box };
      setFixedBoxSlots(next);
      const slot = recordingFixedBoxSlot;
      setRecordingFixedBoxSlot(null);
      return `Recorded fixed box ${slot}: ${classNameFor(classes, box.classId)}.`;
    },
    [classes, fixedBoxSlots, recordingFixedBoxSlot, setFixedBoxSlots]
  );

  const addClass = useCallback(async () => {
    const name = classNameInput.trim();
    if (!name) {
      setStatus("Enter a class name first.");
      return;
    }
    const existing = classes.find((item) => item.name.toLowerCase() === name.toLowerCase());
    if (existing) {
      if (isArchivedClassId(existing.id)) {
        setStatus(`Class ${existing.name} is archived. Restore it in Library before using it for new boxes.`);
        return;
      }
      await assignClass(existing.id);
      setStatus(`Selected existing class ${classNameFor(classes, existing.id)}.`);
      return;
    }
    const nextId = classes.length ? Math.max(...classes.map((item) => item.id)) + 1 : 0;
    const next = [...classes, { id: nextId, name }];
    const saved = await saveDatasetClassNames(datasetRoot, new Map(next.map((item) => [item.id, item.name])));
    setClasses(saved);
    applyCurrentClass(nextId);
    setStatus(`Created class ${nextId}: ${name}.`);
  }, [applyCurrentClass, assignClass, classNameInput, classes, datasetRoot, isArchivedClassId, setStatus]);

  const sortedClasses = useMemo(
    () => [...classes].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }) || a.id - b.id),
    [classes]
  );

  // Active (non-archived) classes for pickers. Archived classes remain in `classes`
  // and `sortedClasses` so existing annotations still display their class names.
  const activeSortedClasses = useMemo(
    () => sortedClasses.filter((c) => !archivedDetectIds.has(c.id)),
    [sortedClasses, archivedDetectIds]
  );

  useEffect(() => {
    if (selectedRef.current !== null) return;
    if (classes.some((item) => item.id === currentClass && !archivedDetectIds.has(item.id))) return;
    const next = classes.find((item) => !archivedDetectIds.has(item.id));
    if (next) applyCurrentClass(next.id);
  }, [applyCurrentClass, archivedDetectIds, classes, currentClass, selectedRef]);

  const filteredClasses = useMemo(() => {
    const terms = classSearch.trim().toLowerCase().split(" ").filter(Boolean);
    if (!terms.length) return activeSortedClasses;
    return activeSortedClasses.filter((item) => {
      const text = `${item.id} ${item.name}`.toLowerCase();
      return terms.every((term) => text.includes(term));
    });
  }, [classSearch, activeSortedClasses]);

  const classShortcutOptions = useCallback(
    (slot: number): ShortcutOption[] => {
      const slotData = shortcutSlots[slot];
      const boundId = slotData?.classId;
      return [
        { value: "", label: "empty", searchText: "empty none clear", selected: slotData == null },
        ...activeSortedClasses.map((item) => ({
          value: String(item.id),
          label: `${item.id}: ${item.name}`,
          searchText: `${item.id} ${item.name}`,
          selected: boundId === item.id
        }))
      ];
    },
    [shortcutSlots, activeSortedClasses]
  );

  const fixedShortcutOptions = useCallback(
    (slot: number): ShortcutOption[] => {
      const template = fixedBoxSlots[slot];
      const ready = Boolean(template && template.w > 0 && template.h > 0);
      const classId = template?.classId;
      const hasClass = classId != null && classes.some((item) => item.id === classId && !archivedDetectIds.has(item.id));
      return [
        { value: "", label: "Alt: empty", searchText: "alt empty none clear", selected: !hasClass },
        ...activeSortedClasses.map((item) => ({
          value: String(item.id),
          label: `${item.id}: ${item.name}${ready && classId === item.id ? " ready" : ""}`,
          searchText: `${item.id} ${item.name}`,
          selected: hasClass && classId === item.id
        }))
      ];
    },
    [archivedDetectIds, classes, fixedBoxSlots, activeSortedClasses]
  );

  return {
    classes,
    classesRef,
    setClasses,
    currentClass,
    setCurrentClass: applyCurrentClass,
    classRef,
    mode,
    setMode,
    modeRef,
    classNameInput,
    setClassNameInput,
    classSearch,
    setClassSearch,
    shortcutSlots,
    setShortcutSlots,
    archivedDetectIds,
    archivedDetectIdsRef,
    archivedClassKeysRef,
    isArchivedDetectClass: isArchivedClassId,
    isArchivedClassKey,
    fixedBoxSlots,
    setFixedBoxSlots,
    recordingFixedBoxSlot,
    activeShortcutSlot,
    fixedShortcutMode,
    pointerToolEnabled,
    autoFitEnabled,
    blackBoxEnabled,
    boxAdjustMode,
    setBoxAdjustMode,
    togglePointerTool,
    toggleAutoFitTool,
    toggleBlackBoxTool,
    assignClass,
    applyClassToSelectedBox,
    addClass,
    selectClassShortcut,
    startFixedBoxRecording,
    recordFixedBoxFromBox,
    filteredClasses,
    classShortcutOptions,
    fixedShortcutOptions
  };
}
