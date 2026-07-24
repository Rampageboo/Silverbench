import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent
} from "react";
import * as api from "../../api";
import { errMessage } from "../../lib/errors";
import { renderMainCanvas } from "../box-label/boxCanvasRenderer";
import {
  boxToCanvasRect,
  canvasToImagePoint,
  enforceMinRect,
  eventCanvasPoint,
  hitTest,
  loadCanvasImage,
  normalizedImageRect,
  previewSourceSize,
  rectToBox,
  resizeCanvasToParent,
  resizeOrMoveRect,
  type DisplayRect,
  type DragHandle,
  type ImagePoint,
  type ImageRect
} from "../box-label/geometry";
import {
  deleteElementAtPath,
  elementEntries,
  imageRectFromPixelBox,
  relRectFromReferenceBoxes,
  renameElementAtPath,
  resolveReferenceBoxes,
  updateElementAtPath,
  type ElementEntry
} from "./editorDomain";
import {
  validateDoc,
  type Associate,
  type DetBox,
  type Element,
  type Page,
  type Predictions,
  type Repeat,
  type UiOrchestrationDoc
} from "./schema";
import "./uiOrchestrator.css";

type UiOrchestratorPageProps = {
  active?: boolean;
  workspaceRoot: string;
  onReady?: () => void;
};

type CanvasDrag =
  | { kind: "draw"; start: ImagePoint; current: ImagePoint }
  | {
      kind: "edit";
      elementName: string;
      handle: DragHandle;
      start: ImagePoint;
      startRect: ImageRect;
    };

function newPage(index: number, clf = ""): Page {
  return {
    id: `Page.${index}`,
    trigger: { clf, minConfidence: 0.9 },
    elements: {}
  };
}

function newDocument(): UiOrchestrationDoc {
  return {
    schemaVersion: "1.0",
    game: "Zenless_Zone_Zero",
    pages: [newPage(1)],
    flows: []
  };
}

function imageMime(path: string) {
  const extension = path.split(".").pop()?.toLowerCase();
  if (extension === "jpg" || extension === "jpeg") return "image/jpeg";
  if (extension === "webp") return "image/webp";
  if (extension === "bmp") return "image/bmp";
  return "image/png";
}

function basename(path: string) {
  return path.split(/[\\/]/).pop() || path;
}

function triggerText(page: Page) {
  return Array.isArray(page.trigger.clf) ? page.trigger.clf.join(", ") : page.trigger.clf;
}

function parseTriggerLabels(text: string): string | string[] {
  const labels = text
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  return labels.length <= 1 ? (labels[0] ?? "") : labels;
}

function nextElementName(entries: ElementEntry[]) {
  const names = new Set(entries.map((entry) => entry.name));
  let index = entries.length + 1;
  while (names.has(`element${index}`)) index += 1;
  return `element${index}`;
}

function elementWithKind(element: Element, kind: Element["kind"]): Element {
  const common = {
    ...(element.in ? { in: element.in } : {}),
    ...(element.detClass ? { detClass: element.detClass } : {}),
    ...(element.relRect ? { relRect: element.relRect } : {})
  };
  if (kind === "container") return { kind, ...common };
  if (kind === "button") {
    return {
      kind,
      ...common,
      ...(element.kind === "button" && element.associate ? { associate: element.associate } : {})
    };
  }
  if (kind === "text") {
    return {
      kind,
      ...common,
      ...(element.kind === "text" && element.phraseTable ? { phraseTable: element.phraseTable } : {})
    };
  }
  return { kind, ...common };
}

function safeDownloadName(name: string) {
  return (
    name
      .trim()
      .replace(/[^A-Za-z0-9._-]+/g, "_")
      .replace(/^\.+|\.+$/g, "") || "ui-map"
  );
}

export function UiOrchestratorPage({ workspaceRoot, onReady }: UiOrchestratorPageProps) {
  const [doc, setDoc] = useState<UiOrchestrationDoc>(newDocument);
  const [pageIndex, setPageIndex] = useState(0);
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const [nameDraft, setNameDraft] = useState("");
  const [mapName, setMapName] = useState("ui-map");
  const [detectClasses, setDetectClasses] = useState<api.LabelClass[]>([]);
  const [clfClasses, setClfClasses] = useState<string[]>([]);
  const [status, setStatus] = useState("Ready. Load a reference image and add a page element.");
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [imageName, setImageName] = useState("");
  const [imagePath, setImagePath] = useState("");
  const [imageRevision, setImageRevision] = useState(0);
  const [detModelPath, setDetModelPath] = useState("");
  const [clfModelPath, setClfModelPath] = useState("");
  const [predictions, setPredictions] = useState<Predictions | null>(null);
  const [predicting, setPredicting] = useState(false);
  const [referenceBoxesByPage, setReferenceBoxesByPage] = useState<Record<string, Record<string, ImageRect>>>(
    {}
  );
  const [canvasDrag, setCanvasDrag] = useState<CanvasDrag | null>(null);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const displayRef = useRef<DisplayRect | null>(null);

  const currentPage = doc.pages[pageIndex] ?? doc.pages[0];
  const entries = useMemo(() => elementEntries(currentPage.elements), [currentPage.elements]);
  const selectedEntry = useMemo(
    () => entries.find((entry) => entry.name === selectedName) ?? null,
    [entries, selectedName]
  );
  const pageReferenceBoxes = useMemo(
    () => referenceBoxesByPage[currentPage.id] ?? {},
    [currentPage.id, referenceBoxesByPage]
  );
  const resolvedBoxes = useMemo(
    () => resolveReferenceBoxes(currentPage, pageReferenceBoxes),
    [currentPage, pageReferenceBoxes]
  );
  const renderedElements = useMemo(
    () =>
      entries.flatMap((entry) => {
        const rect = resolvedBoxes[entry.name];
        return rect ? [{ entry, rect }] : [];
      }),
    [entries, resolvedBoxes]
  );
  const canvasBoxes = useMemo(
    () => renderedElements.map(({ rect }, index) => rectToBox(rect, index)),
    [renderedElements]
  );
  const canvasClasses = useMemo(
    () => renderedElements.map(({ entry }, index) => ({ id: index, name: entry.name })),
    [renderedElements]
  );
  const selectedCanvasIndex = renderedElements.findIndex(({ entry }) => entry.name === selectedName);

  useEffect(() => {
    onReady?.();
  }, [onReady]);

  useEffect(() => {
    setNameDraft(selectedEntry?.name ?? "");
  }, [selectedEntry?.name]);

  useEffect(() => {
    let cancelled = false;
    if (!workspaceRoot.trim()) return;
    void Promise.all([api.loadLabelClasses(workspaceRoot), api.getWorkspaceClassNames(workspaceRoot)])
      .then(([detect, clf]) => {
        if (cancelled) return;
        setDetectClasses(detect);
        setClfClasses(clf);
      })
      .catch((error) => {
        if (!cancelled) setStatus(`Workspace taxonomy unavailable: ${errMessage(error)}`);
      });
    return () => {
      cancelled = true;
    };
  }, [workspaceRoot]);

  const updateCurrentPage = useCallback(
    (update: (page: Page) => Page) => {
      setDoc((current) => ({
        ...current,
        pages: current.pages.map((page, index) => (index === pageIndex ? update(page) : page))
      }));
    },
    [pageIndex]
  );

  const updateSelectedElement = useCallback(
    (update: (element: Element) => Element) => {
      if (!selectedEntry) return;
      updateCurrentPage((page) => ({
        ...page,
        elements: updateElementAtPath(page.elements, selectedEntry.path, update)
      }));
    },
    [selectedEntry, updateCurrentPage]
  );

  const setAuthoredReferenceBox = useCallback(
    (elementName: string, rect: ImageRect | null) => {
      setReferenceBoxesByPage((current) => {
        const pageBoxes = { ...(current[currentPage.id] ?? {}) };
        if (rect) pageBoxes[elementName] = rect;
        else delete pageBoxes[elementName];
        return { ...current, [currentPage.id]: pageBoxes };
      });
    },
    [currentPage.id]
  );

  const commitElementBox = useCallback(
    (elementName: string, rect: ImageRect) => {
      const entry = entries.find((candidate) => candidate.name === elementName);
      if (!entry) return;
      if (entry.parentName && !entry.element.detClass) {
        const parentRect = resolvedBoxes[entry.parentName];
        const relRect = parentRect ? relRectFromReferenceBoxes(rect, parentRect) : null;
        if (!relRect) {
          setStatus(`Draw or resolve parent ${entry.parentName} before drawing ${entry.name}.`);
          return;
        }
        updateCurrentPage((page) => ({
          ...page,
          elements: updateElementAtPath(page.elements, entry.path, (element) => ({
            ...element,
            relRect
          }))
        }));
        setAuthoredReferenceBox(elementName, null);
        setStatus(`${entry.name} relRect updated from its parent reference box.`);
        return;
      }
      setAuthoredReferenceBox(elementName, rect);
      setStatus(`${entry.name} reference box updated.`);
    },
    [entries, resolvedBoxes, setAuthoredReferenceBox, updateCurrentPage]
  );

  const drawCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    displayRef.current = renderMainCanvas({
      canvas,
      image: imageRef.current,
      boxes: canvasBoxes,
      selectedIndex: selectedCanvasIndex >= 0 ? selectedCanvasIndex : null,
      classes: canvasClasses,
      currentClassId: Math.max(0, selectedCanvasIndex),
      showGrid: true,
      viewport: { zoom: 1, panX: 0, panY: 0 },
      drag:
        canvasDrag?.kind === "draw"
          ? { type: "draw", start: canvasDrag.start, current: canvasDrag.current }
          : null,
      zoomPoint: null,
      pointerToolEnabled: false,
      autoFitEnabled: false,
      blackBoxEnabled: false
    });

    // Model-assist overlay: draw predicted DET boxes in a distinct dashed style
    // on top of the authored elements. Display-only (accept is via the panel).
    const display = displayRef.current;
    const [predW, predH] = predictions?.imageSize ?? [0, 0];
    if (display && predictions && predW > 0 && predH > 0) {
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.save();
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 4]);
        ctx.strokeStyle = "#f5a623";
        ctx.font = "12px system-ui, sans-serif";
        ctx.textBaseline = "top";
        predictions.det.forEach((det) => {
          const rect = boxToCanvasRect(
            {
              x1: det.box[0] / predW,
              y1: det.box[1] / predH,
              x2: det.box[2] / predW,
              y2: det.box[3] / predH
            },
            display
          );
          ctx.strokeRect(rect.x1, rect.y1, rect.x2 - rect.x1, rect.y2 - rect.y1);
          ctx.fillStyle = "#f5a623";
          ctx.fillText(`${det.class} ${(det.conf * 100).toFixed(0)}%`, rect.x1 + 3, rect.y1 + 3);
        });
        ctx.restore();
      }
    }
  }, [canvasBoxes, canvasClasses, canvasDrag, predictions, selectedCanvasIndex]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const resize = () => {
      resizeCanvasToParent(canvas);
      drawCanvas();
    };
    resize();
    const observer = new ResizeObserver(resize);
    if (canvas.parentElement) observer.observe(canvas.parentElement);
    window.addEventListener("resize", resize);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", resize);
    };
  }, [drawCanvas]);

  useEffect(() => {
    drawCanvas();
  }, [drawCanvas, imageRevision]);

  async function chooseReferenceImage() {
    try {
      const paths = await api.chooseImageFiles("Choose UI Orchestrator reference image");
      const path = paths[0];
      if (!path) return;
      const base64 = await api.readImageFileBase64(path);
      imageRef.current = await loadCanvasImage(`data:${imageMime(path)};base64,${base64}`);
      setImageName(basename(path));
      setImagePath(path);
      setPredictions(null);
      setImageRevision((value) => value + 1);
      setStatus(`Loaded reference image ${basename(path)}.`);
    } catch (error) {
      setStatus(`Reference image failed: ${errMessage(error)}`);
    }
  }

  async function chooseModel(kind: "det" | "clf") {
    try {
      const path = await api.chooseTrainModelFile(
        kind === "det" ? "Choose detector .pt model" : "Choose classifier .pt model"
      );
      if (!path) return;
      if (kind === "det") setDetModelPath(path);
      else setClfModelPath(path);
      setStatus(`${kind === "det" ? "Detector" : "Classifier"} model: ${basename(path)}`);
    } catch (error) {
      setStatus(`Model selection failed: ${errMessage(error)}`);
    }
  }

  async function runPredictions() {
    if (!imagePath) {
      setStatus("Load a reference image before running predictions.");
      return;
    }
    if (!detModelPath && !clfModelPath) {
      setStatus("Choose a detector and/or classifier model first.");
      return;
    }
    setPredicting(true);
    setStatus("Running predictions on the reference frame…");
    try {
      const result = await api.runReferencePredictions(
        imagePath,
        detModelPath || null,
        clfModelPath || null,
        { confidence: 0.25 }
      );
      setPredictions(result);
      const clfText = result.clf.label
        ? `CLF ${result.clf.label} ${(result.clf.conf * 100).toFixed(0)}%`
        : "no CLF";
      setStatus(`Predictions ready: ${result.det.length} detections · ${clfText}.`);
    } catch (error) {
      setStatus(`Prediction failed: ${errMessage(error)}`);
    } finally {
      setPredicting(false);
    }
  }

  function acceptPrediction(det: DetBox) {
    if (!predictions) return;
    const base = (det.class || "element").replace(/[^A-Za-z0-9_]+/g, "_").replace(/^_+|_+$/g, "") || "element";
    const existing = new Set(entries.map((entry) => entry.name));
    let name = base;
    let suffix = 2;
    while (existing.has(name)) name = `${base}_${suffix++}`;
    const element: Element = { kind: "container", detClass: det.class };
    updateCurrentPage((page) => ({
      ...page,
      elements: { ...page.elements, [name]: element }
    }));
    setAuthoredReferenceBox(name, imageRectFromPixelBox(det.box, predictions.imageSize));
    setSelectedName(name);
    setStatus(`Accepted ${det.class} as element ${name}.`);
  }

  function pointerImagePoint(event: ReactPointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    const display = displayRef.current;
    if (!canvas || !display) return null;
    return canvasToImagePoint(eventCanvasPoint(event, canvas), display);
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    const display = displayRef.current;
    const image = imageRef.current;
    if (!canvas || !display || !image) return;
    const normalized = pointerImagePoint(event);
    if (!normalized) return;
    const { width, height } = previewSourceSize(image);
    const hit = hitTest(eventCanvasPoint(event, canvas), display, canvasBoxes, width, height);
    if (hit.index >= 0) {
      const target = renderedElements[hit.index];
      setSelectedName(target.entry.name);
      setCanvasDrag({
        kind: "edit",
        elementName: target.entry.name,
        handle: hit.handle,
        start: normalized,
        startRect: target.rect
      });
    } else if (selectedEntry) {
      setCanvasDrag({ kind: "draw", start: normalized, current: normalized });
    } else {
      setStatus("Select or add an element before drawing a box.");
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (!canvasDrag) return;
    const current = pointerImagePoint(event);
    if (!current) return;
    if (canvasDrag.kind === "draw") {
      setCanvasDrag({ ...canvasDrag, current });
      return;
    }
    const next = enforceMinRect(
      resizeOrMoveRect(canvasDrag.startRect, canvasDrag.handle, canvasDrag.start, current),
      0.002,
      0.002
    );
    commitElementBox(canvasDrag.elementName, next);
  }

  function handlePointerUp(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (canvasDrag?.kind === "draw" && selectedEntry) {
      const rect = enforceMinRect(normalizedImageRect(canvasDrag.start, canvasDrag.current), 0.002, 0.002);
      commitElementBox(selectedEntry.name, rect);
    }
    setCanvasDrag(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  function addElement() {
    const name = nextElementName(entries);
    const firstClass = detectClasses[0]?.name;
    const element: Element = firstClass ? { kind: "container", detClass: firstClass } : { kind: "container" };
    updateCurrentPage((page) => ({
      ...page,
      elements: { ...page.elements, [name]: element }
    }));
    setSelectedName(name);
    setStatus(`Added ${name}. Draw its reference box on the canvas.`);
  }

  function deleteSelectedElement() {
    if (!selectedEntry) return;
    const deletedNames = new Set(
      entries
        .filter(
          (entry) => entry.path.slice(0, selectedEntry.path.length).join("/") === selectedEntry.path.join("/")
        )
        .map((entry) => entry.name)
    );
    updateCurrentPage((page) => ({
      ...page,
      guard: page.guard
        ? { require: page.guard.require.filter((name) => !deletedNames.has(name)) }
        : undefined,
      elements: deleteElementAtPath(page.elements, selectedEntry.path)
    }));
    deletedNames.forEach((name) => setAuthoredReferenceBox(name, null));
    setSelectedName(null);
    setStatus(`Deleted ${selectedEntry.name}.`);
  }

  function commitElementName() {
    if (!selectedEntry) return;
    const nextName = nameDraft.trim();
    if (!nextName || nextName === selectedEntry.name) {
      setNameDraft(selectedEntry.name);
      return;
    }
    if (entries.some((entry) => entry.name === nextName)) {
      setStatus(`Element name ${nextName} already exists on this page.`);
      setNameDraft(selectedEntry.name);
      return;
    }
    const previousName = selectedEntry.name;
    updateCurrentPage((page) => ({
      ...page,
      guard: page.guard
        ? { require: page.guard.require.map((name) => (name === previousName ? nextName : name)) }
        : undefined,
      elements: renameElementAtPath(page.elements, selectedEntry.path, nextName)
    }));
    setReferenceBoxesByPage((current) => {
      const pageBoxes = { ...(current[currentPage.id] ?? {}) };
      if (pageBoxes[previousName]) pageBoxes[nextName] = pageBoxes[previousName];
      delete pageBoxes[previousName];
      return { ...current, [currentPage.id]: pageBoxes };
    });
    setSelectedName(nextName);
    setStatus(`Renamed ${previousName} to ${nextName}.`);
  }

  function addPage() {
    const next = newPage(doc.pages.length + 1, clfClasses[0] ?? "");
    setDoc((current) => ({ ...current, pages: [...current.pages, next] }));
    setPageIndex(doc.pages.length);
    setSelectedName(null);
  }

  function deleteCurrentPage() {
    if (doc.pages.length <= 1) {
      setStatus("A UI map must keep at least one page.");
      return;
    }
    const removedId = currentPage.id;
    setDoc((current) => ({
      ...current,
      pages: current.pages.filter((_page, index) => index !== pageIndex)
    }));
    setReferenceBoxesByPage((current) => {
      const next = { ...current };
      delete next[removedId];
      return next;
    });
    setPageIndex(Math.max(0, pageIndex - 1));
    setSelectedName(null);
  }

  function setPageId(nextId: string) {
    const previousId = currentPage.id;
    updateCurrentPage((page) => ({ ...page, id: nextId }));
    setDoc((current) => ({
      ...current,
      flows: current.flows.map((flow) => ({
        ...flow,
        nodes: flow.nodes.map((node) =>
          node.kind === "Observe" && node.page === previousId ? { ...node, page: nextId } : node
        )
      }))
    }));
    setReferenceBoxesByPage((current) => {
      if (!current[previousId]) return current;
      const next = { ...current, [nextId]: current[previousId] };
      delete next[previousId];
      return next;
    });
  }

  function validateForAction() {
    const result = validateDoc(doc);
    if (result.ok) {
      setValidationErrors([]);
      return true;
    }
    setValidationErrors(result.errors);
    setStatus(
      `Validation failed with ${result.errors.length} error${result.errors.length === 1 ? "" : "s"}.`
    );
    return false;
  }

  async function saveMap() {
    if (!validateForAction()) return;
    try {
      const saved = await api.saveUiMap(mapName, doc);
      setMapName(saved.name);
      setStatus(`Saved ${saved.path}.`);
    } catch (error) {
      setStatus(`Save failed: ${errMessage(error)}`);
    }
  }

  async function loadMap() {
    try {
      const loaded = await api.loadUiMap(mapName);
      const result = validateDoc(loaded);
      if (!result.ok) {
        setValidationErrors(result.errors);
        setStatus(`Loaded document was rejected by the schema validator (${result.errors.length} errors).`);
        return;
      }
      setDoc(loaded);
      setPageIndex(0);
      setSelectedName(null);
      setReferenceBoxesByPage({});
      setValidationErrors([]);
      setStatus(`Loaded ${mapName}. Flows are preserved read-only in M1.`);
    } catch (error) {
      setStatus(`Load failed: ${errMessage(error)}`);
    }
  }

  function exportJson() {
    if (!validateForAction()) return;
    const blob = new Blob([`${JSON.stringify(doc, null, 2)}\n`], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${safeDownloadName(mapName)}.json`;
    link.click();
    URL.revokeObjectURL(url);
    setStatus(`Exported ${link.download}.`);
  }

  function changeSelectedParent(parentName: string) {
    if (!selectedEntry || selectedEntry.structuralParent) return;
    const childRect = resolvedBoxes[selectedEntry.name];
    const parentRect = parentName ? resolvedBoxes[parentName] : null;
    updateSelectedElement((element) => {
      const next: any = { ...element };
      if (parentName) next.in = parentName;
      else delete next.in;
      if (!parentName || element.detClass) {
        delete next.relRect;
      } else if (childRect && parentRect) {
        next.relRect = relRectFromReferenceBoxes(childRect, parentRect) ?? undefined;
      }
      return next as Element;
    });
  }

  function changeSelectedDetClass(detClass: string) {
    if (!selectedEntry) return;
    const childRect = resolvedBoxes[selectedEntry.name];
    const parentRect = selectedEntry.parentName ? resolvedBoxes[selectedEntry.parentName] : null;
    updateSelectedElement((element) => {
      const next: any = { ...element };
      if (detClass) {
        next.detClass = detClass;
        delete next.relRect;
      } else {
        delete next.detClass;
        delete next.associate;
        if (selectedEntry.parentName && childRect && parentRect) {
          next.relRect = relRectFromReferenceBoxes(childRect, parentRect) ?? undefined;
        }
      }
      return next as Element;
    });
  }

  function changeRepeat(control: "" | NonNullable<Repeat["control"]>) {
    updateSelectedElement((element) => {
      if (element.kind !== "container") return element;
      if (!control) {
        const next = { ...element };
        delete next.repeat;
        return next;
      }
      return { ...element, repeat: { ...(element.repeat ?? {}), control } };
    });
  }

  function changeAssociate(rule: "" | Associate["rule"]) {
    updateSelectedElement((element) => {
      if (element.kind !== "button") return element;
      if (!rule) {
        const next = { ...element };
        delete next.associate;
        return next;
      }
      return { ...element, associate: { ...(element.associate ?? {}), rule } };
    });
  }

  function toggleGuard(name: string, required: boolean) {
    updateCurrentPage((page) => {
      const names = new Set(page.guard?.require ?? []);
      if (required) names.add(name);
      else names.delete(name);
      const require = [...names];
      return { ...page, guard: require.length ? { require } : undefined };
    });
  }

  const containerOptions = entries.filter(
    (entry) => entry.element.kind === "container" && entry.name !== selectedEntry?.name
  );

  return (
    <section className="ui-orchestrator-page">
      <header className="uio-header">
        <div>
          <p className="uio-eyebrow">Pages-only authoring · schema 1.0</p>
          <h1>UI Orchestrator</h1>
          <p className="uio-subtitle">
            Draw reference boxes, bind workspace taxonomy classes, and export a validated UI map.
            {doc.flows.length
              ? ` ${doc.flows.length} loaded flow${doc.flows.length === 1 ? " is" : "s are"} preserved read-only.`
              : ""}
          </p>
        </div>
        <div className="uio-header-actions">
          <label>
            <span>Map name</span>
            <input value={mapName} onChange={(event) => setMapName(event.target.value)} />
          </label>
          <button type="button" onClick={() => void loadMap()}>
            Load
          </button>
          <button type="button" className="primary" onClick={() => void saveMap()}>
            Save
          </button>
          <button type="button" onClick={exportJson}>
            Export JSON
          </button>
        </div>
      </header>

      <div className="uio-workspace">
        <aside className="uio-panel uio-pages-panel">
          <div className="uio-panel-heading">
            <div>
              <span className="uio-panel-kicker">Document</span>
              <strong>Pages</strong>
            </div>
            <button type="button" onClick={addPage}>
              + Page
            </button>
          </div>

          <label className="uio-field">
            <span>Game namespace</span>
            <input
              value={doc.game}
              onChange={(event) => setDoc((current) => ({ ...current, game: event.target.value }))}
            />
          </label>

          <div className="uio-page-list">
            {doc.pages.map((page, index) => (
              <button
                type="button"
                key={`${page.id}-${index}`}
                className={index === pageIndex ? "active" : ""}
                onClick={() => {
                  setPageIndex(index);
                  setSelectedName(null);
                }}
              >
                <span>{page.id || `Page ${index + 1}`}</span>
                <small>{Object.keys(page.elements).length} root elements</small>
              </button>
            ))}
          </div>

          <div className="uio-section">
            <div className="uio-section-title">
              <strong>Page routing</strong>
              <button type="button" className="danger-link" onClick={deleteCurrentPage}>
                Delete
              </button>
            </div>
            <label className="uio-field">
              <span>Page id</span>
              <input value={currentPage.id} onChange={(event) => setPageId(event.target.value)} />
            </label>
            <label className="uio-field">
              <span>Classifier label(s)</span>
              <input
                list="uio-clf-classes"
                value={triggerText(currentPage)}
                placeholder="Comma-separated labels"
                onChange={(event) =>
                  updateCurrentPage((page) => ({
                    ...page,
                    trigger: { ...page.trigger, clf: parseTriggerLabels(event.target.value) }
                  }))
                }
              />
              <datalist id="uio-clf-classes">
                {clfClasses.map((name) => (
                  <option value={name} key={name} />
                ))}
              </datalist>
            </label>
            <label className="uio-field">
              <span>Minimum confidence</span>
              <input
                type="number"
                min="0.01"
                max="1"
                step="0.01"
                value={currentPage.trigger.minConfidence}
                onChange={(event) =>
                  updateCurrentPage((page) => ({
                    ...page,
                    trigger: { ...page.trigger, minConfidence: Number(event.target.value) }
                  }))
                }
              />
            </label>
          </div>

          <div className="uio-section">
            <strong>Guard · require</strong>
            <div className="uio-check-list">
              {entries.length ? (
                entries.map((entry) => (
                  <label key={entry.name}>
                    <input
                      type="checkbox"
                      checked={currentPage.guard?.require.includes(entry.name) ?? false}
                      onChange={(event) => toggleGuard(entry.name, event.target.checked)}
                    />
                    <span>{entry.name}</span>
                  </label>
                ))
              ) : (
                <small>Add elements to configure a fail-closed guard.</small>
              )}
            </div>
          </div>
        </aside>

        <main className="uio-canvas-column">
          <div className="uio-canvas-toolbar">
            <button type="button" className="primary" onClick={() => void chooseReferenceImage()}>
              Choose reference image
            </button>
            <span>{imageName || "No reference image loaded"}</span>
            <span className="uio-canvas-hint">
              Select an element, then drag to draw. Drag existing boxes to edit.
            </span>
          </div>
          <div className="uio-canvas-stage">
            <canvas
              ref={canvasRef}
              aria-label="UI element reference box editor"
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={() => setCanvasDrag(null)}
            />
          </div>
          <div className="uio-status" role="status">
            {status}
          </div>

          <div className="uio-modelassist">
            <div className="uio-section-title">
              <strong>Model assist</strong>
              <button
                type="button"
                className="primary"
                onClick={() => void runPredictions()}
                disabled={predicting || !imagePath || (!detModelPath && !clfModelPath)}
              >
                {predicting ? "Running…" : "Run predictions"}
              </button>
            </div>
            <div className="uio-model-row">
              <button type="button" onClick={() => void chooseModel("det")}>
                Detector .pt
              </button>
              <span title={detModelPath}>{detModelPath ? basename(detModelPath) : "none"}</span>
            </div>
            <div className="uio-model-row">
              <button type="button" onClick={() => void chooseModel("clf")}>
                Classifier .pt
              </button>
              <span title={clfModelPath}>{clfModelPath ? basename(clfModelPath) : "none"}</span>
            </div>
            {predictions ? (
              <div className="uio-predictions">
                <div className="uio-clf-readout">
                  {predictions.clf.label
                    ? `CLF: ${predictions.clf.label} (${(predictions.clf.conf * 100).toFixed(0)}%)`
                    : "CLF: no confident label"}
                </div>
                <ul>
                  {predictions.det.map((det, index) => (
                    <li key={`${det.class}-${index}`}>
                      <span>
                        {det.class} · {(det.conf * 100).toFixed(0)}%
                      </span>
                      <button type="button" onClick={() => acceptPrediction(det)}>
                        Accept as element
                      </button>
                    </li>
                  ))}
                  {predictions.det.length === 0 ? (
                    <li>
                      <small>No detections above threshold.</small>
                    </li>
                  ) : null}
                </ul>
              </div>
            ) : (
              <p className="uio-empty-copy">
                Pick a detector and/or classifier .pt, then run predictions on the reference frame.
              </p>
            )}
          </div>
        </main>

        <aside className="uio-panel uio-elements-panel">
          <div className="uio-panel-heading">
            <div>
              <span className="uio-panel-kicker">Layer A</span>
              <strong>Elements</strong>
            </div>
            <button type="button" onClick={addElement}>
              + Element
            </button>
          </div>

          <div className="uio-element-list">
            {entries.map((entry) => (
              <button
                type="button"
                key={entry.path.join("/")}
                className={entry.name === selectedName ? "active" : ""}
                style={{ paddingLeft: `${12 + entry.depth * 16}px` }}
                onClick={() => setSelectedName(entry.name)}
              >
                <span>{entry.name}</span>
                <small>
                  {entry.element.kind}
                  {entry.parentName ? ` · in ${entry.parentName}` : " · root"}
                </small>
              </button>
            ))}
            {!entries.length ? (
              <p className="uio-empty-copy">Add an element to start authoring this page.</p>
            ) : null}
          </div>

          {selectedEntry ? (
            <div className="uio-inspector">
              <div className="uio-section-title">
                <strong>Binding</strong>
                <button type="button" className="danger-link" onClick={deleteSelectedElement}>
                  Delete
                </button>
              </div>
              <label className="uio-field">
                <span>Element name</span>
                <input
                  value={nameDraft}
                  onChange={(event) => setNameDraft(event.target.value)}
                  onBlur={commitElementName}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") event.currentTarget.blur();
                  }}
                />
              </label>
              <label className="uio-field">
                <span>Kind</span>
                <select
                  value={selectedEntry.element.kind}
                  onChange={(event) =>
                    updateSelectedElement((element) =>
                      elementWithKind(element, event.target.value as Element["kind"])
                    )
                  }
                >
                  <option value="container">container</option>
                  <option value="button">button</option>
                  <option value="text">text</option>
                  <option value="marker">marker</option>
                </select>
              </label>
              <label className="uio-field">
                <span>Parent · in</span>
                <select
                  value={selectedEntry.parentName ?? ""}
                  disabled={Boolean(selectedEntry.structuralParent)}
                  title={
                    selectedEntry.structuralParent
                      ? "Nested children use their containing container as parent."
                      : undefined
                  }
                  onChange={(event) => changeSelectedParent(event.target.value)}
                >
                  <option value="">Page root</option>
                  {containerOptions.map((entry) => (
                    <option value={entry.name} key={entry.name}>
                      {entry.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="uio-field">
                <span>Detection class</span>
                <select
                  value={selectedEntry.element.detClass ?? ""}
                  onChange={(event) => changeSelectedDetClass(event.target.value)}
                >
                  <option value="">None · use relRect for child</option>
                  {detectClasses.map((item) => (
                    <option value={item.name} key={`${item.id}-${item.name}`}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="uio-field">
                <span>relRect</span>
                <input
                  readOnly
                  value={selectedEntry.element.relRect?.map((value) => value.toFixed(4)).join(", ") ?? "—"}
                  title="Computed from the drawn box relative to the resolved parent reference box."
                />
              </label>

              {selectedEntry.element.kind === "text" ? (
                <label className="uio-field">
                  <span>Phrase table</span>
                  <input
                    value={selectedEntry.element.phraseTable ?? ""}
                    placeholder="namespace/name@1"
                    onChange={(event) =>
                      updateSelectedElement((element) => {
                        if (element.kind !== "text") return element;
                        const phraseTable = event.target.value;
                        if (!phraseTable) {
                          const next = { ...element };
                          delete next.phraseTable;
                          return next;
                        }
                        return { ...element, phraseTable };
                      })
                    }
                  />
                </label>
              ) : null}

              {selectedEntry.element.kind === "container" ? (
                <>
                  <label className="uio-field">
                    <span>Repeat / reading order</span>
                    <select
                      value={selectedEntry.element.repeat?.control ?? ""}
                      onChange={(event) =>
                        changeRepeat(event.target.value as "" | NonNullable<Repeat["control"]>)
                      }
                    >
                      <option value="">Not repeated</option>
                      <option value="none">Detection order</option>
                      <option value="horizontal_scroll">Horizontal scroll</option>
                      <option value="vertical_scroll">Vertical scroll</option>
                      <option value="grid">Grid</option>
                    </select>
                  </label>
                  {selectedEntry.element.repeat ? (
                    <label className="uio-field">
                      <span>Maximum instances</span>
                      <input
                        type="number"
                        min="1"
                        step="1"
                        value={selectedEntry.element.repeat.maxInstances ?? ""}
                        placeholder="No cap"
                        onChange={(event) =>
                          updateSelectedElement((element) => {
                            if (element.kind !== "container" || !element.repeat) return element;
                            const value = event.target.value;
                            const repeat = { ...element.repeat };
                            if (value) repeat.maxInstances = Number(value);
                            else delete repeat.maxInstances;
                            return { ...element, repeat };
                          })
                        }
                      />
                    </label>
                  ) : null}
                </>
              ) : null}

              {selectedEntry.element.kind === "button" &&
              selectedEntry.parentName &&
              selectedEntry.element.detClass ? (
                <>
                  <label className="uio-field">
                    <span>Association rule</span>
                    <select
                      value={selectedEntry.element.associate?.rule ?? ""}
                      onChange={(event) => changeAssociate(event.target.value as "" | Associate["rule"])}
                    >
                      <option value="">No explicit association</option>
                      <option value="xColumn">xColumn</option>
                      <option value="containment">containment</option>
                    </select>
                  </label>
                  {selectedEntry.element.associate ? (
                    <label className="uio-field">
                      <span>Vertical tolerance ratio</span>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={selectedEntry.element.associate.verticalToleranceRatio ?? 0}
                        onChange={(event) =>
                          updateSelectedElement((element) => {
                            if (element.kind !== "button" || !element.associate) return element;
                            return {
                              ...element,
                              associate: {
                                ...element.associate,
                                verticalToleranceRatio: Number(event.target.value)
                              }
                            };
                          })
                        }
                      />
                    </label>
                  ) : null}
                </>
              ) : null}
            </div>
          ) : (
            <p className="uio-empty-copy">Select an element to edit its binding.</p>
          )}

          <div className={`uio-validation ${validationErrors.length ? "invalid" : ""}`}>
            <div className="uio-section-title">
              <strong>Validation</strong>
              <button
                type="button"
                onClick={() => {
                  if (validateForAction()) setStatus("Document is valid against schema 1.0.");
                }}
              >
                Check
              </button>
            </div>
            {validationErrors.length ? (
              <ol>
                {validationErrors.map((error, index) => (
                  <li key={`${error}-${index}`}>{error}</li>
                ))}
              </ol>
            ) : (
              <p>No validation errors shown.</p>
            )}
          </div>
        </aside>
      </div>
    </section>
  );
}
