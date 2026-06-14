import React, { useEffect, useRef, useState } from "react";
import * as api from "../../api";
import { datasetImageUrl, invalidateDatasetImageUrl } from "../dataset-review/datasetAssets";
import { loadMetadataMap, isFlaggedFile, isReviewedFile } from "../image-pool/metadata";
import type { MetadataRow } from "../image-pool/types";
import {
  classMapToLabelClasses,
  loadDatasetClassNames,
  loadEntryLabels,
  saveDatasetClassNames,
  saveEntryLabels,
  type BoxLabelEntry
} from "./boxLabelCore";
import { autoFitSubjectFromImage, selectionTooSmallPixels } from "./autoFitSubject";
import {
  SLOT_ORDER,
  arrowKeyDelta,
  boxCenterPixel,
  boxToImagePixelRect,
  boxToRect,
  canvasToImagePoint,
  classNameFor,
  clamp,
  clampViewportPan,
  defaultPoolLabelCursor,
  resolvePoolLabelCursor,
  drawBoxes,
  drawCenteredText,
  drawCrosshair,
  drawGrid,
  drawImageRect,
  drawZoomBoxes,
  drawZoomGrid,
  enforceMinRect,
  eventCanvasPoint,
  hitTest,
  imageDisplayRect,
  imagePixelPointToNormalized,
  imagePixelToZoomCanvas,
  loadCanvasImage,
  loadShortcutSlots,
  mergeCopiedBoxWithIndex,
  findNearestBoxIndex,
  mergeCopiedBox,
  normalizedImageRect,
  pixelRectToBox,
  pointerImagePointFromCanvas,
  rectToBox,
  resizeCanvasToParent,
  resizeOrMovePixelRect,
  zoomSourceRect,
  type BoxAdjustMode,
  type DisplayRect,
  type DragState,
  type ImagePixelPoint,
  type ImagePoint,
  type ToolMode,
  type Viewport
} from "./geometry";
import { BoxLabelPreviewToolbar } from "./BoxLabelPreviewToolbar";
import { BoxLabelShortcutDropdown } from "./BoxLabelShortcutDropdown";
import type { FixedBoxSlot } from "./session";

type UndoSnapshot =
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

export const BoxLabelView = React.memo(function BoxLabelView({
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
  metadata,
  onAddIncludeClass,
  onAddExcludeClass,
  onClearClassFilters,
  onImageViewModeChange,
  onToggleReviewed,
  onToggleFlagged,
  onLabelsChanged,
  onMetadataChanged,
  onStatusText,
  onMarkJunk,
  onUndoJunk
}: {
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
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const zoomCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const displayRef = useRef<DisplayRect | null>(null);
  const viewportRef = useRef<Viewport>({ zoom: 1, panX: 0, panY: 0 });
  const boxesRef = useRef<api.LabelBox[]>([]);
  const selectedRef = useRef<number | null>(null);
  const modeRef = useRef<ToolMode>("draw");
  const classRef = useRef(0);
  const showGridRef = useRef(true);
  const boxAdjustModeRef = useRef<BoxAdjustMode>("grow");
  const zoomPointRef = useRef<ImagePixelPoint | null>(null);
  const lastZoomCenterRef = useRef<ImagePixelPoint | null>(null);
  const dragRef = useRef<DragState>(null);
  const rafRef = useRef<number | null>(null);
  const undoRef = useRef<UndoSnapshot[]>([]);
  const selectedFilenamesRef = useRef(selectedFilenames);
  const shiftSelectedFilenamesRef = useRef(shiftSelectedFilenames);
  const pendingBoxSelectionRef = useRef<{ boxIndex: number; classId: number } | null>(null);
  const pendingNearestBoxRef = useRef<api.LabelBox | null>(null);
  const keyboardAdjustingRef = useRef(false);

  const [boxes, setBoxes] = useState<api.LabelBox[]>([]);
  const [classes, setClasses] = useState<api.LabelClass[]>([]);
  const classesRef = useRef(classes);
  classesRef.current = classes;
  const [selectedBoxId, setSelectedBoxId] = useState<number | null>(null);
  const [currentClass, setCurrentClass] = useState(0);
  const [mode, setMode] = useState<ToolMode>("draw");
  const [showGrid, setShowGrid] = useState(true);
  const [boxAdjustMode, setBoxAdjustMode] = useState<BoxAdjustMode>("grow");
  const [shortcutSlots, setShortcutSlots] = useState<Array<number | null>>(() => loadShortcutSlots(workspaceRoot));
  const [fixedBoxSlots, setFixedBoxSlots] = useState<Array<FixedBoxSlot | null>>(() => Array.from({ length: 10 }, () => null));
  const [recordingFixedBoxSlot, setRecordingFixedBoxSlot] = useState<number | null>(null);
  const [autoFitEnabled, setAutoFitEnabled] = useState(initialAutoFitEnabled);
  const [blackBoxEnabled, setBlackBoxEnabled] = useState(false);
  const [pointerToolEnabled, setPointerToolEnabled] = useState(initialPointerToolEnabled);
  const [tracking, setTracking] = useState(false);
  const [imageVersion, setImageVersion] = useState(0);
  const [classNameInput, setClassNameInput] = useState("");
  const [classSearch, setClassSearch] = useState("");
  const [fixedShortcutMode, setFixedShortcutMode] = useState(false);
  const [activeShortcutSlot, setActiveShortcutSlot] = useState<number | null>(null);
  const [status, setStatus] = useState("拖框创建。A/D 切换图片，0-9 分配类别。J 标记废片，Ctrl+Shift+Z 撤回。");
  const [error, setError] = useState("");
  const [labelPath, setLabelPath] = useState("");
  const metadataRef = useRef<Map<string, MetadataRow>>(new Map());
  const filename = entry?.basename || "";

  function findEntryByBasename(basename: string) {
    return entries.find((item) => item.basename === basename) || null;
  }

  async function persistEntryLabels(target: BoxLabelEntry, nextBoxes: api.LabelBox[]) {
    await saveEntryLabels(datasetRoot, target, nextBoxes);
    onLabelsChanged(target.basename, nextBoxes);
    return nextBoxes;
  }

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
    selectedFilenamesRef.current = selectedFilenames;
    shiftSelectedFilenamesRef.current = shiftSelectedFilenames;
  }, [selectedFilenames, shiftSelectedFilenames]);

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
    onStatusText?.(status);
  }, [onStatusText, status]);

  useEffect(() => {
    boxesRef.current = boxes;
    scheduleDraw();
  }, [boxes]);

  useEffect(() => {
    selectedRef.current = selectedBoxId;
    scheduleDraw();
  }, [selectedBoxId]);

  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  useEffect(() => {
    classRef.current = currentClass;
  }, [currentClass]);

  useEffect(() => {
    showGridRef.current = showGrid;
    scheduleDraw();
  }, [showGrid]);

  useEffect(() => {
    boxAdjustModeRef.current = boxAdjustMode;
  }, [boxAdjustMode]);

  useEffect(() => {
    const root = document.querySelector(".react-box-label-page");
    if (!root) return;
    root.classList.toggle("pool-label-pointer-tool", pointerToolEnabled);
    root.classList.toggle("pool-label-subject-select", autoFitEnabled);
    root.classList.toggle("pool-label-black-box-tool", blackBoxEnabled);
  }, [pointerToolEnabled, autoFitEnabled, blackBoxEnabled]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || dragRef.current) return;
    canvas.style.cursor = defaultPoolLabelCursor({ pointerToolEnabled, autoFitEnabled, blackBoxEnabled });
    scheduleDraw();
  }, [pointerToolEnabled, autoFitEnabled, blackBoxEnabled]);

  useEffect(() => {
    loadMetadataMap(workspaceRoot)
      .then((map) => {
        metadataRef.current = map;
      })
      .catch(() => {});
  }, [workspaceRoot]);

  useEffect(() => {
    if (initialShortcutSlots) {
      setShortcutSlots(initialShortcutSlots);
    } else {
      setShortcutSlots(Array.from({ length: 10 }, () => null));
    }
  }, [workspaceRoot, initialShortcutSlots]);

  useEffect(() => {
    onShortcutSlotsChange?.(shortcutSlots, fixedBoxSlots);
  }, [shortcutSlots, fixedBoxSlots, onShortcutSlotsChange]);

  useEffect(() => {
    if (initialFixedBoxSlots) setFixedBoxSlots(initialFixedBoxSlots);
    else setFixedBoxSlots(Array.from({ length: 10 }, () => null));
  }, [workspaceRoot, initialFixedBoxSlots]);

  useEffect(() => {
    setPointerToolEnabled(initialPointerToolEnabled);
    setAutoFitEnabled(initialAutoFitEnabled);
  }, [workspaceRoot, initialPointerToolEnabled, initialAutoFitEnabled]);

  useEffect(() => {
    onToolStateChange?.(pointerToolEnabled, autoFitEnabled);
  }, [pointerToolEnabled, autoFitEnabled, onToolStateChange]);

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
      zoomPointRef.current = null;
      dragRef.current = null;
      viewportRef.current = { zoom: 1, panX: 0, panY: 0 };
      try {
        if (imageVersion > 0) invalidateDatasetImageUrl(datasetRoot, entry.imagePath);
        const [labelBoxes, imageUrl] = await Promise.all([
          loadEntryLabels(datasetRoot, entry),
          datasetImageUrl(datasetRoot, entry.imagePath)
        ]);
        const image = await loadCanvasImage(imageUrl);
        if (cancelled) return;
        imageRef.current = image;
        boxesRef.current = labelBoxes;
        setBoxes(labelBoxes);
        setCurrentClass(classes[0]?.id ?? 0);
        setLabelPath(entry.labelPath);
        if (pendingBoxSelectionRef.current) {
          const pending = pendingBoxSelectionRef.current;
          pendingBoxSelectionRef.current = null;
          if (pending.boxIndex >= 0 && pending.boxIndex < labelBoxes.length) {
            setSelectedBoxId(pending.boxIndex);
            setCurrentClass(pending.classId);
            selectedRef.current = pending.boxIndex;
          }
        } else if (pendingNearestBoxRef.current && selectedRef.current === null) {
          const nearest = findNearestBoxIndex(labelBoxes, pendingNearestBoxRef.current);
          pendingNearestBoxRef.current = null;
          if (nearest >= 0) {
            setSelectedBoxId(nearest);
            setCurrentClass(labelBoxes[nearest].classId);
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
        setError(err instanceof Error ? err.message : String(err));
        setStatus("Load failed.");
      }
    }
    load();
    return () => {
      cancelled = true;
      if (rafRef.current !== null) {
        window.cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [classes, datasetRoot, entry, imageVersion]);

  useEffect(() => {
    function resizeCanvases() {
      resizeCanvasToParent(canvasRef.current);
      resizeCanvasToParent(zoomCanvasRef.current);
      scheduleDraw();
    }

    resizeCanvases();
    const observer = new ResizeObserver(resizeCanvases);
    if (stageRef.current) observer.observe(stageRef.current);
    if (zoomCanvasRef.current?.parentElement) observer.observe(zoomCanvasRef.current.parentElement);
    window.addEventListener("resize", resizeCanvases);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", resizeCanvases);
    };
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName.toLowerCase();
      if (tag === "input" || tag === "select" || tag === "textarea" || target?.isContentEditable) return;
      if (event.ctrlKey && event.key.toLowerCase() === "s") {
        event.preventDefault();
        save();
        return;
      }
      if (event.ctrlKey && !event.shiftKey && event.key.toLowerCase() === "z") {
        event.preventDefault();
        undoLast().catch((err) => setError(err instanceof Error ? err.message : String(err)));
        return;
      }
      if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        deleteSelectedBox();
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        dragRef.current = null;
        setSelectedBoxId(null);
        scheduleDraw();
        return;
      }
      const digit = event.code.match(/^Digit(\d)$/);
      if (digit && !event.ctrlKey && !event.altKey && !event.metaKey) {
        event.preventDefault();
        selectClassShortcut(Number(digit[1]));
        return;
      }
      const altDigit = event.code.match(/^Digit(\d)$/);
      if (altDigit && event.altKey && !event.ctrlKey && !event.metaKey) {
        event.preventDefault();
        createFixedBoxFromShortcut(Number(altDigit[1]));
        return;
      }
      if (event.key.toLowerCase() === "a" && !event.ctrlKey && !event.altKey && !event.metaKey) {
        event.preventDefault();
        navigateRelative(-1);
        return;
      }
      if (event.key.toLowerCase() === "d" && !event.ctrlKey && !event.altKey && !event.metaKey) {
        event.preventDefault();
        navigateRelative(1);
        return;
      }
      if (event.key.toLowerCase() === "r" && !event.ctrlKey && !event.altKey && !event.metaKey) {
        event.preventDefault();
        onToggleReviewed().catch((err) => setError(err instanceof Error ? err.message : String(err)));
        return;
      }
      if (event.key.toLowerCase() === "f" && !event.ctrlKey && !event.altKey && !event.metaKey) {
        event.preventDefault();
        onToggleFlagged().catch((err) => setError(err instanceof Error ? err.message : String(err)));
        return;
      }
      if (event.key.toLowerCase() === "w" && !event.ctrlKey && !event.altKey && !event.metaKey) {
        event.preventDefault();
        toggleAutoFitTool();
        return;
      }
      if (event.key.toLowerCase() === "b" && !event.ctrlKey && !event.altKey && !event.metaKey) {
        event.preventDefault();
        toggleBlackBoxTool();
        return;
      }
      if (event.key.toLowerCase() === "t" && event.shiftKey && !event.ctrlKey && !event.altKey && !event.metaKey) {
        event.preventDefault();
        trackCsrtForward().catch((err) => setError(err instanceof Error ? err.message : String(err)));
        return;
      }
      if (event.key.toLowerCase() === "t" && !event.ctrlKey && !event.altKey && !event.metaKey) {
        event.preventDefault();
        copySelectedBoxToNext().catch((err) => setError(err instanceof Error ? err.message : String(err)));
        return;
      }
      if (event.key.toLowerCase() === "j" && !event.ctrlKey && !event.altKey && !event.metaKey) {
        event.preventDefault();
        onMarkJunk?.().catch((err) => setError(err instanceof Error ? err.message : String(err)));
        return;
      }
      if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === "z") {
        event.preventDefault();
        onUndoJunk?.().catch((err) => setError(err instanceof Error ? err.message : String(err)));
        return;
      }
      if (event.key.toLowerCase() === "v" && !event.ctrlKey && !event.altKey && !event.metaKey) {
        event.preventDefault();
        togglePointerTool();
        return;
      }
      if (event.code === "NumpadAdd") {
        event.preventDefault();
        setBoxAdjustMode("grow");
        setStatus("Box keyboard resize: grow.");
        return;
      }
      if (event.code === "NumpadSubtract") {
        event.preventDefault();
        setBoxAdjustMode("shrink");
        setStatus("Box keyboard resize: shrink.");
        return;
      }
      const arrowDelta = arrowKeyDelta(event.key);
      if (arrowDelta) {
        event.preventDefault();
        moveSelectedBoxByKeyboard(arrowDelta.x, arrowDelta.y, event.shiftKey);
        return;
      }
      const numpad = event.code.match(/^Numpad([24568])$/);
      if (numpad) {
        event.preventDefault();
        resizeSelectedBoxByKeyboard(numpad[1], event.shiftKey);
      }
    }
    function onKeyUp() {
      keyboardAdjustingRef.current = false;
    }
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  });

  function scheduleDraw() {
    if (rafRef.current !== null) return;
    rafRef.current = window.requestAnimationFrame(() => {
      rafRef.current = null;
      drawCanvas();
    });
  }

  function drawCanvas() {
    const canvas = canvasRef.current;
    const image = imageRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#0b1220";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (!image) {
      drawCenteredText(ctx, canvas, "Loading image...");
      return;
    }

    const display = imageDisplayRect(canvas, image, viewportRef.current);
    displayRef.current = display;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(image, display.x, display.y, display.w, display.h);
    if (showGridRef.current) drawGrid(ctx, display);
    const crosshairPoint = zoomPointRef.current
      ? imagePixelPointToNormalized(zoomPointRef.current, image.naturalWidth, image.naturalHeight)
      : null;
    if (!pointerToolEnabled && !autoFitEnabled) {
      drawCrosshair(ctx, display, crosshairPoint);
    }
    drawBoxes(ctx, display, boxesRef.current, selectedRef.current, classesRef.current);

    const drag = dragRef.current;
    if (drag?.type === "draw") {
      drawImageRect(ctx, display, normalizedImageRect(drag.start, drag.current), "#f59e0b", true);
    }
    drawZoomCanvas();
  }

  async function save() {
    if (!entry) return;
    try {
      setError("");
      await persistEntryLabels(entry, boxesRef.current);
      setStatus(`Saved ${boxesRef.current.length} box(es) to ${entry.labelPath}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStatus("Save failed.");
    }
  }

  async function persistLabels(statusMessage?: string) {
    if (!entry) return;
    try {
      const next = await persistEntryLabels(entry, boxesRef.current);
      boxesRef.current = next;
      setBoxes(next);
      if (statusMessage) setStatus(statusMessage);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStatus("Save failed.");
    }
  }

  function togglePointerTool() {
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
  }

  function toggleAutoFitTool() {
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
  }

  function toggleBlackBoxTool() {
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
  }

  function pushUndo(action: string) {
    undoRef.current.push({
      type: "labels",
      action,
      filename,
      boxes: boxesRef.current.map((box) => ({ ...box })),
      selectedBoxId: selectedRef.current,
      classId: classRef.current
    });
    if (undoRef.current.length > 50) undoRef.current.shift();
  }

  async function undoLast() {
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
      setSelectedBoxId(snapshot.selectedBoxId !== null && snapshot.selectedBoxId < boxesRef.current.length ? snapshot.selectedBoxId : null);
      setCurrentClass(snapshot.classId);
    }
    setStatus(`Undid ${snapshot.action}.`);
    scheduleDraw();
  }

  function deleteSelectedBox() {
    const index = selectedRef.current;
    if (index === null) return;
    pushUndo("delete box");
    const next = boxesRef.current.filter((_, itemIndex) => itemIndex !== index);
    boxesRef.current = next;
    setBoxes(next);
    setSelectedBoxId(null);
    void persistLabels("Deleted selected box.");
    scheduleDraw();
  }

  function setSelectedClass(classId: number) {
    void assignClass(classId);
  }

  async function assignClass(classId: number) {
    if (!Number.isInteger(classId) || classId < 0) return;
    setActiveShortcutSlot(null);
    setCurrentClass(classId);
    const cls = classesRef.current.find((item) => item.id === classId);
    setClassNameInput(cls?.name || "");
    dragRef.current = null;
    const index = selectedRef.current;
    if (index !== null && boxesRef.current[index]) {
      pushUndo("change class");
      const next = boxesRef.current.map((box, itemIndex) => (itemIndex === index ? { ...box, classId } : box));
      boxesRef.current = next;
      setBoxes(next);
      await persistLabels(`Changed selected box to ${classNameFor(classesRef.current, classId)}.`);
      scheduleDraw();
      return;
    }
    if (pointerToolEnabled) {
      setPointerToolEnabled(false);
      setMode("draw");
    }
    setStatus(`Class ${classNameFor(classesRef.current, classId)} selected for new boxes.`);
  }

  function onPointerDown(event: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    const image = imageRef.current;
    const display = displayRef.current;
    if (!canvas || !image || !display) return;
    try {
      canvas.setPointerCapture(event.pointerId);
    } catch {
      // pointer capture may fail for some auxiliary buttons
    }
    const imageW = image.naturalWidth;
    const imageH = image.naturalHeight;
    const canvasPoint = eventCanvasPoint(event, canvas);
    if (event.button === 1 || event.button === 2) {
      event.preventDefault();
      zoomPointRef.current = null;
      dragRef.current = {
        type: "pan",
        startClientX: event.clientX,
        startClientY: event.clientY,
        startPanX: viewportRef.current.panX,
        startPanY: viewportRef.current.panY
      };
      canvas.style.cursor = "grabbing";
      scheduleDraw();
      return;
    }
    const clampedPixel = pointerImagePointFromCanvas(canvasPoint, display, imageW, imageH, { clamp: true });
    if (clampedPixel) {
      zoomPointRef.current = clampedPixel;
      lastZoomCenterRef.current = clampedPixel;
    }
    const pixelPoint = pointerImagePointFromCanvas(canvasPoint, display, imageW, imageH);
    if (!pixelPoint) return;
    const imagePoint = imagePixelPointToNormalized(pixelPoint, imageW, imageH);

    if (modeRef.current === "draw" || blackBoxEnabled || autoFitEnabled) {
      setSelectedBoxId(null);
      dragRef.current = { type: "draw", start: imagePoint, current: imagePoint };
      scheduleDraw();
      return;
    }

    const hit = hitTest(canvasPoint, display, boxesRef.current, imageW, imageH);
    if (hit.index >= 0) {
      pushUndo("edit box");
      setSelectedBoxId(hit.index);
      setCurrentClass(boxesRef.current[hit.index].classId);
      zoomPointRef.current = boxCenterPixel(boxesRef.current[hit.index], imageW, imageH);
      lastZoomCenterRef.current = zoomPointRef.current;
      dragRef.current = {
        type: "box",
        index: hit.index,
        handle: hit.handle,
        start: pixelPoint,
        startRect: boxToImagePixelRect(boxesRef.current[hit.index], imageW, imageH),
        moved: false
      };
    } else {
      setSelectedBoxId(null);
    }
    scheduleDraw();
  }

  function onPointerMove(event: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    const image = imageRef.current;
    const display = displayRef.current;
    if (!canvas || !display) return;
    const drag = dragRef.current;
    const canvasPoint = eventCanvasPoint(event, canvas);
    const imageW = image?.naturalWidth || 1;
    const imageH = image?.naturalHeight || 1;

    if (drag?.type === "pan") {
      if (!image) return;
      viewportRef.current = clampViewportPan(canvas, image, {
        ...viewportRef.current,
        panX: drag.startPanX + (event.clientX - drag.startClientX),
        panY: drag.startPanY + (event.clientY - drag.startClientY)
      });
      canvas.style.cursor = "grabbing";
      scheduleDraw();
      return;
    }

    const clampedPixel = pointerImagePointFromCanvas(canvasPoint, display, imageW, imageH, { clamp: true });
    if (clampedPixel) {
      zoomPointRef.current = clampedPixel;
      lastZoomCenterRef.current = clampedPixel;
    }
    if (!drag) {
      canvas.style.cursor = resolvePoolLabelCursor(
        canvasPoint,
        display,
        boxesRef.current,
        modeRef.current,
        imageW,
        imageH,
        { pointerToolEnabled, autoFitEnabled, blackBoxEnabled }
      );
      scheduleDraw();
      return;
    }

    const pixelPoint = pointerImagePointFromCanvas(canvasPoint, display, imageW, imageH, { clamp: true });
    if (!pixelPoint) return;
    const imagePoint = imagePixelPointToNormalized(pixelPoint, imageW, imageH);

    if (drag.type === "draw") {
      drag.current = imagePoint;
      scheduleDraw();
      return;
    }

    if (drag.type === "box") {
      const nextRect = resizeOrMovePixelRect(drag.startRect, drag.handle, drag.start, pixelPoint, imageW, imageH);
      const box = boxesRef.current[drag.index];
      if (!box) return;
      const next = boxesRef.current.slice();
      next[drag.index] = pixelRectToBox(nextRect, box.classId, imageW, imageH);
      boxesRef.current = next;
      drag.moved = true;
      scheduleDraw();
    }
  }

  function onPointerUp(event: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    const display = displayRef.current;
    if (!canvas || !display) return;
    try {
      canvas.releasePointerCapture(event.pointerId);
    } catch {
      // pointer capture may already be released
    }
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag) return;

    if (drag.type === "pan") {
      canvas.style.cursor = defaultPoolLabelCursor({ pointerToolEnabled, autoFitEnabled, blackBoxEnabled });
      scheduleDraw();
      return;
    }

    if (drag.type === "draw") {
      const image = imageRef.current;
      if (!image) {
        scheduleDraw();
        return;
      }
      const rect = normalizedImageRect(drag.start, drag.current);
      const shouldAutoFit = autoFitEnabled && !event.shiftKey && !blackBoxEnabled;
      const shouldBlackBox = blackBoxEnabled;
      if (selectionTooSmallPixels(rect, image.naturalWidth, image.naturalHeight, { allowAutoFitClick: shouldAutoFit })) {
        scheduleDraw();
        return;
      }
      if (shouldBlackBox) {
        applyBlackBox(rect).catch((err) => setError(err instanceof Error ? err.message : String(err)));
        scheduleDraw();
        return;
      }
      pushUndo("add box");
      const fittedRect = shouldAutoFit ? autoFitSubjectFromImage(image, rect, drag.start) || rect : rect;
      const box = rectToBox(fittedRect, classRef.current);
      const next = [...boxesRef.current, box];
      boxesRef.current = next;
      setBoxes(next);
      setSelectedBoxId(next.length - 1);
      const recordMessage = recordFixedBoxFromBox(box);
      syncBoxToSelected(box, "sync added box", { pushUndo: false }).catch(() => {});
      void persistLabels(
        recordMessage || (fittedRect !== rect ? "Color subject box saved. Shift keeps drawn box." : "Box added.")
      );
    } else if (drag.type === "box" && drag.moved) {
      setBoxes(boxesRef.current.slice());
      const box = boxesRef.current[drag.index];
      if (box) syncBoxToSelected(box, "sync edited box", { pushUndo: false }).catch(() => {});
      void persistLabels("Box edited.");
    }
    scheduleDraw();
  }

  function onWheel(event: React.WheelEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    const display = displayRef.current;
    if (!canvas || !display || !imageRef.current) return;
    event.preventDefault();
    const point = eventCanvasPoint(event, canvas);
    const before = canvasToImagePoint(point, display);
    const factor = event.deltaY < 0 ? 1.15 : 1 / 1.15;
    viewportRef.current.zoom = clamp(viewportRef.current.zoom * factor, 1, 12);
    if (before) {
      const nextDisplay = imageDisplayRect(canvas, imageRef.current, viewportRef.current);
      viewportRef.current.panX += point.x - (nextDisplay.x + before.x * nextDisplay.w);
      viewportRef.current.panY += point.y - (nextDisplay.y + before.y * nextDisplay.h);
    }
    viewportRef.current = clampViewportPan(canvas, imageRef.current, viewportRef.current);
    scheduleDraw();
  }

  function selectClassShortcut(slot: number, useSlot = true) {
    const classId = useSlot ? shortcutSlots[slot] : slot;
    if (classId === null || !classes.some((item) => item.id === classId)) return;
    setActiveShortcutSlot(useSlot ? slot : null);
    setSelectedClass(classId);
    setStatus(useSlot ? `Selected shortcut ${slot}: ${classNameFor(classes, classId)}.` : `Selected class ${classNameFor(classes, classId)}.`);
  }

  function startFixedBoxRecording(slot: number, classId: number | null = currentClass) {
    const next = fixedBoxSlots.slice();
    if (classId === null || !Number.isInteger(classId)) {
      next[slot] = null;
      setFixedBoxSlots(next);
      if (recordingFixedBoxSlot === slot) setRecordingFixedBoxSlot(null);
      setStatus(`Fixed box ${slot} cleared.`);
      return;
    }
    next[slot] = null;
    setFixedBoxSlots(next);
    setCurrentClass(classId);
    setRecordingFixedBoxSlot(slot);
    setMode("draw");
    setStatus(`Draw one ${classNameFor(classes, classId)} box to record fixed box ${slot}. Hold Alt+${slot} to use it later.`);
  }

  function recordFixedBoxFromBox(box: api.LabelBox) {
    if (recordingFixedBoxSlot === null) return "";
    const next = fixedBoxSlots.slice();
    next[recordingFixedBoxSlot] = { ...box };
    setFixedBoxSlots(next);
    const slot = recordingFixedBoxSlot;
    setRecordingFixedBoxSlot(null);
    return `Recorded fixed box ${slot}: ${classNameFor(classes, box.classId)}.`;
  }

  function navigateRelative(delta: number) {
    if (currentIndex < 0) return;
    const nextIndex = currentIndex + delta;
    if (nextIndex < 0 || nextIndex >= entries.length) {
      setStatus(delta < 0 ? "Already at first image." : "Already at last image.");
      return;
    }
    save()
      .catch(() => {})
      .finally(() => onNavigate(nextIndex));
  }

  function createFixedBoxFromShortcut(slot: number) {
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
  }

  function updateSelectedBox(mutator: (box: api.LabelBox) => api.LabelBox, message: string) {
    const index = selectedRef.current;
    if (index === null) return;
    const current = boxesRef.current[index];
    if (!current) return;
    const next = boxesRef.current.slice();
    next[index] = mutator(current);
    boxesRef.current = next;
    setBoxes(next);
    const image = imageRef.current;
    if (image) {
      zoomPointRef.current = boxCenterPixel(next[index], image.naturalWidth, image.naturalHeight);
      lastZoomCenterRef.current = zoomPointRef.current;
    }
    void persistLabels(message);
    scheduleDraw();
  }

  function moveSelectedBoxByKeyboard(dx: number, dy: number, fast: boolean) {
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
    }, "Box moved with keyboard.");
    const index = selectedRef.current;
    if (index !== null) syncBoxToSelected(boxesRef.current[index], "sync keyboard adjust", { pushUndo: false }).catch(() => {});
  }

  function resizeSelectedBoxByKeyboard(key: string, fast: boolean) {
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
    }, `Box resized with numpad (${boxAdjustModeRef.current}).`);
    const index = selectedRef.current;
    if (index !== null) syncBoxToSelected(boxesRef.current[index], "sync keyboard resize", { pushUndo: false }).catch(() => {});
  }

  async function saveEmpty() {
    if (!entry) return;
    pushUndo("save empty");
    boxesRef.current = [];
    setBoxes([]);
    setSelectedBoxId(null);
    await persistEntryLabels(entry, []);
    setStatus(`Saved empty TXT to ${entry.labelPath}.`);
    scheduleDraw();
  }

  async function copySelectedBoxToNext() {
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
  }

  async function syncBoxToSelected(
    box: api.LabelBox | undefined,
    action: string,
    options: { pushUndo?: boolean } = {}
  ) {
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
      undoRef.current.push({ type: "batch-labels", action, snapshots });
      if (undoRef.current.length > 50) undoRef.current.shift();
    }
    setStatus(`Synced box to ${targets.length} selected image(s).`);
    return targets.length;
  }

  async function trackCsrtForward() {
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
      const stoppedIndex = result.stoppedAt
        ? entries.findIndex((item) => item.imagePath === result.stoppedAt)
        : -1;
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
  }

  async function restoreBackup() {
    if (!entry) return;
    if (!window.confirm(`Restore current image and label from image_pool_backup?\n\nimage_pool/${filename}`)) return;
    const result = await api.restoreImagePoolBackup(workspaceRoot, `image_pool/${filename}`);
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
  }

  async function applyBlackBox(rect: import("./geometry").ImageRect) {
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
    undoRef.current.push({ type: "image", action: "black box", filename, imageBase64: before });
    if (undoRef.current.length > 50) undoRef.current.shift();
    await api.ensureImagePoolBackup(workspaceRoot, `image_pool/${filename}`);
    ctx.fillStyle = "#000000";
    ctx.fillRect(
      Math.round(rect.x1 * canvas.width),
      Math.round(rect.y1 * canvas.height),
      Math.round((rect.x2 - rect.x1) * canvas.width),
      Math.round((rect.y2 - rect.y1) * canvas.height)
    );
    const base64 = canvas.toDataURL(mime, 0.95).split(",")[1] || "";
    await api.writeFileBase64(workspaceRoot, `image_pool/${filename}`, base64);
    setImageVersion((value) => value + 1);
    setStatus("Applied black box to image.");
  }

  function imageMimeForFilename(name: string) {
    const lower = name.toLowerCase();
    if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
    if (lower.endsWith(".webp")) return "image/webp";
    return "image/png";
  }

  async function addClass() {
    const name = classNameInput.trim();
    if (!name) {
      setStatus("Enter a class name first.");
      return;
    }
    const existing = classes.find((item) => item.name.toLowerCase() === name.toLowerCase());
    if (existing) {
      setSelectedClass(existing.id);
      setStatus(`Selected existing class ${classNameFor(classes, existing.id)}.`);
      return;
    }
    const nextId = classes.length ? Math.max(...classes.map((item) => item.id)) + 1 : 0;
    const next = [...classes, { id: nextId, name }];
    const saved = await saveDatasetClassNames(
      datasetRoot,
      new Map(next.map((item) => [item.id, item.name]))
    );
    setClasses(saved);
    setCurrentClass(nextId);
    setStatus(`Created class ${nextId}: ${name}.`);
  }

  function drawZoomCanvas() {
    const canvas = zoomCanvasRef.current;
    const image = imageRef.current;
    const display = displayRef.current;
    if (!canvas || !image || !display) return;
    const drag = dragRef.current;
    if (drag?.type === "box" || drag?.type === "pan") return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#111827";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const imageW = image.naturalWidth;
    const imageH = image.naturalHeight;
    const selected = selectedRef.current;
    const center =
      zoomPointRef.current ??
      lastZoomCenterRef.current ??
      (selected !== null ? boxCenterPixel(boxesRef.current[selected], imageW, imageH) : { x: imageW / 2, y: imageH / 2 });
    const sourceRectPx = zoomSourceRect(center, display, imageW, imageH);
    const sourceRect = {
      x1: sourceRectPx.x1 / imageW,
      y1: sourceRectPx.y1 / imageH,
      x2: sourceRectPx.x2 / imageW,
      y2: sourceRectPx.y2 / imageH
    };
    const srcW = sourceRectPx.x2 - sourceRectPx.x1;
    const srcH = sourceRectPx.y2 - sourceRectPx.y1;

    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(image, sourceRectPx.x1, sourceRectPx.y1, srcW, srcH, 0, 0, canvas.width, canvas.height);
    drawZoomGrid(ctx, canvas);
    drawZoomBoxes(ctx, canvas, sourceRect, boxesRef.current, selected);
    const cross = imagePixelToZoomCanvas(center, sourceRectPx, canvas.width, canvas.height);
    ctx.strokeStyle = "#ef4444";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cross.x, 0);
    ctx.lineTo(cross.x, canvas.height);
    ctx.moveTo(0, cross.y);
    ctx.lineTo(canvas.width, cross.y);
    ctx.stroke();
  }

  const selectedBox = selectedBoxId !== null ? boxes[selectedBoxId] : null;
  const currentMeta = metadata.get(filename);
  const selectedCount = selectedFilenames.size;
  const filterText = [
    includeClasses.size ? `include ${[...includeClasses].sort((a, b) => a - b).join(",")}` : "",
    excludeClasses.size ? `exclude ${[...excludeClasses].sort((a, b) => a - b).join(",")}` : "",
    imageViewMode !== "all" ? imageViewMode : ""
  ].filter(Boolean).join(" | ");

  const sortedClasses = [...classes].sort(
    (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }) || a.id - b.id
  );
  const filteredClasses = sortedClasses.filter((item) => {
    const terms = classSearch.trim().toLowerCase().split(" ").filter(Boolean);
    if (!terms.length) return true;
    const text = `${item.id} ${item.name}`.toLowerCase();
    return terms.every((term) => text.includes(term));
  });

  function fixedBoxReady(slot: FixedBoxSlot | null) {
    return Boolean(slot && slot.w > 0 && slot.h > 0);
  }

  function classShortcutOptions(slot: number) {
    const bound = shortcutSlots[slot];
    return [
      { value: "", label: "empty", searchText: "empty none clear", selected: bound == null },
      ...sortedClasses.map((item) => ({
        value: String(item.id),
        label: `${item.id}: ${item.name}`,
        searchText: `${item.id} ${item.name}`,
        selected: bound === item.id
      }))
    ];
  }

  function fixedShortcutOptions(slot: number) {
    const template = fixedBoxSlots[slot];
    const ready = fixedBoxReady(template);
    const classId = template?.classId;
    const hasClass = classId != null && classes.some((item) => item.id === classId);
    const label = hasClass
      ? `Alt: ${classId}: ${classNameFor(classes, classId!)}${ready ? " ready" : ""}`
      : "Alt: empty";
    return [
      { value: "", label: "Alt: empty", searchText: "alt empty none clear", selected: !hasClass },
      ...sortedClasses.map((item) => ({
        value: String(item.id),
        label: `${item.id}: ${item.name}${ready && classId === item.id ? " ready" : ""}`,
        searchText: `${item.id} ${item.name}`,
        selected: hasClass && classId === item.id
      }))
    ];
  }

  return (
    <>
      <section
        className={`pool-label-shortcuts-panel${fixedShortcutMode ? " fixed-mode" : " class-mode"}`}
        id="poolLabelShortcutsPanel"
      >
        <div className="pool-label-shortcuts" id="poolLabelShortcuts">
          {SLOT_ORDER.map((slot) => {
            const classId = shortcutSlots[slot];
            const bound = classId != null && classes.some((item) => item.id === classId);
            return (
              <div className="pool-label-shortcut-slot" key={slot}>
                <div className="pool-label-shortcut-number">{slot}</div>
                <BoxLabelShortcutDropdown
                  className="class-slot"
                  title={`Shortcut ${slot}`}
                  label={bound ? `${classId}: ${classNameFor(classes, classId!)}` : "empty"}
                  active={bound && classId === currentClass && activeShortcutSlot === slot}
                  options={classShortcutOptions(slot)}
                  onSelect={(value) => {
                    const next = shortcutSlots.slice();
                    next[slot] = value === "" ? null : Number(value);
                    setShortcutSlots(next);
                    if (value !== "") selectClassShortcut(slot, true);
                    else setStatus(`Shortcut ${slot} cleared.`);
                  }}
                />
                <BoxLabelShortcutDropdown
                  className="fixed-slot"
                  title={`Alt shortcut ${slot}`}
                  label={
                    fixedBoxSlots[slot]?.classId != null
                      ? fixedShortcutOptions(slot).find((item) => item.selected)?.label || "Alt: empty"
                      : "Alt: empty"
                  }
                  active={fixedBoxReady(fixedBoxSlots[slot])}
                  recording={recordingFixedBoxSlot === slot}
                  options={fixedShortcutOptions(slot)}
                  onSelect={(value) => {
                    startFixedBoxRecording(slot, value === "" ? null : Number(value));
                  }}
                />
              </div>
            );
          })}
        </div>
      </section>

      <section className="panel" id="previewPanel">
        <div className="panel-header">
          <span>Preview</span>
          <span id="boxCount" className="status">
            {boxes.length} box(es)
          </span>
        </div>
        <div className="panel-body viewer" id="previewViewer">
          {error ? <div className="error-banner">{error}</div> : null}
          <div
            className={`canvas-wrap${pointerToolEnabled ? " pool-label-pointer-tool" : ""}${autoFitEnabled ? " pool-label-subject-select" : ""}${blackBoxEnabled ? " pool-label-black-box-tool" : ""}`}
            id="dropZone"
            ref={stageRef}
          >
            <canvas
              id="previewCanvas"
              ref={canvasRef}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
              onContextMenu={(event) => event.preventDefault()}
              onWheel={onWheel}
            />
          </div>
          <aside className="pool-label-zoom-side" id="poolLabelZoomSide">
            <div className="pool-label-zoom-view" id="poolLabelZoomView">
              <canvas id="poolLabelZoomCanvas" ref={zoomCanvasRef} width={500} height={600} />
              <div className="pool-label-zoom-class" id="poolLabelZoomClass">
                {selectedBox
                  ? classNameFor(classes, selectedBox.classId)
                  : classNameFor(classes, currentClass)}
              </div>
            </div>
          </aside>
          <BoxLabelPreviewToolbar
            pointerToolEnabled={pointerToolEnabled}
            autoFitEnabled={autoFitEnabled}
            blackBoxEnabled={blackBoxEnabled}
            boxAdjustMode={boxAdjustMode}
            tracking={tracking}
            canCopyNext={selectedBoxId !== null && currentIndex >= 0 && currentIndex < entries.length - 1}
            onTogglePointerTool={togglePointerTool}
            onToggleAutoFit={toggleAutoFitTool}
            onToggleBlackBox={toggleBlackBoxTool}
            onRestoreBackup={() => restoreBackup().catch((err) => setError(err instanceof Error ? err.message : String(err)))}
            onToggleBoxAdjustMode={() => setBoxAdjustMode((value) => (value === "grow" ? "shrink" : "grow"))}
            onCopyNext={() => copySelectedBoxToNext().catch((err) => setError(err instanceof Error ? err.message : String(err)))}
            onCsrtTrack={() => trackCsrtForward().catch((err) => setError(err instanceof Error ? err.message : String(err)))}
          />
        </div>
      </section>

      <aside className="side-stack pool-label-side-stack" id="poolLabelSideStack">
        <section className="panel pool-label-box-panel" id="poolLabelBoxPanel">
          <div className="panel-header">
            <span>Current Boxes</span>
          </div>
          <div className="panel-body pool-label-box-panel-body">
            <div className="hint" id="poolLabelStatus">
              {status}
              {filterText ? ` | ${filterText}` : ""}
              {shiftSelectedFilenames.size ? ` | selected ${shiftSelectedFilenames.size} image(s)` : ""}
            </div>
            <div className="pool-label-box-list" id="poolLabelBoxList">
              {boxes.length ? (
                boxes.map((box, index) => (
                  <button
                    key={`${index}-${box.classId}-${box.x}-${box.y}`}
                    type="button"
                    className={`pool-label-box-row${selectedBoxId === index ? " selected" : ""}`}
                    onClick={() => {
                      setSelectedBoxId(index);
                      setCurrentClass(box.classId);
                    }}
                  >
                    {index + 1}. {classNameFor(classes, box.classId)} x={box.x.toFixed(3)} y={box.y.toFixed(3)} w={box.w.toFixed(3)} h={box.h.toFixed(3)}
                  </button>
                ))
              ) : (
                <div className="empty">No boxes on this image.</div>
              )}
            </div>
          </div>
        </section>

        <section className="panel filter-panel pool-label-classes-panel">
          <div className="panel-header">
            <span>Classes</span>
            <span className="status">{currentClass}</span>
          </div>
          <div className="panel-body filter-panel-body">
            <div className="pool-label-tools">
              {(includeClasses.size > 0 || excludeClasses.size > 0) && (
                <div className="row yolo-filter-tools" style={{ marginBottom: 8 }}>
                  <button type="button" onClick={() => onClearClassFilters()}>
                    Deselect All Filters
                  </button>
                </div>
              )}
              <div className="row">
                <input id="poolLabelClassNameInput" type="text" placeholder="class name" value={classNameInput} onChange={(event) => setClassNameInput(event.target.value)} />
                <button id="poolLabelAddClassBtn" type="button" className="primary" onClick={addClass}>
                  Add Class
                </button>
              </div>
              <input
                id="poolLabelClassSearchInput"
                className="pool-label-class-search"
                type="search"
                placeholder="search classes"
                value={classSearch}
                onChange={(event) => setClassSearch(event.target.value)}
              />
              <div className="pool-label-class-list" id="poolLabelClassList">
                {filteredClasses.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={`pool-label-class-row${item.id === currentClass ? " selected" : ""}${includeClasses.has(item.id) ? " include-filter" : ""}${excludeClasses.has(item.id) ? " exclude-filter" : ""}`}
                    onClick={() => void assignClass(item.id)}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      if (event.shiftKey) onAddExcludeClass(item.id);
                      else onAddIncludeClass(item.id);
                    }}
                    title="Right-click: Include · Shift+right-click: Exclude"
                  >
                    {item.id}: {item.name}
                    {includeClasses.has(item.id) ? " [inc]" : ""}
                    {excludeClasses.has(item.id) ? " [exc]" : ""}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </section>
      </aside>
    </>
  );
});
