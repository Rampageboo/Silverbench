import { useEffect, useRef, useState } from "react";
import type { ClassifierImageResult, LabelBox } from "../../api";
import {
  boxToRect,
  canvasToImagePoint,
  drawBoxes,
  drawCenteredText,
  drawGrid,
  drawImageRect,
  clampViewportPan,
  eventCanvasPoint,
  hitTest,
  imageDisplayRect,
  loadCanvasImage,
  normalizedImageRect,
  rectToBox,
  resizeCanvasToParent,
  resizeOrMoveRect,
  type DisplayRect,
  type DragState,
  type ImagePoint,
  type Viewport
} from "../box-label/geometry";
import { datasetImageUrl } from "./datasetAssets";
import type { DatasetPair } from "./datasetCore";

type DatasetReviewEditorProps = {
  datasetRoot: string;
  pair: DatasetPair | null;
  boxes: LabelBox[];
  selectedBoxIndex: number | null;
  classifierResult?: ClassifierImageResult | null;
  onBoxesChange: (boxes: LabelBox[]) => void;
  onSelectBox: (index: number | null) => void;
  onPersist: (boxes: LabelBox[]) => Promise<void>;
  onStatus?: (text: string) => void;
};

export function DatasetReviewEditor({
  datasetRoot,
  pair,
  boxes,
  selectedBoxIndex,
  classifierResult,
  onBoxesChange,
  onSelectBox,
  onPersist,
  onStatus
}: DatasetReviewEditorProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const displayRef = useRef<DisplayRect | null>(null);
  const viewportRef = useRef<Viewport>({ zoom: 1, panX: 0, panY: 0 });
  const boxesRef = useRef(boxes);
  const selectedRef = useRef(selectedBoxIndex);
  const dragRef = useRef<DragState | null>(null);
  const rafRef = useRef<number | null>(null);
  const [showGrid, setShowGrid] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    boxesRef.current = boxes;
    scheduleDraw();
  }, [boxes]);

  useEffect(() => {
    selectedRef.current = selectedBoxIndex;
    scheduleDraw();
  }, [selectedBoxIndex]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!pair || !datasetRoot) {
        imageRef.current = null;
        scheduleDraw();
        return;
      }
      setError("");
      try {
        const url = await datasetImageUrl(datasetRoot, pair.imagePath);
        const image = await loadCanvasImage(url);
        if (cancelled) return;
        imageRef.current = image;
        viewportRef.current = { zoom: 1, panX: 0, panY: 0 };
        dragRef.current = null;
        scheduleDraw();
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [datasetRoot, pair?.imagePath]);

  useEffect(() => {
    function resize() {
      resizeCanvasToParent(canvasRef.current);
      scheduleDraw();
    }
    resize();
    const observer = new ResizeObserver(resize);
    if (stageRef.current) observer.observe(stageRef.current);
    return () => observer.disconnect();
  }, []);

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
      drawCenteredText(ctx, canvas, pair ? "Loading image..." : "No image selected.");
      return;
    }
    const display = imageDisplayRect(canvas, image, viewportRef.current);
    displayRef.current = display;
    ctx.drawImage(image, display.x, display.y, display.w, display.h);
    if (showGrid) drawGrid(ctx, display);
    drawBoxes(ctx, display, boxesRef.current, selectedRef.current);
    const drag = dragRef.current;
    if (drag?.type === "draw") {
      drawImageRect(ctx, display, normalizedImageRect(drag.start, drag.current), "#f59e0b", true);
    }
    if (classifierResult?.top) {
      ctx.save();
      ctx.fillStyle = "rgba(15, 23, 42, 0.82)";
      ctx.fillRect(display.x + 8, display.y + 8, 220, 28);
      ctx.fillStyle = "#f8fafc";
      ctx.font = "12px sans-serif";
      ctx.fillText(
        `${classifierResult.top.name} ${(classifierResult.top.confidence * 100).toFixed(0)}%`,
        display.x + 14,
        display.y + 27
      );
      ctx.restore();
    }
  }

  async function commitBoxes(next: LabelBox[], message: string) {
    boxesRef.current = next;
    onBoxesChange(next);
    try {
      await onPersist(next);
      onStatus?.(message);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
    scheduleDraw();
  }

  function onPointerDown(event: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    const display = displayRef.current;
    const image = imageRef.current;
    if (!canvas || !display || !image) return;
    canvas.setPointerCapture(event.pointerId);
    const canvasPoint = eventCanvasPoint(event, canvas);
    if (event.button === 1 || event.button === 2 || event.altKey) {
      event.preventDefault();
      dragRef.current = {
        type: "pan",
        startClientX: event.clientX,
        startClientY: event.clientY,
        startPanX: viewportRef.current.panX,
        startPanY: viewportRef.current.panY
      };
      canvas.style.cursor = "grabbing";
      return;
    }
    const imagePoint = canvasToImagePoint(canvasPoint, display);
    if (!imagePoint) return;
    if (event.shiftKey) {
      onSelectBox(null);
      dragRef.current = { type: "draw", start: imagePoint, current: imagePoint };
      scheduleDraw();
      return;
    }
    const hit = hitTest(canvasPoint, display, boxesRef.current, image.naturalWidth, image.naturalHeight);
    if (hit.index >= 0) {
      onSelectBox(hit.index);
      dragRef.current = {
        type: "box",
        index: hit.index,
        handle: hit.handle || "move",
        start: imagePoint,
        startRect: boxToRect(boxesRef.current[hit.index]),
        moved: false
      };
      scheduleDraw();
      return;
    }
    onSelectBox(null);
    dragRef.current = { type: "draw", start: imagePoint, current: imagePoint };
    scheduleDraw();
  }

  function onPointerMove(event: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    const display = displayRef.current;
    const image = imageRef.current;
    if (!canvas || !display || !image) return;
    const drag = dragRef.current;
    const canvasPoint = eventCanvasPoint(event, canvas);
    if (drag?.type === "pan") {
      viewportRef.current = clampViewportPan(canvas, image, {
        ...viewportRef.current,
        panX: drag.startPanX + (event.clientX - drag.startClientX),
        panY: drag.startPanY + (event.clientY - drag.startClientY)
      });
      canvas.style.cursor = "grabbing";
      scheduleDraw();
      return;
    }
    const imagePoint = canvasToImagePoint(canvasPoint, display);
    if (!imagePoint || !drag) return;
    if (drag.type === "draw") {
      dragRef.current = { ...drag, current: imagePoint };
      scheduleDraw();
      return;
    }
    if (drag.type === "box") {
      const nextRect = resizeOrMoveRect(drag.startRect, drag.handle, drag.start, imagePoint);
      const next = boxesRef.current.slice();
      next[drag.index] = rectToBox(nextRect, next[drag.index].classId);
      boxesRef.current = next;
      onBoxesChange(next);
      dragRef.current = { ...drag, moved: true };
      scheduleDraw();
    }
  }

  function onPointerUp(event: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    try {
      canvas.releasePointerCapture(event.pointerId);
    } catch {
      /* ignore */
    }
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag) return;
    if (drag.type === "draw") {
      const rect = normalizedImageRect(drag.start, drag.current);
      if (Math.abs(rect.x2 - rect.x1) < 0.005 || Math.abs(rect.y2 - rect.y1) < 0.005) {
        scheduleDraw();
        return;
      }
      const classId = boxesRef.current[selectedRef.current ?? 0]?.classId ?? 0;
      const next = [...boxesRef.current, rectToBox(rect, classId)];
      onSelectBox(next.length - 1);
      void commitBoxes(next, "Added box.");
      return;
    }
    if (drag.type === "box" && drag.moved) {
      void commitBoxes(boxesRef.current.slice(), "Updated box.");
    }
  }

  return (
    <section className="panel" id="previewPanel">
      <div className="panel-header">
        <span>Preview</span>
        <span id="boxCount" className="status">
          {boxes.length} box(es)
        </span>
      </div>
      <div className="panel-body viewer" id="previewViewer">
        {error ? <div className="error-banner">{error}</div> : null}
        <div className="row" style={{ marginBottom: 8 }}>
          <button type="button" className={showGrid ? "active" : ""} onClick={() => setShowGrid((v) => !v)}>
            Grid
          </button>
        </div>
        <div className="canvas-wrap" id="dropZone" ref={stageRef}>
          <canvas
            id="previewCanvas"
            ref={canvasRef}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onContextMenu={(event) => event.preventDefault()}
            onWheel={(event) => {
              event.preventDefault();
              viewportRef.current.zoom = Math.max(
                0.2,
                Math.min(8, viewportRef.current.zoom * (event.deltaY < 0 ? 1.1 : 0.9))
              );
              scheduleDraw();
            }}
            onDoubleClick={() => {
              viewportRef.current = { zoom: 1, panX: 0, panY: 0 };
              scheduleDraw();
            }}
          />
        </div>
      </div>
    </section>
  );
}
