	    function yoloGalleryAssignScope() {
      return typeof yoloJunkScope === "function" ? yoloJunkScope() : "detect";
    }

    function yoloGalleryThumbTags(pair) {
      const pendingBlacks = pendingBlackCount(pair.imagePath);
      const classifierResult = classifierState.results.get(pair.imagePath);
      const classifierTag = classifierResult?.top ? `[${classifierResult.top.name} ${(classifierResult.top.confidence * 100).toFixed(0)}%] ` : "";
      const classTag = state.datasetTask === "classify" ? `[${pair.className || classDisplay(pair.classId)}] ` : "";
      return `${state.flaggedPaths.has(pair.imagePath) ? "[FLAG] " : ""}${state.reviewedPaths.has(pair.imagePath) ? "[OK] " : ""}${pendingBlacks ? `[PENDING ${pendingBlacks}] ` : ""}${classTag}${classifierTag}`;
    }

    function yoloGalleryCardBaseClasses(index, pair) {
      return `thumb${index === state.currentIndex ? " active" : ""}${state.pending.has(pair.imagePath) ? " pending" : ""}${state.shiftSelectedPaths.has(pair.imagePath) ? " shift-selected" : ""}${state.reviewedPaths.has(pair.imagePath) ? " reviewed" : ""}${state.flaggedPaths.has(pair.imagePath) ? " flagged" : ""}`;
    }

    function syncYoloGalleryCardAssignVisual(card, filename) {
      if (typeof syncInboxCardAssignVisual === "function") {
        syncInboxCardAssignVisual(card, filename, yoloGalleryAssignScope());
      }
    }

    function patchYoloGalleryCard(index, card) {
      const pair = state.pairs[index];
      if (!pair || !card) return;
      const filename = pair.imagePath.split("/").pop();
      card.className = yoloGalleryCardBaseClasses(index, pair);
      syncYoloGalleryCardAssignVisual(card, filename);
      const nameEl = card.querySelector(".name");
      if (nameEl) nameEl.textContent = `${yoloGalleryThumbTags(pair)}${filename}`;
    }

	    async function renderGallery(options = {}) {
      const { patchVisible = false } = options;
      if (!state.pairs.length) {
        el.gallery.style.height = "";
        el.gallery.innerHTML = `<div class="empty">No images match the current filter.</div>`;
        thumbObserver.disconnect();
        return;
      }
      if (patchVisible) {
        const windowEl = el.gallery.querySelector(":scope > .gallery-window");
        if (windowEl) {
          for (let i = 0; i < windowEl.children.length; i++) {
            patchYoloGalleryCard(galleryVirtual.startIndex + i, windowEl.children[i]);
          }
          return;
        }
      }
      const layout = computeVirtualGalleryLayout({
        scrollEl: el.galleryScroll,
        itemCount: state.pairs.length,
        columnUnit: 138,
        rowExtra: 36
      });
      renderVirtualGallery({
        galleryEl: el.gallery,
        virtual: galleryVirtual,
        itemCount: state.pairs.length,
        layout,
        thumbObserver,
        renderCard(index, windowEl) {
          const pair = state.pairs[index];
          const filename = pair.imagePath.split("/").pop();
          const card = document.createElement("div");
          card.className = yoloGalleryCardBaseClasses(index, pair);
          const tags = yoloGalleryThumbTags(pair);
          const scope = yoloGalleryAssignScope();
          const imageHtml = `<img data-path="${escapeHtml(pair.imagePath)}" data-src-pending="true" alt="">`;
          const mediaHtml = typeof inboxThumbMediaBlock === "function"
            ? inboxThumbMediaBlock(filename, scope, imageHtml)
            : imageHtml;
          card.innerHTML = `${mediaHtml}<div class="name">${tags}${escapeHtml(filename)}</div>`;
          bindImagePreviewLightbox(card, {
            onClick: event => onGalleryClick(event, index, pair),
            getContext: () => ({
              imagePath: pair.imagePath,
              imageHandle: pair.imageHandle,
              pairs: state.pairs,
              index,
              previewContext: hasWorkspaceRoot() ? "yolo" : null
            })
          });
          card.addEventListener("contextmenu", event => {
            onGalleryContextMenu(event, index, pair).catch(showError);
          });
          windowEl.appendChild(card);
          return card;
        },
        patchCard: patchYoloGalleryCard
      });
    }

    async function onThumbIntersect(entries) {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const img = entry.target;
        thumbObserver.unobserve(img);
        await loadGalleryThumbImage(img);
      }
    }

    function selectGalleryRange(fromIndex, toIndex) {
      const start = Math.min(fromIndex, toIndex);
      const end = Math.max(fromIndex, toIndex);
      state.shiftSelectedPaths.clear();
      for (let i = start; i <= end; i++) {
        state.shiftSelectedPaths.add(state.pairs[i].imagePath);
      }
    }

    async function onGalleryClick(event, index, pair) {
      if (event.shiftKey) {
        const anchor = state.multiSelectAnchorIndex ?? state.currentIndex;
        selectGalleryRange(anchor, index);
        renderGallery();
        updateReviewControls();
        updateSelectedClassPanel();
        return;
      }
      if (event.ctrlKey || event.metaKey) {
        if (state.shiftSelectedPaths.has(pair.imagePath)) state.shiftSelectedPaths.delete(pair.imagePath);
        else state.shiftSelectedPaths.add(pair.imagePath);
        state.multiSelectAnchorIndex = index;
        renderGallery();
        updateReviewControls();
        updateSelectedClassPanel();
        return;
      }
      state.multiSelectAnchorIndex = index;
      state.shiftSelectedPaths.clear();
      await selectIndex(index);
    }

    async function selectIndex(index, options = {}) {
      const { preserveShiftSelection = false } = options;
      if (!state.pairs.length) return;
      state.currentIndex = Math.max(0, Math.min(index, state.pairs.length - 1));
      if (!preserveShiftSelection || state.multiSelectAnchorIndex == null) {
        state.multiSelectAnchorIndex = state.currentIndex;
      }
      if (!preserveShiftSelection) state.shiftSelectedPaths.clear();
      state.currentImagePath = state.pairs[state.currentIndex]?.imagePath || null;
      state.selection = null;
      state.selectedBoxIndex = null;
      state.dragStart = null;
      if (typeof poolLabelState !== "undefined") {
        poolLabelState.cursorPoint = null;
        poolLabelState.crosshairPoint = null;
      }
      state.smartCropPreviewPlans = [];
      populateBoxEditor(null);
      await renderCurrentImage();
      preloadAroundCurrent();
      renderGallery();
      saveSessionSoon();
    }

    function scrollGalleryNearIndex(index, options = {}) {
      if (!el.galleryScroll || !state.pairs.length || !Number.isInteger(index)) return;
      const layout = computeVirtualGalleryLayout({
        scrollEl: el.galleryScroll,
        itemCount: state.pairs.length,
        columnUnit: 138,
        rowExtra: 36
      });
      const row = Math.max(0, Math.floor(Math.max(0, Math.min(index, state.pairs.length - 1)) / Math.max(1, layout.columns)));
      if (options.onlyIfNeeded) {
        const viewportTop = el.galleryScroll.scrollTop || 0;
        const viewportBottom = viewportTop + (el.galleryScroll.clientHeight || 0);
        const rowTop = row * layout.rowHeight;
        const rowBottom = rowTop + layout.rowHeight;
        if (rowTop >= viewportTop && rowBottom <= viewportBottom) {
          if (options.render !== false) renderGallery();
          return;
        }
      }
      const targetTop = Math.max(0, Math.round(row * layout.rowHeight - (el.galleryScroll.clientHeight || 0) * 0.35));
      el.galleryScroll.scrollTop = targetTop;
      state.galleryScrollTop = targetTop;
      if (options.render !== false) renderGallery();
    }

    let previewRenderToken = 0;
    let previewBoxesCache = [];

    function syncPreviewCanvasSize() {
      const canvasBox = el.canvas.parentElement.getBoundingClientRect();
      const nextWidth = Math.max(1, Math.floor(canvasBox.width));
      const nextHeight = Math.max(1, Math.floor(canvasBox.height));
      if (el.canvas.width !== nextWidth) el.canvas.width = nextWidth;
      if (el.canvas.height !== nextHeight) el.canvas.height = nextHeight;
      if (el.previewOverlayCanvas) {
        if (el.previewOverlayCanvas.width !== nextWidth) el.previewOverlayCanvas.width = nextWidth;
        if (el.previewOverlayCanvas.height !== nextHeight) el.previewOverlayCanvas.height = nextHeight;
      }
    }

    function clearPreviewOverlay() {
      const overlayCtx = window.previewOverlayCtx;
      if (!overlayCtx || !el.previewOverlayCanvas) return;
      overlayCtx.clearRect(0, 0, el.previewOverlayCanvas.width, el.previewOverlayCanvas.height);
    }

    function paintPreviewOverlayGuides() {
      clearPreviewOverlay();
      if (typeof drawPoolLabelAxisGuide === "function") drawPoolLabelAxisGuide();
      drawSelection();
    }

    function paintPreviewZoomGuide() {
      if (typeof drawPoolLabelZoomView === "function") drawPoolLabelZoomView();
    }

    function paintPreviewGuides() {
      paintPreviewOverlayGuides();
      paintPreviewZoomGuide();
    }

    function paintPreviewFrame(bitmap, pair, boxes) {
      syncPreviewCanvasSize();
      ctx.clearRect(0, 0, el.canvas.width, el.canvas.height);
      ctx.fillStyle = "#111827";
      ctx.fillRect(0, 0, el.canvas.width, el.canvas.height);
      clampPreviewView();
      const baseScale = Math.min(el.canvas.width / bitmap.width, el.canvas.height / bitmap.height, 1);
      const scale = baseScale * state.viewZoom;
      const w = Math.max(1, Math.floor(bitmap.width * scale));
      const h = Math.max(1, Math.floor(bitmap.height * scale));
      const x = Math.floor((el.canvas.width - w) / 2 + state.viewPanX);
      const y = Math.floor((el.canvas.height - h) / 2 + state.viewPanY);
      state.displayRect = { x, y, w, h, imageW: bitmap.width, imageH: bitmap.height };
      state.previewBoxes = boxes;
      state.previewBoxesImagePath = pair.imagePath;
      ctx.drawImage(bitmap, x, y, w, h);
      if (state.datasetTask !== "classify") drawYoloBoxes(boxes);
      drawClassifierPredictionBadge(pair);
      drawSmartCropPreview();
      drawPendingBlackPreview();
      window.poolLabelInvalidateZoomBase?.();
      paintPreviewGuides();
    }

    function redrawPreviewOverlays(options = {}) {
      if (!state.pairs.length || !state.currentImage) return;
      const pair = state.pairs[state.currentIndex];
      if (!pair) return;
      if (options.guidesOnly) {
        if (options.overlayOnly) paintPreviewOverlayGuides();
        else if (options.zoomOnly) paintPreviewZoomGuide();
        else paintPreviewGuides();
        return;
      }
      paintPreviewFrame(state.currentImage, pair, previewBoxesCache);
    }

    function schedulePreviewZoomRedraw() {
      scheduleUiFrame(UI_FRAME.PREVIEW_ZOOM, () => paintPreviewZoomGuide());
    }

    function schedulePreviewGuideRedraw(options = {}) {
      if (!options.zoomOnly) paintPreviewOverlayGuides();
      if (!options.overlayOnly) schedulePreviewZoomRedraw();
    }

    function schedulePreviewBaseRepaint() {
      scheduleUiFrame(UI_FRAME.PREVIEW_BASE, () => redrawPreviewOverlays());
    }

    window.schedulePreviewGuideRedraw = schedulePreviewGuideRedraw;
    window.schedulePreviewBaseRepaint = schedulePreviewBaseRepaint;
    window.paintPreviewOverlayGuides = paintPreviewOverlayGuides;

    function refreshPreviewBoxesOverlay(boxes) {
      if (Array.isArray(boxes)) {
        previewBoxesCache = boxes;
        const pair = state.pairs[state.currentIndex];
        if (pair) {
          state.previewBoxes = boxes;
          state.previewBoxesImagePath = pair.imagePath;
        }
      }
      window.poolLabelInvalidateZoomBase?.();
      redrawPreviewOverlays();
    }

    function previewBoxesForCurrentPair() {
      if (previewBoxesCache.length) return previewBoxesCache;
      const pair = state.pairs[state.currentIndex];
      if (!pair) return [];
      if (state.labelEdits.has(pair.imagePath)) return state.labelEdits.get(pair.imagePath);
      if (state.labelCache.has(pair.imagePath)) return state.labelCache.get(pair.imagePath);
      return [];
    }

    function updatePreviewMeta(pair, boxes) {
      el.labelText.value = state.datasetTask === "classify"
        ? `class ${pair.classId}: ${pair.className || classDisplay(pair.classId)}`
        : (boxesToText(boxes) || "(empty txt)");
      el.fileMeta.textContent = `${state.currentIndex + 1} / ${state.pairs.length} | ${pair.imagePath}`;
      el.boxCount.textContent = state.datasetTask === "classify"
        ? `class: ${pair.className || classDisplay(pair.classId)}`
        : `${boxes.length} box(es)`;
      renderCurrentPendingList();
      updateReviewControls();
      updateSelectedClassPanel();
      updateClassifierResultPanel();
      if (isPoolLabelActive()) updatePoolLabelPanel().catch(error => console.warn("Box Label panel:", error));
    }

    async function renderCurrentImage() {
      if (!state.pairs.length) return;
      const token = ++previewRenderToken;
      const pair = state.pairs[state.currentIndex];
      state.currentImagePath = pair.imagePath;
      try {
        if (!pair.imageHandle) {
          throw new Error(`找不到图片句柄: ${pair.imagePath}`);
        }
        const bitmap = await imageBitmapForPair(pair);
        if (token !== previewRenderToken) return;
        state.currentImage = bitmap;
        const boxes = state.datasetTask === "classify" ? [] : await effectiveBoxesFor(pair);
        if (token !== previewRenderToken) return;
        previewBoxesCache = boxes;
        paintPreviewFrame(bitmap, pair, boxes);
        updatePreviewMeta(pair, boxes);
      } catch (error) {
        if (token !== previewRenderToken) return;
        const message = String(error?.message || error);
        const missingFile = /No such file|找不到|not found|ENOENT/i.test(message);
        console.warn("Preview render failed:", error);
        if (state.currentImage) {
          try {
            paintPreviewFrame(state.currentImage, pair, previewBoxesCache);
            updatePreviewMeta(pair, previewBoxesCache);
          } catch {
            // ignore stale repaint failure
          }
        }
        setStatus(missingFile
          ? `图片已不存在（可能已 rebuild 或删除）：${pair.imagePath.split("/").pop()}。请切换 Detect/Clf 模式刷新列表。`
          : `预览加载失败: ${message}`);
      }
    }

    function clampPreviewView() {
      const bitmap = state.currentImage;
      if (!bitmap) return;
      state.viewZoom = Math.max(1, Math.min(12, state.viewZoom || 1));
      const baseScale = Math.min(el.canvas.width / bitmap.width, el.canvas.height / bitmap.height, 1);
      const w = bitmap.width * baseScale * state.viewZoom;
      const h = bitmap.height * baseScale * state.viewZoom;
      const maxPanX = Math.max(0, (w - el.canvas.width) / 2);
      const maxPanY = Math.max(0, (h - el.canvas.height) / 2);
      state.viewPanX = Math.max(-maxPanX, Math.min(maxPanX, state.viewPanX || 0));
      state.viewPanY = Math.max(-maxPanY, Math.min(maxPanY, state.viewPanY || 0));
      if (state.viewZoom === 1) {
        state.viewPanX = 0;
        state.viewPanY = 0;
      }
    }

    function resetPreviewView() {
      state.viewZoom = 1;
      state.viewPanX = 0;
      state.viewPanY = 0;
      if (state.currentImage) schedulePreviewBaseRepaint();
      else renderCurrentImage();
    }

    function canvasPoint(event) {
      const canvasBox = el.canvas.getBoundingClientRect();
      return {
        x: (event.clientX - canvasBox.left) * el.canvas.width / canvasBox.width,
        y: (event.clientY - canvasBox.top) * el.canvas.height / canvasBox.height
      };
    }

    function onCanvasWheel(event) {
      if (!state.currentImage || !state.displayRect) return;
      event.preventDefault();
      const before = canvasPoint(event);
      const imageX = (before.x - state.displayRect.x) / state.displayRect.w;
      const imageY = (before.y - state.displayRect.y) / state.displayRect.h;
      const factor = event.deltaY < 0 ? 1.18 : 1 / 1.18;
      const nextZoom = Math.max(1, Math.min(12, state.viewZoom * factor));
      if (nextZoom === state.viewZoom) return;
      state.viewZoom = nextZoom;
      const bitmap = state.currentImage;
      const baseScale = Math.min(el.canvas.width / bitmap.width, el.canvas.height / bitmap.height, 1);
      const nextW = bitmap.width * baseScale * state.viewZoom;
      const nextH = bitmap.height * baseScale * state.viewZoom;
      state.viewPanX = before.x - imageX * nextW - (el.canvas.width - nextW) / 2;
      state.viewPanY = before.y - imageY * nextH - (el.canvas.height - nextH) / 2;
      if (state.currentImage) schedulePreviewBaseRepaint();
      else renderCurrentImage();
    }

    function preloadAroundCurrent() {
      const nextIndex = state.currentIndex + 1;
      if (nextIndex < state.pairs.length) {
        imageBitmapForPair(state.pairs[nextIndex]).catch(() => {});
      }
      trimBitmapCache();
    }

	    function drawYoloBoxes(boxes) {
      const r = state.displayRect;
      if (!r) return;
      ctx.save();
      ctx.lineWidth = 2;
      ctx.font = "12px Segoe UI";
      boxes.forEach((box, index) => {
        const x1 = r.x + (box.x - box.w / 2) * r.w;
        const y1 = r.y + (box.y - box.h / 2) * r.h;
        const x2 = r.x + (box.x + box.w / 2) * r.w;
        const y2 = r.y + (box.y + box.h / 2) * r.h;
        ctx.strokeStyle = index === state.selectedBoxIndex ? "#2563eb" : "#18a058";
        ctx.lineWidth = index === state.selectedBoxIndex ? 3 : 2;
        ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
        const text = classDisplay(box.classId);
        const tw = ctx.measureText(text).width + 8;
        ctx.fillStyle = index === state.selectedBoxIndex ? "#2563eb" : "#18a058";
        ctx.fillRect(x1, Math.max(r.y, y1 - 18), tw, 18);
        ctx.fillStyle = "#ffffff";
        ctx.fillText(text, x1 + 4, Math.max(r.y + 13, y1 - 5));
        if (index === state.selectedBoxIndex) drawBoxHandles(x1, y1, x2, y2);
      });
	      ctx.restore();
	    }

	    function drawClassifierPredictionBadge(pair) {
	      const result = classifierState.results.get(pair.imagePath);
	      const r = state.displayRect;
	      if (!result?.top || !r) return;
	      const text = `${result.top.name} ${(result.top.confidence * 100).toFixed(1)}%`;
	      ctx.save();
	      ctx.font = "13px Segoe UI";
	      const width = Math.min(ctx.measureText(text).width + 14, Math.max(120, r.w - 12));
	      const x = r.x + 8;
	      const y = r.y + 8;
	      ctx.fillStyle = "rgba(17, 24, 39, 0.84)";
	      ctx.fillRect(x, y, width, 24);
	      ctx.strokeStyle = "#ffffff";
	      ctx.strokeRect(x + 0.5, y + 0.5, width - 1, 23);
	      ctx.fillStyle = "#ffffff";
	      ctx.fillText(text, x + 7, y + 16);
	      ctx.restore();
	    }

    function drawSmartCropPreview() {
      const r = state.displayRect;
      const plans = state.smartCropPreviewPlans || [];
      if (!r || !plans.length) return;
      ctx.save();
      ctx.lineWidth = 3;
      ctx.font = "12px Segoe UI";
      plans.forEach((plan, index) => {
        const x = r.x + plan.rect.x * r.w / r.imageW;
        const y = r.y + plan.rect.y * r.h / r.imageH;
        const w = plan.rect.w * r.w / r.imageW;
        const h = plan.rect.h * r.h / r.imageH;
        ctx.strokeStyle = index === 0 ? "#facc15" : "#38bdf8";
        ctx.setLineDash([10, 6]);
        ctx.strokeRect(x, y, w, h);
        ctx.setLineDash([]);
        const text = `crop ${index + 1} (${plan.boxes.length})`;
        const tw = ctx.measureText(text).width + 8;
        ctx.fillStyle = index === 0 ? "#a16207" : "#0369a1";
        ctx.fillRect(x, Math.max(r.y, y - 18), tw, 18);
        ctx.fillStyle = "#ffffff";
        ctx.fillText(text, x + 4, Math.max(r.y + 13, y - 5));
      });
      ctx.restore();
    }

    function drawBoxHandles(x1, y1, x2, y2) {
      const size = 6;
      const points = galleryBoxHandlePointsCanvas(x1, y1, x2, y2);
      ctx.save();
      ctx.fillStyle = "#ffffff";
      ctx.strokeStyle = "#2563eb";
      ctx.lineWidth = 2;
      for (const [, x, y] of points) {
        ctx.fillRect(x - size, y - size, size * 2, size * 2);
        ctx.strokeRect(x - size, y - size, size * 2, size * 2);
      }
      ctx.restore();
    }

    function galleryBoxHandlePointsCanvas(x1, y1, x2, y2) {
      return [
        ["nw", x1, y1], ["ne", x2, y1],
        ["sw", x1, y2], ["se", x2, y2]
      ];
    }
