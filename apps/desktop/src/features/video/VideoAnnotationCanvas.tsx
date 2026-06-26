import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { LabelBox, LabelClass } from "../../api";

type Point = { x: number; y: number };
type Corner = "nw" | "ne" | "sw" | "se";
type DragState =
  | { kind: "draw"; start: Point; current: Point }
  | { kind: "move"; index: number; start: Point; origin: LabelBox; startBoxes: LabelBox[] }
  | { kind: "resize"; index: number; corner: Corner; origin: LabelBox; startBoxes: LabelBox[] }
  | null;

export type RemotePointerState = {
  x: number;
  y: number;
  pressed: boolean;
  sequence: number;
};

type Props = {
  imageBase64: string;
  boxes: LabelBox[];
  classes: LabelClass[];
  currentClass: number;
  selectedIndex: number | null;
  disabled?: boolean;
  remotePointer?: RemotePointerState | null;
  onChange: (boxes: LabelBox[]) => void;
  onSelectedIndexChange: (index: number | null) => void;
};

const MIN_BOX_SIZE = 0.003;

function clamp(value: number, min = 0, max = 1) {
  return Math.max(min, Math.min(max, value));
}

function boxEdges(box: LabelBox) {
  return {
    x1: box.x - box.w / 2,
    y1: box.y - box.h / 2,
    x2: box.x + box.w / 2,
    y2: box.y + box.h / 2
  };
}

function boxFromEdges(classId: number, x1: number, y1: number, x2: number, y2: number): LabelBox {
  const left = clamp(Math.min(x1, x2));
  const top = clamp(Math.min(y1, y2));
  const right = clamp(Math.max(x1, x2));
  const bottom = clamp(Math.max(y1, y2));
  return {
    classId,
    x: (left + right) / 2,
    y: (top + bottom) / 2,
    w: right - left,
    h: bottom - top
  };
}

function displayRect(canvas: HTMLCanvasElement, image: HTMLImageElement) {
  const scale = Math.min(canvas.width / image.naturalWidth, canvas.height / image.naturalHeight);
  const width = image.naturalWidth * scale;
  const height = image.naturalHeight * scale;
  return {
    x: (canvas.width - width) / 2,
    y: (canvas.height - height) / 2,
    width,
    height
  };
}

function eventPoint(event: React.PointerEvent<HTMLCanvasElement>, canvas: HTMLCanvasElement, image: HTMLImageElement) {
  const bounds = canvas.getBoundingClientRect();
  const px = ((event.clientX - bounds.left) * canvas.width) / Math.max(1, bounds.width);
  const py = ((event.clientY - bounds.top) * canvas.height) / Math.max(1, bounds.height);
  const display = displayRect(canvas, image);
  return {
    point: {
      x: clamp((px - display.x) / Math.max(1, display.width)),
      y: clamp((py - display.y) / Math.max(1, display.height))
    },
    inside:
      px >= display.x &&
      py >= display.y &&
      px <= display.x + display.width &&
      py <= display.y + display.height
  };
}

function hitBox(boxes: LabelBox[], point: Point) {
  let result = -1;
  let smallestArea = Number.POSITIVE_INFINITY;
  boxes.forEach((box, index) => {
    const edges = boxEdges(box);
    if (point.x < edges.x1 || point.x > edges.x2 || point.y < edges.y1 || point.y > edges.y2) return;
    const area = box.w * box.h;
    if (area < smallestArea) {
      smallestArea = area;
      result = index;
    }
  });
  return result;
}

function hitCorner(
  box: LabelBox,
  point: Point,
  canvas: HTMLCanvasElement,
  image: HTMLImageElement
): Corner | null {
  const display = displayRect(canvas, image);
  const thresholdX = (10 * (window.devicePixelRatio || 1)) / Math.max(1, display.width);
  const thresholdY = (10 * (window.devicePixelRatio || 1)) / Math.max(1, display.height);
  const edges = boxEdges(box);
  const corners: Array<[Corner, Point]> = [
    ["nw", { x: edges.x1, y: edges.y1 }],
    ["ne", { x: edges.x2, y: edges.y1 }],
    ["sw", { x: edges.x1, y: edges.y2 }],
    ["se", { x: edges.x2, y: edges.y2 }]
  ];
  return (
    corners.find(
      ([, corner]) =>
        Math.abs(point.x - corner.x) <= thresholdX && Math.abs(point.y - corner.y) <= thresholdY
    )?.[0] || null
  );
}

function resizeBox(origin: LabelBox, corner: Corner, point: Point) {
  const edges = boxEdges(origin);
  let { x1, y1, x2, y2 } = edges;
  if (corner.includes("w")) x1 = clamp(point.x, 0, x2 - MIN_BOX_SIZE);
  if (corner.includes("e")) x2 = clamp(point.x, x1 + MIN_BOX_SIZE, 1);
  if (corner.includes("n")) y1 = clamp(point.y, 0, y2 - MIN_BOX_SIZE);
  if (corner.includes("s")) y2 = clamp(point.y, y1 + MIN_BOX_SIZE, 1);
  return boxFromEdges(origin.classId, x1, y1, x2, y2);
}

export function VideoAnnotationCanvas({
  imageBase64,
  boxes,
  classes,
  currentClass,
  selectedIndex,
  disabled = false,
  remotePointer = null,
  onChange,
  onSelectedIndexChange
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const dragRef = useRef<DragState>(null);
  const remoteSequenceRef = useRef(-1);
  const remotePressedRef = useRef(false);
  const remoteStartRef = useRef<Point | null>(null);
  const workingBoxesRef = useRef<LabelBox[]>(boxes);
  const [workingBoxes, setWorkingBoxesState] = useState<LabelBox[]>(boxes);
  const [draftRect, setDraftRect] = useState<{ start: Point; current: Point } | null>(null);
  const [remoteCursor, setRemoteCursor] = useState<Point | null>(null);
  const [tool, setTool] = useState<"draw" | "select">("draw");
  const [renderVersion, setRenderVersion] = useState(0);

  const classNames = useMemo(() => new Map(classes.map((item) => [item.id, item.name])), [classes]);

  const setWorkingBoxes = useCallback((next: LabelBox[]) => {
    workingBoxesRef.current = next;
    setWorkingBoxesState(next);
  }, []);

  useEffect(() => {
    if (dragRef.current || remotePressedRef.current) return;
    setWorkingBoxes(boxes);
    if (selectedIndex !== null && selectedIndex >= boxes.length) onSelectedIndexChange(null);
  }, [boxes, onSelectedIndexChange, selectedIndex, setWorkingBoxes]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const resize = () => {
      const ratio = window.devicePixelRatio || 1;
      const bounds = canvas.getBoundingClientRect();
      const width = Math.max(1, Math.round(bounds.width * ratio));
      const height = Math.max(1, Math.round(bounds.height * ratio));
      if (canvas.width !== width) canvas.width = width;
      if (canvas.height !== height) canvas.height = height;
      setRenderVersion((value) => value + 1);
    };
    resize();
    if (typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver(resize);
      observer.observe(canvas);
      return () => observer.disconnect();
    }
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);

  useEffect(() => {
    remotePressedRef.current = false;
    remoteStartRef.current = null;
    setRemoteCursor(null);
    setDraftRect(null);
    if (!imageBase64) {
      imageRef.current = null;
      setRenderVersion((value) => value + 1);
      return;
    }
    let cancelled = false;
    const image = new Image();
    image.onload = () => {
      if (cancelled) return;
      imageRef.current = image;
      setRenderVersion((value) => value + 1);
    };
    image.src = `data:image/jpeg;base64,${imageBase64}`;
    return () => {
      cancelled = true;
    };
  }, [imageBase64]);

  useEffect(() => {
    if (!remotePointer) {
      setRemoteCursor(null);
      remotePressedRef.current = false;
      remoteStartRef.current = null;
      return;
    }
    if (remotePointer.sequence === remoteSequenceRef.current) return;
    remoteSequenceRef.current = remotePointer.sequence;
    if (disabled || !imageRef.current) return;

    const point = { x: clamp(remotePointer.x), y: clamp(remotePointer.y) };
    setRemoteCursor(point);
    if (remotePointer.pressed) {
      if (!remotePressedRef.current) {
        remotePressedRef.current = true;
        remoteStartRef.current = point;
        onSelectedIndexChange(null);
      }
      const start = remoteStartRef.current || point;
      setDraftRect({ start, current: point });
      return;
    }

    if (remotePressedRef.current) {
      const start = remoteStartRef.current;
      remotePressedRef.current = false;
      remoteStartRef.current = null;
      setDraftRect(null);
      if (!start) return;
      const nextBox = boxFromEdges(currentClass, start.x, start.y, point.x, point.y);
      if (nextBox.w < MIN_BOX_SIZE || nextBox.h < MIN_BOX_SIZE) return;
      const next = [...workingBoxesRef.current, nextBox];
      setWorkingBoxes(next);
      onSelectedIndexChange(next.length - 1);
      onChange(next);
    }
  }, [currentClass, disabled, onChange, onSelectedIndexChange, remotePointer, setWorkingBoxes]);

  useEffect(() => {
    if (!disabled) return;
    remotePressedRef.current = false;
    remoteStartRef.current = null;
    setRemoteCursor(null);
    setDraftRect(null);
  }, [disabled]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const image = imageRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "#0b0d12";
    context.fillRect(0, 0, canvas.width, canvas.height);
    if (!image) return;

    const display = displayRect(canvas, image);
    context.drawImage(image, display.x, display.y, display.width, display.height);
    const ratio = window.devicePixelRatio || 1;

    workingBoxes.forEach((box, index) => {
      const edges = boxEdges(box);
      const x = display.x + edges.x1 * display.width;
      const y = display.y + edges.y1 * display.height;
      const width = box.w * display.width;
      const height = box.h * display.height;
      const selected = index === selectedIndex;
      context.strokeStyle = selected ? "#f59e0b" : "#4ade80";
      context.lineWidth = (selected ? 3 : 2) * ratio;
      context.setLineDash([]);
      context.strokeRect(x, y, width, height);

      const label = `${box.classId}: ${classNames.get(box.classId) || "class"}`;
      context.font = `${12 * ratio}px sans-serif`;
      const textWidth = context.measureText(label).width;
      const labelHeight = 18 * ratio;
      const labelY = Math.max(display.y, y - labelHeight);
      context.fillStyle = "rgba(0, 0, 0, 0.78)";
      context.fillRect(x, labelY, textWidth + 8 * ratio, labelHeight);
      context.fillStyle = selected ? "#fbbf24" : "#86efac";
      context.fillText(label, x + 4 * ratio, labelY + 13 * ratio);

      if (selected) {
        const handleSize = 8 * ratio;
        context.fillStyle = "#f59e0b";
        for (const [handleX, handleY] of [
          [x, y],
          [x + width, y],
          [x, y + height],
          [x + width, y + height]
        ]) {
          context.fillRect(handleX - handleSize / 2, handleY - handleSize / 2, handleSize, handleSize);
        }
      }
    });

    if (draftRect) {
      const x1 = display.x + Math.min(draftRect.start.x, draftRect.current.x) * display.width;
      const y1 = display.y + Math.min(draftRect.start.y, draftRect.current.y) * display.height;
      const x2 = display.x + Math.max(draftRect.start.x, draftRect.current.x) * display.width;
      const y2 = display.y + Math.max(draftRect.start.y, draftRect.current.y) * display.height;
      context.strokeStyle = "#60a5fa";
      context.lineWidth = 2 * ratio;
      context.setLineDash([6 * ratio, 4 * ratio]);
      context.strokeRect(x1, y1, x2 - x1, y2 - y1);
      context.setLineDash([]);
    }

    if (remoteCursor) {
      const x = display.x + remoteCursor.x * display.width;
      const y = display.y + remoteCursor.y * display.height;
      const radius = 10 * ratio;
      context.strokeStyle = remotePressedRef.current ? "#f59e0b" : "#22d3ee";
      context.lineWidth = 2 * ratio;
      context.beginPath();
      context.arc(x, y, radius, 0, Math.PI * 2);
      context.moveTo(x - radius * 1.5, y);
      context.lineTo(x + radius * 1.5, y);
      context.moveTo(x, y - radius * 1.5);
      context.lineTo(x, y + radius * 1.5);
      context.stroke();
    }
  }, [classNames, draftRect, remoteCursor, renderVersion, selectedIndex, workingBoxes]);

  const deleteSelected = useCallback(() => {
    if (selectedIndex === null || selectedIndex < 0 || selectedIndex >= workingBoxesRef.current.length) return;
    const next = workingBoxesRef.current.filter((_, index) => index !== selectedIndex);
    setWorkingBoxes(next);
    onSelectedIndexChange(null);
    onChange(next);
  }, [onChange, onSelectedIndexChange, selectedIndex, setWorkingBoxes]);

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      const image = imageRef.current;
      if (!canvas || !image || disabled || remotePressedRef.current) return;
      canvas.focus();
      canvas.setPointerCapture(event.pointerId);
      const { point, inside } = eventPoint(event, canvas, image);
      if (!inside) return;

      if (selectedIndex !== null && workingBoxesRef.current[selectedIndex]) {
        const corner = hitCorner(workingBoxesRef.current[selectedIndex], point, canvas, image);
        if (corner) {
          dragRef.current = {
            kind: "resize",
            index: selectedIndex,
            corner,
            origin: workingBoxesRef.current[selectedIndex],
            startBoxes: workingBoxesRef.current
          };
          return;
        }
      }

      const hit = hitBox(workingBoxesRef.current, point);
      if (hit >= 0) {
        onSelectedIndexChange(hit);
        dragRef.current = {
          kind: "move",
          index: hit,
          start: point,
          origin: workingBoxesRef.current[hit],
          startBoxes: workingBoxesRef.current
        };
        return;
      }

      onSelectedIndexChange(null);
      if (tool === "draw") {
        dragRef.current = { kind: "draw", start: point, current: point };
        setDraftRect({ start: point, current: point });
      }
    },
    [disabled, onSelectedIndexChange, selectedIndex, tool]
  );

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      const image = imageRef.current;
      const drag = dragRef.current;
      if (!canvas || !image || !drag || disabled) return;
      const { point } = eventPoint(event, canvas, image);
      if (drag.kind === "draw") {
        drag.current = point;
        setDraftRect({ start: drag.start, current: point });
        return;
      }
      if (drag.kind === "move") {
        const dx = point.x - drag.start.x;
        const dy = point.y - drag.start.y;
        const origin = drag.origin;
        const moved: LabelBox = {
          ...origin,
          x: clamp(origin.x + dx, origin.w / 2, 1 - origin.w / 2),
          y: clamp(origin.y + dy, origin.h / 2, 1 - origin.h / 2)
        };
        setWorkingBoxes(drag.startBoxes.map((box, index) => (index === drag.index ? moved : box)));
        return;
      }
      const resized = resizeBox(drag.origin, drag.corner, point);
      setWorkingBoxes(drag.startBoxes.map((box, index) => (index === drag.index ? resized : box)));
    },
    [disabled, setWorkingBoxes]
  );

  const finishPointer = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      const image = imageRef.current;
      const drag = dragRef.current;
      if (!canvas || !image || !drag) return;
      const { point } = eventPoint(event, canvas, image);
      dragRef.current = null;
      setDraftRect(null);

      if (drag.kind === "draw") {
        const nextBox = boxFromEdges(currentClass, drag.start.x, drag.start.y, point.x, point.y);
        if (nextBox.w < MIN_BOX_SIZE || nextBox.h < MIN_BOX_SIZE) return;
        const next = [...workingBoxesRef.current, nextBox];
        setWorkingBoxes(next);
        onSelectedIndexChange(next.length - 1);
        onChange(next);
        return;
      }
      onChange(workingBoxesRef.current);
    },
    [currentClass, onChange, onSelectedIndexChange, setWorkingBoxes]
  );

  const cancelPointer = useCallback(() => {
    dragRef.current = null;
    setDraftRect(null);
    setWorkingBoxes(boxes);
  }, [boxes, setWorkingBoxes]);

  return (
    <div className="video-annotation-editor">
      <div className="row video-annotation-toolbar">
        <button type="button" className={tool === "draw" ? "primary" : ""} onClick={() => setTool("draw")} disabled={disabled}>
          Draw
        </button>
        <button type="button" className={tool === "select" ? "primary" : ""} onClick={() => setTool("select")} disabled={disabled}>
          Select
        </button>
        <button type="button" className="danger" onClick={deleteSelected} disabled={disabled || selectedIndex === null}>
          Delete Box
        </button>
        <span className="status">{workingBoxes.length} box(es)</span>
      </div>
      <div className="video-annotation-canvas-wrap">
        <canvas
          ref={canvasRef}
          className="video-annotation-canvas"
          tabIndex={0}
          aria-label="Direct video frame annotation canvas"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={finishPointer}
          onPointerCancel={cancelPointer}
          onContextMenu={(event) => event.preventDefault()}
          onKeyDown={(event) => {
            if (event.key === "Delete" || event.key === "Backspace") {
              event.preventDefault();
              deleteSelected();
            } else if (event.key === "Escape") {
              onSelectedIndexChange(null);
            }
          }}
        />
      </div>
    </div>
  );
}
