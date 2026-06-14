const poolLabelState = {
  currentClassId: 0,
  activeShortcutSlot: null,
  shortcutSlots: Array(10).fill(null),
  activeFixedBoxSlot: null,
  fixedBoxSlots: Array(10).fill(null),
  recordingFixedBoxSlot: null,
  fixedShortcutMode: false,
  undoStack: [],
  tracking: false,
  pointerToolEnabled: false,
  autoFitEnabled: false,
  blackBoxToolEnabled: false,
  boxAdjustMode: "grow",
  keyboardAdjusting: false,
  cursorPoint: null,
  crosshairPoint: null,
  lastZoomCenter: null
};
const POOL_LABEL_SLOT_ORDER = [1, 2, 3, 4, 5, 6, 7, 8, 9, 0];
const POOL_LABEL_SUBJECT_CURSOR = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24'%3E%3Crect x='5.5' y='5.5' width='13' height='13' fill='none' stroke='%23ef4444' stroke-width='2'/%3E%3C/svg%3E") 12 12, crosshair`;
const POOL_LABEL_ZOOM = { width: 500, height: 600, factor: 2 };
let poolLabelZoomCtx = null;
let poolLabelZoomBaseCanvas = null;
let poolLabelZoomBaseCtx = null;
let poolLabelZoomBaseKey = "";

function bindPoolLabelPageEvents() {
  el.poolLabelPointerToolBtn?.addEventListener("click", () => poolLabelTogglePointerTool());
  el.poolLabelAutoFitToolBtn?.addEventListener("click", () => poolLabelToggleAutoFit());
  el.poolLabelBlackBoxToolBtn?.addEventListener("click", () => poolLabelToggleBlackBoxTool());
  el.poolLabelRestoreBackupBtn?.addEventListener("click", () => restoreFromBackup().catch(showError));
  el.poolLabelAdjustModeBtn?.addEventListener("click", () => poolLabelToggleBoxAdjustMode());
  el.poolLabelTrackBtn?.addEventListener("click", () => poolLabelTrackForward().catch(showError));
  el.poolLabelCsrtBtn?.addEventListener("click", () => poolLabelTrackCsrtForward().catch(showError));
  el.poolLabelAddClassBtn?.addEventListener("click", () => poolLabelAddClass().catch(showError));
  el.poolLabelRenameClassBtn?.addEventListener("click", () => poolLabelRenameSelectedClass().catch(showError));
  el.poolLabelBindSlotBtn?.addEventListener("click", () => poolLabelBindSelectedToSlot().catch(showError));
  el.poolLabelClassSearchInput?.addEventListener("input", () => renderPoolLabelClassManager());
  window.addEventListener("keydown", poolLabelUpdateFixedShortcutModeFromEvent);
  window.addEventListener("keyup", event => {
    poolLabelUpdateFixedShortcutModeFromEvent(event);
    poolLabelState.keyboardAdjusting = false;
  });
  window.addEventListener("blur", () => {
    poolLabelSetFixedShortcutMode(false);
    poolLabelState.keyboardAdjusting = false;
  });
  document.addEventListener("pointerdown", poolLabelCloseShortcutMenusOnOutsideClick);
}

function isPoolLabelActive() {
  return el.app.classList.contains("pool-label");
}

function poolLabelUpdateFixedShortcutModeFromEvent(event) {
  if (poolLabelShortcutEventTargetIsSelect(event)) return;
  if (!isPoolLabelActive()) {
    poolLabelSetFixedShortcutMode(false);
    return;
  }
  poolLabelSetFixedShortcutMode(Boolean(event.altKey));
}

function poolLabelShortcutEventTargetIsSelect(event) {
  return event.target?.closest?.(".pool-label-shortcuts");
}

function poolLabelSetFixedShortcutMode(enabled) {
  const next = Boolean(enabled);
  poolLabelState.fixedShortcutMode = next;
  el.poolLabelShortcutsPanel?.classList.toggle("fixed-mode", next);
  el.poolLabelShortcutsPanel?.classList.toggle("class-mode", !next);
}

function poolLabelTogglePointerTool() {
  poolLabelState.pointerToolEnabled = !poolLabelState.pointerToolEnabled;
  if (poolLabelState.pointerToolEnabled) {
    poolLabelState.autoFitEnabled = false;
    poolLabelState.blackBoxToolEnabled = false;
  }
  poolLabelAfterToolChange();
}

function poolLabelToggleAutoFit() {
  poolLabelState.autoFitEnabled = !poolLabelState.autoFitEnabled;
  if (poolLabelState.autoFitEnabled) {
    poolLabelState.pointerToolEnabled = false;
    poolLabelState.blackBoxToolEnabled = false;
  }
  poolLabelAfterToolChange();
}

function poolLabelToggleBlackBoxTool() {
  poolLabelState.blackBoxToolEnabled = !poolLabelState.blackBoxToolEnabled;
  if (poolLabelState.blackBoxToolEnabled) {
    poolLabelState.pointerToolEnabled = false;
    poolLabelState.autoFitEnabled = false;
  }
  poolLabelAfterToolChange();
}

function poolLabelClearPointerInteraction() {
  state.selection = null;
  state.dragStart = null;
  state.boxDrag = null;
  state.viewPanDrag = null;
  poolLabelState.cursorPoint = null;
  poolLabelState.crosshairPoint = null;
}

function poolLabelSyncCanvasModeClasses() {
  if (!el.app) return;
  const active = isPoolLabelActive();
  el.app.classList.toggle("pool-label-pointer-tool", active && poolLabelState.pointerToolEnabled);
  el.app.classList.toggle("pool-label-subject-select", active && poolLabelState.autoFitEnabled);
  el.app.classList.toggle("pool-label-black-box-tool", active && poolLabelState.blackBoxToolEnabled);
  if (el.canvas && active) el.canvas.style.cursor = poolLabelDefaultCursor();
}

function poolLabelCursorForBoxHandle(handle) {
  if (handle === "n" || handle === "s") return "ns-resize";
  if (handle === "e" || handle === "w") return "ew-resize";
  if (handle === "nw" || handle === "se") return "nwse-resize";
  if (handle === "ne" || handle === "sw") return "nesw-resize";
  return "move";
}

function poolLabelSyncDisplayRect() {
  const bitmap = state.currentImage;
  if (!bitmap || !el.canvas?.parentElement) return false;
  const canvasBox = el.canvas.parentElement.getBoundingClientRect();
  const nextWidth = Math.max(1, Math.floor(canvasBox.width));
  const nextHeight = Math.max(1, Math.floor(canvasBox.height));
  if (el.canvas.width !== nextWidth) el.canvas.width = nextWidth;
  if (el.canvas.height !== nextHeight) el.canvas.height = nextHeight;
  if (el.previewOverlayCanvas) {
    if (el.previewOverlayCanvas.width !== nextWidth) el.previewOverlayCanvas.width = nextWidth;
    if (el.previewOverlayCanvas.height !== nextHeight) el.previewOverlayCanvas.height = nextHeight;
  }
  clampPreviewView();
  const baseScale = Math.min(el.canvas.width / bitmap.width, el.canvas.height / bitmap.height, 1);
  const scale = baseScale * state.viewZoom;
  const w = Math.max(1, Math.floor(bitmap.width * scale));
  const h = Math.max(1, Math.floor(bitmap.height * scale));
  const x = Math.floor((el.canvas.width - w) / 2 + state.viewPanX);
  const y = Math.floor((el.canvas.height - h) / 2 + state.viewPanY);
  state.displayRect = { x, y, w, h, imageW: bitmap.width, imageH: bitmap.height };
  return true;
}

function poolLabelBoxToImageRect(box) {
  return boxEditorBoxToImageRect(box, state.displayRect);
}

function poolLabelImagePixelsFromCanvas(px) {
  return boxEditorCanvasPixelsToImagePixels(px, state.displayRect);
}

function poolLabelPointInImageRect(point, rect, pad = 0) {
  return boxEditorPointInRect(point, rect, pad);
}

function poolLabelHitHandleAtImagePoint(point, rect) {
  return boxEditorHitHandleAtImagePoint(point, rect, state.displayRect);
}

function poolLabelHitBoxAtEvent(event, boxes) {
  poolLabelSyncDisplayRect();
  const point = poolLabelPointerImagePointFromEvent(event);
  if (!point || !Array.isArray(boxes) || !boxes.length) return { index: -1, handle: null };
  const pad = Math.max(1, Math.round(poolLabelImagePixelsFromCanvas(2)));
  const index = boxEditorBestHitIndexAtImagePoint(point, boxes, state.displayRect, pad);
  if (index < 0) return { index: -1, handle: null };
  const rect = poolLabelBoxToImageRect(boxes[index]);
  return {
    index,
    handle: poolLabelHitHandleAtImagePoint(point, rect)
  };
}

function poolLabelPreviewBoxes() {
  const pair = state.pairs[state.currentIndex];
  if (!pair) return [];
  if (state.previewBoxesImagePath === pair.imagePath && Array.isArray(state.previewBoxes)) {
    return state.previewBoxes;
  }
  if (typeof previewBoxesForCurrentPair === "function") return previewBoxesForCurrentPair();
  if (state.labelEdits.has(pair.imagePath)) return state.labelEdits.get(pair.imagePath);
  if (state.labelCache.has(pair.imagePath)) return state.labelCache.get(pair.imagePath);
  return [];
}

function poolLabelUpdateBoxCursor(event) {
  if (!poolLabelState.pointerToolEnabled) {
    el.canvas.style.cursor = poolLabelDefaultCursor();
    return;
  }
  const boxes = poolLabelPreviewBoxes();
  const hit = poolLabelHitBoxAtEvent(event, boxes);
  el.canvas.style.cursor = hit.index >= 0
    ? poolLabelCursorForBoxHandle(hit.handle)
    : "default";
}

function poolLabelScheduleOverlayRefresh(boxes) {
  scheduleUiFrame(UI_FRAME.PREVIEW_BASE, () => {
    if (typeof refreshPreviewBoxesOverlay === "function") refreshPreviewBoxesOverlay(boxes);
    else redrawPreviewOverlays();
  });
}

function poolLabelPointerImagePointFromEvent(event) {
  poolLabelSyncDisplayRect();
  if (typeof canvasToImageClamped === "function") return canvasToImageClamped(event);
  if (typeof canvasToImage === "function") return canvasToImage(event);
  return null;
}

function poolLabelAfterToolChange() {
  poolLabelClearPointerInteraction();
  poolLabelSyncPointerTool();
  poolLabelSyncAutoFitTool();
  poolLabelSyncCanvasModeClasses();
  redrawPreviewOverlays();
  saveSessionSoon();
  updatePoolLabelPanel().catch(showError);
}

function poolLabelExitPointerToolOnly() {
  if (!poolLabelState.pointerToolEnabled) return;
  poolLabelState.pointerToolEnabled = false;
  poolLabelState.cursorPoint = null;
  poolLabelState.crosshairPoint = null;
  poolLabelSyncPointerTool();
  poolLabelSyncCanvasModeClasses();
  redrawPreviewOverlays();
  saveSessionSoon();
}

function poolLabelSwitchToDrawBoxTool() {
  const changed = poolLabelState.pointerToolEnabled || poolLabelState.autoFitEnabled || poolLabelState.blackBoxToolEnabled;
  poolLabelState.pointerToolEnabled = false;
  poolLabelState.autoFitEnabled = false;
  poolLabelState.blackBoxToolEnabled = false;
  poolLabelState.cursorPoint = null;
  poolLabelState.crosshairPoint = null;
  poolLabelSyncPointerTool();
  poolLabelSyncAutoFitTool();
  poolLabelSyncBlackBoxTool();
  poolLabelSyncCanvasModeClasses();
  if (changed) {
    redrawPreviewOverlays();
    saveSessionSoon();
  }
}

function poolLabelSelectionTooSmall(selection, { allowAutoFitClick = false } = {}) {
  const w = selection.x2 - selection.x1;
  const h = selection.y2 - selection.y1;
  if (allowAutoFitClick && w < 2 && h < 2) return false;
  return w < 2 || h < 2;
}

function poolLabelSaveSessionNow() {
  if (!hasWorkspaceRoot() || typeof savePoolLabelSessionNow !== "function" || typeof poolLabelSessionData !== "function") return;
  const poolLabelData = poolLabelSessionData();
  if (!Object.keys(poolLabelData).length) return;
  poolLabelState.shortcutChangedAt = Date.now();
  savePoolLabelSessionNow(poolLabelData).catch(error => console.warn("Pool label shortcut save failed:", error));
}

function poolLabelSyncPointerTool() {
  if (!el.poolLabelPointerToolBtn) return;
  el.poolLabelPointerToolBtn.classList.toggle("active", poolLabelState.pointerToolEnabled);
  el.poolLabelPointerToolBtn.setAttribute("aria-pressed", poolLabelState.pointerToolEnabled ? "true" : "false");
  poolLabelSyncCanvasModeClasses();
}

function poolLabelSyncAutoFitTool() {
  poolLabelSyncPointerTool();
  if (!el.poolLabelAutoFitToolBtn) return;
  el.poolLabelAutoFitToolBtn.classList.toggle("active", poolLabelState.autoFitEnabled);
  el.poolLabelAutoFitToolBtn.setAttribute("aria-pressed", poolLabelState.autoFitEnabled ? "true" : "false");
  poolLabelSyncBlackBoxTool();
  poolLabelSyncBoxAdjustTool();
  poolLabelSyncCanvasModeClasses();
}

function poolLabelSyncBlackBoxTool() {
  if (!el.poolLabelBlackBoxToolBtn) return;
  el.poolLabelBlackBoxToolBtn.classList.toggle("active", poolLabelState.blackBoxToolEnabled);
  el.poolLabelBlackBoxToolBtn.setAttribute("aria-pressed", poolLabelState.blackBoxToolEnabled ? "true" : "false");
}

function poolLabelSetBoxAdjustMode(mode) {
  poolLabelState.boxAdjustMode = mode === "shrink" ? "shrink" : "grow";
  poolLabelSyncBoxAdjustTool();
  saveSessionSoon();
}

function poolLabelToggleBoxAdjustMode() {
  poolLabelSetBoxAdjustMode(poolLabelState.boxAdjustMode === "shrink" ? "grow" : "shrink");
}

function poolLabelSyncBoxAdjustTool() {
  const grow = poolLabelState.boxAdjustMode !== "shrink";
  const button = el.poolLabelAdjustModeBtn;
  if (!button) return;
  button.dataset.mode = grow ? "grow" : "shrink";
  button.title = grow ? "Box adjust: grow (Numpad +/-)" : "Box adjust: shrink (Numpad +/-)";
  button.setAttribute("aria-label", grow ? "Box adjust mode: grow" : "Box adjust mode: shrink");
}

function poolLabelDefaultCursor() {
  if (poolLabelState.pointerToolEnabled) return "default";
  if (poolLabelState.blackBoxToolEnabled) return "crosshair";
  return poolLabelState.autoFitEnabled ? POOL_LABEL_SUBJECT_CURSOR : "crosshair";
}

function poolLabelRememberZoomCenter(point) {
  if (!point) return;
  poolLabelState.lastZoomCenter = { x: point.x, y: point.y };
}

function poolLabelUpdateCursorPoint(event) {
  poolLabelState.crosshairPoint = canvasToImage(event);
  poolLabelState.cursorPoint = poolLabelPointerImagePoint(event);
  if (poolLabelState.cursorPoint) poolLabelRememberZoomCenter(poolLabelState.cursorPoint);
  if (!poolLabelState.cursorPoint && !poolLabelState.crosshairPoint) return;
  if (poolLabelState.autoFitEnabled && !state.boxDrag && !state.viewPanDrag) {
    el.canvas.style.cursor = poolLabelDefaultCursor();
  }
}

function poolLabelRefreshCursorAfterPointer(event) {
  if (event?.type === "pointerleave") {
    poolLabelClearCursorGuide();
    return;
  }
  if (!event) return;
  poolLabelUpdateCursorPoint(event);
}

function poolLabelPointerImagePoint(event) {
  const r = state.displayRect;
  if (!r || !el.canvas) return null;
  const canvasBox = el.canvas.getBoundingClientRect();
  if (
    event.clientX < canvasBox.left || event.clientY < canvasBox.top
    || event.clientX > canvasBox.right || event.clientY > canvasBox.bottom
  ) return null;
  const cx = (event.clientX - canvasBox.left) * el.canvas.width / canvasBox.width;
  const cy = (event.clientY - canvasBox.top) * el.canvas.height / canvasBox.height;
  return {
    x: Math.round(Math.max(0, Math.min(r.imageW, (cx - r.x) * r.imageW / r.w))),
    y: Math.round(Math.max(0, Math.min(r.imageH, (cy - r.y) * r.imageH / r.h)))
  };
}

function poolLabelClearCursorGuide() {
  if (!poolLabelState.cursorPoint && !poolLabelState.crosshairPoint) return;
  poolLabelState.cursorPoint = null;
  poolLabelState.crosshairPoint = null;
  if (typeof schedulePreviewGuideRedraw === "function") schedulePreviewGuideRedraw();
  else redrawPreviewOverlays();
}

function drawPoolLabelAxisGuide() {
  if (!isPoolLabelActive() || poolLabelState.pointerToolEnabled || poolLabelState.autoFitEnabled || !poolLabelState.crosshairPoint) return;
  if (!state.displayRect || state.boxDrag || state.viewPanDrag) return;
  const r = state.displayRect;
  const point = poolLabelState.crosshairPoint;
  const x = r.x + point.x * r.w / r.imageW;
  const y = r.y + point.y * r.h / r.imageH;
  const guideCtx = typeof previewGuideCtx === "function" ? previewGuideCtx() : ctx;
  guideCtx.save();
  guideCtx.strokeStyle = "#ef4444";
  guideCtx.lineWidth = 1.5;
  guideCtx.setLineDash([]);
  guideCtx.globalAlpha = 0.9;
  guideCtx.beginPath();
  guideCtx.moveTo(r.x, y);
  guideCtx.lineTo(r.x + r.w, y);
  guideCtx.moveTo(x, r.y);
  guideCtx.lineTo(x, r.y + r.h);
  guideCtx.stroke();
  guideCtx.fillStyle = "#ef4444";
  guideCtx.fillRect(x - 2, y - 2, 4, 4);
  guideCtx.restore();
}

function poolLabelZoomSideActive() {
  return isPoolLabelActive();
}

function poolLabelZoomShouldDraw() {
  return poolLabelZoomSideActive()
    && !poolLabelState.pointerToolEnabled
    && !state.viewPanDrag
    && !state.boxDrag
    && state.currentImage
    && state.displayRect;
}

function poolLabelZoomCenterPoint() {
  return poolLabelState.cursorPoint || poolLabelState.lastZoomCenter;
}

function poolLabelFillZoomCanvas(zoomCtx) {
  const width = zoomCtx.canvas?.width || POOL_LABEL_ZOOM.width;
  const height = zoomCtx.canvas?.height || POOL_LABEL_ZOOM.height;
  zoomCtx.clearRect(0, 0, width, height);
  zoomCtx.fillStyle = "#111827";
  zoomCtx.fillRect(0, 0, width, height);
}

function poolLabelSyncZoomClassLabel() {
  if (!el.poolLabelZoomClass) return;
  el.poolLabelZoomClass.textContent = poolLabelZoomShouldDraw()
    ? poolLabelZoomClassLabel()
    : "";
}

function poolLabelZoomContext() {
  if (!el.poolLabelZoomCanvas) return null;
  if (!poolLabelZoomCtx) poolLabelZoomCtx = el.poolLabelZoomCanvas.getContext("2d");
  return poolLabelZoomCtx;
}

function poolLabelZoomBaseContext() {
  if (!poolLabelZoomBaseCanvas) {
    poolLabelZoomBaseCanvas = document.createElement("canvas");
    poolLabelZoomBaseCtx = poolLabelZoomBaseCanvas.getContext("2d");
  }
  if (poolLabelZoomBaseCanvas.width !== POOL_LABEL_ZOOM.width) {
    poolLabelZoomBaseCanvas.width = POOL_LABEL_ZOOM.width;
    poolLabelZoomBaseKey = "";
  }
  if (poolLabelZoomBaseCanvas.height !== POOL_LABEL_ZOOM.height) {
    poolLabelZoomBaseCanvas.height = POOL_LABEL_ZOOM.height;
    poolLabelZoomBaseKey = "";
  }
  return poolLabelZoomBaseCtx;
}

function poolLabelZoomBaseCacheKey(sourceRect) {
  const pair = state.pairs[state.currentIndex];
  const boxes = poolLabelPreviewBoxes();
  const selection = state.selection;
  const selectionKey = selection
    ? `${selection.x1 | 0},${selection.y1 | 0},${selection.x2 | 0},${selection.y2 | 0}`
    : "";
  const boxKey = boxes.map(box => `${box.classId}:${box.x}:${box.y}:${box.w}:${box.h}`).join(";");
  return [
    pair?.imagePath || "",
    state.selectedBoxIndex ?? "",
    boxKey,
    sourceRect.x1 | 0,
    sourceRect.y1 | 0,
    sourceRect.x2 | 0,
    sourceRect.y2 | 0,
    selectionKey,
    poolLabelState.blackBoxToolEnabled ? "b" : "n"
  ].join("|");
}

function poolLabelInvalidateZoomBase() {
  poolLabelZoomBaseKey = "";
}
window.poolLabelInvalidateZoomBase = poolLabelInvalidateZoomBase;

function poolLabelZoomClassLabel() {
  const classId = poolLabelState.currentClassId;
  const className = state.classNames.get(classId) || "";
  return `[${classId}] ${className}`;
}

function poolLabelZoomSourceRect(center) {
  const r = state.displayRect;
  const bitmap = state.currentImage;
  if (!r || !bitmap || !center) return null;
  const displayScale = r.w / r.imageW;
  const viewScale = displayScale * POOL_LABEL_ZOOM.factor;
  let srcW = POOL_LABEL_ZOOM.width / viewScale;
  let srcH = POOL_LABEL_ZOOM.height / viewScale;
  srcW = Math.min(srcW, bitmap.width);
  srcH = Math.min(srcH, bitmap.height);
  let x1 = center.x - srcW / 2;
  let y1 = center.y - srcH / 2;
  x1 = Math.max(0, Math.min(bitmap.width - srcW, x1));
  y1 = Math.max(0, Math.min(bitmap.height - srcH, y1));
  return { x1, y1, x2: x1 + srcW, y2: y1 + srcH };
}

function poolLabelPointInZoomSource(point, sourceRect) {
  return point.x >= sourceRect.x1 && point.x <= sourceRect.x2
    && point.y >= sourceRect.y1 && point.y <= sourceRect.y2;
}

function poolLabelImageToZoomCanvas(point, sourceRect) {
  const srcW = sourceRect.x2 - sourceRect.x1;
  const srcH = sourceRect.y2 - sourceRect.y1;
  return {
    x: (point.x - sourceRect.x1) / srcW * POOL_LABEL_ZOOM.width,
    y: (point.y - sourceRect.y1) / srcH * POOL_LABEL_ZOOM.height
  };
}

function poolLabelDrawZoomCrosshair(zoomCtx, x, y, color, alpha = 1) {
  const arm = 14;
  zoomCtx.save();
  zoomCtx.strokeStyle = color;
  zoomCtx.lineWidth = 1.5;
  zoomCtx.globalAlpha = alpha;
  zoomCtx.setLineDash([]);
  zoomCtx.beginPath();
  zoomCtx.moveTo(x - arm, y);
  zoomCtx.lineTo(x + arm, y);
  zoomCtx.moveTo(x, y - arm);
  zoomCtx.lineTo(x, y + arm);
  zoomCtx.stroke();
  zoomCtx.fillStyle = color;
  zoomCtx.fillRect(x - 2.5, y - 2.5, 5, 5);
  zoomCtx.restore();
}

function poolLabelDrawZoomFullCrosshair(zoomCtx, x, y, color, alpha = 0.9) {
  const w = zoomCtx.canvas?.width || POOL_LABEL_ZOOM.width;
  const h = zoomCtx.canvas?.height || POOL_LABEL_ZOOM.height;
  zoomCtx.save();
  zoomCtx.strokeStyle = color;
  zoomCtx.lineWidth = 1.5;
  zoomCtx.globalAlpha = alpha;
  zoomCtx.setLineDash([]);
  zoomCtx.beginPath();
  zoomCtx.moveTo(0, y);
  zoomCtx.lineTo(w, y);
  zoomCtx.moveTo(x, 0);
  zoomCtx.lineTo(x, h);
  zoomCtx.stroke();
  zoomCtx.fillStyle = color;
  zoomCtx.fillRect(x - 2, y - 2, 4, 4);
  zoomCtx.restore();
}

function poolLabelRectIntersectsZoomSource(rect, sourceRect) {
  return rect.x2 > sourceRect.x1 && rect.x1 < sourceRect.x2
    && rect.y2 > sourceRect.y1 && rect.y1 < sourceRect.y2;
}

function poolLabelDrawZoomRect(zoomCtx, rect, sourceRect, color, dashed, lineWidth = 2) {
  const x1 = poolLabelImageToZoomCanvas({ x: rect.x1, y: rect.y1 }, sourceRect).x;
  const y1 = poolLabelImageToZoomCanvas({ x: rect.x1, y: rect.y1 }, sourceRect).y;
  const x2 = poolLabelImageToZoomCanvas({ x: rect.x2, y: rect.y2 }, sourceRect).x;
  const y2 = poolLabelImageToZoomCanvas({ x: rect.x2, y: rect.y2 }, sourceRect).y;
  const left = Math.min(x1, x2);
  const top = Math.min(y1, y2);
  const width = Math.abs(x2 - x1);
  const height = Math.abs(y2 - y1);
  zoomCtx.save();
  zoomCtx.strokeStyle = color;
  zoomCtx.lineWidth = lineWidth;
  zoomCtx.setLineDash(dashed ? [6, 4] : []);
  zoomCtx.strokeRect(left, top, width, height);
  zoomCtx.restore();
}

function poolLabelDrawZoomBoxes(zoomCtx, boxes, sourceRect) {
  if (!boxes?.length || state.datasetTask === "classify") return;
  for (let index = 0; index < boxes.length; index += 1) {
    const rect = poolLabelBoxToImageRect(boxes[index]);
    if (!rect || !poolLabelRectIntersectsZoomSource(rect, sourceRect)) continue;
    const selected = index === state.selectedBoxIndex;
    poolLabelDrawZoomRect(
      zoomCtx,
      rect,
      sourceRect,
      selected ? "#2563eb" : "#18a058",
      false,
      selected ? 3 : 2
    );
  }
}

function drawPoolLabelZoomView() {
  if (!poolLabelZoomSideActive()) return;

  const zoomCanvas = el.poolLabelZoomCanvas;
  const zoomCtx = poolLabelZoomContext();
  if (!zoomCanvas || !zoomCtx) return;

  if (zoomCanvas.width !== POOL_LABEL_ZOOM.width) {
    zoomCanvas.width = POOL_LABEL_ZOOM.width;
    poolLabelInvalidateZoomBase();
  }
  if (zoomCanvas.height !== POOL_LABEL_ZOOM.height) {
    zoomCanvas.height = POOL_LABEL_ZOOM.height;
    poolLabelInvalidateZoomBase();
  }
  poolLabelSyncZoomClassLabel();

  if (!poolLabelZoomShouldDraw()) {
    poolLabelFillZoomCanvas(zoomCtx);
    poolLabelInvalidateZoomBase();
    return;
  }

  const center = poolLabelZoomCenterPoint();
  if (!center) {
    poolLabelFillZoomCanvas(zoomCtx);
    poolLabelInvalidateZoomBase();
    return;
  }

  const sourceRect = poolLabelZoomSourceRect(center);
  if (!sourceRect) {
    poolLabelFillZoomCanvas(zoomCtx);
    poolLabelInvalidateZoomBase();
    return;
  }

  const baseKey = poolLabelZoomBaseCacheKey(sourceRect);
  const baseCtx = poolLabelZoomBaseContext();
  if (baseKey !== poolLabelZoomBaseKey) {
    poolLabelFillZoomCanvas(baseCtx);
    const srcW = sourceRect.x2 - sourceRect.x1;
    const srcH = sourceRect.y2 - sourceRect.y1;
    baseCtx.drawImage(
      state.currentImage,
      sourceRect.x1, sourceRect.y1, srcW, srcH,
      0, 0, POOL_LABEL_ZOOM.width, POOL_LABEL_ZOOM.height
    );
    poolLabelDrawZoomBoxes(baseCtx, poolLabelPreviewBoxes(), sourceRect);
    if (state.selection) {
      poolLabelDrawZoomRect(
        baseCtx,
        state.selection,
        sourceRect,
        poolLabelState.blackBoxToolEnabled ? "#ef4444" : "#2563eb",
        true
      );
    }
    poolLabelZoomBaseKey = baseKey;
  }

  poolLabelFillZoomCanvas(zoomCtx);
  zoomCtx.drawImage(poolLabelZoomBaseCanvas, 0, 0);
  poolLabelDrawZoomFullCrosshair(
    zoomCtx,
    POOL_LABEL_ZOOM.width / 2,
    POOL_LABEL_ZOOM.height / 2,
    "#ef4444"
  );

  if (state.dragStart && poolLabelPointInZoomSource(state.dragStart, sourceRect)) {
    const anchorPt = poolLabelImageToZoomCanvas(state.dragStart, sourceRect);
    poolLabelDrawZoomCrosshair(zoomCtx, anchorPt.x, anchorPt.y, "#2563eb", 0.85);
  }
}

async function onPoolLabelPointerDown(event) {
  if (!state.currentImage) return;
  poolLabelSyncDisplayRect();
  if (!state.displayRect) return;
  try { el.canvas.setPointerCapture(event.pointerId); } catch {}
  poolLabelUpdateCursorPoint(event);
  if (event.button === 1 || event.button === 2) {
    event.preventDefault();
    poolLabelState.cursorPoint = null;
    poolLabelState.crosshairPoint = null;
    startPreviewPan(event);
    return;
  }
  const pair = state.pairs[state.currentIndex];
  if (!pair) return;
  const boxes = poolLabelPreviewBoxes();
  if (poolLabelState.pointerToolEnabled) {
    const hit = poolLabelHitBoxAtEvent(event, boxes);
    const index = hit.index;
    if (index >= 0) {
      const box = boxes[index];
      const rect = poolLabelBoxToImageRect(box);
      let point = poolLabelPointerImagePointFromEvent(event);
      if (!point && rect) {
        point = {
          x: Math.round((rect.x1 + rect.x2) / 2),
          y: Math.round((rect.y1 + rect.y2) / 2)
        };
      }
      if (!point || !rect) return;
      state.selectedBoxIndex = index;
      state.boxDrag = {
        handle: hit.handle,
        start: point,
        rect,
        index,
        undoPushed: false,
        moved: false
      };
      poolLabelState.currentClassId = box.classId;
      populateBoxEditor(box);
      poolLabelScheduleOverlayRefresh(boxes);
      updatePoolLabelPanel().catch(showError);
      return;
    }
    state.selectedBoxIndex = null;
    populateBoxEditor(null);
    poolLabelScheduleOverlayRefresh(boxes);
    updatePoolLabelPanel().catch(showError);
    return;
  }
  const point = poolLabelPointerImagePointFromEvent(event);
  if (!point) return;
  state.selectedBoxIndex = null;
  populateBoxEditor(null);
  state.dragStart = point;
  state.selection = { x1: point.x, y1: point.y, x2: point.x, y2: point.y };
  redrawPreviewOverlays();
}

async function onPoolLabelPointerMove(event) {
  if (state.viewPanDrag) {
    poolLabelState.cursorPoint = null;
    poolLabelState.crosshairPoint = null;
    state.viewPanX = state.viewPanDrag.panX + (event.clientX - state.viewPanDrag.startX);
    state.viewPanY = state.viewPanDrag.panY + (event.clientY - state.viewPanDrag.startY);
    clampPreviewView();
    schedulePreviewBaseRepaint?.();
    el.canvas.style.cursor = "grabbing";
    return;
  }
  if (state.boxDrag) {
    poolLabelState.cursorPoint = null;
    poolLabelState.crosshairPoint = null;
    const point = poolLabelPointerImagePointFromEvent(event);
    if (!point) return;
    const drag = state.boxDrag;
    const dx = point.x - drag.start.x;
    const dy = point.y - drag.start.y;
    if (!drag.moved && Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
    const pair = state.pairs[state.currentIndex];
    if (pair && !drag.undoPushed) {
      const boxes = await editableBoxesFor(pair);
      poolLabelPushUndo(pair, boxes, "edit box");
      drag.undoPushed = true;
    }
    drag.moved = true;
    await updateBoxDirectEdit(event);
    return;
  }
  if (state.dragStart) {
    poolLabelState.cursorPoint = poolLabelPointerImagePoint(event);
    poolLabelState.crosshairPoint = canvasToImage(event) || poolLabelState.cursorPoint;
    if (poolLabelState.cursorPoint) poolLabelRememberZoomCenter(poolLabelState.cursorPoint);
    if (!poolLabelState.cursorPoint) return;
    const point = poolLabelState.crosshairPoint || poolLabelState.cursorPoint;
    state.selection = normalizeRect(state.dragStart, point);
    if (typeof schedulePreviewGuideRedraw === "function") schedulePreviewGuideRedraw();
    else redrawPreviewOverlays();
    return;
  }
  poolLabelUpdateCursorPoint(event);
  if (poolLabelState.pointerToolEnabled) {
    poolLabelUpdateBoxCursor(event);
    return;
  }
  el.canvas.style.cursor = poolLabelDefaultCursor();
  if (typeof schedulePreviewGuideRedraw === "function") schedulePreviewGuideRedraw();
  else redrawPreviewOverlays();
}

async function onPoolLabelPointerUp(event) {
  if (event) {
    try { el.canvas.releasePointerCapture(event.pointerId); } catch {}
  }
  if (event?.type === "pointerleave") {
    poolLabelClearCursorGuide();
  }
  if (state.viewPanDrag) {
    state.viewPanDrag = null;
    poolLabelRefreshCursorAfterPointer(event);
    el.canvas.style.cursor = poolLabelDefaultCursor();
    flushUiFrame?.();
    redrawPreviewOverlays();
    return;
  }
  const pair = state.pairs[state.currentIndex];
  if (state.boxDrag) {
    const drag = state.boxDrag;
    const dragIndex = drag.index;
    const boxes = pair ? state.labelEdits.get(pair.imagePath) : null;
    state.boxDrag = null;
    poolLabelRefreshCursorAfterPointer(event);
    if (pair && boxes && drag.moved) {
      let synced = 0;
      redrawPreviewOverlays();
      await persistLabelBoxes(pair, boxes);
      if (boxes[dragIndex]) synced = await poolLabelSyncBoxToSelected(pair, boxes[dragIndex], "sync edited box");
      await poolLabelRefreshAfterEdit(poolLabelSyncMessage("", synced));
      return;
    }
    poolLabelScheduleOverlayRefresh(poolLabelPreviewBoxes());
    if (poolLabelState.pointerToolEnabled) poolLabelUpdateBoxCursor(event);
    else el.canvas.style.cursor = poolLabelDefaultCursor();
    redrawPreviewOverlays();
    updatePoolLabelPanel().catch(showError);
    return;
  }
  if (!state.dragStart) {
    if (poolLabelState.pointerToolEnabled) updatePoolLabelPanel().catch(showError);
    return;
  }
  const seedPoint = state.dragStart;
  state.dragStart = null;
  const selection = state.selection;
  state.selection = null;
  poolLabelRefreshCursorAfterPointer(event);
  redrawPreviewOverlays();
  const shouldBlackBox = poolLabelState.blackBoxToolEnabled;
  const shouldAutoFit = poolLabelState.autoFitEnabled && !event?.shiftKey && !shouldBlackBox;
  const tooSmall = poolLabelSelectionTooSmall(selection, { allowAutoFitClick: shouldAutoFit });
  if (!pair || !selection || tooSmall) {
    await renderCurrentImage();
    await updatePoolLabelPanel();
    return;
  }
  if (shouldBlackBox) {
    await poolLabelApplyBlackBoxSelection(pair, selection);
    return;
  }
  const boxes = await editableBoxesFor(pair);
  poolLabelPushUndo(pair, boxes, "add box");
  const fittedSelection = shouldAutoFit ? await poolLabelAutoFitSelection(pair, selection, seedPoint) : selection;
  const box = rectToBox(fittedSelection, poolLabelState.currentClassId);
  boxes.push(box);
  state.selectedBoxIndex = boxes.length - 1;
  populateBoxEditor(box);
  const fixedBoxMessage = poolLabelRecordFixedBoxFromBox(box);
  await persistLabelBoxes(pair, boxes);
  const synced = await poolLabelSyncBoxToSelected(pair, box, "sync added box");
  await poolLabelRefreshAfterEdit(
    poolLabelSyncMessage(
      fixedBoxMessage || (fittedSelection !== selection ? "Color subject box saved. Shift keeps drawn box." : ""),
      synced
    )
  );
}

function onPoolLabelKeyDown(event) {
  const tag = event.target?.tagName?.toLowerCase();
  if (tag === "input" || tag === "textarea" || event.target?.isContentEditable) return false;
  const key = event.key.toLowerCase();
  const topRowDigitSlot = poolLabelTopRowDigit(event);
  const numpadDigit = poolLabelNumpadDigit(event);
  if (event.ctrlKey && key === "s") {
    event.preventDefault();
    poolLabelSaveCurrent().then(() => updatePoolLabelPanel("Saved current TXT.")).catch(showError);
    return true;
  }
  if (event.ctrlKey && key === "z") {
    event.preventDefault();
    poolLabelUndoLast().catch(showError);
    return true;
  }
  if (key === "escape") {
    event.preventDefault();
    state.selectedBoxIndex = null;
    state.selection = null;
    state.dragStart = null;
    state.boxDrag = null;
    populateBoxEditor(null);
    renderCurrentImage().then(() => updatePoolLabelPanel("Selection cleared.")).catch(showError);
    return true;
  }
  if (topRowDigitSlot !== null) {
    event.preventDefault();
    if (event.altKey) poolLabelUseFixedBoxSlot(topRowDigitSlot).catch(showError);
    else poolLabelUseShortcutSlot(topRowDigitSlot).catch(showError);
    return true;
  }
  if (event.code === "NumpadAdd") {
    event.preventDefault();
    poolLabelSetBoxAdjustMode("grow");
    return true;
  }
  if (event.code === "NumpadSubtract") {
    event.preventDefault();
    poolLabelSetBoxAdjustMode("shrink");
    return true;
  }
  const arrowDelta = poolLabelArrowKeyDelta(key, event.code);
  if (arrowDelta || numpadDigit !== null) {
    event.preventDefault();
    poolLabelKeyboardAdjustSelectedBox(event, { arrowDelta, numpadDigit }).catch(showError);
    return true;
  }
  if (key === "delete" || key === "backspace") {
    event.preventDefault();
    poolLabelDeleteSelected().catch(showError);
    return true;
  }
  if (key === "v") {
    event.preventDefault();
    poolLabelTogglePointerTool();
    return true;
  }
  if (key === "w") {
    event.preventDefault();
    poolLabelToggleAutoFit();
    return true;
  }
  if (key === "t" && event.shiftKey) {
    event.preventDefault();
    poolLabelTrackCsrtForward().catch(showError);
    return true;
  }
  if (key === "t") {
    event.preventDefault();
    poolLabelTrackForward().catch(showError);
    return true;
  }
  if (key === "a") {
    event.preventDefault();
    poolLabelNavigate(-1).catch(showError);
    return true;
  }
  if (key === "d") {
    event.preventDefault();
    poolLabelNavigate(1).catch(showError);
    return true;
  }
  return false;
}

function poolLabelTopRowDigit(event) {
  const digit = /^Digit([0-9])$/.exec(event.code || "");
  return digit ? Number(digit[1]) : null;
}

function poolLabelNumpadDigit(event) {
  if (poolLabelArrowKeyDelta(event.key, event.code)) return null;
  const numpad = /^Numpad([0-9])$/.exec(event.code || "");
  return numpad ? Number(numpad[1]) : null;
}

function poolLabelArrowKeyDelta(key, code = "") {
  const normalized = String(key || "").toLowerCase();
  const keyCode = String(code || "");
  if (normalized === "arrowleft" || normalized === "left" || keyCode === "ArrowLeft") return { dx: -1, dy: 0 };
  if (normalized === "arrowright" || normalized === "right" || keyCode === "ArrowRight") return { dx: 1, dy: 0 };
  if (normalized === "arrowup" || normalized === "up" || keyCode === "ArrowUp") return { dx: 0, dy: -1 };
  if (normalized === "arrowdown" || normalized === "down" || keyCode === "ArrowDown") return { dx: 0, dy: 1 };
  return null;
}

async function poolLabelKeyboardAdjustSelectedBox(event, { arrowDelta, numpadDigit }) {
  const pair = state.pairs[state.currentIndex];
  if (!pair || state.selectedBoxIndex === null || !state.displayRect) return;
  const boxes = await editableBoxesFor(pair);
  const box = boxes[state.selectedBoxIndex];
  if (!box) return;

  const rect = boxToImageRect(box);
  const before = { ...rect };
  const step = event.shiftKey ? 10 : 1;
  if (arrowDelta) {
    poolLabelMoveImageRect(rect, arrowDelta.dx * step, arrowDelta.dy * step);
  } else if (numpadDigit !== null) {
    poolLabelResizeImageRectByNumpad(rect, numpadDigit, step);
  }
  if (poolLabelRectsEqual(before, rect)) return;

  const shouldPushUndo = !event.repeat && !poolLabelState.keyboardAdjusting;
  if (shouldPushUndo) {
    poolLabelPushUndo(pair, boxes, "keyboard adjust box");
    poolLabelState.keyboardAdjusting = true;
  }
  boxes[state.selectedBoxIndex] = rectToBox(rect, box.classId);
  state.labelEdits.set(pair.imagePath, boxes);
  populateBoxEditor(boxes[state.selectedBoxIndex]);
  await persistLabelBoxes(pair, boxes);
  const synced = await poolLabelSyncBoxToSelected(pair, boxes[state.selectedBoxIndex], "sync keyboard adjusted box", { pushUndo: shouldPushUndo });
  await poolLabelRefreshAfterEdit(poolLabelSyncMessage("Box adjusted.", synced));
}

function poolLabelMoveImageRect(rect, dx, dy) {
  boxEditorMoveRect(rect, dx, dy, state.displayRect.imageW, state.displayRect.imageH);
}

function poolLabelResizeImageRectByNumpad(rect, digit, step) {
  const handlesByDigit = {
    8: ["n"],
    2: ["s"],
    4: ["w"],
    6: ["e"],
    5: ["n", "s", "w", "e"]
  };
  const handles = handlesByDigit[digit];
  if (!handles) return;
  const grow = poolLabelState.boxAdjustMode !== "shrink";
  boxEditorResizeRectByEdges(rect, handles, grow, step, state.displayRect.imageW, state.displayRect.imageH);
}

async function poolLabelApplyBlackBoxSelection(pair, selection) {
  if (!pair || !selection) return;
  if (typeof addPendingBlackToPair !== "function" || typeof applyBlackEditsForPair !== "function") {
    throw new Error("Black box editing is not available.");
  }
  const rect = await poolLabelNormalizeBlackBoxRect(pair, selection);
  if (!rect) {
    await updatePoolLabelPanel("Black box is outside the image.");
    return;
  }
  const undoSnapshot = await poolLabelCreateImageUndoSnapshot(pair, "black box");
  addPendingBlackToPair(pair, rect);
  const count = await applyBlackEditsForPair(pair);
  if (count && undoSnapshot) poolLabelPushUndoSnapshot(undoSnapshot);
  if (typeof updatePendingStatus === "function") updatePendingStatus();
  if (typeof renderCurrentPendingList === "function") renderCurrentPendingList();
  await renderCurrentImage();
  renderGallery();
  await updatePoolLabelPanel(count ? `Applied ${count} black box(es).` : "No black box applied.");
}

async function poolLabelNormalizeBlackBoxRect(pair, selection) {
  const previewW = state.displayRect?.imageW || state.currentImage?.width;
  const previewH = state.displayRect?.imageH || state.currentImage?.height;
  if (!previewW || !previewH) return null;
  const previewRect = poolLabelClampRectToBitmap(selection, previewW, previewH);
  if (!previewRect) return null;
  const sourceBitmap = await imageBitmap(pair.imageHandle);
  const sourceW = sourceBitmap.width;
  const sourceH = sourceBitmap.height;
  if (typeof sourceBitmap.close === "function") sourceBitmap.close();
  if (sourceW === previewW && sourceH === previewH) return previewRect;
  return poolLabelClampRectToBitmap({
    x1: Math.floor(previewRect.x1 * sourceW / previewW),
    y1: Math.floor(previewRect.y1 * sourceH / previewH),
    x2: Math.ceil(previewRect.x2 * sourceW / previewW),
    y2: Math.ceil(previewRect.y2 * sourceH / previewH)
  }, sourceW, sourceH);
}

function poolLabelRectsEqual(a, b) {
  return a.x1 === b.x1 && a.y1 === b.y1 && a.x2 === b.x2 && a.y2 === b.y2;
}

async function poolLabelAssignClass(classId, options = {}) {
  if (!Number.isInteger(classId) || classId < 0) return;
  poolLabelState.activeShortcutSlot = Number.isInteger(options.shortcutSlot) ? options.shortcutSlot : null;
  poolLabelState.activeFixedBoxSlot = null;
  poolLabelState.currentClassId = classId;
  el.poolLabelClassNameInput.value = state.classNames.get(classId) || "";
  if (state.dragStart || state.boxDrag || state.viewPanDrag || state.selection) {
    poolLabelClearPointerInteraction();
    redrawPreviewOverlays();
  }
  if (document.activeElement?.closest?.(".pool-label-tools, .pool-label-class-list")) {
    document.activeElement.blur();
  }
  const pair = state.pairs[state.currentIndex];
  if (pair && state.selectedBoxIndex !== null) {
    const boxes = await editableBoxesFor(pair);
    if (boxes[state.selectedBoxIndex]) {
      poolLabelPushUndo(pair, boxes, "change class");
      boxes[state.selectedBoxIndex] = { ...boxes[state.selectedBoxIndex], classId };
      populateBoxEditor(boxes[state.selectedBoxIndex]);
      await persistLabelBoxes(pair, boxes);
      const synced = await poolLabelSyncBoxToSelected(pair, boxes[state.selectedBoxIndex], "sync class change");
      await poolLabelRefreshAfterEdit(poolLabelSyncMessage("", synced));
      return;
    }
  }
  poolLabelExitPointerToolOnly();
  await updatePoolLabelPanel(`Class ${classDisplay(classId)} selected for new boxes.`);
}

async function poolLabelUseShortcutSlot(slot) {
  const classId = poolLabelState.shortcutSlots[slot];
  if (!Number.isInteger(classId) || !state.classNames.has(classId)) {
    await updatePoolLabelPanel(`Shortcut ${slot} is empty. Select a class, then bind it to this slot.`);
    return;
  }
  await poolLabelAssignClass(classId, { shortcutSlot: slot });
}

async function poolLabelBindSelectedToSlot() {
  const slot = Number(el.poolLabelBindSlotSelect.value);
  if (!Number.isInteger(slot) || slot < 0 || slot > 9) return;
  if (!state.classNames.has(poolLabelState.currentClassId)) {
    await updatePoolLabelPanel("Select or create a class before binding a shortcut slot.");
    return;
  }
  poolLabelState.shortcutSlots[slot] = poolLabelState.currentClassId;
  poolLabelSaveSessionNow();
  await updatePoolLabelPanel(`Bound shortcut ${slot} to ${classDisplay(poolLabelState.currentClassId)}.`);
}

async function poolLabelStartFixedBoxRecording(slot, classId) {
  if (!Number.isInteger(slot) || slot < 0 || slot > 9) return;
  if (!Number.isInteger(classId) || !state.classNames.has(classId)) {
    poolLabelState.fixedBoxSlots[slot] = null;
    if (poolLabelState.recordingFixedBoxSlot === slot) poolLabelState.recordingFixedBoxSlot = null;
    poolLabelSaveSessionNow();
    await updatePoolLabelPanel(`Fixed box ${slot} cleared.`);
    return;
  }
  poolLabelState.currentClassId = classId;
  poolLabelState.activeShortcutSlot = null;
  poolLabelState.activeFixedBoxSlot = slot;
  poolLabelState.recordingFixedBoxSlot = slot;
  poolLabelState.fixedBoxSlots[slot] = { classId, x: null, y: null, w: null, h: null };
  el.poolLabelClassNameInput.value = state.classNames.get(classId) || "";
  poolLabelSwitchToDrawBoxTool();
  poolLabelSaveSessionNow();
  await updatePoolLabelPanel(`Draw one ${classDisplay(classId)} box to record fixed box ${slot}. Hold Alt and press ${slot} to create it.`);
}

function poolLabelRecordFixedBoxFromBox(box) {
  const slot = poolLabelState.recordingFixedBoxSlot;
  if (!Number.isInteger(slot) || slot < 0 || slot > 9) return "";
  poolLabelState.fixedBoxSlots[slot] = {
    classId: box.classId,
    x: box.x,
    y: box.y,
    w: box.w,
    h: box.h
  };
  poolLabelState.activeFixedBoxSlot = slot;
  poolLabelState.recordingFixedBoxSlot = null;
  poolLabelSaveSessionNow();
  return `Recorded fixed box ${slot}: ${classDisplay(box.classId)}. Hold Alt and press ${slot} to create it.`;
}

async function poolLabelUseFixedBoxSlot(slot) {
  const template = poolLabelState.fixedBoxSlots[slot];
  if (!poolLabelFixedBoxSlotReady(template)) {
    await updatePoolLabelPanel(`Fixed box ${slot} is empty. Choose a class in the fixed box row, then draw it once.`);
    return;
  }
  const pair = state.pairs[state.currentIndex];
  if (!pair) return;
  const box = {
    classId: template.classId,
    x: clamp01(template.x),
    y: clamp01(template.y),
    w: clamp01(template.w),
    h: clamp01(template.h)
  };
  const boxes = await editableBoxesFor(pair);
  poolLabelPushUndo(pair, boxes, "fixed box");
  boxes.push(box);
  state.selectedBoxIndex = boxes.length - 1;
  poolLabelState.activeShortcutSlot = null;
  poolLabelState.activeFixedBoxSlot = slot;
  populateBoxEditor(box);
  await persistLabelBoxes(pair, boxes);
  const synced = await poolLabelSyncBoxToSelected(pair, box, "sync fixed box");
  await poolLabelRefreshAfterEdit(poolLabelSyncMessage(`Created fixed box ${slot}: ${classDisplay(box.classId)}.`, synced));
}

async function poolLabelAddClass() {
  const name = poolLabelClassInputName();
  if (!name) {
    await updatePoolLabelPanel("Enter a class name first.");
    return;
  }
  const existing = [...state.classNames.entries()].find(([, value]) => value.toLowerCase() === name.toLowerCase());
  if (existing) {
    await poolLabelAssignClass(existing[0]);
    await updatePoolLabelPanel(`Selected existing class ${classDisplay(existing[0])}.`);
    return;
  }
  const ids = [...state.classNames.keys()].filter(Number.isFinite);
  const nextId = ids.length ? Math.max(...ids) + 1 : 0;
  state.classNames.set(nextId, name);
  await poolLabelWriteClassFiles();
  await poolLabelAssignClass(nextId);
  await updatePoolLabelPanel(`Created class ${classDisplay(nextId)}.`);
}

async function poolLabelRenameSelectedClass() {
  const classId = poolLabelState.currentClassId;
  if (!state.classNames.has(classId)) {
    await updatePoolLabelPanel("Select a class before renaming.");
    return;
  }
  const name = poolLabelClassInputName();
  if (!name) {
    await updatePoolLabelPanel("Enter a new class name first.");
    return;
  }
  state.classNames.set(classId, name);
  await poolLabelWriteClassFiles();
  await renderCurrentImage();
  renderGallery();
  await updatePoolLabelPanel(`Renamed class ${classId} to ${name}.`);
}

function poolLabelClassInputName() {
  return String(el.poolLabelClassNameInput?.value || "").trim();
}

async function poolLabelWriteClassFiles() {
  if (!state.datasetBackendRoot && !state.datasetHandle) {
    throw new Error("Open a workspace or dataset before editing classes.");
  }
  const text = poolLabelClassesText();
  await poolLabelWriteRootTextFile("classes.txt", text);
  await poolLabelWriteRootTextFile("data.yaml", await poolLabelDataYamlText());
  if (state.datasetBackendRoot) {
    state.files.set("classes.txt", backendFileHandle(state.datasetBackendRoot, "classes.txt"));
    state.files.set("data.yaml", backendFileHandle(state.datasetBackendRoot, "data.yaml"));
  }
  saveSessionSoon();
}

async function poolLabelWriteRootTextFile(relativePath, text) {
  if (state.datasetBackendRoot) {
    await backendCall("writeTextFile", state.datasetBackendRoot, relativePath, text);
    return;
  }
  const parts = relativePath.split("/");
  let dir = state.datasetHandle;
  for (const part of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(part, { create: true });
  const handle = await dir.getFileHandle(parts.at(-1), { create: true });
  await writeText(handle, text);
  state.files.set(relativePath, handle);
}

function poolLabelClassesText() {
  const maxId = Math.max(-1, ...state.classNames.keys());
  const lines = [];
  for (let id = 0; id <= maxId; id += 1) lines.push(state.classNames.get(id) || "");
  return `${lines.join("\n")}\n`;
}

async function poolLabelDataYamlText() {
  const existing = await poolLabelReadRootTextFile("data.yaml");
  const namesBlock = poolLabelDataYamlNamesBlock();
  if (!existing.trim()) return namesBlock;
  const lines = existing.split(/\r?\n/);
  const out = [];
  let replaced = false;
  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index];
    if (!replaced && /^names\s*:/.test(raw.trim())) {
      out.push(...namesBlock.trimEnd().split("\n"));
      replaced = true;
      while (index + 1 < lines.length) {
        const next = lines[index + 1];
        if (!next.trim()) {
          index += 1;
          continue;
        }
        if (/^\s/.test(next)) {
          index += 1;
          continue;
        }
        break;
      }
      continue;
    }
    out.push(raw);
  }
  if (!replaced) {
    if (out.length && out.at(-1).trim()) out.push("");
    out.push(...namesBlock.trimEnd().split("\n"));
  }
  return `${out.join("\n").replace(/\s+$/g, "")}\n`;
}

function poolLabelDataYamlNamesBlock() {
  const maxId = Math.max(-1, ...state.classNames.keys());
  const lines = ["names:"];
  for (let id = 0; id <= maxId; id += 1) {
    const name = state.classNames.get(id);
    if (name) lines.push(`  ${id}: ${poolLabelYamlScalar(name)}`);
  }
  return `${lines.join("\n")}\n`;
}

async function poolLabelReadRootTextFile(relativePath) {
  try {
    if (state.datasetBackendRoot) {
      return await backendCall("readTextFile", state.datasetBackendRoot, relativePath);
    }
    const handle = state.files.get(relativePath);
    return handle ? await (await handle.getFile()).text() : "";
  } catch {
    return "";
  }
}

function poolLabelYamlScalar(value) {
  return JSON.stringify(String(value));
}

async function poolLabelDeleteSelected() {
  const pair = state.pairs[state.currentIndex];
  if (!pair || state.selectedBoxIndex === null) return;
  const boxes = await editableBoxesFor(pair);
  if (!boxes[state.selectedBoxIndex]) return;
  poolLabelPushUndo(pair, boxes, "delete box");
  boxes.splice(state.selectedBoxIndex, 1);
  state.selectedBoxIndex = null;
  populateBoxEditor(null);
  await persistLabelBoxes(pair, boxes);
  await poolLabelRefreshAfterEdit();
}

async function poolLabelNavigate(delta) {
  if (!state.pairs.length) return;
  await poolLabelSaveCurrent();
  await selectIndex(state.currentIndex + delta);
  await updatePoolLabelPanel();
}

async function poolLabelSaveCurrent() {
  const pair = state.pairs[state.currentIndex];
  if (!pair || state.datasetTask === "classify") return;
  const boxes = await effectiveBoxesFor(pair);
  await persistLabelBoxes(pair, boxes, { refreshFilterList: false });
}

function poolLabelPushUndo(pair, boxes, action = "edit") {
  if (!pair || !Array.isArray(boxes)) return;
  poolLabelPushUndoSnapshot({
    imagePath: pair.imagePath,
    selectedBoxIndex: state.selectedBoxIndex,
    classId: poolLabelState.currentClassId,
    action,
    boxes: boxes.map(box => ({ ...box }))
  });
}

function poolLabelPushBatchUndo(items, action = "batch edit") {
  const snapshots = items
    .filter(item => item?.pair && Array.isArray(item.boxes))
    .map(item => ({
      imagePath: item.pair.imagePath,
      selectedBoxIndex: item.selectedBoxIndex ?? null,
      classId: item.classId ?? poolLabelState.currentClassId,
      boxes: item.boxes.map(box => ({ ...box }))
    }));
  if (!snapshots.length) return;
  poolLabelPushUndoSnapshot({ action, snapshots });
}

function poolLabelPushUndoSnapshot(snapshot) {
  if (!snapshot) return;
  poolLabelState.undoStack.push(snapshot);
  if (poolLabelState.undoStack.length > 50) poolLabelState.undoStack.shift();
}

async function poolLabelCreateImageUndoSnapshot(pair, action = "image edit") {
  if (!pair?.imageHandle) return null;
  const file = await pair.imageHandle.getFile();
  return {
    imagePath: pair.imagePath,
    selectedBoxIndex: state.selectedBoxIndex,
    classId: poolLabelState.currentClassId,
    action,
    imageBlob: file.slice(0, file.size, file.type || mimeFor(pair.imagePath))
  };
}

async function poolLabelUndoLast() {
  const snapshot = poolLabelState.undoStack.pop();
  if (!snapshot) {
    await updatePoolLabelPanel("Nothing to undo.");
    return;
  }
  if (Array.isArray(snapshot.snapshots)) {
    let restored = 0;
    for (const item of snapshot.snapshots) {
      const pair = poolLabelPairByImagePath(item.imagePath);
      if (!pair) continue;
      await persistLabelBoxes(pair, item.boxes.map(box => ({ ...box })), { refreshFilterList: false });
      restored += 1;
    }
    await buildFilterList();
    syncFilterInputs();
    await renderCurrentImage();
    renderGallery();
    await updatePoolLabelPanel(`Undid ${snapshot.action} on ${restored} image(s).`);
    return;
  }
  const pair = poolLabelPairByImagePath(snapshot.imagePath);
  if (!pair) {
    await updatePoolLabelPanel("Undo target image is no longer available.");
    return;
  }
  if (snapshot.imageBlob) {
    await poolLabelRestoreImageUndoSnapshot(pair, snapshot);
    return;
  }
  const boxes = snapshot.boxes.map(box => ({ ...box }));
  await persistLabelBoxes(pair, boxes);
  if (pair.imagePath === state.pairs[state.currentIndex]?.imagePath) {
    state.selectedBoxIndex = Number.isInteger(snapshot.selectedBoxIndex)
      ? Math.min(snapshot.selectedBoxIndex, boxes.length - 1)
      : null;
    if (state.selectedBoxIndex !== null && state.selectedBoxIndex < 0) state.selectedBoxIndex = null;
    poolLabelState.currentClassId = Number.isInteger(snapshot.classId) ? snapshot.classId : poolLabelState.currentClassId;
    populateBoxEditor(state.selectedBoxIndex !== null ? boxes[state.selectedBoxIndex] : null);
    await poolLabelRefreshAfterEdit(`Undid ${snapshot.action}.`);
    return;
  }
  renderGallery();
  await updatePoolLabelPanel(`Undid ${snapshot.action} on another image.`);
}

async function poolLabelRestoreImageUndoSnapshot(pair, snapshot) {
  await writeBlob(pair.imageHandle, snapshot.imageBlob);
  if (typeof invalidateImageCache === "function") {
    invalidateImageCache(pair.imagePath);
  } else {
    bitmapCache.delete(pair.imagePath);
    if (typeof removeCachedObjectUrl === "function") removeCachedObjectUrl(pair.imagePath);
  }
  if (pair.imagePath === state.pairs[state.currentIndex]?.imagePath) {
    state.selectedBoxIndex = Number.isInteger(snapshot.selectedBoxIndex) ? snapshot.selectedBoxIndex : null;
    poolLabelState.currentClassId = Number.isInteger(snapshot.classId) ? snapshot.classId : poolLabelState.currentClassId;
    populateBoxEditor(null);
    await renderCurrentImage();
    renderGallery();
    await updatePoolLabelPanel(`Undid ${snapshot.action}.`);
    return;
  }
  renderGallery();
  await updatePoolLabelPanel(`Undid ${snapshot.action} on another image.`);
}

function poolLabelPairByImagePath(imagePath) {
  return state.allPairs.find(pair => pair.imagePath === imagePath)
    || state.pairs.find(pair => pair.imagePath === imagePath)
    || null;
}

async function poolLabelAutoFitSelection(pair, selection, seedPoint = null) {
  try {
    const bitmap = await imageBitmapForPair(pair);
    return poolLabelColorSubjectRectFromBitmap(bitmap, selection, seedPoint) || selection;
  } catch (error) {
    console.warn("Pool label auto-fit failed:", error);
    return selection;
  }
}

function poolLabelColorSubjectRectFromBitmap(bitmap, selection, seedPoint = null) {
  const selectionRect = poolLabelClampRectToBitmap(selection, bitmap.width, bitmap.height)
    || poolLabelPointRectToBitmap(seedPoint || { x: selection.x1, y: selection.y1 }, bitmap.width, bitmap.height);
  const selectionW = selectionRect.x2 - selectionRect.x1;
  const selectionH = selectionRect.y2 - selectionRect.y1;
  const bounded = selectionW >= 3 && selectionH >= 3;
  const sourceRect = bounded
    ? selectionRect
    : { x1: 0, y1: 0, x2: bitmap.width, y2: bitmap.height };
  const seed = poolLabelClampSeedPoint(seedPoint || {
    x: Math.round((selectionRect.x1 + selectionRect.x2) / 2),
    y: Math.round((selectionRect.y1 + selectionRect.y2) / 2)
  }, sourceRect);

  const sourceW = sourceRect.x2 - sourceRect.x1;
  const sourceH = sourceRect.y2 - sourceRect.y1;
  const maxEdge = 900;
  const scale = Math.min(1, maxEdge / Math.max(sourceW, sourceH));
  const w = Math.max(1, Math.round(sourceW * scale));
  const h = Math.max(1, Math.round(sourceH * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.drawImage(bitmap, sourceRect.x1, sourceRect.y1, sourceW, sourceH, 0, 0, w, h);
  const data = context.getImageData(0, 0, w, h).data;
  const sx = Math.max(0, Math.min(w - 1, Math.round((seed.x - sourceRect.x1) * scale)));
  const sy = Math.max(0, Math.min(h - 1, Math.round((seed.y - sourceRect.y1) * scale)));
  const seedIndex = (sy * w + sx) * 4;
  if (data[seedIndex + 3] < 16) return null;
  const seedColor = [data[seedIndex], data[seedIndex + 1], data[seedIndex + 2]];
  const threshold = poolLabelColorSelectionThreshold(data, w, h, sx, sy, seedColor);
  const component = poolLabelFloodSimilarColor(data, w, h, sx, sy, seedColor, threshold);
  if (!component) return null;

  const pad = Math.max(2, Math.round(Math.min(w, h) * 0.006));
  const x1 = Math.max(0, component.x1 - pad);
  const y1 = Math.max(0, component.y1 - pad);
  const x2 = Math.min(w, component.x2 + pad + 1);
  const y2 = Math.min(h, component.y2 + pad + 1);
  return poolLabelClampRectToBitmap({
    x1: Math.round(sourceRect.x1 + x1 / scale),
    y1: Math.round(sourceRect.y1 + y1 / scale),
    x2: Math.round(sourceRect.x1 + x2 / scale),
    y2: Math.round(sourceRect.y1 + y2 / scale)
  }, bitmap.width, bitmap.height);
}

function poolLabelPointRectToBitmap(point, width, height) {
  const x = Math.max(0, Math.min(width - 1, Math.round(point.x)));
  const y = Math.max(0, Math.min(height - 1, Math.round(point.y)));
  return { x1: x, y1: y, x2: Math.min(width, x + 1), y2: Math.min(height, y + 1) };
}

function poolLabelClampSeedPoint(point, rect) {
  return {
    x: Math.max(rect.x1, Math.min(rect.x2 - 1, Math.round(point.x))),
    y: Math.max(rect.y1, Math.min(rect.y2 - 1, Math.round(point.y)))
  };
}

function poolLabelColorSelectionThreshold(data, width, height, sx, sy, seedColor) {
  const distances = [];
  for (let y = Math.max(0, sy - 3); y <= Math.min(height - 1, sy + 3); y += 1) {
    for (let x = Math.max(0, sx - 3); x <= Math.min(width - 1, sx + 3); x += 1) {
      const index = (y * width + x) * 4;
      if (data[index + 3] < 16) continue;
      distances.push(poolLabelColorDistance(data[index], data[index + 1], data[index + 2], seedColor));
    }
  }
  if (!distances.length) return 32;
  const avg = distances.reduce((sum, value) => sum + value, 0) / distances.length;
  const variance = distances.reduce((sum, value) => sum + (value - avg) ** 2, 0) / distances.length;
  return Math.max(24, Math.min(90, avg + Math.sqrt(variance) * 3 + 24));
}

function poolLabelFloodSimilarColor(data, width, height, sx, sy, seedColor, threshold) {
  const start = sy * width + sx;
  const visited = new Uint8Array(width * height);
  const queue = [start];
  visited[start] = 1;
  let area = 0;
  let x1 = width;
  let y1 = height;
  let x2 = 0;
  let y2 = 0;
  for (let head = 0; head < queue.length; head += 1) {
    const p = queue[head];
    const x = p % width;
    const y = Math.floor(p / width);
    area += 1;
    x1 = Math.min(x1, x);
    y1 = Math.min(y1, y);
    x2 = Math.max(x2, x);
    y2 = Math.max(y2, y);
    if (x > 0) poolLabelQueueSimilarPixel(data, width, visited, queue, p - 1, seedColor, threshold);
    if (x < width - 1) poolLabelQueueSimilarPixel(data, width, visited, queue, p + 1, seedColor, threshold);
    if (y > 0) poolLabelQueueSimilarPixel(data, width, visited, queue, p - width, seedColor, threshold);
    if (y < height - 1) poolLabelQueueSimilarPixel(data, width, visited, queue, p + width, seedColor, threshold);
  }
  return area >= 4 ? { x1, y1, x2, y2, area } : null;
}

function poolLabelQueueSimilarPixel(data, width, visited, queue, index, seedColor, threshold) {
  if (visited[index]) return;
  visited[index] = 1;
  const dataIndex = index * 4;
  if (data[dataIndex + 3] < 16) return;
  if (poolLabelColorDistance(data[dataIndex], data[dataIndex + 1], data[dataIndex + 2], seedColor) <= threshold) {
    queue.push(index);
  }
}

function poolLabelSubjectRectFromBitmap(bitmap, selection) {
  const sourceRect = poolLabelClampRectToBitmap(selection, bitmap.width, bitmap.height);
  if (!sourceRect || sourceRect.x2 - sourceRect.x1 < 8 || sourceRect.y2 - sourceRect.y1 < 8) return null;

  const sourceW = sourceRect.x2 - sourceRect.x1;
  const sourceH = sourceRect.y2 - sourceRect.y1;
  const maxEdge = 640;
  const scale = Math.min(1, maxEdge / Math.max(sourceW, sourceH));
  const w = Math.max(1, Math.round(sourceW * scale));
  const h = Math.max(1, Math.round(sourceH * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.drawImage(bitmap, sourceRect.x1, sourceRect.y1, sourceW, sourceH, 0, 0, w, h);
  const data = context.getImageData(0, 0, w, h).data;
  const background = poolLabelEstimateBorderBackground(data, w, h);
  if (!background) return null;

  const mask = poolLabelBuildForegroundMask(data, w, h, background);
  const component = poolLabelBestForegroundComponent(mask, w, h);
  if (!component) return null;

  const pad = Math.max(2, Math.round(Math.min(w, h) * 0.01));
  const x1 = Math.max(0, component.x1 - pad);
  const y1 = Math.max(0, component.y1 - pad);
  const x2 = Math.min(w, component.x2 + pad + 1);
  const y2 = Math.min(h, component.y2 + pad + 1);
  const fitted = {
    x1: Math.round(sourceRect.x1 + x1 / scale),
    y1: Math.round(sourceRect.y1 + y1 / scale),
    x2: Math.round(sourceRect.x1 + x2 / scale),
    y2: Math.round(sourceRect.y1 + y2 / scale)
  };
  return poolLabelClampRectToBitmap(fitted, bitmap.width, bitmap.height);
}

function poolLabelClampRectToBitmap(rect, width, height) {
  const x1 = Math.max(0, Math.min(width, Math.round(Math.min(rect.x1, rect.x2))));
  const y1 = Math.max(0, Math.min(height, Math.round(Math.min(rect.y1, rect.y2))));
  const x2 = Math.max(0, Math.min(width, Math.round(Math.max(rect.x1, rect.x2))));
  const y2 = Math.max(0, Math.min(height, Math.round(Math.max(rect.y1, rect.y2))));
  if (x2 <= x1 || y2 <= y1) return null;
  return { x1, y1, x2, y2 };
}

function poolLabelEstimateBorderBackground(data, width, height) {
  const border = Math.max(2, Math.min(16, Math.floor(Math.min(width, height) / 8)));
  const samples = [];
  let r = 0;
  let g = 0;
  let b = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (x >= border && y >= border && x < width - border && y < height - border) continue;
      const i = (y * width + x) * 4;
      const sample = [data[i], data[i + 1], data[i + 2]];
      samples.push(sample);
      r += sample[0];
      g += sample[1];
      b += sample[2];
    }
  }
  if (!samples.length) return null;
  const mean = [r / samples.length, g / samples.length, b / samples.length];
  const distances = samples.map(sample => poolLabelColorDistance(sample[0], sample[1], sample[2], mean));
  const avg = distances.reduce((sum, value) => sum + value, 0) / distances.length;
  const variance = distances.reduce((sum, value) => sum + (value - avg) ** 2, 0) / distances.length;
  return {
    mean,
    threshold: Math.max(18, Math.min(85, avg + Math.sqrt(variance) * 2.5 + 10))
  };
}

function poolLabelBuildForegroundMask(data, width, height, background) {
  const mask = new Uint8Array(width * height);
  for (let i = 0, p = 0; i < data.length; i += 4, p += 1) {
    if (data[i + 3] < 16) continue;
    if (poolLabelColorDistance(data[i], data[i + 1], data[i + 2], background.mean) > background.threshold) {
      mask[p] = 1;
    }
  }
  return poolLabelCleanMask(mask, width, height);
}

function poolLabelCleanMask(mask, width, height) {
  const cleaned = new Uint8Array(mask.length);
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const p = y * width + x;
      let count = 0;
      for (let yy = -1; yy <= 1; yy += 1) {
        for (let xx = -1; xx <= 1; xx += 1) count += mask[p + yy * width + xx];
      }
      cleaned[p] = count >= 3 ? 1 : 0;
    }
  }
  return cleaned;
}

function poolLabelBestForegroundComponent(mask, width, height) {
  const visited = new Uint8Array(mask.length);
  const centerX = (width - 1) / 2;
  const centerY = (height - 1) / 2;
  const minArea = Math.max(20, Math.round(width * height * 0.002));
  let best = null;
  const queue = [];
  for (let start = 0; start < mask.length; start += 1) {
    if (!mask[start] || visited[start]) continue;
    queue.length = 0;
    queue.push(start);
    visited[start] = 1;
    let area = 0;
    let x1 = width;
    let y1 = height;
    let x2 = 0;
    let y2 = 0;
    let centerHit = false;
    for (let head = 0; head < queue.length; head += 1) {
      const p = queue[head];
      const x = p % width;
      const y = Math.floor(p / width);
      area += 1;
      x1 = Math.min(x1, x);
      y1 = Math.min(y1, y);
      x2 = Math.max(x2, x);
      y2 = Math.max(y2, y);
      if (Math.abs(x - centerX) <= 2 && Math.abs(y - centerY) <= 2) centerHit = true;
      if (x > 0) poolLabelQueueMaskPixel(mask, visited, queue, p - 1);
      if (x < width - 1) poolLabelQueueMaskPixel(mask, visited, queue, p + 1);
      if (y > 0) poolLabelQueueMaskPixel(mask, visited, queue, p - width);
      if (y < height - 1) poolLabelQueueMaskPixel(mask, visited, queue, p + width);
    }
    if (area < minArea) continue;
    const componentCenterX = (x1 + x2) / 2;
    const componentCenterY = (y1 + y2) / 2;
    const centerDistance = Math.hypot(componentCenterX - centerX, componentCenterY - centerY);
    const score = area * (centerHit ? 4 : 1) / (1 + centerDistance / Math.max(width, height));
    if (!best || score > best.score) best = { x1, y1, x2, y2, score };
  }
  return best;
}

function poolLabelQueueMaskPixel(mask, visited, queue, index) {
  if (!visited[index] && mask[index]) {
    visited[index] = 1;
    queue.push(index);
  }
}

function poolLabelColorDistance(r, g, b, mean) {
  const dr = r - mean[0];
  const dg = g - mean[1];
  const db = b - mean[2];
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

async function poolLabelSaveEmpty() {
  const pair = state.pairs[state.currentIndex];
  if (!pair) return;
  state.selectedBoxIndex = null;
  populateBoxEditor(null);
  const boxes = await effectiveBoxesFor(pair);
  poolLabelPushUndo(pair, boxes, "save empty");
  await persistLabelBoxes(pair, []);
  await poolLabelRefreshAfterEdit("Saved empty TXT for background frame.");
}

async function poolLabelTrackForward() {
  if (poolLabelState.tracking) return;
  const pair = state.pairs[state.currentIndex];
  if (!pair || state.selectedBoxIndex === null) {
    await updatePoolLabelPanel("Select a box before copying to the next image.");
    return;
  }
  const boxes = await effectiveBoxesFor(pair);
  const box = boxes[state.selectedBoxIndex];
  if (!box) return;
  const nextIndex = state.currentIndex + 1;
  const nextPair = state.pairs[nextIndex];
  if (!nextPair) {
    await updatePoolLabelPanel("No next image.");
    return;
  }
  await poolLabelSaveCurrent();
  poolLabelState.tracking = true;
  el.poolLabelTrackBtn.disabled = true;
  await updatePoolLabelPanel("Copying selected box to next image...");
  try {
    const nextBoxes = await editableBoxesFor(nextPair);
    const copied = { ...box };
    const copiedIndex = poolLabelMergeCopiedBox(nextBoxes, copied);
    await persistLabelBoxes(nextPair, nextBoxes, { refreshFilterList: false });
    await selectIndex(nextIndex);
    state.selectedBoxIndex = copiedIndex;
    poolLabelState.currentClassId = copied.classId;
    populateBoxEditor(copied);
    await renderCurrentImage();
    renderGallery();
    await updatePoolLabelPanel(`Copied ${classDisplay(copied.classId)} box to next image. Adjust it, then press T again.`);
  } finally {
    poolLabelState.tracking = false;
    el.poolLabelTrackBtn.disabled = false;
  }
}

function poolLabelSelectedTargetPairs(sourceImagePath) {
  return state.pairs.filter(pair => state.shiftSelectedPaths.has(pair.imagePath) && pair.imagePath !== sourceImagePath);
}

async function poolLabelSyncBoxToSelected(sourcePair, box, action = "sync box", options = {}) {
  if (!sourcePair || !box || poolLabelState.tracking) return 0;
  const targets = poolLabelSelectedTargetPairs(sourcePair.imagePath);
  if (!targets.length) return 0;
  const undoItems = [];
  let changed = 0;
  poolLabelState.tracking = true;
  try {
    for (const targetPair of targets) {
      const targetBoxes = await editableBoxesFor(targetPair);
      undoItems.push({
        pair: targetPair,
        boxes: targetBoxes.map(existing => ({ ...existing })),
        selectedBoxIndex: null,
        classId: box.classId
      });
      poolLabelMergeCopiedBox(targetBoxes, { ...box });
      await persistLabelBoxes(targetPair, targetBoxes, { refreshFilterList: false });
      changed += 1;
    }
    if (changed) {
      if (options.pushUndo !== false) poolLabelPushBatchUndo(undoItems, action);
      await buildFilterList();
      syncFilterInputs();
      renderGallery();
    }
  } finally {
    poolLabelState.tracking = false;
  }
  return changed;
}

function poolLabelSyncMessage(message, count) {
  if (!count) return message;
  const suffix = `Synced to ${count} selected image(s).`;
  return message ? `${message} ${suffix}` : suffix;
}

async function poolLabelTrackCsrtForward() {
  if (poolLabelState.tracking) return;
  const pair = state.pairs[state.currentIndex];
  if (!pair || state.selectedBoxIndex === null) {
    await updatePoolLabelPanel("Select a box before CSRT tracking.");
    return;
  }
  if (!state.datasetBackendRoot) {
    await updatePoolLabelPanel("CSRT tracking needs the Python backend workspace path.");
    return;
  }
  const boxes = await effectiveBoxesFor(pair);
  const box = boxes[state.selectedBoxIndex];
  if (!box) return;
  await poolLabelSaveCurrent();
  const options = poolLabelCsrtOptions();
  const ordered = state.pairs.slice(state.currentIndex).map(item => item.imagePath);
  poolLabelState.tracking = true;
  el.poolLabelCsrtBtn.disabled = true;
  el.poolLabelTrackBtn.disabled = true;
  await updatePoolLabelPanel(`CSRT tracking up to ${options.maxFrames} frame(s)...`);
  try {
    const raw = await backendCall(
      "trackYoloForward",
      state.datasetBackendRoot,
      pair.imagePath,
      JSON.stringify(box),
      JSON.stringify(ordered),
      JSON.stringify(options)
    );
    const result = JSON.parse(raw || "{}");
    await buildLabelIndex();
    const stoppedIndex = result.stoppedAt ? state.pairs.findIndex(item => item.imagePath === result.stoppedAt) : -1;
    if (stoppedIndex >= 0) await selectIndex(stoppedIndex);
    else await renderCurrentImage();
    await poolLabelSelectNearestBox(result.lastBox);
    renderGallery();
    await updatePoolLabelPanel(`CSRT saved ${result.saved || 0} frame(s). ${result.reason || ""}`);
  } finally {
    poolLabelState.tracking = false;
    el.poolLabelCsrtBtn.disabled = false;
    el.poolLabelTrackBtn.disabled = false;
  }
}

function poolLabelCsrtOptions() {
  return {
    maxFrames: 5,
    areaMinRatio: 0.6,
    areaMaxRatio: 1.6,
    centerJumpRatio: 0.7
  };
}

async function poolLabelSelectNearestBox(box) {
  if (!box || state.selectedBoxIndex !== null) return;
  const pair = state.pairs[state.currentIndex];
  if (!pair) return;
  const boxes = await effectiveBoxesFor(pair);
  let bestIndex = -1;
  let bestDistance = Infinity;
  for (let index = 0; index < boxes.length; index += 1) {
    const existing = boxes[index];
    if (existing.classId !== box.classId) continue;
    const distance = Math.hypot(existing.x - box.x, existing.y - box.y);
    if (distance < bestDistance) {
      bestIndex = index;
      bestDistance = distance;
    }
  }
  if (bestIndex >= 0) {
    state.selectedBoxIndex = bestIndex;
    poolLabelState.currentClassId = boxes[bestIndex].classId;
    populateBoxEditor(boxes[bestIndex]);
    await renderCurrentImage();
  }
}

function poolLabelMergeCopiedBox(boxes, box) {
  let bestIndex = -1;
  let bestDistance = Infinity;
  let bestOverlap = 0;
  for (let index = 0; index < boxes.length; index += 1) {
    const existing = boxes[index];
    if (existing.classId !== box.classId) continue;
    const distance = Math.hypot(existing.x - box.x, existing.y - box.y);
    const overlap = poolLabelBoxIou(existing, box);
    if (distance < bestDistance) {
      bestIndex = index;
      bestDistance = distance;
      bestOverlap = overlap;
    }
  }
  const maxReplaceDistance = Math.max(0.08, Math.hypot(box.w, box.h) * 0.75);
  if (bestIndex >= 0 && (bestDistance <= maxReplaceDistance || bestOverlap >= 0.1)) {
    boxes[bestIndex] = box;
    return bestIndex;
  }
  boxes.push(box);
  return boxes.length - 1;
}

function poolLabelBoxIou(a, b) {
  const ax1 = a.x - a.w / 2;
  const ay1 = a.y - a.h / 2;
  const ax2 = a.x + a.w / 2;
  const ay2 = a.y + a.h / 2;
  const bx1 = b.x - b.w / 2;
  const by1 = b.y - b.h / 2;
  const bx2 = b.x + b.w / 2;
  const by2 = b.y + b.h / 2;
  const ix1 = Math.max(ax1, bx1);
  const iy1 = Math.max(ay1, by1);
  const ix2 = Math.min(ax2, bx2);
  const iy2 = Math.min(ay2, by2);
  const iw = Math.max(0, ix2 - ix1);
  const ih = Math.max(0, iy2 - iy1);
  const intersection = iw * ih;
  const union = a.w * a.h + b.w * b.h - intersection;
  return union > 0 ? intersection / union : 0;
}

async function poolLabelRefreshAfterEdit(message = "") {
  await applyFilter(false);
  await renderCurrentImage();
  renderGallery();
  await updatePoolLabelPanel(message);
}

async function updatePoolLabelPanel(message = "") {
  if (!el.poolLabelBoxList) return;
  poolLabelSyncCanvasModeClasses();
  poolLabelSyncZoomClassLabel();
  const pair = state.pairs[state.currentIndex];
  const boxes = pair ? await effectiveBoxesFor(pair) : [];
  poolLabelSyncAutoFitTool();
  const modeText = poolLabelState.pointerToolEnabled
    ? "Pointer mode (V). Select, move, and resize boxes."
    : poolLabelState.blackBoxToolEnabled
    ? "Black box mode. Drag to paint a black rectangle into the image."
    : poolLabelState.autoFitEnabled
    ? "Subject Select (W). Click a color, or drag to limit the color search."
    : "Manual box mode. V pointer, W subject select.";
  const fixedText = Number.isInteger(poolLabelState.recordingFixedBoxSlot)
    ? ` Recording fixed box ${poolLabelState.recordingFixedBoxSlot}.`
    : "";
  el.poolLabelStatus.textContent = message || `New class: ${classDisplay(poolLabelState.currentClassId)} | ${boxes.length} box(es). ${modeText} T copies, Shift+T CSRT. Hold Alt for fixed boxes.${fixedText}`;
  renderPoolLabelShortcuts();
  renderPoolLabelClassManager();
  el.poolLabelBoxList.innerHTML = "";
  if (!boxes.length) {
    el.poolLabelBoxList.innerHTML = `<div class="empty">No boxes on this image.</div>`;
    return;
  }
  boxes.forEach((box, index) => {
    const row = document.createElement("button");
    row.type = "button";
    row.className = `pool-label-box-row${index === state.selectedBoxIndex ? " selected" : ""}`;
    row.textContent = `${index + 1}. ${classDisplay(box.classId)}  x=${fmt(box.x)} y=${fmt(box.y)} w=${fmt(box.w)} h=${fmt(box.h)}`;
    row.addEventListener("click", async () => {
      state.selectedBoxIndex = index;
      poolLabelState.currentClassId = box.classId;
      populateBoxEditor(box);
      await renderCurrentImage();
      await updatePoolLabelPanel();
    });
    el.poolLabelBoxList.appendChild(row);
  });
}

function normalizePoolLabelShortcuts(value) {
  const source = Array.isArray(value) ? value : [];
  return Array.from({ length: 10 }, (_, index) => {
    const raw = source[index];
    if (raw == null || raw === "") return null;
    const classId = Number(raw);
    return Number.isInteger(classId) && classId >= 0 ? classId : null;
  });
}

function normalizePoolLabelShortcutAssigned(value) {
  const source = Array.isArray(value) ? value : [];
  return Array.from({ length: 10 }, (_, index) => Number.isInteger(source[index]));
}

function normalizePoolLabelShortcutsFromSession(data) {
  if (!data || typeof data !== "object") return normalizePoolLabelShortcuts(null);
  const raw = data.poolLabelShortcuts;
  const assigned = data.poolLabelShortcutAssigned;
  if (Array.isArray(assigned)) {
    const shortcuts = normalizePoolLabelShortcuts(raw);
    return Array.from({ length: 10 }, (_, index) => assigned[index] ? shortcuts[index] : null);
  }
  return normalizePoolLabelShortcuts(raw);
}

function normalizePoolLabelFixedBoxes(value) {
  const source = Array.isArray(value) ? value : [];
  return Array.from({ length: 10 }, (_, index) => {
    const item = source[index];
    if (!item || typeof item !== "object") return null;
    const classId = Number(item.classId);
    const x = Number(item.x);
    const y = Number(item.y);
    const w = Number(item.w);
    const h = Number(item.h);
    if (!Number.isInteger(classId) || classId < 0) return null;
    if ([x, y, w, h].some(value => !Number.isFinite(value))) return { classId, x: null, y: null, w: null, h: null };
    return { classId, x: clamp01(x), y: clamp01(y), w: clamp01(w), h: clamp01(h) };
  });
}

function poolLabelFixedBoxSlotReady(template) {
  return !!template
    && Number.isInteger(template.classId)
    && state.classNames.has(template.classId)
    && [template.x, template.y, template.w, template.h].every(Number.isFinite)
    && template.w > 0
    && template.h > 0;
}

function renderPoolLabelShortcuts() {
  if (!el.poolLabelShortcuts) return;
  poolLabelCloseShortcutMenus();
  el.poolLabelShortcuts.replaceChildren();
  poolLabelSetFixedShortcutMode(poolLabelState.fixedShortcutMode);
  for (const slot of POOL_LABEL_SLOT_ORDER) {
    el.poolLabelShortcuts.appendChild(poolLabelShortcutSlotElement(slot));
  }
}

function poolLabelSortedClassEntries() {
  return [...state.classNames.entries()].sort((a, b) => naturalCompare(a[1], b[1]) || a[0] - b[0]);
}

function poolLabelShortcutOptions(selectedClassId = null, ready = false) {
  const options = [{ value: "", label: "empty", searchText: "empty none clear", selected: selectedClassId == null }];
  for (const [id, name] of poolLabelSortedClassEntries()) {
    options.push({
      value: String(id),
      label: `${id}: ${name}${ready && id === selectedClassId ? " ready" : ""}`,
      searchText: `${id} ${name}`,
      selected: id === selectedClassId
    });
  }
  return options;
}

function poolLabelClassShortcutDropdown(slot) {
  const classId = poolLabelState.shortcutSlots[slot];
  const bound = Number.isInteger(classId) && state.classNames.has(classId);
  const control = poolLabelShortcutDropdown({
    label: bound ? `${classId}: ${state.classNames.get(classId)}` : "empty",
    title: `Shortcut ${slot}`,
    options: poolLabelShortcutOptions(bound ? classId : null),
    onSelect: value => {
      const next = value === "" ? null : Number(value);
      poolLabelState.shortcutSlots[slot] = Number.isInteger(next) ? next : null;
      poolLabelSaveSessionNow();
      if (Number.isInteger(next) && state.classNames.has(next)) {
        poolLabelAssignClass(next, { shortcutSlot: slot }).catch(showError);
        return;
      }
      updatePoolLabelPanel(`Shortcut ${slot} cleared.`).catch(showError);
    }
  });
  control.classList.add("class-slot");
  if (bound && classId === poolLabelState.currentClassId && poolLabelState.activeShortcutSlot === slot) {
    control.classList.add("active");
  }
  return control;
}

function poolLabelFixedBoxDropdown(slot) {
  const template = poolLabelState.fixedBoxSlots[slot];
  const ready = poolLabelFixedBoxSlotReady(template);
  const classId = template?.classId;
  const hasClass = Number.isInteger(classId) && state.classNames.has(classId);
  const label = hasClass ? `Alt: ${classId}: ${state.classNames.get(classId)}${ready ? " ready" : ""}` : "Alt: empty";
  const control = poolLabelShortcutDropdown({
    label,
    title: `Alt shortcut ${slot}`,
    options: poolLabelShortcutOptions(hasClass ? classId : null, ready),
    onSelect: value => {
      const next = value === "" ? null : Number(value);
      poolLabelStartFixedBoxRecording(slot, Number.isInteger(next) ? next : null).catch(showError);
    }
  });
  control.classList.add("fixed-slot");
  if (ready && poolLabelState.activeFixedBoxSlot === slot) control.classList.add("active");
  if (poolLabelState.recordingFixedBoxSlot === slot) control.classList.add("recording");
  return control;
}

function poolLabelShortcutDropdown({ label, title, options, onSelect }) {
  const wrap = document.createElement("div");
  wrap.className = "pool-label-shortcut-dropdown";
  const input = document.createElement("input");
  input.type = "search";
  input.className = "pool-label-shortcut-button";
  input.title = title;
  input.value = label;
  input.dataset.label = label;
  input.setAttribute("aria-label", title);
  input.addEventListener("pointerdown", event => {
    event.stopPropagation();
  });
  input.addEventListener("focus", event => {
    event.stopPropagation();
    input.select();
    poolLabelOpenShortcutMenu(wrap);
  });
  input.addEventListener("click", event => {
    event.stopPropagation();
    poolLabelOpenShortcutMenu(wrap);
  });
  input.addEventListener("input", event => {
    event.stopPropagation();
    poolLabelOpenShortcutMenu(wrap);
    poolLabelFilterShortcutOptions(wrap, input.value);
  });
  input.addEventListener("keydown", event => {
    if (event.key === "Escape") {
      event.stopPropagation();
      input.value = label;
      poolLabelCloseShortcutMenus();
    }
  });
  const menu = document.createElement("div");
  menu.className = "pool-label-shortcut-menu";
  for (const option of options) {
    const item = document.createElement("button");
    item.type = "button";
    item.className = `pool-label-shortcut-option${option.selected ? " selected" : ""}`;
    item.textContent = option.label;
    item.dataset.searchText = normalizePoolLabelSearchText(option.searchText || option.label);
    item.addEventListener("click", event => {
      event.stopPropagation();
      poolLabelCloseShortcutMenus();
      onSelect(option.value);
    });
    menu.appendChild(item);
  }
  wrap.append(input, menu);
  return wrap;
}

function poolLabelToggleShortcutMenu(wrap) {
  const open = wrap.classList.contains("open");
  poolLabelCloseShortcutMenus();
  if (!open) poolLabelOpenShortcutMenu(wrap);
}

function poolLabelOpenShortcutMenu(wrap) {
  const button = wrap.querySelector(".pool-label-shortcut-button");
  const menu = poolLabelShortcutMenuForWrap(wrap);
  if (!button || !menu) return;
  wrap.classList.add("open");
  if (!menu.dataset.ownerId) {
    menu.dataset.ownerId = `pool-label-shortcut-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
  wrap.dataset.menuId = menu.dataset.ownerId;
  menu.classList.add("open");
  document.body.appendChild(menu);
  poolLabelPositionShortcutMenu(button, menu);
  const query = button.value === button.dataset.label ? "" : button.value;
  poolLabelFilterShortcutOptions(wrap, query);
  requestAnimationFrame(() => poolLabelPositionShortcutMenu(button, menu));
}

function poolLabelFilterShortcutOptions(wrap, query) {
  const menu = poolLabelShortcutMenuForWrap(wrap);
  if (!menu) return;
  const terms = poolLabelSearchTerms(query);
  let shown = 0;
  for (const option of menu.querySelectorAll(".pool-label-shortcut-option")) {
    const match = !terms.length || terms.every(term => option.dataset.searchText?.includes(term));
    option.hidden = !match;
    if (match) shown += 1;
  }
  let empty = menu.querySelector(".pool-label-shortcut-empty");
  if (!empty) {
    empty = document.createElement("div");
    empty.className = "pool-label-shortcut-empty";
    empty.textContent = "No matching classes";
    menu.appendChild(empty);
  }
  empty.hidden = shown > 0;
}

function poolLabelShortcutMenuForWrap(wrap) {
  return wrap.querySelector(".pool-label-shortcut-menu")
    || document.querySelector(`.pool-label-shortcut-menu[data-owner-id="${wrap.dataset.menuId || ""}"]`);
}

function poolLabelPositionShortcutMenu(button, menu) {
  const rect = button.getBoundingClientRect();
  const gap = 4;
  const width = Math.max(rect.width, 230);
  const maxHeight = Math.min(310, Math.max(120, window.innerHeight - rect.bottom - gap - 8));
  menu.style.width = `${Math.round(width)}px`;
  menu.style.maxHeight = `${Math.round(maxHeight)}px`;
  menu.style.left = `${Math.round(Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)))}px`;
  menu.style.top = `${Math.round(rect.bottom + gap)}px`;
}

function poolLabelCloseShortcutMenus() {
  document.querySelectorAll(".pool-label-shortcut-dropdown.open").forEach(wrap => {
    const menu = document.querySelector(`.pool-label-shortcut-menu[data-owner-id="${wrap.dataset.menuId || ""}"]`);
    if (menu) {
      menu.classList.remove("open");
      menu.removeAttribute("style");
      wrap.appendChild(menu);
    }
    wrap.classList.remove("open");
    delete wrap.dataset.menuId;
  });
  document.querySelectorAll("body > .pool-label-shortcut-menu").forEach(menu => {
    menu.classList.remove("open");
    menu.removeAttribute("style");
    menu.remove();
  });
}

function poolLabelCloseShortcutMenusOnOutsideClick(event) {
  if (event.target?.closest?.(".pool-label-shortcut-dropdown, .pool-label-shortcut-menu")) return;
  poolLabelCloseShortcutMenus();
}

function poolLabelShortcutSlotElement(slotNumber) {
  const slot = document.createElement("div");
  slot.className = "pool-label-shortcut-slot";
  const label = document.createElement("div");
  label.className = "pool-label-shortcut-number";
  label.textContent = String(slotNumber);
  slot.append(label, poolLabelClassShortcutDropdown(slotNumber), poolLabelFixedBoxDropdown(slotNumber));
  return slot;
}

function renderPoolLabelClassManager() {
  if (!el.poolLabelClassList) return;
  renderPoolLabelSlotSelect();
  el.poolLabelClassList.replaceChildren();
  const terms = poolLabelSearchTerms(el.poolLabelClassSearchInput?.value || "");
  const classes = poolLabelSortedClassEntries()
    .filter(([classId, className]) => poolLabelClassMatchesSearch(classId, className, terms));
  if (!classes.length) {
    el.poolLabelClassList.innerHTML = state.classNames.size
      ? `<div class="empty">No matching classes.</div>`
      : `<div class="empty">No classes yet. Add one to start labeling.</div>`;
    return;
  }
  for (const [classId, className] of classes) {
    const row = document.createElement("button");
    row.type = "button";
    row.className = `pool-label-class-row${classId === poolLabelState.currentClassId ? " selected" : ""}`;
    row.textContent = `${classId}: ${className}`;
    row.addEventListener("click", () => poolLabelAssignClass(classId).catch(showError));
    el.poolLabelClassList.appendChild(row);
  }
}

function poolLabelClassMatchesSearch(classId, className, terms) {
  if (!terms.length) return true;
  const text = normalizePoolLabelSearchText(`${classId} ${className}`);
  return terms.every(term => text.includes(term));
}

function poolLabelSearchTerms(query) {
  return normalizePoolLabelSearchText(query).split(" ").filter(Boolean);
}

function normalizePoolLabelSearchText(value) {
  return String(value || "").trim().toLowerCase();
}

function renderPoolLabelSlotSelect() {
  if (!el.poolLabelBindSlotSelect) return;
  const currentValue = el.poolLabelBindSlotSelect.value || "0";
  el.poolLabelBindSlotSelect.replaceChildren();
  for (const slot of POOL_LABEL_SLOT_ORDER) {
    const classId = poolLabelState.shortcutSlots[slot];
    const option = document.createElement("option");
    option.value = String(slot);
    option.textContent = `${slot}: ${Number.isInteger(classId) && state.classNames.has(classId) ? classDisplay(classId) : "empty"}`;
    el.poolLabelBindSlotSelect.appendChild(option);
  }
  el.poolLabelBindSlotSelect.value = currentValue;
}
