const ctx = el.canvas.getContext("2d");
const previewOverlayCtx = el.previewOverlayCanvas?.getContext("2d") || null;
window.previewOverlayCtx = previewOverlayCtx;

function previewGuideCtx() {
  return previewOverlayCtx || ctx;
}
window.previewGuideCtx = previewGuideCtx;
window.setStartupProgress?.(78, "构建工作区界面...", "准备图片查看器");
const thumbObserver = new IntersectionObserver(onThumbIntersect, {
  root: el.galleryScroll,
  rootMargin: "240px"
});

window.setStartupProgress?.(82, "绑定工具...", "连接工作台控件");
bindAppShellEvents();
if (typeof bindJunkActionEvents === "function") bindJunkActionEvents();
bindImagePoolPageEvents();
bindYoloPageEvents();
bindPoolLabelPageEvents();
bindVideoPageEvents();
bindMergePageEvents();
bindClassifierPageEvents();
bindTrainPageEvents();
bindCropPageEvents();
bindMaskNoisePageEvents();
window.setStartupProgress?.(88, "连接后端...", "检查 Python 服务");

function updateStatus() {
  const hidden = state.allPairs.length - state.pairs.length;
  el.imageCount.textContent = `${state.pairs.length} / ${state.allPairs.length}`;
  const reviewed = state.reviewedPaths.size;
  const flagged = state.flaggedPaths.size;
  const task = state.datasetTask === "classify" ? "classify" : "detect";
  const viewMode = typeof yoloViewModeState !== "undefined" ? yoloViewModeState.mode : "";
  const mode = viewMode === "detect"
    ? "Detect Review"
    : viewMode === "clf"
      ? "Classify Review"
      : state.yoloSource === "dataset"
        ? `dataset:${task}`
        : task;
  setStatus(hasDatasetOpen() ? `${state.rootName} | ${mode} | showing ${state.pairs.length}/${state.allPairs.length}${hidden ? ` | hidden ${hidden}` : ""} | reviewed ${reviewed} | flagged ${flagged}` : "Open a folder to start, or drop a folder.");
  updateImageViewControls();
  updateReviewControls();
  updateSendToCropButton();
}

function restoreCurrentIndexByPath() {
  if (!state.currentImagePath) return;
  const index = state.pairs.findIndex(pair => pair.imagePath === state.currentImagePath);
  if (index >= 0) state.currentIndex = index;
}

function toggleReviewMode() {
  el.app.classList.toggle("review");
  el.reviewModeBtn.textContent = el.app.classList.contains("review")
    ? "Exit Review"
    : "Review Mode";
  requestAnimationFrame(() => {
    renderGallery();
    renderCurrentImage();
  });
}

function setupViewerResizers() {
  el.viewerSplitter?.addEventListener("pointerdown", startViewerResize);
  document.querySelectorAll(".tray-splitter").forEach(splitter => {
    splitter.addEventListener("pointerdown", startTrayResize);
  });
}

function startViewerResize(event) {
  const viewer = event.currentTarget.closest(".viewer");
  const tray = viewer?.querySelector(".edit-tray");
  if (!viewer || !tray) return;
  event.preventDefault();
  event.currentTarget.setPointerCapture(event.pointerId);
  document.body.classList.add("resizing-viewer");
  const startY = event.clientY;
  const startHeight = tray.getBoundingClientRect().height;
  const onMove = moveEvent => {
    const viewerHeight = viewer.getBoundingClientRect().height;
    const nextHeight = Math.max(220, Math.min(viewerHeight - 380, startHeight - (moveEvent.clientY - startY)));
    viewer.style.setProperty("--tool-tray-height", `${Math.round(nextHeight)}px`);
    renderCurrentImage();
  };
  const onUp = () => {
    document.body.classList.remove("resizing-viewer");
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    renderCurrentImage();
  };
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp, { once: true });
}

function startTrayResize(event) {
  const tray = event.currentTarget.closest(".edit-tray");
  const cards = [...tray.querySelectorAll(".tool-card")];
  const splitterMap = {
    imageCrop: { index: 0, leftVar: "--image-tool-width", rightVar: "--box-tool-width" },
    boxClasses: { index: 1, leftVar: "--box-tool-width", rightVar: "--class-tool-width" }
  };
  const config = splitterMap[event.currentTarget.dataset.traySplitter];
  if (!config) return;
  const index = config.index;
  const left = cards[index];
  const right = cards[index + 1];
  if (!left || !right) return;
  event.preventDefault();
  event.currentTarget.setPointerCapture(event.pointerId);
  document.body.classList.add("resizing-tray");
  const startX = event.clientX;
  const startLeft = left.getBoundingClientRect().width;
  const startRight = right.getBoundingClientRect().width;
  const onMove = moveEvent => {
    const dx = moveEvent.clientX - startX;
    const leftWidth = Math.max(260, startLeft + dx);
    const rightWidth = Math.max(260, startRight - dx);
    tray.style.setProperty(config.leftVar, `${Math.round(leftWidth)}px`);
    tray.style.setProperty(config.rightVar, `${Math.round(rightWidth)}px`);
  };
  const onUp = () => {
    document.body.classList.remove("resizing-tray");
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
  };
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp, { once: true });
}

let topbarProgressHideTimer = 0;

function syncTopbarProgress(text) {
  const box = document.getElementById("topbarProgress");
  const fill = document.getElementById("topbarProgressFill");
  if (!box || !fill) return;
  window.clearTimeout(topbarProgressHideTimer);
  const message = String(text || "");
  const numeric = message.match(/(?:^|[^\d])(\d+)\s*\/\s*(\d+)(?:[^\d]|$)/);
  const active = numeric
    || /正在|loading|scanning|indexing|exporting|merging|building|running|saving|opening|restoring|preparing|capture|duplicat/i.test(message);
  const done = /complete|finished|connected|ready|loaded|已完成|完成|已打开|已加载|connected/i.test(message);
  if (!active || done) {
    topbarProgressHideTimer = window.setTimeout(() => {
      box.hidden = true;
      fill.style.width = "";
      box.classList.remove("is-indeterminate");
    }, 500);
    return;
  }
  box.hidden = false;
  if (numeric) {
    const value = Number(numeric[1]);
    const total = Math.max(1, Number(numeric[2]));
    const percent = Math.max(3, Math.min(100, Math.round((value / total) * 100)));
    box.classList.remove("is-indeterminate");
    fill.style.width = `${percent}%`;
  } else {
    fill.style.width = "";
    box.classList.add("is-indeterminate");
  }
}

function setStatus(text) {
  el.status.textContent = text;
  syncTopbarProgress(text);
}
function classDisplay(id) { return state.classNames.has(id) ? `${id}: ${state.classNames.get(id)}` : String(id); }
async function imageBitmap(handle) { return createImageBitmap(await handle.getFile()); }

async function imageBitmapForPair(pair) {
  if (bitmapCache.has(pair.imagePath)) {
    try {
      return await bitmapCache.get(pair.imagePath);
    } catch (error) {
      bitmapCache.delete(pair.imagePath);
      throw error;
    }
  }
  const backend = backendImageHandle(pair.imageHandle);
  const promise = backend
    ? previewBitmapForBackendHandle(pair.imageHandle, PREVIEW_MAX_EDGE)
    : imageBitmap(pair.imageHandle);
  bitmapCache.set(pair.imagePath, promise);
  try {
    return await promise;
  } catch (error) {
    bitmapCache.delete(pair.imagePath);
    throw error;
  }
}

function trimBitmapCache() {
  const keep = new Set();
  for (let i = Math.max(0, state.currentIndex - 1); i < Math.min(state.pairs.length, state.currentIndex + 3); i++) {
    keep.add(state.pairs[i].imagePath);
  }
  for (const path of bitmapCache.keys()) {
    if (!keep.has(path)) bitmapCache.delete(path);
  }
}

async function fileUrl(path, handle) {
  const cached = getCachedObjectUrl(path);
  if (cached) return cached;
  const url = typeof objectUrlForFile === "function"
    ? await objectUrlForFile(await handle.getFile())
    : URL.createObjectURL(await handle.getFile());
  return setCachedObjectUrl(path, url);
}

function revokeUrls() {
  clearCachedObjectUrls();
}

async function writeBlob(handle, blob) {
  const writable = await handle.createWritable();
  await writable.write(blob);
  await writable.close();
}

async function writeText(handle, text) {
  const writable = await handle.createWritable();
  await writable.write(text);
  await writable.close();
}

function showError(error) {
  alert(error?.message || String(error));
}
