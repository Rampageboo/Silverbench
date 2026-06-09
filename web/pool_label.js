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
  cursorPoint: null
};
const POOL_LABEL_SLOT_ORDER = [1, 2, 3, 4, 5, 6, 7, 8, 9, 0];
const POOL_LABEL_SUBJECT_CURSOR = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24'%3E%3Crect x='5.5' y='5.5' width='13' height='13' fill='none' stroke='%23ef4444' stroke-width='2'/%3E%3C/svg%3E") 12 12, crosshair`;

function bindPoolLabelPageEvents() {
  el.poolLabelPointerToolBtn?.addEventListener("click", () => poolLabelTogglePointerTool());
  el.poolLabelAutoFitToolBtn?.addEventListener("click", () => poolLabelToggleAutoFit());
  el.poolLabelTrackBtn?.addEventListener("click", () => poolLabelTrackForward().catch(showError));
  el.poolLabelCsrtBtn?.addEventListener("click", () => poolLabelTrackCsrtForward().catch(showError));
  el.poolLabelCopySelectedBtn?.addEventListener("click", () => poolLabelCopyToSelected().catch(showError));
  el.poolLabelUndoBtn?.addEventListener("click", () => poolLabelUndoLast().catch(showError));
  el.poolLabelAddClassBtn?.addEventListener("click", () => poolLabelAddClass().catch(showError));
  el.poolLabelRenameClassBtn?.addEventListener("click", () => poolLabelRenameSelectedClass().catch(showError));
  el.poolLabelBindSlotBtn?.addEventListener("click", () => poolLabelBindSelectedToSlot().catch(showError));
  window.addEventListener("keydown", poolLabelUpdateFixedShortcutModeFromEvent);
  window.addEventListener("keyup", poolLabelUpdateFixedShortcutModeFromEvent);
  window.addEventListener("blur", () => poolLabelSetFixedShortcutMode(false));
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
  poolLabelSetFixedShortcutMode(Boolean(event.shiftKey));
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
  if (poolLabelState.pointerToolEnabled) poolLabelState.autoFitEnabled = false;
  poolLabelAfterToolChange();
}

function poolLabelToggleAutoFit() {
  poolLabelState.autoFitEnabled = !poolLabelState.autoFitEnabled;
  if (poolLabelState.autoFitEnabled) poolLabelState.pointerToolEnabled = false;
  poolLabelAfterToolChange();
}

function poolLabelAfterToolChange() {
  poolLabelState.cursorPoint = null;
  poolLabelSyncPointerTool();
  poolLabelSyncAutoFitTool();
  el.canvas.style.cursor = poolLabelDefaultCursor();
  redrawPreviewOverlays();
  saveSessionSoon();
  updatePoolLabelPanel().catch(showError);
}

function poolLabelSaveSessionNow() {
  poolLabelSaveShortcutLocalSession();
  saveSessionSoon();
  if (typeof saveSession === "function") {
    saveSession({ manual: false }).catch(error => console.warn("Pool label session save failed:", error));
  }
}

function poolLabelShortcutLocalSessionKey() {
  const root = state.workspaceRoot || state.datasetBackendRoot || state.rootName || "default";
  return `yolo_label_viewer_pool_label_shortcuts:${root}`;
}

function poolLabelSaveShortcutLocalSession() {
  try {
    localStorage.setItem(poolLabelShortcutLocalSessionKey(), JSON.stringify({
      savedAt: new Date().toISOString(),
      shortcutSlots: normalizePoolLabelShortcuts(poolLabelState.shortcutSlots),
      fixedBoxSlots: normalizePoolLabelFixedBoxes(poolLabelState.fixedBoxSlots)
    }));
  } catch {
    // Browser storage can be disabled; backend session remains the primary store.
  }
}

function poolLabelLoadShortcutLocalSession() {
  try {
    const text = localStorage.getItem(poolLabelShortcutLocalSessionKey());
    if (!text) return null;
    const data = JSON.parse(text);
    if (!data || typeof data !== "object") return null;
    return {
      savedAt: data.savedAt || "",
      shortcutSlots: normalizePoolLabelShortcuts(data.shortcutSlots),
      fixedBoxSlots: normalizePoolLabelFixedBoxes(data.fixedBoxSlots)
    };
  } catch {
    return null;
  }
}

function poolLabelSyncPointerTool() {
  if (!el.poolLabelPointerToolBtn) return;
  el.poolLabelPointerToolBtn.classList.toggle("active", poolLabelState.pointerToolEnabled);
  el.poolLabelPointerToolBtn.setAttribute("aria-pressed", poolLabelState.pointerToolEnabled ? "true" : "false");
}

function poolLabelSyncAutoFitTool() {
  poolLabelSyncPointerTool();
  if (!el.poolLabelAutoFitToolBtn) return;
  el.poolLabelAutoFitToolBtn.classList.toggle("active", poolLabelState.autoFitEnabled);
  el.poolLabelAutoFitToolBtn.setAttribute("aria-pressed", poolLabelState.autoFitEnabled ? "true" : "false");
}

function poolLabelDefaultCursor() {
  if (poolLabelState.pointerToolEnabled) return "default";
  return poolLabelState.autoFitEnabled ? POOL_LABEL_SUBJECT_CURSOR : "crosshair";
}

function poolLabelUpdateCursorPoint(event) {
  poolLabelState.cursorPoint = canvasToImage(event);
  if (!poolLabelState.cursorPoint) return;
  if (poolLabelState.autoFitEnabled && !state.boxDrag && !state.viewPanDrag) {
    el.canvas.style.cursor = poolLabelDefaultCursor();
  }
}

function poolLabelClearCursorGuide() {
  if (!poolLabelState.cursorPoint) return;
  poolLabelState.cursorPoint = null;
  redrawPreviewOverlays();
}

function drawPoolLabelAxisGuide() {
  if (!isPoolLabelActive() || poolLabelState.pointerToolEnabled || poolLabelState.autoFitEnabled || !poolLabelState.cursorPoint) return;
  if (!state.displayRect || state.boxDrag || state.viewPanDrag) return;
  const r = state.displayRect;
  const point = poolLabelState.cursorPoint;
  const x = r.x + point.x * r.w / r.imageW;
  const y = r.y + point.y * r.h / r.imageH;
  ctx.save();
  ctx.strokeStyle = "#ef4444";
  ctx.lineWidth = 1.5;
  ctx.setLineDash([]);
  ctx.globalAlpha = 0.9;
  ctx.beginPath();
  ctx.moveTo(r.x, y);
  ctx.lineTo(r.x + r.w, y);
  ctx.moveTo(x, r.y);
  ctx.lineTo(x, r.y + r.h);
  ctx.stroke();
  ctx.fillStyle = "#ef4444";
  ctx.fillRect(x - 2, y - 2, 4, 4);
  ctx.restore();
}

async function onPoolLabelPointerDown(event) {
  if (!state.displayRect) return;
  try { el.canvas.setPointerCapture(event.pointerId); } catch {}
  poolLabelUpdateCursorPoint(event);
  if (event.button === 1 || event.button === 2) {
    event.preventDefault();
    poolLabelState.cursorPoint = null;
    startPreviewPan(event);
    return;
  }
  const pair = state.pairs[state.currentIndex];
  const point = canvasToImage(event);
  if (!pair || !point) return;
  if (poolLabelState.pointerToolEnabled) {
    const boxes = await effectiveBoxesFor(pair);
    const hit = hitBoxInteractionAtEvent(event, boxes);
    const index = hit.index;
    if (index >= 0) {
      state.selectedBoxIndex = index;
      const box = boxes[index];
      poolLabelPushUndo(pair, boxes, "edit box");
      state.boxDrag = { handle: hit.handle, start: point, rect: boxToImageRect(box), index };
      poolLabelState.currentClassId = box.classId;
      populateBoxEditor(box);
      await updatePoolLabelPanel();
      await renderCurrentImage();
      return;
    }
    state.selectedBoxIndex = null;
    populateBoxEditor(null);
    await updatePoolLabelPanel();
    await renderCurrentImage();
    return;
  }
  state.selectedBoxIndex = null;
  populateBoxEditor(null);
  state.dragStart = point;
  state.selection = { x1: point.x, y1: point.y, x2: point.x, y2: point.y };
  await updatePoolLabelPanel();
  await renderCurrentImage();
}

async function onPoolLabelPointerMove(event) {
  if (state.viewPanDrag) {
    poolLabelState.cursorPoint = null;
    state.viewPanX = state.viewPanDrag.panX + (event.clientX - state.viewPanDrag.startX);
    state.viewPanY = state.viewPanDrag.panY + (event.clientY - state.viewPanDrag.startY);
    clampPreviewView();
    redrawPreviewOverlays();
    el.canvas.style.cursor = "grabbing";
    return;
  }
  if (state.boxDrag) {
    poolLabelState.cursorPoint = null;
    await updateBoxDirectEdit(event);
    await updatePoolLabelPanel();
    return;
  }
  if (state.dragStart) {
    const point = canvasToImage(event);
    if (!point) return;
    poolLabelState.cursorPoint = point;
    state.selection = normalizeRect(state.dragStart, point);
    redrawPreviewOverlays();
    el.positionMeta.textContent = `x=${state.selection.x1}, y=${state.selection.y1}, w=${state.selection.x2 - state.selection.x1}, h=${state.selection.y2 - state.selection.y1}`;
    return;
  }
  poolLabelUpdateCursorPoint(event);
  if (poolLabelState.pointerToolEnabled) {
    await updateBoxCursor(event);
  } else {
    el.canvas.style.cursor = poolLabelDefaultCursor();
  }
  if (poolLabelState.pointerToolEnabled && el.canvas.style.cursor === "crosshair") {
    el.canvas.style.cursor = poolLabelDefaultCursor();
  } else if (poolLabelState.autoFitEnabled && poolLabelState.cursorPoint && el.canvas.style.cursor === "crosshair") {
    el.canvas.style.cursor = poolLabelDefaultCursor();
  }
  redrawPreviewOverlays();
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
    poolLabelState.cursorPoint = null;
    el.canvas.style.cursor = poolLabelDefaultCursor();
    return;
  }
  const pair = state.pairs[state.currentIndex];
  if (state.boxDrag) {
    const boxes = pair ? state.labelEdits.get(pair.imagePath) : null;
    state.boxDrag = null;
    poolLabelState.cursorPoint = null;
    if (pair && boxes) await persistLabelBoxes(pair, boxes);
    await poolLabelRefreshAfterEdit();
    return;
  }
  if (!state.dragStart) return;
  const seedPoint = state.dragStart;
  state.dragStart = null;
  const selection = state.selection;
  state.selection = null;
  poolLabelState.cursorPoint = null;
  const shouldAutoFit = poolLabelState.autoFitEnabled && !event?.shiftKey;
  if (!pair || !selection || (!shouldAutoFit && (selection.x2 - selection.x1 < 2 || selection.y2 - selection.y1 < 2))) {
    await renderCurrentImage();
    await updatePoolLabelPanel();
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
  await poolLabelRefreshAfterEdit(
    fixedBoxMessage || (fittedSelection !== selection ? "Color subject box saved. Shift keeps drawn box." : "")
  );
}

function onPoolLabelKeyDown(event) {
  const tag = event.target?.tagName?.toLowerCase();
  if (tag === "input" || tag === "textarea" || event.target?.isContentEditable) return false;
  const key = event.key.toLowerCase();
  const digitSlot = poolLabelKeyDigit(event);
  if (event.ctrlKey && key === "s") {
    event.preventDefault();
    poolLabelSaveCurrent().then(() => updatePoolLabelPanel("Saved current TXT.")).catch(showError);
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
  if (digitSlot !== null) {
    event.preventDefault();
    if (event.shiftKey) poolLabelUseFixedBoxSlot(digitSlot).catch(showError);
    else poolLabelUseShortcutSlot(digitSlot).catch(showError);
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
  if (key === "j" && typeof canMarkYoloJunk === "function" && canMarkYoloJunk()) {
    event.preventDefault();
    markYoloJunkSelected().catch(showError);
    return true;
  }
  if (key === "arrowleft" || key === "arrowup" || key === "a") {
    event.preventDefault();
    poolLabelNavigate(-1).catch(showError);
    return true;
  }
  if (key === "arrowright" || key === "arrowdown" || key === "d") {
    event.preventDefault();
    poolLabelNavigate(1).catch(showError);
    return true;
  }
  return false;
}

function poolLabelKeyDigit(event) {
  if (/^[0-9]$/.test(event.key)) return Number(event.key);
  const digit = /^Digit([0-9])$/.exec(event.code || "");
  if (digit) return Number(digit[1]);
  const numpad = /^Numpad([0-9])$/.exec(event.code || "");
  if (numpad) return Number(numpad[1]);
  return null;
}

async function poolLabelAssignClass(classId, options = {}) {
  if (!Number.isInteger(classId) || classId < 0) return;
  poolLabelState.activeShortcutSlot = Number.isInteger(options.shortcutSlot) ? options.shortcutSlot : null;
  poolLabelState.activeFixedBoxSlot = null;
  poolLabelState.currentClassId = classId;
  el.poolLabelClassNameInput.value = state.classNames.get(classId) || "";
  const pair = state.pairs[state.currentIndex];
  if (pair && state.selectedBoxIndex !== null) {
    const boxes = await editableBoxesFor(pair);
    if (boxes[state.selectedBoxIndex]) {
      poolLabelPushUndo(pair, boxes, "change class");
      boxes[state.selectedBoxIndex] = { ...boxes[state.selectedBoxIndex], classId };
      populateBoxEditor(boxes[state.selectedBoxIndex]);
      await persistLabelBoxes(pair, boxes);
      await poolLabelRefreshAfterEdit();
      return;
    }
  }
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
  poolLabelState.pointerToolEnabled = false;
  poolLabelState.autoFitEnabled = false;
  poolLabelSaveSessionNow();
  await updatePoolLabelPanel(`Draw one ${classDisplay(classId)} box to record fixed box ${slot}. Hold Shift and press ${slot} to create it.`);
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
  return `Recorded fixed box ${slot}: ${classDisplay(box.classId)}. Hold Shift and press ${slot} to create it.`;
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
  poolLabelState.currentClassId = box.classId;
  poolLabelState.activeShortcutSlot = null;
  poolLabelState.activeFixedBoxSlot = slot;
  populateBoxEditor(box);
  await persistLabelBoxes(pair, boxes);
  await poolLabelRefreshAfterEdit(`Created fixed box ${slot}: ${classDisplay(box.classId)}.`);
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
  poolLabelState.undoStack.push({
    imagePath: pair.imagePath,
    selectedBoxIndex: state.selectedBoxIndex,
    classId: poolLabelState.currentClassId,
    action,
    boxes: boxes.map(box => ({ ...box }))
  });
  if (poolLabelState.undoStack.length > 50) poolLabelState.undoStack.shift();
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
  poolLabelState.undoStack.push({ action, snapshots });
  if (poolLabelState.undoStack.length > 50) poolLabelState.undoStack.shift();
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

async function poolLabelCopyToSelected() {
  if (poolLabelState.tracking) return;
  const sourcePair = state.pairs[state.currentIndex];
  if (!sourcePair) return;
  const sourceBoxes = await effectiveBoxesFor(sourcePair);
  const selectedBox = state.selectedBoxIndex !== null ? sourceBoxes[state.selectedBoxIndex] : null;
  const boxesToCopy = selectedBox ? [selectedBox] : sourceBoxes;
  if (!boxesToCopy.length) {
    await updatePoolLabelPanel("No boxes to copy from the current image.");
    return;
  }
  const targets = poolLabelSelectedTargetPairs(sourcePair.imagePath);
  if (!targets.length) {
    await updatePoolLabelPanel("Ctrl+click thumbnails to select targets, or Shift+click a range, then copy.");
    return;
  }
  await poolLabelSaveCurrent();
  poolLabelState.tracking = true;
  if (el.poolLabelCopySelectedBtn) el.poolLabelCopySelectedBtn.disabled = true;
  await updatePoolLabelPanel(`Copying ${boxesToCopy.length} box(es) to ${targets.length} selected image(s)...`);
  try {
    const undoItems = [];
    let changed = 0;
    for (const targetPair of targets) {
      const targetBoxes = await editableBoxesFor(targetPair);
      undoItems.push({
        pair: targetPair,
        boxes: targetBoxes.map(box => ({ ...box })),
        selectedBoxIndex: null,
        classId: poolLabelState.currentClassId
      });
      for (const box of boxesToCopy) poolLabelMergeCopiedBox(targetBoxes, { ...box });
      await persistLabelBoxes(targetPair, targetBoxes, { refreshFilterList: false });
      changed += 1;
    }
    poolLabelPushBatchUndo(undoItems, "copy to selected");
    await buildFilterList();
    syncFilterInputs();
    renderGallery();
    await renderCurrentImage();
    const mode = selectedBox ? classDisplay(selectedBox.classId) : "all current boxes";
    await updatePoolLabelPanel(`Copied ${mode} to ${changed} selected image(s).`);
  } finally {
    poolLabelState.tracking = false;
    if (el.poolLabelCopySelectedBtn) el.poolLabelCopySelectedBtn.disabled = !poolLabelSelectedTargetPairs(sourcePair.imagePath).length;
  }
}

function poolLabelSelectedTargetPairs(sourceImagePath) {
  return state.pairs.filter(pair => state.shiftSelectedPaths.has(pair.imagePath) && pair.imagePath !== sourceImagePath);
}

function poolLabelSyncCopySelectedButton() {
  if (!el.poolLabelCopySelectedBtn || !isPoolLabelActive()) return;
  const pair = state.pairs[state.currentIndex];
  el.poolLabelCopySelectedBtn.disabled = !pair
    || !poolLabelSelectedTargetPairs(pair.imagePath).length
    || poolLabelState.tracking;
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
  const pair = state.pairs[state.currentIndex];
  const boxes = pair ? await effectiveBoxesFor(pair) : [];
  poolLabelSyncAutoFitTool();
  if (el.poolLabelUndoBtn) el.poolLabelUndoBtn.disabled = !poolLabelState.undoStack.length;
  if (el.poolLabelCopySelectedBtn) {
    const currentPath = pair?.imagePath || "";
    el.poolLabelCopySelectedBtn.disabled = !poolLabelSelectedTargetPairs(currentPath).length || !boxes.length || poolLabelState.tracking;
  }
  const modeText = poolLabelState.pointerToolEnabled
    ? "Pointer mode (V). Select, move, and resize boxes."
    : poolLabelState.autoFitEnabled
    ? "Subject Select (W). Click a color, or drag to limit the color search."
    : "Manual box mode. V pointer, W subject select.";
  const fixedText = Number.isInteger(poolLabelState.recordingFixedBoxSlot)
    ? ` Recording fixed box ${poolLabelState.recordingFixedBoxSlot}.`
    : "";
  el.poolLabelStatus.textContent = message || `New class: ${classDisplay(poolLabelState.currentClassId)} | ${boxes.length} box(es). ${modeText} T copies, Shift+T CSRT. Hold Shift for fixed boxes.${fixedText}`;
  renderPoolLabelShortcuts();
  renderPoolLabelFixedBoxes();
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
    const classId = Number(source[index]);
    return Number.isInteger(classId) && classId >= 0 ? classId : null;
  });
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
  el.poolLabelShortcuts.replaceChildren();
  poolLabelSetFixedShortcutMode(poolLabelState.fixedShortcutMode);
  for (const slot of POOL_LABEL_SLOT_ORDER) {
    const classId = poolLabelState.shortcutSlots[slot];
    const bound = Number.isInteger(classId) && state.classNames.has(classId);
    const active = bound && classId === poolLabelState.currentClassId && poolLabelState.activeShortcutSlot === slot;
    const control = poolLabelShortcutDropdown({
      label: bound ? `${slot}: ${classId}: ${state.classNames.get(classId)}` : `${slot}: empty`,
      title: `Shortcut ${slot}`,
      options: poolLabelShortcutOptions(slot, bound ? classId : null),
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
    el.poolLabelShortcuts.appendChild(poolLabelShortcutSlotElement(control, ["class-slot", active ? "active" : ""]));
  }
}

function renderPoolLabelFixedBoxes() {
  if (!el.poolLabelFixedBoxes) return;
  el.poolLabelFixedBoxes.replaceChildren();
  for (const slot of POOL_LABEL_SLOT_ORDER) {
    const template = poolLabelState.fixedBoxSlots[slot];
    const ready = poolLabelFixedBoxSlotReady(template);
    const classId = template?.classId;
    const hasClass = Number.isInteger(classId) && state.classNames.has(classId);
    const label = hasClass ? `${slot}: ${classId}: ${state.classNames.get(classId)}${ready ? " ready" : ""}` : `${slot}: empty`;
    const control = poolLabelShortcutDropdown({
      label,
      title: `Fixed box ${slot}`,
      options: poolLabelShortcutOptions(slot, hasClass ? classId : null, ready),
      onSelect: value => {
        const next = value === "" ? null : Number(value);
        poolLabelStartFixedBoxRecording(slot, Number.isInteger(next) ? next : null).catch(showError);
      }
    });
    el.poolLabelFixedBoxes.appendChild(poolLabelShortcutSlotElement(control, [
      "fixed-slot",
      ready && poolLabelState.activeFixedBoxSlot === slot ? "active" : "",
      poolLabelState.recordingFixedBoxSlot === slot ? "recording" : ""
    ]));
  }
}

function poolLabelShortcutOptions(slot, selectedClassId = null, ready = false) {
  const options = [{ value: "", label: `${slot}: empty`, selected: selectedClassId == null }];
  for (const [id, name] of [...state.classNames.entries()].sort((a, b) => a[0] - b[0])) {
    options.push({
      value: String(id),
      label: `${slot}: ${id}: ${name}${ready && id === selectedClassId ? " ready" : ""}`,
      selected: id === selectedClassId
    });
  }
  return options;
}

function poolLabelShortcutDropdown({ label, title, options, onSelect }) {
  const wrap = document.createElement("div");
  wrap.className = "pool-label-shortcut-dropdown";
  const button = document.createElement("button");
  button.type = "button";
  button.className = "pool-label-shortcut-button";
  button.title = title;
  button.textContent = label;
  button.addEventListener("pointerdown", event => {
    event.stopPropagation();
    poolLabelSetFixedShortcutMode(false);
  });
  button.addEventListener("click", event => {
    event.stopPropagation();
    poolLabelToggleShortcutMenu(wrap);
  });
  const menu = document.createElement("div");
  menu.className = "pool-label-shortcut-menu";
  for (const option of options) {
    const item = document.createElement("button");
    item.type = "button";
    item.className = `pool-label-shortcut-option${option.selected ? " selected" : ""}`;
    item.textContent = option.label;
    item.addEventListener("click", event => {
      event.stopPropagation();
      poolLabelCloseShortcutMenus();
      onSelect(option.value);
    });
    menu.appendChild(item);
  }
  wrap.append(button, menu);
  return wrap;
}

function poolLabelToggleShortcutMenu(wrap) {
  const open = wrap.classList.contains("open");
  poolLabelCloseShortcutMenus();
  wrap.classList.toggle("open", !open);
}

function poolLabelCloseShortcutMenus() {
  document.querySelectorAll(".pool-label-shortcut-dropdown.open").forEach(item => item.classList.remove("open"));
}

function poolLabelCloseShortcutMenusOnOutsideClick(event) {
  if (event.target?.closest?.(".pool-label-shortcut-dropdown")) return;
  poolLabelCloseShortcutMenus();
}

function poolLabelShortcutSlotElement(control, classes) {
  const slot = document.createElement("div");
  slot.className = ["pool-label-shortcut-slot", ...classes].filter(Boolean).join(" ");
  slot.appendChild(control);
  return slot;
}

function renderPoolLabelClassManager() {
  if (!el.poolLabelClassList) return;
  renderPoolLabelSlotSelect();
  el.poolLabelClassList.replaceChildren();
  const classes = [...state.classNames.entries()].sort((a, b) => a[0] - b[0]);
  if (!classes.length) {
    el.poolLabelClassList.innerHTML = `<div class="empty">No classes yet. Add one to start labeling.</div>`;
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
