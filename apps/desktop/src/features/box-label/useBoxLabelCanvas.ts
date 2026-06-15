import { useCallback, useEffect, useRef, type MutableRefObject } from "react";
import * as api from "../../api";
import { renderMainCanvas, renderZoomCanvas } from "./boxCanvasRenderer";
import {
  defaultPoolLabelCursor,
  resizeCanvasToParent,
  type DisplayRect,
  type DragState,
  type ImagePixelPoint,
  type Viewport
} from "./geometry";

type UseBoxLabelCanvasOptions = {
  boxesRef: MutableRefObject<api.LabelBox[]>;
  selectedRef: MutableRefObject<number | null>;
  classesRef: MutableRefObject<api.LabelClass[]>;
  showGridRef: MutableRefObject<boolean>;
  dragRef: MutableRefObject<DragState>;
  pointerToolEnabled: boolean;
  autoFitEnabled: boolean;
  blackBoxEnabled: boolean;
};

export function useBoxLabelCanvas({
  boxesRef,
  selectedRef,
  classesRef,
  showGridRef,
  dragRef,
  pointerToolEnabled,
  autoFitEnabled,
  blackBoxEnabled
}: UseBoxLabelCanvasOptions) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const zoomCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const displayRef = useRef<DisplayRect | null>(null);
  const viewportRef = useRef<Viewport>({ zoom: 1, panX: 0, panY: 0 });
  const rafRef = useRef<number | null>(null);
  const zoomPointRef = useRef<ImagePixelPoint | null>(null);
  const lastZoomCenterRef = useRef<ImagePixelPoint | null>(null);

  const drawCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    const zoomCanvas = zoomCanvasRef.current;
    const image = imageRef.current;
    if (!canvas) return;
    displayRef.current = renderMainCanvas({
      canvas,
      image,
      boxes: boxesRef.current,
      selectedIndex: selectedRef.current,
      classes: classesRef.current,
      showGrid: showGridRef.current,
      viewport: viewportRef.current,
      drag: dragRef.current,
      zoomPoint: zoomPointRef.current,
      pointerToolEnabled,
      autoFitEnabled
    });
    if (image && zoomCanvas && displayRef.current) {
      renderZoomCanvas({
        canvas: zoomCanvas,
        image,
        display: displayRef.current,
        boxes: boxesRef.current,
        selectedIndex: selectedRef.current,
        drag: dragRef.current,
        zoomPoint: zoomPointRef.current,
        lastZoomCenter: lastZoomCenterRef.current
      });
    }
  }, [autoFitEnabled, boxesRef, classesRef, dragRef, pointerToolEnabled, selectedRef, showGridRef]);

  const scheduleDraw = useCallback(() => {
    if (rafRef.current !== null) return;
    rafRef.current = window.requestAnimationFrame(() => {
      rafRef.current = null;
      drawCanvas();
    });
  }, [drawCanvas]);

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
  }, [autoFitEnabled, blackBoxEnabled, dragRef, pointerToolEnabled, scheduleDraw]);

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
  }, [scheduleDraw]);

  return {
    canvasRef,
    stageRef,
    zoomCanvasRef,
    imageRef,
    displayRef,
    viewportRef,
    zoomPointRef,
    lastZoomCenterRef,
    rafRef,
    drawCanvas,
    scheduleDraw
  };
}
