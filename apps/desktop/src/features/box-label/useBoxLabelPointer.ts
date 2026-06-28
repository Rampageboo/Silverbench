import { useCallback, type MutableRefObject, type PointerEvent as ReactPointerEvent, type RefObject, type WheelEvent as ReactWheelEvent } from "react";
import * as api from "../../api";
import { errMessage } from "../../lib/errors";
import { autoFitSubjectFromImage, selectionTooSmallPixels } from "./autoFitSubject";
import {
  boxCenterPixel,
  boxToImagePixelRect,
  canvasToImagePoint,
  clamp,
  clampViewportPan,
  defaultPoolLabelCursor,
  resolvePoolLabelCursor,
  eventCanvasPoint,
  hitTest,
  hitTestProposals,
  imageDisplayRect,
  imagePixelPointToNormalized,
  normalizedImageRect,
  pixelRectToBox,
  pointerImagePointFromCanvas,
  rectToBox,
  resizeOrMovePixelRect,
  type BoxAdjustMode,
  type DisplayRect,
  type DragState,
  type ImagePixelPoint,
  type ImageRect,
  type ProposalShape,
  type ToolMode,
  type Viewport
} from "./geometry";

type UseBoxLabelPointerOptions = {
  boxesRef: MutableRefObject<api.LabelBox[]>;
  selectedRef: MutableRefObject<number | null>;
  classRef: MutableRefObject<number>;
  dragRef: MutableRefObject<DragState>;
  modeRef: MutableRefObject<ToolMode>;
  boxAdjustModeRef: MutableRefObject<BoxAdjustMode>;
  pointerToolEnabled: boolean;
  autoFitEnabled: boolean;
  blackBoxEnabled: boolean;
  pushUndo: (action: string) => void;
  recordFixedBoxFromBox: (box: api.LabelBox) => string;
  syncBoxToSelected: (
    box: api.LabelBox | undefined,
    action: string,
    options?: { pushUndo?: boolean }
  ) => Promise<number>;
  setBoxes: (boxes: api.LabelBox[]) => void;
  setSelectedBoxId: (id: number | null) => void;
  setCurrentClass: (classId: number) => void;
  archivedDetectIdsRef?: MutableRefObject<Set<number>>;
  setError: (status: string) => void;
  canvasRef: RefObject<HTMLCanvasElement | null>;
  imageRef: RefObject<HTMLImageElement | null>;
  displayRef: MutableRefObject<DisplayRect | null>;
  viewportRef: MutableRefObject<Viewport>;
  zoomPointRef: MutableRefObject<ImagePixelPoint | null>;
  lastZoomCenterRef: MutableRefObject<ImagePixelPoint | null>;
  scheduleDraw: () => void;
  applyBlackBox: (rect: ImageRect) => Promise<void>;
  persistLabels: (statusMessage?: string) => Promise<void>;
  proposalsRef?: MutableRefObject<ProposalShape[]>;
  selectedProposalIdRef?: MutableRefObject<string | null>;
  setSelectedProposalId?: (id: string | null) => void;
  onMaterializeProposal?: (proposalId: string) => Promise<void>;
};

export function useBoxLabelPointer({
  boxesRef,
  selectedRef: _selectedRef,
  classRef,
  dragRef,
  modeRef,
  boxAdjustModeRef,
  pointerToolEnabled,
  autoFitEnabled,
  blackBoxEnabled,
  pushUndo,
  recordFixedBoxFromBox,
  syncBoxToSelected,
  setBoxes,
  setSelectedBoxId,
  setCurrentClass,
  archivedDetectIdsRef,
  setError,
  canvasRef,
  imageRef,
  displayRef,
  viewportRef,
  zoomPointRef,
  lastZoomCenterRef,
  scheduleDraw,
  applyBlackBox,
  persistLabels,
  proposalsRef,
  selectedProposalIdRef,
  setSelectedProposalId,
  onMaterializeProposal: _onMaterializeProposal
}: UseBoxLabelPointerOptions) {
  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLCanvasElement>) => {
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
          button: event.button,
          pureClick: true,
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

      if (!pointerToolEnabled && (modeRef.current === "draw" || blackBoxEnabled || autoFitEnabled)) {
        setSelectedBoxId(null);
        dragRef.current = { type: "draw", start: imagePoint, current: imagePoint };
        scheduleDraw();
        return;
      }

      const hit = hitTest(canvasPoint, display, boxesRef.current, imageW, imageH);
      if (hit.index >= 0) {
        pushUndo("edit box");
        setSelectedBoxId(hit.index);
        setSelectedProposalId?.(null);
        setCurrentClass(boxesRef.current[hit.index].classId);
        dragRef.current = {
          type: "box",
          index: hit.index,
          handle: hit.handle,
          start: pixelPoint,
          startRect: boxToImagePixelRect(boxesRef.current[hit.index], imageW, imageH),
          moved: false
        };
      } else if (proposalsRef && setSelectedProposalId) {
        const proposals = proposalsRef.current;
        const proposalIdx = hitTestProposals(canvasPoint, display, proposals, imageW, imageH);
        if (proposalIdx >= 0) {
          const hitId = proposals[proposalIdx].id;
          // Single-click selects the proposal; clicking selected proposal deselects it.
          // Materialize via panel ✓ button, keyboard Enter, or double-click.
          setSelectedProposalId(selectedProposalIdRef?.current === hitId ? null : hitId);
          scheduleDraw();
          return;
        }
        setSelectedBoxId(null);
        setSelectedProposalId(null);
      } else {
        setSelectedBoxId(null);
      }
      scheduleDraw();
    },
    [
      autoFitEnabled,
      blackBoxEnabled,
      boxesRef,
      canvasRef,
      displayRef,
      dragRef,
      imageRef,
      lastZoomCenterRef,
      modeRef,
      pointerToolEnabled,
      proposalsRef,
      pushUndo,
      scheduleDraw,
      selectedProposalIdRef,
      setCurrentClass,
      setError,
      setSelectedBoxId,
      setSelectedProposalId,
      viewportRef,
      zoomPointRef
    ]
  );

  const onPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLCanvasElement>) => {
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
        const dx = event.clientX - drag.startClientX;
        const dy = event.clientY - drag.startClientY;
        if (Math.abs(dx) > 5 || Math.abs(dy) > 5) drag.pureClick = false;
        viewportRef.current = clampViewportPan(canvas, image, {
          ...viewportRef.current,
          panX: drag.startPanX + dx,
          panY: drag.startPanY + dy
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
          { pointerToolEnabled, autoFitEnabled, blackBoxEnabled },
          boxAdjustModeRef.current
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
    },
    [
      autoFitEnabled,
      blackBoxEnabled,
      boxesRef,
      canvasRef,
      displayRef,
      dragRef,
      imageRef,
      lastZoomCenterRef,
      modeRef,
      pointerToolEnabled,
      scheduleDraw,
      viewportRef,
      zoomPointRef
    ]
  );

  const onPointerUp = useCallback(
    (event: ReactPointerEvent<HTMLCanvasElement>) => {
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
        if (drag.button === 1 && drag.pureClick) {
          const image = imageRef.current;
          if (image) {
            if (viewportRef.current.zoom > 1) {
              viewportRef.current = clampViewportPan(canvas, image, { zoom: 1, panX: 0, panY: 0 });
            } else {
              const point = eventCanvasPoint(event, canvas);
              const currentDisplay = displayRef.current;
              if (currentDisplay) {
                const before = canvasToImagePoint(point, currentDisplay);
                viewportRef.current = { ...viewportRef.current, zoom: 3 };
                const nextDisplay = imageDisplayRect(canvas, image, viewportRef.current);
                if (before) {
                  viewportRef.current.panX = point.x - (nextDisplay.x + before.x * nextDisplay.w);
                  viewportRef.current.panY = point.y - (nextDisplay.y + before.y * nextDisplay.h);
                }
                viewportRef.current = clampViewportPan(canvas, image, viewportRef.current);
              }
            }
          }
        }
        canvas.style.cursor = defaultPoolLabelCursor({ pointerToolEnabled, autoFitEnabled, blackBoxEnabled }, boxAdjustModeRef.current);
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
          applyBlackBox(rect).catch((err) => setError(errMessage(err)));
          scheduleDraw();
          return;
        }
        if (archivedDetectIdsRef?.current.has(classRef.current)) {
          setError("Selected class is archived. Restore it in Library before creating new boxes.");
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
    },
    [
      applyBlackBox,
      archivedDetectIdsRef,
      autoFitEnabled,
      blackBoxEnabled,
      boxesRef,
      canvasRef,
      classRef,
      displayRef,
      dragRef,
      imageRef,
      persistLabels,
      pointerToolEnabled,
      pushUndo,
      recordFixedBoxFromBox,
      scheduleDraw,
      setBoxes,
      setError,
      setSelectedBoxId,
      syncBoxToSelected,
      viewportRef
    ]
  );

  const onWheel = useCallback(
    (event: ReactWheelEvent<HTMLCanvasElement>) => {
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
    },
    [canvasRef, displayRef, imageRef, scheduleDraw, viewportRef]
  );

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onWheel
  };
}
