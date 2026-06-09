    function pendingBlackEdits(imagePath) {
      return (state.pending.get(imagePath) || []).filter(edit => edit.mode === "black");
    }

    function pendingBlackCount(imagePath) {
      return pendingBlackEdits(imagePath).length;
    }

    function drawPendingBlackPreview() {
      const pair = state.pairs[state.currentIndex];
      if (!pair || !state.displayRect) return;
      const r = state.displayRect;
      for (const edit of pendingBlackEdits(pair.imagePath)) {
        const rect = edit.rect;
        const x = r.x + rect.x1 * r.w / r.imageW;
        const y = r.y + rect.y1 * r.h / r.imageH;
        const w = (rect.x2 - rect.x1) * r.w / r.imageW;
        const h = (rect.y2 - rect.y1) * r.h / r.imageH;
        ctx.save();
        ctx.fillStyle = "rgba(0, 0, 0, 0.2)";
        ctx.fillRect(x, y, w, h);
        ctx.strokeStyle = "#d92d20";
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 4]);
        ctx.strokeRect(x, y, w, h);
        ctx.restore();
      }
    }

    function drawSelection() {
      if (!state.selection) return;
      const mode = editMode();
      if (mode === "black") {
        drawImageRect(state.selection, "#ef4444", true);
        return;
      }
      const color = mode === "crop" ? "#facc15" : mode === "box" ? "#2563eb" : "#ef4444";
      drawImageRect(state.selection, color, true);
    }

    function drawImageRect(rect, color, dashed) {
      const r = state.displayRect;
      if (!r) return;
      const x = r.x + rect.x1 * r.w / r.imageW;
      const y = r.y + rect.y1 * r.h / r.imageH;
      const w = (rect.x2 - rect.x1) * r.w / r.imageW;
      const h = (rect.y2 - rect.y1) * r.h / r.imageH;
      ctx.save();
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.setLineDash(dashed ? [6, 4] : []);
      ctx.strokeRect(x, y, w, h);
      if (!dashed && color === "#2563eb") {
        ctx.fillStyle = color;
        for (const [hx, hy] of [[x, y], [x + w, y], [x, y + h], [x + w, y + h]]) {
          ctx.fillRect(hx - 4, hy - 4, 8, 8);
        }
      }
      ctx.restore();
    }

	    async function onPointerDown(event) {
	      if (el.app.classList.contains("pool-label") && typeof onPoolLabelPointerDown === "function") {
	        await onPoolLabelPointerDown(event);
	        return;
	      }
	      if (!state.displayRect) return;
      try { el.canvas.setPointerCapture(event.pointerId); } catch {}
      if (event.button === 1 || event.button === 2) {
        event.preventDefault();
        startPreviewPan(event);
        return;
      }
      if (editMode() === "none") {
        const handled = await startBoxDirectEdit(event);
        if (handled) return;
        const hit = await selectBoxAtPointer(event);
        if (!hit && state.viewZoom > 1) startPreviewPan(event);
        return;
      }
      const p = canvasToImage(event);
      if (!p) return;
      state.dragStart = p;
      state.selection = { x1: p.x, y1: p.y, x2: p.x, y2: p.y };
    }

    function startPreviewPan(event) {
      state.viewPanDrag = {
        startX: event.clientX,
        startY: event.clientY,
        panX: state.viewPanX,
        panY: state.viewPanY
      };
      el.canvas.style.cursor = "grabbing";
    }
	    async function onPointerMove(event) {
	      if (el.app.classList.contains("pool-label") && typeof onPoolLabelPointerMove === "function") {
	        await onPoolLabelPointerMove(event);
	        return;
	      }
	      if (state.viewPanDrag) {
        state.viewPanX = state.viewPanDrag.panX + (event.clientX - state.viewPanDrag.startX);
        state.viewPanY = state.viewPanDrag.panY + (event.clientY - state.viewPanDrag.startY);
        clampPreviewView();
        redrawPreviewOverlays();
        el.canvas.style.cursor = "grabbing";
        return;
      }
      if (state.boxDrag) {
        await updateBoxDirectEdit(event);
        return;
      }
      if (editMode() === "none") {
        await updateBoxCursor(event);
        return;
      }
      if (!state.dragStart) return;
      const p = canvasToImage(event);
      if (!p) return;
      state.selection = normalizeRect(state.dragStart, p);
      redrawPreviewOverlays();
      el.positionMeta.textContent = `x=${state.selection.x1}, y=${state.selection.y1}, w=${state.selection.x2 - state.selection.x1}, h=${state.selection.y2 - state.selection.y1}`;
    }
	    async function onPointerUp(event) {
	      if (el.app.classList.contains("pool-label") && typeof onPoolLabelPointerUp === "function") {
	        await onPoolLabelPointerUp(event);
	        return;
	      }
	      if (event) {
        try { el.canvas.releasePointerCapture(event.pointerId); } catch {}
      }
      if (state.viewPanDrag) {
        state.viewPanDrag = null;
        el.canvas.style.cursor = "crosshair";
        return;
      }
      if (state.boxDrag) {
        const pair = state.pairs[state.currentIndex];
        const boxes = pair ? state.labelEdits.get(pair.imagePath) : null;
        state.boxDrag = null;
        if (pair && boxes) await persistLabelBoxes(pair, boxes);
        await applyFilter(false);
        await renderCurrentImage();
        renderGallery();
        return;
      }
      if (!state.dragStart) return;
      state.dragStart = null;
      if (state.selection && (state.selection.x2 - state.selection.x1 < 2 || state.selection.y2 - state.selection.y1 < 2)) {
        state.selection = null;
      } else if (editMode() === "box" && state.selection) {
        await addBoxFromSelection();
      } else if (state.selection) {
        const mode = editMode();
        if (mode === "black" || mode === "crop") {
          const pair = state.pairs[state.currentIndex];
          if (pair && await addEditToPair(pair, mode, state.selection)) {
            state.selection = null;
            updatePendingStatus();
            renderCurrentPendingList();
          }
        }
      }
      await renderCurrentImage();
      renderGallery();
    }

    async function selectBoxAtPointer(event) {
      const point = canvasToImage(event);
      const pair = state.pairs[state.currentIndex];
      if (!point || !pair) return false;
      const boxes = await effectiveBoxesFor(pair);
      const index = hitBoxIndexAtPoint(point, boxes);
      state.selectedBoxIndex = index >= 0 ? index : null;
      populateBoxEditor(index >= 0 ? boxes[index] : null);
      await renderCurrentImage();
      return index >= 0;
    }

    function populateBoxEditor(box) {
      if (!box) {
        el.boxEditStatus.textContent = "Click a green YOLO box in Preview to edit it.";
        for (const input of [el.boxClassInput, el.boxXInput, el.boxYInput, el.boxWInput, el.boxHInput]) input.value = "";
        return;
      }
      el.boxEditStatus.textContent = `Editing box ${state.selectedBoxIndex + 1}. TXT saves when you release the drag or click Update.`;
      el.boxClassInput.value = box.classId;
      el.boxXInput.value = fmt(box.x);
      el.boxYInput.value = fmt(box.y);
      el.boxWInput.value = fmt(box.w);
      el.boxHInput.value = fmt(box.h);
    }

    async function addBoxFromSelection() {
      const pair = state.pairs[state.currentIndex];
      if (!pair || !state.selection) return;
      const boxes = await editableBoxesFor(pair);
      const box = rectToBox(state.selection, Number.parseInt(el.boxClassInput.value, 10));
      boxes.push(box);
      state.selectedBoxIndex = boxes.length - 1;
      await persistLabelBoxes(pair, boxes);
      populateBoxEditor(box);
      state.selection = null;
      await applyFilter(false);
      await renderCurrentImage();
      renderGallery();
    }

    async function startBoxDirectEdit(event) {
      const pair = state.pairs[state.currentIndex];
      if (!pair) return false;
      const point = canvasToImage(event);
      if (!point) return false;
      const boxes = await effectiveBoxesFor(pair);
      const hit = hitBoxInteractionAtEvent(event, boxes);
      const index = hit.index;
      if (index < 0) return false;
      state.selectedBoxIndex = index;
      const box = boxes[index];
      const rect = boxToImageRect(box);
      state.boxDrag = {
        handle: hit.handle,
        start: point,
        rect,
        index
      };
      populateBoxEditor(box);
      await renderCurrentImage();
      return true;
    }

    async function updateBoxDirectEdit(event) {
      const pair = state.pairs[state.currentIndex];
      const point = canvasToImageClamped(event);
      if (!pair || !point || !state.boxDrag) return;
      const boxes = await editableBoxesFor(pair);
      const drag = state.boxDrag;
      const rect = { ...drag.rect };
      const dx = point.x - drag.start.x;
      const dy = point.y - drag.start.y;
      const maxW = state.displayRect.imageW;
      const maxH = state.displayRect.imageH;
      if (drag.handle === "move") {
        const w = rect.x2 - rect.x1;
        const h = rect.y2 - rect.y1;
        rect.x1 = Math.max(0, Math.min(maxW - w, rect.x1 + dx));
        rect.y1 = Math.max(0, Math.min(maxH - h, rect.y1 + dy));
        rect.x2 = rect.x1 + w;
        rect.y2 = rect.y1 + h;
      } else {
        const minSize = 2;
        if (drag.handle.includes("w")) rect.x1 = Math.max(0, Math.min(rect.x2 - minSize, rect.x1 + dx));
        if (drag.handle.includes("e")) rect.x2 = Math.min(maxW, Math.max(rect.x1 + minSize, rect.x2 + dx));
        if (drag.handle.includes("n")) rect.y1 = Math.max(0, Math.min(rect.y2 - minSize, rect.y1 + dy));
        if (drag.handle.includes("s")) rect.y2 = Math.min(maxH, Math.max(rect.y1 + minSize, rect.y2 + dy));
      }
      normalizeImageRectInPlace(rect);
      boxes[drag.index] = rectToBox(rect, boxes[drag.index].classId);
      state.labelEdits.set(pair.imagePath, boxes);
      populateBoxEditor(boxes[drag.index]);
      await renderCurrentImage();
    }

    function boxToImageRect(box) {
      const imageW = state.displayRect.imageW;
      const imageH = state.displayRect.imageH;
      return {
        x1: Math.round((box.x - box.w / 2) * imageW),
        y1: Math.round((box.y - box.h / 2) * imageH),
        x2: Math.round((box.x + box.w / 2) * imageW),
        y2: Math.round((box.y + box.h / 2) * imageH)
      };
    }

    function rectToBox(rect, classId) {
      const imageW = state.displayRect.imageW;
      const imageH = state.displayRect.imageH;
      return {
        classId: Number.isFinite(classId) ? classId : 0,
        x: clamp01(((rect.x1 + rect.x2) / 2) / imageW),
        y: clamp01(((rect.y1 + rect.y2) / 2) / imageH),
        w: clamp01((rect.x2 - rect.x1) / imageW),
        h: clamp01((rect.y2 - rect.y1) / imageH)
      };
    }

    function hitBoxHandle(point, rect) {
      const handles = boxHandlePointsImage(rect);
      const tolerance = Math.max(8, Math.round(canvasPixelsToImagePixels(10)));
      let best = null;
      let bestDistance = Infinity;
      for (const [name, x, y] of handles) {
        if (Math.abs(point.x - x) <= tolerance && Math.abs(point.y - y) <= tolerance) return name;
        const distance = Math.hypot(point.x - x, point.y - y);
        if (distance < bestDistance) {
          best = name;
          bestDistance = distance;
        }
      }
      return bestDistance <= tolerance * 1.25 ? best : null;
    }

    function boxHandlePointsImage(rect) {
      return [
        ["nw", rect.x1, rect.y1], ["ne", rect.x2, rect.y1],
        ["sw", rect.x1, rect.y2], ["se", rect.x2, rect.y2]
      ];
    }

    function canvasEventPoint(event) {
      const canvasBox = el.canvas.getBoundingClientRect();
      return {
        x: (event.clientX - canvasBox.left) * el.canvas.width / canvasBox.width,
        y: (event.clientY - canvasBox.top) * el.canvas.height / canvasBox.height
      };
    }

    function imagePointToCanvas(point) {
      const r = state.displayRect;
      return {
        x: r.x + point.x * r.w / r.imageW,
        y: r.y + point.y * r.h / r.imageH
      };
    }

    function imageRectToCanvasRect(rect) {
      const a = imagePointToCanvas({ x: rect.x1, y: rect.y1 });
      const b = imagePointToCanvas({ x: rect.x2, y: rect.y2 });
      return { x1: a.x, y1: a.y, x2: b.x, y2: b.y };
    }

    function canvasPixelsToImagePixels(px) {
      const r = state.displayRect;
      if (!r || !r.w || !r.h) return px;
      return px * Math.max(r.imageW / r.w, r.imageH / r.h);
    }

    function hitBoxInteractionAtEvent(event, boxes) {
      const canvasPoint = canvasEventPoint(event);
      const selected = state.selectedBoxIndex;
      if (selected !== null && boxes[selected]) {
        const rect = boxToImageRect(boxes[selected]);
        const handle = hitBoxHandleAtCanvasPoint(canvasPoint, rect);
        if (handle) return { index: selected, handle };
        if (pointInCanvasRect(canvasPoint, imageRectToCanvasRect(rect))) {
          return { index: selected, handle: "move" };
        }
      }
      const index = hitBoxIndexAtCanvasPoint(canvasPoint, boxes);
      return { index, handle: index >= 0 ? "move" : null };
    }

    function hitBoxHandleAtCanvasPoint(point, rect) {
      const canvasRect = imageRectToCanvasRect(rect);
      const w = Math.abs(canvasRect.x2 - canvasRect.x1);
      const h = Math.abs(canvasRect.y2 - canvasRect.y1);
      const cornerTolerance = w < 24 || h < 24 ? 6 : 11;
      const handles = editBoxHandlePointsCanvas(canvasRect);
      let best = null;
      let bestDistance = Infinity;
      for (const [name, x, y] of handles) {
        const distance = Math.hypot(point.x - x, point.y - y);
        if (distance <= cornerTolerance && distance < bestDistance) {
          best = name;
          bestDistance = distance;
        }
      }
      return best;
    }

    function editBoxHandlePointsCanvas(rect) {
      return [
        ["nw", rect.x1, rect.y1], ["ne", rect.x2, rect.y1],
        ["sw", rect.x1, rect.y2], ["se", rect.x2, rect.y2]
      ];
    }

    function normalizeImageRectInPlace(rect) {
      if (rect.x1 > rect.x2) [rect.x1, rect.x2] = [rect.x2, rect.x1];
      if (rect.y1 > rect.y2) [rect.y1, rect.y2] = [rect.y2, rect.y1];
    }

    function hitBoxIndexAtPoint(point, boxes) {
      for (let index = boxes.length - 1; index >= 0; index--) {
        if (pointInRect(point, boxToImageRect(boxes[index]))) return index;
      }
      return -1;
    }

    function hitBoxIndexAtCanvasPoint(point, boxes) {
      for (let index = boxes.length - 1; index >= 0; index--) {
        if (pointInCanvasRect(point, imageRectToCanvasRect(boxToImageRect(boxes[index])))) return index;
      }
      return -1;
    }

    function pointInRect(point, rect) {
      return point.x >= rect.x1 && point.x <= rect.x2 && point.y >= rect.y1 && point.y <= rect.y2;
    }

    function pointInCanvasRect(point, rect) {
      const pad = 3;
      return point.x >= Math.min(rect.x1, rect.x2) - pad
        && point.x <= Math.max(rect.x1, rect.x2) + pad
        && point.y >= Math.min(rect.y1, rect.y2) - pad
        && point.y <= Math.max(rect.y1, rect.y2) + pad;
    }

    async function updateSelectedBox() {
      const pair = state.pairs[state.currentIndex];
      if (!pair || state.selectedBoxIndex === null) {
        alert("Click a YOLO box first.");
        return;
      }
      const box = readBoxEditor();
      if (!box) return;
      const boxes = await editableBoxesFor(pair);
      boxes[state.selectedBoxIndex] = box;
      await persistLabelBoxes(pair, boxes);
      await applyFilter(false);
      await renderCurrentImage();
      renderGallery();
    }

    async function deleteSelectedBox() {
      const pair = state.pairs[state.currentIndex];
      if (!pair || state.selectedBoxIndex === null) {
        alert("Click a YOLO box first.");
        return;
      }
      const boxes = await editableBoxesFor(pair);
      boxes.splice(state.selectedBoxIndex, 1);
      state.selectedBoxIndex = null;
      await persistLabelBoxes(pair, boxes);
      populateBoxEditor(null);
      await applyFilter(false);
      await renderCurrentImage();
      renderGallery();
    }

    function readBoxEditor() {
      const box = {
        classId: Number.parseInt(el.boxClassInput.value, 10),
        x: Number.parseFloat(el.boxXInput.value),
        y: Number.parseFloat(el.boxYInput.value),
        w: Number.parseFloat(el.boxWInput.value),
        h: Number.parseFloat(el.boxHInput.value)
      };
      if (!Number.isFinite(box.classId) || [box.x, box.y, box.w, box.h].some(v => !Number.isFinite(v))) {
        alert("Enter valid class, x, y, width, and height values.");
        return null;
      }
      box.x = clamp01(box.x);
      box.y = clamp01(box.y);
      box.w = clamp01(box.w);
      box.h = clamp01(box.h);
      return box;
    }

    async function addPendingEdit() {
      if (!state.selection || !state.pairs.length) {
        alert("Drag a rectangle on Preview first.");
        return;
      }
      const mode = editMode();
      if (mode === "none") {
        alert("Choose Crop or Black first.");
        return;
      }
      if (mode === "box") {
        alert("Box mode writes TXT boxes directly. Drag on Preview to create a YOLO box; do not use Add.");
        return;
      }
      const pair = state.pairs[state.currentIndex];
      if (!await addEditToPair(pair, mode, state.selection)) return;
      state.selection = null;
      updatePendingStatus();
      renderCurrentPendingList();
      await renderCurrentImage();
      renderGallery();
    }

    function invalidateImageCache(imagePath) {
      bitmapCache.delete(imagePath);
      const url = getCachedObjectUrl(imagePath);
      if (url) {
        removeCachedObjectUrl(imagePath);
      }
      for (const img of document.querySelectorAll("#gallery img[data-path]")) {
        if (img.dataset.path === imagePath) {
          img.dataset.srcPending = "true";
          img.removeAttribute("src");
          thumbObserver.observe(img);
        }
      }
    }

    async function persistLabelBoxes(pair, boxes, options = {}) {
      await writeLabelBoxes(pair, boxes);
      state.labelEdits.delete(pair.imagePath);
      if (options.refreshFilterList !== false) {
        await buildFilterList();
        syncFilterInputs();
      }
    }

    async function commitImageEdit(pair, edit) {
      await ensureImagePoolBackupBeforeEdit(pair, edit.mode);
      if (edit.mode === "black") {
        const bitmap = await imageBitmap(pair.imageHandle);
        const out = document.createElement("canvas");
        out.width = bitmap.width;
        out.height = bitmap.height;
        const outCtx = out.getContext("2d");
        outCtx.drawImage(bitmap, 0, 0);
        const r = edit.rect;
        outCtx.fillStyle = "#000000";
        outCtx.fillRect(r.x1, r.y1, r.x2 - r.x1, r.y2 - r.y1);
        const blob = await canvasBlob(out, mimeFor(pair.imagePath));
        await writeBlob(pair.imageHandle, blob);
        invalidateImageCache(pair.imagePath);
        return;
      }
      if (edit.mode === "crop") {
        const boxes = await boxesFor(pair);
        await applyEditsToPair(pair, [edit], boxes);
        invalidateImageCache(pair.imagePath);
      }
    }

    function syncBlackRepeatTemplate() {
      const pair = state.pairs[state.currentIndex];
      if (!pair) return;
      const blacks = pendingBlackEdits(pair.imagePath);
      if (blacks.length) state.blackRepeatTemplate = blacks.map(cloneImageEdit);
    }

    function addPendingBlackToPair(pair, rect) {
      const edits = state.pending.get(pair.imagePath) || [];
      edits.push({ mode: "black", rect: { ...rect } });
      state.pending.set(pair.imagePath, edits);
      if (pair.imagePath === state.pairs[state.currentIndex]?.imagePath) syncBlackRepeatTemplate();
      return true;
    }

    async function applyBlackEditsForPair(pair) {
      const edits = state.pending.get(pair.imagePath) || [];
      const blacks = edits.filter(edit => edit.mode === "black");
      if (!blacks.length) return 0;
      try {
        for (const edit of blacks) await commitImageEdit(pair, edit);
      } catch (error) {
        throw error;
      }
      const remaining = edits.filter(edit => edit.mode !== "black");
      if (remaining.length) state.pending.set(pair.imagePath, remaining);
      else state.pending.delete(pair.imagePath);
      if (pair.imagePath === state.pairs[state.currentIndex]?.imagePath) {
        state.blackRepeatTemplate = blacks.map(cloneImageEdit);
      }
      invalidateImageCache(pair.imagePath);
      return blacks.length;
    }

    async function applyCurrentBlackEdits() {
      const pair = state.pairs[state.currentIndex];
      if (!pair) return;
      const count = await applyBlackEditsForPair(pair);
      if (!count) {
        alert("No pending black boxes on this image.");
        return;
      }
      updatePendingStatus();
      renderCurrentPendingList();
      await renderCurrentImage();
      renderGallery();
      el.editHint.textContent = `Applied ${count} black box(es) to the current image.`;
    }

    async function applyAllPendingBlackEdits() {
      const paths = [...state.pending.keys()].filter(path => pendingBlackCount(path) > 0);
      if (!paths.length) {
        alert("No pending black boxes.");
        return;
      }
      const byPath = new Map(state.allPairs.map(pair => [pair.imagePath, pair]));
      let images = 0;
      let boxes = 0;
      for (const path of paths) {
        const pair = byPath.get(path);
        if (!pair) continue;
        const count = await applyBlackEditsForPair(pair);
        if (count) {
          images += 1;
          boxes += count;
        }
      }
      updatePendingStatus();
      renderCurrentPendingList();
      await renderCurrentImage();
      renderGallery();
      el.editHint.textContent = `Applied ${boxes} black box(es) on ${images} image(s).`;
    }

    async function addEditToPair(pair, mode, rect, options = {}) {
      if (mode === "black") {
        return addPendingBlackToPair(pair, rect);
      }
      if (mode === "crop") {
        try {
          await commitImageEdit(pair, { mode: "crop", rect: { ...rect } });
        } catch (error) {
          if (!options.silent) alert(error?.message || String(error));
          return false;
        }
        invalidateImageCache(pair.imagePath);
        return true;
      }
      return false;
    }

    function clearSelection() {
      state.selection = null;
      renderCurrentImage();
    }

    function undoLastPendingEdit() {
      const pair = state.pairs[state.currentIndex];
      if (!pair) return;
      const edits = state.pending.get(pair.imagePath) || [];
      if (!edits.length) {
        el.editHint.textContent = "No pending black box on this image.";
        return;
      }
      edits.pop();
      if (edits.length) state.pending.set(pair.imagePath, edits);
      else state.pending.delete(pair.imagePath);
      syncBlackRepeatTemplate();
      updatePendingStatus();
      renderCurrentPendingList();
      renderCurrentImage();
      renderGallery();
    }

    function undoCurrentPending() {
      const pair = state.pairs[state.currentIndex];
      if (!pair) return;
      state.pending.delete(pair.imagePath);
      state.labelEdits.delete(pair.imagePath);
      state.selectedBoxIndex = null;
      populateBoxEditor(null);
      syncBlackRepeatTemplate();
      updatePendingStatus();
      renderCurrentPendingList();
      renderCurrentImage();
      renderGallery();
    }

    async function repeatBlackBox(count) {
      const sourceEdits = repeatSourceImageEdits();
      if (!sourceEdits.length) {
        alert("Add one or more black boxes on the current image first.");
        return;
      }
      let added = 0;
      for (let offset = 1; offset <= count; offset++) {
        const pair = state.pairs[state.currentIndex + offset];
        if (!pair) break;
        await addImageEditsToPair(pair, sourceEdits);
        added += 1;
      }
      updatePendingStatus();
      renderCurrentPendingList();
      renderGallery();
      await renderCurrentImage();
      el.editHint.textContent = `Copied ${sourceEdits.length} pending black box(es) to ${added} following image(s). Apply on each image when ready.`;
    }

    async function repeatBlackBoxToShift() {
      const sourceEdits = repeatSourceImageEdits();
      if (!sourceEdits.length) {
        alert("Add one or more black boxes on the current image first.");
        return;
      }
      const currentPath = state.pairs[state.currentIndex]?.imagePath;
      const targets = state.pairs.filter(
        pair => state.shiftSelectedPaths.has(pair.imagePath) && pair.imagePath !== currentPath
      );
      if (!targets.length) {
        alert("Ctrl+click thumbnails to select, or Shift+click a range, then try again.");
        return;
      }
      for (const pair of targets) await addImageEditsToPair(pair, sourceEdits);
      updatePendingStatus();
      renderCurrentPendingList();
      renderGallery();
      await renderCurrentImage();
      el.editHint.textContent = `Copied ${sourceEdits.length} pending black box(es) to ${targets.length} selected image(s). Apply when ready.`;
    }

    function repeatSourceImageEdits() {
      const pair = state.pairs[state.currentIndex];
      if (!pair) return [];
      const pending = pendingBlackEdits(pair.imagePath);
      if (pending.length) return pending.map(cloneImageEdit);
      if (state.blackRepeatTemplate.length) return state.blackRepeatTemplate.map(cloneImageEdit);
      if (editMode() === "black" && state.selection) {
        return [{ mode: "black", rect: { ...state.selection } }];
      }
      return [];
    }

    async function addImageEditsToPair(pair, edits) {
      for (const edit of edits) {
        if (edit.mode === "black") addPendingBlackToPair(pair, edit.rect);
        else await addEditToPair(pair, edit.mode, edit.rect, { silent: true });
      }
    }

    function cloneImageEdit(edit) {
      return { mode: edit.mode, rect: { ...edit.rect } };
    }

    function renderCurrentPendingList() {
      const pair = state.pairs[state.currentIndex];
      const edits = pair ? pendingBlackEdits(pair.imagePath) : [];
      if (!edits.length) {
        el.currentPendingList.innerHTML = `<div class="pending-item"><span>No pending black boxes on this image.</span></div>`;
        return;
      }
      el.currentPendingList.innerHTML = "";
      edits.forEach((edit, index) => {
        const item = document.createElement("div");
        item.className = "pending-item";
        const label = `black ${index + 1}: x=${edit.rect.x1}, y=${edit.rect.y1}, w=${edit.rect.x2 - edit.rect.x1}, h=${edit.rect.y2 - edit.rect.y1}`;
        item.innerHTML = `<span>${escapeHtml(label)}</span><button class="danger" type="button">Delete</button>`;
        item.querySelector("button").addEventListener("click", () => deletePendingEdit(index));
        el.currentPendingList.appendChild(item);
      });
    }

    function deletePendingEdit(index) {
      const pair = state.pairs[state.currentIndex];
      if (!pair) return;
      const edits = state.pending.get(pair.imagePath) || [];
      if (index < 0 || index >= edits.length) return;
      edits.splice(index, 1);
      if (edits.length) state.pending.set(pair.imagePath, edits);
      else state.pending.delete(pair.imagePath);
      syncBlackRepeatTemplate();
      updatePendingStatus();
      renderCurrentPendingList();
      renderCurrentImage();
      renderGallery();
    }

    async function restoreFromBackup() {
      if (!hasDatasetOpen()) {
        alert("Open a dataset first.");
        return;
      }
      const pair = state.pairs[state.currentIndex];
      if (!pair) {
        alert("No current preview image to restore.");
        return;
      }

      if (isImagePoolWorkspacePair(pair)) {
        if (!confirm(`从 image_pool_backup 恢复当前图？\n\n${pair.imagePath}\n${pair.labelPath || "(无标签备份则只恢复图片)"}`)) {
          return;
        }
        const result = await restoreImagePoolPairFromBackup(pair);
        if (!result) {
          alert("未找到该图的备份。首次 Crop/黑块保存前会自动备份到 image_pool_backup/。");
          return;
        }
        state.pending.delete(pair.imagePath);
        state.blackRepeatTemplate = [];
        state.selectedBoxIndex = null;
        populateBoxEditor(null);
        updatePendingStatus();
        renderCurrentPendingList();
        await renderCurrentImage();
        renderGallery();
        const parts = [];
        if (result.restored?.image) parts.push("图片");
        if (result.restored?.label) parts.push("标签");
        setStatus(`已从 image_pool_backup 恢复：${parts.join(" + ") || "无"}`);
        return;
      }

      if (state.datasetBackendRoot) {
        const wsHint = state.workspaceRoot
          ? "\n\n当前为数据集审阅模式（如 clf_dataset / detect_dataset）。备份恢复请从 Image Pool 点图进入 workspace 标注，或标注 image_pool/ 下的原图。"
          : "";
        alert(`当前不是 workspace 标注模式（image_pool）。${wsHint}`.trim());
        return;
      }
      let backup = state.backupHandle;
      if (!backup) {
        alert("Choose Source Copy Folder first. It should be the copied original dataset folder.");
        return;
      }
      if (!confirm(`Restore current preview image from source copy folder "${backup.name}"?\n\n${pair.imagePath}\n${pair.labelPath || "(no txt)"}`)) {
        return;
      }
      const restored = await restorePairFromBackup(pair, backup);
      if (!restored) {
        alert("No matching file found in the source copy folder for the current preview image.");
        return;
      }
      state.pending.delete(pair.imagePath);
      state.labelEdits.delete(pair.imagePath);
      state.blackRepeatTemplate = [];
      state.selectedBoxIndex = null;
      populateBoxEditor(null);
      updatePendingStatus();
      renderCurrentPendingList();
      await loadFromDirectoryHandle(state.datasetHandle, pair.imagePath);
      alert(`Restored ${restored} file(s) for the current preview image.`);
    }

    async function restorePairFromBackup(pair, backup) {
      let restored = 0;
      const imageBackup = await fileHandleAtPath(backup, pair.imagePath);
      if (imageBackup) {
        await writeFileToDatasetPath(pair.imagePath, imageBackup);
        restored += 1;
      }
      if (pair.labelPath) {
        const labelBackup = await fileHandleAtPath(backup, pair.labelPath);
        if (labelBackup) {
          await writeFileToDatasetPath(pair.labelPath, labelBackup);
          restored += 1;
        }
      }
      return restored;
    }

    async function fileHandleAtPath(root, path) {
      const parts = path.split("/");
      let dir = root;
      try {
        for (const part of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(part);
        return dir.getFileHandle(parts.at(-1));
      } catch {
        return null;
      }
    }

    async function writeFileToDatasetPath(path, sourceHandle) {
      if (state.datasetBackendRoot) {
        const targetHandle = backendFileHandle(state.datasetBackendRoot, path);
        const writable = await targetHandle.createWritable();
        await writable.write(await sourceHandle.getFile());
        await writable.close();
        state.files.set(path, targetHandle);
        return;
      }
      const parts = path.split("/");
      let dir = state.datasetHandle;
      for (const part of parts.slice(0, -1)) {
        dir = await dir.getDirectoryHandle(part, { create: true });
      }
      const targetHandle = await dir.getFileHandle(parts.at(-1), { create: true });
      const writable = await targetHandle.createWritable();
      await writable.write(await sourceHandle.getFile());
      await writable.close();
    }

    async function applyEditsToPair(pair, edits, sourceBoxes = null) {
      const bitmap = await imageBitmap(pair.imageHandle);
      const crop = edits.find(e => e.mode === "crop");
      const black = edits.filter(e => e.mode === "black");
      const boxes = sourceBoxes ?? await boxesFor(pair);
      const out = document.createElement("canvas");
      const outCtx = out.getContext("2d");
      if (crop) {
        const r = crop.rect;
        out.width = r.x2 - r.x1;
        out.height = r.y2 - r.y1;
        outCtx.drawImage(bitmap, r.x1, r.y1, out.width, out.height, 0, 0, out.width, out.height);
        await updateLabelForCrop(pair, r, bitmap.width, bitmap.height, boxes);
      } else {
        out.width = bitmap.width;
        out.height = bitmap.height;
        outCtx.drawImage(bitmap, 0, 0);
      }
      for (const edit of black) {
        let r = edit.rect;
        if (crop) r = rectAfterCrop(r, crop.rect);
        if (!r) continue;
        outCtx.fillStyle = "#000000";
        outCtx.fillRect(r.x1, r.y1, r.x2 - r.x1, r.y2 - r.y1);
      }
      const blob = await canvasBlob(out, mimeFor(pair.imagePath));
      await writeBlob(pair.imageHandle, blob);
      removeCachedObjectUrl(pair.imagePath);
      bitmapCache.delete(pair.imagePath);
    }

    async function updateLabelForCrop(pair, crop, imageW, imageH, boxes) {
      const cropW = crop.x2 - crop.x1;
      const cropH = crop.y2 - crop.y1;
      const updated = [];
      for (const box of boxes) {
        const bx1 = (box.x - box.w / 2) * imageW;
        const by1 = (box.y - box.h / 2) * imageH;
        const bx2 = (box.x + box.w / 2) * imageW;
        const by2 = (box.y + box.h / 2) * imageH;
        const ix1 = Math.max(bx1, crop.x1);
        const iy1 = Math.max(by1, crop.y1);
        const ix2 = Math.min(bx2, crop.x2);
        const iy2 = Math.min(by2, crop.y2);
        if (ix2 <= ix1 || iy2 <= iy1) continue;
        const nx1 = ix1 - crop.x1;
        const ny1 = iy1 - crop.y1;
        const nx2 = ix2 - crop.x1;
        const ny2 = iy2 - crop.y1;
        updated.push({
          classId: box.classId,
          x: ((nx1 + nx2) / 2) / cropW,
          y: ((ny1 + ny2) / 2) / cropH,
          w: (nx2 - nx1) / cropW,
          h: (ny2 - ny1) / cropH
        });
      }
      await writeLabelBoxes(pair, updated);
    }

    async function writeLabelBoxes(pair, boxes) {
      const labelHandle = await labelHandleForWrite(pair);
      await writeText(labelHandle, boxesToText(boxes));
      setBoxesCache(pair, boxes);
    }

    async function labelHandleForWrite(pair) {
      if (!pair.labelPath) {
        pair.labelPath = labelPathFor(pair.imagePath) || pair.imagePath.replace(/\.[^.]+$/, ".txt");
      }
      if (state.files.has(pair.labelPath)) return state.files.get(pair.labelPath);
      if (state.datasetBackendRoot) {
        const handle = backendFileHandle(state.datasetBackendRoot, pair.labelPath);
        state.files.set(pair.labelPath, handle);
        return handle;
      }
      const parts = pair.labelPath.split("/");
      let dir = state.datasetHandle;
      for (const part of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(part, { create: true });
      const handle = await dir.getFileHandle(parts.at(-1), { create: true });
      state.files.set(pair.labelPath, handle);
      return handle;
    }

    function rectAfterCrop(rect, crop) {
      const x1 = Math.max(rect.x1, crop.x1);
      const y1 = Math.max(rect.y1, crop.y1);
      const x2 = Math.min(rect.x2, crop.x2);
      const y2 = Math.min(rect.y2, crop.y2);
      if (x2 <= x1 || y2 <= y1) return null;
      return { x1: x1 - crop.x1, y1: y1 - crop.y1, x2: x2 - crop.x1, y2: y2 - crop.y1 };
    }

    function canvasToImage(event) {
      const r = state.displayRect;
      if (!r) return null;
      const canvasBox = el.canvas.getBoundingClientRect();
      const cx = (event.clientX - canvasBox.left) * el.canvas.width / canvasBox.width;
      const cy = (event.clientY - canvasBox.top) * el.canvas.height / canvasBox.height;
      if (cx < r.x || cy < r.y || cx > r.x + r.w || cy > r.y + r.h) return null;
      return {
        x: Math.round(Math.max(0, Math.min(r.imageW, (cx - r.x) * r.imageW / r.w))),
        y: Math.round(Math.max(0, Math.min(r.imageH, (cy - r.y) * r.imageH / r.h)))
      };
    }

    function canvasToImageClamped(event) {
      const r = state.displayRect;
      if (!r) return null;
      const canvasBox = el.canvas.getBoundingClientRect();
      const cx = (event.clientX - canvasBox.left) * el.canvas.width / canvasBox.width;
      const cy = (event.clientY - canvasBox.top) * el.canvas.height / canvasBox.height;
      return {
        x: Math.round(Math.max(0, Math.min(r.imageW, (cx - r.x) * r.imageW / r.w))),
        y: Math.round(Math.max(0, Math.min(r.imageH, (cy - r.y) * r.imageH / r.h)))
      };
    }

    async function updateBoxCursor(event) {
      const pair = state.pairs[state.currentIndex];
      const point = canvasToImage(event);
      if (!pair || !point) {
        el.canvas.style.cursor = "crosshair";
        return;
      }
      const boxes = await effectiveBoxesFor(pair);
      const hit = hitBoxInteractionAtEvent(event, boxes);
      el.canvas.style.cursor = hit.index >= 0 ? cursorForBoxHandle(hit.handle) : "crosshair";
    }

    function cursorForBoxHandle(handle) {
      if (handle === "n" || handle === "s") return "ns-resize";
      if (handle === "e" || handle === "w") return "ew-resize";
      if (handle === "nw" || handle === "se") return "nwse-resize";
      if (handle === "ne" || handle === "sw") return "nesw-resize";
      return "move";
    }

    function normalizeRect(a, b) {
      return { x1: Math.min(a.x, b.x), y1: Math.min(a.y, b.y), x2: Math.max(a.x, b.x), y2: Math.max(a.y, b.y) };
    }
    function editMode() { return document.querySelector("input[name=editMode]:checked").value; }
    function clearPreview() {
      ctx.clearRect(0, 0, el.canvas.width, el.canvas.height);
      el.fileMeta.textContent = "No image selected.";
      el.labelText.value = "";
      el.boxCount.textContent = "";
      state.viewZoom = 1;
      state.viewPanX = 0;
      state.viewPanY = 0;
      state.viewPanDrag = null;
      updateSelectedClassPanel();
    }
    function updatePendingStatus() {
      const pair = state.pairs[state.currentIndex];
      const currentBlacks = pair ? pendingBlackCount(pair.imagePath) : 0;
      let totalBlacks = 0;
      let totalImages = 0;
      for (const path of state.pending.keys()) {
        const count = pendingBlackCount(path);
        if (count) {
          totalBlacks += count;
          totalImages += 1;
        }
      }
      if (totalBlacks) {
        el.pendingStatus.textContent = `${totalBlacks} black box(es) pending on ${totalImages} image(s). Current: ${currentBlacks}. Apply to save.`;
      } else {
        el.pendingStatus.textContent = "Black boxes preview as dashed lines; click Apply Blacks to save. Crop and TXT save immediately.";
      }
    }
